import type { Mgf, MgfPieceDef } from '../mgf/types';
import type { Move, PieceInstance, Position, Square } from '../position/types';
import { applyMove } from '../position/apply';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { get as pluginGet } from '../../plugin/registry';
import { buildInitialKindMap, confirmedKindOf, displayKindsFor } from '../candidate-kinds';
import { isInCheck } from './check';
import { generateDropMoves } from './drops';
import { fileHasCertainPawn } from './nifu';
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

  // Phase 4: 盤の端のつなぎ方だけに由来する追加の禁じ手 (完全トーラスの
  // 「王で敵王を取れない」= 親 §3.4.2 の最小介入)。features/torus が登録している
  // ときだけ効く。平面・円筒では常に true を返すので、通常将棋は素通りする。
  const topologyFilter = pluginGet<TopologyMoveFilter>('topology:moveFilter');
  if (topologyFilter && !topologyFilter(mgf, position, move)) return false;

  // 自玉が王手放置 or 自ら王手される手 (suicide)
  const after = applyMove(mgf, position, move);
  if (isInCheck(mgf, after, mover)) return false;

  // 打歩詰め: 歩打による相手詰めは反則。
  // v1.09: 量子モードでは「歩と確定している駒を打つとき」だけ見る。まだ歩と決まって
  // いない駒は歩打とは言い切れないので禁止しない。逆に、詰みになる手が打てたという
  // ことは打ち歩詰めではない = その駒は歩ではないので、候補から歩を落とす
  // (features/quantum/drop-effects.ts)。
  //
  // v1.19 (Phase 5-15 §Q15.5): 詰みかどうかは**候補更新を通した安定状態**で見る。
  // 絞り込みは候補を減らすだけなので相手の逃げ道は減る方向にしか動かない。つまり
  // 通さずに見ると打ち歩詰めを**見逃して打ててしまう**side に外れていた (逆向きの
  // 誤り=打てるはずの手を禁じる、は起きない)。
  if (move.type === 'drop' && !opts.skipUchifuTsume && mgf.constraints?.uchifu_tsume) {
    const player = position.sideToMove;
    const piece = position.hands[player].find((p) => p.pieceId === move.pieceId);
    if (piece && confirmedKindOf(mgf, piece, buildInitialKindMap(position)) === 'fu') {
      const settled = settleForJudgement(mgf, after);
      if (settled && isCheckmate(mgf, settled)) return false;
    }
  }

  return true;
}

/**
 * Phase 4: 盤の端のつなぎ方に由来する追加の禁じ手。false を返した手は指せない。
 * features/torus が `topology:moveFilter` として登録する (core → features の型依存を
 * 作らないローカル型)。
 */
type TopologyMoveFilter = (mgf: Mgf, position: Position, move: Move) => boolean;

type CandidateUpdateFn = (position: Position, mgf: Mgf) => Position;

/**
 * 判定用に「候補更新を通した安定状態」(§Q7.9) を作る。
 *
 * 本将棋モード (hook 未登録) では候補更新そのものが無いので、渡された局面がそのまま
 * 安定状態。量子モードでは候補更新を 1 度通す。
 *
 * **異常 (候補が空・反復上限) が出たら null を返す**。呼び出し側は「判定できなかった」
 * として扱い、手を弾かない。仮の判定の途中で出た異常でその手を禁じてしまうと、本物の
 * 異常として表に出る機会を奪ってしまうため (2026-08-12 ユーザー方針=いまは量子異常を
 * 表に出して発生条件そのものを減らしていく段階。将来スイッチで避けさせる予定)。
 */
function settleForJudgement(mgf: Mgf, position: Position): Position | null {
  const candidateUpdate = pluginGet<CandidateUpdateFn>('quantum:candidateUpdate');
  if (!candidateUpdate) return position;
  try {
    return candidateUpdate(position, mgf);
  } catch {
    return null;
  }
}

export function isCheckmate(mgf: Mgf, position: Position): boolean {
  if (!isInCheck(mgf, position, position.sideToMove)) return false;
  return !hasAnyLegalMove(mgf, position, { skipUchifuTsume: true });
}

/**
 * 合法手が 1 つでもあるか。**最初の 1 つが見つかった時点で打ち切る**。
 *
 * 詰み判定は「逃げ道が 1 つでもあるか」しか要らないのに、以前は合法手を全部作ってから
 * 個数を見ていた。量子モードでは 1 手の合法性を確かめるたびに王手判定 (＝相手全駒の
 * 手を候補の和集合で作る) が走るので、逃げ道が見つかった後の手を調べる分がそのまま
 * 無駄になる。実測で 27ms → 7ms (169 手中 54 手目で発見・PC)。
 *
 * 詰んでいる場合は結局すべて調べるので最悪値は変わらない。返す答えは以前と同じ。
 *
 * ※この重さは「王として確定した駒がある」ときにしか出ない (§Q13.1 により、王が
 * 未確定なら王手が成立せず isInCheck が即 false になる)。つまり終盤で王が確定して
 * から効いてくる。
 */
