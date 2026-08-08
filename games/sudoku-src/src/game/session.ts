/**
 * セッション統括（第2分冊 10章・12章 / 11.11）
 *
 * 盤面・ミス・ヒント・履歴・タイマを1つの束として持ち、**状態の移り変わり**（12.2）と
 * その副作用（12.3）、および結果の構築（10.2）を担う。
 *
 * **層の向き**: データ層と `transform/` にのみ依存する。React・Canvas・DOM は参照しない（1.2）。
 * 永続化は行わない。中断の保存・削除、成績への記録、既出への追加、出題データの取得は
 * すべて上位（UI層のアプリケーション制御）が行う（10.4 / 8.3）。**ここは材料を作って返すだけである。**
 *
 * > 契約（11.11）が挙げる窓口は `begin` / `resume` / `toSuspended` / `toResult` / `phase` の5つだが、
 * > 受入条件 4-1 は 12.2 の全経路と 12.3 の副作用を求める。移り変わりを実行する窓口が
 * > 契約の一覧に無いため、**本モジュールへ `pause` / `unpause` / `complete` / `discard` / `release` を足した**
 * > （2026-08-06・ユーザー承認済み。C-138）。**部品（モジュール）は増やしていない。**
 *
 * > **操作の取りまとめも本モジュールが担う**（2026-08-06・ユーザー承認済み。C-155）。
 * > 第3分冊 8.7 は「UI層は操作要求へ変換して渡すのみ。判定・記録は行わない」と定め、
 * > 同時に「ミス計数・誤りマーク・候補の自動消込はドメイン層の内部処理」とする。ところが
 * > `board.place` は誤入力を**返す**だけで計上せず、履歴への push もヒントの自動解除も行わない。
 * > **その3者をつなぐ役が契約の一覧に無い。** UI層に書くと遊びの規則が画面へ散るため、
 * > `input` / `erase` / `toggleNote` / `clearNotes` / `undo` / `redo` / `requestHint` / `dismissHint`
 * > を本モジュールへ足した。**部品（モジュール）は増やしていない。**
 */

import { STORAGE_VERSION } from '../data/config';
import {
  err,
  ok,
  type Difficulty,
  type Puzzle,
  type Result,
  type SessionResult,
  type SuspendedSession,
} from '../data/types';
import * as undoStack from '../history/undoStack';
import type { UndoState } from '../history/undoStack';
import { validateParams, type RandomSource, type TransformParams } from '../transform/params';
import * as board from './board';
import type { BoardState } from './board';
import { UNDO_LIMIT_DEFAULT } from './config';
import * as hint from './hint';
import type { HintState } from './hint';
import * as mistake from './mistake';
import type { MistakeState } from './mistake';
import * as notes from './notes';
import * as timer from './timer';
import type { Clock, TimerState } from './timer';
import { isComplete, rebuildErrorFlags } from './validate';

export type SessionPhase =
  | 'IDLE'
  | 'PREPARING'
  | 'PLAYING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'DISCARDED';

export interface SessionState {
  board: BoardState;
  mistake: MistakeState;
  hint: HintState;
  undo: UndoState;
  timer: TimerState;
  phase: SessionPhase;
}

export interface SessionBeginInput {
  /** 出題する元問題。取得はデータ層・上位が済ませている */
  puzzle: Puzzle;
  /**
   * **遊ぶ難易度。利用者が選んだものであり、元問題の格付けではない**（C-178）。
   *
   * 在庫が無い組み合わせでは、データ層が難易度を落として別の格付けの問題を返す
   * （第1分冊 3.5 の「0件なら全難易度へ戻す」）。元問題の格付けをそのまま採ると、
   * **Hard を選んだのに Easy として遊ばされ、成績も Easy に付く。**
   * 実際 1×1 は Easy の1問しか存在せず、Hard・Apocalypse で必ずこれが起きていた。
   */
  difficulty: Difficulty;
  /** 適用する変換パラメータ */
  params: TransformParams;
  /** `Settings.undoLimit`。省略時は既定の100手 */
  undoLimit?: number;
  /** 単調増加時刻の取得手段（9.3）。単体テストで差し替える */
  now?: Clock;
}

export interface SessionResumeInput {
  /** 保存されていた中断（データ層 `storage/sessionStore.ts` が読んだもの） */
  suspended: SuspendedSession;
  /** `suspended.sourceId` から取得した元問題（3.7 手順[1]） */
  puzzle: Puzzle;
  undoLimit?: number;
  now?: Clock;
}

