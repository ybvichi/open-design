// Publish dialog for the Square (Hi广场) community surface.
//
// Opens from the "新建发布" button in SquareView. The dialog has four
// category tabs — 项目 / Skill / MCP / 工具 — but only the 项目 (Projects)
// tab is implemented in this pass. The other three render a placeholder
// panel so the tab structure is visible and ready for future work.
//
// The two panels stack vertically (top-bottom layout):
//   Top    — "选择文件": pick an internal project from a recent-projects
//           list, or switch to "外部文件" and choose a folder from disk.
//   Bottom — "公开信息": name + description shown on the community card.
//
// The confirm button is disabled until a file source is selected and a
// name is entered. On confirm the dialog calls onPublish with the
// resolved selection; the actual publish API call is owned by the caller
// (SquareView) so this component stays a pure presentation layer.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { Project } from '../types';
import { listProjects } from '../state/projects';
import { openFolderDialog } from '../providers/registry';
import styles from './PublishDialog.module.css';

type PublishCategory = 'projects' | 'skill' | 'mcp' | 'tool';

interface CategoryTabDef {
  id: PublishCategory;
  icon: IconName;
  labelKey: keyof Dict;
}

const CATEGORY_TABS: CategoryTabDef[] = [
  { id: 'projects', icon: 'grid', labelKey: 'squareScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'squareScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'squareScope.tabMcp' },
  { id: 'tool', icon: 'puzzle', labelKey: 'squareScope.tabTool' },
];

type FileSource = 'internal' | 'external';

/** What the caller receives when the user confirms a project publish. */
export interface PublishProjectSelection {
  /** Project id when source is internal, null when external. */
  projectId: string | null;
  /** External folder path when source is external, null when internal. */
  externalPath: string | null;
  /** Display name for the community card. */
  name: string;
  /** Description for the community card. */
  description: string;
}

interface Props {
  onClose: () => void;
  onPublish: (selection: PublishProjectSelection) => void;
}

function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}

