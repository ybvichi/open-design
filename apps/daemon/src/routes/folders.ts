import type { Express, Request, RequestHandler } from 'express';
import {
  createWorkspaceFolder,
  listSubFolders,
  deleteWorkspaceFolder,
  updateWorkspaceFolder,
  listFolderPreview,
  countProjectsInFolder,
  countProjectsInAllFolders,
  getWorkspaceFolder,
  getFolderPath,
  listProjectsInFolder,
  normalizeProject,
  type WorkspaceFolderInput,
} from '../db.js';

/** Shape of a remote-only team project summary merged into the root
 *  projects response. Mirrors `normalizeProject` output so the web client
 *  can treat local and remote projects uniformly. */
export interface RemoteTeamProjectSummary {
  id: string;
  name: string;
  skillId: string | null;
  designSystemId: string | null;
  pendingPrompt?: string;
  metadata?: unknown;
  appliedPluginSnapshotId?: string;
  customInstructions?: string;
  createdAt: number;
  updatedAt: number;
  workspaceId: string | null;
  createdByWorkspaceMemberId?: string | null;
  updatedByWorkspaceMemberId?: string | null;
  workspaceVisibility?: string | null;
}

export interface RegisterFolderRoutesDeps {
  db: any;
  http: {
    requireLocalDaemonRequest: RequestHandler;
    sendApiError: (...args: any[]) => any;
  };
  /** When provided and the workspace is a team workspace, the root projects
   *  endpoint (`folderId = "root"`) merges in remote-only team projects —
   *  those shared by teammates but not yet materialized on this daemon.
   *  Mirrors the remote catalog merge in
   *  `GET /api/workspaces/:id/projects?view=team`. */
  mergeRemoteTeamProjects?: (
    req: Request,
    workspaceId: string,
    localProjectIds: Set<string>,
  ) => Promise<RemoteTeamProjectSummary[]>;
}

interface FolderRow {
  folderId: string;
  folderPid: string | null;
  workspaceId: string;
  folderName: string;
  createdAt: string;
}

/**
 * Local folder CRUD routes. Unlike the HDW proxy (`/api/hdw/webapi/v1/folder/*`)
 * which forwards to the upstream backend, these routes operate directly on the
 * daemon's local SQLite `folders` table. They are used by the personal-all
 * scope view where folders belong to the user's personal workspace.
 */
