import type { Express, Request, Response } from 'express';

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
}

// --- Mock data -----------------------------------------------------------

const MOCK_WORKSPACE_ID = 'tljbioajfmjv52wm1h86ybow';
const MOCK_WORKSPACE_MEMBER_ID = 'ahcneo83tesu0t0ntulp2n4f';
const MOCK_WORKSPACE_NAME = "ybvichi's workspace";

const MOCK_TEAM_WORKSPACE_ID = 'ww9pzftmmqux8grn4im25v94';
const MOCK_TEAM_WORKSPACE_MEMBER_ID = 'su4iqloxqpvz32izn8ibnnlq';
const MOCK_TEAM_WORKSPACE_NAME = '测试团队';

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

const MOCK_WORKSPACE_DIRECTORY = {
  items: [
    {
      workspaceId: MOCK_WORKSPACE_ID,
      workspaceName: MOCK_WORKSPACE_NAME,
      workspaceType: 'personal' as const,
      workspaceMemberId: MOCK_WORKSPACE_MEMBER_ID,
      role: 'owner' as const,
      memberStatus: 'active' as const,
      lifecycleState: 'active' as const,
    },
    {
      workspaceId: MOCK_TEAM_WORKSPACE_ID,
      workspaceName: MOCK_TEAM_WORKSPACE_NAME,
      workspaceIconKey: 'spark',
      workspaceType: 'team' as const,
      workspaceMemberId: MOCK_TEAM_WORKSPACE_MEMBER_ID,
      role: 'owner' as const,
      memberStatus: 'active' as const,
      lifecycleState: 'active' as const,
    },
  ],
  activeWorkspaceId: MOCK_WORKSPACE_ID,
};

const MOCK_CONTEXTS: Record<string, { context: Record<string, unknown> }> = {
  [MOCK_WORKSPACE_ID]: {
    context: {
      workspaceId: MOCK_WORKSPACE_ID,
      workspaceType: 'personal',
      workspaceMemberId: MOCK_WORKSPACE_MEMBER_ID,
      role: 'owner',
      memberStatus: 'active',
      lifecycleState: 'active',
     billingState: 'active',
      planId: 'team_max',
      providerMode: 'platform_credits',
      seatSummary: { seatLimit: 1, usedSeats: 1, availableSeats: 0, isSeatFull: true },
     permissions: ALL_PERMISSIONS,
     workspaceName: MOCK_WORKSPACE_NAME,
   },
 },
 [MOCK_TEAM_WORKSPACE_ID]: {
   context: {
     workspaceId: MOCK_TEAM_WORKSPACE_ID,
     workspaceType: 'team',
     workspaceMemberId: MOCK_TEAM_WORKSPACE_MEMBER_ID,
     role: 'owner',
     memberStatus: 'active',
     lifecycleState: 'active',
     billingState: 'active',
      planId: 'team_max',
      providerMode: 'platform_credits',
      seatSummary: { seatLimit: 10, usedSeats: 1, availableSeats: 9, isSeatFull: false },
      permissions: ALL_PERMISSIONS,
      workspaceName: MOCK_TEAM_WORKSPACE_NAME,
      teamId: MOCK_TEAM_WORKSPACE_ID,
      teamName: MOCK_TEAM_WORKSPACE_NAME,
      workspaceSettingsUrl: 'https://amr-api.open-design.ai/team/settings',
    },
  },
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

const MOCK_BILLING: Record<string, ReturnType<typeof makeBilling>> = {
  [MOCK_WORKSPACE_ID]: makeBilling(MOCK_WORKSPACE_ID, MOCK_WORKSPACE_MEMBER_ID),
  [MOCK_TEAM_WORKSPACE_ID]: makeBilling(MOCK_TEAM_WORKSPACE_ID, MOCK_TEAM_WORKSPACE_MEMBER_ID),
};

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
  void deps;

  app.get('/api/workspace/directory', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/directory', req);
    res.json(MOCK_WORKSPACE_DIRECTORY);
  });

  app.get('/api/workspace/context', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/context', req);
    const wsId = req.header('x-od-workspace-id') ?? '';
    const ctx = MOCK_CONTEXTS[wsId] ?? MOCK_CONTEXTS[MOCK_WORKSPACE_ID];
    res.json(ctx);
  });

  app.get('/api/workspace/billing', (req: Request, res: Response) => {
    logRequest('GET', '/api/workspace/billing', req);
    const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const billing = MOCK_BILLING[wsId] ?? MOCK_BILLING[MOCK_WORKSPACE_ID];
    res.json(billing);
  });

  app.put('/api/workspace/active', (req: Request, res: Response) => {
    logRequest('PUT', '/api/workspace/active', req);
    const body = req.body as { workspaceId?: unknown; workspaceMemberId?: unknown } | null;
    const wsId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const entry = MOCK_CONTEXTS[wsId];
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
