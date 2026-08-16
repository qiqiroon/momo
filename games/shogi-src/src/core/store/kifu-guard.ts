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

/** 記憶の 3 状態（親 §9.2.3 ①）。 */
type MemoryState = 'empty' | 'unsaved' | 'saved';
/** 書き出しの結末（親 §9.2.3 ③）。`cancelled` は**本人がやめた**＝何も書いていない。 */
type SaveOutcome = 'saved' | 'cancelled';

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
  /** 確認が済んだら行う、元の操作。 */
  pending: (() => void) | null;
}

export const useKifuGuardStore = create<KifuGuardState>(() => ({
  stage: null,
  saving: false,
  cancelled: false,
  pending: null,
}));

function memoryState(): MemoryState {
  const read = pluginGet<() => MemoryState>('kifu:state');
  return read ? read() : 'empty';
}

function discardMemory(): void {
  pluginGet<() => void>('kifu:discard')?.();
}

function close(): void {
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
}

/** 捨てて元の操作へ進む。**ここが唯一の破棄の実行点**。 */
function discardAndRun(action: () => void): void {
  discardMemory();
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
    useKifuGuardStore.setState({ stage: 'reset', saving: false, cancelled: false, pending: action });
    return;
  }
  askKifuOrRun(action);
}

function askKifuOrRun(action: () => void): void {
  // **未保存のときだけ尋ねる**。保存済みならファイルとして残っているので尋ねずに捨てる。
  if (memoryState() !== 'unsaved') {
    discardAndRun(action);
    return;
  }
  useKifuGuardStore.setState({ stage: 'kifu', saving: false, cancelled: false, pending: action });
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

/** 「破棄する」。記憶を捨てて元の操作へ進む。 */
export function guardDiscard(): void {
  const action = useKifuGuardStore.getState().pending;
  if (!action) {
    close();
    return;
  }
  discardAndRun(action);
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
  useKifuGuardStore.setState({ saving: true, cancelled: false });
  let outcome: SaveOutcome;
  try {
    outcome = await save();
  } catch {
    // 書き出せなかった＝何も残っていないかもしれない。捨てずに確認へ戻る。
    outcome = 'cancelled';
  }
  if (outcome !== 'saved') {
    useKifuGuardStore.setState({ saving: false, cancelled: true });
    return;
  }
  // 書き出せた＝ファイルとして残ったので、ここで捨ててよい（§9.2.3 ②）。
  discardAndRun(action);
}
