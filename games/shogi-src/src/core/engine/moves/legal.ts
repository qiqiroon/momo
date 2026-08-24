import type { Mgf, MgfPieceDef, Player } from '../mgf/types';
import type { Move, PieceInstance, Position, Square } from '../position/types';
import { applyMove } from '../position/apply';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { get as pluginGet } from '../../plugin/registry';
import { buildInitialKindMap, confirmedKindOf, displayKindsFor } from '../candidate-kinds';
import { findKing, isInCheck, isSquareAttackedBy } from './check';
import { collectShieldSquares } from './attack-scan';
import { generateDropMoves } from './drops';
import { fileHasCertainPawn } from './nifu';
import { directionOffsets } from './directions';
import { generateAllBoardMoves } from './generator';

interface LegalOpts {
  skipUchifuTsume?: boolean;
  /**
   * 「玉の安全を確かめなくてよい手」を見分けるための下ごしらえ (§7.3.2)。
   * 省略せず全部確かめるときは渡さない (単発で呼ぶときの既定)。
   */
  safety?: KingSafety | null;
}

/**
 * その局面で、玉の安全に関係しうる手を見分けるための下ごしらえ (2026-08-15・読む速さの改善)。
 *
 * @see buildKingSafety
 */
export interface KingSafety {
  /** 玉のマス。null なら守るべき玉がいない (量子で玉が未確定など)。 */
  king: Square | null;
  /** 玉の前に立ちふさがっている自分の駒のマス (`"row,col"`)。 */
  shields: Set<string>;
}

export function generateLegalMoves(mgf: Mgf, position: Position, opts: LegalOpts = {}): Move[] {
  const pseudo: Move[] = [...generateAllBoardMoves(mgf, position), ...generateDropMoves(mgf, position)];
  const safety = opts.safety !== undefined ? opts.safety : buildKingSafety(mgf, position);
  return pseudo.filter((m) => isMoveLegal(mgf, position, m, { ...opts, safety }));
}

/**
 * 検査用: 省略をいっさい使わずに合法手を出す (作り替える前と同じやり方)。
 * **対局では使わない**。新しいやり方と答えが一致することを突き合わせるためだけに残す。
 */
export function generateLegalMovesNoSkip(mgf: Mgf, position: Position, opts: LegalOpts = {}): Move[] {
  return generateLegalMoves(mgf, position, { ...opts, safety: null });
}

/**
 * 「この手は自玉を危なくしようがない」と言い切れる手を見分けるための下ごしらえ (§7.3.2)。
 *
 * ★なぜ要るか
 * 王手放置・自殺手の判定は、これまで**指せる手 1 つごとに盤を 1 手進めて**玉が狙われて
 * いないかを見ていた。2026-08-14 に王手の判定そのものを速くしたあと、**この「盤を 1 手
 * 進める」処理が一番の重し**になった (1 手あたり 3.7μs のうち約 3μs)。
 *
 * ★理屈
 * 自玉が危なくなる手は次の 3 つしかない。
 *   1. 玉そのものが動く手 (行き先が狙われているかもしれない)
 *   2. すでに王手をかけられているとき (どの手も王手を解けているか要確認)
 *   3. **ふさぎ役**の駒が動く手 (どくと相手の走り駒の筋が玉まで通るかもしれない)
 * それ以外の手は、盤のどこで何をしようと自玉の安全に影響しない。
 *   - **打つ手**は駒が増えるだけなので、王手されていない限り必ず安全
 *   - **取る手**も、取った駒のマスに自分の駒が座るので新しい穴は開かない
 *
 * ★前提が崩れる場合は使わない (null を返す＝全部これまでどおり確かめる)
 *   - **他の駒が盤から消えるルール** (挟んで取る＝親 §3.8)。相手の駒が消えると、その駒が
 *     塞いでいた筋が開いて自玉に当たりうる。いまのはさみ将棋に玉は無いが、自由ルール
 *     (Phase 7) で「挟み取り＋玉」を作られたときに破綻するので、ここで止める
 *   - **玉が 2 枚以上あるルール**。どの駒を玉とみなすかが手のあとで入れ替わりうる
 *   - **すでに王手**のとき
 *
 * ★盤の端がつながる場合 (トーラス) と量子について
 *   - トーラスでも理屈は変わらない。筋は輪になるが、ふさぎ役は玉も相手の駒も飛び越え
 *     られないので、玉と相手の駒に挟まれた区間から出られない (2026-08-15 ユーザー指摘)。
 *     なお本関数は**ふさぎ役の駒は省略の対象にしない**ので、この点に寄りかかっていない
 *   - 量子で**玉が未確定なら王手が成立しない** (§Q13.1) ので、確かめること自体が無い。
 *     玉の確定は候補集合だけで決まり、着手 (applyMove) では候補を動かさないため、
 *     **1 手指したせいで玉が確定して王手になる、ということは起きない**
 */
