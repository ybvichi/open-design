import { UA, type Cookie } from './http.js';
import { readSsoConfigFile } from './hik_logins/hicoo.js';

/**
 * HDW (Hidesign-Web) API client.
 *
 * Upstream base URLs match the proxy in `routes/hik/_routes/hdw.ts`:
 *   dev  → http://127.0.0.1:7002/hdw/webapi/v1
 *   prod → https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/webapi/v1
 */

const PROD_HDW_BASE = 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/webapi/v1';
const DEV_HDW_BASE = 'http://127.0.0.1:7002/hdw/webapi/v1';
const HDW_BASE = process.env.NODE_ENV === 'production' ? PROD_HDW_BASE : DEV_HDW_BASE;

/** Standard HDW API response envelope. */
interface HdwResponse<T> {
  code: number;
  msg: string;
  data?: T;
  error?: string;
}

/**
 * Generic HDW API GET request.
 *
 * Builds the full URL from `HDW_BASE + path`, attaches SSO cookies for auth,
 * and returns the parsed `data` field on success (`code === 0`).
 * Returns `null` on any error (network, non-200, invalid JSON, error code).
 */
export async function hdwGet<T>(
  path: string,
  params?: Record<string, string>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

// --- Team APIs -----------------------------------------------------------

export interface HdwTeam {
  workspace_id: string;
  workspace_name: string;
  workspace_member_id: string;
  owner_username: string;
  owner_displayname: string;
  created_at: string;
  role: string;
  joined_at: string;
}

/**
 * Fetch the current user's team list from HDW `GET /team/my`.
 * Returns an empty array on any error or when there is no SSO session.
 */
export async function fetchHdwTeams(dataDir: string | undefined): Promise<HdwTeam[]> {
  if (!dataDir) return [];
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return [];
  const data = await hdwGet<{ teams: HdwTeam[] }>('/team/my', { username }, session?.cookies);
  return data?.teams ?? [];
}
