import type { Express, Request, Response } from 'express';
import { getDefaultTeamId, getTeamMemberId } from '../ids.js';
import { fetchHdwTeams, hdwGet } from '../http/hdw.js';
import { readSsoConfigFile } from '../http/hik_logins/hicoo.js';
import type { VelaTeamProjectCatalog } from '../collab/vela-cli-team-projects.js';
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
}

interface HdwFolderProjectRow {
  folder_id: string | null;
  project_id: string;
}

/**
 * Fetch project IDs for a folder via the HDW webapi `folder/project/list`
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


  const TEAM_WORKSPACE_ID = getDefaultTeamId();
  const TEAM_WORKSPACE_MEMBER_ID = getTeamMemberId(TEAM_WORKSPACE_ID);
  const MOCK_TEAM_WORKSPACE_NAME = '个人空间';

  const hdwTeams = await fetchHdwTeams(dataDir);

  const directory = {
    items: [
      {
        workspaceId: TEAM_WORKSPACE_ID,
        workspaceName: MOCK_TEAM_WORKSPACE_NAME,
        workspaceIconKey: 'spark',
        workspaceType: 'personal' as const,
        workspaceMemberId: TEAM_WORKSPACE_MEMBER_ID,
        isDefaultTeam: true,
        role: 'owner' as const,
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
    activeWorkspaceId: TEAM_WORKSPACE_ID,
  };

  const contexts: Record<string, { context: Record<string, unknown> }> = {
    // [personalWorkspaceId]: {
    //   context: {
    //     workspaceId: personalWorkspaceId,
    //     workspaceType: 'personal',
    //     workspaceMemberId: personalMemberId,
    //     role: 'owner',
    //     memberStatus: 'active',
    //     lifecycleState: 'active',
    //     billingState: 'active',
    //     planId: 'team_max',
    //     providerMode: 'platform_credits',
    //     seatSummary: { seatLimit: 1, usedSeats: 1, availableSeats: 0, isSeatFull: true },
    //     permissions: ALL_PERMISSIONS,
    //     workspaceName: personalWorkspaceName,
    //   },
    // },
   [TEAM_WORKSPACE_ID]: {
     context: {
       workspaceId: TEAM_WORKSPACE_ID,
       workspaceType: 'personal',
       workspaceMemberId: TEAM_WORKSPACE_MEMBER_ID,
       isDefaultTeam: true,
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
        billingState: 'active',
        planId: 'team_max',
        providerMode: 'platform_credits',
        seatSummary: { seatLimit: 10, usedSeats: 1, availableSeats: 9, isSeatFull: false },
        permissions: ALL_PERMISSIONS,
        workspaceName: MOCK_TEAM_WORKSPACE_NAME,
        teamId: TEAM_WORKSPACE_ID,
        teamName: MOCK_TEAM_WORKSPACE_NAME,
        //workspaceSettingsUrl: 'https://amr-api.open-design.ai/team/settings',
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
    [TEAM_WORKSPACE_ID]: makeBilling(TEAM_WORKSPACE_ID, TEAM_WORKSPACE_MEMBER_ID),
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
    // the HDW webapi folder/project/list endpoint and filter server-side so
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
        // Root: projects NOT in any folder. The HDW webapi
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
}
