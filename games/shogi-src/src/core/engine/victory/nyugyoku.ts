import type { Mgf, MgfSideThreshold, Player } from '../mgf/types';
import type { PieceInstance, Position, Square } from '../position/types';
import { isSquareAttackedBy } from '../moves/check';
import { buildInitialKindMap, displayKindsFor } from '../candidate-kinds';

const MAJOR_KINDS = new Set(['kaku', 'hi', 'uma', 'ryu']);
const REQUIRED_PIECE_COUNT = 10;

/**
 * 入玉宣言の判定 (親 §4.4 / §3.10 `victory.entering_king`)。
 *
 * ## v1.48 (ユーザー判断 2026-08-18・量子分冊 §Q21) で数え方を全面的に改めた
 *
 * v1.47 までは駒の**名札** (`piece.kind` = 対局開始時にその位置に置かれていた駒種) で
 * 数えていた。量子モードでは名札は正体ではないので、
 *   - 飛車のマスから来た駒は、正体が歩でも 5 点として数えられていた (実測で確認)
 *   - 玉のマスから来た駒 (正体は別) が玉として点数・枚数から除かれ、
 *     正体が玉の駒は普通の駒として数えられていた
 * という取り違えが起きていた。**分冊 §Q16.1 が「入玉による終局条件」を未確定と
 * したまま、実装だけが決まっていない数え方を先に持っていた**のが原因。
 *
 * §Q21 の規定 (通常将棋モードにも適用でき、結果は従来と一致する = §Q21.6 縮退互換):
 *   - **入玉できているか** … 王候補を保持する駒が**すべて**敵陣にあり、その**すべて**が
 *     相手の駒の利きの中にないこと (§Q21.2)
 *   - **点数** … 候補の姿が**すべて大駒 (飛角龍馬) である駒だけ 5 点**・それ以外は 1 点。
 *     合計から**王の分として 1 を引く** (王候補が何枚あっても 1 回だけ・§Q21.3)
 *   - **敵陣内の枚数** … **王を含めて数えてから 1 を引く** (同じく 1 回だけ・§Q21.4)
 *
 * 未確定の駒を大駒として数えない = **宣言する側に有利にならない向き**に倒してある。
 * 王候補を保持する駒は候補に王を含む以上「すべて大駒」にはなり得ないので必ず 1 点。
 * よって 1 を引けば王 1 枚分が過不足なく除かれる。
 *
 * **§Q13 の王手・詰み判定は変更していない**。ここでの「利きの中にない」は自分から
 * 宣言するときの前提条件にすぎず、相手の着手を縛らないので、王手を「王として確定した
 * 駒」に限る §Q13.2 の根拠とは矛盾しない。
 */

/** その駒の取りうる姿 (通常将棋モードは名札 1 個・量子モードは候補を resolve した結果)。 */
function kindsOf(mgf: Mgf, piece: PieceInstance, kindMap: Map<string, string>): string[] {
  return displayKindsFor(mgf, piece, kindMap);
}

/** 王候補を 1 つでも保持しているか (通常将棋モードでは玉そのものだけが該当)。 */
function holdsRoyalCandidate(kinds: string[], royalKinds: Set<string>): boolean {
  return kinds.some((k) => royalKinds.has(k));
}

/** 候補の姿がすべて大駒か (§Q21.3 の 5 点条件)。1 つでも大駒でなければ 1 点。 */
function isCertainMajor(kinds: string[]): boolean {
  return kinds.length > 0 && kinds.every((k) => MAJOR_KINDS.has(k));
}

function royalKindsOf(mgf: Mgf): Set<string> {
  return new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
}

function inZone(mgf: Mgf, player: Player, row: number): boolean {
  const zone = mgf.board.promotion_zone?.[player];
  if (!zone) return false;
  const rank = row + 1;
  return rank >= zone.min_rank && rank <= zone.max_rank;
}