export function buildKingSafety(mgf: Mgf, position: Position): KingSafety | null {
  // 挟み取りのように、指した駒以外が盤から消えるルールでは省略しない。
  if (mgf.capture_rules?.post_move_topology) return null;

  const mover = position.sideToMove;
  if (countRoyalsOnBoard(mgf, position, mover) > 1) return null;

  const king = findKing(mgf, position, mover);
  if (!king) return { king: null, shields: EMPTY_SHIELDS };

  const opponent: Player = mover === 'player1' ? 'player2' : 'player1';
  if (isSquareAttackedBy(mgf, position, king, opponent)) return null; // すでに王手

  return { king, shields: collectShieldSquares(mgf, position, king, mover) };
}

const EMPTY_SHIELDS: Set<string> = new Set();

/** その手は自玉の安全に影響しようがないか (影響しうるなら false＝これまでどおり確かめる)。 */
function isKingSafetyIrrelevant(safety: KingSafety, move: Move): boolean {
  if (!safety.king) return true; // 守るべき玉がいない
  // ★v1.55: `drop` は駒が増えるだけ。`free`（感想戦の自由な手）は**合法手の生成に
  // 入らない**（感想戦は合法手を作らずに指すため）ので、ここへ来ることも無い。
  if (move.type !== 'move') return true;
  // 【v1.65 §3.7.1】続けて起きる動きの並びを持つ手 (アンパッサン・キャスリング) は、
  // **動かした駒とは別のマスの駒を消したり動かしたりする**。省略の前提「取る手も取った
  // 駒のマスに自分の駒が座るので新しい穴は開かない」が崩れる——アンパッサンは横のマスの
  // 相手ポーンを消すので、そこがふさいでいた筋が自玉に通りうる (アンパッサンのピン)。
  // **土台 (手の形) を増やしたら検算する側も洗う**＝並びを持つ手は必ず盤を進めて確かめる。
  if (move.extra_steps && move.extra_steps.length > 0) return false;
  if (move.from.row === safety.king.row && move.from.col === safety.king.col) return false;
  return !safety.shields.has(`${move.from.row},${move.from.col}`);
}

function countRoyalsOnBoard(mgf: Mgf, position: Position, player: Player): number {
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  if (royalKinds.size === 0) return 0;
  let n = 0;
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (cell && cell.owner === player && royalKinds.has(cell.kind)) n++;
    }
  }
  return n;
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

  // 自玉が王手放置 or 自ら王手される手 (suicide)。
  // **玉の安全に影響しようがない手は、盤を進めずに素通りさせる** (§7.3.2・上の buildKingSafety)。
  const skipKingSafety = opts.safety != null && isKingSafetyIrrelevant(opts.safety, move);
  let after: Position | null = null;
  if (!skipKingSafety) {
    after = applyMove(mgf, position, move);
    if (isInCheck(mgf, after, mover)) return false;
  }

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
      after ??= applyMove(mgf, position, move);
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
  const safety = opts.safety !== undefined ? opts.safety : buildKingSafety(mgf, position);
  const o = { ...opts, safety };
  for (const m of generateAllBoardMoves(mgf, position)) {
    if (isMoveLegal(mgf, position, m, o)) return true;
  }
  for (const m of generateDropMoves(mgf, position)) {
    if (isMoveLegal(mgf, position, m, o)) return true;
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
