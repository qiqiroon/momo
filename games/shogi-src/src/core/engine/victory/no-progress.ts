/**
 * 無進展手数（親 v1.65 §3.10 `move_limit`・チェスの 50 手ルール・第 9 段 9-4d）。
 *
 * **駒を取る手も、決められた駒が動く手も無いまま手数が過ぎたら引き分け**。
 *
 * ★**数えは持たずに、手を遡って数える**。規定（§4.2.1）は「数えを 1 つ持ち歩き、
 * 組み立て直したときは遡って数え直す」と書いているが、**この作りでは指す前の局面が
 * すべて残っている**ので、遡るほうが正しく、置き場所も増えない。
 *
 * **遡るときに要るのは「その手を指した時点の駒の正体」**である。昇格した駒は名札が
 * 変わるので、**いまの盤だけを見て遡ると「クイーンが動いた手」を「ポーンが動いた手」と
 * 読み違える**。指す前の局面を見れば、その時点の姿がそこにある。
 *
 * **数えを持ち歩くと、置き場所が 5 か所に増える**（初期化・着手・待った・巻き戻し・
 * 感想戦の自由な手）＝どれか 1 つを書き忘れたところで黙って狂う。遡る形なら
 * **正本は手の並び 1 本**のままで、待ったも感想戦も勝手に正しくなる。
 *
 * ★**数え直しを起こす駒はルール定義が名指しする**（チェスならポーン）。
 */

import type { Mgf } from '../mgf/types';
import type { Move, Position } from '../position/types';
import { buildInitialKindMap, confirmedKindOf } from '../candidate-kinds';

/**
 * その手は「進展」か（＝数えを 0 に戻すか）。
 *
 * - **駒を取る手**はどのルールでも進展（名指しは要らない）。
 * - **ルール定義が名指しした駒が動く手**も進展。並びの中で動いた駒も見る
 *   （アンパッサンはポーンが動く手であり、同時に取る手でもある）。
 *
 * `position` は**その手を指す前**の局面。
 */
export function isProgressMove(mgf: Mgf, position: Position, move: Move): boolean {
  if (capturesSomething(position, move)) return true;
  const resetOn = mgf.victory?.move_limit?.reset_on ?? [];
  if (resetOn.length === 0) return false;
  const kindMap = buildInitialKindMap(position);
  for (const pieceId of movedPieceIds(move)) {
    const piece = findPiece(position, pieceId);
    if (!piece) continue;
    const kind = confirmedKindOf(mgf, piece, kindMap);
    // **正体が未確定な駒は、名指しされた駒かどうか言えない**。ここで進展として
    // 数えておけば引き分けが遠のくだけ（数え足りない側＝黙って終わらせない側）。
    if (kind === undefined || resetOn.includes(kind)) return true;
  }
  return false;
}

/** その手で盤から駒が消えるか（取る手・並びの中で取り除く手）。 */
function capturesSomething(position: Position, move: Move): boolean {
  if (move.type === 'move') {
    if (position.board[move.to.row][move.to.col] !== null) return true;
    for (const step of move.extra_steps ?? []) {
      if (step.dest.kind === 'discard') return true;
      if (step.dest.kind === 'hand') return true;
      if (step.dest.kind === 'square') {
        const { row, col } = step.dest.square;
        if (position.board[row][col] !== null) return true;
      }
    }
  }
  return false;
}

/** その手で動く駒の番号（本体＋並び）。 */
function movedPieceIds(move: Move): string[] {
  const ids = [move.pieceId];
  if (move.type === 'move') {
    for (const step of move.extra_steps ?? []) ids.push(step.pieceId);
  }
  return ids;
}

function findPiece(position: Position, pieceId: string) {
  for (const row of position.board) {
    for (const cell of row) {
      if (cell && cell.pieceId === pieceId) return cell;
    }
  }
  return (
    position.hands.player1.find((p) => p.pieceId === pieceId) ??
    position.hands.player2.find((p) => p.pieceId === pieceId)
  );
}

/**
 * その数え（片側 1 手ずつの数）が、書かれた手数に届いているか。
 *
 * **手数は「両者が指して 1 手」**なので 2 倍して比べる（チェスの 50 手ルール＝
 * 双方が 50 手ずつ指す間＝内部の数えでは 100）。
 */
export function reachedMoveLimit(limit: number | undefined, plies: number): boolean {
  if (limit === undefined) return false;
  return plies >= limit * 2;
}

/**
 * いま何手、進展が無いまま続いているか（片側 1 手ずつの数）。
 *
 * `past` は**これまでの局面すべて**（各手を指す前の局面）、`current` はいまの局面。
 * **欄を持たないルールでは呼ばない**（呼んでも 0 を返す）。
 *
 * **遡れる範囲が足りないときは少なく数える**＝引き分けが遅れるだけで、黙って
 * 終わらせることはない。
 */
export function countNoProgressPlies(mgf: Mgf, past: Position[], current: Position): number {
  if (!mgf.victory?.move_limit) return 0;
  const positions = [...past, current];
  let plies = 0;
  for (let i = positions.length - 1; i >= 1; i--) {
    const moves = positions[i].history;
    const move = moves[moves.length - 1];
    if (!move) break;
    if (isProgressMove(mgf, positions[i - 1], move)) break;
    plies++;
  }
  return plies;
}

/** 主張できる手数に届いているか（`claim_at` を書いていないルールでは常に false）。 */
export function canClaimMoveLimit(mgf: Mgf, plies: number): boolean {
  const ml = mgf.victory?.move_limit;
  if (!ml) return false;
  if ((ml.trigger ?? 'claim') !== 'claim') return false;
  return reachedMoveLimit(ml.claim_at, plies);
}

/** 主張が無くても自動で成立する手数に届いているか。 */
export function reachedMoveLimitAuto(mgf: Mgf, plies: number): boolean {
  const ml = mgf.victory?.move_limit;
  if (!ml) return false;
  return reachedMoveLimit(ml.auto_at, plies);
}