export function registerFolderRoutes(app: Express, deps: RegisterFolderRoutesDeps): void {
  const { db, http } = deps;
  const { requireLocalDaemonRequest, sendApiError } = http;

  // Batch project counts for all folders in a workspace. Used by the team
  // space view to enrich the HDW folder list (which doesn't return
  // project_count) with local SQLite counts in a single request.
  // GET /api/folders/counts?workspace_id=<id>
  app.get('/api/folders/counts', async (req, res) => {
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    try {
      const counts = countProjectsInAllFolders(db, workspaceId);
      res.json({ code: 0, data: { counts } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  // List root-level or sub-level folders for a workspace.
  // GET /api/folders?workspace_id=<id>[&folder_pid=<pid>]
  // When folder_pid is omitted, returns root-level folders (folder_pid IS NULL).
  app.get('/api/folders', async (req, res) => {
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    const folderPid =
      typeof req.query.folder_pid === 'string' && req.query.folder_pid.trim()
        ? String(req.query.folder_pid).trim()
        : null;
    try {
      const folders = listSubFolders(db, workspaceId, folderPid) as FolderRow[];
      const result = folders.map((f) => {
        const preview = listFolderPreview(db, workspaceId, f.folderId, 4);
        const projectCount = countProjectsInFolder(db, workspaceId, f.folderId);
        const subfolderCount = listSubFolders(db, workspaceId, f.folderId).length;
        return {
          folder_id: f.folderId,
          folder_pid: f.folderPid,
          folder_name: f.folderName,
          workspace_id: f.workspaceId,
          created_at: f.createdAt,
          project_count: projectCount,
          subfolder_count: subfolderCount,
         subfolder_preview: preview,
        };
      });
      res.json({ code: 0, data: { folders: result } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

 // Create a folder under a workspace (root-level when folder_pid is null/omitted).
  // Get a single folder's detail (including folder_pid for breadcrumb walking).
  // GET /api/folders/:folderId?workspace_id=<id>
  app.get('/api/folders/:folderId', async (req, res) => {
    const folderId = String(req.params.folderId ?? '').trim();
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!folderId || !workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId or workspace_id');
    }
    try {
      const folder = getWorkspaceFolder(db, workspaceId, folderId) as FolderRow | undefined;
      if (!folder) {
        return res.status(404).json({ code: 1, error: 'NOT_FOUND', message: 'Folder not found' });
      }
      const path = getFolderPath(db, workspaceId, folderId) as Array<{
        folderId: string; folderName: string; folderPid: string | null;
      }>;
      res.json({
        code: 0,
        data: {
          folder_id: folder.folderId,
          folder_pid: folder.folderPid,
          workspace_id: folder.workspaceId,
          folder_name: folder.folderName,
          created_at: folder.createdAt,
          path: path.map((p) => ({ folder_id: p.folderId, folder_name: p.folderName })),
        },
      });
   } catch (err) {
     sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
   }
 });

 // List projects directly inside a folder (or at the workspace root when
 // folderId is the special value "root"). GET /api/folders/:folderId/projects
 // ?workspace_id=<id>  — returns { projects: Project[] } shaped the same as
 // GET /api/projects so the web client can reuse the same card rendering.
 app.get('/api/folders/:folderId/projects', async (req, res) => {
    const folderIdRaw = String(req.params.folderId ?? '').trim();
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    // "root" is a sentinel for the workspace root (folder_id IS NULL).
    const folderId = folderIdRaw && folderIdRaw !== 'root' ? folderIdRaw : null;
 try {
   const rows = listProjectsInFolder(db, workspaceId, folderId);
   const projects: RemoteTeamProjectSummary[] = rows.map((row) => ({
     ...normalizeProject(row),
     workspaceId: row.workspaceId ?? null,
     createdByWorkspaceMemberId: row.createdByWorkspaceMemberId ?? null,
     updatedByWorkspaceMemberId: row.updatedByWorkspaceMemberId ?? null,
     workspaceVisibility: row.workspaceVisibility ?? null,
   }));
    // For the workspace root, merge in remote-only team projects that
    // haven't been materialized locally. This mirrors the original
    // GET /api/workspaces/:id/projects?view=team merge so team members
    // see projects shared by teammates they haven't opened yet.
    if (folderId === null && deps.mergeRemoteTeamProjects) {
      const localIds = new Set(projects.map((p) => p.id));
      try {
        const remote = await deps.mergeRemoteTeamProjects(req, workspaceId, localIds);
        projects.push(...remote);
      } catch {
        // Best-effort: remote catalog failures must not break the local list.
      }
    }
    res.json({ code: 0, data: { projects } });
  } catch (err) {
    sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
  }
 });

// POST /api/folders  body: { workspace_id, folder_name, folder_pid? }
 app.post('/api/folders', requireLocalDaemonRequest, async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    const workspaceId = typeof body?.workspace_id === 'string' ? body.workspace_id.trim() : '';
    const folderName = typeof body?.folder_name === 'string' ? body.folder_name.trim() : '';
    const folderPid =
      typeof body?.folder_pid === 'string' && body.folder_pid.trim()
        ? String(body.folder_pid).trim()
        : null;
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    if (!folderName) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folder_name');
    }
    try {
      const input: WorkspaceFolderInput = {
        workspaceId,
        folderPid,
        folderName,
      };
      const folderId = createWorkspaceFolder(db, input);
      res.json({ code: 0, data: { folder_id: folderId } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

 // Delete a folder. Cascades to child folders (FK ON DELETE CASCADE).
 // DELETE /api/folders/:folderId?workspace_id=<id>
 app.delete('/api/folders/:folderId', requireLocalDaemonRequest, async (req, res) => {
   const folderId = String(req.params.folderId ?? '').trim();
   const workspaceId = String(req.query.workspace_id ?? '').trim();
   if (!folderId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId');
   }
   if (!workspaceId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
   }
   try {
     deleteWorkspaceFolder(db, workspaceId, folderId);
     res.json({ code: 0, data: { folder_id: folderId } });
   } catch (err) {
     sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
   }
 });

  // Rename a folder.
  // PATCH /api/folders/:folderId?workspace_id=<id>  body: { folder_name }
  app.patch('/api/folders/:folderId', requireLocalDaemonRequest, async (req, res) => {
    const folderId = String(req.params.folderId ?? '').trim();
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    const folderName = typeof req.body?.folder_name === 'string' ? req.body.folder_name.trim() : '';
    if (!folderId || !workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId or workspace_id');
    }
    if (!folderName) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folder_name');
    }
    try {
      updateWorkspaceFolder(db, workspaceId, folderId, { folderName });
      res.json({ code: 0, data: { folder_id: folderId, folder_name: folderName } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });
}