// ---------------------------------------------------------------- 開始（12.3 新規）

/**
 * 出題を確定してセッションを開始する（`PREPARING → PLAYING`）。
 *
 * **難易度は元問題の値を用いる。** ユーザーの指定値ではない（10.2）。
 * 難易度フォールバック（設計書 2.8）により指定と実体が食い違うことがあり、
 * 統計も遊びの振る舞いも**実際に遊んだ問題**に従うのが正しい。
 *
 * 成功して返ることが「出題確定」である。上位はこれを受けて
 * **既出への追加・`playCount` の加算・既存の中断の破棄**を行う（12.3 / 10.4 / 8.3）。
 * 失敗（`PREPARING → IDLE`）は結果型で返す。理由の提示は上位の仕事である（12.4）。
 */
export function begin(input: SessionBeginInput): Result<SessionState> {
  const difficulty = input.difficulty;
  const created = board.create({ puzzle: input.puzzle, params: input.params, difficulty });
  if (!created.ok) return created;

  const session: SessionState = {
    board: created.value,
    mistake: mistake.create(difficulty),
    hint: hint.create(),
    undo: undoStack.create(input.undoLimit ?? UNDO_LIMIT_DEFAULT),
    timer: timer.create(0, input.now ?? undefined),
    phase: 'PLAYING',
  };
  timer.start(session.timer);
  return ok(session);
}

// ---------------------------------------------------------------- 再開（3.7）

/**
 * 中断状態から再開する（`PREPARING → PLAYING`）。3.7 の復元手順をそのまま実行する。
 *
 * **既出へは追加せず、`playCount` も加算しない**（12.3）。同じ1回のプレイの続きだからである。
 * 元問題が取れない場合・変換パラメータの検証に失敗した場合は、**中断を破棄する**ため失敗を返す（12.4）。
 * **候補の復元に失敗した場合はセッションを破棄せず、候補を空として続行する**（12.4）。
 */
export function resume(input: SessionResumeInput): Result<SessionState> {
  const { suspended, puzzle } = input;

  // [1] 元問題の同一性。別の問題を当てはめると盤面が別物になる
  if (puzzle.id !== suspended.sourceId) {
    return err('DATA_INVALID', `中断の元問題が一致しない: ${suspended.sourceId} / ${puzzle.id}`);
  }
  if (puzzle.n !== suspended.n) {
    return err('DATA_INVALID', `中断のサイズが一致しない: ${suspended.n} / ${puzzle.n}`);
  }

  // [2] 変換パラメータの検証（2.8）。失敗は中断の破棄である
  const params = validateParams(suspended.transformParams, puzzle.n, puzzle.b);
  if (!params.ok) return params;

  // **遊んでいた難易度は中断の記録に入っている**。元問題の格付けではなくそちらを使う（C-178）
  const difficulty = suspended.difficulty;
  const created = board.create({ puzzle, params: params.value, difficulty });
  if (!created.ok) return created;
  const state = created.value;

  // [3] 記入値を戻し、**誤りマークは保存値ではなく再計算で組み直す**（保存項目を減らすため）
  const cells = state.n * state.n;
  if (suspended.entered.length !== cells) {
    return err('DATA_INVALID', `中断の記入値の長さが N×N ではない: ${suspended.entered.length}`);
  }
  for (let index = 0; index < cells; index++) {
    const value = suspended.entered[index];
    const valid = Number.isInteger(value) && value >= 1 && value <= state.n;
    // 固定セルの位置は常に 0 とする（3.2）
    state.entered[index] = valid && state.given[index] === 0 ? value : 0;
  }
  rebuildErrorFlags(state);

  // [4] 候補は**保存値をそのまま戻す。Easy でも再算出しない**（C-19）
  const restoredNotes = notes.fromArrays(suspended.notes, state.n);
  if (restoredNotes.ok) {
    state.notes = restoredNotes.value;
  } else {
    // 12.4: セッションは破棄しない。空にして続行する。Easy は自動算出で作り直す
    state.notes = notes.create(state.n);
    board.recomputeAllNotes(state);
  }

  // [5][6][7] 経過時間・ミス・ヒント使用回数を戻す。**表示と履歴は空で始める**
  const session: SessionState = {
    board: state,
    mistake: mistake.restore(difficulty, suspended.mistakeCount, suspended.failed),
    hint: hint.restore(suspended.hintUsed),
    undo: undoStack.create(input.undoLimit ?? UNDO_LIMIT_DEFAULT),
    timer: timer.create(suspended.elapsedMs, input.now ?? undefined),
    phase: 'PLAYING',
  };
  timer.start(session.timer);
  return ok(session);
}

