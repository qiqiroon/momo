/**
 * 駒得の評価 (Phase 3・親 §7.3.1 第1段階)。
 *
 * 「いまの盤面は手番側にとってどれくらい良いか」を 1 つの数にする。中身は駒の値打ちの
 * 足し算 (自分の駒 − 相手の駒) で、これが第1段階の本体。
 *
 * **既存の駒の強さの表 (core/engine/piece-strength.ts) は使わない**。あちらは持ち駒台の
 * 並べ替え用で「数値の絶対値は他で参照しないこと」と明記されているため、評価用の値打ちは
 * ここに別に持つ。
 *
 * 値は歩を 100 とした将棋の一般的な目安。持ち駒は盤上より少し高く見る (どこへでも打てる
 * ぶん働きが良いため)。
 *
 * ## v1.49 (ユーザー判断 2026-08-18): 量子モードは候補から値打ちを引く
 *
 * v1.48 まではここも `piece.kind` (**対局開始時にそのマスに置かれていた駒種**＝名札) で
 * 値打ちを引いていた。名札は正体ではないので、量子モードでは **盤上の駒も持ち駒も全部**
 * 実態と違う値で数えていた。**名札は正体が判明しても書き換わらない**ので、候補が 1 つに
 * 絞れて「この駒は桂だ」と確定した後も金として数え続けていた (2026-08-18 実測)。
 * 「見えている駒種で数える近似」と書かれていたが、**名札は画面に出ていない** (盤に出るのは
 * 候補の顔) ので、近似としても成り立っていなかった。
 *
 * **候補のうちいちばん強いものを、その駒の値打ちとする** (ユーザー判断)。
 *
 * **ただし王は候補から外す**。対局開始時は 20 枚すべてが 8 駒種すべてを候補に持つ
 * (2026-08-18 実測) ので、王を混ぜて最強を採ると **どの駒も 20000 点**になり、
 * 両者同点のまま駒の損得が一切見えなくなる。王は両者 1 枚ずつで取られることも無く、
 * 足しても引いても打ち消し合うだけなので、**量子モードでは材料に数えない**。
 * 通常将棋モードは従来どおり (王 20000 のまま・両者で打ち消し合う) ＝縮退互換。
 *
 * **強さを求めるための評価方法そのもの (候補の広さをどう見るか等) は別途議論する**
 * ＝引き継ぎ資料の申し送り。本版は「名札をやめる」ところまで。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Player } from '../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { buildInitialKindMap } from '../../core/engine/candidate-kinds';
import { topologyOf, wrapSquare } from '../../core/engine/position/coordinates';
import { buildAttackMap } from './attack-map';

/** 駒の値打ち (歩 = 100)。未知の駒種は UNKNOWN_VALUE。 */
export const PIECE_VALUE: Record<string, number> = {
  fu: 100,
  kyo: 430,
  kei: 450,
  gin: 640,
  kin: 690,
  kaku: 890,
  hi: 1040,
  to: 600,
  narikyo: 600,
  narikei: 600,
  narigin: 600,
  uma: 1150,
  ryu: 1300,
  ou: 20000,
  gyoku: 20000,
};

/** 表に無い駒種 (カスタムルールの独自駒) の暫定値。 */
export const UNKNOWN_VALUE = 400;

/** 持ち駒の割増し (打てるぶん働きが良い)。 */
const HAND_BONUS = 1.1;

/** 詰みの値。深さで差を付けるので実際の上限より十分小さく取る。 */
export const MATE_VALUE = 900000;

export function valueOf(kind: string): number {
  return PIECE_VALUE[kind] ?? UNKNOWN_VALUE;
}

function isKing(kind: string): boolean {
  return kind === 'ou' || kind === 'gyoku';
}

/** 材料に数えない駒 (王) の印。 */
const NOT_COUNTED = -1;

