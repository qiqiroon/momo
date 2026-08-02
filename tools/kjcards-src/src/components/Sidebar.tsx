import { useBoard } from '../store/board';
import { useUI } from '../store/ui';
import { useT } from '../i18n/store';
import { RelationPalette } from './RelationPalette';

export function Sidebar() {
  const t = useT();
  const purpose = useBoard((s) => s.purpose);
  const setPurpose = useBoard((s) => s.setPurpose);
  const openModal = useUI((s) => s.openModal);

  return (
    <aside className="kj-sidebar">
      <section className="kj-panel">
        <h2 className="kj-panel-title">{t('purpose.heading')}</h2>
        <label className="kj-field">
          <span>{t('purpose.message')}</span>
          <textarea
            rows={2}
            value={purpose.message}
            placeholder={t('purpose.messagePh')}
            onChange={(e) => setPurpose({ message: e.target.value })}
          />
        </label>
        <label className="kj-field">
          <span>{t('purpose.audience')}</span>
          <input
            value={purpose.audience}
            placeholder={t('purpose.audiencePh')}
            onChange={(e) => setPurpose({ audience: e.target.value })}
          />
        </label>
        <label className="kj-field">
          <span>{t('purpose.tone')}</span>
          <input
            value={purpose.tone}
            placeholder={t('purpose.tonePh')}
            onChange={(e) => setPurpose({ tone: e.target.value })}
          />
        </label>
      </section>

      <section className="kj-panel">
        <h2 className="kj-panel-title">{t('action.heading')}</h2>
        <button className="kj-btn kj-btn-wide" onClick={() => openModal('cardRequest')}>
          ① {t('action.cardRequest')}
        </button>
        <button className="kj-btn kj-btn-wide" onClick={() => openModal('import')}>
          ② {t('action.import')}
        </button>
        <button className="kj-btn kj-btn-wide kj-btn-accent" onClick={() => openModal('handoff')}>
          ③ {t('action.handoff')}
        </button>
      </section>

      <section className="kj-panel">
        <h2 className="kj-panel-title">{t('rel.heading')}</h2>
        <RelationPalette />
      </section>
    </aside>
  );
}
