import type { Express } from 'express';
import multer from 'multer';
import * as https from 'node:https';
import * as http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  rawRequest,
  UA,
  cookieHeader,
  shouldBypassProxy,
  parseCookieHeaders,
  mergeCookies,
  type Cookie,
} from '../../http/http.js';
import { readSsoConfigFile } from '../../http/hik_logins/hicoo.js';
import { UEDRO_BASE, UEDRO_LOGIN_URL, uedroHeaders } from '../../http/hik_logins/uedro.js';

/**
 * 海康 / 羽点（uedro）业务路由。
 *
 * 这些接口复用 SSO 登录后写入本地的 session，从中取出 uedro 会话 cookie
 * 鉴权羽点应用侧接口。session 由 `apps/daemon/src/routes/auth.ts` 在登录时
 * 写入（SSO 登录成功后顺带登录羽点门户）。
 */

export interface RegisterHikUedroRoutesDeps {
  dataDir: string;
  sendApiError: (...args: any[]) => any;
}

/** 羽点评审列表查询接口。 */
const UEDRO_REVIEW_LIST_URL = UEDRO_BASE + '/uedro/web/review/v1/reviewList';

/** 羽点用户列表查询接口。 */
const UEDRO_USER_LIST_URL = UEDRO_BASE + '/uedro/web/user/v1/list';

/** 羽点项目列表查询接口。 */
const UEDRO_PROJECT_LIST_URL = UEDRO_BASE + '/uedro/web/project/v1/projectList';

/** 羽点稿件文件下载接口（GET，返回二进制文件流）。 */
const UEDRO_MANUSCRIPT_FILE_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/getManuscriptFile';

/** 羽点一键催办接口（POST，催促未评审的评委）。 */
const UEDRO_URGE_URL = UEDRO_BASE + '/uedro/web/mail/v1/urge';

/** 羽点评审订阅状态修改接口（GET，开启/关闭通知）。 */
const UEDRO_EDIT_SUBSCRIPTION_URL = UEDRO_BASE + '/uedro/web/review/v1/editSubscriptionStatus';

/** 羽点评审主数据接口（GET，按 reviewId 取评审对象；manuscriptDtos/repeat 为 null）。 */
const UEDRO_REVIEW_ONE_URL = UEDRO_BASE + '/uedro/web/review/v1/oneByReviewId';

/** 羽点评审稿件列表接口（POST，按 reviewId 分页取稿件）。 */
const UEDRO_SUB_PROCESS_URL = UEDRO_BASE + '/uedro/web/review/v1/subProcess';

/** 羽点评委评审进度接口（POST，按评委列出提交状态与缺陷/建议计数）。 */
const UEDRO_REVIEW_PROGRESS_URL = UEDRO_BASE + '/uedro/web/comment/v1/reviewProgress';

/** 羽点评审统计接口（POST，按 reviewId + version 汇总各状态计数）。 */
const UEDRO_PROGRESS_QUANTITY_URL = UEDRO_BASE + '/uedro/web/comment/v1/progressQuantity';

/** 羽点评审名称模板查询接口（GET，按 projectId 返回评审模板 JSON 串数组）。 */
const UEDRO_REVIEW_NAME_URL = UEDRO_BASE + '/uedro/web/review/v1/reviewName';

/** 羽点评审稿上传接口（POST multipart/form-data，返回 manuscriptId 等稿件信息）。 */
const UEDRO_MANUSCRIPT_UPLOAD_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/upload';

/** 羽点评审稿删除接口（GET，按 manuscriptId 删除已上传但未提交的稿件）。 */
const UEDRO_MANUSCRIPT_DELETE_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/deletion';

/** 羽点发起评审接口（POST，提交完整评审表单创建一条评审）。 */
const UEDRO_REVIEW_ADDITION_URL = UEDRO_BASE + '/uedro/web/review/v1/addition';

/**
 * 评审稿上传 multer 单例：memoryStorage 把文件留在内存，再以 multipart 透传上游。
 * 字段：file（单个文件）+ excelJson（可选文本字段，原站固定传空串）。
 */
