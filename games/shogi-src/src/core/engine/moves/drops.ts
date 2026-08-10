import type { Mgf } from '../mgf/types';
import type { DropMove, Position } from '../position/types';
import { buildInitialKindMap, displayKindsFor } from '../candidate-kinds';

/**
 * 現手番の持ち駒から可能な打つ手 (擬合法) を全て生成する。
 * nifu / uchifu_tsume / dead_zone / suicide の除外は generateLegalMoves 側で行う。
 *
 * v1.09 (Phase 5-11 追補): 量子モード対応。
 * - 持ち駒の重複除去を `piece.kind` (＝初期位置の駒種で正体ではない) ではなく
 *   「候補の中身」で行う。同じ kind でも候補が違えば別の駒なので、まとめると
 *   一方の打つ手がまるごと消えてしまう。
 * - 打てる駒かどうか (is_hand_piece) も候補のどれか 1 つが該当すれば可とする。
 */
export function generateDropMoves(mgf: Mgf, position: Position): DropMove[] {
  const player = position.sideToMove;
  const hand = position.hands[player];
  const moves: DropMove[] = [];
  const seen = new Set<string>();
  const kindMap = buildInitialKindMap(position);

  for (const piece of hand) {
    const kinds = displayKindsFor(mgf, piece, kindMap);
    // 候補の中身が同じ持ち駒は打つ手も同じなので 1 枚ぶんだけ生成する
    const signature = [...kinds].sort().join(',');
    if (seen.has(signature)) continue;
    seen.add(signature);

    const droppable = kinds.some((k) => mgf.pieces.find((p) => p.id === k)?.is_hand_piece);
    if (!droppable) continue;

    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        if (position.board[row][col]) continue;
        moves.push({ type: 'drop', pieceId: piece.pieceId, to: { row, col } });
      }
    }
  }
  return moves;
}
