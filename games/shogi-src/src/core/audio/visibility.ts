/**
 * visibilitychange 監視 + 長期停止復帰時のモーダル再表示 (Darts v2.20 準拠)。
 *
 * - hidden 遷移: 時刻を記録して AudioContext を suspend
 * - visible 復帰: 停止期間が 1 時間未満なら resume、1 時間以上なら
 *   `onLongResume` コールバックを呼んで再度モーダルを表示させる
 */
import { resumeAudio, suspendAudio } from './audio-engine';

const LONG_SUSPEND_MS = 60 * 60 * 1000; // 1 時間

let lastHiddenAt = 0;
let bound = false;
let onLongResume: (() => void) | null = null;

export function bindVisibility(handleLongResume: () => void): void {
  if (bound) return;
  bound = true;
  onLongResume = handleLongResume;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
      suspendAudio();
    } else {
      const dur = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
      if (dur >= LONG_SUSPEND_MS && onLongResume) {
        // 1 時間以上 → 音は止めたままモーダル再表示
        onLongResume();
      } else {
        resumeAudio();
      }
    }
  });
}
