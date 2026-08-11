/**
 * C-303 割り当て整合制約 (v1.16・§Q8.7)。
 *
 * ## 何をする制約か
 *
 * 「駒 ↔ 身元 (初期 PieceID)」は **元の所属ごとに 1 対 1 対応**する (将棋は駒が盤外へ
 * 消えないので、元先手の 20 枚は元先手の 20 個の身元を、元後手の 20 枚は元後手の 20 個を、
 * それぞれ過不足なく分け合う)。よって候補は「全体を矛盾なく 1 対 1 に結び付けられるか」
 * という条件を満たさなければならない。
 *
 * 本制約は各候補について「これを採用したとき、残り全部を矛盾なく結び付けられるか」を判定し、
 * **どう並べ替えても結び付けられない候補だけ**を除外する。
 *
 * ### なぜ必要か (v1.15 のユーザー報告)
 *
 * 長距離をまっすぐ進める駒は片側に飛車 1 + 香車 2 の **3 枚**しかない。3 枚が長距離直進を
 * 見せた時点で 4 枚目は飛車・香車ではありえないが、既存の制約では捕まえられなかった:
 *
 * - C-106 (その身元を担える駒が 1 枚なら確定) … 3 枚のどれが飛車かは決まらないので不発
 * - C-302 (ある駒種を担える駒数 == 初期枚数なら、その駒種に絞る) … 駒種ごとに数えるため
 *   「飛車と香車をまたいで合計 3 枚」が数えられず不発
 *
 * 本制約は駒種をまたいだ数の勘定を含むので、この穴が塞がる (数独の「裸の組」に相当する
 * 絞り込みを、組の大きさに上限を設けずに行う)。C-106 / C-107 / C-302 は本制約の特別な
 * 場合にあたるが、軽くて先に効くので併用する (§Q8.7 注記)。
 *
 * ## 決めつけないこと (v1.16 ユーザー確認事項)
 *
 * 「結び付け方を 1 通り見つけて、それを正解として扱う」ことは**しない**。それをやると
 * 初期配置で「たまたま最初に見つかった 3 枚」が飛車・香車に固定されてしまう。本制約が
 * 消すのは**不可能だと証明できた候補だけ**なので、初期配置 (全駒が全候補を持つ) では
 * どの候補も消えない。
 *
 * ## 前提 (仕様に明記・§Q8.7)
 *
 * 「駒は盤から消えない (取られても持ち駒として残る)」= 元の所属ごとに駒枚数と身元の個数が
 * 等しい、という将棋の性質に乗っている。駒が消える自由ルールを作る場合は本制約を外す。
 *
 * ## アルゴリズム
 *
 * 二部グラフ (駒 × 身元) の最大マッチングを求め、**どの最大マッチングにも現れない辺**を
 * 落とす (制約プログラミングの alldifferent に対する Régin の filtering)。
 *   1. 最大マッチングを求める (Kuhn の増加道法)。駒側が飽和しなければ矛盾 = 異常状態
 *   2. マッチング辺を身元→駒、非マッチング辺を駒→身元に向き付けた有向グラフを作る
 *   3. マッチング辺・同一強連結成分内の辺・未使用の身元から到達できる辺 = 使える辺
 *   4. それ以外の辺 (候補) を除外する
 *
 * 40 駒を一度に扱わず**元の所属ごとに 2 つに分けて**解く (数え方が仕様どおりであることを
 * 実装でも明示するため・計算量も半分になる)。
 *
 * ## 決定性 (ネット対戦での一致)
 *
 * 両者の端末が同じ結論に達しないと局面照合で止まるため、身元の並び順を文字列順に固定して
 * 走査順に依存しないようにしている。
 */

import type { Player } from '../../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../../core/engine/position/types';
import type { QuantumConstraint } from '../candidate-update';

/** 駒 pieceId → その駒に残せる候補 PieceID 集合。 */
type AllowedMap = Map<PieceId, Set<PieceId>>;

/**
 * 1 回の反復の中で全駒 (最大 40 回) から同じ Position で呼ばれるので、Position 単位で
 * 計算結果を使い回す。反復ごとに Position は作り直されるため WeakMap で自然に破棄される。
 */
const allowedCache = new WeakMap<Position, AllowedMap>();

export const c303AssignmentConsistency: QuantumConstraint = (piece, _location, pos, _mgf, _context) => {
  if (piece.candidates === undefined) return new Set();
  const allowed = getAllowedMap(pos).get(piece.pieceId);
  // 対象外 (量子駒でない等) の場合は狭めない。
  return allowed ?? new Set(piece.candidates);
};

function getAllowedMap(pos: Position): AllowedMap {
  const cached = allowedCache.get(pos);
  if (cached) return cached;
  const map: AllowedMap = new Map();
  for (const side of ['player1', 'player2'] as Player[]) {
    const pieces = collectSide(pos, side);
    if (pieces.length > 0) filterSide(pieces, map);
  }
  allowedCache.set(pos, map);
  return map;
}

/**
 * 元の所属が side の量子駒を集める。**現在の持ち主は見ない** (取られて相手の持ち駒に
 * なっていても元の所属で数える・§Q8.3 C-001)。
 */
function collectSide(pos: Position, side: Player): PieceInstance[] {
  const out: PieceInstance[] = [];
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.candidates && cell.initialOwner === side) out.push(cell);
    }
  }
  for (const p of pos.hands.player1) {
    if (p.candidates && p.initialOwner === side) out.push(p);
  }
  for (const p of pos.hands.player2) {
    if (p.candidates && p.initialOwner === side) out.push(p);
  }
  return out;
}

