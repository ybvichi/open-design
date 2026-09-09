// Hi广场 — community plaza surface.
//
// Reached from the nav rail's "Hi广场" item under Community. Mirrors
// PersonalAllView's layout (header + subtitle + type tabs + content
// panel) and reuses TeamSpaceView.module.css so the surface stays
// visually consistent across scope pages. Tabs: 项目 / Skill / MCP / 工具.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PreviewModal } from './PreviewModal';
import type { MarketplacePluginEntry } from '@open-design/contracts';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { navigate } from '../router';
import { remixHdwPlugin } from '../state/projects';
import {
  createCommunityReferenceHandoff,
  stashHomePromptHandoff,
} from './home-hero/plugin-authoring';
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
const TEMPLATE_ACCENTS = [
  '#4164f4', '#d46342', '#111827', '#0f9f6e', '#353535', '#ea580c', '#0284c7',
  '#4f46e5', '#db2777', '#16a34a', '#475569', '#f59e0b', '#0f172a', '#1A74FF',
  '#be123c', '#0d9488', '#0891b2', '#ec4899', '#64748b', '#8b5cf6', '#334155',
];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function templateAccent(id: string): string {
  return TEMPLATE_ACCENTS[hashString(id) % TEMPLATE_ACCENTS.length]!;
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

function ProjectsPanel({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const t = useT();
  const [plugins, setPlugins] = useState<MarketplacePluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [remixingName, setRemixingName] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<MarketplacePluginEntry | null>(null);
  // Synchronous rapid-click guard: state writes are not synchronous, so a
  // burst of clicks before React re-renders all read the stale
  // `remixingName` and fire N duplicate POST /remix calls. The ref is
  // written the instant the first click is accepted, so every click in the
  // same burst sees the lock immediately. Cleared on success/failure or by
  // the timeout fallback so a card can never get stuck disabled forever.
  const remixingNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!remixingName) return;
    const timer = window.setTimeout(() => {
      remixingNameRef.current = null;
      setRemixingName(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [remixingName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch('/api/marketplaces/hdw-community/plugins')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
      .then((d: { plugins?: MarketplacePluginEntry[] }) => {
        if (cancelled) return;
        setPlugins(d.plugins ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function handleReference(entry: MarketplacePluginEntry) {
    const prompt = String(entry.prompt ?? entry.description ?? '');
    const title = String(entry.title ?? entry.name);
    stashHomePromptHandoff(createCommunityReferenceHandoff(Date.now(), prompt, title));
    navigate({ kind: 'home', view: 'home' });
  }

  async function handleRemix(entry: MarketplacePluginEntry) {
    if (remixingNameRef.current) return;
    remixingNameRef.current = entry.name;
    setRemixingName(entry.name);
    setRemixError(null);
    const result = await remixHdwPlugin(entry.name);
    remixingNameRef.current = null;
    setRemixingName(null);
    if (result.ok && result.projectId) {
      navigate({
        kind: 'project',
        projectId: result.projectId,
        conversationId: result.conversationId ?? null,
        fileName: null,
      });
    } else {
      setRemixError(result.message ?? t('squareScope.remixFailed'));
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingDot} />
        <span className={styles.loadingDot} />
        <span className={styles.loadingDot} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pluginCardError}>
        {t('squareScope.loadFailed')}
        <br />
        <button
          type="button"
          className={styles.pluginCardRetry}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={14} />
          {t('recentProjects.refresh')}
        </button>
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className={styles.panel}>
        <span className={styles.panelIcon} aria-hidden>
          <Icon name="folder" size={32} />
        </span>
        <p className={styles.panelNote}>{t('squareScope.noPlugins')}</p>
      </div>
    );
  }

  return (
    <div className="community-template-grid" data-testid="square-projects-grid">
      {plugins.map((entry) => {
        const title = entry.title ?? entry.name;
        const publisherName = entry.publisher?.displayName ?? entry.publisher?.github ?? entry.publisher?.id ?? '';
        const meta = publisherName ? publisherName + ' · v' + entry.version : 'v' + entry.version;
        const accent = templateAccent(entry.name);
        const isRemixing = remixingName === entry.name;
        return (
          <article
            key={entry.name}
            className="community-template-card is-clickable"
            data-plugin-name={entry.name}
            onClick={() => setDetailsEntry(entry)}
          >
           <div
             className="community-template-card__preview"
             style={{ '--template-accent': accent } as CSSProperties}
             aria-hidden
           >
             {entry.coverUrl ? (
               <img
                 src={entry.coverUrl}
                 alt={title}
                 loading="lazy"
                 style={{ width: '100%', height: '100%', objectFit: 'cover' }}
               />
             ) : null}
           </div>
            <footer className="community-template-card__foot">
              <span>{meta}</span>
              <div className="community-template-card__actions">
                <button
                  type="button"
                  disabled={isRemixing}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemix(entry);
                  }}
                >
                  {isRemixing ? t('common.loading') : t('squareScope.remix')}
                </button>
                <button
                  type="button"
                  className="community-template-card__prompt-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleReference(entry);
                  }}
                >
                  {t('squareScope.reference')}
                </button>
              </div>
            </footer>
          </article>
        );
      })}
      {remixError ? (
        <div style={{ gridColumn: '1 / -1', color: 'var(--color-text-secondary)', padding: '12px' }}>
          {remixError}
        </div>
      ) : null}
      {detailsEntry ? (
        <SquarePluginPreview
          entry={detailsEntry}
          remixingName={remixingName}
          onClose={() => setDetailsEntry(null)}
          onReference={(entry) => {
            setDetailsEntry(null);
            handleReference(entry);
          }}
          onRemix={(entry) => {
            setDetailsEntry(null);
            handleRemix(entry);
          }}
        />
      ) : null}
    </div>
  );
}

function SquarePluginPreview({
  entry,
  remixingName,
  onClose,
  onReference,
  onRemix,
}: {
  entry: MarketplacePluginEntry;
  remixingName: string | null;
  onClose: () => void;
  onReference: (entry: MarketplacePluginEntry) => void;
  onRemix: (entry: MarketplacePluginEntry) => void;
}) {
  const t = useT();
  const title = entry.title ?? entry.name;
  const publisherName = entry.publisher?.displayName ?? entry.publisher?.github ?? entry.publisher?.id ?? '';
  const meta = publisherName ? publisherName + ' \u00b7 v' + entry.version : 'v' + entry.version;
  const isRemixing = remixingName === entry.name;

  // Fetch the actual preview HTML from the daemon's preview endpoint, which
  // downloads the archive and serves the real content — not a synthetic
  // page built from the prompt text.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setPreviewHtml(null);
    setPreviewError(null);
    try {
      const resp = await fetch(
        `/api/marketplaces/hdw-community/plugins/${encodeURIComponent(entry.name)}/preview`,
      );
      if (!resp.ok) throw new Error('preview fetch failed');
      const html = await resp.text();
      setPreviewHtml(html);
    } catch {
      setPreviewError(t('squareScope.loadFailed'));
    }
  }, [entry.name, t]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const modal = (
    <PreviewModal
      title={title}
      subtitle={meta}
      views={[{
        id: 'preview',
        label: t('squareScope.reference'),
        html: previewHtml,
        error: previewError,
      }]}
      onView={() => { void fetchPreview(); }}
      exportTitleFor={() => title}
      onClose={onClose}
      primaryAction={{
        label: t('squareScope.reference'),
        onClick: () => onReference(entry),
      }}
      headerExtras={
        <button
          type="button"
          disabled={isRemixing}
          onClick={() => onRemix(entry)}
          style={{
            appearance: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minHeight: '34px',
            padding: '0 16px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--text-strong)',
            color: 'var(--accent-contrast, #fff)',
            font: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            cursor: isRemixing ? 'default' : 'pointer',
            opacity: isRemixing ? 0.5 : 1,
          }}
        >
          {isRemixing ? t('common.loading') : t('squareScope.remix')}
        </button>
      }
    />
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

export function SquareView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SquareTab>('projects');
  const [refreshKey, setRefreshKey] = useState(0);

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
            onClick={() => setRefreshKey((k) => k + 1)}
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
          <ProjectsPanel refreshKey={refreshKey} onRefresh={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <PlaceholderPanel
            icon={activeDef.icon}
            label={t(activeDef.labelKey)}
            note={t('squareScope.emptyNote')}
          />
        )}
      </div>
    </section>
  );
}
