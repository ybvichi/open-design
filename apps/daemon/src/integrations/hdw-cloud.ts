// hdw cloud HTTP client — the transport layer for the hdw ResourceHub service.
//
// This mirrors the CollabCloudClient pattern: a factory with injectable
// fetch/config/timeout, env-scoped config (this file owns OD_HDW_* env vars),
// and a from-env constructor that always returns a usable client thanks to
// environment-aware defaults (mirroring the base-URL pattern in http/hdw.ts).
//
// Unlike the vela CLI transport which shells out to a binary, this talks
// directly to the hdw REST API. Auth is a bearer token (OD_HDW_API_TOKEN);
// workspace identity is carried as request headers so hdw can authorize
// per-workspace without a shared session.

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/**
 * Environment-aware default base URLs for the hdw ResourceHub API.
 * Mirrors the pattern in `http/hdw.ts`:
 *   dev  → http://127.0.0.1:7002
 *   prod → https://pixso.hikvision.com.cn/hik-plugin/hidesign-web
 *
 * The `pathPrefix` (default `/hdw`) is appended separately, so these base
 * URLs exclude the `/hdw` segment.
 */
const PROD_HDW_API_URL = 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web';
const DEV_HDW_API_URL = 'http://127.0.0.1:7002';

export interface HdwCloudConfig {
  baseUrl: string;
  token: string | null;
  /** Path prefix prepended to every request path. Defaults to '/hdw'. */
  pathPrefix?: string;
}

export function readHdwCloudConfig(
  env: NodeJS.ProcessEnv = process.env,
): HdwCloudConfig | null {
  const baseUrl = env.OD_HDW_API_URL?.trim()
    || (env.NODE_ENV === 'production' ? PROD_HDW_API_URL : DEV_HDW_API_URL);
  return {
    baseUrl,
    token: env.OD_HDW_API_TOKEN?.trim() || null,
    pathPrefix: env.OD_HDW_API_PREFIX?.trim() || '/hdw',
  };
}

export function hasExplicitHdwCloudConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.OD_HDW_API_URL?.trim());
}

export class HdwCloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `hdw cloud error ${status} (${code})`);
    this.name = 'HdwCloudError';
  }
}

export interface HdwCloudClientOptions {
  config?: HdwCloudConfig;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createHdwCloudClient(options: HdwCloudClientOptions = {}) {
  const config = options.config ?? readHdwCloudConfig();
  if (!config) {
    throw new Error('hdw cloud is not configured (OD_HDW_API_URL is unset)');
  }
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const pathPrefix = config!.pathPrefix ?? '/hdw';

  /** Prepend the configured path prefix to a request path. */
  function prefixedPath(path: string): string {
    return pathPrefix + path;
  }

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...extra,
    };
    if (config!.token) headers.authorization = `Bearer ${config!.token}`;
    return headers;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; payload: T; etag: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
   try {
      const response = await fetchImpl(new URL(prefixedPath(path), config!.baseUrl), {
        method,
        headers: authHeaders(extraHeaders),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const etag = response.headers.get('etag');
      if (response.status === 304) {
        return { status: 304, payload: {} as T, etag };
      }
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const code = typeof payload?.error === 'string' ? payload.error : 'unknown';
        throw new HdwCloudError(response.status, code, payload?.message);
      }
      return { status: response.status, payload: payload as T, etag };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    isConfigured(): boolean {
      return true;
    },

    get baseUrl(): string {
      return config!.baseUrl;
    },

    /** Raw request escape hatch for adapter-level callers. */
    request,

    /** Upload a manifest + missing blobs and advance the published ref. */
    async publishResource(
      workspaceId: string,
      resourceId: string,
      body: {
        kind: string;
        manifest: HdwManifest;
        metadata?: Record<string, unknown> | null;
        ref?: string;
        ownerMemberId?: string;
      },
    ): Promise<HdwPublishResult> {
      const { payload } = await request<HdwPublishResult>(
        'PUT',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/versions`,
        body,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload;
    },

    /** Read the published head version without downloading content. */
    async getPublishedHead(
      workspaceId: string,
      resourceId: string,
      ref = 'published',
    ): Promise<HdwVersionHead | null> {
      try {
        const { payload } = await request<HdwVersionHead>(
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/refs/${encodeURIComponent(ref)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Materialize the published tree into the caller's local copy. */
    async pullResource(
      workspaceId: string,
      resourceId: string,
      ref = 'published',
    ): Promise<HdwPullResult | null> {
      try {
        const { payload } = await request<HdwPullResult>(
          'POST',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/materialize`,
          { ref },
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Soft-delete a resource (tombstone). */
    async removeResource(workspaceId: string, resourceId: string): Promise<void> {
      try {
        await request<void>(
          'DELETE',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return;
        throw error;
      }
    },

    /** Upload a single blob by digest (raw body). */
    async uploadBlob(workspaceId: string, digest: string, data: Buffer): Promise<void> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
      const response = await fetchImpl(
        new URL(
          prefixedPath(`/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(digest)}`),
          config!.baseUrl,
        ),
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-hdw-workspace-id': workspaceId,
            ...(config!.token ? { authorization: `Bearer ${config!.token}` } : {}),
          },
          body: data,
          signal: controller.signal,
        },
      );
        if (!response.ok) {
          const text = await response.text();
          let code = 'unknown';
          try {
            const payload = JSON.parse(text);
            code = typeof payload?.error === 'string' ? payload.error : 'unknown';
          } catch {
            // keep default
          }
          throw new HdwCloudError(response.status, code, text);
        }
      } finally {
        clearTimeout(timeout);
      }
    },

    /** Download a single blob by digest. Returns the raw bytes. */
    async downloadBlob(workspaceId: string, digest: string): Promise<Buffer> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
      const response = await fetchImpl(
        new URL(
          prefixedPath(`/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(digest)}`),
          config!.baseUrl,
        ),
        {
          method: 'GET',
          headers: {
            'x-hdw-workspace-id': workspaceId,
            ...(config!.token ? { authorization: `Bearer ${config!.token}` } : {}),
          },
          signal: controller.signal,
        },
      );
        if (!response.ok) {
          throw new HdwCloudError(response.status, 'blob_fetch_failed');
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } finally {
        clearTimeout(timeout);
      }
    },

