/**
 * 成績（第3分冊 2.7 / C-35）
 *
 * サイズ×難易度ごとに閲覧のみ。**編集・リセットは設けない**。
 * 実績が1件も無い組み合わせは行を出さない（未解放サイズの行も自然に出ない）。
 */

import { useState } from 'react';
import { BOARD_SIZES, DIFFICULTIES, type Stats, type StatsEntry, type StatsKey } from '../../data/types';
import { t } from '../../i18n/locale';

export interface StatsPanelProps {
  stats: Stats;
}

/** 経過時間の表示。1時間を超える場合は h:mm:ss とする（11.1 と同じ規則） */
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

function hasRecord(entry: StatsEntry): boolean {
  return (
    entry.playCount > 0 ||
    entry.clearCount > 0 ||
    entry.failedCount > 0 ||
    entry.hintUsedTotal > 0 ||
    entry.bestTimeMs !== null
  );
}

export function StatsPanel({ stats }: StatsPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  const rows: { key: StatsKey; size: number; difficulty: string; entry: StatsEntry }[] = [];
  for (const n of BOARD_SIZES) {
    for (const difficulty of DIFFICULTIES) {
      const key: StatsKey = `${n}:${difficulty}`;
      const entry = stats.entries[key];
      if (entry && hasRecord(entry)) rows.push({ key, size: n, difficulty, entry });
    }
  }

  return (
    <section className="panel-block">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="disclosure-mark" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {t('title.stats.heading')}
      </button>

      {open &&
        (rows.length === 0 ? (
          <p className="muted">{t('title.stats.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>{t('title.stats.col.size')}</th>
                  <th>{t('title.stats.col.difficulty')}</th>
                  <th>{t('title.stats.col.clear')}</th>
                  <th>{t('title.stats.col.failed')}</th>
                  <th>{t('title.stats.col.best')}</th>
                  <th>{t('title.stats.col.play')}</th>
                  <th>{t('title.stats.col.hint')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, size, difficulty, entry }) => (
                  <tr key={key}>
                    <td>{size}</td>
                    <td>{difficulty}</td>
                    <td>{entry.clearCount}</td>
                    <td>{entry.failedCount}</td>
                    <td>{entry.bestTimeMs === null ? '—' : formatTime(entry.bestTimeMs)}</td>
                    <td>{entry.playCount}</td>
                    <td>{entry.hintUsedTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
