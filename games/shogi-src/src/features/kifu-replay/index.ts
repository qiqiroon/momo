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
import { ReviewScreen } from './ui/ReviewScreen';
import { clearReviewTarget, setReviewTarget, type ReviewOrigin } from './review';
import {
  answerReviewOffer,
  canOfferReview,
  endSharedReview,
  joinedReviewRoom,
  offerReview,
  receiveReviewMessage,
  reviewGuestArrived,
  reviewSpectatorArrived,
  reviewOpponentLeft,
  reviewRoomCreated,
  withdrawReviewOffer,
} from './review-share';
import { kifuLabels } from './ui/labels';
import type { LocaleCode } from '../../core/i18n/types';
import type { ReviewRoomInfo } from '../../core/plugin/reviewRoom';
import { setReplayOrigin } from './ui/origin';
import { buildKifuFile } from './build';
import { kifuFileName } from './filename';
import { readFolderTexts, type FsDirHandle } from './folder';
import { parseKifu, writeKifuFile, type KifuSaveOutcome } from './io';
import { isReplayingKifu } from './replay';
import {
  discardKifu,
  discardKifuIfDue,
  kifuMemoryState,
  lastKifuIsOwnGame,
  loadLastKifu,
  markKifuPendingDiscard,
  markKifuSaved,
  rememberKifu,
} from './storage';
import type { KifuFile } from './types';

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
  if (outcome === 'saved') rememberKifu(file, 'saved');
  return outcome;
}

/**
 * 渡された棋譜をそのまま書き出す（S08 の一覧・書き出し行から呼ぶ）。
 *
 * 書き出せたものが**記憶している 1 局と同じ対局なら、印だけ**を「保存済み」に変える。
 * **中身は書き戻さない**＝盤や画面から記録を作り直す経路を作らないため。
 */
export async function saveKifuFile(file: KifuFile): Promise<KifuSaveOutcome> {
  // 渡すのは連番を付けない素の名前。**同じ名前が既にあるときの送り方は書き出し側が決める**
  // ＝フォルダを扱える環境は実際に在るファイルを見て、扱えない環境はこの端末が出した
  // 名前を数えて決める（見えるかどうかで確かめ方が変わるため・親 §9.2.2）。
  const outcome = await writeKifuFile(file, kifuFileName(file, 0));
  if (outcome === 'saved' && isRememberedKifu(file)) markKifuSaved();
  return outcome;
}

/**
 * 指定したフォルダの中の棋譜をすべて読む（画面機能 §3 S08「一覧の中身」）。
 *
 * **索引を持たないので毎回読む**（§9.2.1）。**棋譜でないファイルは黙って飛ばす**
 * ＝同じフォルダに何が置いてあってもよい。**中身の素性が正**で、ファイル名からは
 * 何も読み戻さない（§9.2.2・名前は改名され得るので正本ではない）。
 */
