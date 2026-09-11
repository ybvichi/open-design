import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Toast } from './Toast';
import { useT } from '../i18n';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { workspaceContextHasTeamIdentity } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import {
  importSkill,
  installSkill,
  type SkillImportInput,
  type SkillImportError,
} from '../providers/registry';
import styles from './PersonalResourceView.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type BusyState = 'import' | 'upload' | 'sharing' | null;

export function AddSkillDialog({ open, onClose }: Props) {
  const t = useT();
  const { context: workspaceContext, loading: workspaceContextLoading } = useWorkspaceContext();

  const [url, setUrl] = useState('');
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (open) {
      setUrl('');
      setFolderFiles([]);
      setBusy(null);
    }
  }, [open]);

  function closeDialog() {
    if (busy) return;
    onClose();
  }

  const hasTeam = workspaceContextHasTeamIdentity(workspaceContext);

  async function shareSkillToTeam(
    skillId: string,
    skillName: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!workspaceContext || !hasTeam) {
      return { ok: false, error: t('personalScope.noTeamWorkspace') };
    }
    try {
      const res = await fetch(
        `/api/workspace/skills/${encodeURIComponent(skillId)}/share`,
        { method: 'POST', headers: workspaceProjectHeaders(workspaceContext) },
      );
      const body = (await res.json().catch(() => ({}))) as { shared?: boolean };
      if (res.ok && body.shared) return { ok: true };
      return { ok: false, error: t('pluginsView.shareFailed', { title: skillName }) };
    } catch {
      return { ok: false, error: t('pluginsView.shareFailed', { title: skillName }) };
    }
  }

  async function handleImportUrl() {
    const trimmed = url.trim();
    if (!trimmed || busy || workspaceContextLoading) return;
    setBusy('import');
    try {
      const result = await installSkill({ source: trimmed }, workspaceContext);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        setToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        onClose();
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      } else {
        setToast({
          message: t('personalScope.importSuccessShareFailed', { name: result.skill.name }),
          tone: 'error',
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleUploadFolder() {
    if (folderFiles.length === 0 || busy || workspaceContextLoading) return;
    setBusy('upload');
    try {
      const input = await readSkillImportInputFromFolder(folderFiles, t);
      if ('error' in input) {
        setToast({ message: input.error.message, tone: 'error' });
        return;
      }
      const result = await importSkill(input, workspaceContext);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        setToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        onClose();
        setFolderFiles([]);
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      } else {
        setToast({
          message: t('personalScope.importSuccessShareFailed', { name: result.skill.name }),
          tone: 'error',
        });
      }
    } finally {
      setBusy(null);
    }
  }

  const dialog = open ? createPortal(
    <div className={styles.backdrop} role="presentation" onClick={closeDialog}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-skill-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <h2 id="personal-skill-dialog-title" className={styles.dialogTitle}>
            {t('personalScope.addSkill')}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('pluginsView.createClose')}
            onClick={closeDialog}
            disabled={busy !== null}
          >
            <Icon name="close" size={15} aria-hidden />
          </button>
        </header>
        <div className={styles.dialogBody}>
          <article className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('pluginsView.importFromUrl')}</h3>
            <p className={styles.sectionBody}>
              {t('pluginsView.importUrlBody', { kind: 'Skill' })}
            </p>
            <div className={styles.urlRow}>
              <input
                className={styles.urlInput}
                aria-label={t('pluginsView.importFromUrl')}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy !== null}
                placeholder="https://github.com/owner/skill-repo"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleImportUrl();
                }}
              />
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={workspaceContextLoading || busy !== null || url.trim().length === 0}
                onClick={() => void handleImportUrl()}
              >
                {busy === 'import' || busy === 'sharing'
                  ? t('pluginsView.importing')
                  : t('pluginsView.importAndUpload')}
              </button>
            </div>
          </article>

          <article className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('pluginsView.uploadFolder')}</h3>
            <p className={styles.sectionBody}>
              {t('pluginsView.uploadFolderBody', { kind: 'Skill', manifest: 'SKILL.md' })}
            </p>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              disabled={busy !== null}
              style={{ display: 'none' }}
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(event) =>
                setFolderFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
            <div className={styles.folderRow}>
              <button
                type="button"
                className={styles.folderPickBtn}
                disabled={busy !== null}
                onClick={() => folderInputRef.current?.click()}
              >
                <Icon name="folder" size={15} aria-hidden />
                {folderFiles.length > 0
                  ? t('pluginsView.filesSelected', { count: folderFiles.length })
                  : t('pluginsView.chooseFolder')}
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={workspaceContextLoading || busy !== null || folderFiles.length === 0}
                onClick={() => void handleUploadFolder()}
              >
                {busy === 'upload' || busy === 'sharing'
                  ? t('pluginsView.uploading')
                  : t('pluginsView.uploadKind', { kind: 'Skill' })}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {dialog}
      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      ) : null}
    </>
  );
}

async function readSkillImportInputFromFolder(
  files: File[],
  t: ReturnType<typeof useT>,
): Promise<SkillImportInput | { error: SkillImportError }> {
  const skillFile = files.find((file) =>
    /(^|\/)SKILL\.md$/i.test(file.webkitRelativePath || file.name),
  );
  if (!skillFile) {
    return { error: { message: t('pluginsView.skillMissingFile') } };
  }
  let text: string;
  try {
    text = await skillFile.text();
  } catch {
    return { error: { message: t('pluginsView.skillReadFailed') } };
  }
  const fallbackName = deriveSkillFolderName(skillFile);
  const { name, description, body } = parseSkillMarkdown(text, fallbackName);
  if (!name) {
    return { error: { message: t('pluginsView.skillMissingName') } };
  }
  if (!body.trim()) {
    return { error: { message: t('pluginsView.skillEmptyBody') } };
  }
  return { name, description, body, triggers: [] };
}

function deriveSkillFolderName(file: File): string {
  const rel = file.webkitRelativePath;
  if (rel && rel.includes('/')) return rel.split('/')[0] ?? '';
  return file.name.replace(/\.md$/i, '');
}

function parseSkillMarkdown(
  content: string,
  fallbackName: string,
): { name: string; description: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { name: fallbackName, description: '', body: content.trim() };
  }
  const block = match[1] ?? '';
  const body = content.slice(match[0].length).trim();
  const name = readSkillFrontmatterString(block, 'name') || fallbackName;
  const description = readSkillFrontmatterString(block, 'description');
  return { name, description, body };
}

function readSkillFrontmatterString(block: string, key: string): string {
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const raw = (match[1] ?? '').trim();
    if (raw === '|' || raw === '>') {
      const collected: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const child = lines[next] ?? '';
        if (child.trim().length > 0 && !/^\s/.test(child)) break;
        collected.push(child);
      }
      const nonEmpty = collected.filter((child) => child.trim().length > 0);
      const minIndent = nonEmpty.reduce((min, child) => {
        const indent = child.match(/^\s*/)?.[0].length ?? 0;
        return Math.min(min, indent);
      }, Number.POSITIVE_INFINITY);
      const normalized = collected
        .map((child) => child.slice(Number.isFinite(minIndent) ? minIndent : 0))
        .join('\n')
        .trim();
      return raw === '>' ? normalized.replace(/\s*\n\s*/g, ' ').trim() : normalized;
    }
    return raw.replace(/^["']|["']$/g, '').trim();
  }
  return '';
}
