/**
 * 量子モード初期候補割当 (Phase 5-2 / Phase 5-6.5 移行後)。
 *
 * §Q4.2 uniform_pool: 対局開始時、各駒の候補集合を「自陣営の全 PieceID 集合」とする。
 *
 * Phase 5-6.5 で candidates の中身は PieceID の集合になった。sente 駒には自陣営 sente の
 * 全 PieceID (通常 P0..P19)、gote 駒には自陣営 gote の全 PieceID (通常 p0..p19) を割り当てる。
 * 「自陣営」の判定は piece.initialOwner を基準に行う。
 */

import type { PieceId, Position, PieceInstance } from '../../core/engine/position/types';
import type { Player } from '../../core/engine/mgf/types';

/** 盤上・両手駒を走査して、指定 initialOwner の全 PieceID を集める。 */
function collectPieceIdsBySide(pos: Position, side: Player): Set<PieceId> {
  const ids = new Set<PieceId>();
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === side) ids.add(cell.pieceId);
    }
  }
  for (const p of pos.hands.player1) if (p.initialOwner === side) ids.add(p.pieceId);
  for (const p of pos.hands.player2) if (p.initialOwner === side) ids.add(p.pieceId);
  return ids;
}

/**
 * 量子モード ON でオフライン/オンライン対局を開始するときに呼ぶ。
 * 与えられた Position の各駒に候補 PieceID 集合を付けた新しい Position を返す (元は破壊しない)。
 *
 * 本将棋の初期局面に対して呼ぶと、各 sente 駒の candidates は sente 全駒 (P0..P19) の 20 PieceID、
 * 各 gote 駒の candidates は gote 全駒 (p0..p19) の 20 PieceID となる。
 */
export function quantumInit(pos: Position): Position {
  const p1Ids = collectPieceIdsBySide(pos, 'player1');
  const p2Ids = collectPieceIdsBySide(pos, 'player2');

  const assign = (piece: PieceInstance): PieceInstance => {
    const ids = piece.initialOwner === 'player1' ? p1Ids : p2Ids;
    return {
      ...piece,
      candidates: new Set(ids),
      confirmed: false,
    };
  };

  const newBoard = pos.board.map((row) =>
    row.map((cell) => (cell ? assign(cell) : null)),
  );
  const newHands = {
    player1: pos.hands.player1.map(assign),
    player2: pos.hands.player2.map(assign),
  };

  return {
    ...pos,
    board: newBoard,
    hands: newHands,
  };
}
