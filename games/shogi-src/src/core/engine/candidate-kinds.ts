import type { Mgf } from './mgf/types';
import type { PieceId, PieceInstance, Position } from './position/types';
import { strengthOf } from './piece-strength';

/**
 * 候補 PieceID 集合 → 「その駒が今なり得る駒種」の解決 (Phase 5-11 で共通化)。
 *
 * 量子モードの候補集合は §Q4.1 に従い「初期 PieceID の集合」なので、
 * 動き (generatePieceMoves) にも見た目 (GameScreen の巡回/重ね表示) にも、
 * 一度 initialKind へ resolve してから使う必要がある。
 * 両者が別実装だと「動けるのに違う駒の顔が出ている」といったズレが起きるので、
 * ここに 1 本化して generator と UI の双方から呼ぶ。
 *
 * 成っている駒 (`piece.promoted`) は成り駒側の駒種に差し替える。
 * 「成った駒として動き、成った駒の顔で表示する」ため。
 * 成れない駒種 (kin / ou) が候補に残っている場合は静かに落とす
 * (C-109 で除去されるはずだが、除去前の一瞬に描画される可能性がある)。
 */

/**
 * position 全体 (盤上・両手駒) を 1 度だけ走査して pieceId → initialKind の対応表を作る。
 *
 * 候補 1 個ごとに盤面を線形探索すると駒 1 枚あたり O(候補数 × 40) になるので、
 * 呼び出し側で 1 回作って使い回す。
 */
export function buildInitialKindMap(position: Position): Map<PieceId, string> {
  const map = new Map<PieceId, string>();
  for (const row of position.board) {
    for (const cell of row) {
      if (cell) map.set(cell.pieceId, cell.initialKind);
    }
  }
  for (const p of position.hands.player1) map.set(p.pieceId, p.initialKind);
  for (const p of position.hands.player2) map.set(p.pieceId, p.initialKind);
  return map;
}

/**
 * 候補 PieceID を駒種ごとに束ねる。
 *
 * 「金でありうる候補はこの 2 個」のように、駒種 → その駒種を担える PieceID 群、の対応。
 * 移動先による駒種確定の予告 (spec §4.3) は「その駒種だけに候補を絞った場合どこへ行けるか」を
 * 問い合わせる必要があるので、駒種ごとの PieceID 群がそのまま入力になる。
 */
export function groupCandidatesByKind(
  mgf: Mgf,
  candidates: ReadonlySet<PieceId>,
  promoted: boolean,
  kindMap: Map<PieceId, string>,
): Map<string, PieceId[]> {
  const groups = new Map<string, PieceId[]>();
  for (const pid of candidates) {
    const initialKind = kindMap.get(pid);
    if (initialKind === undefined) continue;
    let kind = initialKind;
    if (promoted) {
      const def = mgf.pieces.find((p) => p.id === initialKind);
      if (!def?.promoted_id) continue;
      kind = def.promoted_id;
    }
    const list = groups.get(kind);
    if (list) list.push(pid);
    else groups.set(kind, [pid]);
  }
  return groups;
}

/**
 * 候補 PieceID 集合を駒種の集合へ resolve する (重複除去済み・順序は未規定)。
 * 対応表に無い PieceID (テスト等の orphan 参照) は無視する。
 */
export function resolveCandidateKinds(
  mgf: Mgf,
  candidates: ReadonlySet<PieceId>,
  promoted: boolean,
  kindMap: Map<PieceId, string>,
): string[] {
  return Array.from(groupCandidatesByKind(mgf, candidates, promoted, kindMap).keys());
}

/**
 * 画面に出す駒種の並び (強さ降順)。
 *
 * - 本将棋モード (candidates undefined) は `piece.kind` 1 個。
 * - 量子モードは候補を resolve した結果。結果が 1 個なら「確定した駒の顔」として
 *   そのまま表示でき、2 個以上なら未確定 = 巡回/重ね表示の対象になる。
 *
 * 並びを強さ降順に固定しているのは、巡回表示が対局のたびに違う順で回ると
 * 見え方が安定しないため (spec D1 §4.2 の「王飛角金銀桂香歩」順に一致する)。
 */
export function displayKindsFor(
  mgf: Mgf,
  piece: PieceInstance,
  kindMap: Map<PieceId, string>,
): string[] {
  if (piece.candidates === undefined) return [piece.kind];
  const kinds = resolveCandidateKinds(mgf, piece.candidates, piece.promoted, kindMap);
  // 候補が空 (矛盾局面・C-901 相当) や resolve 不能のときは、
  // 描画が消えてしまわないよう現在の kind にフォールバックする。
  if (kinds.length === 0) return [piece.kind];
  kinds.sort((a, b) => strengthOf(b) - strengthOf(a));
  return kinds;
}

/**
 * 「この駒は確実に○○である」と言える場合だけその駒種を返す (v1.09)。
 *
 * 候補の駒種が 1 つに絞れているときだけ確定とみなす。2 つ以上残っていれば undefined。
 * 本将棋モード (candidates undefined) は常に piece.kind で確定。
 *
 * 二歩のように「その筋に歩が居るか」を数えるルールは、**確定した駒だけ**を数えないと
 * いけない。piece.kind は「対局開始時にその位置に置かれていた駒種」であって正体ではないので、
 * kind で数えると未確定の駒を歩として数えてしまい、打てるはずの筋が塞がれる。
 */
export function confirmedKindOf(
  mgf: Mgf,
  piece: PieceInstance,
  kindMap: Map<PieceId, string>,
): string | undefined {
  if (piece.candidates === undefined) return piece.kind;
  const kinds = resolveCandidateKinds(mgf, piece.candidates, piece.promoted, kindMap);
  return kinds.length === 1 ? kinds[0] : undefined;
}

/**
 * この局面が量子モードのものか (v1.86)。
 *
 * **駒が候補集合を持っているかで判定する**＝棋譜の書き方 (kifu/format.ts) が使っている
 * のと同じ既存の決まりで、新しい判定を作らない。ルール定義の `modifiers.quantum` は
 * 「量子モードを選べるルールか」であって「いま量子モードで指しているか」ではない
 * (本将棋の定義は量子を選べるので常に true になる)。
 */
export function hasCandidateSets(position: Position): boolean {
  for (const row of position.board) {
    for (const cell of row) {
      if (cell?.candidates !== undefined) return true;
    }
  }
  for (const p of position.hands.player1) if (p.candidates !== undefined) return true;
  for (const p of position.hands.player2) if (p.candidates !== undefined) return true;
  return false;
}