/** 片側 (元先手 or 元後手) だけを解いて out に書き込む。 */
function filterSide(pieces: PieceInstance[], out: AllowedMap): void {
  const n = pieces.length;

  // 身元の一覧。並び順を文字列順に固定して走査順への依存を断つ (決定性)。
  const idSet = new Set<PieceId>();
  for (const p of pieces) for (const c of p.candidates!) idSet.add(c);
  const idList = Array.from(idSet).sort();
  const m = idList.length;
  const idIndex = new Map<PieceId, number>();
  idList.forEach((id, i) => idIndex.set(id, i));

  const adj: number[][] = pieces.map((p) => {
    const list: number[] = [];
    for (const c of p.candidates!) list.push(idIndex.get(c)!);
    list.sort((a, b) => a - b);
    return list;
  });

  // --- 1. 最大マッチング (Kuhn) ---
  const matchOfId = new Array<number>(m).fill(-1);
  const matchOfPiece = new Array<number>(n).fill(-1);
  for (let u = 0; u < n; u++) {
    const seen = new Array<boolean>(m).fill(false);
    augment(u, adj, seen, matchOfId, matchOfPiece);
  }

  // 駒側が飽和しない = どう並べ替えても全部に身元を割り当てられない = 矛盾。
  // 空集合を返して既存の異常状態検出 (C-901) に載せる。
  const unmatched: number[] = [];
  for (let u = 0; u < n; u++) if (matchOfPiece[u] === -1) unmatched.push(u);
  if (unmatched.length > 0) {
    for (const u of unmatched) out.set(pieces[u].pieceId, new Set());
    return;
  }

  // --- 2. 有向グラフ (0..n-1 = 駒 / n..n+m-1 = 身元) ---
  const nodeCount = n + m;
  const dir: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let u = 0; u < n; u++) {
    for (const i of adj[u]) {
      if (matchOfPiece[u] === i) dir[n + i].push(u); // マッチング辺: 身元 → 駒
      else dir[u].push(n + i); // 非マッチング辺: 駒 → 身元
    }
  }

  // --- 3. 使える辺を印付け ---
  const comp = tarjanScc(dir, nodeCount);
  // 未使用の身元から到達できる節点 (そこから出る辺はすべて使える)
  const reachable = new Array<boolean>(nodeCount).fill(false);
  const stack: number[] = [];
  for (let i = 0; i < m; i++) {
    if (matchOfId[i] === -1 && !reachable[n + i]) {
      reachable[n + i] = true;
      stack.push(n + i);
    }
  }
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (const w of dir[v]) {
      if (!reachable[w]) {
        reachable[w] = true;
        stack.push(w);
      }
    }
  }

  for (let u = 0; u < n; u++) {
    const keep = new Set<PieceId>();
    keep.add(idList[matchOfPiece[u]]); // マッチング辺は必ず使える
    for (const i of adj[u]) {
      if (comp[u] === comp[n + i] || reachable[u]) keep.add(idList[i]);
    }
    out.set(pieces[u].pieceId, keep);
  }
}

/** Kuhn の増加道法 1 回分。駒 u に身元を割り当てられたら true。 */
function augment(
  u: number,
  adj: number[][],
  seen: boolean[],
  matchOfId: number[],
  matchOfPiece: number[],
): boolean {
  for (const i of adj[u]) {
    if (seen[i]) continue;
    seen[i] = true;
    if (matchOfId[i] === -1 || augment(matchOfId[i], adj, seen, matchOfId, matchOfPiece)) {
      matchOfId[i] = u;
      matchOfPiece[u] = i;
      return true;
    }
  }
  return false;
}

/**
 * 強連結成分分解 (Tarjan・反復版)。節点数は最大 40 程度だが、再帰の深さを気にせずに
 * 済むよう明示スタックで書く。返り値は節点 → 成分番号。
 */
function tarjanScc(dir: number[][], nodeCount: number): number[] {
  const index = new Array<number>(nodeCount).fill(-1);
  const low = new Array<number>(nodeCount).fill(0);
  const onStack = new Array<boolean>(nodeCount).fill(false);
  const comp = new Array<number>(nodeCount).fill(-1);
  const sccStack: number[] = [];
  let counter = 0;
  let compCount = 0;

  for (let start = 0; start < nodeCount; start++) {
    if (index[start] !== -1) continue;
    // frame = [節点, 次に見る隣接の位置]
    const frames: Array<[number, number]> = [[start, 0]];
    index[start] = low[start] = counter++;
    sccStack.push(start);
    onStack[start] = true;

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const v = frame[0];
      if (frame[1] < dir[v].length) {
        const w = dir[v][frame[1]];
        frame[1] += 1;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          sccStack.push(w);
          onStack[w] = true;
          frames.push([w, 0]);
        } else if (onStack[w]) {
          if (index[w] < low[v]) low[v] = index[w];
        }
      } else {
        frames.pop();
        if (frames.length > 0) {
          const parent = frames[frames.length - 1][0];
          if (low[v] < low[parent]) low[parent] = low[v];
        }
        if (low[v] === index[v]) {
          for (;;) {
            const w = sccStack.pop()!;
            onStack[w] = false;
            comp[w] = compCount;
            if (w === v) break;
          }
          compCount += 1;
        }
      }
    }
  }
  return comp;
}
