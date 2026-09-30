/**
 * 1 手進めて、**その手が起こす後処理まで済ませる** (★v1.93)。
 *
 * `applyMove` は駒を動かすだけで、量子モードの後処理 (捕獲の C-201/C-202・打つ手の
 * 絞り込み・候補更新) はしない。後処理は長いあいだ対局画面 (game-store) の中にだけ
 * 書かれていたので、**思考ルーチンは後処理の無い別のゲームを読んでいた**
 * (2026-09-30 実測＝量子の初期局面から 12 手進めると 4 手で候補が食い違い、
 * 王と確定した駒をタダで取れる局面でも 5 回とも取らなかった)。
 *
 * **盤を 1 手進める者は全員ここを通る**＝対局画面・成る/成らずの選択肢・自作探索・
 * 汎用MCTS。道を 1 本にしておけば、どれか 1 つだけが古い手順のまま残ることが無い。
 *
 * 量子の中身は features/quantum が `register` した口から借りる (core → features の型依存を
 * 作らないため、形だけをここに持つ)。**量子でない対局では `applyMove` とまったく同じ**
 * ＝本将棋・はさみ・トーラスの振る舞いと速さは変わらない。
 */

import type { Mgf } from '../mgf/types';
import type { Move, PieceInstance, Position, Square } from './types';
import { applyMove } from './apply';
import { get as pluginGet } from '../../plugin/registry';

export type AdvanceTorusMode = 'none' | 'cylinder' | 'full';

/** この対局の後処理の決まり。対局中は変わらない。 */
export interface AdvanceRules {
  /** 量子モードか。false なら後処理は何もしない。 */
  quantum: boolean;
  /** 盤の端のつなぎ方 (候補更新が盤端の絞り込みに使う)。 */
  torusMode?: AdvanceTorusMode;
  /** 候補更新の反復上限 (§Q17.8 `max_iterations`)。省略時は量子側の既定。 */
  maxIterations?: number;
}

export const PLAIN_RULES: AdvanceRules = { quantum: false };

/** 量子の異常状態の原因 (§Q8.8 C-901 / §Q7.9.1)。 */
export type AdvanceAnomalyCause = 'empty_candidates' | 'iteration_limit';

export interface AdvanceResult {
  /** 進めたあとの局面。異常が出たときは**打ち切った時点の局面** (盤を停止時点のまま見せる決まり)。 */
  position: Position;
  /**
   * **王と確定した駒を取った** (§Q8.5 C-202)。その場で指した側の勝ち＝後処理はしない。
   * 量子でない対局では常に false (王を取る手はそもそも生まれない)。
   */
  royalCaptured: boolean;
  /** 候補更新が異常を出した (候補が空・反復上限)。無ければ null。 */
  anomaly: AdvanceAnomalyCause | null;
}

type CandidateUpdateFn = (
  pos: Position,
  mgf: Mgf,
  context?: { torusMode?: AdvanceTorusMode; maxIterations?: number },
) => Position;

type OnDropFn = (pos: Position, mgf: Mgf, droppedPieceId: string, to: Square) => Position;

type OnCaptureHook = {
  applyC201: (pos: Position, capturedPieceId: string, mgf: Mgf) => Position;
  isConfirmedKing: (piece: PieceInstance, infoMap: ReadonlyMap<string, unknown>, mgf: Mgf) => boolean;
  buildInitialInfoMap: (pos: Position) => ReadonlyMap<string, unknown>;
};

/**
 * features/quantum が投げる異常状態の例外を見分ける (core は features を import できないので
 * 目印の欄で判定する)。
 */
export interface QuantumAnomalyLike {
  quantumAnomaly: true;
  anomalyCause: AdvanceAnomalyCause;
  position: Position;
}

export function asQuantumAnomaly(e: unknown): QuantumAnomalyLike | null {
  if (!e || typeof e !== 'object') return null;
  const a = e as Partial<QuantumAnomalyLike>;
  if (a.quantumAnomaly !== true) return null;
  if (a.anomalyCause !== 'empty_candidates' && a.anomalyCause !== 'iteration_limit') return null;
  if (!a.position) return null;
  return a as QuantumAnomalyLike;
}

/**
 * 1 手進める。手順は対局画面が v1.92 まで自分で持っていたものと同じ。
 *
 * 1. 駒を動かす (`applyMove`)
 * 2. 取った駒が**王と確定**していれば C-202＝ここで終わり (候補更新はしない)。
 *    そうでなければ C-201 (取られた駒は王ではなかった) を反映
 * 3. 打つ手なら、打った手から分かる絞り込み
 * 4. 候補更新。異常が出たら打ち切った時点の局面を返し、`anomaly` に原因を入れる
 *
 * **駒を動かせない手** (掴んだ駒が無い等) は `applyMove` の例外がそのまま出る。
 * 量子の異常以外の例外も握りつぶさない (黙って別のことをしないため)。
 */
export function advancePosition(mgf: Mgf, position: Position, move: Move, rules: AdvanceRules): AdvanceResult {
  let next = applyMove(mgf, position, move);
  if (!rules.quantum) return { position: next, royalCaptured: false, anomaly: null };

  if (move.type === 'move') {
    const captured = position.board[move.to.row][move.to.col];
    if (captured) {
      const capHook = pluginGet<OnCaptureHook>('quantum:onCapture');
      if (capHook) {
        const infoMapBefore = capHook.buildInitialInfoMap(position);
        if (capHook.isConfirmedKing(captured, infoMapBefore, mgf)) {
          return { position: next, royalCaptured: true, anomaly: null };
        }
        next = capHook.applyC201(next, captured.pieceId, mgf);
      }
    }
  }

  if (move.type === 'drop') {
    const dropHook = pluginGet<OnDropFn>('quantum:onDrop');
    if (dropHook) next = dropHook(next, mgf, move.pieceId, move.to);
  }

  const candidateUpdate = pluginGet<CandidateUpdateFn>('quantum:candidateUpdate');
  if (candidateUpdate) {
    try {
      next = candidateUpdate(next, mgf, {
        torusMode: rules.torusMode ?? 'none',
        maxIterations: rules.maxIterations,
      });
    } catch (e) {
      const anomaly = asQuantumAnomaly(e);
      if (!anomaly) throw e;
      return { position: anomaly.position, royalCaptured: false, anomaly: anomaly.anomalyCause };
    }
  }
  return { position: next, royalCaptured: false, anomaly: null };
}
