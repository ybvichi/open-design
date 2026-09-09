import { getSharedSpaceTeamId, getSharedSpaceMemberId, getCollaboratorMemberId } from '../ids.js';
import { UA, type Cookie } from './http.js';
import { readSsoConfigFile } from './hik_logins/hicoo.js';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';

const PROD_HDW_BASE = 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw/api';
const DEV_HDW_BASE = 'http://127.0.0.1:7002/hdw/api';
export const HDW_BASE = process.env.NODE_ENV === 'production' ? PROD_HDW_BASE : DEV_HDW_BASE;

interface HdwResponse<T> {
  code: number;
  msg: string;
  data?: T;
  error?: string;
}

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
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] GET ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] GET ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(`[hdw] GET ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export async function hdwPost<T>(
  path: string,
  body: Record<string, unknown>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] POST ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] POST ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(`[hdw] POST ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export async function hdwPutRaw(
  path: string,
  body: Buffer,
  cookies?: Cookie[],
): Promise<boolean> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'PUT', headers, body });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

export interface HdwCommunityPublishInput {
  name: string;
  version: string;
  archiveDigest: string;
  archiveSize?: number;
  archiveIntegrity?: string;
  manifestDigest?: string;
  prompt?: string;
  title?: string;
  titleI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
  icon?: string;
  tags?: string[];
  capabilitiesSummary?: string[];
  coverDigest?: string;
  homepage?: string;
  license?: string;
  publisherUsername: string;
  publisherDisplayname?: string;
  publisherGithub?: string;
  publisherUrl?: string;
  changelog?: string;
}

export interface HdwCommunityPublishResult {
  pluginId: string;
  versionId: string;
  name: string;
  version: string;
}

export async function uploadHdwCommunityBlob(
  archivePath: string,
  dataDir: string,
): Promise<{ digest: string; size: number } | null> {
  const session = readSsoConfigFile(dataDir);
  let data: Buffer;
  try {
    data = await fsp.readFile(archivePath);
  } catch {
    return null;
  }
  const digest = createHash('sha256').update(data).digest('hex');
  const ok = await hdwPutRaw(`/community/blobs/${digest}`, data, session?.cookies);
  if (!ok) return null;
  return { digest, size: data.length };
}

export interface HdwPublishDetail {
  ok: boolean;
  result?: HdwCommunityPublishResult;
  errorCode?: number;
  errorMsg?: string;
}

