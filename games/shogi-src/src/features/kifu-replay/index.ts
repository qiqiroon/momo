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
import { useRouteStore } from '../../core/store/route-store';
import { KifuReplayScreen } from './ui/KifuReplayScreen';
import { setReplayOrigin } from './ui/origin';
import { buildKifuFile } from './build';
import { kifuFileName } from './filename';
import { writeKifuFile, type KifuSaveOutcome } from './io';
import { isReplayingKifu } from './replay';
import { discardKifu, kifuMemoryState, loadLastKifu, markKifuSaved, rememberKifu } from './storage';
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
 * 記憶している 1 局を、1 局 1 ファイルとして書き出す。
 *
 * **★書き出す対象は記憶の側**（親 §9.2.3 ①・2026-08-16 ユーザー判断）。
 * **盤から組み立て直してはならない**＝棋譜再生は記録された手を初手から並べ直すので、
 * 途中まで戻して見ている間、盤には**そこまでの手しか載っていない**。そこから作ると
 * 満額の記録が短いものに化ける。記録から盤を作るのは順方向、その逆は作らない。
 *
 * 記憶が空のときだけ盤から組み立てる（記憶を持てない端末＝記録が生まれる経路と同じ）。
 *
 * **書き出せたときだけ「保存済み」の印を付ける**（親 §9.2.3 ③）。**中身は書き戻さない**
 * ＝印だけを変える。**記憶は消さない**＝もう一度保存でき、そのまま再生もできる。
 * やめたときは何も書いていないので、印は未保存のまま。
 */
export async function saveCurrentKifu(): Promise<KifuSaveOutcome> {
  const remembered = loadLastKifu();
  if (remembered) return saveKifuFile(remembered);
  // ここへ来るのは記憶を持てない端末だけ（シークレット・容量超過）。
  // 記録が生まれる経路と同じく盤から組み立てる。
  const file = buildKifuFile(new Date());
  const outcome = await saveKifuFile(file);
  if (outcome === 'saved') rememberKifu(file, true);
  return outcome;
}

/**
 * 渡された棋譜をそのまま書き出す（S08 の一覧・書き出し行から呼ぶ）。
 *
 * 書き出せたものが**記憶している 1 局と同じ対局なら、印だけ**を「保存済み」に変える。
 * **中身は書き戻さない**＝盤や画面から記録を作り直す経路を作らないため。
 */
export async function saveKifuFile(file: KifuFile): Promise<KifuSaveOutcome> {
  const base = kifuFileName(file, 0);
  const outcome = await writeKifuFile(file, kifuFileName(file, nextSeqFor(base)));
  if (outcome === 'saved' && isRememberedKifu(file)) markKifuSaved();
  return outcome;
}

/**
 * 記憶している 1 局と同じ対局か。棋譜には対局そのものの番号が無いので、
 * **書き出した時刻と手数**で見分ける（同じ対局から作った記録は両方とも一致する）。
 */
function isRememberedKifu(file: KifuFile): boolean {
  const m = loadLastKifu();
  return (
    !!m && m.meta.savedAt === file.meta.savedAt && m.meta.moveCount === file.meta.moveCount
  );
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

// 棋譜再生画面 (S08)。A ビルドには存在しないので、口ごと無い＝入口も出ない。
register('screen:kifu-replay', KifuReplayScreen);
/**
 * S08 を開く。**どこから開いたかを一緒に置いていく**（戻る先が変わるため）。
 * 呼ぶ側 (core の終局パネル・メニュー) は画面の名前を知らなくてよい。
 *
 * **再生は破棄の契機ではない**ので確認は挟まない（親 §9.2.3 ②）。
 */
register('kifu:open', (from: 'lobby' | 'game') => {
  setReplayOrigin(from);
  useRouteStore.getState().setScreen('kifu-replay');
});

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
export { KifuReplayScreen } from './ui/KifuReplayScreen';
export type { KifuFile, KifuMeta, KifuPlayer, KifuOpponent } from './types';
