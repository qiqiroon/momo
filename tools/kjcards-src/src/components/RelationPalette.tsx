import { useUI } from '../store/ui';
import { useT } from '../i18n/store';
import { RELATION_FAMILIES, presetsByFamily } from '../relations';

/** 関係パレット（§4.4）。3グループを区切って全て一覧表示＋自由記述。隠さない＝発想の一覧性。 */
export function RelationPalette() {
  const t = useT();
  const pendingRelLabel = useUI((s) => s.pendingRelLabel);
  const setPendingRel = useUI((s) => s.setPendingRel);

  return (
    <div className="kj-palette">
      <div className="kj-palette-current">
        {t('rel.current')}: <b>{pendingRelLabel || '—'}</b>
      </div>
      <p className="kj-hint">{t('rel.hint')}</p>
      {RELATION_FAMILIES.map((fam) => (
        <div key={fam} className="kj-palette-group">
          <div className="kj-palette-fam">{t(`rel.family.${fam}`)}</div>
          <div className="kj-palette-chips">
            {presetsByFamily(fam).map((p) => (
              <button
                key={p.label}
                className={`kj-chip${pendingRelLabel === p.label ? ' kj-chip-on' : ''}`}
                title={p.meaning}
                onClick={() => setPendingRel(p.label, p.family)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="kj-palette-group">
        <div className="kj-palette-fam">{t('rel.free')}</div>
        <input
          className="kj-free-input"
          placeholder={t('rel.freePh')}
          onChange={(e) => setPendingRel(e.target.value, 'その他')}
        />
      </div>
    </div>
  );
}
