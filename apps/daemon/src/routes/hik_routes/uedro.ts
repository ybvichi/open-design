import type { Express } from 'express';
import { rawRequest } from '../../http/http.js';
import { readSsoConfigFile } from '../../http/hik_logins/hicoo.js';
import { UEDRO_BASE, UEDRO_LOGIN_URL,uedroHeaders } from '../../http/hik_logins/uedro.js';

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
         *  "3" 文稿评审; "5" 海客评审; "10" 插件评审; "11" Pixso Handoff;
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
}
