// Scope view for the "/personal-all" route. Mirrors TeamSpaceView's layout
// (header + subtitle + type tabs + projects panel with folder cards) and
// reuses its CSS module so the surface stays visually consistent across
// scope pages. Folder CRUD operates on the local SQLite `folders` table
// via `/api/folders` instead of the HDW proxy.
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import { navigate } from '../router';
import { Icon, type IconName } from './Icon';
import { FolderCardMenu } from './FolderCardMenu';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import type { DesignSystemSummary, Project } from '../types';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import styles from './TeamSpaceView.module.css';
 
 const FOLDER_CONTEXT_KEY = 'od:home-folder-context';

type ScopeTab = 'projects' | 'skill' | 'mcp' | 'experts';

interface TabDef {
  id: ScopeTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'personalScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'personalScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'personalScope.tabMcp' },
  { id: 'experts', icon: 'robot', labelKey: 'personalScope.tabExperts' },
];

interface PersonalFolderItem {
  folderId: string;
  folderName: string;
  projectCount: number;
  subfolderCount: number;
  subfolderPreview: Array<{ name: string; kind: 'folder' | 'project' }>;
  createdAt: string;
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

function PersonalProjectsPanel({
  workspaceId,
  showCreateGroup,
  onShowCreateGroupChange,
  designSystems,
  onOpenProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
  controlsPortalTarget,
}: {
  workspaceId: string | null;
  showCreateGroup: boolean;
  onShowCreateGroupChange: (v: boolean) => void;
  designSystems: DesignSystemSummary[];
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
  onRenameProject: (id: string, name: string) => void;
  controlsPortalTarget?: HTMLElement | null;
}) {
  const t = useT();
  const [folders, setFolders] = useState<PersonalFolderItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
 const [removeTarget, setRemoveTarget] = useState<PersonalFolderItem | null>(null);
 const [removing, setRemoving] = useState(false);

  const [renameFolderTarget, setRenameFolderTarget] = useState<PersonalFolderItem | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const renameFolderTitleId = useId();

 // Fetch root-level folders from the local SQLite folders table, and
 // refresh when a create/delete dispatches the `personal:folders-updated`
 // event.
  useEffect(() => {
    if (!workspaceId) { setFolders([]); return; }
    let cancelled = false;
    const loadFolders = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.folders ?? [];
        setFolders(list.map((f) => ({
          folderId: f.folder_id || f.id || '',
          folderName: f.folder_name || f.name || '',
          projectCount: Number(f.project_count) || 0,
          subfolderCount: Number(f.subfolder_count) || 0,
          subfolderPreview: Array.isArray(f.subfolder_preview)
            ? f.subfolder_preview.map((p: any) =>
                typeof p === 'string'
                  ? { name: p, kind: 'folder' as const }
                  : { name: p.name || '', kind: (p.kind === 'project' ? 'project' : 'folder') as 'folder' | 'project' })
            : [],
          createdAt: f.created_at || '',
        })))
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
   };
   void loadFolders();
   function onFoldersUpdated() {
     void loadFolders();
   }
   window.addEventListener('personal:folders-updated', onFoldersUpdated);
   return () => {
     cancelled = true;
     window.removeEventListener('personal:folders-updated', onFoldersUpdated);
   };
 }, [workspaceId]);

  // Fetch root-level projects (folder_id IS NULL) from the local SQLite
  // workspace_projects table. Refreshes alongside folders on the
  // `personal:folders-updated` event so a move/create stays in sync.
  useEffect(() => {
    if (!workspaceId) { setProjects([]); return; }
    let cancelled = false;
    const loadProjects = async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch(
          `/api/folders/root/projects?workspace_id=${encodeURIComponent(workspaceId)}`,
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
    function onFoldersUpdated() {
      void loadProjects();
    }
    window.addEventListener('personal:folders-updated', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('personal:folders-updated', onFoldersUpdated);
    };
  }, [workspaceId]);

 async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) { setCreateError(t('teamSpace.folderNameRequired')); return; }
    if (!workspaceId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          folder_name: name,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setCreateError(body?.error || body?.msg || t('teamSpace.createGroupError'));
        return;
      }
      setNewGroupName('');
      onShowCreateGroupChange(false);
      window.dispatchEvent(new CustomEvent('personal:folders-updated'));
    } catch (err: any) {
      setCreateError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemoveGroup() {
    const folder = removeTarget;
    if (!folder || !workspaceId) return;
    setRemoving(true);
    setRemoveTarget(null);
    setFolders((prev) => prev.filter((f) => f.folderId !== folder.folderId));
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(folder.folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        setFolders((prev) => [...prev, folder]);
      } else {
        window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      }
    } catch {
      setFolders((prev) => [...prev, folder]);
    } finally {
      setRemoving(false);
    }
  }