// ---------------------------------------------------------------- 状態の移り変わり（12.2 / 12.3）

/** `PLAYING → PAUSED`。タイマを止める。**中断保存の契機である**（第1分冊 3.6.4） */
export function pause(session: SessionState): boolean {
  if (session.phase !== 'PLAYING') return false;
  timer.pause(session.timer);
  session.phase = 'PAUSED';
  return true;
}

/** `PAUSED → PLAYING`。タイマを再開する。可視性の復帰・明示的な再開操作で呼ばれる（9.3） */
export function unpause(session: SessionState): boolean {
  if (session.phase !== 'PAUSED') return false;
  timer.resume(session.timer);
  session.phase = 'PLAYING';
  return true;
}

/**
 * `PLAYING → COMPLETED`。タイマ停止・ヒント全解除・結果の構築を行う。
 *
 * **完成していなければ何も起こさない。** 完成の定義は 4.5 の1箇所にあり、ここでは数え直さない。
 * 上位は返った結果を成績へ記録し、中断状態を削除する（12.3 / 10.4）。
 */
export function complete(session: SessionState): SessionResult | null {
  if (session.phase !== 'PLAYING') return null;
  if (!isComplete(session.board)) return null;

  timer.stop(session.timer);
  hint.dismissAll(session.hint);
  session.phase = 'COMPLETED';
  return toResult(session);
}

/**
 * `PLAYING / PAUSED → DISCARDED`。タイマ停止・ヒント全解除を行う。
 * **結果は通知しない**（`playCount` は開始時に計上済みである。10.4）。
 */
export function discard(session: SessionState): boolean {
  if (session.phase !== 'PLAYING' && session.phase !== 'PAUSED') return false;
  timer.stop(session.timer);
  hint.dismissAll(session.hint);
  session.phase = 'DISCARDED';
  return true;
}

/** `COMPLETED / DISCARDED → IDLE`。セッション状態を解放する */
export function release(session: SessionState): boolean {
  if (session.phase !== 'COMPLETED' && session.phase !== 'DISCARDED') return false;
  undoStack.clear(session.undo);
  session.phase = 'IDLE';
  return true;
}

/** 現在の遷移状態（12章） */
export function phase(session: SessionState): SessionPhase {
  return session.phase;
}

// ---------------------------------------------------------------- 操作の取りまとめ（C-155）

export interface InputOutcome {
  /** 無効操作だったか（固定セル・範囲外・PLAYING 以外） */
  ignored: boolean;
  /** この操作が誤入力だったか */
  wasMistake: boolean;
  /** この操作で初めて失敗に到達したか（11.3 の提示契機） */
  justFailed: boolean;
  /** この操作で完成したか（10.4 の契機。遷移そのものは上位が `complete` で行う） */
  completed: boolean;
}

const IGNORED: InputOutcome = {
  ignored: true,
  wasMistake: false,
  justFailed: false,
  completed: false,
};

/**
 * 確定値を置く（第3分冊 8.7 パレット押下・メモOFF）。
 *
 * 盤面へ置く → 履歴へ積む → **誤りならミスを計上する** → **正解ならその升のヒントを閉じる**、
 * までを1手順で行う。順序は 3.4 の `place` の手順に従う（計数は盤面反映のあと）。
 *
 * **失敗到達後も何も制限しない**（5.5）。上限に達しても入力・誤り検出・計数は続く。
 */
export function input(session: SessionState, index: number, value: number): InputOutcome {
  if (session.phase !== 'PLAYING') return IGNORED;

  const outcome = board.place(session.board, index, value);
  if (outcome.ignored) return IGNORED;
  if (outcome.entry !== null) undoStack.push(session.undo, outcome.entry);

  let justFailed = false;
  if (outcome.wasMistake) {
    justFailed = mistake.record(session.mistake).justFailed;
  } else {
    // 正解入力に伴う自動解除（6.4）。**誤った値では閉じない**（表示を残すほうが助けになる）
    hint.dismissOnCorrectInput(session.hint, index);
  }

  return {
    ignored: false,
    wasMistake: outcome.wasMistake,
    justFailed,
    completed: outcome.completed,
  };
}

