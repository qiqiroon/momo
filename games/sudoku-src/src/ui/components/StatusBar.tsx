/**
 * 状態バー（第3分冊 11.1）
 *
 * サイズ・難易度は出題時に確定し、以後変化しない。
 * 経過時間は1秒周期で更新する（C-54）。ページ非表示中は更新しない（呼び出し側が止める）。
 */

import type { BoardSize, Difficulty } from '../../data/types';
import { t } from '../../i18n/locale';
import { formatTime } from './StatsPanel';

export interface StatusBarProps {
  n: BoardSize;
  difficulty: Difficulty;
  mistakeCount: number;
  /** Easy は上限が無いため null。分母を表示しない（第2分冊 5.4） */
  mistakeLimit: number | null;
  failed: boolean;
  elapsedMs: number;
}

export function StatusBar({
  n,
  difficulty,
  mistakeCount,
  mistakeLimit,
  failed,
  elapsedMs,
}: StatusBarProps): React.ReactElement {
  return (
    <div className="status-bar">
      {/* サイズと難易度のあいだは区切り記号を置かず、空白1文字だけとする */}
      <span className="status-mode">
        {n}×{n} {difficulty}
      </span>
      <span className="status-mistake" data-testid="status-mistake">
        {t('play.status.mistake')}{' '}
        {mistakeLimit === null ? mistakeCount : `${mistakeCount} / ${mistakeLimit}`}
      </span>
      {failed && (
        <span className="status-failed" data-testid="status-failed">
          {t('play.status.failed')}
        </span>
      )}
      <span className="status-time" data-testid="status-time">
        {formatTime(elapsedMs)}
      </span>
    </div>
  );
}
