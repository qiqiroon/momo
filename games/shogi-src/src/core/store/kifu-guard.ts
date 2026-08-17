/**
 * 棋譜を捨てる前の確認（親 v1.36 §9.2.3 ②・画面機能 v0.30 §3 S02／S07）。
 *
 * **記憶が未保存のまま新しい対局を始めようとしたら、その前に尋ねる**。
 * 保存済み・空なら尋ねず、そのまま捨てて先へ進む（ファイルとして残っているため）。
 *
 * **★確認は「画面を移る仕組みの側」に置く**（親 v1.36 §9.2.3 ②）。入口ごとに
 * 書き足す形は採らない。理由＝入口ごとだと**書き忘れが「棋譜の消失」として現れる**が、
 * こちら向きなら書き忘れは**「尋ねすぎ」にとどまる**。取り返しのつく側へ倒す。
 *
 * v1.35 は破棄の契機を画面 ID で並べていたため、**画面一覧に載っていない
 * オフライン対人の設定画面が漏れ**、そこから始める対局では一度も尋ねずに
 * 棋譜が消えていた。名札で書くと名札の無い画面が漏れる、というのが v1.36 の直し。
 *
 * ここは core なので features/kifu-replay を直接は呼ばない。棋譜の機能を積んでいない
 * ビルド（アプリ A）では口そのものが無く、**何も尋ねずに素通りする**。
 */

import { create } from 'zustand';
import { get as pluginGet } from '../plugin/registry';

/** 記憶の 4 状態（親 §9.2.3 ①）。 */
type MemoryState = 'empty' | 'unsaved' | 'saved' | 'pending-discard';
/**
 * 書き出しの結末（親 §9.2.3 ③）。`cancelled` は**本人がやめた**＝何も書いていない。
 * `failed` は**やめていないのに書けなかった**＝どちらも先へ進めないが、
 * **画面に出す言葉が違う**ので分ける（やめていない人に「やめました」と言わない）。
 */
type SaveOutcome = 'saved' | 'cancelled' | 'failed';

/**
 * いま出ている確認。
 * - `reset` … 「リセットしますか」（対局画面のリセットだけの一段目）
 * - `kifu` … 「保存する／破棄する」
 */
export type KifuGuardStage = 'reset' | 'kifu';

interface KifuGuardState {
  stage: KifuGuardStage | null;
  /** 書き出している最中（押しっぱなしで二重に走らせない）。 */
  saving: boolean;
  /** 直前の書き出しを本人が取り消した（画面に一言出すためだけに持つ）。 */
  cancelled: boolean;
  /** 直前の書き出しが**やめたのではなく失敗した**（同上）。 */
  failed: boolean;
  /** 確認が済んだら行う、元の操作。 */
  pending: (() => void) | null;
}

export const useKifuGuardStore = create<KifuGuardState>(() => ({
  stage: null,
  saving: false,
  cancelled: false,
  failed: false,
  pending: null,
}));

function memoryState(): MemoryState {
  const read = pluginGet<() => MemoryState>('kifu:state');
  return read ? read() : 'empty';
}

/** 「捨てる」と答えられた印を付ける。**中身はここでは消えない**（親 v1.40 §9.2.3 ②）。 */
function markPendingDiscard(): void {
  pluginGet<() => void>('kifu:markDiscard')?.();
}

function close(): void {
  useKifuGuardStore.setState({
    stage: null,
    saving: false,
    cancelled: false,
    failed: false,
    pending: null,
  });
}

/**
 * 確認を閉じて元の操作へ進む。
 *
 * **★ここでは棋譜を捨てない**（親 v1.40 §9.2.3 ②）。実際に捨てるのは
 * **盤が作り直された瞬間**で、その時に「保存済み」と「破棄予定」だけが黙って消える。
 *
 * 理由＝**確認が出る場所（設定画面へ入るとき）と、盤が作り直される場所は同じではない**。
 * ここで捨てると、引き返しただけで棋譜が消える（対 AI の終局後はモード選択へ直接戻る道が
 * 無く、必ず対AI設定画面を通るのでこれが毎回起きていた）。
 */
function closeAndRun(action: () => void): void {
  close();
  action();
}

/**
 * 新しい対局を始める操作を、確認をはさんで行う（親 §9.2.3 ②）。
 *
 * @param action 確認が済んだら行う操作（画面を移る・盤を作り直す 等）
 * @param opts.twoStep 対局画面のリセットだけ二段にする＝**対局中に押せる位置にあり
 *   誤操作の代償が大きい**ため、先に「リセットしますか」を尋ねる。この一段目は
 *   棋譜とは関係が無いので、記憶が空でも必ず出す。
 */
