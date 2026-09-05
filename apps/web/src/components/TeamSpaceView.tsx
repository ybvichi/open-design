import { Fragment, useId, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { createPortal } from 'react-dom';
import { getStoredUsername } from '../auth/auth';
import { getTeamMemberId } from '../utils/deterministicId';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { avatarColorFor } from '../utils/avatarColor';
import { FolderCardMenu } from './FolderCardMenu';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import type { DesignSystemSummary, Project } from '../types';
import styles from './TeamSpaceView.module.css';

 type TeamTab = 'projects' | 'members' | 'skill' | 'mcp';

interface TabDef {
  id: TeamTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'teamSpace.tabProjects' },
  { id: 'members', icon: 'users', labelKey: 'teamSpace.tabMembers' },
  { id: 'skill', icon: 'puzzle', labelKey: 'teamSpace.tabSkill' },
  { id: 'mcp', icon: 'integrations-filled', labelKey: 'teamSpace.tabMcp' },
];

type MemberRole = 'owner' | 'admin' | 'member' | 'guest';

interface TeamMember {
  workspaceMemberId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

interface OperatorInfo {
  memberId: string;
  role: MemberRole;
}

const ROLE_KEY: Record<MemberRole, keyof Dict> = {
  owner: 'teamSpace.roleOwner',
  admin: 'teamSpace.roleAdmin',
  member: 'teamSpace.roleMember',
  guest: 'teamSpace.roleGuest',
};

function formatJoinedDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
}

interface Props {
  teamId?: string;
  onInvite?: () => void;
  designSystems?: DesignSystemSummary[];
  onOpenProject?: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onRenameProject?: (id: string, name: string) => void;
}

