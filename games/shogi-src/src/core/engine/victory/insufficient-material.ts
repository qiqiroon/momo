/**
 * 駒不足（親 v1.65 §3.10・チェス §5.5.5・第 9 段 9-4d）。
 *
 * **どちらも詰ませることが不可能な駒の顔ぶれになったら、その瞬間に引き分け**。
 *
 * ★**顔ぶれはルール定義が名指しで書く**（ユーザー判断 2026-08-26）。本家チェスも盤を
 * 読んで「詰ませられるか」を確かめているのではなく、**当てはまる顔ぶれが 4 通りしかない**
 * ことを知っていて突き合わせているだけである（王 対 王／王＋ビショップ 対 王／
 * 王＋ナイト 対 王／同じ色のマスのビショップ 1 枚ずつ）。
 *
 * **ここで数えているのは「詰ませ切れるか」ではなく「詰みが一度でも現れうるか」**である。
 * 王＋ナイト 2 枚 対 王は、無理やり詰ませることはできないが**相手が最悪の逃げ方をすれば
 * 詰みは現れる**ので、本家でも引き分けにならない。一覧に書かなければそうなる。
 */

import type { Mgf, MgfMaterialCombination, Player } from '../mgf/types';
import type { PieceInstance, Position } from '../position/types';
import { buildInitialKindMap, confirmedKindOf } from '../candidate-kinds';

/** 残っている駒 1 枚。`squareColor` は盤のマスの色（持ち駒は色を持たない）。 */
interface Remaining {
  kind: string;
  squareColor: number | null;
}

/**
 * いまの局面が「駒不足」か。**欄を持たないルールでは常に false**（省略時は判定しない）。
 *
 * **量子では、正体が未確定な駒が 1 枚でも残っていれば成立させない**。駒不足は成立した
 * 瞬間に対局を終わらせるので、**終わらせる側には確かさが要る**——「クイーンかもしれない
 * 駒」が残っているなら詰みは現れうる。判定できないほうへ倒すと対局が続くだけで済む。
 */
export function isInsufficientMaterial(mgf: Mgf, position: Position): boolean {
  const decl = mgf.victory?.insufficient_material;
  if (!decl?.enabled) return false;
  // 起こし方は自動だけ（§3.10.0）。**主張の道はまだ無いので、`claim` と書かれていたら
  // 黙って自動で終わらせずに成立させない**＝書いてあるとおりに動けないなら何もしない。
  if ((decl.trigger ?? 'auto') !== 'auto') return false;
  const combinations = decl.combinations ?? [];
  if (combinations.length === 0) return false;

  const remaining = collectRemaining(mgf, position);
  if (!remaining) return false; // 正体が未確定な駒が残っている

  for (const row of combinations) {
    if (matches(remaining.player1, remaining.player2, row)) return true;
    // **左右は入れ替えても成立する**＝一覧は 1 通り書けば足りる。
    if (matches(remaining.player2, remaining.player1, row)) return true;
  }
  return false;
}

/**
 * 王を除いて、双方に残っている駒を集める（盤の上と持ち駒の両方）。
 * **正体が未確定な駒が 1 枚でもあれば null**。
 */
function collectRemaining(
  mgf: Mgf,
  position: Position,
): Record<Player, Remaining[]> | null {
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  const kindMap = buildInitialKindMap(position);
  const out: Record<Player, Remaining[]> = { player1: [], player2: [] };

  const add = (piece: PieceInstance, squareColor: number | null): boolean => {
    const kind = confirmedKindOf(mgf, piece, kindMap);
    if (kind === undefined) return false;
    if (royalKinds.has(kind)) return true; // 王は数えない
    out[piece.owner].push({ kind, squareColor });
    return true;
  };

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell) continue;
      if (!add(cell, (row + col) % 2)) return null;
    }
  }
  for (const player of ['player1', 'player2'] as Player[]) {
    for (const piece of position.hands[player]) {
      if (!add(piece, null)) return null;
    }
  }
  return out;
}

/** 顔ぶれ 1 通りと突き合わせる（並び順は見ない＝同じ駒が同じ枚数あるか）。 */
function matches(
  left: Remaining[],
  right: Remaining[],
  row: MgfMaterialCombination,
): boolean {
  if (!sameKinds(left, row.sides[0])) return false;
  if (!sameKinds(right, row.sides[1])) return false;
  if (!row.same_square_color) return true;
  // **挙げた駒がすべて同じ色のマスに乗っているときだけ**成立する。
  // 持ち駒は乗っているマスが無いので、色を要求する行には当てはまらない。
  const colors = [...left, ...right].map((r) => r.squareColor);
  if (colors.some((c) => c === null)) return false;
  return colors.every((c) => c === colors[0]);
}

function sameKinds(remaining: Remaining[], expected: string[]): boolean {
  if (remaining.length !== expected.length) return false;
  const left = remaining.map((r) => r.kind).sort();
  const right = [...expected].sort();
  return left.every((kind, i) => kind === right[i]);
}
