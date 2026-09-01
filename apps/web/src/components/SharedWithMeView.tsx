// Scope view for the "/shared-with-me" route. Mirrors TeamSpaceView's layout
// (header + subtitle + type tabs + placeholder panel) and reuses its CSS
// module so the surface stays visually consistent across scope pages.
import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import styles from './TeamSpaceView.module.css';

type ScopeTab = 'all' | 'projects' | 'folders' | 'skill' | 'mcp';

interface TabDef {
  id: ScopeTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'all', icon: 'grid', labelKey: 'personalScope.tabAll' },
  { id: 'projects', icon: 'folder', labelKey: 'personalScope.tabProjects' },
  { id: 'folders', icon: 'folder-filled', labelKey: 'personalScope.tabFolders' },
  { id: 'skill', icon: 'sparkles', labelKey: 'personalScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'personalScope.tabMcp' },
];

export function SharedWithMeView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<ScopeTab>('all');

  const title = t('personalFunc.shared');
  const subtitle = t('personalScope.subtitleShared');
  const emptyNote = t('personalScope.emptyNoteShared');

  // activeTab is always a value from `tabs` (starts at 'all', only set via
  // tab buttons), so the find is guaranteed to match.
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
        <div className={styles.panel}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name={activeDef.icon} size={32} />
          </span>
          <h2 className={styles.panelTitle}>{t(activeDef.labelKey)}</h2>
          <p className={styles.panelNote}>{emptyNote}</p>
        </div>
      </div>
    </section>
  );
}
