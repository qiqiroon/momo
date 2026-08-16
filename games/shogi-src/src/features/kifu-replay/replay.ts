/**
 * 棋譜を最初から指し直す。
 *
 * 記録した設定で盤を作り直し、記録された手を 1 手ずつ**対局中とまったく同じ経路**で
 * 適用する（合法手と突き合わせてから指す）。量子の候補更新・収縮も同じに走るので、
 * 「書き出した棋譜を読み直すと同じ局面に戻る」ことがそのまま確かめられる。
 */

import { useGameStore } from '../../core/store/game-store';
import type { KifuFile } from './types';

export interface ReplayResult {
  /** 指し直せた手数。 */
  applied: number;
  /** 記録されていた手数。applied と食い違ったらどこかで指せなくなっている。 */
  recorded: number;
}

/**
 * 再生の最中かどうか。
 *
 * 再生は**盤を作り直して終局まで指し直す**ので、外から見ると新しい対局が始まって
 * 終わったのと区別がつかない。見張っている側（index.ts）がそれを本物の対局と
 * 取り違えると、**再生しただけで記憶が書き換わる**。ここで名乗って避ける。
 */
let replaying = false;

export function isReplayingKifu(): boolean {
  return replaying;
}

/**
 * 「これは本物の対局ではない」と名乗りながら盤を触る。
 *
 * 棋譜再生画面を離れるとき、**入る前の盤をそのまま戻す**のに使う。戻すと status が
 * 対局中から終局へ動くので、見張っている側 (index.ts) がそれを新しい終局と取り違え、
 * **盤から作り直した棋譜で記憶を上書きしてしまう**（記録 → 盤の一方向が壊れる）。
 */
export function asReplay<T>(fn: () => T): T {
  const outer = replaying;
  replaying = true;
  try {
    return fn();
  } finally {
    replaying = outer;
  }
}

/**
 * 棋譜の設定で盤を作り直し、`upTo` 手まで指し直す（省略なら最後まで）。
 * 指せない手に当たったらそこで止める（残りは applied との差で分かる）。
 *
 * **再生は破棄の契機ではない**（親 §9.2.3 ②）＝記憶は触らない。
 */
export function replayKifu(file: KifuFile, upTo?: number): ReplayResult {
  replaying = true;
  try {
    const g = useGameStore.getState();
    g.reset({
      gameType: file.meta.gameType,
      quantum: file.meta.quantum,
      torusMode: file.meta.torus,
      handicap: file.meta.handicap
        ? { typeId: file.meta.handicap.typeId, giver: file.meta.handicap.giver }
        : null,
    });
    const limit = upTo === undefined ? file.moves.length : Math.min(upTo, file.moves.length);
    let applied = 0;
    for (let i = 0; i < limit; i++) {
      if (!useGameStore.getState().replayRecordedMove(file.moves[i])) break;
      applied++;
    }
    return { applied, recorded: file.moves.length };
  } finally {
    replaying = false;
  }
}