export function requestNewGame(action: () => void, opts: { twoStep?: boolean } = {}): void {
  if (opts.twoStep) {
    useKifuGuardStore.setState({
      stage: 'reset',
      saving: false,
      cancelled: false,
      failed: false,
      pending: action,
    });
    return;
  }
  askKifuOrRun(action);
}

/**
 * **棋譜の読み込み**を、確認をはさんで行う（親 §9.2.3 ② の 2 系統目）。
 *
 * 読み込むと記憶が読み込んだ棋譜に置き換わる＝**破棄の契機**なので、新しい対局を
 * 始めるときと同じ確認を通す。**書類ピッカーを開く前に尋ねる**こと（画面機能 §3 S08）
 * ＝開いてしまうと、やめたときの行き先も、受け皿の中身も見えなくなる。
 */
export function requestKifuLoad(action: () => void): void {
  askKifuOrRun(action);
}

function askKifuOrRun(action: () => void): void {
  // **未保存のときだけ尋ねる**。保存済み（ファイルが残っている）・破棄予定（既に
  // 捨てると答えてもらった）・空は、**同じことを二度尋ねない**ので素通りする。
  if (memoryState() !== 'unsaved') {
    closeAndRun(action);
    return;
  }
  useKifuGuardStore.setState({
    stage: 'kifu',
    saving: false,
    cancelled: false,
    failed: false,
    pending: action,
  });
}

/** 一段目「リセットしますか」に「はい」。ここから二段目（未保存なら）へ。 */
export function guardResetYes(): void {
  const action = useKifuGuardStore.getState().pending;
  if (!action) {
    close();
    return;
  }
  askKifuOrRun(action);
}

/**
 * 「やめる」。**元の操作は行わず、記憶もそのまま**（親 v1.37 §9.2.3 ②）。
 *
 * この確認は破棄の契機の手前に割り込むので、**引き返せないと「どちらかを選ぶまで
 * 通さない関所」になる**＝設定画面を見に行こうとしただけの人が、棋譜を捨てるか
 * 書き出すかを迫られて戻れない。棋譜を守る仕掛けが棋譜を捨てる方へ人を押し出しては
 * 本末転倒なので、**どの経路の確認にも必ずこの出口を置く**。
 */
export function guardCancel(): void {
  close();
}

/**
 * 「破棄する」。**印を付けるだけで、中身はまだ残す**（親 v1.40 §9.2.3 ②）。
 *
 * 実際に消えるのは盤が作り直された瞬間。それまでは棋譜再生画面へ入れば
 * **読み込み直さずに再生できる**。以後この棋譜について同じ確認は出さない。
 */
export function guardDiscard(): void {
  const action = useKifuGuardStore.getState().pending;
  if (!action) {
    close();
    return;
  }
  markPendingDiscard();
  closeAndRun(action);
}

/**
 * 「保存する」。**書き出しを終えてから元の操作を続行する**（画面機能 §3 S07）。
 *
 * **★取り消したときは元の操作も行わず、確認へ戻る**（親 §9.2.3 ③）。
 * iPhone の共有シートは取り消しが拒否として返るので、やめたことが分かる。
 * ここで先へ進めてしまうと「やめたのに棋譜が消える」ことになる。
 */
export async function guardSave(): Promise<void> {
  const state = useKifuGuardStore.getState();
  if (state.saving) return;
  const action = state.pending;
  const save = pluginGet<() => Promise<SaveOutcome>>('kifu:save');
  if (!save || !action) {
    close();
    return;
  }
  useKifuGuardStore.setState({ saving: true, cancelled: false, failed: false });
  let outcome: SaveOutcome;
  try {
    outcome = await save();
  } catch {
    // 書き出せなかった＝何も残っていないかもしれない。捨てずに確認へ戻る。
    // **本人はやめていない**ので `failed` として扱う（言葉が変わる）。
    outcome = 'failed';
  }
  if (outcome !== 'saved') {
    // やめたのか書けなかったのかで、画面に出す言葉が変わる（付録D-8 §8
    // 「確かめられた場合だけ断定する」）。どちらでも**先へは進めない**。
    useKifuGuardStore.setState({
      saving: false,
      cancelled: outcome === 'cancelled',
      failed: outcome === 'failed',
    });
    return;
  }
  // 書き出せた＝ファイルとして残ったので、印は「保存済み」になっている（書き出し側が付ける）。
  // **ここでも捨てない**＝次の対局が実際に始まるまで再生できる（親 v1.40 §9.2.3 ②）。
  closeAndRun(action);
}
