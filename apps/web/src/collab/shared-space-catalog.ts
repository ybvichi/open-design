// The ONE read of the shared-space project catalog
// (`GET /api/workspace/projects/shared-with-me`).
//
// The daemon joins `workspace_project_shares` (share metadata) with
// `team_projects` (live project data) so the response always carries the
// current project state. The shared space is workspace-agnostic — the daemon
// resolves the current user from the SSO session, so no workspace headers are
// needed.

import type { SharedWithMeProject, SharedWithMeResponse } from '@open-design/contracts';
import { coalescedGet, forceCoalescedGet } from '../lib/coalesced-get';

const SHARED_WITH_ME_CACHE_KEY = 'shared-with-me-projects';

/**
 * Read the shared-with-me project catalog.
 *
 * Projects shared TO the current user in the shared space. Each project
 * carries an `access` object with `canView: true, canComment: true,
 * canEdit: false` — the shared space grants read + comment only.
 */
export async function fetchSharedWithMeCatalog(options?: {
  force?: boolean;
}): Promise<SharedWithMeProject[]> {
  const run = async (): Promise<SharedWithMeProject[]> => {
    const response = await fetch('/api/workspace/projects/shared-with-me');
    if (!response.ok) throw new Error(`shared-with-me ${response.status}`);
    const body = (await response.json()) as SharedWithMeResponse;
    return body.projects ?? [];
  };
  if (options?.force) {
    return forceCoalescedGet(SHARED_WITH_ME_CACHE_KEY, run);
  }
  return coalescedGet(SHARED_WITH_ME_CACHE_KEY, run);
}

/**
 * Share a project to specific recipients in the shared space.
* Calls the daemon proxy which forwards to the HDW backend.
 */
export async function shareProjectToSharedSpace(input: {
  projectId: string;
  homeWorkspaceId: string;
  recipients: Array<{ username: string; displayname?: string }>;
}): Promise<{ shared: number; skipped: number } | null> {
  const response = await fetch('/api/shared-space/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: input.projectId,
      home_workspace_id: input.homeWorkspaceId,
      recipients: input.recipients,
    }),
  });
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Remove a specific share (unshare from one recipient).
 */
export async function unshareFromSharedSpace(shareId: string): Promise<boolean> {
  const response = await fetch(`/api/shared-space/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return body?.ok === true;
}
