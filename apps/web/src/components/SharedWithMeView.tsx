// Scope view for the "/share-me" route. Fetches projects shared to
// the current user via the Shared Space and renders them with
// RecentProjectsStrip. Shared-space projects are read + comment only —
// the card menu hides edit/delete/move actions.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedWithMeProject } from '@open-design/contracts';
import type { ProjectTitleHint } from './EntryShell';
import { Icon, type IconName } from './Icon';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { Project } from '../types';
import { fetchSharedWithMeCatalog } from '../collab/shared-space-catalog';
import styles from './TeamSpaceView.module.css';

type ScopeTab = 'projects' | 'skill' | 'mcp';

interface TabDef {
  id: ScopeTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'personalScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'personalScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'personalScope.tabMcp' },
];

/** Convert a shared-with-me row to the local Project shape. */
function sharedRowToProject(row: SharedWithMeProject): Project {
  const sharedAtMs = Date.parse(row.sharedAt);
  const fallback = Number.isFinite(sharedAtMs) ? sharedAtMs : 0;
  return {
    id: row.projectId,
    name: row.displayName?.trim() || '',
    skillId: null,
    designSystemId: null,
    createdAt: fallback,
    updatedAt: fallback,
   createdByWorkspaceMemberId: row.ownerMemberId ?? null,
    ownerDisplayName: row.sharedByDisplayname ?? null,
   ...(row.metadata ? { metadata: row.metadata as unknown as Project['metadata'] } : {}),
  };
}

export function SharedWithMeView({
  onOpenProject,
}: {
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
}) {
 const t = useT();
  const { context: workspaceContext } = useWorkspaceContext();
  // Pass the current user's shared-space member ID + role as the operator so
  // RecentProjectsStrip does strict ownership comparison instead of the
  // isDefaultTeam shortcut (which would label every project "我").
  const operator = workspaceContext?.workspaceMemberId
    ? {
        memberId: workspaceContext.workspaceMemberId,
        role: (workspaceContext.role ?? 'member') as 'owner' | 'admin' | 'member' | 'guest',
      }
    : null;
 const [activeTab, setActiveTab] = useState<ScopeTab>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const title = t('sharedSpace.title');
  const subtitle = t('sharedSpace.subtitle');

  // Keep the latest shared-with-me rows so the open handler can look up
  // homeWorkspaceId for the clicked project.
  const sharedRowsRef = useRef<SharedWithMeProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rows = await fetchSharedWithMeCatalog();
        if (cancelled) return;
        setProjects(rows.map((r) => sharedRowToProject(r)));
        // Stash the raw rows so the open handler can build a hint with
        // homeWorkspaceId — the workspace the project actually lives in,
        // which is NOT the shared space.
        if (!cancelled) sharedRowsRef.current = rows;
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    function onRefresh() {
      void load();
    }
    window.addEventListener('shared:projects-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('shared:projects-refresh', onRefresh);
    };
  }, []);
  const handleOpen = useCallback(
    (id: string) => {
      const row = sharedRowsRef.current.find((r) => r.projectId === id);
      const hint: ProjectTitleHint | undefined = row
        ? {
            name: row.displayName?.trim() || '',
            workspaceId: workspaceContext?.workspaceId ?? null,
            workspaceMemberId: workspaceContext?.workspaceMemberId ?? null,
            authoritative: true,
            homeWorkspaceId: row.homeWorkspaceId,
          }
        : undefined;
      return onOpenProject(id, undefined, hint);
    },
    [onOpenProject, workspaceContext],
  );

  const activeDef = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <section className={styles.view} aria-labelledby="shared-with-me-title">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 id="shared-with-me-title" className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>
            <span className={styles.dot} aria-hidden />
            {subtitle}
          </span>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshBtn}
            title={t('recentProjects.refresh')}
            aria-label={t('recentProjects.refresh')}
            onClick={() => window.dispatchEvent(new CustomEvent('shared:projects-refresh'))}
          >
            <Icon name="refresh" size={16} aria-hidden />
          </button>
        </div>
      </header>

      <div className={styles.typeTabs} role="tablist">
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
          loading ? (
            <div className={styles.panel}>
              <span className={styles.panelIcon} aria-hidden>
                <Icon name="folder" size={32} />
              </span>
              <p className={styles.panelNote}>{t('sharedSpace.loadingProjects')}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.panel}>
              <span className={styles.panelIcon} aria-hidden>
                <Icon name="folder" size={32} />
              </span>
              <h2 className={styles.panelTitle}>{t('personalScope.tabProjects')}</h2>
              <p className={styles.panelNote}>{t('sharedSpace.emptyNote')}</p>
            </div>
          ) : (
           <RecentProjectsStrip
             projects={projects}
             heading=""
             space="team"
              operator={operator}
             onOpen={handleOpen}
           />
          )
        ) : (
          <div className={styles.panel}>
            <span className={styles.panelIcon} aria-hidden>
              <Icon name={activeDef.icon} size={32} />
            </span>
            <h2 className={styles.panelTitle}>{t(activeDef.labelKey)}</h2>
            <p className={styles.panelNote}>{t('personalScope.emptyNoteShared')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