/** 盤上の自駒を (マス, 駒, 取りうる姿) で列挙する。 */
function* ownPiecesOnBoard(
  mgf: Mgf,
  position: Position,
  player: Player,
  kindMap: Map<string, string>,
): Generator<{ square: Square; piece: PieceInstance; kinds: string[] }> {
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== player) continue;
      yield { square: { row, col }, piece: cell, kinds: kindsOf(mgf, cell, kindMap) };
    }
  }
}

/**
 * §Q21.2 入玉できているか。
 * 王候補を保持する駒がすべて敵陣にあり、そのすべてが相手の利きの中にないこと。
 *
 * 敵陣の中に居るかを先に全部見てから利きを調べる (利きの計算は重く、序盤は王候補が
 * 多数あるため。敵陣に居ない駒が 1 枚でもあれば、その時点で不成立)。
 */
export function isEnteringKingEstablished(mgf: Mgf, position: Position, player: Player): boolean {
  const royalKinds = royalKindsOf(mgf);
  if (royalKinds.size === 0) return false;
  const kindMap = buildInitialKindMap(position);

  const royalHolders: Square[] = [];
  for (const { square, kinds } of ownPiecesOnBoard(mgf, position, player, kindMap)) {
    if (!holdsRoyalCandidate(kinds, royalKinds)) continue;
    if (!inZone(mgf, player, square.row)) return false;
    royalHolders.push(square);
  }
  if (royalHolders.length === 0) return false;

  const opponent: Player = player === 'player1' ? 'player2' : 'player1';
  for (const square of royalHolders) {
    if (isSquareAttackedBy(mgf, position, square, opponent)) return false;
  }
  return true;
}

/**
 * §Q21.3 敵陣内の自駒 + 持ち駒の合計点数。
 * 候補の姿がすべて大駒の駒 = 5 点 / それ以外 = 1 点。合計から王の分として 1 を引く。
 */
export function computeEnterZonePoints(mgf: Mgf, position: Position, player: Player): number {
  if (!mgf.board.promotion_zone?.[player]) return 0;
  const kindMap = buildInitialKindMap(position);

  const royalKinds = royalKindsOf(mgf);
  let points = 0;
  let countedRoyal = false;
  for (const { square, kinds } of ownPiecesOnBoard(mgf, position, player, kindMap)) {
    if (!inZone(mgf, player, square.row)) continue;
    if (holdsRoyalCandidate(kinds, royalKinds)) countedRoyal = true;
    points += isCertainMajor(kinds) ? 5 : 1;
  }
  for (const hand of position.hands[player]) {
    points += isCertainMajor(kindsOf(mgf, hand, kindMap)) ? 5 : 1;
  }
  // 王の分を引く。**数えた中に王候補を保持する駒が含まれるときだけ**引く (複数含まれて
  // いても 1 回だけ)。入玉が成立していれば王候補は必ず敵陣に居るので必ず引かれ、
  // 成立していない局面 (点数を単独で見るとき) に居もしない王の分を引かずに済む。
  // 王候補を保持する駒は候補に王を含む以上「すべて大駒」にはなり得ないので必ず 1 点。
  return countedRoyal ? points - 1 : points;
}

/**
 * §Q21.4 敵陣内の自駒枚数。王を含めて数えてから 1 を引く (複数あっても 1 回だけ)。
 * 持ち駒は数えない。
 */
export function countEnterZonePieces(mgf: Mgf, position: Position, player: Player): number {
  if (!mgf.board.promotion_zone?.[player]) return 0;
  const kindMap = buildInitialKindMap(position);

  const royalKinds = royalKindsOf(mgf);
  let count = 0;
  let countedRoyal = false;
  for (const { square, kinds } of ownPiecesOnBoard(mgf, position, player, kindMap)) {
    if (!inZone(mgf, player, square.row)) continue;
    if (holdsRoyalCandidate(kinds, royalKinds)) countedRoyal = true;
    count++;
  }
  // 点数と同じく、数えた中に王候補が含まれるときだけ 1 を引く (複数でも 1 回)。
  return countedRoyal ? count - 1 : count;
}

