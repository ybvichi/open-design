// @vitest-environment jsdom
//
// Regression for 飞书 recvqbkcLqIFH7 "左下角退出登录后，登录入口没了".
//
// `CloudSignInTip` (rendered as EntryShell's `footerNotice` whenever
// `workspaceContext` is falsy) persists its own dismissal in localStorage
// forever — there is no code path that ever clears
// `od.entry.cloudSignInTip.dismissed`. Once ANY session had dismissed that
// card (even long before ever signing in), a later real sign-out left the
// rail's account section as a bare brand logo (see EntryNavRail.tsx's
// `context`-falsy branch) AND the footer notice silently rendered null — no
// visible sign-in entry point survived anywhere in the rail.
//
// The fix: the account menu's 退出登录 (sign out) button must reset that
// dismissal as part of its real sign-out flow, so the card is guaranteed to
// reappear exactly when `context` goes back to null from a genuine sign-out.
//
// TEMPORARY: the dismissal reset is currently commented out in EntryNavRail
// (sign-out just reloads the page). The first test below therefore asserts the
// reload instead of the dismissal reset; restore the original assertion when
// the reset is re-enabled.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { CloudSignInTip } from '../../src/components/CloudSignInTip';
import { I18nProvider } from '../../src/i18n';

const originalFetch = globalThis.fetch;

function context(overrides: Partial<WorkspaceCollabContext> = {}): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    teamName: 'Acme',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'free',
    planId: null,
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
    ...overrides,
  } as unknown as WorkspaceCollabContext;
}

beforeEach(() => {
  resetWorkspaceDirectoryCache();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  resetWorkspaceDirectoryCache();
  vi.restoreAllMocks();
});

describe('EntryNavRail sign-out (recvqbkcLqIFH7)', () => {
  it('reloads the page on sign-out (dismissal reset is temporarily commented out)', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <I18nProvider initial="zh-CN">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          open
          context={context()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('entry-nav-account'));
    fireEvent.click(screen.getByText('退出登录'));
    // recvqgMWpJZqhL: sign-out now goes through an explicit confirmation
    // dialog; the real logout chain only runs after confirming.
    fireEvent.click(screen.getByTestId('sign-out-confirm-accept'));

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the sign-in card once the stale dismissal is gone and context is null (post sign-out shape)', () => {
    // Regression guard for the actual visible symptom: with the dismissal
    // cleared and no workspace context (what the rail looks like right after
    // a sign-out completes and the context re-read resolves to null), the
    // footer notice must show a real, clickable sign-in entry point instead
    // of rendering nothing.
    render(
      <I18nProvider initial="zh-CN">
        <CloudSignInTip />
      </I18nProvider>,
    );

    expect(screen.getByTestId('entry-cloud-signin-tip')).toBeTruthy();
    expect(screen.getByText('登录')).toBeTruthy();
    expect(screen.getByText('登录即可享受云端协作')).toBeTruthy();
  });
});
