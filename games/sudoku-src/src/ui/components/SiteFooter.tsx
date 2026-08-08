/**
 * アプリ説明のフッター（⑩）
 *
 * MOMO Works の他アプリと同じ形。**見出し・説明文・3つのリンク**を並べる。
 * 検索でこのページが「中身の無いページ」と見なされるのを防ぐ役目があり、
 * 表に出る文章としてもアプリの説明になる。
 *
 * リンク先は公開時のフォルダ構成（`games/sudoku/`）から2つ上をたどる。
 */

import { t } from '../../i18n/locale';

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="site-footer" data-testid="site-footer">
      <div className="site-footer-inner">
        <h2>{t('footer.about')}</h2>
        <p>{t('footer.desc')}</p>
        <div className="foot-links">
          <a href="../../">{t('footer.top')}</a>
          <a href="../../games/">{t('footer.games')}</a>
          <a href="../../tools/">{t('footer.tools')}</a>
        </div>
      </div>
    </footer>
  );
}
