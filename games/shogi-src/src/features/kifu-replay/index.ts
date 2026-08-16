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
import { writeKifuFile } from './io';
import { clearLastKifu, loadLastKifu, saveLastKifu } from './storage';

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

/** いまの対局を 1 局 1 ファイルとして書き出す。 */
export async function saveCurrentKifu(): Promise<void> {
  const file = buildKifuFile(new Date());
  const base = kifuFileName(file, 0);
  await writeKifuFile(file, kifuFileName(file, nextSeqFor(base)));
}

// 対局の状態の変わり目を 1 か所で見張る。
useGameStore.subscribe((s, prev) => {
  // 新しい対局が始まった (盤が作り直されて手数が 0 に戻った) → 受け皿を空ける。
  if (s.position.history.length === 0 && prev.position.history.length > 0) {
    clearLastKifu();
    return;
  }
  // 対局が終わった → 受け皿に置く (保存し忘れの防止・正本ではない)。
  if (s.status !== 'playing' && prev.status === 'playing') {
    saveLastKifu(buildKifuFile(new Date()));
  }
});

register('kifu:save', saveCurrentKifu);
register('kifu:hasLast', () => loadLastKifu() !== null);

export { buildKifuFile } from './build';
export { kifuFileName } from './filename';
export { parseKifu, readKifuFile, serializeKifu, writeKifuFile } from './io';
export { replayKifu } from './replay';
export { clearLastKifu, loadLastKifu, saveLastKifu } from './storage';
export type { KifuFile, KifuMeta, KifuPlayer, KifuOpponent } from './types';
