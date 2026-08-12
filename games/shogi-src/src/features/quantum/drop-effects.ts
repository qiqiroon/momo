import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceId, Position, Square } from '../../core/engine/position/types';
import { buildInitialKindMap, isCheckmate } from '../../core/engine';
import { candidateUpdate } from './candidate-update';

/**
 * 打った手から得られる絞り込み (v1.09・Phase 5-11 追補)。
 *
 * ## 考え方
 *
 * 「その手が指せた」ということは「その手を反則にする正体ではなかった」ということ。
 * 盤上の動きについては C-101 (行動可能性) が同じ理屈で候補を狭めているので、
 * 打つ手についても同じ扱いを揃える。
 *
 * 打つ手に効く反則は 3 つあり、それぞれ担当が違う:
 * - **二歩** … 打った先は盤上の駒になるので C-103 が拾う (同筋に歩と確定した駒が
 *   居るのに打てた = 歩ではない)。ここでは何もしない。
 * - **行き所のない駒** … 同じく C-104 が拾う。ここでは何もしない。
 * - **打ち歩詰め** … 詰み判定が要るので候補更新の反復ループに入れると重い。
 *   ここで 1 回だけ評価する。
 *
 * ## 打ち歩詰めの絞り込み
 *
 * 歩の可能性を持つ未確定駒を打って相手が詰みになったとする。もしその駒が歩だったなら
 * 打ち歩詰めで反則 = そもそも打てない。実際に打てたのだから歩ではない。よって候補から
 * 歩を落とす。
 *
 * 詰みかどうかは「その駒が歩だったとしたら」で判定する必要があるので、候補を歩だけに
 * 絞った盤面を作って詰み判定にかける。
 *
 * v1.19 (Phase 5-15 §Q15.5): 詰みかどうかは「打たれた歩が確定歩となった**安定状態**」で
 * 見る、と仕様が定めている。よって「歩だったら」の盤面に候補更新を 1 度通してから
 * 詰み判定にかける。通さない判定は打ち歩詰めを見逃す側に外れるので、打つ前の禁止判定
 * (core/engine/moves/legal.ts) と数え方が食い違ってしまう。両方を安定状態に揃える。
 *
 * 仮の盤面で異常 (候補が空・反復上限) が出たら、絞り込みは行わない。「歩だとすると
 * 矛盾する = 歩ではない」と踏み込むこともできるが、仕様が定めているのは詰みからの
 * 推論だけなので、そこまでは踏み込まない。
 */
export function applyUchifuTsumeExclusion(
  pos: Position,
  mgf: Mgf,
  droppedPieceId: PieceId,
  to: Square,
): Position {
  if (mgf.constraints?.uchifu_tsume !== true) return pos;

  const piece = pos.board[to.row][to.col];
  if (!piece || piece.pieceId !== droppedPieceId) return pos;
  if (piece.candidates === undefined || piece.confirmed) return pos;

  const kindMap = buildInitialKindMap(pos);
  const fuIds: PieceId[] = [];
  const others: PieceId[] = [];
  for (const pid of piece.candidates) {
    if (kindMap.get(pid) === 'fu') fuIds.push(pid);
    else others.push(pid);
  }
  // 歩の可能性が無いなら関係ない。歩しか残っていないなら落とす先が無い
  // (＝確定した歩なので、そもそも打つ時点で反則として弾かれている)。
  if (fuIds.length === 0 || others.length === 0) return pos;

  // 「この駒が歩だったら」の盤面を作り、候補更新を通した安定状態で詰みかを見る
  const probe: Position = { ...pos, board: pos.board.map((r) => r.slice()) };
  probe.board[to.row][to.col] = { ...piece, candidates: new Set(fuIds) };
  let settled: Position;
  try {
    settled = candidateUpdate(probe, mgf);
  } catch {
    return pos;
  }
  if (!isCheckmate(mgf, settled)) return pos;

  // 詰みになる手が打てた = 打ち歩詰めではない = 歩ではない
  const next: Position = { ...pos, board: pos.board.map((r) => r.slice()) };
  next.board[to.row][to.col] = { ...piece, candidates: new Set(others) };
  return next;
}
