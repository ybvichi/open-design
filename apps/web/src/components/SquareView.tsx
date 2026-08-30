// Hi广场 — community plaza surface.
//
// Reached from the nav rail's "Hi广场" item under Community. The page is
// intentionally left empty for now; content will be filled in later.

import { useT } from '../i18n';

export function SquareView() {
  const t = useT();
  return (
    <div className="entry-section" data-testid="square-view">
      <h1 className="entry-section__title">{t('entry.navPlaza')}</h1>
    </div>
  );
}
