// Team tree section for the entry navigation rail.
//
// Renders a compact tree of teams (from the workspace directory) with
// expandable folder children. Clicking a team navigates to the team-space
// page (`/team/:teamId`); clicking a folder navigates to the team-folder
// page (`/team/:teamId/folder/:folderId`). Both destination pages are empty
// placeholders for now — this component is the navigation entry point.
//
// Root-level folders are fetched from the HDW folder API
// (`GET /api/hdw/webapi/v1/folder/list?workspace_id=<teamId>`) and refreshed
// when a create/delete dispatches the `hdw:folders-updated` event.

import { useState, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { useT } from '../i18n';
import styles from './TeamTreeSection.module.css';

/** A folder under a team workspace. */
export interface TeamFolder {
  id: string;
  name: string;
}

interface Props {
  /** Workspace directory items (teams). Falls back to a mock entry when empty. */
  workspaceItems: readonly WorkspaceDirectoryItem[];
  /** The active team id (from route or context), for highlight state. */
  activeTeamId?: string;
  /** The active folder id (from route), for highlight state. */
  activeFolderId?: string;
  /** True while the workspace directory is still being fetched. Shows a
   *  shimmer placeholder tree until the real team items arrive. */
  loading?: boolean;
  /** Called when the user clicks "新建团队" in the footer. */
  onCreateTeam?: () => void;
  onRenameTeam?: (teamId: string, newName: string) => void;
  onDeleteTeam?: (teamId: string) => void;
}

interface TeamNodeProps {
  team: WorkspaceDirectoryItem;
  activeTeamId?: string;
  activeFolderId?: string;
  onRenameTeam?: (teamId: string, newName: string) => void;
  onDeleteTeam?: (teamId: string) => void;
}

function TeamNode({ team, activeTeamId, activeFolderId, onRenameTeam, onDeleteTeam }: TeamNodeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [folders, setFolders] = useState<TeamFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const isActiveTeam = activeTeamId === team.workspaceId;
  const isTeamSelected = isActiveTeam && !activeFolderId;
  const canRename = team.role === 'admin' || team.role === 'owner';
  const canDelete = team.role === 'owner';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(team.workspaceName);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch root-level folders for this team from the HDW folder API, and
  // refresh when a create/delete dispatches `hdw:folders-updated` for
  // this team. Folders are loaded lazily — the request is only sent when
  // the user expands this team node.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const loadFolders = async () => {
      setFoldersLoading(true);
      try {
        const res = await fetch(
          `/api/hdw/webapi/v1/folder/list?workspace_id=${encodeURIComponent(team.workspaceId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        setFolders(list.map((f) => ({
          id: f.folder_id || f.id || '',
          name: f.folder_name || f.name || '',
        })));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    };
    void loadFolders();
    function onFoldersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== team.workspaceId) return;
      void loadFolders();
    }
    window.addEventListener('hdw:folders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:folders-updated', onFoldersUpdated);
    };
  }, [team.workspaceId, expanded]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canRename) return;
    setEditValue(team.workspaceName);
    setEditing(true);
  };

  const commitRename = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === team.workspaceName) {
      setEditing(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch('/api/hdw/webapi/v1/team/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: team.workspaceId,
          workspace_name: trimmed,
          operator_member_id: team.workspaceMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        onRenameTeam?.(team.workspaceId, trimmed);
      }
    } catch {
      // ignore — leave name unchanged
    } finally {
      setRenaming(false);
      setEditing(false);
    }
  };

  const cancelEdit = () => {
    setEditValue(team.workspaceName);
    setEditing(false);
  };

  const handleEditKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const confirmDeleteTeam = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/hdw/webapi/v1/team/${team.workspaceId}?operator_member_id=${encodeURIComponent(team.workspaceMemberId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        onDeleteTeam?.(team.workspaceId);
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleTeamClick = () => {
    navigate({ kind: 'home', view: 'team-space', teamId: team.workspaceId });
  };

  const handleToggle = (e: ReactKeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleFolderClick = (folder: TeamFolder) => {
    navigate({
      kind: 'home',
      view: 'team-folder',
      teamId: team.workspaceId,
      folderId: folder.id,
    });
  };

  return (
    <div className={styles.teamNode}>
      <div className={`${styles.teamRow}${isTeamSelected ? ` ${styles.isActiveRow}` : ''}`}>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
        >
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={12}
          />
        </button>
        {editing ? (
          <div className={styles.teamLabel}>
            <Icon name="folder" size={16} className={styles.teamIcon} />
            <input
              ref={inputRef}
              className={styles.editInput}
              value={editValue}
              disabled={renaming}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={handleEditKeyDown}
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.teamLabel}
              onClick={handleTeamClick}
              onDoubleClick={canRename ? startEdit : undefined}
              title={team.workspaceName}
            >
              <Icon name="folder" size={16} className={styles.teamIcon} />
              <span className={styles.teamName}>{team.workspaceName}</span>
            </button>
            <span className={styles.actions}>
              {canDelete ? (
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  aria-label="delete"
                  tabIndex={-1}
                >
                  <Icon name="trash" size={13} />
                </button>
              ) : (
                <Icon name="more-horizontal" size={14} className={styles.actionIcon} />
              )}
            </span>
          </>
        )}
      </div>
      {expanded && foldersLoading ? (
        <div className={styles.folderList} role="group">
          <div className={styles.skeletonRow} aria-hidden>
            <span className={styles.skeletonChevron} />
            <Skeleton width={13} height={13} radius={4} />
            <Skeleton width="40%" height={13} radius={6} />
          </div>
        </div>
      ) : expanded && folders.length > 0 ? (
        <div className={styles.folderList} role="group">
          {folders.map((folder) => {
            const isActiveFolder =
              isActiveTeam && activeFolderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                className={`${styles.folderRow}${isActiveFolder ? ` ${styles.isActive}` : ''}`}
                onClick={() => handleFolderClick(folder)}
                title={folder.name}
              >
                <Icon name="folder-filled" size={13} className={styles.folderIcon} />
                <span className={styles.folderName}>{folder.name}</span>
                <span className={styles.actions} aria-hidden="true">
                  <Icon name="more-horizontal" size={14} className={styles.actionIcon} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {confirmDelete ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setConfirmDelete(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteConfirmTitle')}</h3>
              <p className={styles.confirmMsg}>{t('teamSpace.deleteConfirmMsg')}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setConfirmDelete(false)}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={confirmDeleteTeam} disabled={deleting}>
                  {t('teamSpace.removeConfirmBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

/** Shimmer placeholder mirroring a team row's layout (chevron gap + folder
 *  icon + name bar) while the directory is still loading. */
function SkeletonRow() {
  return (
    <div className={styles.skeletonRow} aria-hidden>
      <span className={styles.skeletonChevron} />
      <Skeleton width={16} height={16} radius={4} />
      <Skeleton width="55%" height={13} radius={6} />
    </div>
  );
}

export function TeamTreeSection({
  workspaceItems,
  activeTeamId,
  activeFolderId,
  onCreateTeam,
  onRenameTeam,
  onDeleteTeam,
  loading,
}: Props) {
  const t = useT();
  // Only show team workspaces in the tree.
  const teamItems = workspaceItems.filter(
    (item) => item.workspaceType === 'team' && !item.isDefaultTeam
  );
  const items = [...teamItems];
  const showSkeleton = loading && items.length === 0;

  return (
    <div className={styles.container} data-testid="team-tree-section">
      {showSkeleton ? (
        <div className={styles.tree} role="status" aria-live="polite">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        items.length > 0 ? (
          <div className={styles.tree}>
            {items.map((team) => (
              <TeamNode
                key={team.workspaceId}
                team={team}
                activeTeamId={activeTeamId}
                activeFolderId={activeFolderId}
                onRenameTeam={onRenameTeam}
                onDeleteTeam={onDeleteTeam}
              />
            ))}
          </div>
        ) : null
      )}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.createTeamBtn}
          onClick={() => onCreateTeam?.()}
        >
          <Icon name="plus" size={14} />
          <span>{t('workspaceSwitcher.createTeam')}</span>
        </button>
      </div>
    </div>
  );
}
