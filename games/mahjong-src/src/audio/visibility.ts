// 画面を隠したら音を止め、戻ったら鳴らし直す（MOMO Shogi の core/audio/visibility.ts と同じ）。
// 1 時間以上離れていたら、次の操作でもう一度「音を鳴らしますか」を尋ねる。
import { resumeAudio, suspendAudio } from './engine';

const LONG_SUSPEND_MS = 60 * 60 * 1000;

let lastHiddenAt = 0;
let bound = false;

export function bindVisibility(onLongResume: () => void): void {
  if (bound) return;
  bound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
      void suspendAudio();
    } else {
      const dur = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
      if (dur >= LONG_SUSPEND_MS) onLongResume();
      else void resumeAudio();
    }
  });
}
