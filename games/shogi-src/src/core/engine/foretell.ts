import type { Mgf } from './mgf/types';
import type { PieceId, Position, Square } from './position/types';
import { groupCandidatesByKind } from './candidate-kinds';
import { generatePieceMoves } from './moves/generator';

/**
 * 移動先による駒種確定の予告 (spec 駒デザイン・対局UI §4.3・Phase 5-11)。
 *
 * 未確定の駒には「そこへ動けるのは 1 駒種だけ」という行き先がある。そこへ動けば
 * C-101 (行動可能性) がその駒種以外の候補を落とすので、動かした時点で駒種が決まる。
 * この関数はそういう行き先を集めて「そこへ動くとこの駒に決まる」を返す。
 *
 * 到達判定は候補をその駒種だけに絞った盤面を作って generatePieceMoves に問い合わせる。
 * 経路の遮り・成れる範囲・行き所のない駒といった判断を二重に実装しないため。
 *
 * 戻り値のキーは "row,col"。本将棋モードや確定済みの駒では空 Map を返す。
 *
 * 注意: ここで言う「確定」は駒種の確定であって、候補 PieceID が 1 個に決まることでは
 * ない (金が 2 枚あればどちらの金かは決まらない)。プレイヤーに見せたいのは
 * 「何の駒になるか」なので駒種の粒度で判定している。
 */
export function foretellKindByDestination(
  mgf: Mgf,
  position: Position,
  from: Square,
  kindMap: Map<PieceId, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  const piece = position.board[from.row][from.col];
  if (!piece || piece.candidates === undefined) return result;

  const groups = groupCandidatesByKind(mgf, piece.candidates, piece.promoted, kindMap);
  if (groups.size < 2) return result;

  // 行き先 → そこへ到達できる駒種の一覧
  const reach = new Map<string, string[]>();
  for (const [kind, pids] of groups) {
    const probe: Position = {
      ...position,
      board: position.board.map((r) => r.slice()),
    };
    probe.board[from.row][from.col] = { ...piece, candidates: new Set(pids) };
    for (const m of generatePieceMoves(mgf, probe, from)) {
      const key = `${m.to.row},${m.to.col}`;
      const list = reach.get(key);
      if (!list) reach.set(key, [kind]);
      else if (!list.includes(kind)) list.push(kind);
    }
  }

  for (const [key, kinds] of reach) {
    if (kinds.length === 1) result.set(key, kinds[0]);
  }
  return result;
}
