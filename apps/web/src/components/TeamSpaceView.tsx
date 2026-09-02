import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { getStoredUsername } from '../auth/auth';
import { getTeamMemberId } from '../utils/deterministicId';
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

interface TeamMember {
  workspaceMemberId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

interface OperatorInfo {
  memberId: string;
  role: MemberRole;
}

const ROLE_KEY: Record<MemberRole, keyof Dict> = {
  owner: 'teamSpace.roleOwner',
  admin: 'teamSpace.roleAdmin',
  member: 'teamSpace.roleMember',
  guest: 'teamSpace.roleGuest',
};

function formatJoinedDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
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
  const [operator, setOperator] = useState<OperatorInfo | null>(null);

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
        if (!match) {
          navigate({ kind: 'home', view: 'home' }, { replace: true });
          return;
        }
      } catch {
        // Leave the fallback title in place.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Fetch the current user's operator info (member ID + role) via the
  // dedicated single-member endpoint instead of filtering the full member
  // list. The member ID is derived locally so no extra request is needed.
  useEffect(() => {
    if (!teamId) { setOperator(null); return; }
    let cancelled = false;
    void (async () => {
      const username = getStoredUsername();
      if (!username) { if (!cancelled) setOperator(null); return; }
      try {
        const memberId = await getTeamMemberId(teamId, username);
        const res = await fetch(
          `/api/hdw/webapi/v1/team/${teamId}/member/${memberId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setOperator(null); return; }
        const body = await res.json();
        if (cancelled) return;
        if (body?.code === 0 && body?.data) {
          setOperator({
            memberId: body.data.workspace_member_id,
            role: body.data.role as MemberRole,
          });
        } else {
          setOperator(null);
        }
      } catch {
        if (!cancelled) setOperator(null);
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
          <MembersTable teamId={teamId} onInvite={onInvite} operator={operator} />
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
function MembersTable({ teamId, onInvite, operator }: { teamId?: string; onInvite?: () => void; operator: OperatorInfo | null }) {
  const t = useT();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);

  const operatorMemberId = operator?.memberId ?? null;
  const operatorRole = operator?.role ?? null;

  useEffect(() => {
    if (!teamId) { setMembers([]); return; }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/hdw/webapi/v1/team/${teamId}/members`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setMembers([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.data?.members ?? [];
        setMembers(list.map((m) => ({
          workspaceMemberId: m.workspace_member_id || '',
          name: m.displayname || m.username || '',
          email: m.email || '',
          role: m.role as MemberRole,
          joinedAt: m.created_at || '',
        })));
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Refresh member list when an invite completes for this team.
  useEffect(() => {
    function onMembersUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.teamId !== teamId) return;
      setLoading(true);
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(`/api/hdw/webapi/v1/team/${teamId}/members`, { cache: 'no-store' });
          if (!res.ok) { if (!cancelled) return; }
         const body = await res.json();
         if (cancelled) return;
         const list: any[] = body?.data?.members ?? [];
          setMembers(list.map((m) => ({
            workspaceMemberId: m.workspace_member_id || '',
            name: m.displayname || m.username || '',
            email: m.email || '',
            role: m.role as MemberRole,
            joinedAt: m.created_at || '',
          })));
        } catch {
          // keep existing list on refresh error
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }
    window.addEventListener('hdw:members-updated', onMembersUpdated);
    return () => window.removeEventListener('hdw:members-updated', onMembersUpdated);
  }, [teamId]);

  // Permission logic mirrors HDW updateRole: owner/admin can change roles,
  // but owner role is never editable (needs transfer), and admin can only
  // change member-level roles (not other admins).
  function canChangeRole(member: TeamMember): boolean {
    if (member.role === 'owner') return false;
    if (!operatorRole || !operatorMemberId) return false;
    if (operatorRole === 'owner') return member.role === 'admin' || member.role === 'member' || member.role === 'guest';
    if (operatorRole === 'admin') return member.role === 'member' || member.role === 'guest';
    return false;
  }

  function canRemoveMember(member: TeamMember): boolean {
    if (!operatorRole || !operatorMemberId) return false;
    if (member.role === 'owner') return false;
    if (member.workspaceMemberId === operatorMemberId) return false;
    if (operatorRole === 'owner') return member.role === 'admin' || member.role === 'member' || member.role === 'guest';
    if (operatorRole === 'admin') return member.role === 'member' || member.role === 'guest';
    return false;
  }

  function requestRemove(member: TeamMember) {
    setRemoveTarget(member);
  }

  async function confirmRemove() {
    const member = removeTarget;
    if (!member || !operatorMemberId) return;
    setRemoveTarget(null);
    if (!operatorMemberId) return;
    // Optimistic removal.
    setMembers((prev) => prev.filter((m) => m.workspaceMemberId !== member.workspaceMemberId));
    setRoleError(null);
    try {
      const res = await fetch('/api/hdw/webapi/v1/team/member/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_member_id: member.workspaceMemberId,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        // Re-add on failure.
        setMembers((prev) => [...prev, member].sort((a, b) => a.name.localeCompare(b.name)));
        setRoleError(body?.error || body?.msg || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setMembers((prev) => [...prev, member].sort((a, b) => a.name.localeCompare(b.name)));
      setRoleError(err?.message || String(err));
    }
  }

  async function handleRoleChange(member: TeamMember, newRole: MemberRole) {
    if (!operatorMemberId || newRole === member.role) return;
    const prevRole = member.role;
    // Optimistic update.
    setMembers((prev) => prev.map((m) =>
      m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: newRole } : m,
    ));
    setRoleError(null);
    try {
      const res = await fetch('/api/hdw/webapi/v1/team/member/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_member_id: member.workspaceMemberId,
          role: newRole,
          operator_member_id: operatorMemberId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        // Revert on failure.
        setMembers((prev) => prev.map((m) =>
          m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: prevRole } : m,
        ));
        setRoleError(body?.error || body?.msg || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setMembers((prev) => prev.map((m) =>
        m.workspaceMemberId === member.workspaceMemberId ? { ...m, role: prevRole } : m,
      ));
      setRoleError(err?.message || String(err));
    }
  }

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
              <th>{t('teamSpace.colJoined')}</th>
              <th>{t('teamSpace.colRole')}</th>
              {(operatorRole === 'owner' || operatorRole === 'admin') ? <th>{t('teamSpace.colActions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4}>{t('teamSpace.loading')}</td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={4}>{t('teamSpace.noMembers')}</td></tr>
            ) : members.map((m) => {
              const initial = m.name.charAt(0).toUpperCase();
              const roleClass = styles[`role_${m.role}`] ?? '';
              const changeable = canChangeRole(m);
              const removable = canRemoveMember(m);
              return (
                <tr key={m.workspaceMemberId}>
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
                    {formatJoinedDate(m.joinedAt)}
                  </td>
                  <td>
                    {changeable ? (
                      <select
                        className={`${styles.roleSelect} ${roleClass}`.trim()}
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value as MemberRole)}
                      >
                        <option value="admin">{t('teamSpace.roleAdmin')}</option>
                        <option value="member">{t('teamSpace.roleMember')}</option>
                        <option value="guest">{t('teamSpace.roleGuest')}</option>
                      </select>
                    ) : (
                      <span className={`${styles.roleTag} ${roleClass}`.trim()}>
                        {t(ROLE_KEY[m.role])}
                      </span>
                    )}
                  </td>
                  {(operatorRole === 'owner' || operatorRole === 'admin') ? (
                    <td className={styles.actionsCell}>
                     {removable ? (
                       <button
                         type="button"
                         className={styles.removeBtn}
                         onClick={() => requestRemove(m)}
                       >
                         {t('teamSpace.removeMember')}
                       </button>
                     ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {roleError ? <p className={styles.roleError}>{roleError}</p> : null}
      </div>
      {removeTarget ? (
        <div className={styles.confirmOverlay} onClick={() => setRemoveTarget(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.confirmTitle}>{t('teamSpace.removeConfirmTitle')}</h3>
            <p className={styles.confirmMsg}>{t('teamSpace.removeConfirmMsg')}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmCancel} onClick={() => setRemoveTarget(null)}>
                {t('teamSpace.removeCancelBtn')}
              </button>
              <button type="button" className={styles.confirmOk} onClick={confirmRemove}>
                {t('teamSpace.removeConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