function handleFolderClick(folder: PersonalFolderItem) {
  if (!workspaceId) return;
  navigate({
    kind: 'home',
    view: 'personal-folder',
    folderId: folder.folderId,
  });
}

  function startFolderRename(folder: PersonalFolderItem) {
    setRenameFolderInput(folder.folderName);
    setRenameFolderTarget(folder);
  }

  function cancelFolderRename() {
    setRenameFolderTarget(null);
    setRenameFolderInput('');
  }

  async function commitFolderRename() {
    if (!renameFolderTarget || !workspaceId) return;
    const trimmed = renameFolderInput.trim();
    if (!trimmed || trimmed === renameFolderTarget.folderName) {
      cancelFolderRename();
      return;
    }
    setRenamingFolder(true);
    try {
      const res = await fetch(
        `/api/folders/${encodeURIComponent(renameFolderTarget.folderId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_name: trimmed }),
        },
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body?.code === 0) {
        setFolders((prev) => prev.map((f) => f.folderId === renameFolderTarget.folderId ? { ...f, folderName: trimmed } : f));
        window.dispatchEvent(new CustomEvent('personal:folders-updated'));
      }
    } catch {
      // ignore
    } finally {
      setRenamingFolder(false);
      cancelFolderRename();
    }
  }

  if (!workspaceId) {
    return (
      <div className={styles.projectsWrap}>
        <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
      </div>
    );
  }

  return (
    <div className={styles.projectsWrap}>
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
          <FolderCardMenu
            onRename={() => startFolderRename(folder)}
            renameLabel={t('common.rename')}
            onDelete={() => setRemoveTarget(folder)}
            deleteLabel={t('teamSpace.deleteGroup')}
          />
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
          below the folder cards so the two areas stay visually separate. */}
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
          space="drafts"
         onOpen={(id) => onOpenProject(id)}
         onDelete={onDeleteProject}
         onDuplicate={onDuplicateProject}
        onRename={(id, name) => {
          setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
          onRenameProject?.(id, name);
        }}
         hideTitle
          currentWorkspaceId={workspaceId}
          currentFolderId={null}
          controlsPortalTarget={controlsPortalTarget}
       />
        )}
      </div>
      {showCreateGroup ? (
        createPortal(
          <div className={styles.confirmOverlay} onClick={() => onShowCreateGroupChange(false)}>
            <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.confirmTitle}>{t('teamSpace.newSubFolder')}</h3>
              <label className={styles.createLabel}>
                {t('teamSpace.newFolderNameLabel')}
                <input
                  className={styles.createInput}
                  value={newGroupName}
                  disabled={creating}
                  placeholder={t('teamSpace.newFolderNamePlaceholder')}
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

export function PersonalAllView({
  designSystems = [],
  onOpenProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
}: {
  designSystems?: DesignSystemSummary[];
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
  onRenameProject: (id: string, name: string) => void;
}) {
  const t = useT();
 const [activeTab, setActiveTab] = useState<ScopeTab>('projects');
 const [workspaceId, setWorkspaceId] = useState<string | null>(null);
const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [typeTabsEl, setTypeTabsEl] = useState<HTMLDivElement | null>(null);

 // Resolve the personal workspace ID from the workspace directory.
  // The personal workspace is the "个人空间" default team — the directory
  // item with isDefaultTeam === true.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const personal = body.items?.find((item) => item.isDefaultTeam === true);
        setWorkspaceId(personal?.workspaceId ?? null);
      } catch {
        // leave workspaceId null
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const title = t('personalFunc.all');
  const subtitle = t('personalScope.subtitlePersonal');

  // activeTab is always a value from `tabs` (starts at 'projects', only set
  // via tab buttons), so the find is guaranteed to match.
  const activeDef = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <section className={styles.view} aria-labelledby="personal-all-title">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 id="personal-all-title" className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>
            <span className={styles.dot} aria-hidden />
            {subtitle}
          </span>
        </div>
        <div className={styles.headerActions}>
          {activeTab === 'projects' && workspaceId ? (
            <>
              <button
                type="button"
                className={styles.inviteBtn}
                onClick={() => {
                  localStorage.removeItem(FOLDER_CONTEXT_KEY);
                  navigate({ kind: 'home', view: 'home' });
                }}
              >
                <Icon name="plus" size={15} aria-hidden />
                <span>{t('entry.navNewProject')}</span>
              </button>
              <button
                type="button"
                className={styles.inviteBtn}
                onClick={() => setShowCreateGroup(true)}
              >
                <Icon name="plus" size={15} aria-hidden />
                <span>{t('teamSpace.newSubFolder')}</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={styles.refreshBtn}
            title={t('recentProjects.refresh')}
            aria-label={t('recentProjects.refresh')}
            onClick={() => window.dispatchEvent(new CustomEvent('personal:folders-updated'))}
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
        <PersonalProjectsPanel
          controlsPortalTarget={typeTabsEl}
          workspaceId={workspaceId}
          showCreateGroup={showCreateGroup}
          onShowCreateGroupChange={setShowCreateGroup}
          designSystems={designSystems}
         onOpenProject={onOpenProject}
         onDeleteProject={onDeleteProject}
         onDuplicateProject={onDuplicateProject}
         onRenameProject={onRenameProject}
        />
        ) : (
          <PlaceholderPanel
            icon={activeDef.icon}
            label={t(activeDef.labelKey)}
            note={t('personalScope.emptyNotePersonal')}
          />
        )}
      </div>
    </section>
  );
}
