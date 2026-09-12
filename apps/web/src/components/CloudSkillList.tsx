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

// Build workspace headers from the string props the parent passes.
function workspaceHeaders(
  workspaceId: string | null,
  workspaceMemberId: string | null,
  workspaceType: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
  if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
  if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
  return headers;
}

// Minimal relative-date formatter (today / yesterday / N days ago).
function formatRelativeDate(
  iso: string,
  t: (key: any, vars?: Record<string, string | number>) => string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return t('personalScope.cloudSkillUpdatedToday');
  if (days === 1) return t('personalScope.cloudSkillUpdatedYesterday');
  return t('personalScope.cloudSkillUpdatedDaysAgo', { n: days });
}

export function CloudSkillList({
  workspaceId,
  workspaceMemberId,
  workspaceType,
}: {
  workspaceId: string | null;
  workspaceMemberId: string | null;
  workspaceType: string | null;
}) {
  const t = useT();
  const [skills, setSkills] = useState<CloudSkill[]>([]);
  const [localSkillIds, setLocalSkillIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
 const [installingId, setInstallingId] = useState<string | null>(null);
 const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  // Fetch the local skills registry so we can determine which cloud skills
  // are already installed locally. A cloud skill is installed when its
  // localId matches a local skill id.
  const loadLocalSkills = useCallback(async () => {
    if (!workspaceId) { setLocalSkillIds(new Set()); return; }
    try {
      const res = await fetch('/api/skills', {
        cache: 'no-store',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      });
      if (!res.ok) return;
      const body = await res.json();
      const ids = new Set<string>(
        ((body.skills ?? []) as Array<{ id: string }>).map((s) => s.id),
      );
      setLocalSkillIds(ids);
    } catch {
      // leave the previous set intact
    }
  }, [workspaceId, workspaceMemberId, workspaceType]);

  const loadSkills = useCallback(async () => {
    if (!workspaceId) { setSkills([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspaceMemberId) params.set('owner_member_id', workspaceMemberId);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/workspace/skills/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) { throw new Error('Failed to load cloud skills'); }
      const body = await res.json();
      setSkills(body.skills ?? []);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workspaceMemberId, workspaceType]);

  useEffect(() => {
    void Promise.all([loadSkills(), loadLocalSkills()]);
  }, [loadSkills, loadLocalSkills]);

  useEffect(() => {
    const handler = () => { void loadSkills(); void loadLocalSkills(); };
    window.addEventListener('personal:skill-refresh', handler);
    return () => window.removeEventListener('personal:skill-refresh', handler);
  }, [loadSkills, loadLocalSkills]);

  async function handleInstall(skill: CloudSkill) {
    setInstallingId(skill.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/install',
        {
          method: 'POST',
          headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Install failed');
      }
     // Re-fetch local skills so the newly installed skill is reflected.
     await loadLocalSkills();
   } catch (err: any) {
     setError(err?.message ?? String(err));
   } finally {
     setInstallingId(null);
   }
 }
 
async function handleUninstall(skill: CloudSkill) {
  setUninstallingId(skill.resourceId);
  try {
    const res = await fetch(
      '/api/workspace/skills/cloud/' + encodeURIComponent(skill.resourceId) + '/uninstall',
      {
        method: 'DELETE',
        headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? 'Uninstall failed');
    }
    // Re-fetch local skills so the uninstalled skill is reflected.
    await loadLocalSkills();
   } catch (err: any) {
     setError(err?.message ?? String(err));
   } finally {
     setUninstallingId(null);
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
       const isInstalled = localSkillIds.has(skill.localId);
       const isInstalling = installingId === skill.resourceId;
       const isUninstalling = uninstallingId === skill.resourceId;
       return (
       <article key={skill.resourceId} className={styles.teamAssetCard} role="button" tabIndex={0}>
          <div className={styles.cardHeader}>
           <span className={styles.cardIcon} aria-hidden>
             <svg viewBox="0 0 1024 1024" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
               <path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0Z" fill="#324A5E" />
               <path d="M1019.28 581.532l-118.888-118.888-33.306 34.322-120.47-120.47-57.634-13.904-66.488 42.564 101.456 101.456-79.342 0.7L380.68 243.382l-51.132 6.868-29.864 72.932 185.54 185.54L113.778 512l240.344 240.344-69.676 44.1L512 1024c259.182 0 473.35-192.594 507.28-442.468z" fill="#2B3B4E" />
               <path d="M880.77 568.888H227.556v-113.778h653.216c16.264 0 29.452 13.184 29.452 29.452v54.878c-0.002 16.264-13.19 29.448-29.454 29.448z" fill="#EAA22F" />
               <path d="M227.556 511.138v57.75h653.216c16.264 0 29.452-13.184 29.452-29.452v-28.3H227.556z" fill="#E09112" />
               <path d="M227.556 455.112h605.678v113.778H227.556z" fill="#31BAFD" />
               <path d="M227.556 512h605.678v56.888H227.556z" fill="#2B9ED8" />
               <path d="M227.556 455.112L113.778 512l113.778 56.888z" fill="#FEE187" />
               <path d="M115.502 511.138l-1.724 0.862 113.778 56.888v-57.75z" fill="#FFC61B" />
               <path d="M113.778 512l53.154 26.576v-53.152z" fill="#59595B" />
               <path d="M115.502 511.138l-1.724 0.862 53.154 26.576v-27.438z" fill="#272525" />
               <path d="M341.334 284.444m-56.888 0a56.888 56.888 0 1 0 113.776 0 56.888 56.888 0 1 0-113.776 0Z" fill="#FFFFFF" />
               <path d="M341.334 227.556c-0.386 0-0.762 0.052-1.148 0.058v113.66c0.382 0.006 0.758 0.058 1.148 0.058 31.42 0 56.888-25.468 56.888-56.888s-25.472-56.888-56.888-56.888z" fill="#D0D1D3" />
               <path d="M284.444 625.778h170.666v170.666h-170.666z" fill="#FFC61B" />
               <path d="M368.64 625.778h86.472v170.666H368.64z" fill="#EAA22F" />
               <path d="M622.498 405.156l37.244-121.822 86.878 93.164z" fill="#FFFFFF" />
               <path d="M659.742 283.334l-0.296 0.97 28.002 105.858 59.172-13.664z" fill="#D0D1D3" />
             </svg>
           </span>
            <div className={styles.cardHeaderInfo}>
              <strong className={styles.cardTitle}>{skill.title}</strong>
              <small className={styles.cardMeta}>
                {t('personalScope.cloudSkillSource' as any)}
                {skill.updatedAt ? ' \u00b7 ' + formatRelativeDate(skill.updatedAt, t) : ''}
              </small>
            </div>
          </div>
          {skill.description
            ? <p className={styles.cardDesc}>{skill.description}</p>
            : null}
         {isInstalled ? (
              <div className={styles.cardActions}>
                <span className={styles.capabilityComplete}>
                  <Icon name="check" size={14} />
                  {t('personalScope.cloudSkillInstalled' as any)}
                </span>
                <button
                  type="button"
                  className={styles.capabilityUninstall}
                  disabled={isUninstalling}
                  onClick={(e) => { e.stopPropagation(); void handleUninstall(skill); }}
                >
                  {isUninstalling
                    ? <Icon name="spinner" size={14} />
                    : <Icon name="trash" size={14} />}
                  {isUninstalling
                    ? t('personalScope.cloudSkillUninstalling' as any)
                    : t('personalScope.cloudSkillUninstall' as any)}
                </button>
              </div>
           ) : (
             <button
               type="button"
               className={styles.capabilityAdd}
               disabled={isInstalling}
               onClick={() => void handleInstall(skill)}
             >
               {isInstalling
                 ? <Icon name="spinner" size={14} />
                 : <Icon name="plus" size={14} />}
               {isInstalling
                 ? t('personalScope.cloudSkillInstalling' as any)
                 : t('personalScope.cloudSkillAdd' as any)}
             </button>
           )}
         </article>
       );
     })}
    </div>
  );
}
