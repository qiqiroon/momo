/**
 * 案内表示（第3分冊 13章 / C-37）
 *
 * 設定パネル下部の**常設テキスト**。折りたたまない。起動時・条件到達時のポップアップは行わない。
 */

import { t } from '../../i18n/locale';

const SECTIONS = ['rules', 'controls', 'storage', 'dataloss', 'homescreen'] as const;

export function GuideText(): React.ReactElement {
  return (
    <section className="panel-block guide">
      <h2 className="panel-heading">{t('title.guide.heading')}</h2>
      {SECTIONS.map((section) => (
        <div className="guide-section" key={section}>
          <h3>{t(`title.guide.${section}.heading`)}</h3>
          <p>{t(`title.guide.${section}.body`)}</p>
        </div>
      ))}
    </section>
  );
}
