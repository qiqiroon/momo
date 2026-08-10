import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceId, Position, Square } from '../../core/engine/position/types';
import { buildInitialKindMap, isCheckmate } from '../../core/engine';

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
 * 注意: 判定は候補更新の**前**の盤面に対して行う (game-store の applyAndCommit から
 * 捕獲時の C-201 と同じ位置で呼ばれる)。候補更新後の狭まった候補で判定すれば厳密には
 * より強い結論が出せる場面もあるが、詰み判定は重いので 1 手 1 回に留めている。
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

  // 「この駒が歩だったら」の盤面で詰みか
  const probe: Position = { ...pos, board: pos.board.map((r) => r.slice()) };
  probe.board[to.row][to.col] = { ...piece, candidates: new Set(fuIds) };
  if (!isCheckmate(mgf, probe)) return pos;

  // 詰みになる手が打てた = 打ち歩詰めではない = 歩ではない
  const next: Position = { ...pos, board: pos.board.map((r) => r.slice()) };
  next.board[to.row][to.col] = { ...piece, candidates: new Set(others) };
  return next;
}