/**
 * 候補 1 個ぶんの値打ちの早見表 (v1.49)。
 *
 * 候補は「対局開始時の駒の身元」の集合なので、**候補 1 個の値打ちは身元と、その駒が
 * 成っているかどうかだけで決まる**＝局面によらない。読みの入口で 1 度作れば、あとは
 * 引くだけで済む。
 *
 * これを作らずに毎回引くと、**評価 1 回につき駒 40 枚ぶんの並べ替えとルール定義の
 * 線形探索**が走る。実測で深さ 2 が 0.58 秒 → 11.7 秒になった (2026-08-18)。
 */
export interface ValueBook {
  /** 成っていないときの値打ち。王は NOT_COUNTED。 */
  plain: Map<PieceId, number>;
  /** 成っているときの値打ち。成った姿を持たない駒種 (金・王) は NOT_COUNTED。 */
  promoted: Map<PieceId, number>;
  /**
   * ★v1.94 案 (強さ比べ中): 量子の駒の値打ちを、候補の**いちばん強いもの**ではなく
   * **候補の平均 (期待値)** で数える。王は今までどおり数えない。量子でない対局には効かない。
   */
  mean: boolean;
  /**
   * ★v1.94 案 B (強さ比べ中): 量子で、**まだ王でありうる自分の駒の数**を点数に入れる。
   * 王の身元 (陣営ごとに 1 つ)。null なら数えない (量子でない・切り替えが切り)。
   */
  royalIds: Record<Player, PieceId> | null;
  /**
   * ★v1.98: 王の安全 (玉の周りの危ないマス・守り駒・逃げ道・相手の持ち駒)。
   * null なら数えない。量子の対局では使わない (王がどの駒か決まっていない＝案 B が受け持つ)。
   */
  kingSafety: KingSafetyWeights | null;
}

/**
 * ★v1.98: 王の安全の点の重み (歩 1 枚 = 100)。**値は強さ比べで決める**＝ここが正本。
 * 自分の玉はこの点だけ減点、相手の玉は同じだけ加点する。
 */
export interface KingSafetyWeights {
  /** 玉の周り 8 マスのうち、相手の駒が利いているマス 1 つあたりの減点。 */
  danger: number;
  /** 玉の周り 8 マスにいる自分の金・銀 1 枚あたりの加点。 */
  defender: number;
  /** 逃げ道 (動ける先で相手の利きが無いマス) が 0 のときの減点。 */
  noEscape: number;
  /** 逃げ道が 1 つだけのときの減点。 */
  oneEscape: number;
  /** 相手の持ち駒 1 枚ごとに「危ないマス」の減点を何割重くするか。 */
  handPerPiece: number;
  /** 上の割増しに数える持ち駒の上限枚数。 */
  handCap: number;
}

export const KING_SAFETY_WEIGHTS: KingSafetyWeights = {
  danger: 20,
  defender: 25,
  noEscape: 120,
  oneEscape: 40,
  handPerPiece: 0.1,
  handCap: 8,
};

/** 守り駒に数える駒種 (金・銀)。表に無いルール (チェス等) では数えない。 */
const GUARD_KINDS = new Set(['kin', 'gin']);

/**
 * ★v1.94 案 B: 王でありうる駒が少ないほど危ない、の減点 (歩 1 枚 = 100)。
 * 1 枚＝王が確定して王手・詰みの的になる。5 枚以上は 0。
 */
export const KING_CANDIDATE_PENALTY = [0, 400, 200, 100, 50];

export function buildValueBook(
  mgf: Mgf,
  position: Position,
  opts: { mean?: boolean; kingSafety?: boolean; kingSafetyStandard?: Partial<KingSafetyWeights> | boolean } = {},
): ValueBook {
  const plain = new Map<PieceId, number>();
  const promoted = new Map<PieceId, number>();
  for (const [pieceId, kind] of buildInitialKindMap(position)) {
    plain.set(pieceId, isKing(kind) ? NOT_COUNTED : valueOf(kind));
    const def = mgf.pieces.find((p) => p.id === kind);
    promoted.set(pieceId, def?.promoted_id ? valueOf(def.promoted_id) : NOT_COUNTED);
  }
  const ks = opts.kingSafetyStandard;
  return {
    plain,
    promoted,
    mean: opts.mean === true,
    royalIds: opts.kingSafety ? royalIdsOf(position) : null,
    kingSafety: ks ? { ...KING_SAFETY_WEIGHTS, ...(ks === true ? {} : ks) } : null,
  };
}

