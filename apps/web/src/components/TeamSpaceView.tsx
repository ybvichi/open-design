import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { avatarColorFor } from '../utils/avatarColor';
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

type MemberRole = 'owner' | 'admin' | 'member' | 'guest';
type MemberStatus = 'online' | 'offline';

interface TeamMember {
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  lastActiveMinutes: number;
}

// Mock data — replace with real workspace members API when available.
const MOCK_MEMBERS: TeamMember[] = [
  { name: '张伟', email: 'zhangwei@example.com', role: 'owner', status: 'online', lastActiveMinutes: 0 },
  { name: '李娜', email: 'lina@example.com', role: 'admin', status: 'online', lastActiveMinutes: 3 },
  { name: '王芳', email: 'wangfang@example.com', role: 'member', status: 'offline', lastActiveMinutes: 25 },
  { name: '刘洋', email: 'liuyang@example.com', role: 'member', status: 'online', lastActiveMinutes: 120 },
  { name: '陈静', email: 'chenjing@example.com', role: 'guest', status: 'offline', lastActiveMinutes: 4320 },
];

const ROLE_KEY: Record<MemberRole, keyof Dict> = {
  owner: 'teamSpace.roleOwner',
  admin: 'teamSpace.roleAdmin',
  member: 'teamSpace.roleMember',
  guest: 'teamSpace.roleGuest',
};

function formatLastActive(t: (key: keyof Dict, vars?: Record<string, string | number>) => string, minutes: number): string {
  if (minutes === 0) return t('teamSpace.justNow');
  if (minutes < 60) return t('teamSpace.minutesAgo', { n: minutes });
  const days = Math.round(minutes / 1440);
  return t('teamSpace.daysAgo', { n: days });
}

interface Props {
  teamId?: string;
  onInvite?: () => void;
}

export function TeamSpaceView({ teamId, onInvite }: Props) {
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
          <MembersTable onInvite={onInvite} />
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
function MembersTable({ onInvite }: { onInvite?: () => void }) {
  const t = useT();
  return (
    <div className={styles.membersWrap}>
      <div className={styles.membersToolbar}>
        <span className={styles.membersToolbarTitle}>{t('teamSpace.membersToolbar')}</span>
        <button type="button" className={styles.inviteBtn} onClick={onInvite}>
          <Icon name="plus" size={15} aria-hidden />
          <span>{t('teamSpace.inviteMember')}</span>
        </button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('teamSpace.colMember')}</th>
              <th>{t('teamSpace.colLastActive')}</th>
              <th>{t('teamSpace.colRole')}</th>
              <th>{t('teamSpace.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_MEMBERS.map((m) => {
              const initial = m.name.charAt(0).toUpperCase();
              const roleClass = styles[`role_${m.role}`] ?? '';
              return (
                <tr key={m.email}>
                  <td>
                    <div className={styles.memberCell}>
                      <span
                        className={styles.avatar}
                        style={{ background: avatarColorFor(m.name) }}
                        aria-hidden
                      >{initial}</span>
                      <div className={styles.memberInfo}>
                        <span className={styles.memberName}>{m.name}</span>
                        <span className={styles.memberEmail}>{m.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className={styles.lastActiveCell}>
                    {formatLastActive(t, m.lastActiveMinutes)}
                  </td>
                  <td>
                    <span className={`${styles.roleTag} ${roleClass}`.trim()}>
                      {t(ROLE_KEY[m.role])}
                    </span>
                  </td>
                  <td>
                    <span className={styles.statusWrap}>
                      <span
                        className={`${styles.statusDot} ${m.status === 'online' ? styles.statusOnline : styles.statusOffline}`.trim()}
                        aria-hidden
                      />
                      {m.status === 'online' ? t('teamSpace.statusOnline') : t('teamSpace.statusOffline')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
