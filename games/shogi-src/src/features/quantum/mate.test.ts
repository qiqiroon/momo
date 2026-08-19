import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { generateLegalMoves, hasAnyLegalMove, isCheckmate } from '../../core/engine/moves/legal';
import { isInCheck } from '../../core/engine/moves/check';
import { quantumInit } from './init';
import { candidateUpdate } from './candidate-update';
import './index';

/**
 * Phase 5-14 候補集合を含む詰み判定 (§Q13.7)。
 *
 * ★この段には専用モジュール (計画書が置き場所として挙げていた mate.ts) を作っていない。
 * 詰み判定は既存の共通処理だけで §Q13.7 を満たしているためで、内訳は次の 3 つ:
 *
 *   1. 手の生成が候補の和集合 (§Q5.3・generator.ts) = 候補のどれか 1 つで説明できる
 *      逃げ道はすべて逃げ道として出てくる
 *   2. 王手の対象が「王として確定した駒」だけ (§Q13.1・king-detection.ts)
 *   3. 詰みの判定が候補更新の完了後 (安定状態・§Q13.3) に走る (game-store の
 *      computeStatusAfterMove は候補更新を通した局面を受け取る)
 *
 * つまり 5-14 の中身は「新しく作る」ではなく「すでに成立していることを固定する」。
 * この検査ファイルがその正本で、将来この 3 つのどれかを触ったときに崩れたら赤くなる。
 */

/** 検査用の駒を 1 枚作る。cands=null なら本将棋モード (候補なし)。 */
function mk(
  pieceId: string,
  kind: string,
  owner: 'player1' | 'player2',
  cands: string[] | null,
): PieceInstance {
  return {
    pieceId,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row: -1, col: -1 },
    promoted: false,
    candidates: cands ? new Set<PieceId>(cands) : undefined,
    confirmed: cands ? cands.length === 1 : undefined,
  };
}

/**
 * 空盤に駒を並べた局面を作る。
 *
 * ★注意: 候補に書いた PieceID は、その身元を持つ駒が盤か駒台に**実在していないと
 * 解決できず黙って無視される** (candidate-kinds.ts の buildInitialKindMap は局面を
 * 走査して対応表を作るため)。存在しない身元を候補に書くと「候補が 1 つ減った状態」の
 * 検査になってしまうので、候補に挙げる身元の駒は必ずどこかに置くこと。
 */