const manuscriptUpload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'file', maxCount: 1 },
  { name: 'excelJson', maxCount: 1 },
]);

/** 从本地 SSO session 取出羽点会话 cookie；缺失时返回 null 并由调用方回 401。 */
function readUedroCookies(dataDir: string): Cookie[] | null {
  const session = readSsoConfigFile(dataDir);
  const uedroCookies = session?.uedro?.cookies;
  return uedroCookies?.length ? uedroCookies : null;
}

export function registerHikUedroRoutes(app: Express, deps: RegisterHikUedroRoutesDeps): void {
  const { dataDir, sendApiError } = deps;

  /**
   * POST /api/hik/uedro/reviewList — 查询羽点评审列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点评审列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：reviewName / processType / reviewModel / reviewType /
   * pageSize / pageNo / total，缺省值对齐前端默认查询。
   */
  app.post('/api/hik/uedro/reviewList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        reviewName: typeof body.reviewName === 'string' ? body.reviewName : '',
        // processType=0 评审中; 1，我参与的; 2，我发起的; 3，全部;
        processType: typeof body.processType === 'number' ? body.processType : 0,
        reviewModel: typeof body.reviewModel === 'number' ? body.reviewModel : 0,
        /**
         *  reviewType=null 全部; "1" 交互评审; "2" 视觉评审; 
         *  "3" 文稿评审; "4" 表格评审; "5" 海客评审; "10" 插件评审; "11" Pixso Handoff;
        */
        reviewType: typeof body.reviewType === 'string' ? body.reviewType : null,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 9,
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        total: typeof body.total === 'number' ? body.total : 0,
      });

      const result = await rawRequest('POST', UEDRO_REVIEW_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro review list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data?.reviewList,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro review list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/userList — 查询羽点用户列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点用户列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：userName / pageNo / pageSize，缺省值对齐
   * 前端默认查询（pageNo=1, pageSize=30）。
   */
  app.post('/api/hik/uedro/userList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        userName: typeof body.userName === 'string' ? body.userName : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 30,
      });

      const result = await rawRequest('POST', UEDRO_USER_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro user list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro user list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/projectList — 查询羽点项目列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点项目列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：projNumOrName / processType / pageNo / pageSize，
   * 缺省值对齐前端默认查询（processType=1, pageNo=1, pageSize=10）。
   */
  app.post('/api/hik/uedro/projectList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        projNumOrName: typeof body.projNumOrName === 'string' ? body.projNumOrName : '',
        processType: typeof body.processType === 'number' ? body.processType : 1,
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 10,
      });

      const result = await rawRequest('POST', UEDRO_PROJECT_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro project list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro project list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * GET /api/hik/uedro/downloadManuscript?manuscriptId=… — 下载羽点稿件文件。
   *
   * 透传上游 `GET /uedro/web/manuscript/v1/getManuscriptFile?manuscriptId=…`，
   * 上游返回二进制文件流（xlsx/docx 等）。`rawRequest` 会把 body 转 utf8
   * 破坏二进制，所以这里用原生 https/http 直接把响应流 pipe 给客户端，
   * 透传 content-type / content-disposition（文件名）。
   *
   * 上游若返回 JSON（鉴权失败 / 稿件不存在），content-type 是 application/json，
   * 此时按 JSON 错误体处理而不是当文件下载。3xx 跟随重定向并合并 cookie。
   */
  app.get('/api/hik/uedro/downloadManuscript', (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const manuscriptId = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : '';
    if (!manuscriptId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'manuscriptId is required');
    }

    const upstreamUrl = new URL(UEDRO_MANUSCRIPT_FILE_URL);
    upstreamUrl.searchParams.set('manuscriptId', manuscriptId);
    streamUpstreamGet(upstreamUrl.toString(), uedroCookies, res, sendApiError, 'download manuscript');
  });

  /**
   * POST /api/hik/uedro/urge — 一键催办未评审评委。
   *
   * 透传上游 `POST /uedro/web/mail/v1/urge`，请求体 `{ reviewId }`。
   * 上游响应 `{ code:'0', msg:'success', data:null }`，code !== '0' 视为失败。
   */
  app.post('/api/hik/uedro/urge', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    try {
      const result = await rawRequest('POST', UEDRO_URGE_URL, uedroCookies, {
        body: JSON.stringify({ reviewId }),
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro urge bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro urge failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/editSubscriptionStatus — 开启/关闭评审通知。
   *
   * 透传上游 `GET /uedro/web/review/v1/editSubscriptionStatus?reviewId=…&status=true|false`。
   * 用 POST 形式接受前端请求体 `{ reviewId, status }`，内部转成上游 GET。
   * status=true 开启通知，false 关闭。code !== '0' 视为失败。
   */
  app.post('/api/hik/uedro/editSubscriptionStatus', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
    const status = body.status === true || body.status === 'true';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    const upstreamUrl = new URL(UEDRO_EDIT_SUBSCRIPTION_URL);
    upstreamUrl.searchParams.set('reviewId', reviewId);
    upstreamUrl.searchParams.set('status', String(status));

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro editSubscriptionStatus bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro editSubscriptionStatus failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * GET /api/hik/uedro/reviewOne?reviewId=… — 查询评审主数据。
   *
   * 透传上游 `GET /uedro/web/review/v1/oneByReviewId?reviewId=…`，上游 `data` 即评审
   * 对象（reviewName / reviewType / creator / preReviewEndTimeDate / roles / flowNo 等）。
   * 注意 oneByReviewId 返回的 manuscriptDtos/repeat 为 null，稿件需另调 subProcess。
   * 用 GET 形式而非 postUedroJson，因上游是 GET（无请求体）。
   */
  app.get('/api/hik/uedro/reviewOne', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const reviewId = typeof req.query.reviewId === 'string' ? req.query.reviewId : '';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    const upstreamUrl = new URL(UEDRO_REVIEW_ONE_URL);
    upstreamUrl.searchParams.set('reviewId', reviewId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reviewOne bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro reviewOne failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/subProcess — 查询评审稿件列表。
   *
   * 透传上游 `POST /uedro/web/review/v1/subProcess`，请求体
   * `{ reviewId, pageNo, pageSize }`。上游 `data.list[]` 每项 = 一份稿件
   *（manuscriptId / fileName / url / version / defectNums / verifyNum / isReviewed）。
   */
  app.post('/api/hik/uedro/subProcess', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_SUB_PROCESS_URL,
      label: 'subProcess',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 10000,
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/reviewProgress — 查询评委评审进度。
   *
   * 透传上游 `POST /uedro/web/comment/v1/reviewProgress`，请求体 `{ reviewId }`。
   * 上游 `data[]` 每项 = `{ userName, defectNum, adviceNum, committedTime, status, manuscript }`。
   */
  app.post('/api/hik/uedro/reviewProgress', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_PROGRESS_URL,
      label: 'reviewProgress',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/progressQuantity — 查询评审统计（按 reviewId + version）。
   *
   * 透传上游 `POST /uedro/web/comment/v1/progressQuantity`，请求体
   * `{ reviewId, version }`。上游 `data = { all, toSolve, toSolveByMySelf, toVerify,
   * closed, adviceNUm, defectNum }`。version 默认取 1（评审首个版本）。
   */
  app.post('/api/hik/uedro/progressQuantity', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_PROGRESS_QUANTITY_URL,
      label: 'progressQuantity',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        version: typeof body.version === 'number' ? body.version : 1,
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/reviewName — 查询项目对应的评审名称模板。
   *
   * 透传上游 `GET /uedro/web/review/v1/reviewName?projectId=…`，上游 `data` 是
   * 评审模板 JSON 串（`"[{reviewname_cn,reviewname,reviewstyle,resultsmatter,…}]"`），
   * 由前端 JSON.parse 后填入评审名称下拉。`[null]` 表示该项目无可用模板。
   */
  app.post('/api/hik/uedro/reviewName', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!projectId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    }

    const upstreamUrl = new URL(UEDRO_REVIEW_NAME_URL);
    upstreamUrl.searchParams.set('projectId', projectId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reviewName bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro reviewName failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/uploadManuscript — 上传评审稿。
   *
   * 透传上游 `POST /uedro/web/manuscript/v1/upload`（multipart/form-data）。
   * 前端发 multipart（含 `file` + `excelJson`），daemon 用 multer memoryStorage 接收，
   * 再以原生 https 模块把 multipart 重组成流透传上游——不能复用 `rawRequest`，因其把
   * body `toString('utf8')` 缓存进内存会破坏二进制文件流。
   *
   * 上游响应 `{code:'0',data:{manuscriptId,url,compressUrl,staticTempFileDir,menInfo,reviewType}}`，
   * code !== '0' 视为失败（如 Pixso-Handoff 类型不匹配）。
   */
  app.post('/api/hik/uedro/uploadManuscript', (req, res, next) => {
    manuscriptUpload(req, res, (err: any) => {
      if (err) return sendApiError(res, 400, 'BAD_REQUEST', 'manuscript upload parse failed: ' + (err?.message || String(err)));
      next();
    });
  }, async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const fileArr = files['file'];
    const excelJsonArr = files['excelJson'];
    const file = fileArr?.[0];
    if (!file) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
    }
    const excelJson = excelJsonArr?.[0]?.buffer?.toString('utf8') ?? '';

    try {
      const result = await forwardMultipart(
        UEDRO_MANUSCRIPT_UPLOAD_URL,
        uedroCookies,
        [
          { name: 'file', filename: file.originalname, contentType: file.mimetype || 'application/octet-stream', data: file.buffer },
          { name: 'excelJson', data: excelJson },
        ],
        'upload manuscript',
      );
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro uploadManuscript bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro uploadManuscript failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/reviewAddition — 发起评审。
   *
   * 透传上游 `POST /uedro/web/review/v1/addition`，请求体由前端按原站表单组装：
   *   reviewName / description / reviewType / preReviewEndTime / reviewerMain[] /
   *   author[] / reviewers[] / coreReviewers[] / copyPersons[] / manuscriptId /
   *   reviewModel / projectId / projManager / projName
   * 部门模式（reviewModel=2）前端不发 projectId/projManager/projName。
   *
   * 上游响应 `{code:'0'}` 视为成功，data 为新评审 id。
   */
  app.post('/api/hik/uedro/reviewAddition', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_ADDITION_URL,
      label: 'reviewAddition',
      buildBody: (body) => ({
        reviewName: typeof body.reviewName === 'string' ? body.reviewName : '',
        description: typeof body.description === 'string' ? body.description : '',
        reviewType: typeof body.reviewType === 'string' ? body.reviewType : '',
        preReviewEndTime: typeof body.preReviewEndTime === 'string' ? body.preReviewEndTime : '',
        reviewerMain: Array.isArray(body.reviewerMain) ? body.reviewerMain : [],
        author: Array.isArray(body.author) ? body.author : [],
        reviewers: Array.isArray(body.reviewers) ? body.reviewers : [],
        coreReviewers: Array.isArray(body.coreReviewers) ? body.coreReviewers : [],
        copyPersons: Array.isArray(body.copyPersons) ? body.copyPersons : [],
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
        reviewModel: typeof body.reviewModel === 'number' ? body.reviewModel : 1,
        // 项目模式才带这三个字段；部门模式前端不发，buildBody 也跳过。
        ...(body.reviewModel === 2
          ? {}
          : {
              projectId: typeof body.projectId === 'string' ? body.projectId : '',
              projManager: typeof body.projManager === 'string' ? body.projManager : '',
              projName: typeof body.projName === 'string' ? body.projName : '',
            }),
      }),
      requireFields: [
        'reviewName',
        'reviewType',
        'preReviewEndTime',
        'manuscriptId',
        'reviewModel',
      ],
    });
  });
}

/**
 * 统一封装「取 uedro cookie → POST 上游 → 解析 JSON → 回 `{ ok, data }`」。
 *
 * subProcess/reviewProgress/progressQuantity 三个详情路由结构完全
 * 一致，抽出公共逻辑避免每个路由各写一遍 try/catch + JSON.parse。与 `readUedroCookies`
 * 同属 uedro 路由的复用层。
 *
 * - `buildBody`：从请求体挑字段并施加类型校验/缺省，产出上游请求体。
 * - `requireFields`：buildBody 后逐个检查非空，缺失回 400。
 * - `mapData`：可选，从上游 data 里再取一层；默认原样透传上游 data。
 *
 * 响应形状与 urge/editSubscriptionStatus 对齐：`{ ok: code==='0', data }`，并附 `msg`
 * 以便前端在失败时展示上游错误信息。
 */
async function postUedroJson(
  req: any,
  res: any,
  opts: {
    dataDir: string;
    sendApiError: (...args: any[]) => any;
    url: string;
    label: string;
    buildBody: (body: Record<string, any>) => Record<string, any>;
    requireFields?: string[];
    mapData?: (upstream: any) => any;
  },
): Promise<void> {
  const uedroCookies = readUedroCookies(opts.dataDir);
  if (!uedroCookies) {
    return opts.sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
  }
  const body = (req.body ?? {}) as Record<string, any>;
  const upstreamBody = opts.buildBody(body);
  if (opts.requireFields) {
    for (const f of opts.requireFields) {
      if (!upstreamBody[f]) {
        return opts.sendApiError(res, 400, 'BAD_REQUEST', `${f} is required`);
      }
    }
  }
  try {
    const result = await rawRequest('POST', opts.url, uedroCookies, {
      body: JSON.stringify(upstreamBody),
      extraHeaders: uedroHeaders(uedroCookies),
    });
    let upstream: any;
    try {
      upstream = JSON.parse(result.body);
    } catch {
      return opts.sendApiError(res, 502, 'BAD_GATEWAY', `uedro ${opts.label} bad response`);
    }
    const data = opts.mapData ? opts.mapData(upstream) : upstream?.data;
    return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data });
  } catch (err: any) {
    return opts.sendApiError(res, 500, 'INTERNAL_ERROR', `uedro ${opts.label} failed: ` + (err?.message || String(err)));
  }
}

/**
 * 流式透传一个上游 GET 请求（用于下载稿件二进制文件）。
 *
 * 为什么不复用 `rawRequest`：它把整个 body `toString('utf8')` 缓存进内存
 * 再返回，会破坏 xlsx/docx 这类二进制流。这里用原生 http(s) 模块，把上游
 * 响应逐块 pipe 给客户端，文件再大也不占内存。
 *
 * 行为：
 * - 跟随 3xx 重定向并合并 cookie（下载链接常见 302 到 CDN）。
 * - content-type 为 JSON 时按错误体处理，回 502 + 上游信息（鉴权失效 /
 *   稿件不存在时上游不会给文件，而是 JSON 错误）。
 * - 否则透传 content-type / content-disposition（含文件名）给浏览器，
 *   触发原生下载。
 *
 * @param urlStr 上游完整 URL
 * @param cookies 本地 uedro cookie
 * @param res Express 响应
 * @param label 错误信息前缀（用于日志 / 502 body）
 */
function streamUpstreamGet(
  urlStr: string,
  cookies: Cookie[],
  res: any,
  sendApiError: (...args: any[]) => any,
  label: string,
): void {
  const doReq = (u: string, jar: Cookie[], redirects: number) => {
    if (redirects > 15) {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} too many redirects`);
      return;
    }
    const url = new URL(u);
    const isHttps = url.protocol === 'https:';
    const headers: Record<string, string> = {
      ...uedroHeaders(jar),
    };
    const cookieStr = cookieHeader(jar, u);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const handleResponse = (resp: any) => {
      // 合并本轮 set-cookie 到 jar，供可能的重定向复用。
      const setCookies = ([] as string[]).concat((resp.headers['set-cookie'] as string[]) || []);
      jar = mergeCookies(jar, parseCookieHeaders(setCookies, u));

      const status = resp.statusCode ?? 0;
      // 3xx 重定向：跟随 location 并带上更新后的 cookie。
      if (status >= 300 && status < 400 && resp.headers.location) {
        const next = new URL(resp.headers.location as string, u).toString();
        resp.resume();
        return doReq(next, jar, redirects + 1);
      }

      const contentType = String(resp.headers['content-type'] || '').toLowerCase();
      // 上游返回 JSON：多半是鉴权失效 / 稿件不存在，不是真正的文件。
      if (contentType.includes('application/json')) {
        const chunks: Buffer[] = [];
        resp.on('data', (c: Buffer) => chunks.push(c));
        resp.on('end', () => {
          let msg = `${label} upstream error`;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed?.msg) msg = String(parsed.msg);
          } catch {
            /* 保持默认 msg */
          }
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', msg);
        });
        resp.on('error', () => {
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} response error`);
        });
        return;
      }

      // 真正的文件流：透传 content-type / content-disposition，逐块 pipe。
      // content-disposition 先过 normalizeContentDisposition：羽点 filename= 段
      // 常带 GBK/UTF-8 字节，Node 头按 latin1 解码会让浏览器拿到乱码文件名，
      // 这里规整成 RFC 5987 `filename*=UTF-8''…` 形式。
      if (!res.headersSent) {
        res.setHeader('Content-Type', resp.headers['content-type'] || 'application/octet-stream');
        const cd = resp.headers['content-disposition'];
        if (cd) {
          res.setHeader('Content-Disposition', normalizeContentDisposition(String(cd)) ?? cd);
        }
        if (resp.headers['content-length']) {
          res.setHeader('Content-Length', resp.headers['content-length']);
        }
      }
      resp.pipe(res);
      resp.on('error', () => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} stream error`);
      });
    };

    // 羽点稿件下载落在 *.hikvision.com.cn 内网域名，rawRequest 对这些域名
    // 走直连（DEFAULT_NO_PROXY）。这里同样直连：用 shouldBypassProxy 复用
    // 同一套内网判定，未绕过时才回退代理（极少数外网出口）。
    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const bypass = shouldBypassProxy(url.hostname);
    const proxy = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || '');
    if (proxy && !bypass) {
      // 外网代理出口：交给 Node 默认代理行为，保持与 rawRequest 一致的语义。
      const upstream = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
          path: url.pathname + url.search,
          method: 'GET',
          headers,
          rejectUnauthorized: false,
        },
        handleResponse,
      );
      upstream.setTimeout(30000, () => {
        upstream.destroy();
        if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', `${label} timeout`);
      });
      upstream.on('error', (e: any) => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} failed: ${e?.message || String(e)}`);
      });
      upstream.end();
      return;
    }
    const upstream = mod.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        rejectUnauthorized: false,
      },
      handleResponse,
    );
    upstream.setTimeout(30000, () => {
      upstream.destroy();
      if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', `${label} timeout`);
    });
    upstream.on('error', (e: any) => {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} failed: ${e?.message || String(e)}`);
    });
    upstream.end();
  };
  doReq(urlStr, [...cookies], 0);
}

/**
 * 把上游 `Content-Disposition` 头规整成浏览器能正确解析的 RFC 5987 形式。
 *
 * 为什么需要它：羽点稿件下载的 `filename=` 段常带非 ASCII 字节（中文文件名）。
 * HTTP 头字段值在 Node 里按 latin1 解码，于是 GBK/UTF-8 字节被错误展成 latin1
 * 字符串透传给浏览器，下载下来就是 `ç¨¿ä»¶.xlsx` 这类乱码。这里把那段字节
 * 当作 latin1 还原成 Buffer，先试 UTF-8 再退到 GBK 解码，重写为
 * `filename="<ascii>"; filename*=UTF-8''<pct>` —— 现代浏览器优先解析 `filename*`，
 * 拿到正确文件名；`filename=` 留一个 ASCII 兜底给旧客户端。
 *
 * 已自带 `filename*=…` 扩展段时原样放行（上游或浏览器已能用，不重复改写）；
 * 无任何 filename 段时也原样返回（不凭空造名）。
 */
export function normalizeContentDisposition(cd: string): string {
  if (!cd) return cd;
  // 已是 RFC 5987 扩展形式，浏览器能正确解析，不动。
  if (/filename\s*\*=/i.test(cd)) return cd;

  // 匹配 filename="..." 或 filename=token（不含分号/引号）。
  const m = cd.match(/filename\s*=\s*("[^"]*"|[^";]+)/i);
  if (!m) return cd;
  const start = m.index ?? 0;
  const before = cd.slice(0, start);
  const after = cd.slice(start + m[0].length);

  const rawName = (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!rawName) return cd;

  // Node 头按 latin1 解码：非 ASCII 字符其实是 GBK/UTF-8 字节被拆成了 latin1 字符。
  // 按 latin1 还原回字节，再尝试 UTF-8 → GBK 解码。
  const buf = Buffer.from(rawName, 'latin1');
  let decoded: string;
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('�')) {
    // UTF-8 解码无替换符，判定为 UTF-8（含纯 ASCII 这条捷径）。
    decoded = asUtf8;
  } else {
    // UTF-8 失败 → 退 GBK（海康内网遗留编码）。
    try {
      decoded = new TextDecoder('gbk').decode(buf);
    } catch {
      decoded = asUtf8;
    }
  }

  const ascii = decoded.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  const pct = encodeURIComponent(decoded);
  return `${before}filename="${ascii}"; filename*=UTF-8''${pct}${after}`;
}

/**
 * 透传一个 multipart/form-data POST 请求到羽点上游。
 *
 * 为什么不复用 `rawRequest`：它把整个 body `toString('utf8')` 缓存进内存再返回，
 * 会破坏文件这类二进制流。这里手动拼 multipart boundary，用原生 https/http 模块
 * 把 Buffer 写出去，再把上游响应整体缓存为字符串返回（上传接口的响应是 JSON，
 * 体量小，可整体缓存）。
 *
 * 边界、Content-Disposition、Content-Type 都按 RFC 2388 拼；文本字段不带 filename，
 * 文件字段带 filename + contentType。cookie / Referer / X-Requested-With 由
 * `uedroHeaders` 注入，与其它 uedro 路由一致。复用 `streamUpstreamGet` 同款的
 * 代理判定（内网直连，外网走 HTTPS_PROXY）。
 *
 * @param urlStr 上游完整 URL
 * @param cookies 本地 uedro cookie
 * @param parts multipart 各段：`{name, data, filename?, contentType?}`
 * @param label 错误信息前缀
 * @returns 上游响应体（字符串），由调用方按 JSON 解析
 */
function forwardMultipart(
  urlStr: string,
  cookies: Cookie[],
  parts: { name: string; data: string | Buffer; filename?: string; contentType?: string }[],
  label: string,
): Promise<{ body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const boundary = '----OpenDesignUedro' + Math.random().toString(16).slice(2);
    const chunks: Buffer[] = [];
    for (const part of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      if (part.filename) {
        const disp = `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`;
        chunks.push(Buffer.from(disp, 'utf8'));
        chunks.push(Buffer.from(`Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`));
      } else {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      }
      chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8'));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const headers: Record<string, string> = {
      ...uedroHeaders(cookies),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    };
    const cookieStr = cookieHeader(cookies, urlStr);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const bypass = shouldBypassProxy(url.hostname);
    const proxy = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || '');

    const opts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      rejectUnauthorized: false,
    };

    const handleResp = (resp: any) => {
      const data: Buffer[] = [];
      resp.on('data', (c: Buffer) => data.push(c));
      resp.on('end', () => resolve({ body: Buffer.concat(data).toString('utf8') }));
      resp.on('error', (e: any) => reject(new Error(`${label} response error: ${e?.message || String(e)}`)));
    };

    let req: http.ClientRequest;
    if (proxy && !bypass) {
      req = mod.request(opts, handleResp);
    } else {
      req = mod.request(opts, handleResp);
    }
    req.setTimeout(120000, () => {
      req.destroy(new Error(`${label} timeout`));
    });
    req.on('error', (e: any) => reject(new Error(`${label} failed: ${e?.message || String(e)}`)));
    req.end(body);
  });
}