/** 陣営ごとの王の身元。量子でない局面・王が見つからないルールでは null。 */
function royalIdsOf(position: Position): Record<Player, PieceId> | null {
  const found: Partial<Record<Player, PieceId>> = {};
  let quantum = false;
  const visit = (p: PieceInstance) => {
    if (p.candidates !== undefined) quantum = true;
    if (isKing(p.initialKind)) found[p.initialOwner] = p.pieceId;
  };
  for (const row of position.board) for (const cell of row) if (cell) visit(cell);
  for (const p of position.hands.player1) visit(p);
  for (const p of position.hands.player2) visit(p);
  // §Q23.5: 王のマスから出た駒が盤から取り除かれても、王の身元は候補に残っている。
  if (position.removedPieces) for (const p of position.removedPieces) visit(p);
  if (!quantum || !found.player1 || !found.player2) return null;
  return { player1: found.player1, player2: found.player2 };
}

/** その陣営の盤上で、まだ王の身元を候補に持つ駒の数。 */
function kingCandidateCount(position: Position, side: Player, royal: PieceId): number {
  let n = 0;
  for (const row of position.board) {
    for (const cell of row) {
      if (cell && cell.owner === side && cell.candidates?.has(royal)) n++;
    }
  }
  return n;
}

function kingCandidatePenalty(n: number): number {
  return n < KING_CANDIDATE_PENALTY.length ? KING_CANDIDATE_PENALTY[n] : 0;
}

/**
 * その駒の値打ち (v1.49)。
 *
 * - 通常将棋モード (候補を持たない) は `piece.kind` がそのまま正体なので従来どおり。
 * - 量子モードは**候補のうちいちばん強いもの** (ユーザー判断)。王は材料に数えないので
 *   候補から外す (冒頭の注記＝混ぜると開始局面で全駒 20000 になり損得が見えなくなる)。
 *   **王だけが候補＝王と確定した駒**は 0 点。
 *
 * 取れる駒の大きさを見積もる並べ替え (search.ts) からも呼ぶので export する。
 */
export function pieceValue(piece: PieceInstance, book: ValueBook): number {
  if (piece.candidates === undefined) return valueOf(piece.kind);
  const table = piece.promoted ? book.promoted : book.plain;
  if (book.mean) {
    // 王 (NOT_COUNTED) を除いた候補の平均。王だけが候補なら 0 点 (いちばん強いもの と同じ扱い)。
    let sum = 0;
    let n = 0;
    for (const pieceId of piece.candidates) {
      const v = table.get(pieceId);
      if (v === undefined || v < 0) continue;
      sum += v;
      n++;
    }
    return n > 0 ? sum / n : 0;
  }
  let best = 0;
  for (const pieceId of piece.candidates) {
    const v = table.get(pieceId);
    if (v !== undefined && v > best) best = v;
  }
  return best;
}

/**
 * 前進の微加点。駒得だけだと序盤はどの手も同点になり、指し手が意味なく揺れる。
 * **勝ち負けを決める要素ではなく同点崩し**なので、歩 1 枚の 1/10 以下に収める。
 */
function advanceBonus(owner: Player, row: number, height: number): number {
  // player1 は上 (row 小) が敵陣。進んだぶんだけ小さく加点する。
  const advanced = owner === 'player1' ? height - 1 - row : row;
  return advanced * 3;
}

/** 前進の加点を付けない駒か (通常将棋の王・量子で王と確定した駒＝値打ち 0)。 */
function skipsAdvanceBonus(piece: PieceInstance, value: number): boolean {
  if (piece.candidates === undefined) return isKing(piece.kind);
  return value === 0;
}

/**
 * 局面の評価。**手番側から見た点数**を返す (大きいほど手番側が良い)。
 *
 * `book` は候補 1 個ぶんの値打ちの早見表。**局面によらない**ので、探索の入口で 1 度だけ
 * 作って読みの間じゅう使い回す。渡さなければその場で作る＝渡し忘れても答えは変わらず
 * 遅くなるだけ。
 */
