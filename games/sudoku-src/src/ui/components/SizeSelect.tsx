/**
 * 盤面サイズの選択（第3分冊 2.6）
 *
 * 未解放のサイズは**存在自体を示したうえで非活性**にする。
 * キャッシュ済みチャンクが無くオフラインのサイズも同様に非活性とする（第1分冊 3.9.3）。
 */

import { BOARD_SIZES, type BoardSize } from '../../data/types';
import { t } from '../../i18n/locale';

export interface SizeSelectProps {
  /** 選べるサイズ。ここに無いものは非活性で表示する */
  selectable: ReadonlySet<BoardSize>;
  /** 非活性の理由。未解放か、オフラインで手元に無いか */
  reasonOf(n: BoardSize): 'locked' | 'offline';
  value: BoardSize;
  onChange(n: BoardSize): void;
}

export function SizeSelect({ selectable, reasonOf, value, onChange }: SizeSelectProps): React.ReactElement {
  return (
    <section className="panel-block">
      <h2 className="panel-heading">{t('title.size.heading')}</h2>
      <div className="chip-row" role="group" aria-label={t('title.size.heading')}>
        {BOARD_SIZES.map((n) => {
          const enabled = selectable.has(n);
          const reason = enabled ? null : reasonOf(n);
          return (
            <button
              key={n}
              type="button"
              className={`chip${value === n ? ' chip-on' : ''}`}
              disabled={!enabled}
              aria-pressed={value === n}
              title={reason === null ? undefined : t(`title.size.${reason}`)}
              onClick={() => onChange(n)}
            >
              {n}
              {reason !== null && <span className="chip-note">{t(`title.size.${reason}`)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