    /** List team projects for a workspace. */
    async listTeamProjects(workspaceId: string): Promise<HdwTeamProjectRecord[]> {
      const { payload } = await request<{ projects: HdwTeamProjectRecord[] }>(
        'GET',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects`,
        undefined,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload.projects ?? [];
    },

    /** Get a single team project. */
    async getTeamProject(
      workspaceId: string,
      projectId: string,
    ): Promise<HdwTeamProjectRecord | null> {
      try {
        const { payload } = await request<HdwTeamProjectRecord>(
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Upsert a team project catalog entry. */
    async upsertTeamProject(
      workspaceId: string,
      projectId: string,
      input: HdwUpsertTeamProjectInput,
    ): Promise<HdwTeamProjectRecord | null> {
      const { payload } = await request<HdwTeamProjectRecord>(
        'PUT',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
        input,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload;
    },

    /** Remove a team project catalog entry. */
    async removeTeamProject(workspaceId: string, projectId: string): Promise<void> {
      try {
        await request<void>(
          'DELETE',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return;
        throw error;
      }
    },

    /**
     * Transfer a project from one workspace to another. This is a metadata
     * operation: blobs stay where they are, only the resource and catalog
     * rows move.
     */
    async transferProject(
      sourceWorkspaceId: string,
      projectId: string,
      targetWorkspaceId: string,
    ): Promise<HdwTransferResult> {
      const { payload } = await request<HdwTransferResult>(
        'POST',
        `/api/workspaces/${encodeURIComponent(sourceWorkspaceId)}/team-projects/${encodeURIComponent(projectId)}/transfer`,
        { targetWorkspaceId },
        { 'x-hdw-workspace-id': sourceWorkspaceId },
      );
      return payload;
    },
  };
}

export type HdwCloudClient = ReturnType<typeof createHdwCloudClient>;

/** Build the client from env, or null when hdw cloud is not configured. */
export function createHdwCloudClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HdwCloudClient | null {
  const config = readHdwCloudConfig(env);
  if (!config) return null;
  return createHdwCloudClient({ config });
}

// ---- Wire types for hdw REST API ----

export interface HdwManifestEntry {
  path: string;
  digest: string;
  size: number;
  mode?: number;
}

export interface HdwManifest {
  entries: HdwManifestEntry[];
}

export interface HdwPublishResult {
  version: number;
  versionId: string;
  missingBlobs: string[];
}

export interface HdwVersionHead {
  version: number;
  versionId: string;
}

export interface HdwPullResult {
  version: number;
  versionId: string;
  manifest: HdwManifest;
  missingBlobs: string[];
}

export interface HdwTeamProjectRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  resourceId: string;
  ownerMemberId: string;
  displayName: string | null;
  syncState: string;
  lastSyncedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  access?: {
    canView: boolean;
    canComment: boolean;
    canEdit: boolean;
    frozen: boolean;
  };
  metadata?: Record<string, unknown> | null;
}

export interface HdwUpsertTeamProjectInput {
  resourceId: string;
  displayName?: string | null;
  syncState?: string;
  lastSyncedVersionId?: string | null;
  metadata?: Record<string, unknown> | null;
  ownerMemberId?: string;
}

export interface HdwTransferResult {
  resourceId: string;
  workspaceId: string;
  version: number;
  versionId: string;
}