export function TeamSpaceView({ teamId, onInvite, designSystems = [], onOpenProject, onDeleteProject, onRenameProject }: Props) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TeamTab>('projects');
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(teamId));
  const [operator, setOperator] = useState<OperatorInfo | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [typeTabsEl, setTypeTabsEl] = useState<HTMLDivElement | null>(null);

  // Resolve the team name from the workspace directory by id. The directory
  // is the same source the left rail tree uses, so the title always matches
  // the selected node.
  useEffect(() => {
    if (!teamId) { setTeamName(null); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setLoading(false); return; }
        const body = await res.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const match = body.items?.find((item) => item.workspaceId === teamId);
        setTeamName(match?.workspaceName ?? null);
        if (!match) {
          navigate({ kind: 'home', view: 'home' }, { replace: true });
          return;
        }
      } catch {
        // Leave the fallback title in place.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
   return () => { cancelled = true; };
 }, [teamId]);

 // Update the title without a refetch when a team is renamed from the
 // left nav rail. The `hdw:team-renamed` event carries the new name.
 useEffect(() => {
   if (!teamId) return;
   function onTeamRenamed(e: Event) {
     const detail = (e as CustomEvent).detail;
     if (detail?.teamId === teamId && detail?.newName) {
       setTeamName(detail.newName);
     }
   }
   window.addEventListener('hdw:team-renamed', onTeamRenamed);
   return () => window.removeEventListener('hdw:team-renamed', onTeamRenamed);
 }, [teamId]);

 // Fetch the current user's operator info (member ID + role) via the
  // dedicated single-member endpoint instead of filtering the full member
  // list. The member ID is derived locally so no extra request is needed.
  useEffect(() => {
    if (!teamId) { setOperator(null); return; }
    let cancelled = false;
    void (async () => {
      const username = getStoredUsername();
      if (!username) { if (!cancelled) setOperator(null); return; }
      try {
        const memberId = await getTeamMemberId(teamId, username);
        const res = await fetch(
          `/api/hdw/webapi/v1/team/${teamId}/member/${memberId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setOperator(null); return; }
        const body = await res.json();
        if (cancelled) return;
        if (body?.code === 0 && body?.data) {
          setOperator({
            memberId: body.data.workspace_member_id,
            role: body.data.role as MemberRole,
          });
        } else {
          setOperator(null);
        }
      } catch {
        if (!cancelled) setOperator(null);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const title = teamName?.trim() || t('teamSpace.defaultTitle');

  if (loading) {
    return (
      <section className={styles.view}>
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="team-space-title">
     <header className={styles.header}>
       <div className={styles.titleBlock}>
         <h1 id="team-space-title" className={styles.title}>{title}</h1>
         <span className={styles.subtitle}>
           <span className={styles.dot} aria-hidden />
           {t('teamSpace.subtitle')}
         </span>
       </div>
        <div className={styles.headerActions}>
          {activeTab === 'projects' ? (
            <button
              type="button"
              className={styles.inviteBtn}
              onClick={() => setShowCreateGroup(true)}
            >
              <Icon name="plus" size={15} aria-hidden />
              <span>{t('teamSpace.newProjectGroup')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.refreshBtn}
            title={t('recentProjects.refresh')}
            aria-label={t('recentProjects.refresh')}
            onClick={() => window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }))}
          >
            <Icon name="refresh" size={16} aria-hidden />
          </button>
        </div>
     </header>

      <div ref={setTypeTabsEl} className={styles.typeTabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={16} aria-hidden />
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className={styles.content} role="tabpanel">
       {activeTab === 'projects' ? (
          <ProjectsPanel controlsPortalTarget={typeTabsEl} teamId={teamId} operator={operator} showCreateGroup={showCreateGroup} onShowCreateGroupChange={setShowCreateGroup} designSystems={designSystems} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} onRenameProject={onRenameProject} />
       ) : null}
       {activeTab === 'members' ? (
        <MembersTable teamId={teamId} onInvite={onInvite} operator={operator} />
       ) : null}
        {activeTab === 'skill' ? (
          <PlaceholderPanel icon="puzzle" label={t('teamSpace.tabSkill')} note={t('teamSpace.skillNote')} />
        ) : null}
        {activeTab === 'mcp' ? (
          <PlaceholderPanel icon="integrations-filled" label={t('teamSpace.tabMcp')} note={t('teamSpace.mcpNote')} />
        ) : null}
      </div>
    </section>
  );
}

function PlaceholderPanel({ icon, label, note }: { icon: IconName; label: string; note: string }) {
  return (
    <div className={styles.panel}>
      <span className={styles.panelIcon} aria-hidden>
        <Icon name={icon} size={32} />
      </span>
      <h2 className={styles.panelTitle}>{label}</h2>
      <p className={styles.panelNote}>{note}</p>
    </div>
  );
}

interface BreadcrumbItem {
  folderId: string;
  folderName: string;
}

interface TeamFolderItem {
  folderId: string;
  folderName: string;
  projectCount: number;
  subfolderCount: number;
  subfolderPreview: Array<{ name: string; kind: 'folder' | 'project' }>;
  createdAt: string;
}


function ProjectsPanel({
  teamId,
  operator,
  showCreateGroup,
  onShowCreateGroupChange,
  designSystems = [],
  onOpenProject,
  onDeleteProject,
  onRenameProject,
  controlsPortalTarget,
}: {
  teamId?: string;
  operator: OperatorInfo | null;
  showCreateGroup: boolean;
  onShowCreateGroupChange: (v: boolean) => void;
  designSystems?: DesignSystemSummary[];
  onOpenProject?: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onRenameProject?: (id: string, name: string) => void;
  controlsPortalTarget?: HTMLElement | null;
}) {
  const t = useT();
  const [folders, setFolders] = useState<TeamFolderItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamFolderItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const operatorMemberId = operator?.memberId ?? null;
  const operatorRole = operator?.role ?? null;
 const canManage = operatorRole === 'owner' || operatorRole === 'admin';

  const [renameFolderTarget, setRenameFolderTarget] = useState<TeamFolderItem | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const renameFolderTitleId = useId();

 // Fetch the team's project folders from the HDW folder API, and refresh
 // when a create/delete dispatches the `hdw:folders-updated` event.
  useEffect(() => {
    if (!teamId) { setFolders([]); return; }
    let cancelled = false;
    const loadFolders = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/hdw/webapi/v1/folder/list?workspace_id=${encodeURIComponent(teamId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        // The HDW folder list doesn't include project_count, so fetch local
        // batch counts and merge them into the folder items.
        let counts: Record<string, number> = {};
        try {
          const countsRes = await fetch(
            `/api/folders/counts?workspace_id=${encodeURIComponent(teamId)}`,
          { cache: 'no-store' },
          );
          if (countsRes.ok) {
            const countsBody = await countsRes.json();
            counts = countsBody?.data?.counts ?? {};
          }
        } catch { /* counts stay empty */ }
        if (cancelled) return;
        setFolders(list.map((f) => ({
          folderId: f.folder_id || f.id || '',
          folderName: f.folder_name || f.name || '',
          projectCount: counts[f.folder_id || f.id || ''] ?? Number(f.project_count) ?? 0,
          subfolderCount: Number(f.subfolder_count) || 0,
          subfolderPreview: Array.isArray(f.subfolder_preview)
            ? f.subfolder_preview.map((p: any) =>
                typeof p === 'string'
                  ? { name: p, kind: 'folder' as const }
                  : { name: p.name || '', kind: (p.kind === 'project' ? 'project' : 'folder') as 'folder' | 'project' })
            : [],
          createdAt: f.created_at || '',
        })));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadFolders();
    function onFoldersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== teamId) return;
      void loadFolders();
    }
    window.addEventListener('hdw:folders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:folders-updated', onFoldersUpdated);
    };
  }, [teamId]);

  // Fetch root-level team projects (folder_id IS NULL) from the local
  // SQLite workspace_projects table. Refreshes alongside folders on the
  // `hdw:folders-updated` event so a move/create stays in sync.
  useEffect(() => {
    if (!teamId) { setProjects([]); return; }
    let cancelled = false;
    const loadProjects = async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch(
          `/api/folders/root/projects?workspace_id=${encodeURIComponent(teamId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setProjects([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.projects ?? [];
        setProjects(list);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    };
    void loadProjects();
    function onFoldersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== teamId) return;
      void loadProjects();
    }
    window.addEventListener('hdw:folders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:folders-updated', onFoldersUpdated);
    };
  }, [teamId]);

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) { setCreateError(t('teamSpace.groupNameRequired')); return; }
    if (!teamId || !operatorMemberId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/hdw/webapi/v1/folder/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: teamId,
          folder_name: name,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setCreateError(body?.error || body?.msg || t('teamSpace.createGroupError'));
        return;
      }
      // Success — close dialog, reset input, refresh list.
      setNewGroupName('');
      onShowCreateGroupChange(false);
      window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }));
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemoveGroup() {
    const folder = removeTarget;
    if (!folder || !teamId || !operatorMemberId) return;
    setRemoving(true);
    setRemoveTarget(null);
    // Optimistic removal.
    setFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    try {
      const res = await fetch(
        `/api/hdw/webapi/v1/folder/${folder.folderId}?operator_member_id=${encodeURIComponent(operatorMemberId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        // Re-add on failure.
        setFolders((prev) => [...prev, folder]);
      } else {
        window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }));
      }
    } catch {
      setFolders((prev) => [...prev, folder]);
    } finally {
      setRemoving(false);
    }
  }

 function handleFolderClick(folder: TeamFolderItem) {
   navigate({
     kind: 'home',
     view: 'team-folder',
     teamId: teamId!,
     folderId: folder.folderId,
   });
 }

  function startFolderRename(folder: TeamFolderItem) {
    setRenameFolderInput(folder.folderName);
    setRenameFolderTarget(folder);
  }

  function cancelFolderRename() {
    setRenameFolderTarget(null);
    setRenameFolderInput('');
  }

  async function commitFolderRename() {
    if (!renameFolderTarget || !teamId || !operatorMemberId) return;
    const trimmed = renameFolderInput.trim();
    if (!trimmed || trimmed === renameFolderTarget.folderName) {
      cancelFolderRename();
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch('/api/hdw/webapi/v1/folder/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: renameFolderTarget.folderId,
          folder_name: trimmed,
          workspace_id: teamId,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) => prev.map((f) => f.folderId === renameFolderTarget.folderId ? { ...f, folderName: trimmed } : f));
        window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }));
      }
    } catch {
      // ignore
    } finally {
      setRenamingFolder(false);
      cancelFolderRename();
    }
  }

  return (
    <div className={styles.projectsWrap}>
      {/* <h2 className={styles.projectsTitle}>{t('teamSpace.projectGroupsTitle')}</h2> */}
      <div className={styles.folderList}>
        {loading ? (
          <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
        ) : folders.length === 0 ? (
          null
        ) : folders.map((folder) => (
           <article
              key={folder.folderId}
              className={styles.folderCard}
              role="button"
              tabIndex={0}
              onClick={() => handleFolderClick(folder)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFolderClick(folder); } }}
              title={folder.folderName}
            >
           {canManage ? (
             <FolderCardMenu
                onRename={() => startFolderRename(folder)}
               renameLabel={t('common.rename')}
               onDelete={() => setRemoveTarget(folder)}
               deleteLabel={t('teamSpace.deleteGroup')}
             />
           ) : null}
             <div className={styles.folderCardGrid}>
              {Array.from({ length: 4 }, (_, i) => {
                const item = folder.subfolderPreview[i];
                if (!item) {
                  return <div key={i} className={styles.gridCellEmpty} />;
                }
                if (item.kind === 'project') {
                  return (
                    <div key={i} className={`${styles.gridCell} ${styles.gridCellProject}`} title={item.name} />
                  );
                }
                return (
                  <div key={i} className={styles.gridCell} title={item.name}>
                    <svg viewBox="0 0 16 16" width="24" height="24" fill="none" className={styles.gridCellIcon} aria-hidden="true">
                      <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                      <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
                    </svg>
                  </div>
                );
              })}
             </div>
             <div className={styles.folderCardInfo}>
               <div className={styles.folderCardTitle}>
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" className={styles.folderIcon} aria-hidden="true">
                    <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                    <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
                 </svg>
                 <span className={styles.folderName}>{folder.folderName}</span>
              </div>
                <div className={styles.folderCardMeta}>
                  <div className={styles.folderCounts}>
                    <span className={styles.folderCount}>
                      {t('teamSpace.subFolderCount', { n: folder.subfolderCount })}
                    </span>
                    <span className={styles.folderCountDot} aria-hidden />
                    <span className={styles.folderCount}>
                      {t('teamSpace.projectGroupCount', { n: folder.projectCount })}
                    </span>
                  </div>
                </div>
             </div>
          </article>
         ))}
     </div>
      {/* Projects at the workspace root (folder_id IS NULL). Rendered
          below the folder cards so the two areas stay visually separate,
          mirroring the personal-all layout. */}
      <div className={styles.projectsSection}>
        {projectsLoading ? (
          <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
        ) : projects.length === 0 ? (
          null
        ) : (
          <RecentProjectsStrip
            projects={projects}
            designSystems={designSystems}
            limit={1000}
            heading={t('entry.navDrafts')}
            space="team"
            onOpen={(id) => onOpenProject?.(id)}
            onDelete={onDeleteProject}
            onRename={(id, name) => {
              setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
              onRenameProject?.(id, name);
            }}
            hideTitle
            controlsPortalTarget={controlsPortalTarget}
          />
        )}
      </div>
     {showCreateGroup ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => onShowCreateGroupChange(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.newProjectGroup')}</h3>
              <label className={styles.createLabel}>
                {t('teamSpace.newGroupNameLabel')}
                <input
                  className={styles.createInput}
                  value={newGroupName}
                  disabled={creating}
                  placeholder={t('teamSpace.newGroupNamePlaceholder')}
                  onChange={(e) => { setNewGroupName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateGroup(); } }}
                  autoFocus
                />
              </label>
              {createError ? <p className={styles.roleError}>{createError}</p> : null}
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => onShowCreateGroupChange(false)} disabled={creating}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={handleCreateGroup} disabled={creating}>
                  {t('teamSpace.createGroupBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {removeTarget ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setRemoveTarget(null)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteGroupConfirmTitle')}</h3>
              <p className={styles.confirmMsg}>{t('teamSpace.deleteGroupConfirmMsg')}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={confirmRemoveGroup} disabled={removing}>
                  {t('teamSpace.removeConfirmBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {renameFolderTarget ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={cancelFolderRename}
          closeOnEscape
          ariaLabelledBy={renameFolderTitleId}
          onSubmit={(e) => {
            e.preventDefault();
            void commitFolderRename();
          }}
        >
          <DialogTitle id={renameFolderTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: renameFolderTarget.folderName })}
            <input
              type="text"
              value={renameFolderInput}
              autoFocus
              onChange={(e) => setRenameFolderInput(e.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={cancelFolderRename}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameFolderInput.trim() || renameFolderInput.trim() === renameFolderTarget.folderName || renamingFolder}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
function MembersTable({ teamId, onInvite, operator }: { teamId?: string; onInvite?: () => void; operator: OperatorInfo | null }) {
  const t = useT();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);

  const operatorMemberId = operator?.memberId ?? null;
  const operatorRole = operator?.role ?? null;

  useEffect(() => {
    if (!teamId) { setMembers([]); return; }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/hdw/webapi/v1/team/${teamId}/members`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setMembers([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.members ?? [];
        setMembers(list.map((m) => ({
          workspaceMemberId: m.workspace_member_id || '',
          name: m.displayname || m.username || '',
          email: m.email || '',
          role: m.role as MemberRole,
          joinedAt: m.created_at || '',
        })));
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Refresh member list when an invite completes for this team.
  useEffect(() => {
    function onMembersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== teamId) return;
      setLoading(true);
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(`/api/hdw/webapi/v1/team/${teamId}/members`, { cache: 'no-store' });
          if (!res.ok) { if (!cancelled) return; }
         const body = await res.json();
         if (cancelled) return;
         const list: any[] = body?.data?.members ?? [];
          setMembers(list.map((m) => ({
            workspaceMemberId: m.workspace_member_id || '',
            name: m.displayname || m.username || '',
            email: m.email || '',
            role: m.role as MemberRole,
            joinedAt: m.created_at || '',
          })));
        } catch {
          // keep existing list on refresh error
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }
    window.addEventListener('hdw:members-updated', onMembersUpdated);
    return () => window.removeEventListener('hdw:members-updated', onMembersUpdated);
  }, [teamId]);

  // Permission logic mirrors HDW updateRole: owner/admin can change roles,
  // but owner role is never editable (needs transfer), and admin can only
  // change member-level roles (not other admins).
  function canChangeRole(member: TeamMember): boolean {
    if (member.role === 'owner') return false;
    if (!operatorRole || !operatorMemberId) return false;
    if (operatorRole === 'owner') return member.role === 'admin' || member.role === 'member' || member.role === 'guest';
    if (operatorRole === 'admin') return member.role === 'member' || member.role === 'guest';
    return false;
  }

  function canRemoveMember(member: TeamMember): boolean {
    if (!operatorRole || !operatorMemberId) return false;
    if (member.role === 'owner') return false;
    if (member.workspaceMemberId === operatorMemberId) return false;
    if (operatorRole === 'owner') return member.role === 'admin' || member.role === 'member' || member.role === 'guest';
    if (operatorRole === 'admin') return member.role === 'member' || member.role === 'guest';
    return false;
  }

  function requestRemove(member: TeamMember) {
    setRemoveTarget(member);
  }

  async function confirmRemove() {
    const member = removeTarget;
    if (!member || !operatorMemberId) return;
    setRemoveTarget(null);
    if (!operatorMemberId) return;
    // Optimistic removal.
    setMembers((prev) => prev.filter((m) => m.workspaceMemberId !== member.workspaceMemberId));
    setRoleError(null);
    try {
      const res = await fetch('/api/hdw/webapi/v1/team/member/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_member_id: member.workspaceMemberId,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        // Re-add on failure.
        setMembers((prev) => [...prev, member].sort((a, b) => a.name.localeCompare(b.name)));
        setRoleError(body?.error || body?.msg || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setMembers((prev) => [...prev, member].sort((a, b) => a.name.localeCompare(b.name)));
      setRoleError(err?.message || String(err));
    }
  }

  async function handleRoleChange(member: TeamMember, newRole: MemberRole) {
    if (!operatorMemberId || newRole === member.role) return;
    const prevRole = member.role;
    // Optimistic update.
    setMembers((prev) => prev.map((m) =>
      m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: newRole } : m,
    ));
    setRoleError(null);
    try {
      const res = await fetch('/api/hdw/webapi/v1/team/member/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_member_id: member.workspaceMemberId,
          role: newRole,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        // Revert on failure.
        setMembers((prev) => prev.map((m) =>
          m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: prevRole } : m,
        ));
        setRoleError(body?.error || body?.msg || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setMembers((prev) => prev.map((m) =>
        m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: prevRole } : m,
      ));
      setRoleError(err?.message || String(err));
    }
  }

  return (
    <div className={styles.membersWrap}>
      <div className={styles.membersToolbar}>
        <span className={styles.membersToolbarTitle}>{t('teamSpace.membersToolbar')}</span>
        <button type="button" className={styles.inviteBtn} onClick={onInvite}>
          <Icon name="plus" size={15} aria-hidden />
          <span>{t('teamSpace.inviteMember')}</span>
        </button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('teamSpace.colMember')}</th>
              <th>{t('teamSpace.colJoined')}</th>
              <th>{t('teamSpace.colRole')}</th>
              {(operatorRole === 'owner' || operatorRole === 'admin') ? <th>{t('teamSpace.colActions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4}>{t('teamSpace.loading')}</td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={4}>{t('teamSpace.noMembers')}</td></tr>
            ) : members.map((m) => {
              const initial = m.name.charAt(0).toUpperCase();
              const roleClass = styles[`role_${m.role}`] ?? '';
              const changeable = canChangeRole(m);
              const removable = canRemoveMember(m);
              return (
                <tr key={m.workspaceMemberId}>
                  <td>
                    <div className={styles.memberCell}>
                      <span
                        className={styles.avatar}
                        style={{ background: avatarColorFor(m.name) }}
                        aria-hidden
                      >{initial}</span>
                      <div className={styles.memberInfo}>
                        <span className={styles.memberName}>{m.name}</span>
                        <span className={styles.memberEmail}>{m.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className={styles.lastActiveCell}>
                    {formatJoinedDate(m.joinedAt)}
                  </td>
                  <td>
                    {changeable ? (
                      <select
                        className={`${styles.roleSelect} ${roleClass}`.trim()}
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value as MemberRole)}
                      >
                        <option value="admin">{t('teamSpace.roleAdmin')}</option>
                        <option value="member">{t('teamSpace.roleMember')}</option>
                        <option value="guest">{t('teamSpace.roleGuest')}</option>
                      </select>
                    ) : (
                      <span className={`${styles.roleTag} ${roleClass}`.trim()}>
                        {t(ROLE_KEY[m.role])}
                      </span>
                    )}
                  </td>
                  {(operatorRole === 'owner' || operatorRole === 'admin') ? (
                    <td className={styles.actionsCell}>
                     {removable ? (
                       <button
                         type="button"
                         className={styles.removeBtn}
                         onClick={() => requestRemove(m)}
                       >
                         {t('teamSpace.removeMember')}
                       </button>
                     ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {roleError ? <p className={styles.roleError}>{roleError}</p> : null}
      </div>
      {removeTarget ? (
        <div className={styles.confirmOverlay} onClick={() => setRemoveTarget(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.confirmTitle}>{t('teamSpace.removeConfirmTitle')}</h3>
            <p className={styles.confirmMsg}>{t('teamSpace.removeConfirmMsg')}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)}>
                {t('teamSpace.removeCancelBtn')}
              </button>
              <button type="button" className={styles.confirmOk} onClick={confirmRemove}>
                {t('teamSpace.removeConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folder view — /team/:teamId/folder/:folderId
// ---------------------------------------------------------------------------

interface FolderViewProps {
  teamId?: string;
  folderId?: string;
  designSystems?: DesignSystemSummary[];
  onOpenProject?: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onRenameProject?: (id: string, name: string) => void;
}

export function FolderView({ teamId, folderId, designSystems = [], onOpenProject, onDeleteProject, onRenameProject }: FolderViewProps) {
  const t = useT();
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(folderId));
  const [operator, setOperator] = useState<OperatorInfo | null>(null);
 const [showCreateFolder, setShowCreateFolder] = useState(false);

 // Bump when a folder rename event arrives so the breadcrumb refetches
 // without a route change.
 const [breadcrumbVersion, setBreadcrumbVersion] = useState(0);

 // Build breadcrumb path by walking up the folder_pid chain.
 useEffect(() => {
   if (!folderId || !teamId) { setBreadcrumb([]); setLoading(false); return; }
   setLoading(true);
   let cancelled = false;
   void (async () => {
     try {
       const path: BreadcrumbItem[] = [];
       let currentId: string | null = folderId;
       for (let i = 0; i < 20 && currentId; i++) {
         const res = await fetch(
           `/api/hdw/webapi/v1/folder/detail?folder_id=${encodeURIComponent(currentId)}`,
           { cache: 'no-store' },
         );
         if (!res.ok) break;
         const body: any = await res.json();
         if (cancelled) return;
         if (body?.code !== 0 || !body?.data) break;
         const folder: any = body.data;
         path.unshift({ folderId: folder.folder_id, folderName: folder.folder_name || '' });
         currentId = folder.folder_pid || null;
       }
       if (!cancelled) setBreadcrumb(path);
     } catch {
       // Leave empty breadcrumb.
     } finally {
       if (!cancelled) setLoading(false);
     }
   })();
   return () => { cancelled = true; };
 }, [folderId, teamId, breadcrumbVersion]);

 // Refresh breadcrumb when a folder is renamed from the left nav rail.
 useEffect(() => {
   if (!teamId) return;
   function onFoldersUpdated(e: Event) {
     const detail = (e as CustomEvent).detail;
     if (detail?.teamId === teamId) {
       setBreadcrumbVersion((v) => v + 1);
     }
   }
   window.addEventListener('hdw:folders-updated', onFoldersUpdated);
   return () => window.removeEventListener('hdw:folders-updated', onFoldersUpdated);
 }, [teamId]);

 // Resolve the team name from the workspace directory.
 useEffect(() => {
    if (!teamId) { setTeamName(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const match = body.items?.find((item) => item.workspaceId === teamId);
        setTeamName(match?.workspaceName ?? null);
      } catch {
        // ignore
     }
   })();
   return () => { cancelled = true; };
 }, [teamId]);

 // Update the team name in the breadcrumb without a refetch when a team
 // is renamed from the left nav rail.
 useEffect(() => {
   if (!teamId) return;
   function onTeamRenamed(e: Event) {
     const detail = (e as CustomEvent).detail;
     if (detail?.teamId === teamId && detail?.newName) {
       setTeamName(detail.newName);
     }
   }
   window.addEventListener('hdw:team-renamed', onTeamRenamed);
   return () => window.removeEventListener('hdw:team-renamed', onTeamRenamed);
 }, [teamId]);

 // Fetch the current user's operator info (same as TeamSpaceView).
 useEffect(() => {
   if (!teamId) { setOperator(null); return; }
    let cancelled = false;
    void (async () => {
      const username = getStoredUsername();
      if (!username) { if (!cancelled) setOperator(null); return; }
      try {
        const memberId = await getTeamMemberId(teamId, username);
        const res = await fetch(
          `/api/hdw/webapi/v1/team/${teamId}/member/${memberId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setOperator(null); return; }
        const body = await res.json();
        if (cancelled) return;
        if (body?.code === 0 && body?.data) {
          setOperator({
            memberId: body.data.workspace_member_id,
            role: body.data.role as MemberRole,
          });
        } else {
          setOperator(null);
        }
      } catch {
        if (!cancelled) setOperator(null);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const currentFolderName = breadcrumb.length > 0 ? (breadcrumb[breadcrumb.length - 1]?.folderName ?? '').trim() : '';
  const title = currentFolderName || t('teamSpace.folderSubtitle');

  if (loading) {
    return (
      <section className={styles.view}>
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="folder-view-title">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 id="folder-view-title" className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>
            <span className={styles.dot} aria-hidden />
           {t('teamSpace.folderSubtitle')}
         </span>
       </div>
      <div className={styles.headerActions}>
        <button
          type="button"
          className={styles.inviteBtn}
          onClick={() => setShowCreateFolder(true)}
        >
          <Icon name="plus" size={15} aria-hidden />
          <span>{t('teamSpace.newSubFolder')}</span>
        </button>
        <button
          type="button"
          className={styles.refreshBtn}
          title={t('recentProjects.refresh')}
          aria-label={t('recentProjects.refresh')}
          onClick={() => window.dispatchEvent(new CustomEvent('hdw:folders-updated', { detail: { teamId } }))}
        >
          <Icon name="refresh" size={16} aria-hidden />
        </button>
      </div>
     </header>


      <div className={styles.content} role="tabpanel">
        <FoldersPanel
          teamId={teamId}
          folderId={folderId}
          operator={operator}
          showCreateFolder={showCreateFolder}
          onShowCreateFolderChange={setShowCreateFolder}
          breadcrumb={breadcrumb}
          teamName={teamName}
          designSystems={designSystems}
          onOpenProject={onOpenProject}
          onDeleteProject={onDeleteProject}
          onRenameProject={onRenameProject}
        />
      </div>
    </section>
  );
}

function FoldersPanel({
  teamId,
  folderId,
  operator,
  showCreateFolder,
  onShowCreateFolderChange,
  breadcrumb,
  teamName,
  designSystems = [],
  onOpenProject,
  onDeleteProject,
  onRenameProject,
}: {
  teamId?: string;
  folderId?: string;
  operator: OperatorInfo | null;
  showCreateFolder: boolean;
  onShowCreateFolderChange: (v: boolean) => void;
  breadcrumb: BreadcrumbItem[];
  teamName: string | null;
  designSystems?: DesignSystemSummary[];
  onOpenProject?: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<boolean | void> | boolean | void;
  onRenameProject?: (id: string, name: string) => void;
}) {
  const t = useT();
  const [folders, setFolders] = useState<TeamFolderItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamFolderItem | null>(null);
  const [removing, setRemoving] = useState(false);

  const operatorMemberId = operator?.memberId ?? null;
  const operatorRole = operator?.role ?? null;
 const canManage = operatorRole === 'owner' || operatorRole === 'admin';

  const [renameFolderTarget, setRenameFolderTarget] = useState<TeamFolderItem | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const renameFolderTitleId = useId();

 // Fetch subfolders whose folder_pid equals the current folderId.
  useEffect(() => {
    if (!teamId || !folderId) { setFolders([]); return; }
    let cancelled = false;
    const loadFolders = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/hdw/webapi/v1/folder/list?workspace_id=${encodeURIComponent(teamId)}&folder_pid=${encodeURIComponent(folderId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        // The HDW folder list doesn't include project_count, so fetch local
        // batch counts and merge them into the folder items.
        let counts: Record<string, number> = {};
        try {
          const countsRes = await fetch(
            `/api/folders/counts?workspace_id=${encodeURIComponent(teamId)}`,
          { cache: 'no-store' },
          );
          if (countsRes.ok) {
            const countsBody = await countsRes.json();
            counts = countsBody?.data?.counts ?? {};
          }
        } catch { /* counts stay empty */ }
        if (cancelled) return;
        setFolders(list.map((f) => ({
          folderId: f.folder_id || f.id || '',
          folderName: f.folder_name || f.name || '',
          projectCount: counts[f.folder_id || f.id || ''] ?? Number(f.project_count) ?? 0,
          subfolderCount: Number(f.subfolder_count) || 0,
          subfolderPreview: Array.isArray(f.subfolder_preview)
            ? f.subfolder_preview.map((p: any) =>
                typeof p === 'string'
                  ? { name: p, kind: 'folder' as const }
                  : { name: p.name || '', kind: (p.kind === 'project' ? 'project' : 'folder') as 'folder' | 'project' })
            : [],
          createdAt: f.created_at || '',
        })));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadFolders();
   function onFoldersUpdated(e: Event) {
     const detail = (e as CustomEvent).detail;
     if (detail?.folderId != null && detail?.folderId !== folderId) return;
    void loadFolders();
   }
   window.addEventListener('hdw:subfolders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:subfolders-updated', onFoldersUpdated);
    };
  }, [teamId, folderId]);

  // Fetch projects directly inside this folder (folder_id = folderId)
  // from the local SQLite workspace_projects table. Refreshes alongside
  // subfolders on the `hdw:subfolders-updated` event.
  useEffect(() => {
    if (!teamId || !folderId) { setProjects([]); return; }
    let cancelled = false;
    const loadProjects = async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch(
          `/api/folders/${encodeURIComponent(folderId)}/projects?workspace_id=${encodeURIComponent(teamId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setProjects([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.projects ?? [];
        setProjects(list);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    };
    void loadProjects();
    function onFoldersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.folderId !== folderId) return;
      void loadProjects();
    }
    window.addEventListener('hdw:subfolders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('hdw:subfolders-updated', onFoldersUpdated);
    };
  }, [teamId, folderId]);

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) { setCreateError(t('teamSpace.folderNameRequired')); return; }
    if (!teamId || !folderId || !operatorMemberId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/hdw/webapi/v1/folder/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: teamId,
          folder_pid: folderId,
          folder_name: name,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setCreateError(body?.error || body?.msg || t('teamSpace.createFolderError'));
        return;
      }
      setNewFolderName('');
      onShowCreateFolderChange(false);
      window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', { detail: { teamId, folderId } }));
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemoveFolder() {
    const folder = removeTarget;
    if (!folder || !teamId || !operatorMemberId) return;
    setRemoving(true);
    setRemoveTarget(null);
    setFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    try {
      const res = await fetch(
        `/api/hdw/webapi/v1/folder/${folder.folderId}?operator_member_id=${encodeURIComponent(operatorMemberId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setFolders((prev) => [...prev, folder]);
      } else {
        window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', { detail: { teamId, folderId } }));
      }
    } catch {
      setFolders((prev) => [...prev, folder]);
    } finally {
      setRemoving(false);
    }
  }

 function handleFolderClick(folder: TeamFolderItem) {
   navigate({
     kind: 'home',
     view: 'team-folder',
     teamId: teamId!,
     folderId: folder.folderId,
   });
 }

  function startFolderRename(folder: TeamFolderItem) {
    setRenameFolderInput(folder.folderName);
    setRenameFolderTarget(folder);
  }

  function cancelFolderRename() {
    setRenameFolderTarget(null);
    setRenameFolderInput('');
  }

  async function commitFolderRename() {
    if (!renameFolderTarget || !teamId || !folderId || !operatorMemberId) return;
    const trimmed = renameFolderInput.trim();
    if (!trimmed || trimmed === renameFolderTarget.folderName) {
      cancelFolderRename();
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch('/api/hdw/webapi/v1/folder/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: renameFolderTarget.folderId,
          folder_name: trimmed,
          workspace_id: teamId,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) => prev.map((f) => f.folderId === renameFolderTarget.folderId ? { ...f, folderName: trimmed } : f));
        window.dispatchEvent(new CustomEvent('hdw:subfolders-updated', { detail: { teamId, folderId } }));
      }
    } catch {
      // ignore
    } finally {
      setRenamingFolder(false);
      cancelFolderRename();
    }
  }

  return (
    <div className={styles.projectsWrap}>
      <nav className={styles.breadcrumb} aria-label="breadcrumb">
        <button
          type="button"
          className={styles.breadcrumbItem}
          onClick={() => navigate({ kind: 'home', view: 'team-space', teamId: teamId! })}
        >
          {teamName?.trim() || t('teamSpace.folderSubtitle')}
        </button>
        {breadcrumb.slice(0, -1).map((item) => (
          <Fragment key={item.folderId}>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              <Icon name="chevron-right" size={14} />
            </span>
            <button
              type="button"
              className={styles.breadcrumbItem}
              onClick={() => navigate({ kind: 'home', view: 'team-folder', teamId: teamId!, folderId: item.folderId })}
            >
              {item.folderName}
            </button>
          </Fragment>
        ))}
        {breadcrumb.length > 0 ? (
          <>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              <Icon name="chevron-right" size={14} />
            </span>
            <span className={styles.breadcrumbCurrent}>
              {breadcrumb[breadcrumb.length - 1]?.folderName}
            </span>
          </>
        ) : null}
      </nav>
      {folders?.length?<div className={styles.folderList}>
        {loading ? (
          <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
        ) : folders.length === 0 ? (
          null
        ) : folders.map((folder) => (
          <article
            key={folder.folderId}
            className={styles.folderCard}
            role="button"
            tabIndex={0}
            onClick={() => handleFolderClick(folder)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFolderClick(folder); } }}
            title={folder.folderName}
          >
           {canManage ? (
             <FolderCardMenu
                onRename={() => startFolderRename(folder)}
               renameLabel={t('common.rename')}
               onDelete={() => setRemoveTarget(folder)}
               deleteLabel={t('teamSpace.deleteFolder')}
             />
           ) : null}
           <div className={styles.folderCardGrid}>
             {Array.from({ length: 4 }, (_, i) => {
               const item = folder.subfolderPreview[i];
               if (!item) {
                 return <div key={i} className={styles.gridCellEmpty} />;
               }
               if (item.kind === 'project') {
                 return (
                   <div key={i} className={`${styles.gridCell} ${styles.gridCellProject}`} title={item.name} />
                 );
               }
               return (
                 <div key={i} className={styles.gridCell} title={item.name}>
                   <svg viewBox="0 0 16 16" width="24" height="24" fill="none" className={styles.gridCellIcon} aria-hidden="true">
                     <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                     <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
                   </svg>
                 </div>
               );
             })}
           </div>
           <div className={styles.folderCardInfo}>
             <div className={styles.folderCardTitle}>
               <svg viewBox="0 0 16 16" width="16" height="16" fill="none" className={styles.folderIcon} aria-hidden="true">
                 <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
              </svg>
              <span className={styles.folderName}>{folder.folderName}</span>
            </div>
             <div className={styles.folderCardMeta}>
                <div className={styles.folderCounts}>
                  <span className={styles.folderCount}>
                    {t('teamSpace.subFolderCount', { n: folder.subfolderCount })}
                  </span>
                  <span className={styles.folderCountDot} aria-hidden="true" />
                  <span className={styles.folderCount}>
                    {t('teamSpace.projectGroupCount', { n: folder.projectCount })}
                  </span>
                </div>
              </div>
           </div>
        </article>
       ))}
     </div>:null}
      {/* Projects directly inside this folder (folder_id = folderId).
          Rendered below the subfolder cards so the two areas stay
          visually separate, mirroring the personal-folder layout. */}
      <div className={styles.projectsSection}>
        {projectsLoading ? (
          <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
        ) : projects.length === 0 ? (
          null
        ) : (
          <RecentProjectsStrip
            projects={projects}
            designSystems={designSystems}
            limit={1000}
            heading={t('entry.navDrafts')}
            space="team"
            onOpen={(id) => onOpenProject?.(id)}
            onDelete={onDeleteProject}
            onRename={(id, name) => {
              setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
              onRenameProject?.(id, name);
            }}
            hideTitle
          />
        )}
      </div>
      {showCreateFolder ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => onShowCreateFolderChange(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.newSubFolder')}</h3>
              <label className={styles.createLabel}>
                {t('teamSpace.newFolderNameLabel')}
                <input
                  className={styles.createInput}
                  value={newFolderName}
                  disabled={creating}
                  placeholder={t('teamSpace.newFolderNamePlaceholder')}
                  onChange={(e) => { setNewFolderName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateFolder(); } }}
                  autoFocus
                />
              </label>
              {createError ? <p className={styles.roleError}>{createError}</p> : null}
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => onShowCreateFolderChange(false)} disabled={creating}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={handleCreateFolder} disabled={creating}>
                  {t('teamSpace.createFolderBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {removeTarget ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => setRemoveTarget(null)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.deleteFolderConfirmTitle')}</h3>
              <p className={styles.confirmMsg}>{t('teamSpace.deleteFolderConfirmMsg')}</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)} disabled={removing}>
                  {t('teamSpace.removeCancelBtn')}
                </button>
                <button type="button" className={styles.confirmOk} onClick={confirmRemoveFolder} disabled={removing}>
                  {t('teamSpace.deleteFolder')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
      {renameFolderTarget ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={cancelFolderRename}
          closeOnEscape
          ariaLabelledBy={renameFolderTitleId}
          onSubmit={(e) => {
            e.preventDefault();
            void commitFolderRename();
          }}
        >
          <DialogTitle id={renameFolderTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: renameFolderTarget.folderName })}
            <input
              type="text"
              value={renameFolderInput}
              autoFocus
              onChange={(e) => setRenameFolderInput(e.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={cancelFolderRename}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameFolderInput.trim() || renameFolderInput.trim() === renameFolderTarget.folderName || renamingFolder}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
