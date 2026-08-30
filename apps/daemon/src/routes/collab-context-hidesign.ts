import type { Express, Request, Response } from 'express';
import { generateDeterministicId } from '../ids.js';
import { getSsoUser } from '../sso-user.js';

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
function buildMockData(dataDir?: string) {
  const user = getSsoUser(dataDir);
  const username = user?.username ?? '';
  const displayName = user?.displayName ?? '';

  const seed = username || 'mock-personal-workspace';
  const personalWorkspaceId = generateDeterministicId(`${seed}-workspace-id`);
  const personalMemberId = generateDeterministicId(`${seed}-member-id`);
  const personalWorkspaceName = (displayName + '的地盘') || "ybvichi's workspace";

  const TEAM_WORKSPACE_ID = generateDeterministicId(`one-persion-team-workspace-id-${seed}`);
  const TEAM_WORKSPACE_MEMBER_ID = generateDeterministicId(TEAM_WORKSPACE_ID);
  const MOCK_TEAM_WORKSPACE_NAME = '一人团队';

  const TEAM_WORKSPACE_ID2 = generateDeterministicId(`new-team-workspace-id-${seed}`);
  const TEAM_WORKSPACE_MEMBER_ID2 = generateDeterministicId(TEAM_WORKSPACE_ID2);
  const MOCK_TEAM_WORKSPACE_NAME2 = '测试团队';

  const directory = {
    items: [
      // {
      //   workspaceId: personalWorkspaceId,
      //   workspaceName: personalWorkspaceName,
      //   workspaceType: 'personal' as const,
      //   workspaceMemberId: personalMemberId,
      //   role: 'owner' as const,
      //   memberStatus: 'active' as const,
      //   lifecycleState: 'active' as const,
      // },
      {
        workspaceId: TEAM_WORKSPACE_ID,
        workspaceName: MOCK_TEAM_WORKSPACE_NAME,
        workspaceIconKey: 'spark',
        workspaceType: 'team' as const,
        workspaceMemberId: TEAM_WORKSPACE_MEMBER_ID,
        isDefaultTeam: true,
        role: 'owner' as const,
        memberStatus: 'active' as const,
        lifecycleState: 'active' as const,
      },
      {
        workspaceId: TEAM_WORKSPACE_ID2,
        workspaceName: MOCK_TEAM_WORKSPACE_NAME2,
        workspaceType: 'team',
        workspaceMemberId: TEAM_WORKSPACE_MEMBER_ID2,
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
      }
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
        workspaceType: 'team',
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
    [TEAM_WORKSPACE_ID2]: {
      context: {
        workspaceId: TEAM_WORKSPACE_ID2,
        workspaceType: 'team',
        workspaceMemberId: TEAM_WORKSPACE_MEMBER_ID2,
        role: 'owner',
        memberStatus: 'active',
        lifecycleState: 'active',
        billingState: 'active',
        planId: 'team_max',
        providerMode: 'platform_credits',
        seatSummary: { seatLimit: 10, usedSeats: 1, availableSeats: 9, isSeatFull: false },
        permissions: ALL_PERMISSIONS,
        workspaceName: MOCK_TEAM_WORKSPACE_NAME2,
        teamId: TEAM_WORKSPACE_ID,
        teamName: MOCK_TEAM_WORKSPACE_NAME2,
        //workspaceSettingsUrl: 'https://amr-api.open-design.ai/team/settings',
      },
    },
  };

  const billing: Record<string, ReturnType<typeof makeBilling>> = {
    [personalWorkspaceId]: makeBilling(personalWorkspaceId, personalMemberId),
    [TEAM_WORKSPACE_ID]: makeBilling(TEAM_WORKSPACE_ID, TEAM_WORKSPACE_MEMBER_ID),
  };

  return { directory, contexts, billing, personalWorkspaceId };
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
  app.get('/api/workspace/directory', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/directory', req);
    const { directory } = buildMockData(deps.dataDir);
    res.json(directory);
  });

  app.get('/api/workspace/context', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/context', req);
    const { contexts, personalWorkspaceId } = buildMockData(deps.dataDir);
    const wsId = req.header('x-od-workspace-id') ?? '';
    const ctx = contexts[wsId] ?? contexts[personalWorkspaceId];
    res.json(ctx);
  });

  app.get('/api/workspace/billing', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/billing', req);
    const { billing, personalWorkspaceId } = buildMockData(deps.dataDir);
    const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const entry = billing[wsId] ?? billing[personalWorkspaceId];
    res.json(entry);
  });

  app.put('/api/workspace/active', (req: Request, res: Response) => {
    logRequest('PUT', '/api/workspace/active', req);
    const { contexts } = buildMockData(deps.dataDir);
    const body = req.body as { workspaceId?: unknown; workspaceMemberId?: unknown } | null;
    const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const entry = contexts[wsId];
    if (!entry) {
      res.status(404).json({ error: 'workspace_not_visible' });
      return;
    }
    res.json({ activeWorkspaceId: wsId, context: entry.context });
  });

  app.get('/api/workspace/projects/team', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/projects/team', req);
    res.json({ projects: [] });
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