export async function listFolderKifu(dir: FsDirHandle): Promise<KifuFile[]> {
  const out: KifuFile[] = [];
  for (const text of await readFolderTexts(dir)) {
    try {
      out.push(parseKifu(text));
    } catch {
      // 棋譜ではなかった。一覧に出さないだけで、ファイルには手を触れない。
    }
  }
  return out;
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
  // ★v1.57: **読み込んだ棋譜は「自分の対局」ではない**（親 §9.2.5）＝盤は先手が下。
  rememberKifu(file, 'saved', false);
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
// 「捨てる」と答えられた印（親 v1.40 §9.2.3 ②）。**中身はまだ残す**＝再生できる。
register('kifu:markDiscard', markKifuPendingDiscard);
/**
 * 盤が実際に作り直された（＝新しい対局が本当に始まった）。**ここが唯一の破棄の実行点**。
 *
 * **再生も盤を作り直す**ので、再生中は何もしない。名乗っていないと、
 * 受け皿を再生しようとした瞬間に当の受け皿が消える。
 */
register('kifu:boardRebuilt', () => {
  if (isReplayingKifu()) return;
  discardKifuIfDue();
});
/**
 * 指しかけの対局を、打ち切る直前に棋譜として残す（v1.43・親 §9.2.3 (a)）。
 *
 * 棋譜が生まれるのは終局の瞬間だけだったので、**対局中にリセットすると、その対局は
 * 保存する機会が一度も無いまま消えていた**（2026-08-17 ユーザー報告）。
 *
 * **盤から記録を作ってよい数少ない場面**（§9.2.3 の (a) 記録の誕生）。ここは
 * **再生中でもなく、盤がその対局のすべてを載せている**時点なので、記録と盤が食い違わない。
 *
 * 作らない場合が 3 つある。
 *   - **対局中でない**…終局していれば記録はもう生まれている（上書きしない）
 *   - **1 手も指していない**…残すものが無い
 *   - **答えの済んでいない棋譜が残っている**…前の対局の未保存分を黙って押しのけない
 */
register('kifu:captureCurrent', () => {
  if (isReplayingKifu()) return;
  const s = useGameStore.getState();
  if (s.status !== 'playing') return;
  if (s.moveHistory.length === 0) return;
  if (kifuMemoryState() === 'unsaved') return;
  rememberKifu(buildKifuFile(new Date()));
});

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

// 感想戦画面 (S11)。A ビルドには存在しないので、口ごと無い＝入口も出ない。
register('screen:review', ReviewScreen);
/**
 * 感想戦を開く（親 §9.4.1・入り口は 3 つ）。**振り返る 1 局を一緒に渡す**
 * ＝棋譜の無い感想戦は定義しない（画面の中で選び直せないので、ここで決まる）。
 *
 * 棋譜を渡さない呼び方では**記憶している 1 局**で始める（モード選択からの経路）。
 * 記憶が空なら開かず false を返す＝呼んだ側が読み込みへ案内できる。
 *
 * **感想戦は破棄の契機ではない**ので確認は挟まない（親 §9.2.3 ②・§9.4.3）。
 */
register('review:open', (from: ReviewOrigin, file?: KifuFile): boolean => {
  const target = file ?? loadLastKifu();
  if (!target) return false;
  // ★v1.57: 棋譜を渡されない呼び方は**記憶している 1 局**＝その出どころをそのまま継ぐ
  // （親 §9.2.5）。棋譜を渡す呼び方（S08 から）は、渡す側が出どころを知っているので
  // `review:openWith` を使う。
  setReviewTarget(target, from, file ? false : lastKifuIsOwnGame());
  useRouteStore.getState().setScreen('review');
  return true;
});
/**
 * 二人の感想戦（親 §9.4.4／§6.3.6）。**通信側からはこの 3 つの口だけが見える**。
 *
 * - `review:message` … 相手から届いた伝言を渡す口
 * - `review:opponentLeft` … 相手が抜けたことを渡す口。**二人でやっていたときだけ true**
 *   を返し、呼んだ側は対局中の切断としての始末（退室を促す）をしない
 * - `review:canOffer` … 打診できるか（終局パネルが二人用に振る舞うかを決める）
 *
 * 棋譜の機能を積んでいないビルドでは口ごと無いので、感想戦の伝言は黙って捨てられる。
 */
register('review:message', receiveReviewMessage);
register('review:opponentLeft', reviewOpponentLeft);
register('review:canOffer', canOfferReview);
/**
 * v1.50: 感想戦の部屋（画面機能 §3 S04・付録D-12 §8）。**通信側が入室・来客を
 * 見つけたときに呼ぶ**。感想戦をしていない部屋なら `reviewGuestArrived` は false を
 * 返し、呼んだ側は今までどおりに扱う（対局の部屋の来客と混ぜない）。
 */
register('review:joinedRoom', joinedReviewRoom);
register('review:guestArrived', reviewGuestArrived);
/**
 * ★v1.59 (段3・親 §6.8.6): 感想戦の部屋へ**観戦者**が入ってきた。
 * **配るものは、入ってきた人の立場ではなく「いま自分が居る部屋の用途」で決まる**。
 * 感想戦の部屋でなければ false を返し、呼んだ側は対局用の配りを続ける。
 */
register('review:spectatorArrived', reviewSpectatorArrived);
/** 終局パネルの「感想戦」から相手へ申し出る（返事を待つ間も閉じ込めない）。 */
register('review:offer', offerReview);
register('review:withdrawOffer', withdrawReviewOffer);
register('review:answerOffer', answerReviewOffer);
/**
 * ★v1.54: 感想戦ロビー (S12) から呼ばれる 3 つの口（親 v1.48 §9.4.1）。
 *
 * **ロビーは通信機能 (features/matchmaking) 側に居る**ので、棋譜のことは何も知らない。
 * だから**棋譜に関わる判断はすべてこちらで済ませ**、ロビーには結果だけを返す。
 *
 * v1.53 までの `review:openFromMenu`（記憶が空なら書類ピッカーを開く）は**廃止**した
 * ＝**画面の中で読み込めるようになった**ので、入る前にだけ読み込ませる理由が無い
 * （親 v1.48 §9.4.1・S08 も棋譜が無ければ初期配置で開く）。
 */

/**
 * ひとりで始める（S12）。**記憶している 1 局があればそれで、無ければ空のまま入る**。
 *
 * **入るたびに決め直す**（親 §9.4.1・v1.47）＝前に見た 1 局の控えは画面より長生き
 * するので、空かどうかで決めると**前の棋譜がそのまま出る**。ここは記憶を正とする。
 */
register('review:startSolo', () => {
  endSharedReview();
  const remembered = loadLastKifu();
  if (remembered) setReviewTarget(remembered, 'lobby', lastKifuIsOwnGame());
  else clearReviewTarget('lobby');
  useRouteStore.getState().setScreen('review');
});
/**
 * 部屋を建てるのに要るものを、記憶している 1 局から取る（S12）。
 * **記憶が無くても建てられる**＝中で読み込めるので、ルール名だけが空になる。
 */
register('review:roomInfo', (locale: LocaleCode): ReviewRoomInfo => {
  const file = loadLastKifu();
  if (!file) return { gameType: 'shogi', torus: false, quantum: false, ruleName: '' };
  return {
    gameType:
      file.meta.gameType === 'hasami'
        ? 'hasami'
        : file.meta.gameType === 'custom' || file.meta.gameType === 'chess' || file.meta.gameType === 'shogi-custom'
          ? 'custom'
          : 'shogi',
    torus: file.meta.torus !== 'none',
    quantum: file.meta.quantum,
    ruleName: kifuLabels(locale).ruleName(file),
  };
});
/**
 * 部屋が建った（S12）。**建てた人はそのまま感想戦へ入る**＝相手を待たない
 * （親 §9.4.1）。振り返る 1 局の決め方は「ひとりで始める」と同じ。
 */
register('review:roomCreated', () => {
  const remembered = loadLastKifu();
  if (remembered) setReviewTarget(remembered, 'lobby', lastKifuIsOwnGame());
  else clearReviewTarget('lobby');
  reviewRoomCreated();
  useRouteStore.getState().setScreen('review');
});

export { buildKifuFile } from './build';
export { kifuFileName } from './filename';
export {
  canUseFolder,
  chooseFolder,
  readFolderTexts,
  rememberedFolder,
  usableFolder,
  writeIntoFolder,
} from './folder';
export type { FolderAsk, FsDirHandle } from './folder';
export { parseKifu, readKifuFile, serializeKifu, writeKifuFile } from './io';
export type { KifuSaveOutcome } from './io';
export {
  replayKifu,
  isReplayingKifu,
  holdReplayGuard,
  resolveCustomRuleForOpen,
  customRuleMatches,
} from './replay';
export type { CustomRuleRef, CustomRuleResolution, OpenedRule } from './replay';
export { setReviewTarget, reviewTarget, reviewOrigin } from './review';
export type { ReviewOrigin } from './review';
export {
  canOfferReview,
  endSharedReview,
  isSharedReview,
  joinedReviewRoom,
  reviewGuestArrived,
  reviewRoomCreated,
  useReviewShareStore,
} from './review-share';
export {
  discardKifu,
  discardKifuIfDue,
  kifuMemoryState,
  lastKifuIsOwnGame,
  loadKifuMemory,
  loadLastKifu,
  markKifuPendingDiscard,
  markKifuSaved,
  rememberKifu,
} from './storage';
export type { KifuMark, KifuMemory, KifuMemoryState } from './storage';
export { KifuReplayScreen } from './ui/KifuReplayScreen';
export { ReviewScreen } from './ui/ReviewScreen';
export type { KifuFile, KifuMeta, KifuPlayer, KifuOpponent } from './types';
