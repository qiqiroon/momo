import type { Mgf, MgfPieceDef } from '../mgf/types';
import type { BoardCell, Move, PieceInstance, Position, Square } from '../position/types';
import { applyMove } from '../position/apply';
import { isInCheck } from './check';
import { generateDropMoves } from './drops';
import { directionOffsets } from './directions';
import { generateAllBoardMoves } from './generator';

interface LegalOpts {
  skipUchifuTsume?: boolean;
}

export function generateLegalMoves(mgf: Mgf, position: Position, opts: LegalOpts = {}): Move[] {
  const pseudo: Move[] = [...generateAllBoardMoves(mgf, position), ...generateDropMoves(mgf, position)];
  return pseudo.filter((m) => isMoveLegal(mgf, position, m, opts));
}

export function isMoveLegal(mgf: Mgf, position: Position, move: Move, opts: LegalOpts = {}): boolean {
  const mover = position.sideToMove;

  // 打つ手固有の反則を先にチェック (applyMove 呼び出し前に落とせるものを落とす)
  if (move.type === 'drop') {
    if (!isDropAllowed(mgf, position, move.to, move.pieceId)) return false;
  }

  // 自玉が王手放置 or 自ら王手される手 (suicide)
  const after = applyMove(mgf, position, move);
  if (isInCheck(mgf, after, mover)) return false;

  // 打歩詰め: 歩打による相手詰めは反則
  if (move.type === 'drop' && !opts.skipUchifuTsume && mgf.constraints?.uchifu_tsume) {
    const player = position.sideToMove;
    const piece = position.hands[player].find((p) => p.pieceId === move.pieceId);
    if (piece?.kind === 'fu') {
      if (isCheckmate(mgf, after)) return false;
    }
  }

  return true;
}

export function isCheckmate(mgf: Mgf, position: Position): boolean {
  if (!isInCheck(mgf, position, position.sideToMove)) return false;
  const escapes = generateLegalMoves(mgf, position, { skipUchifuTsume: true });
  return escapes.length === 0;
}

function isDropAllowed(
  mgf: Mgf,
  position: Position,
  to: Square,
  pieceId: string,
): boolean {
  const player = position.sideToMove;
  const piece = position.hands[player].find((p) => p.pieceId === pieceId);
  if (!piece) return false;
  const def = mgf.pieces.find((p) => p.id === piece.kind);
  if (!def) return false;

  // 打歩: 同筋二歩禁止
  if (piece.kind === 'fu' && mgf.constraints?.nifu) {
    for (let row = 0; row < position.height; row++) {
      const cell = position.board[row][to.col];
      if (cell && cell.owner === player && cell.kind === 'fu' && !cell.promoted) {
        return false;
      }
    }
  }

  // dead_zone: 打った駒が動けない位置なら禁止 (歩・香を最奥、桂を最奥2段目まで、など)
  if (mgf.constraints?.dead_zone === true || mgf.constraints?.dead_zone === 'auto') {
    if (!hasAnyMoveFromDrop(mgf, def, piece, to, position.board, position.height, position.width)) {
      return false;
    }
  }

  return true;
}

function hasAnyMoveFromDrop(
  _mgf: Mgf,
  def: MgfPieceDef,
  piece: PieceInstance,
  to: Square,
  _board: BoardCell[][],
  height: number,
  width: number,
): boolean {
  if (!def.move_logic) return false;
  // must_promote_at: 打った位置から成らずに動ける段がなければ禁止 (歩=敵最奥・香=敵最奥・桂=敵最奥2段)
  if (def.must_promote_at && !piece.promoted) {
    const rank = to.row + 1;
    const enemyBackRank = piece.owner === 'player1' ? 1 : height;
    const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);
    if (distanceFromEnemyBack < def.must_promote_at) return false;
  }
  // 盤外に出るしか無い場合を除いて、動ける方向を持つ駒はドロップ可
  // (盤上の他駒による一時的なブロックは反則対象外。将棋の dead_zone は必ず盤外に出るケースのみ)
  for (const ability of def.move_logic.abilities) {
    const offsets = directionOffsets(ability.direction, piece.owner);
    for (const { drow, dcol } of offsets) {
      const target = { row: to.row + drow, col: to.col + dcol };
      if (target.row >= 0 && target.row < height && target.col >= 0 && target.col < width) {
        return true;
      }
    }
  }
  return false;
}
