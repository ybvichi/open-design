// Tree-structure selector for moving projects into a team space.
//
// Replaces the old confirmation-only dialog with a recursive tree that
// lists every team workspace from the directory and lazily loads each
// team's folder hierarchy from the HDW folder API. The user can select
// the team root (workspace node) or any folder/subfolder in the tree;
// the selected { workspaceId, folderId | null } is returned on confirm.
//
// For "to-personal" moves the caller should keep using MoveToTeamConfirmDialog
// — there is no tree to pick from when leaving a team space.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { readWorkspaceDirectoryForCurrentGeneration } from '../collab/useWorkspaceContext';
import { Icon } from './Icon';
import { Skeleton } from './Loading';
import { useT } from '../i18n';
import styles from './MoveToTeamTreeDialog.module.css';

/** A folder node in the tree (mirrors the HDW folder API shape). */
interface FolderNode {
  id: string;
  name: string;
  /** Number of direct subfolders (from `subfolder_count`); 0 means leaf. */
  subfolderCount: number;
}

/** The user's selection: which workspace (team) and optional folder. */
export interface TeamTreeSelection {
  workspaceId: string;
  workspaceName: string;
  /** null = the team workspace root; a folder id = that specific folder. */
  folderId: string | null;
  folderName: string | null;
}

interface MoveToTeamTreeDialogProps {
  /** Called with the selected destination when the user confirms. */
  onConfirm: (selection: TeamTreeSelection) => void;
  onCancel: () => void;
  /** Pre-fetched directory items; when omitted the dialog fetches them. */
  workspaceItems?: readonly WorkspaceDirectoryItem[];
  /** When true, disables the confirm button while a move is in-flight. */
  busy?: boolean;
}

