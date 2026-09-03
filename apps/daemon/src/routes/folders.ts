import type { Express, RequestHandler } from 'express';
import {
  createWorkspaceFolder,
  listSubFolders,
  deleteWorkspaceFolder,
  listFolderPreview,
  countProjectsInFolder,
  getWorkspaceFolder,
  getFolderPath,
  listProjectsInFolder,
  normalizeProject,
  type WorkspaceFolderInput,
} from '../db.js';

export interface RegisterFolderRoutesDeps {
  db: any;
  http: {
    requireLocalDaemonRequest: RequestHandler;
    sendApiError: (...args: any[]) => any;
  };
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
          subfolder_preview: preview.map((p) => p.name),
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
      const projects = rows.map((row) => ({
        ...normalizeProject(row),
        workspaceId: row.workspaceId ?? null,
      }));
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
}
