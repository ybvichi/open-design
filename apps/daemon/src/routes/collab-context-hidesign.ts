import type { Express, Request, Response } from 'express';
import { getDefaultTeamId, getTeamMemberId, getSharedSpaceMemberId, getSharedSpaceTeamId } from '../ids.js';
import {
  fetchHdwTeams,
  fetchSharedSpaceInfo,
  fetchSharedWithMe,
  hdwGet,
  shareToSharedSpace,
  unshareFromSharedSpace,
} from '../http/hdw.js';
import { readSsoConfigFile } from '../http/hik_logins/hicoo.js';
import type { VelaTeamProjectCatalog } from '../collab/vela-cli-team-projects.js';
import type { ResourceHubPrincipal } from '../collab/resource-principal.js';
import type { TeamProject } from '@open-design/contracts';
import type { SqliteDb } from '../db.js';

/**
 * Mock mirror of workspace collab-context routes.
 *
 * Returns canned mock data for `/api/workspace/directory`,
 * `/api/workspace/context`, `/api/workspace/billing`, and
 * `/api/workspace/events` so the web client resolves a non-null
 * `context` and `accountFooterState` stays `'hidden'` (logged-in,
 * no sync/recovery/sign-in tips).
 *
 * Registered before `registerCollabContextRoutes` so Express matches
 * the mock routes first, overriding the real collab-context handlers.
 */

export interface RegisterCollabContextHideSignRoutesDeps {
  env?: NodeJS.ProcessEnv;
  /** Daemon data root — used to read the SSO session for display-name injection. */
  dataDir?: string;
  /** HDW HTTP team project catalog — when present, `/api/workspace/projects/team`
   *  queries the real HDW database instead of returning an empty array. */
  hdwTeamProjectCatalog?: VelaTeamProjectCatalog | null;
  /** Local SQLite database — used to enrich the HDW catalog's stale
   *  `ownerMemberId` with the local DB's authoritative
   *  `created_by_workspace_member_id` after cross-workspace transfers. */
  db?: SqliteDb | null;
  /** Publishes a project to the team resource hub before sharing. Best-effort:
   *  wrapped in try/catch so a hub failure does not block the HDW share write. */
  requestTeamShare?: (projectId: string, share?: string | ResourceHubPrincipal) => Promise<{ version: number | null; versionId?: string }>;
}

interface HdwFolderProjectRow {
  folder_id: string | null;
  project_id: string;
}

/**
 * Fetch project IDs for a folder via the HDW api `folder/project/list`
 * endpoint. The HDW cloud team-projects catalog does not return `folder_id`,
 * so this is the authoritative source for folder-project associations.
 *
* `folderId = 'root'` queries root-level projects (folder_id IS NULL).
* Returns a Set of project IDs that belong to the folder.
*/
async function fetchFolderProjectIds(
  dataDir: string | undefined,
  workspaceId: string,
  folderId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    if (!dataDir) return ids;
    const session = readSsoConfigFile(dataDir);
    const username = session?.username?.trim() ?? '';
    if (!username) return ids;
    const data = await hdwGet<{ projects: HdwFolderProjectRow[] }>(
      '/folder/project/list',
      { workspace_id: workspaceId, folder_id: folderId },
      session?.cookies,
    );
    if (!data?.projects) return ids;
    for (const row of data.projects) {
      if (typeof row.project_id === 'string') ids.add(row.project_id);
    }
  } catch {
    // Best-effort: folder filtering must not break the project list.
  }
 return ids;
}

/**
 * Recursively list ALL folders in a workspace (root + nested) and collect
 * every project ID that lives in any folder. Used to compute root-level
 * projects (folder_id IS NULL) as the set difference: catalog projects
 * NOT in any folder. The HDW `folder/project/list?folder_id=root` endpoint
 * returns empty, so root must be derived by exclusion.
 */
