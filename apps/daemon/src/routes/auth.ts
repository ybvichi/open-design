import type { Express } from 'express';
import type { LoginRequest, LoginResponse, LogoutResponse, GetUserNameResponse } from '@open-design/contracts';
import type { Cookie } from '../http/http.js';
import {
  readSsoConfigFile,
  writeSsoConfigFile,
  removeSsoConfigFile,
  hicooLogin,
  hicooLogout,
  hicooValidate,
  type SsoSession,
} from '../http/hiktools/hicoo.js';

/**
 * Web login gate endpoint.
 *
 * The daemon is the single source of truth for the web login credential
 * check. Credentials are validated against one configured account:
 * `OD_WEB_USERNAME` / `OD_WEB_PASSWORD`, defaulting to `admin` / `admin123`.
 * This endpoint intentionally is NOT behind `requireLocalDaemonRequest` — the
 * web app must reach it from the browser before the gate has been passed.
 */

export const DEFAULT_WEB_USERNAME = 'admin';
export const DEFAULT_WEB_PASSWORD = 'admin123';

export interface RegisterAuthRoutesDeps {
  env: NodeJS.ProcessEnv;
  sendApiError: (...args: any[]) => any;
  dataDir: string;
  FOR_DESIGNER_DIR?: string;
}

export function registerAuthRoutes(app: Express, deps: RegisterAuthRoutesDeps): void {
  const { env, sendApiError, dataDir, FOR_DESIGNER_DIR } = deps;
  const expectedUsername = (env.OD_WEB_USERNAME ?? '').trim() || DEFAULT_WEB_USERNAME;
  const expectedPassword = env.OD_WEB_PASSWORD ?? DEFAULT_WEB_PASSWORD;

  function getSsoCookie(): SsoSession {
    const session = readSsoConfigFile(dataDir);
    if (!session) return {};
    return session;
  }

  function setSsoSession(username: string, userInfo?: any, cookies?: Cookie[]) {
    writeSsoConfigFile(dataDir, {
      cookies: cookies || [],
      username: username,
      userInfo,
      loginAt: Date.now(),
    }, FOR_DESIGNER_DIR);
  }

  function clearSsoSession() {
    removeSsoConfigFile(dataDir);
  }

  app.post('/api/auth/login', async (req, res) => {
    const body = (req.body ?? {}) as Partial<LoginRequest>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'username and password are required');
    }

    // 2. 尝试海康 SSO 登录
    try {
      const result = await hicooLogin(username, password);

      // 将 SSO cookie 存入内存
      setSsoSession(result.username, result.userInfo, result.cookies);

      const response: LoginResponse = { ok: true, username: result.username };
      res.json(response);
    } catch (err: any) {
      if (err.message === 'SSO login page unavailable') {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'SSO login page unavailable');
      }
      if (err.message === 'SSO form fields not found') {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'SSO form fields not found');
      }
      if (err.message === 'invalid username or password') {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'invalid username or password');
      }
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'SSO login failed');
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const session = getSsoCookie();
      // 先清除本地 session（无论 SSO 退出是否成功，本地都必须清掉）
      clearSsoSession();

      await hicooLogout(session);

      const response: LogoutResponse = { ok: true };
      return res.json(response);
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'SSO logout failed');
    }
  });

  // GET /api/auth/valid — 验证海康 SSO 登录状态
  // 通过访问 https://oa.hikvision.com.cn/ 判断是否跳转到登录页来验证会话是否有效
  app.get('/api/auth/valid', async (req, res) => {
    try {
      const session = getSsoCookie();
      const result = await hicooValidate(session, dataDir, FOR_DESIGNER_DIR);

      if (!result.ok) {
        // 会话失效，清除本地 session
        clearSsoSession();
        const response: GetUserNameResponse = { ok: false, username: result.username || '' };
        return res.json(response);
      }

      // 会话有效
      const response: any = {
        ok: true,
        username: result.username,
        userInfo: result.userInfo,
        cache: result.cache,
      };
      return res.json(response);
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'auth valid failed');
    }
  });
}
