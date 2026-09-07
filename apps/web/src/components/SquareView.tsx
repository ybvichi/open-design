// Hi广场 — community plaza surface.
//
// Reached from the nav rail's "Hi广场" item under Community. Mirrors
// PersonalAllView's layout (header + subtitle + type tabs + content
// panel) and reuses TeamSpaceView.module.css so the surface stays
// visually consistent across scope pages. Tabs: 项目 / Skill / MCP / 工具.

import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import styles from './TeamSpaceView.module.css';

type SquareTab = 'projects' | 'skill' | 'mcp' | 'tool';

interface TabDef {
  id: SquareTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'squareScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'squareScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'squareScope.tabMcp' },
  { id: 'tool', icon: 'puzzle', labelKey: 'squareScope.tabTool' },
];

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

export function SquareView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SquareTab>('projects');

  const title = t('entry.navPlaza');
  const subtitle = t('squareScope.subtitle');

  // activeTab is always a value from `tabs` (starts at 'projects', only set
  // via tab buttons), so the find is guaranteed to match.
  const activeDef = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <section className={styles.view} aria-labelledby="square-title" data-testid="square-view">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 id="square-title" className={styles.title}>{title}</h1>
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
        <PlaceholderPanel
          icon={activeDef.icon}
          label={t(activeDef.labelKey)}
          note={t('squareScope.emptyNote')}
        />
      </div>
    </section>
  );
}
