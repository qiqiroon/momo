/**
 * 量子モード初期候補割当 (Phase 5-2)。
 *
 * §Q4.2 uniform_pool: 対局開始時、各駒の候補集合を「自陣営に存在する駒種すべて」とする。
 *
 * kickoff §5.3 の指針に従い、初期実装 (5-1〜5-8) は駒種集合ベース (Set<string>) で運用する。
 * 5-15 以降で必要に応じて PieceID ベースへ移行する余地がある。
 */

import type { Position, PieceInstance } from '../../core/engine/position/types';
import type { Player } from '../../core/engine/mgf/types';

function collectKindsOnSide(pos: Position, side: Player): Set<string> {
  const kinds = new Set<string>();
  for (let row = 0; row < pos.height; row++) {
    for (let col = 0; col < pos.width; col++) {
      const cell = pos.board[row][col];
      if (cell && cell.owner === side) kinds.add(cell.kind);
    }
  }
  for (const piece of pos.hands[side]) kinds.add(piece.kind);
  return kinds;
}

/**
 * 量子モード ON でオフライン/オンライン対局を開始するときに呼ぶ。
 * 与えられた Position の各駒に候補集合を付けた新しい Position を返す (元は破壊しない)。
 *
 * 本将棋の初期局面に対して呼ぶと、各駒の candidates は同陣営の 8 駒種
 * ({fu, kyo, kei, gin, kin, kaku, hi, ou}) の集合になる。
 */
export function quantumInit(pos: Position): Position {
  const p1Kinds = collectKindsOnSide(pos, 'player1');
  const p2Kinds = collectKindsOnSide(pos, 'player2');

  const assign = (piece: PieceInstance): PieceInstance => {
    const kinds = piece.initialOwner === 'player1' ? p1Kinds : p2Kinds;
    return {
      ...piece,
      candidates: new Set(kinds),
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