/** Fetch folders under a workspace (root when folderPid is null). */
async function fetchFolders(
  workspaceId: string,
  folderPid?: string | null,
): Promise<FolderNode[]> {
  let url = `/api/hdw/webapi/v1/folder/list?workspace_id=${encodeURIComponent(workspaceId)}`;
  if (folderPid) {
    url += `&folder_pid=${encodeURIComponent(folderPid)}`;
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json();
  const list: any[] = body?.data?.folders ?? [];
  return list.map((f) => ({
    id: f.folder_id || f.id || '',
    name: f.folder_name || f.name || '',
    subfolderCount: Number(f.subfolder_count) || 0,
  }));
}

/** A single expandable folder row in the tree. Loads its children lazily. */
function FolderTreeItem({
  folder,
  depth,
  workspaceId,
  selectedKey,
  onSelect,
}: {
  folder: FolderNode;
  depth: number;
  workspaceId: string;
  selectedKey: string | null;
  onSelect: (folderId: string, folderName: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FolderNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const itemKey = `${workspaceId}:${folder.id}`;
  const isSelected = selectedKey === itemKey;
  const hasChildren = folder.subfolderCount > 0;

  // Lazily fetch subfolders when the node is first expanded.
  useEffect(() => {
    if (!expanded || !hasChildren) return;
    if (children !== null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const subs = await fetchFolders(workspaceId, folder.id);
        if (!cancelled) setChildren(subs);
      } catch {
        if (!cancelled) setChildren([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [expanded, hasChildren, children, workspaceId, folder.id]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasChildren) return;
    setExpanded((v) => !v);
  };

  const handleSelect = () => {
    onSelect(folder.id, folder.name);
  };

  return (
    <div className={styles.folderItem}>
      <div
        className={`${styles.row}${isSelected ? ` ${styles.selected}` : ''}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={handleSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        <button
          type="button"
          className={styles.expandBtn}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
          ) : null}
        </button>
        <Icon name="folder-filled" size={14} className={styles.folderIcon} />
        <span className={styles.rowLabel}>{folder.name}</span>
        {isSelected ? <Icon name="check" size={14} className={styles.checkIcon} /> : null}
      </div>
      {expanded && loading ? (
        <div className={styles.childList}>
          <div className={styles.skeletonRow} style={{ paddingLeft: `${12 + (depth + 1) * 20}px` }}>
            <Skeleton width={14} height={14} radius={4} />
            <Skeleton width="50%" height={13} radius={6} />
          </div>
        </div>
      ) : expanded && children && children.length > 0 ? (
        <div className={styles.childList}>
          {children.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A team workspace node at the top level of the tree. */
function TeamTreeItem({
  team,
  selectedKey,
  onSelect,
}: {
  team: WorkspaceDirectoryItem;
  selectedKey: string | null;
  onSelect: (workspaceId: string, workspaceName: string, folderId: string | null, folderName: string | null) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const itemKey = `${team.workspaceId}:root`;
  const isSelected = selectedKey === itemKey;

  useEffect(() => {
    if (!expanded) return;
    if (folders !== null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rootFolders = await fetchFolders(team.workspaceId);
        if (!cancelled) setFolders(rootFolders);
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [expanded, folders, team.workspaceId]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleSelect = () => {
    onSelect(team.workspaceId, team.workspaceName, null, null);
  };

  return (
    <div className={styles.teamItem}>
      <div
        className={`${styles.row}${isSelected ? ` ${styles.selected}` : ''}`}
        onClick={handleSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        <button
          type="button"
          className={styles.expandBtn}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <Icon name="folder" size={16} className={styles.teamIcon} />
        <span className={styles.rowLabel}>{team.workspaceName}</span>
        {isSelected ? <Icon name="check" size={14} className={styles.checkIcon} /> : null}
      </div>
      {expanded && loading ? (
        <div className={styles.childList}>
          <div className={styles.skeletonRow} style={{ paddingLeft: '32px' }}>
            <Skeleton width={14} height={14} radius={4} />
            <Skeleton width="50%" height={13} radius={6} />
          </div>
        </div>
      ) : expanded && folders ? (
        <div className={styles.childList}>
          {folders.length > 0 ? (
            folders.map((folder) => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                depth={1}
                workspaceId={team.workspaceId}
                selectedKey={selectedKey}
                onSelect={(folderId, folderName) =>
                  onSelect(team.workspaceId, team.workspaceName, folderId, folderName)
                }
              />
            ))
          ) : (
            <div className={styles.emptyHint}>{t('recentProjects.treeNoFolders')}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function MoveToTeamTreeDialog({
  onConfirm,
  onCancel,
  workspaceItems: propItems,
  busy,
}: MoveToTeamTreeDialogProps) {
  const t = useT();
  const titleId = useId();
  const [items, setItems] = useState<readonly WorkspaceDirectoryItem[] | null>(propItems ?? null);
  const [loading, setLoading] = useState(!propItems);
  const [selected, setSelected] = useState<TeamTreeSelection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch the workspace directory when items are not supplied via props.
  useEffect(() => {
    if (propItems) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const directory = await readWorkspaceDirectoryForCurrentGeneration();
        if (cancelled) return;
        // Only show team workspaces (exclude personal/default-team).
        const teamItems = (directory.items ?? []).filter(
          (item) => item.workspaceType === 'team' && !item.isDefaultTeam,
        );
        setItems(teamItems);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [propItems]);

  const selectedKey = useMemo(() => {
    if (!selected) return null;
    return selected.folderId
      ? `${selected.workspaceId}:${selected.folderId}`
      : `${selected.workspaceId}:root`;
  }, [selected]);

  const handleSelect = useCallback(
    (workspaceId: string, workspaceName: string, folderId: string | null, folderName: string | null) => {
      setSelected({ workspaceId, workspaceName, folderId, folderName });
    },
    [],
  );

  const handleConfirm = () => {
    if (!selected || busy) return;
    onConfirm(selected);
  };

  const dialog = (
    <Dialog
      className={styles.dialog}
      onClose={onCancel}
      closeOnEscape
      ariaLabelledBy={titleId}
    >
      <DialogTitle id={titleId}>{t('recentProjects.moveToTeam')}</DialogTitle>
      <DialogDescription>{t('recentProjects.moveToTeamTreeDesc')}</DialogDescription>
      <div className={styles.treeContainer} ref={scrollRef}>
        {loading ? (
          <div className={styles.skeletonList}>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="60%" height={13} radius={6} />
            </div>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="45%" height={13} radius={6} />
            </div>
            <div className={styles.skeletonRow}>
              <Skeleton width={16} height={16} radius={4} />
              <Skeleton width="55%" height={13} radius={6} />
            </div>
          </div>
        ) : items && items.length > 0 ? (
          <div className={styles.tree}>
            {items.map((team) => (
              <TeamTreeItem
                key={team.workspaceId}
                team={team}
                selectedKey={selectedKey}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>{t('recentProjects.treeNoTeams')}</div>
        )}
      </div>
      <DialogFooter className={styles.footer}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {t('designs.renameCancel')}
        </button>
        <button
          type="button"
          className={`primary ${styles.confirmBtn}`}
          onClick={handleConfirm}
          disabled={!selected || busy}
        >
          {t('recentProjects.confirmMoveToTeam')}
        </button>
      </DialogFooter>
    </Dialog>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}
