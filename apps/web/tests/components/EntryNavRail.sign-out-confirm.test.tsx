// @vitest-environment jsdom
//
// recvqgMWpJZqhL (P2, Feishu dogfood table): 客户端和网页端退出登录需要二次确认。
// The nav rail's account-menu 退出登录 item used to POST
// /api/auth/logout on the first click — a stray click signed the
// user out of the workspace instantly. It must now only ARM the shared
// SignOutConfirmDialog: cancel keeps the session untouched, and only the
// dialog's confirm action performs the real logout (with the usual
// workspace-surface refresh nudges).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const originalFetch = globalThis.fetch;

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    displayName: 'Leaf',
    seatSummary: { seatLimit: 5, usedSeats: 1, availableSeats: 4, isSeatFull: false },
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
    workspaceSettingsUrl: 'https://web.example.com/console/settings?workspaceId=ws-team',
  } as unknown as WorkspaceCollabContext;
}

function renderRail(overrides: Partial<React.ComponentProps<typeof EntryNavRail>> = {}) {
  return render(
    <I18nProvider initial="zh-CN">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={teamContext()}
        billing={null}
        {...overrides}
      />
    </I18nProvider>,
  );
}

function stubFetch(onLogout: () => void) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
      onLogout();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith('/api/integrations/vela/status')) {
      return new Response(
        JSON.stringify({ loggedIn: true, profile: 'prod', configPath: '/x', user: { id: 'u', email: 'leaf@example.com' } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
}

// jsdom exposes `window.location.reload` as a non-configurable own property,
// so it cannot be spied on directly. Replace the whole `window.location` with
// a stand-in that carries a mocked `reload` (same pattern as PluginShareMenu).
function stubLocationReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

function openAccountMenuAndClickSignOut() {
  fireEvent.click(screen.getByTestId('entry-nav-account'));
  fireEvent.click(screen.getByRole('menuitem', { name: /退出登录/ }));
}

beforeEach(() => {
  resetWorkspaceDirectoryCache();
  // jsdom cannot navigate: replace `location.reload` with a no-op so a
  // confirmed sign-out (which reloads the page) doesn't spam the console.
  stubLocationReload();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  resetWorkspaceDirectoryCache();
  vi.restoreAllMocks();
});

describe('EntryNavRail account menu sign-out confirm (recvqgMWpJZqhL)', () => {
  it('clicking 退出登录 opens the confirm dialog without logging out; cancel closes it untouched', async () => {
    let logoutCalls = 0;
    globalThis.fetch = stubFetch(() => {
      logoutCalls += 1;
    }) as typeof fetch;

    renderRail();
    openAccountMenuAndClickSignOut();

    // Dialog armed, no logout yet.
    expect(screen.getByTestId('sign-out-confirm-dialog')).toBeTruthy();
    expect(logoutCalls).toBe(0);

    fireEvent.click(screen.getByTestId('sign-out-confirm-cancel'));
    expect(screen.queryByTestId('sign-out-confirm-dialog')).toBeNull();
    // Still no logout after cancel — the session survives.
    await Promise.resolve();
    expect(logoutCalls).toBe(0);
  });

  it('confirming the dialog performs the real logout', async () => {
    let logoutCalls = 0;
    globalThis.fetch = stubFetch(() => {
      logoutCalls += 1;
    }) as typeof fetch;

    renderRail();
    openAccountMenuAndClickSignOut();
    fireEvent.click(screen.getByTestId('sign-out-confirm-accept'));

    await waitFor(() => {
      expect(logoutCalls).toBe(1);
    });
    expect(screen.queryByTestId('sign-out-confirm-dialog')).toBeNull();
  });

  it('reloads the page after the SSO logout succeeds', async () => {
    const reload = stubLocationReload();
    globalThis.fetch = stubFetch(() => {}) as typeof fetch;

    renderRail();
    openAccountMenuAndClickSignOut();
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('sign-out-confirm-accept'));

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads the page even when the daemon rejects the SSO logout', async () => {
    const reload = stubLocationReload();
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false }), { status: 500 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    renderRail();
    openAccountMenuAndClickSignOut();
    fireEvent.click(screen.getByTestId('sign-out-confirm-accept'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // Local sign-out always proceeds: the page reloads even when the
    // daemon-side SSO logout fails.
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