export async function publishHdwCommunityPluginDetailed(
  input: HdwCommunityPublishInput,
  dataDir: string,
): Promise<HdwPublishDetail> {
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/community/plugins`);
    const bodyStr = JSON.stringify(input);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr });
    if (!resp.ok) {
      return { ok: false, errorMsg: `HTTP ${resp.status} ${resp.statusText}` };
    }
    const json = (await resp.json()) as HdwResponse<HdwCommunityPublishResult>;
    if (json.code !== 0 || !json.data) {
      return { ok: false, errorCode: json.code, errorMsg: json.error || json.msg || 'unknown HDW error' };
    }
    return { ok: true, result: json.data };
  } catch (err) {
    return { ok: false, errorMsg: `network error: ${(err as Error).message}` };
  }
}

export interface HdwCommunityPluginDetail {
  version: string;
}

export async function fetchHdwCommunityPluginDetail(
  name: string,
  dataDir: string,
): Promise<HdwCommunityPluginDetail | null> {
  const session = readSsoConfigFile(dataDir);
  return hdwGet<HdwCommunityPluginDetail>(
    `/community/plugins/${encodeURIComponent(name)}`,
    undefined,
    session?.cookies,
  );
}

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

export async function fetchHdwTeams(dataDir: string | undefined): Promise<HdwTeam[]> {
  if (!dataDir) return [];
  const session = readSsoConfigFile(dataDir);
    const username = session?.username?.trim() ?? '';
  if (!username) return [];
  const data = await hdwGet<{ teams: HdwTeam[] }>('/team/my', { username }, session?.cookies);
  return data?.teams ?? [];
}

export interface HdwSharedSpaceInfo {
  workspace_id: string;
  workspace_name: string;
  workspace_type: string;
  workspace_member_id: string;
  collaborator_member_id: string;
  role: string;
}

export interface HdwSharedWithMeProject {
  shareId: string;
  projectId: string;
  homeWorkspaceId: string;
  sharedByUsername: string;
  sharedAt: string;
  resourceId: string | null;
  ownerMemberId: string | null;
  displayName: string | null;
  syncState: string;
 folderId: string | null;
 metadata: Record<string, unknown> | null;
 lastSyncedVersionId: string | null;
 access: {
    canView: boolean;
    canComment: boolean;
    canEdit: boolean;
    frozen: boolean;
  };
}

export async function fetchSharedSpaceInfo(
  dataDir: string | undefined,
): Promise<HdwSharedSpaceInfo | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return null;
  const displayName =
    typeof session?.userInfo?.displayName === 'string'
      ? session.userInfo.displayName.trim()
      : '';
  const email =
    typeof session?.userInfo?.email === 'string'
      ? session.userInfo.email.trim()
      : '';
  const params: Record<string, string> = { username };
  if (displayName) params.displayname = displayName;
  if (email) params.email = email;
  const cloud = await hdwGet<HdwSharedSpaceInfo>('/shared-space/info', params, session?.cookies);
  if (cloud) return cloud;
  return {
    workspace_id: getSharedSpaceTeamId(),
    workspace_name: '共享空间',
    workspace_type: 'team',
    workspace_member_id: getSharedSpaceMemberId(username),
    collaborator_member_id: getCollaboratorMemberId(username),
    role: 'member',
  };
}

export async function fetchSharedWithMe(
  dataDir: string | undefined,
): Promise<HdwSharedWithMeProject[]> {
  if (!dataDir) return [];
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return [];
  const data = await hdwGet<{ projects: HdwSharedWithMeProject[] }>(
    '/shared-space/shared-with-me',
    { username },
    session?.cookies,
  );
  return data?.projects ?? [];
}

export async function shareToSharedSpace(
  dataDir: string | undefined,
  input: {
    projectId: string;
    homeWorkspaceId: string;
    createdByUsername: string;
    recipients: Array<{ username: string; displayname?: string }>;
    displayName?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{ shared: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ shared: number; skipped: number }>(
    '/shared-space/share',
    {
      project_id: input.projectId,
      home_workspace_id: input.homeWorkspaceId,
      created_by_username: input.createdByUsername,
      recipients: input.recipients,
      ...(input.displayName ? { display_name: input.displayName } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    session?.cookies,
  );
}

export async function unshareFromSharedSpace(
  dataDir: string | undefined,
  shareId: string,
): Promise<boolean> {
  if (!dataDir) return false;
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/shared-space/${encodeURIComponent(shareId)}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'DELETE', headers });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

export async function downloadHdwCommunityArchive(
  name: string,
  version: string,
  dataDir: string,
): Promise<Buffer | null> {
  try {
    const session = readSsoConfigFile(dataDir);
    const archivePath = `/community/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/archive`;
    const url = new URL(HDW_BASE + archivePath);
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(cook => `${cook.name}=${cook.value}`).join('; ');
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

export const HDW_MARKETPLACE_ID = 'hdw-community';
export const HDW_MARKETPLACE_PATH = '/community/marketplace';
export const HDW_MARKETPLACE_URL = `${HDW_BASE}${HDW_MARKETPLACE_PATH}`;

export async function fetchHdwMarketplaceManifestText(
  url: string,
  dataDir: string,
): Promise<string | null> {
  if (!url.startsWith(HDW_BASE)) return null;
  const hdwPath = url.slice(HDW_BASE.length);
  const session = readSsoConfigFile(dataDir);
  const manifest = await hdwGet<unknown>(hdwPath, undefined, session?.cookies);
  if (!manifest) return null;
  return JSON.stringify(manifest);
}
