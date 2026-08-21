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
        processType: typeof body.processType === 'number' ? body.processType : 0,
        reviewModel: typeof body.reviewModel === 'number' ? body.reviewModel : 0,
        reviewType: typeof body.reviewType === 'string' ? body.reviewType : '',
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
}
