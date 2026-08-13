import type { Mgf, Player } from '../mgf/types';
import type { Position, Square } from '../position/types';
import { get as pluginGet } from '../../plugin/registry';
import { generatePieceMoves } from './generator';

type FindKingFn = (mgf: Mgf, position: Position, player: Player) => Square | null;

/**
 * Phase 4: 盤の端のつなぎ方に由来する「この駒はこのマスを脅かさない」判断。
 * false を返した組み合わせは王手の計算から外す。features/torus が
 * `topology:attackFilter` として登録する (core → features の型依存を作らないローカル型)。
 */
type TopologyAttackFilter = (
  mgf: Mgf,
  position: Position,
  from: Square,
  target: Square,
) => boolean;

export function findKing(mgf: Mgf, position: Position, player: Player): Square | null {
  // Phase 5-10 §Q13.4: 量子モードでは「玉として確定した駒」だけを王とみなす。
  // features/quantum が hook を登録している時のみ有効化 (量子モードでも玉未確定の
  // 局面では null 返し → isInCheck が false になり、王手/詰み判定が発生しない)。
  // 通常将棋モード (A ビルド) は hook 未登録なので下の kind ベース実装を使う。
  const quantumFindKing = pluginGet<FindKingFn>('quantum:findKing');
  if (quantumFindKing) return quantumFindKing(mgf, position, player);

  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (cell && royalKinds.has(cell.kind) && cell.owner === player) {
        return { row, col };
      }
    }
  }
  return null;
}

/**
 * 指定マスが player の擬合法手で捕獲可能か判定する (王手判定用)。
 * player の手番でなくても計算可能。
 */
export function isSquareAttackedBy(
  mgf: Mgf,
  position: Position,
  target: Square,
  attacker: Player,
): boolean {
  const attackerTurnPos: Position = { ...position, sideToMove: attacker };
  // Phase 4: 完全トーラスでは玉どうしが盤の端をまたいで隣り合うので、そのままだと
  // 開始局面から双方に王手がかかって玉しか動かせない。features/torus が登録する
  // フィルタで「玉は敵玉を脅かさない」を除外する (平面・円筒では常に true)。
  const attackFilter = pluginGet<TopologyAttackFilter>('topology:attackFilter');
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== attacker) continue;
      if (attackFilter && !attackFilter(mgf, position, { row, col }, target)) continue;
      const moves = generatePieceMoves(mgf, attackerTurnPos, { row, col });
      if (moves.some((m) => m.to.row === target.row && m.to.col === target.col)) {
        return true;
      }
    }
  }
  return false;
}

export function isInCheck(mgf: Mgf, position: Position, player: Player): boolean {
  const king = findKing(mgf, position, player);
  if (!king) return false;
  const opponent: Player = player === 'player1' ? 'player2' : 'player1';
  return isSquareAttackedBy(mgf, position, king, opponent);
}
