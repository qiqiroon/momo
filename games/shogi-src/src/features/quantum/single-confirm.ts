/**
 * §Q8.7 C-301 単一候補確定 (Phase 5-8)。
 *
 * 候補集合が 1 個に収縮した駒を「確定 (confirmed)」としてマークする。§Q7.4 の擬似コードでは
 * 制約適用ループの中に独立したパスとして置かれており、本実装もそれに合わせて
 * candidate_update の 1 反復ごとに全駒へ 1 パス回す。
 *
 * ## なぜ独立パスなのか (Phase 5-8 で正式化した理由)
 *
 * 5-8 以前は candidate-update.ts の「候補を狭めた瞬間」に confirmed を副次的に立てていた。
 * そのため **候補を狭めたのが制約ループの外だった場合に確定フラグが立たない** 取りこぼしがあった。
 * 具体例が §Q8.5 C-201 (捕獲時の王候補除去) で、除去の結果 candidates が 1 個になっても
 * confirmed=false のままだった。独立パスにすることで「1 個になったら確定」が
 * 誰が狭めたかに依らず成立する。
 *
 * ## 確定は一方向 (false → true のみ)
 *
 * C-002 候補単調性により候補集合は増えないので、一度 1 個になった駒が 2 個に戻ることはない。
 * したがって confirmed を false に戻す経路は作らない (5-8 以前は size>1 の時に false を
 * 書き戻していたが、確定済みの駒を取り消す意味論は仕様に無い)。
 */

import type { PieceInstance, Position } from '../../core/engine/position/types';

/**
 * C-301 を 1 パス適用する。
 *
 * - candidates が undefined (通常将棋モード) の駒は触らない (縮退互換)。
 * - 変化がなければ入力の Position / PieceInstance をそのまま返す (identity 保存)。
 */
export function applyC301SingleConfirm(pos: Position): { next: Position; changed: boolean } {
  let changed = false;

  const confirmOne = (piece: PieceInstance): PieceInstance => {
    if (piece.candidates === undefined) return piece;
    if (piece.candidates.size !== 1) return piece;
    if (piece.confirmed === true) return piece;
    changed = true;
    return { ...piece, confirmed: true };
  };

  const nextBoard = pos.board.map((row) => row.map((cell) => (cell ? confirmOne(cell) : cell)));
  const nextHands = {
    player1: pos.hands.player1.map(confirmOne),
    player2: pos.hands.player2.map(confirmOne),
  };

  if (!changed) return { next: pos, changed: false };
  return { next: { ...pos, board: nextBoard, hands: nextHands }, changed: true };
}