/** 記入値を消す（8.7 消去）。固定セル・空セルは無効操作で、履歴にも積まない（3.4） */
export function erase(session: SessionState, index: number): boolean {
  if (session.phase !== 'PLAYING') return false;
  const outcome = board.erase(session.board, index);
  if (outcome.ignored || outcome.entry === null) return false;
  undoStack.push(session.undo, outcome.entry);
  return true;
}

/** 候補メモを反転する（8.7 パレット押下・メモON）。Easy は常に無効操作（C-03） */
export function toggleNote(session: SessionState, index: number, value: number): boolean {
  if (session.phase !== 'PLAYING') return false;
  const outcome = board.toggleNote(session.board, index, value);
  if (outcome.ignored || outcome.entry === null) return false;
  undoStack.push(session.undo, outcome.entry);
  return true;
}

/** 当該セルの候補をすべて消す（第3分冊 9.2 メモON中の消去）。**確定値は消さない** */
export function clearNotes(session: SessionState, index: number): boolean {
  if (session.phase !== 'PLAYING') return false;
  const outcome = board.clearNotes(session.board, index);
  if (outcome.ignored || outcome.entry === null) return false;
  undoStack.push(session.undo, outcome.entry);
  return true;
}

/** 取り消す（7.5）。**ミスもヒントも戻さない**のは履歴側の規定どおりである */
export function undo(session: SessionState): undoStack.UndoOutcome {
  if (session.phase !== 'PLAYING') return { applied: false, changedIndices: [] };
  return undoStack.undo(session.undo, session.board);
}

/** やり直す（7.5）。**Redo で完成に到達する経路は無い**（C-116） */
export function redo(session: SessionState): undoStack.UndoOutcome {
  if (session.phase !== 'PLAYING') return { applied: false, changedIndices: [] };
  return undoStack.redo(session.undo, session.board);
}

/**
 * ヒントを求める（8.7）。**セル指定があればモードA、無ければモードB**（C-45）。
 * ボタンは1つで、モードの選択UIは設けない。
 */
export function requestHint(
  session: SessionState,
  index: number | null,
  random?: RandomSource,
): hint.HintOutcome {
  if (session.phase !== 'PLAYING') {
    return { ignored: true, display: null, usedCount: session.hint.usedCount };
  }
  return index === null
    ? hint.requestRandom(session.hint, session.board, random)
    : hint.requestForCell(session.hint, session.board, index);
}

/** ヒント表示を閉じる（× 操作）。**使用回数は減らさない**（6.6） */
export function dismissHint(session: SessionState, index: number): void {
  hint.dismiss(session.hint, index);
}

/** 取り消し・やり直しが可能か（第3分冊 8.6 の活性条件） */
export function canUndo(session: SessionState): boolean {
  return undoStack.canUndo(session.undo);
}

export function canRedo(session: SessionState): boolean {
  return undoStack.canRedo(session.undo);
}

// ---------------------------------------------------------------- 中断保存・結果（3.7 / 10.2）

/**
 * 中断保存用の像を構築する（3.7）。
 * **誤りマークは含めない**（復元時に再計算する）。**ヒントの表示状態も含めない**（C-27）。
 * **Undo/Redo 履歴も対象外である**（7.6）。
 */
export function toSuspended(session: SessionState): SuspendedSession {
  const { board: state } = session;
  return {
    schemaVersion: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    sourceId: state.sourceId,
    n: state.n,
    difficulty: state.difficulty,
    transformParams: state.transformParams,
    entered: [...state.entered],
    notes: notes.toArrays(state.notes),
    elapsedMs: timer.elapsed(session.timer),
    mistakeCount: session.mistake.count,
    failed: session.mistake.failed,
    hintUsed: session.hint.usedCount,
  };
}

/**
 * セッションの結果を構築する（10.2）。
 * `difficulty` は**元問題の難易度**である。`mistakeCount` は**表示専用**で、成績の集計には用いない（C-118）。
 */
export function toResult(session: SessionState): SessionResult {
  return {
    n: session.board.n,
    difficulty: session.board.difficulty,
    completed: isComplete(session.board),
    failed: session.mistake.failed,
    elapsedMs: timer.elapsed(session.timer),
    hintUsed: session.hint.usedCount,
    mistakeCount: session.mistake.count,
  };
}

/** 第2分冊 11.11 `SessionService` */
export const sessionService = {
  begin,
  resume,
  toSuspended,
  toResult,
  phase,
  pause,
  unpause,
  complete,
  discard,
  release,
  input,
  erase,
  toggleNote,
  clearNotes,
  undo,
  redo,
  requestHint,
  dismissHint,
  canUndo,
  canRedo,
};
