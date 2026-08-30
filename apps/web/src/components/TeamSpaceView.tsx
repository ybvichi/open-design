import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import styles from './TeamSpaceView.module.css';

type TeamTab = 'projects' | 'members' | 'resources' | 'trash';

interface TabDef {
  id: TeamTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'teamSpace.tabProjects' },
  { id: 'members', icon: 'users', labelKey: 'teamSpace.tabMembers' },
  { id: 'resources', icon: 'layers-filled', labelKey: 'teamSpace.tabResources' },
  { id: 'trash', icon: 'trash', labelKey: 'teamSpace.tabTrash' },
];

interface Props {
  teamId?: string;
}

export function TeamSpaceView({ teamId }: Props) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TeamTab>('projects');
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(teamId));

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
      } catch {
        // Leave the fallback title in place.
      } finally {
        if (!cancelled) setLoading(false);
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
          <PlaceholderPanel icon="folder" label={t('teamSpace.tabProjects')} note={t('teamSpace.projectsNote')} />
        ) : null}
        {activeTab === 'members' ? (
          <PlaceholderPanel icon="users" label={t('teamSpace.tabMembers')} note={t('teamSpace.membersNote')} />
        ) : null}
        {activeTab === 'resources' ? (
          <PlaceholderPanel icon="layers-filled" label={t('teamSpace.tabResources')} note={t('teamSpace.resourcesNote')} />
        ) : null}
        {activeTab === 'trash' ? (
          <PlaceholderPanel icon="trash" label={t('teamSpace.tabTrash')} note={t('teamSpace.trashNote')} />
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
