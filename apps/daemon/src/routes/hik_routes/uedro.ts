import type { Express } from 'express';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import {
  rawRequest,
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

/** 羽点评审详情主数据接口（POST，返回评审对象 + 稿件 + 评委）。 */
const UEDRO_REVIEW_PROCESS_URL = UEDRO_BASE + '/uedro/web/review/v1/process';

/** 羽点评委评审进度接口（POST，按评委列出提交状态与缺陷/建议计数）。 */
const UEDRO_REVIEW_PROGRESS_URL = UEDRO_BASE + '/uedro/web/comment/v1/reviewProgress';

/** 羽点缺陷/意见列表接口（POST，按稿件+评委分组）。 */
const UEDRO_COMMENT_LIST_URL = UEDRO_BASE + '/uedro/web/comment/v1/listByCondition';

/** 羽点缺陷统计接口（POST，按稿件汇总各状态计数）。 */
const UEDRO_COMMENT_QUANTITY_URL = UEDRO_BASE + '/uedro/web/comment/v1/quantity';

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
   * POST /api/hik/uedro/reviewProcess — 查询评审详情主数据。
   *
   * 透传上游 `POST /uedro/web/review/v1/process`，请求体 `{ reviewId, pageNo, pageSize }`。
   * 上游 `data.list[0]` 即评审对象（含 manuscriptDtos / repeat / 评委名单），与
   * reviewList 列表项结构一致且子字段已填充。`oneByReviewId` 返回的对象 manuscriptDtos/repeat
   * 为 null，不适合做详情主数据源，故用 process。code !== '0' 视为失败。
   */
  app.post('/api/hik/uedro/reviewProcess', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_PROCESS_URL,
      label: 'reviewProcess',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 50,
      }),
      requireFields: ['reviewId'],
      mapData: (upstream) => upstream?.data?.list?.[0] ?? null,
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
   * POST /api/hik/uedro/commentList — 查询缺陷/意见列表（按稿件+评委分组）。
   *
   * 透传上游 `POST /uedro/web/comment/v1/listByCondition`，请求体
   * `{ reviewId, manuscriptId, pageNo, pageSize }`。上游 `data.mapList[]` 每项
   * = `{ name, commentDtos[] }`。manuscriptId 必填（否则上游 400）。
   */
  app.post('/api/hik/uedro/commentList', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_COMMENT_LIST_URL,
      label: 'commentList',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 100,
      }),
      requireFields: ['reviewId', 'manuscriptId'],
    });
  });

  /**
   * POST /api/hik/uedro/commentQuantity — 查询缺陷统计（按稿件汇总各状态计数）。
   *
   * 透传上游 `POST /uedro/web/comment/v1/quantity`，请求体 `{ reviewId, manuscriptId }`。
   * 上游 `data = { all, toSolve, toSolveByMySelf, toVerify, closed, defectNum, adviceNUm }`。
   */
  app.post('/api/hik/uedro/commentQuantity', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_COMMENT_QUANTITY_URL,
      label: 'commentQuantity',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
      }),
      requireFields: ['reviewId', 'manuscriptId'],
    });
  });
}

/**
 * 统一封装「取 uedro cookie → POST 上游 → 解析 JSON → 回 `{ ok, data }`」。
 *
 * reviewProcess/reviewProgress/commentList/commentQuantity 四个详情路由结构完全
 * 一致，抽出公共逻辑避免每个路由各写一遍 try/catch + JSON.parse。与 `readUedroCookies`
 * 同属 uedro 路由的复用层。
 *
 * - `buildBody`：从请求体挑字段并施加类型校验/缺省，产出上游请求体。
 * - `requireFields`：buildBody 后逐个检查非空，缺失回 400。
 * - `mapData`：可选，从上游 data 里再取一层（如 process 取 list[0]）；默认原样透传。
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
      if (!res.headersSent) {
        res.setHeader('Content-Type', resp.headers['content-type'] || 'application/octet-stream');
        if (resp.headers['content-disposition']) {
          res.setHeader('Content-Disposition', resp.headers['content-disposition']);
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