async function fetchAllFolderProjectIds(
  dataDir: string | undefined,
  workspaceId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!dataDir) return ids;
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return ids;
  const cookies = session?.cookies;
  const visited = new Set<string>();
  async function listFolderProjects(parentPid: string): Promise<void> {
    try {
      const data = await hdwGet<{ folders: Array<Record<string, unknown>> }>(
        '/folder/list',
        { workspace_id: workspaceId, folder_pid: parentPid },
        cookies,
      );
      if (!data?.folders) return;
      for (const folder of data.folders) {
        const folderId =
          (folder.folder_id as string | undefined) ??
          (folder.id as string | undefined) ??
          '';
        if (!folderId || visited.has(folderId)) continue;
        visited.add(folderId);
        // Collect projects directly inside this folder.
        try {
          const projData = await hdwGet<{ projects: HdwFolderProjectRow[] }>(
            '/folder/project/list',
            { workspace_id: workspaceId, folder_id: folderId },
            cookies,
          );
          if (projData?.projects) {
            for (const row of projData.projects) {
              if (typeof row.project_id === 'string') ids.add(row.project_id);
            }
          }
        } catch {
          // Best-effort: skip this folder's projects on error.
        }
        // Recurse into subfolders.
        await listFolderProjects(folderId);
      }
    } catch {
      // Best-effort: folder listing must not break the project list.
    }
  }
  await listFolderProjects('');
  return ids;
}

// --- Mock data -----------------------------------------------------------



const ALL_PERMISSIONS = {
  canManageMembers: true,
  canManageBilling: true,
  canInviteMembers: true,
  canManageAutoRecharge: true,
  canShareProjects: true,
  canWriteSyncedFiles: true,
  canViewWorkspaceSettings: true,
  canManageSharedResources: true,
};