function ProjectsTab({
  onPublish,
  confirmRef,
}: {
  onPublish: (selection: PublishProjectSelection) => void;
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
}) {
  const t = useT();
  const [source, setSource] = useState<FileSource>('internal');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<'recent' | 'directory'>('recent');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const folderPickerInFlight = useRef(false);

  // Load recent internal projects. listProjects returns all projects
  // sorted by updatedAt desc; we slice the first 5 to match the mockup's
  // "最近5个项目" listbox.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    listProjects()
      .then((all) => {
        if (cancelled) return;
        const recent = [...all]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 5);
        setProjects(recent);
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
  }, []);

  const handlePickFolder = useCallback(async () => {
    if (folderPickerInFlight.current) return;
    folderPickerInFlight.current = true;
    try {
      const picked = await openFolderDialog();
      if (picked) {
        setExternalPath(picked);
        // Pre-fill the name field from the folder basename if empty.
        if (!name) {
          const parts = picked.replace(/\\/g, '/').split('/').filter(Boolean);
          const last = parts[parts.length - 1];
          if (last) setName(last);
        }
      }
    } finally {
      folderPickerInFlight.current = false;
    }
  }, [name]);

 const hasSelection =
    Boolean(
      (source === 'internal' && selectedProjectId) ||
        (source === 'external' && externalPath),
    );
 const canConfirm = hasSelection && name.trim().length > 0;

  // Lift canConfirm + onConfirm into the ref so the dialog footer's
  // confirm button (which lives outside the tab content) can reach them.
  confirmRef.current = {
    canConfirm,
    onConfirm: () => {
      if (!canConfirm) return;
      onPublish({
        projectId: source === 'internal' ? selectedProjectId : null,
        externalPath: source === 'external' ? externalPath : null,
        name: name.trim(),
        description: description.trim(),
      });
    },
  };

  function handleSelectProject(project: Project) {
    setSelectedProjectId(project.id);
    if (!name) setName(project.name);
  }

  return (
    <div className={styles.formGrid}>
      {/* --- Top panel: file selection --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="file" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.selectFile')}</h3>
            <p>{t('publishDialog.selectFileHint')}</p>
          </div>
        </div>

        <div className={styles.sourceSwitch} role="tablist" aria-label={t('publishDialog.sourceLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'internal'}
            className={source === 'internal' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('internal')}
          >
            {t('publishDialog.sourceInternal')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'external'}
            className={source === 'external' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('external')}
          >
            {t('publishDialog.sourceExternal')}
          </button>
        </div>

        {source === 'internal' ? (
          <div>
            <div className={styles.pickerTabs}>
              <span className={styles.pickerLabel}>{t('publishDialog.selectProject')}</span>
              <button
                type="button"
                className={pickerMode === 'recent' ? styles.pickerTabBtnActive : styles.pickerTabBtn}
                onClick={() => setPickerMode('recent')}
              >
                {t('publishDialog.recentProjects')}
              </button>
              <button
                type="button"
                className={pickerMode === 'directory' ? styles.pickerTabBtnActive : styles.pickerTabBtn}
                onClick={() => setPickerMode('directory')}
              >
                <Icon name="folder" size={13} />
                {t('publishDialog.browseDirectory')}
              </button>
            </div>

            {pickerMode === 'recent' ? (
              loading ? (
                <div className={styles.loading}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              ) : error ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyStateText}>{t('publishDialog.loadFailed')}</span>
                </div>
              ) : projects.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyStateText}>{t('publishDialog.noProjects')}</span>
                </div>
              ) : (
                <div className={styles.projectOptions} role="listbox" aria-label={t('publishDialog.recentProjectsAria')}>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={selectedProjectId === project.id}
                      className={selectedProjectId === project.id ? `${styles.projectOption} ${styles.projectOptionActive}` : styles.projectOption}
                      onClick={() => handleSelectProject(project)}
                    >
                      <span className={styles.projectOptionIcon} aria-hidden>
                        <Icon name="file" size={15} />
                      </span>
                      <span className={styles.projectOptionText}>
                        <strong>{project.name}</strong>
                        <small>{relativeTime(project.updatedAt, t)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className={styles.dropzone} onClick={() => void handlePickFolder()}>
                <span className={styles.dropzoneIcon} aria-hidden>
                  <Icon name="folder" size={28} />
                </span>
                <span className={styles.dropzoneText}>{t('publishDialog.browseDirectoryHint')}</span>
                <span className={styles.dropzoneHint}>{t('publishDialog.browseDirectoryHint2')}</span>
              </div>
            )}
          </div>
        ) : externalPath ? (
          <div className={styles.externalPath}>
            <Icon name="folder" size={15} />
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>{externalPath}</span>
            <button
              type="button"
              className={styles.externalPathClear}
              onClick={() => setExternalPath(null)}
              aria-label={t('common.cancel')}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <div className={styles.dropzone} onClick={() => void handlePickFolder()}>
            <span className={styles.dropzoneIcon} aria-hidden>
              <Icon name="folder" size={28} />
            </span>
            <span className={styles.dropzoneText}>{t('publishDialog.externalFileHint')}</span>
            <span className={styles.dropzoneHint}>{t('publishDialog.externalFileHint2')}</span>
          </div>
        )}
      </section>

      {/* --- Bottom panel: public info --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="grid" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.publicInfo')}</h3>
            <p>{t('publishDialog.publicInfoHint')}</p>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-name">
            {t('publishDialog.nameLabel')}
          </label>
          <input
            id="publish-name"
            className={styles.fieldInput}
            placeholder={t('publishDialog.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-desc">
            {t('publishDialog.descriptionLabel')}
          </label>
          <textarea
            id="publish-desc"
            className={`${styles.fieldInput} ${styles.fieldTextarea}`}
            placeholder={t('publishDialog.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>
      </section>
    </div>
  );
}

export function PublishDialog({ onClose, onPublish }: Props) {
  const t = useT();
  const [activeCategory, setActiveCategory] = useState<PublishCategory>('projects');
  const dialogId = useId();
  const confirmRef = useRef<{ canConfirm: boolean; onConfirm: () => void }>({
    canConfirm: false,
    onConfirm: () => {},
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeTab = CATEGORY_TABS.find((tab) => tab.id === activeCategory)!;

  function handleConfirm() {
    if (!confirmRef.current.canConfirm) return;
    confirmRef.current.onConfirm();
  }

  const dialog = (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('publishDialog.title')}
        id={dialogId}
        data-testid="publish-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2>{t('publishDialog.title')}</h2>
            <p>{t('publishDialog.subtitle')}</p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('common.cancel')}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.categoryTabs} role="tablist" aria-label={t('publishDialog.categoryLabel')}>
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeCategory === tab.id}
                className={activeCategory === tab.id ? `${styles.categoryTab} ${styles.categoryTabActive}` : styles.categoryTab}
                onClick={() => setActiveCategory(tab.id)}
              >
                <Icon name={tab.icon} size={17} />
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {activeCategory === 'projects' ? (
            <ProjectsTab
              confirmRef={confirmRef}
              onPublish={(selection) => {
                onPublish(selection);
                onClose();
              }}
            />
          ) : (
            <div className={styles.placeholder}>
              <span className={styles.placeholderIcon} aria-hidden>
                <Icon name={activeTab.icon} size={32} />
              </span>
              <span className={styles.placeholderText}>{t('publishDialog.comingSoon')}</span>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={activeCategory !== 'projects' || !confirmRef.current.canConfirm}
            onClick={handleConfirm}
          >
            {t('publishDialog.confirm')}
          </button>
        </footer>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
