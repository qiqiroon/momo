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
 * 棋譜の設定で盤を作り直し、`upTo` 手まで指し直す（省略なら最後まで）。
 * 指せない手に当たったらそこで止める（残りは applied との差で分かる）。
 */
export function replayKifu(file: KifuFile, upTo?: number): ReplayResult {
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
}