function buildPos(
  pieces: Array<{ row: number; col: number; piece: PieceInstance }>,
  hands: { player1?: PieceInstance[]; player2?: PieceInstance[] } = {},
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: hands.player1 ?? [], player2: hands.player2 ?? [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

/** 先手玉の逃げ道 (斜め前・横) を自分の歩で塞ぐ。合駒・駒を取る手だけを残したいとき用。 */
function sealKingEscapes() {
  return [
    { row: 8, col: 3, piece: mk('P1', 'fu', 'player1', ['P1']) },
    { row: 8, col: 5, piece: mk('P2', 'fu', 'player1', ['P2']) },
    { row: 7, col: 3, piece: mk('P3', 'fu', 'player1', ['P3']) },
    { row: 7, col: 5, piece: mk('P4', 'fu', 'player1', ['P4']) },
  ];
}

describe('Phase 5-14 候補集合を含む詰み判定 (§Q13.7)', () => {
  it('未確定の攻撃駒 (飛か角のどちらか) でも、確定した王への詰みを検出する', () => {
    // 後手の 2 枚はどちらも候補 {飛, 角} で正体不明。飛として読めば 8 段目と 7 段目を
    // 横に払うので、確定した先手玉に逃げ場が無い (§Q13.4 = 候補のうち 1 つでも
    // その捕獲を実現できるなら王手)。
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player2', ['R1', 'B1']) },
      { row: 7, col: 0, piece: mk('B1', 'kaku', 'player2', ['R1', 'B1']) },
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
    expect(generateLegalMoves(hondou, pos)).toHaveLength(0);
    expect(isCheckmate(hondou, pos)).toBe(true);
  });

  it('候補の駒種を切り替えれば合駒できる局面を、詰みと誤判定しない', () => {
    // 後手飛 (0,4) が縦から王手。玉の逃げ道は歩で塞いである。
    // (6,0) の駒は候補 {金, 飛}。金では (6,4) に届かないが、飛なら横に走って合駒できる。
    // 飛の身元 R1 の実物は (8,0) に置くが、そちらは塞がれていて合駒できない
    // = 逃げ道は「候補を飛に切り替えた 1 手」だけになる。
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 0, col: 4, piece: mk('R2', 'hi', 'player2', ['R2']) },
      { row: 6, col: 0, piece: mk('G1', 'kin', 'player1', ['G1', 'R1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player1', ['R1']) },
      ...sealKingEscapes(),
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);

    const escapes = generateLegalMoves(hondou, pos);
    expect(escapes).toHaveLength(1);
    expect(escapes[0]).toMatchObject({
      type: 'move',
      pieceId: 'G1',
      from: { row: 6, col: 0 },
      to: { row: 6, col: 4 },
    });
    expect(isCheckmate(hondou, pos)).toBe(false);
  });

  it('金の候補しか残っていなければ、同じ形が詰みになる (上の検査の裏取り)', () => {
    // 直前の検査と盤は同じで、(6,0) の候補を金だけに確定させた版。
    // 「合駒できたのは飛の候補があったから」を裏から確かめる。
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 0, col: 4, piece: mk('R2', 'hi', 'player2', ['R2']) },
      { row: 6, col: 0, piece: mk('G1', 'kin', 'player1', ['G1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player1', ['R1']) },
      ...sealKingEscapes(),
    ]);
    expect(isCheckmate(hondou, pos)).toBe(true);
  });

  it('王手している未確定駒を取れる場合は詰みではない', () => {
    // 後手の王手駒 (7,4) は候補 {金, 銀} で未確定。先手の (6,3) の駒がそれを取れる。
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 7, col: 4, piece: mk('G2', 'kin', 'player2', ['G2', 'S2']) },
      { row: 5, col: 4, piece: mk('S2', 'gin', 'player2', ['G2', 'S2']) },
      { row: 6, col: 3, piece: mk('S1', 'gin', 'player1', ['S1']) },
      ...sealKingEscapes(),
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
    const escapes = generateLegalMoves(hondou, pos);
    expect(escapes.some((m) => m.type !== 'free' && m.to.row === 7 && m.to.col === 4)).toBe(true);
    expect(isCheckmate(hondou, pos)).toBe(false);
  });

  it('持ち駒を打って合駒できる場合は詰みではない', () => {
    // 駒台の駒も候補を持つ (量子モードでは 1 枚ずつ別の身元)。打つ手も逃げ道に数える。
    const inHand = mk('H1', 'kin', 'player1', ['H1']);
    const pos = buildPos(
      [
        { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
        { row: 0, col: 4, piece: mk('R2', 'hi', 'player2', ['R2']) },
        ...sealKingEscapes(),
      ],
      { player1: [inHand] },
    );
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
    const escapes = generateLegalMoves(hondou, pos);
    expect(escapes.some((m) => m.type === 'drop' && m.to.col === 4)).toBe(true);
    expect(isCheckmate(hondou, pos)).toBe(false);
  });

  it('王が未確定なら、詰みの形でも詰みにならない (§Q13.1・§Q13.2)', () => {
    // (8,4) の駒は候補 {王, 金} でまだ王と確定していない。未確定の駒に王手は成立せず、
    // したがって詰みも成立しない。候補を維持すること自体が戦略資源という考え方 (§Q3.2)。
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1', 'G1']) },
      { row: 6, col: 8, piece: mk('G1', 'kin', 'player1', ['K1', 'G1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player2', ['R1']) },
      { row: 7, col: 0, piece: mk('R3', 'hi', 'player2', ['R3']) },
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(false);
    expect(isCheckmate(hondou, pos)).toBe(false);
  });

  it('本将棋モード (候補なし) では従来どおり詰みになる = 縮退互換', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', null) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player2', null) },
      { row: 7, col: 0, piece: mk('R3', 'hi', 'player2', null) },
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
    expect(isCheckmate(hondou, pos)).toBe(true);
  });

  it('早期打ち切りの答えは「合法手を全部作って数える」と一致する', () => {
    // isCheckmate は逃げ道が 1 つ見つかった時点で打ち切る (hasAnyLegalMove)。
    // 打ち切りで答えが変わっていないことを、全部作る側と突き合わせて固定する。
    const 詰み = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player2', ['R1', 'B1']) },
      { row: 7, col: 0, piece: mk('B1', 'kaku', 'player2', ['R1', 'B1']) },
    ]);
    const 詰みでない = buildPos([
      { row: 8, col: 4, piece: mk('K1', 'ou', 'player1', ['K1']) },
      { row: 0, col: 4, piece: mk('R2', 'hi', 'player2', ['R2']) },
      { row: 6, col: 0, piece: mk('G1', 'kin', 'player1', ['G1', 'R1']) },
      { row: 8, col: 0, piece: mk('R1', 'hi', 'player1', ['R1']) },
      ...sealKingEscapes(),
    ]);
    for (const pos of [詰み, 詰みでない]) {
      const 全部作る = generateLegalMoves(hondou, pos, { skipUchifuTsume: true }).length > 0;
      expect(hasAnyLegalMove(hondou, pos, { skipUchifuTsume: true })).toBe(全部作る);
      expect(isCheckmate(hondou, pos)).toBe(!全部作る);
    }
  });

  it('対局開始直後の量子局面では、王が未確定なので詰み判定に入らない', () => {
    // 実戦規模の局面での縮退確認。開始時は両者とも王が確定していないので
    // isInCheck が即 false = 重い探索そのものが走らない。
    const pos = candidateUpdate(quantumInit(initPosition(hondou)), hondou);
    expect(isInCheck(hondou, pos, 'player1')).toBe(false);
    expect(isCheckmate(hondou, pos)).toBe(false);
  });
});