/**
 * 入玉宣言が可能か (親 §4.4・点数は victory.entering_king の point_threshold):
 * 1. §Q21.2 入玉できている (王候補を保持する駒がすべて敵陣・すべて利きの外)
 * 2. 敵陣内自駒枚数 (§Q21.4) が 10 枚以上
 * 3. 敵陣内自駒 + 持ち駒 の点数 (§Q21.3) が threshold 以上
 */
export function canDeclareNyugyoku(mgf: Mgf, position: Position, player: Player): boolean {
  const ek = mgf.victory?.entering_king;
  if (!ek?.enabled) return false;
  const threshold = resolveSideThreshold(ek.point_threshold, player, 24);

  if (!isEnteringKingEstablished(mgf, position, player)) return false;
  if (countEnterZonePieces(mgf, position, player) < REQUIRED_PIECE_COUNT) return false;

  return computeEnterZonePoints(mgf, position, player) >= threshold;
}

/**
 * 先手・後手で違うしきい値を読む (親 v1.62 §3.10)。
 * 27 点法は**先手 28 点・後手 27 点**。**数を 1 つだけ書いた形は両者同じ値**。
 */
export function resolveSideThreshold(
  value: MgfSideThreshold | undefined,
  player: Player,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return value;
  return value[player] ?? fallback;
}

/**
 * 持将棋の点数 (親 v1.62 §4.4.1.2・量子分冊 v0.8 §Q21.5)。
 *
 * **入玉宣言と違い、盤の上のどこにあっても自分の駒すべて＋自分の持ち駒**を数える。
 * **1 枚あたりの数え方は §Q21.3 と同じ**＝候補の姿がすべて大駒なら 5 点・それ以外は
 * 1 点・合計から王の分として 1 を引く (王候補を保持する駒が複数あっても 1 回だけ)。
 *
 * **範囲が違うのは、測っている対象が違うため**＝入玉宣言は「相手陣まで戦力を運び込め
 * たか」を問うので運び込んだ駒だけを数え、持将棋は「双方どれだけの戦力を残している
 * か」を問うので全部を数える。**初期局面では双方 27 点**になる (玉を除く 19 枚＝
 * 飛角 5 点 × 2 ＋ 小駒 17)。
 */
export function computeJishogiPoints(mgf: Mgf, position: Position, player: Player): number {
  const kindMap = buildInitialKindMap(position);
  const royalKinds = royalKindsOf(mgf);
  let points = 0;
  let countedRoyal = false;
  for (const { kinds } of ownPiecesOnBoard(mgf, position, player, kindMap)) {
    if (holdsRoyalCandidate(kinds, royalKinds)) countedRoyal = true;
    points += isCertainMajor(kinds) ? 5 : 1;
  }
  for (const hand of position.hands[player]) {
    points += isCertainMajor(kindsOf(mgf, hand, kindMap)) ? 5 : 1;
  }
  return countedRoyal ? points - 1 : points;
}

/**
 * 持将棋の提案を出せるか (親 v1.62 §4.4.1.1)。
 *
 * **双方が入玉していて、かつ双方が持将棋の点数以上**であること。**片方だけでは出せない**
 * ＝持将棋は双方の合意で成り立つものなので、条件も双方について問う。
 *
 * **点数だけを条件にしてはならない**＝持将棋の点数は盤の駒を全部数えるので**開始時点で
 * 双方 27 点あり**、駒を取り合うほど減る。点数だけで判定すると 1 手目から出て、終盤に
 * 向かって条件から外れるという逆向きの動きになる。**入玉の成立が前提**である。
 */
export function canProposeJishogi(mgf: Mgf, position: Position): boolean {
  const js = mgf.victory?.jishogi;
  if (!js?.enabled) return false;
  const threshold = js.point_threshold ?? 24;
  const sides: Player[] = ['player1', 'player2'];
  return sides.every(
    (side) =>
      isEnteringKingEstablished(mgf, position, side) &&
      computeJishogiPoints(mgf, position, side) >= threshold,
  );
}
