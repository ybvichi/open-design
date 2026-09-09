// Scope view for the "/shared-with-me" route. Fetches projects shared to
// the current user via the Shared Space and renders them with
// RecentProjectsStrip. Shared-space projects are read + comment only —
// the card menu hides edit/delete/move actions.
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { RecentProjectsStrip } from './RecentProjectsStrip';
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

/** Shared-with-me project row from the daemon. Mirrors HdwSharedWithMeProject. */
interface SharedProjectRow {
  shareId: string;
  projectId: string;
  homeWorkspaceId: string;
  sharedByUsername: string;
  sharedAt: string;
  resourceId: string | null;
  ownerMemberId: string | null;
  displayName: string | null;
  syncState: string;
 folderId: string | null;
 metadata: Record<string, unknown> | null;
 lastSyncedVersionId: string | null;
 access: {
    canView: boolean;
    canComment: boolean;
    canEdit: boolean;
    frozen: boolean;
  };
}

/** Convert a shared-with-me row to the local Project shape. */
function sharedRowToProject(row: SharedProjectRow): Project {
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
    ownerDisplayName: row.sharedByUsername ?? null,
    ...(row.metadata ? { metadata: row.metadata as unknown as Project['metadata'] } : {}),
  };
}

export function SharedWithMeView({
  onOpenProject,
}: {
  onOpenProject: (id: string) => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<ScopeTab>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const title = t('sharedSpace.title');
  const subtitle = t('sharedSpace.subtitle');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rows = await fetchSharedWithMeCatalog();
        if (cancelled) return;
        setProjects(rows.map((r) => sharedRowToProject(r as unknown as SharedProjectRow)));
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
              onOpen={onOpenProject}
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
