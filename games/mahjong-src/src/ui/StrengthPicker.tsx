// CPU の強さの行（段階7の5・Q4=A）。3 人まとめて 1 つ。名前は Easy / Hard / Apocalypse のまま（訳さない・猫語にもしない）。
// CPU と対局・オンラインの待合（ホストだけ押せる）・同じ山で勝負（送った人と同じ・押せない）で使う。

import { STRENGTH_LABEL, STRENGTHS, type Strength } from '../cpu/strength';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export function StrengthPicker({ t, value, onChange, readOnly = false, guide = true }: { t: T; value: Strength; onChange?: (s: Strength) => void; readOnly?: boolean; guide?: boolean }) {
  return (
    <div className="strength-block">
      <div className="strength-row">
        <span>{t('cpuStrength')}</span>
        <span className="seg">
          {STRENGTHS.map((s) => (
            <button type="button" key={s} className={value === s ? 'on' : ''} disabled={readOnly} aria-pressed={value === s} onClick={() => onChange?.(s)}>
              {STRENGTH_LABEL[s]}
            </button>
          ))}
        </span>
      </div>
      {guide && <p className="guide">{t('cpuStrengthDesc')}</p>}
    </div>
  );
}