export function hasAnyLegalMove(mgf: Mgf, position: Position, opts: LegalOpts = {}): boolean {
  for (const m of generateAllBoardMoves(mgf, position)) {
    if (isMoveLegal(mgf, position, m, opts)) return true;
  }
  for (const m of generateDropMoves(mgf, position)) {
    if (isMoveLegal(mgf, position, m, opts)) return true;
  }
  return false;
}

/**
 * 打つ手が許されるか。
 *
 * v1.09 (Phase 5-11 追補): 量子モードでは駒の正体が決まっていないので、
 * **候補の駒種のうち 1 つでも合法に打てるなら打てる**とする (盤上の動きを
 * 候補の和集合で出しているのと同じ考え方)。打った後に「その手を非合法にする候補」は
 * 候補更新の側で落ちる (二歩なら C-103・行き所のない駒なら C-104)。
 *
 * 以前は piece.kind (＝初期位置の駒種で正体ではない) 1 つだけで判定していたため、
 * 歩以外の可能性を持つ駒まで歩として二歩に引っかかり、打てる筋が 1〜2 列しか
 * 残らなかった。
 */
function isDropAllowed(
  mgf: Mgf,
  position: Position,
  to: Square,
  pieceId: string,
): boolean {
  const player = position.sideToMove;
  const piece = position.hands[player].find((p) => p.pieceId === pieceId);
  if (!piece) return false;
  const kindMap = buildInitialKindMap(position);
  const kinds = displayKindsFor(mgf, piece, kindMap);
  return kinds.some((kind) => isDropAllowedAsKind(mgf, position, to, piece, kind));
}

/** 「この駒が駒種 K だったとして」打てるか。 */
function isDropAllowedAsKind(
  mgf: Mgf,
  position: Position,
  to: Square,
  piece: PieceInstance,
  kind: string,
): boolean {
  const player = position.sideToMove;
  const def = mgf.pieces.find((p) => p.id === kind);
  if (!def) return false;
  if (!def.is_hand_piece) return false;

  // 打歩: 同筋二歩禁止。
  // 数える対象は「必ず歩だと言い切れる駒」だけ。未確定の駒を kind で数えると、まだ歩と
  // 決まっていない駒が筋を塞いでしまう (本将棋モードでは候補が無いので駒種そのままの
  // 判定になり、従来と同じ結果になる)。
  //
  // v1.15 (ユーザー指摘): 個々の駒が確定していなくても「その筋の 2 枚のどちらかは
  // 必ず歩」と言い切れる場面がある。そこへ歩と確定した駒を打てば必ず二歩なので、
  // 打った後に候補から歩を落とす (＝候補が空になる) のではなく、打てない手として弾く。
  // 判定は fileHasCertainPawn に 1 本化し、打った後の絞り込み (C-103) と同じ数え方にする。
  if (kind === 'fu' && mgf.constraints?.nifu) {
    if (fileHasCertainPawn(position, to.col, player, piece)) return false;
  }

  // dead_zone: 打った駒が動けない位置なら禁止 (歩・香を最奥、桂を最奥2段目まで、など)
  if (mgf.constraints?.dead_zone === true || mgf.constraints?.dead_zone === 'auto') {
    if (!hasAnyMoveFromDrop(def, piece, to, position)) {
      return false;
    }
  }

  return true;
}

/**
 * 打った先から動ける手があるか (行き所のない駒の判定)。
 *
 * Phase 4 (親 §3.9 v1.11 追記): 上下がつながっている盤 (完全トーラス) では、
 * 最奥まで進んでもそのまま反対側へ抜けられるので「行き所のない駒」が存在しない。
 * 縦方向に効くこの制約はその場合だけ外す (円筒＝左右のみでは従来どおり効く)。
 */
function hasAnyMoveFromDrop(
  def: MgfPieceDef,
  piece: PieceInstance,
  to: Square,
  position: Position,
): boolean {
  if (!def.move_logic) return false;
  const topology = topologyOf(position);
  const { width, height } = position;
  // must_promote_at: 打った位置から成らずに動ける段がなければ禁止 (歩=敵最奥・香=敵最奥・桂=敵最奥2段)
  if (def.must_promote_at && !piece.promoted && !topology.wrapY) {
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
      const target = wrapSquare({ row: to.row + drow, col: to.col + dcol }, width, height, topology);
      if (target) return true;
    }
  }
  return false;
}
