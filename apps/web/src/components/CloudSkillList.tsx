import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './CloudSkillList.module.css';

interface CloudSkill {
  resourceId: string;
  localId: string;
  title: string;
  description: string | null;
  ownerMemberId: string;
  version: number | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
}

function isSkillInstalledLocally(localId: string): boolean {
  try {
    const existing = sessionStorage.getItem('od:cloud-skill-installed');
    if (!existing) return false;
    const set: string[] = JSON.parse(existing);
    return set.includes(localId);
  } catch {
    return false;
  }
}

function markSkillInstalled(localId: string): void {
  try {
    const existing = sessionStorage.getItem('od:cloud-skill-installed');
    const set: string[] = existing ? JSON.parse(existing) : [];
    if (!set.includes(localId)) {
      set.push(localId);
      sessionStorage.setItem('od:cloud-skill-installed', JSON.stringify(set));
    }
  } catch {
    // ignore
  }
}

export function CloudSkillList({
  workspaceId,
  workspaceMemberId,
}: {
  workspaceId: string | null;
  workspaceMemberId: string | null;
}) {
  const t = useT();
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const loadSkills = useCallback(async () => {
    if (!workspaceId) { setSkills([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspaceMemberId) params.set('owner_member_id', workspaceMemberId);
      const headers: Record<string, string> = {};
      if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
      if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
      const res = await fetch('/api/workspace/skills/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) { throw new Error('Failed to load cloud skills'); }
      const body = await res.json();
      setSkills(body.skills ?? []);
      const installed = new Set<string>();
      for (const s of (body.skills ?? []) as CloudSkill[]) {
        if (isSkillInstalledLocally(s.localId)) installed.add(s.resourceId);
      }
      setInstalledIds(installed);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workspaceMemberId]);

  useEffect(() => { void loadSkills(); }, [loadSkills]);

  useEffect(() => {
    const handler = () => void loadSkills();
    window.addEventListener('personal:skill-refresh', handler);
    return () => window.removeEventListener('personal:skill-refresh', handler);
  }, [loadSkills]);

  async function handleInstall(skill: CloudSkill) {
    setInstallingId(skill.resourceId);
    try {
      const res = await fetch('/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/install', {
        method: 'POST',
        headers: {
          ...(workspaceId ? { 'x-od-workspace-id': workspaceId } : {}),
          ...(workspaceMemberId ? { 'x-od-workspace-member-id': workspaceMemberId } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Install failed');
      }
      markSkillInstalled(skill.localId);
      setInstalledIds((prev) => new Set(prev).add(skill.resourceId));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setInstallingId(null);
    }
  }

  if (loading) {
    return <div className={styles.cloudSkillLoading}>{t('personalScope.cloudSkillLoading' as any)}</div>;
  }

  if (error && skills.length === 0) {
    return (
      <div className={styles.cloudSkillEmpty}>
        <span>{error}</span>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className={styles.cloudSkillEmpty}>
        <span>{t('personalScope.cloudSkillEmpty' as any)}</span>
      </div>
    );
  }

  return (
    <div className={styles.cloudSkillGrid}>
      {skills.map((skill) => {
        const isInstalled = installedIds.has(skill.resourceId);
        const isInstalling = installingId === skill.resourceId;
        return (
          <article key={skill.resourceId} className={styles.cloudSkillCard}>
            <div className={styles.cloudSkillHeader}>
              <span className={styles.cloudSkillIcon} aria-hidden>
                <Icon name="sparkles" size={18} />
              </span>
              <div className={styles.cloudSkillInfo}>
                <h3 className={styles.cloudSkillTitle}>{skill.title}</h3>
                {skill.description
                  ? <p className={styles.cloudSkillDesc}>{skill.description}</p>
                  : null}
              </div>
            </div>
            <div className={styles.cloudSkillFooter}>
              <button
                type="button"
                className={styles.cloudSkillAddBtn + (isInstalled ? " " + styles.installed : "")}
                disabled={isInstalled || isInstalling}
                onClick={() => void handleInstall(skill)}
              >
                {isInstalled
                  ? t("personalScope.cloudSkillInstalled" as any)
                  : isInstalling
                    ? t("personalScope.cloudSkillInstalling" as any)
                    : t("personalScope.cloudSkillAdd" as any)}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
