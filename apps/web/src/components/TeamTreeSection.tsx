// Team tree section for the entry navigation rail.
//
// Renders a compact tree of teams (from the workspace directory) with
// expandable folder children. Clicking a team navigates to the team-space
// page (`/team/:teamId`); clicking a folder navigates to the team-folder
// page (`/team/:teamId/folder/:folderId`). Both destination pages are empty
// placeholders for now — this component is the navigation entry point.
//
// Folder data is mock/hardcoded for now. Real folder APIs do not exist yet
// in the daemon or contracts layer, so teams without mock data simply show
// no folder children (the "如果有的话" case from the placeholder comment).

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceDirectoryItem } from '@open-design/contracts';
import { navigate } from '../router';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './TeamTreeSection.module.css';

/** A folder under a team workspace. */
export interface TeamFolder {
  id: string;
  name: string;
}

/**
 * Mock folder data keyed by team/workspace name. Real folder APIs don't
 * exist yet; this lets the tree show folders for "测试团队" immediately.
 * Add entries here as needed during development.
 */
const MOCK_FOLDERS_BY_TEAM_NAME: Record<string, TeamFolder[]> = {
  '测试团队': [
    { id: 'folder-design', name: '设计稿' },
    { id: 'folder-prototype', name: '原型' },
  ],
};

/**
 * A mock "测试团队" entry used when the workspace directory is empty
 * (e.g. not signed in) so the tree is never blank during development.
 */
const MOCK_TEAM: WorkspaceDirectoryItem = {
  workspaceId: 'mock-test-team',
  workspaceName: '测试团队',
  workspaceType: 'team',
  workspaceMemberId: 'mock-member',
  role: 'owner',
  memberStatus: 'active',
  lifecycleState: 'active',
};

function foldersForTeam(teamName: string): TeamFolder[] {
  return MOCK_FOLDERS_BY_TEAM_NAME[teamName] ?? [];
}

interface Props {
  /** Workspace directory items (teams). Falls back to a mock entry when empty. */
  workspaceItems: readonly WorkspaceDirectoryItem[];
  /** The active team id (from route or context), for highlight state. */
  activeTeamId?: string;
  /** The active folder id (from route), for highlight state. */
  activeFolderId?: string;
}

interface TeamNodeProps {
  team: WorkspaceDirectoryItem;
  activeTeamId?: string;
  activeFolderId?: string;
}

function TeamNode({ team, activeTeamId, activeFolderId }: TeamNodeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const folders = foldersForTeam(team.workspaceName);
  const isActiveTeam = activeTeamId === team.workspaceId;
  const isTeamSelected = isActiveTeam && !activeFolderId;

  const handleTeamClick = () => {
    navigate({ kind: 'home', view: 'team-space', teamId: team.workspaceId });
  };

  const handleToggle = (e: ReactKeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleFolderClick = (folder: TeamFolder) => {
    navigate({
      kind: 'home',
      view: 'team-folder',
      teamId: team.workspaceId,
      folderId: folder.id,
    });
  };

  return (
    <div className={styles.teamNode}>
      <div className={`${styles.teamRow}${isTeamSelected ? ` ${styles.isActiveRow}` : ''}`}>
        <button
          type="button"
          className={`${styles.expandBtn}${folders.length === 0 ? ` ${styles.expandBtnHidden}` : ''}`}
          onClick={handleToggle}
          aria-label={expanded ? t('entry.navCollapse') : t('entry.navExpand')}
          aria-expanded={expanded}
          tabIndex={-1}
        >
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={12}
          />
        </button>
        <button
          type="button"
          className={`${styles.teamLabel}${folders.length === 0 ? ` ${styles.teamLabelNoExpand}` : ''}`}
          onClick={handleTeamClick}
          title={team.workspaceName}
        >
          <Icon name="folder" size={16} className={styles.teamIcon} />
          <span className={styles.teamName}>{team.workspaceName}</span>
          <span className={styles.actions} aria-hidden="true">
            <Icon name="more-horizontal" size={14} className={styles.actionIcon} />
          </span>
        </button>
      </div>
      {expanded && folders.length > 0 ? (
        <div className={styles.folderList} role="group">
          {folders.map((folder) => {
            const isActiveFolder =
              isActiveTeam && activeFolderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                className={`${styles.folderRow}${isActiveFolder ? ` ${styles.isActive}` : ''}`}
                onClick={() => handleFolderClick(folder)}
                title={folder.name}
              >
                <Icon name="folder-filled" size={13} className={styles.folderIcon} />
                <span className={styles.folderName}>{folder.name}</span>
                <span className={styles.actions} aria-hidden="true">
                  <Icon name="more-horizontal" size={14} className={styles.actionIcon} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TeamTreeSection({ workspaceItems, activeTeamId, activeFolderId }: Props) {
  const t = useT();
  // Only show team workspaces in the tree.
  const teamItems = workspaceItems.filter(
    (item) => item.workspaceType === 'team',
  );
  // Ensure "测试团队" always appears so the tree is never empty during dev.
  const hasTestTeam = teamItems.some(
    (item) => item.workspaceName === '测试团队',
  );
  const items = hasTestTeam
    ? teamItems
    : [...teamItems, MOCK_TEAM];

  if (items.length === 0) return null;

  return (
    <div className={styles.container} data-testid="team-tree-section">
      <div className={styles.tree}>
        {items.map((team) => (
          <TeamNode
            key={team.workspaceId}
            team={team}
            activeTeamId={activeTeamId}
            activeFolderId={activeFolderId}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.createTeamBtn}>
          <Icon name="plus" size={14} />
          <span>{t('workspaceSwitcher.createTeam')}</span>
        </button>
      </div>
    </div>
  );
}
