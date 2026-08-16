import type { ComponentProps } from 'react';
import { CommunityView } from './CommunityView';
import { useI18n } from '../i18n';

/**
 * The project-stage rail destination reuses the community template gallery,
 * but titles itself 项目广场 (entry.navProjectStage) instead of 社区.
 */
export function ProjectStageView(props: ComponentProps<typeof CommunityView>) {
  const { t } = useI18n();
  return <CommunityView {...props} title={t('entry.navProjectStage')} />;
}
