/**
 * features/kifu-replay のエントリポイント (親 §9.2)。
 * main-b.tsx から副作用 import されると、棋譜の保存まわりを plugin registry に登録する。
 *
 * A ビルド (main-a.tsx) はこれを import しないので tree-shake で完全に消える。
 * そのとき core 側は「棋譜を保存」の口が無いことを見て、ボタンごと出さない。
 *
 * **core を書き換えずに済ませるため、対局の終わりはこちらから見張る**。
 * 終局は詰み・投了・時間切れ・引分・ノーゲームと入口が多く、それぞれに
 * 「棋譜を残す」呼び出しを足すと必ずどれかを書き忘れる。状態の変わり目を
 * 1 か所で見るほうが数え漏れない。
 */

import { register } from '../../core/plugin/registry';
import { useGameStore } from '../../core/store/game-store';
import { buildKifuFile } from './build';
import { kifuFileName } from './filename';
import { writeKifuFile, type KifuSaveOutcome } from './io';
import { isReplayingKifu } from './replay';
import { discardKifu, kifuMemoryState, rememberKifu } from './storage';
import type { KifuFile } from './types';

/**
 * 同じ分に 2 局以上終わったときの連番。名前の重複はファイル側で防げない
 * (どんなファイルがあるか見えないため) ので、この端末が出した名前を覚えておく。
 */
const issuedNames = new Map<string, number>();

function nextSeqFor(base: string): number {
  const used = issuedNames.get(base) ?? 0;
  issuedNames.set(base, used + 1);
  return used;
}

/**
 * いまの対局を 1 局 1 ファイルとして書き出す。
 *
 * **書き出せたときだけ記憶に「保存済み」の印を付ける**（親 §9.2.3 ①③）。
 * **記憶は消さない**＝もう一度保存でき、そのまま再生もできる。
 * やめたときは何も書いていないので、印は未保存のまま。
 */
export async function saveCurrentKifu(): Promise<KifuSaveOutcome> {
  const file = buildKifuFile(new Date());
  const base = kifuFileName(file, 0);
  const outcome = await writeKifuFile(file, kifuFileName(file, nextSeqFor(base)));
  if (outcome === 'saved') rememberKifu(file, true);
  return outcome;
}

/**
 * ファイルから読み込んだ棋譜を記憶に載せる（親 §9.2.3 ①(b)・②2）。
 *
 * **読み込みは破棄の契機**なので、いま記憶しているものは置き換わる
 * （未保存なら、呼ぶ前に画面側で確認を取ること）。読み込めた時点でファイルは
 * 存在するので、**印は最初から「保存済み」**。
 */
export function adoptLoadedKifu(file: KifuFile): void {
  rememberKifu(file, true);
}

// 対局の状態の変わり目を 1 か所で見張る。
useGameStore.subscribe((s, prev) => {
  // 再生中は盤を作り直して終局まで指し直すので、本物の対局と取り違えない。
  if (isReplayingKifu()) return;
  // 対局が終わった → 未保存として記憶に置く (保存し忘れの防止・正本ではない)。
  if (s.status !== 'playing' && prev.status === 'playing') {
    rememberKifu(buildKifuFile(new Date()));
  }
  // **盤が作り直されたことを破棄の合図にしない**（親 §9.2.3 ②）。
  // v1.40 はここで記憶を空けていたが、再生も盤を作り直すため
  // 「受け皿を再生しようとすると当の受け皿が消える」状態になっていた。
  // 破棄は画面側が契機ごとに `kifu:discard` を呼んで行う。
});

register('kifu:save', saveCurrentKifu);
register('kifu:hasLast', () => kifuMemoryState() !== 'empty');
// 画面が「保存しますか / 破棄しますか」を出すかどうかを決めるために見る (§9.2.3 ②)。
register('kifu:state', kifuMemoryState);
register('kifu:discard', discardKifu);

export { buildKifuFile } from './build';
export { kifuFileName } from './filename';
export { parseKifu, readKifuFile, serializeKifu, writeKifuFile } from './io';
export type { KifuSaveOutcome } from './io';
export { replayKifu, isReplayingKifu } from './replay';
export {
  discardKifu,
  kifuMemoryState,
  loadKifuMemory,
  loadLastKifu,
  markKifuSaved,
  rememberKifu,
} from './storage';
export type { KifuMemory, KifuMemoryState } from './storage';
export type { KifuFile, KifuMeta, KifuPlayer, KifuOpponent } from './types';
