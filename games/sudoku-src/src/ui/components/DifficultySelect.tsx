/**
 * 難易度の選択（第3分冊 2.6）
 *
 * 常に3つとも選べる。該当0件のフォールバックはデータ層が吸収し、UI は通知しない（設計書 2.8）。
 * ランク名は全言語共通の固有名詞として扱い、文言化しない。
 */

import { DIFFICULTIES, type Difficulty } from '../../data/types';
import { t } from '../../i18n/locale';

export interface DifficultySelectProps {
  value: Difficulty;
  onChange(difficulty: Difficulty): void;
}

export function DifficultySelect({ value, onChange }: DifficultySelectProps): React.ReactElement {
  return (
    <section className="panel-block">
      <h2 className="panel-heading">{t('title.difficulty.heading')}</h2>
      <div className="chip-row" role="group" aria-label={t('title.difficulty.heading')}>
        {DIFFICULTIES.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            className={`chip chip-wide${value === difficulty ? ' chip-on' : ''}`}
            aria-pressed={value === difficulty}
            onClick={() => onChange(difficulty)}
          >
            {difficulty}
          </button>
        ))}
      </div>
    </section>
  );
}