export function evaluate(
  mgf: Mgf,
  position: Position,
  book: ValueBook = buildValueBook(mgf, position),
): number {
  let p1 = 0;
  let p2 = 0;
  const height = position.height;

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const piece = position.board[row][col];
      if (!piece) continue;
      let v = pieceValue(piece, book);
      if (!skipsAdvanceBonus(piece, v)) v += advanceBonus(piece.owner, row, height);
      if (piece.owner === 'player1') p1 += v;
      else p2 += v;
    }
  }

  for (const piece of position.hands.player1) {
    p1 += pieceValue(piece, book) * HAND_BONUS;
  }
  for (const piece of position.hands.player2) {
    p2 += pieceValue(piece, book) * HAND_BONUS;
  }

  if (book.royalIds) {
    p1 -= kingCandidatePenalty(kingCandidateCount(position, 'player1', book.royalIds.player1));
    p2 -= kingCandidatePenalty(kingCandidateCount(position, 'player2', book.royalIds.player2));
  }

  if (book.kingSafety) p1 += kingSafetyScore(mgf, position, book.kingSafety);

  const diff = p1 - p2;
  return position.sideToMove === 'player1' ? diff : -diff;
}


/**
 * ★v1.98: 王の安全の点 (先手から見た点＝先手の玉が危ないほど小さい)。
 *
 * 量子の局面 (正体の決まっていない駒がいる) では 0＝王がどの駒か決まっていないため。
 * 王が盤に無い側 (はさみ将棋など) は数えない。
 */
function kingSafetyScore(mgf: Mgf, position: Position, w: KingSafetyWeights): number {
  const royal = royalKindsOf(mgf);
  let k1: { row: number; col: number } | null = null;
  let k2: { row: number; col: number } | null = null;
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell) continue;
      if (cell.candidates !== undefined) return 0;
      if (!royal.has(cell.kind)) continue;
      if (cell.owner === 'player1') k1 ??= { row, col };
      else k2 ??= { row, col };
    }
  }
  if (!k1 && !k2) return 0;
  const map = buildAttackMap(mgf, position);
  let score = 0;
  if (k1) score -= kingDanger(position, map, k1, 'player1', royal, w);
  if (k2) score += kingDanger(position, map, k2, 'player2', royal, w);
  return score;
}

const royalCache = new WeakMap<Mgf, Set<string>>();
function royalKindsOf(mgf: Mgf): Set<string> {
  let s = royalCache.get(mgf);
  if (!s) {
    s = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
    royalCache.set(mgf, s);
  }
  return s;
}

/** その側の玉の危なさ (減点の大きさ)。 */
function kingDanger(
  position: Position,
  map: ReturnType<typeof buildAttackMap>,
  king: { row: number; col: number },
  side: Player,
  royal: Set<string>,
  w: KingSafetyWeights,
): number {
  const opp: Player = side === 'player1' ? 'player2' : 'player1';
  const enemy = map[opp];
  const topology = topologyOf(position);
  const seen = new Set<number>();
  let danger = 0;
  let defenders = 0;
  let escapes = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const sq = wrapSquare({ row: king.row + dr, col: king.col + dc }, position.width, position.height, topology);
      if (!sq) continue;
      const idx = sq.row * position.width + sq.col;
      if (seen.has(idx) || (sq.row === king.row && sq.col === king.col)) continue;
      seen.add(idx);
      const attacked = enemy[idx] > 0;
      if (attacked) danger++;
      const cell = position.board[sq.row][sq.col];
      if (cell && cell.owner === side) {
        if (GUARD_KINDS.has(cell.kind)) defenders++;
      } else if (!attacked && !(cell && royal.has(cell.kind))) {
        escapes++;
      }
    }
  }
  const handMul = 1 + w.handPerPiece * Math.min(position.hands[opp].length, w.handCap);
  let penalty = danger * w.danger * handMul - defenders * w.defender;
  if (escapes === 0) penalty += w.noEscape;
  else if (escapes === 1) penalty += w.oneEscape;
  return penalty;
}