function makeBilling(workspaceId: string, workspaceMemberId: string) {
  return {
    summary: {
      workspaceId: null,
      membershipTier: 'team_max',
      totalAvailableCredits: 999999999,
      subscriptionCredits: 999999999,
      rechargeCredits: 0,
      balanceUsd: '999999.0000',
      subscriptionStatus: 'active',
      availableActions: ['billing_portal', 'subscription_checkout'],
      workspaceBalance: {
        workspaceId,
        workspaceMemberId,
        balanceUsd: '999999.0000',
        billingScopeVersion: 2,
        expiresAt: null,
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
    },
    workspaceBalance: {
      workspaceId,
      workspaceMemberId,
      balanceUsd: '999999.0000',
      billingScopeVersion: 2,
      expiresAt: null,
      updatedAt: '2026-08-28T00:00:00.000Z',
    },
    workspaceRuntime: {
      workspaceId,
      workspaceMemberId,
      status: 'fresh',
      revision: '1',
      observedAt: '2026-08-28T00:00:00.000Z',
      softExpiresAt: null,
      hardExpiresAt: null,
      retryAt: null,
      errorCode: null,
      reason: 'explicit-billing-read',
      sourceGapDetected: false,
    },
  };
}

/**
 * Build mock workspace data from the SSO session so the personal workspace
 * carries the signed-in user's displayName and IDs derived from their username.
 * Team workspace data stays fixed.
 */
async function buildMockData(dataDir?: string) {

  // Fetch the shared space info from HDW (or local fallback).
  // All users are members of the shared space team.
  const sharedSpaceInfo = await fetchSharedSpaceInfo(dataDir);
  const SHARED_SPACE_ID = sharedSpaceInfo?.workspace_id || getSharedSpaceTeamId();
  const SHARED_SPACE_MEMBER_ID = sharedSpaceInfo?.workspace_member_id || getSharedSpaceMemberId();
  const SHARED_SPACE_NAME = sharedSpaceInfo?.workspace_name || '共享空间';

  const hdwTeams = await fetchHdwTeams(dataDir);

  const directory = {
    items: [
      {
        workspaceId: SHARED_SPACE_ID,
        workspaceName: SHARED_SPACE_NAME,
        workspaceIconKey: 'spark',
        workspaceType: 'team' as const,
        workspaceMemberId: SHARED_SPACE_MEMBER_ID,
        isDefaultTeam: true,
        role: 'member' as const,
        memberStatus: 'active' as const,
        lifecycleState: 'active' as const,
      },
      ...hdwTeams.map(t => ({
        workspaceId: t.workspace_id,
        workspaceName: t.workspace_name,
        workspaceType: 'team' as const,
        workspaceMemberId: t.workspace_member_id,
        role: t.role,
        memberStatus: 'active' as const,
        lifecycleState: 'active' as const,
      })),
    ],
    activeWorkspaceId: SHARED_SPACE_ID,
  };

  const contexts: Record<string, { context: Record<string, unknown> }> = {
    [SHARED_SPACE_ID]: {
      context: {
        workspaceId: SHARED_SPACE_ID,
        workspaceType: 'team',
        workspaceMemberId: SHARED_SPACE_MEMBER_ID,
        isDefaultTeam: true,
        role: 'member',
        memberStatus: 'active',
        lifecycleState: 'active',
        billingState: 'active',
        planId: 'team_max',
        providerMode: 'platform_credits',
        seatSummary: { seatLimit: 10, usedSeats: 1, availableSeats: 9, isSeatFull: false },
        permissions: ALL_PERMISSIONS,
        workspaceName: SHARED_SPACE_NAME,
        teamId: SHARED_SPACE_ID,
        teamName: SHARED_SPACE_NAME,
      },
    },
  };

  for (const t of hdwTeams) {
    const wsId = t.workspace_id;
    const wsMemberId = t.workspace_member_id;
    contexts[wsId] = {
      context: {
        workspaceId: wsId,
        workspaceType: 'team',
        workspaceMemberId: wsMemberId,
        role: t.role,
        memberStatus: 'active',
        lifecycleState: 'active',
        billingState: 'active',
        planId: 'team_max',
        providerMode: 'platform_credits',
        seatSummary: { seatLimit: 10, usedSeats: 1, availableSeats: 9, isSeatFull: false },
        permissions: ALL_PERMISSIONS,
        workspaceName: t.workspace_name,
        teamId: wsId,
        teamName: t.workspace_name,
      },
    };
  }

  const billing: Record<string, ReturnType<typeof makeBilling>> = {
    [SHARED_SPACE_ID]: makeBilling(SHARED_SPACE_ID, SHARED_SPACE_MEMBER_ID),
  };

  for (const t of hdwTeams) {
    const wsId = t.workspace_id;
    const wsMemberId = t.workspace_member_id;
    billing[wsId] = makeBilling(wsId, wsMemberId);
  }

  return { directory, contexts, billing };
}

// --- Helpers --------------------------------------------------------------

function logRequest(method: string, path: string, req: Request): void {
  const query = req.query as Record<string, unknown> | undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const params: Record<string, unknown> = {};
  if (query) Object.assign(params, query);
  if (body) Object.assign(params, body);
  console.log(`[collab-context-hidesign] ${method} ${path}`, params);
}

// --- Route registration ---------------------------------------------------

export function registerCollabContextHideSignRoutes(
  app: Express,
  deps: RegisterCollabContextHideSignRoutesDeps = {},
): void {
  app.get('/api/workspace/directory', async (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/directory', req);
    const { directory } = await buildMockData(deps.dataDir);
    res.json(directory);
  });

  app.get('/api/workspace/context', async (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/context', req);
    const { contexts } = await buildMockData(deps.dataDir);
    const wsId = req.header('x-od-workspace-id') ?? '';
    const ctx = contexts[wsId];
    res.json(ctx);
  });

  app.get('/api/workspace/billing', async (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/billing', req);
    const { billing } = await buildMockData(deps.dataDir);
    const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const entry = billing[wsId];
    res.json(entry);
  });

  app.put('/api/workspace/billing/interests/:clientId', (req: Request, res: Response) => {
    logRequest('PUT', '/api/workspace/billing/interests/:clientId', req);
    const clientId = req.params.clientId ?? '';
    const body = req.body as { generation?: unknown } | null;
    const generation = typeof body?.generation === 'string' ? body.generation.trim() : '0';
    res.json({
      clientId,
      acceptedGeneration: generation,
      leaseExpiresAt: '9999-12-31T23:59:59.000Z',
    });
  });
  app.delete('/api/workspace/billing/interests/:clientId', (req: Request, res: Response) => {
    logRequest('DELETE', '/api/workspace/billing/interests/:clientId', req);
    res.json({ ok: true, released: true });
  });

  app.put('/api/workspace/active', async (req: Request, res: Response) => {
    logRequest('PUT', '/api/workspace/active', req);
    const { contexts } = await buildMockData(deps.dataDir);
    const body = req.body as { workspaceId?: unknown; workspaceMemberId?: unknown } | null;
    const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const entry = contexts[wsId];
    if (!entry) {
      res.status(404).json({ error: 'workspace_not_visible' });
      return;
    }
    res.json({ activeWorkspaceId: wsId, context: entry.context });
  });

  app.get('/api/workspace/projects/team', async (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/projects/team', req);
    //res.json({ projects: [] });
    const catalog = deps.hdwTeamProjectCatalog;
    if (!catalog) {
      res.json({ projects: [] });
      return;
    }
    const wsId = req.header('x-od-workspace-id') ?? '';
    if (!wsId) {
      res.json({ projects: [] });
      return;
    }
    // 可选 folder_id 过滤:
    //   不传          → 全部项目
    //   folder_id=xxx → 该文件夹下的项目
    //   folder_id=root → 根目录项目 (folder_id IS NULL)
    //
    // The HDW cloud team-projects API does not support folder_id filtering
    // and does not return folder_id on project records. When a folder_id is
    // requested, fetch the authoritative folder-project associations from
    // the HDW api folder/project/list endpoint and filter server-side so
    // the frontend never needs to load the entire workspace catalog.
    const folderFilter = typeof req.query.folder_id === 'string'
      ? req.query.folder_id
      : undefined;
    let projects: TeamProject[];
    try {
      projects = await catalog.list(wsId);
    } catch {
      res.status(503).json({
        error: 'UPSTREAM_UNAVAILABLE',
        message: 'team project catalog is temporarily unavailable',
        retryable: true,
      });
      return;
    }
   if (folderFilter !== undefined) {
      if (folderFilter === 'root') {
        // Root: projects NOT in any folder. The HDW api
        // `folder/project/list?folder_id=root` returns empty, so
        // root-level projects must be derived by exclusion — collect
        // every project ID that lives in any folder, then keep the
        // catalog projects that are NOT in that set.
        const allFolderProjectIds = await fetchAllFolderProjectIds(
          deps.dataDir,
          wsId,
        );
        projects = projects
          .filter((p) => !allFolderProjectIds.has(p.projectId))
          .map((p) => ({ ...p, folderId: null }));
      } else {
        const folderProjectIds = await fetchFolderProjectIds(
          deps.dataDir,
          wsId,
          folderFilter,
        );
        projects = projects
          .filter((p) => folderProjectIds.has(p.projectId))
          .map((p) => ({ ...p, folderId: folderFilter }));
      }
   }
    // The HDW cloud catalog ownerMemberId can be stale after a cross-workspace
    // transfer it still carries the personal-space member ID. The same user
    // has different member IDs across workspaces, so if ownerMemberId matches
    // the default-team (personal space) member ID, replace it with the current
    // user member ID in this workspace so the frontend correctly identifies
    // the owner.
    try {
      const defaultTeamId = getDefaultTeamId();
      const defaultMemberId = getTeamMemberId(defaultTeamId);
      if (defaultMemberId && wsId !== defaultTeamId) {
        const teams = await fetchHdwTeams(deps.dataDir);
        const wsMemberId = teams.find((t) => t.workspace_id === wsId)?.workspace_member_id;
        if (wsMemberId) {
          projects = projects.map((p) =>
            p.ownerMemberId === defaultMemberId
              ? { ...p, ownerMemberId: wsMemberId }
              : p,
          );
        }
      }
   } catch {
     // Best-effort: if the directory fetch fails, return the original data.
   }
   res.json({ projects });
});

  app.get('/api/workspace/events', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/events', req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    const ping = setInterval(() => {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }, 30_000);
    req.on('close', () => clearInterval(ping));
  });

  // --- Shared Space routes --------------------------------------------------
  //
  // These proxy the HDW shared-space endpoints so the web UI and `od` CLI
  // can share/unshare projects and read the shared-with-me catalog through
  // the daemon's authenticated SSO session.

  app.get('/api/shared-space/info', async (req: Request, res: Response) => {
    logRequest('GET', '/api/shared-space/info', req);
    try {
      const info = await fetchSharedSpaceInfo(deps.dataDir);
      if (!info) {
        res.status(502).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable' });
        return;
      }
      res.json(info);
    } catch (err) {
      console.warn('[collab-context-hidesign] GET /api/shared-space/info error', err);
      res.status(502).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable' });
    }
  });

  app.get('/api/workspace/projects/shared-with-me', async (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/projects/shared-with-me', req);
    try {
      const projects = await fetchSharedWithMe(deps.dataDir);
      res.json({ projects });
    } catch (err) {
      console.warn('[collab-context-hidesign] GET /api/workspace/projects/shared-with-me error', err);
      res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable', retryable: true });
    }
  });

  app.post('/api/shared-space/share', async (req: Request, res: Response) => {
    logRequest('POST', '/api/shared-space/share', req);
    const body = req.body as {
      project_id?: unknown;
      home_workspace_id?: unknown;
      recipients?: unknown;
    } | null;
    const projectId = typeof body?.project_id === 'string' ? body.project_id.trim() : '';
    const homeWorkspaceId = typeof body?.home_workspace_id === 'string' ? body.home_workspace_id.trim() : '';
    const recipients = Array.isArray(body?.recipients)
      ? body.recipients.filter(
          (r): r is { username: string; displayname?: string } =>
            r !== null && typeof r === 'object' && typeof (r as { username?: unknown }).username === 'string',
        )
      : [];
    if (!projectId || !homeWorkspaceId || recipients.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'project_id, home_workspace_id, and recipients are required' });
      return;
    }

    // Resolve the current user from the SSO session for the created_by field.
    let createdByUsername = '';
    let displayName: string | null = null;
    if (!deps.dataDir) {
      res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'data directory is not configured' });
      return;
    }
    try {
      const session = readSsoConfigFile(deps.dataDir);
      createdByUsername = session?.username?.trim() ?? '';
      if (session?.userInfo?.displayName) {
        displayName = session.userInfo.displayName.trim();
      }
    } catch {
      // Best-effort: share without display name if SSO read fails.
    }
    if (!createdByUsername) {
      res.status(401).json({ error: 'not_authenticated', message: 'SSO session is required to share' });
      return;
    }

    // Best-effort: publish the project to the team resource hub before
    // writing the HDW share record. A hub failure must not block the share.
    if (deps.requestTeamShare) {
      try {
        const sharePrincipal: ResourceHubPrincipal = {
          memberId: getSharedSpaceMemberId(createdByUsername),
          teamId: homeWorkspaceId,
          role: 'owner',
          lifecycleState: 'active',
          workspaceType: 'team',
        };
        await Promise.race([
          deps.requestTeamShare(projectId, sharePrincipal),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('requestTeamShare timeout')), 15_000),
          ),
        ]);
      } catch (err) {
        console.warn('[collab-context-hidesign] requestTeamShare best-effort failed', err);
      }
    }

    try {
      const result = await shareToSharedSpace(deps.dataDir, {
        projectId,
        homeWorkspaceId,
        createdByUsername,
        recipients,
        displayName,
      });
      if (result === null) {
        res.status(502).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable' });
        return;
      }
      res.json(result);
    } catch (err) {
      console.warn('[collab-context-hidesign] POST /api/shared-space/share error', err);
      res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable', retryable: true });
    }
  });

  app.delete('/api/shared-space/:shareId', async (req: Request, res: Response) => {
    logRequest('DELETE', '/api/shared-space/:shareId', req);
    const shareId = req.params.shareId ?? '';
    if (!shareId) {
      res.status(400).json({ error: 'invalid_request', message: 'shareId is required' });
      return;
    }
    try {
      const ok = await unshareFromSharedSpace(deps.dataDir, String(shareId));
      res.json({ ok });
    } catch (err) {
      console.warn('[collab-context-hidesign] DELETE /api/shared-space/:shareId error', err);
      res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'shared space server is unreachable', retryable: true });
    }
  });
}
