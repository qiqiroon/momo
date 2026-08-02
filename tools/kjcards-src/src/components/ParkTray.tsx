import { useBoard } from '../store/board';
import { useT } from '../i18n/store';

/** 退避トレイ（保留ボックス）。status:parked のカードが集まる。
 *  キャンバスからカードをここへドラッグ＝退避（BoardCanvas 側で判定）。 */
export function ParkTray() {
  const t = useT();
  const cards = useBoard((s) => s.cards);
  const parked = cards.filter((c) => c.status === 'parked');
  const restoreCard = useBoard((s) => s.restoreCard);
  const deleteCard = useBoard((s) => s.deleteCard);

  return (
    <section id="kj-park" className="kj-park">
      <div className="kj-park-head">
        <strong>{t('park.title')}</strong>
        <span className="kj-park-hint">{t('park.hint')}</span>
      </div>
      <div className="kj-park-list">
        {parked.length === 0 ? (
          <div className="kj-park-empty">{t('park.empty')}</div>
        ) : (
          parked.map((c) => (
            <div key={c.id} className="kj-park-card">
              <span className="kj-park-title" title={c.note}>
                {c.title || '—'}
              </span>
              <span className="kj-park-card-actions">
                <button
                  className="kj-mini"
                  title={t('park.restore')}
                  onClick={() => restoreCard(c.id)}
                >
                  ⇧
                </button>
                <button
                  className="kj-mini kj-mini-danger"
                  title={t('card.delete')}
                  onClick={() => {
                    if (window.confirm(t('confirm.deleteCard'))) deleteCard(c.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
