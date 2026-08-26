/**
 * 量子モードのチェスの昇格（量子分冊 §Q23.1／§Q23.2・親 v1.65 §5.5.3・第 9 段 9-5）。
 *
 * ここで固定するのは 4 つ。
 * 1. **昇格の型を名札で決めない**＝ルークのマスから来た駒でも、正体がポーンなら昇格できる
 * 2. **昇格した時点でポーンに確定する**（§Q23.1）
 * 3. **昇格した駒は昇格先の駒として動き、その顔で出る**（候補から作り直さない）
 * 4. **最奥段で「昇格しない」を選ぶと、ポーンの候補が落ちる**（§Q23.2）
 *
 * ★4 は**将棋の量子には無かった向き**＝将棋では「成らない」を選んでも歩の候補は残るが、
 * チェスでは**昇格しないという選択そのものが「ポーンではない」と名乗ること**になる。
 */

import { describe, it, expect } from 'vitest';
import { chess } from '../../core/engine/mgf/loader';
import { applyMove } from '../../core/engine/position/apply';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { buildInitialKindMap, displayKindsFor, resolveCandidateKinds } from '../../core/engine/candidate-kinds';
import type { BoardMove, PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate } from './candidate-update';
import './index';

/** 候補集合を持つ駒。`kind` は「そのマスに最初に置かれていた駒種」であって正体ではない。 */
function qp(
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
  id: string,
  candidates?: string[],
): PieceInstance {
  return {
    pieceId: id,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
    ...(candidates ? { candidates: new Set(candidates), confirmed: false } : {}),
  };
}

/**
 * **どちらがポーンでどちらがルークか、盤からは決まらない盤**（先手番）。
 *
 * ★**身元は 2 つ・駒も 2 枚**にしてある＝確定済みの駒を「読み替えのため」に置くと、
 * **その身元が先に取られてしまい、もう一方は消去法で確定する**（割り当ての制約）。
 * それでは昇格が確定させたのかどうかが分からない＝検査が素通りする。
 *
 * a7 の駒の名札は `rook`（ルークのマスから来た駒）にしてある＝**名札で昇格の型を
 * 決めていたら、この駒は昇格できない**（ルークは昇格を持たない）。
 */
function nearBackRank(candidates: string[]): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  const pieces = [
    qp('rook', 'player1', 1, 0, 'wA', candidates), // a7（先手の最奥段は row 0）
    qp('pawn', 'player1', 6, 7, 'wB', ['wA', 'wB']), // h2
    qp('king', 'player1', 7, 4, 'wk', ['wk']),
    qp('king', 'player2', 0, 4, 'bk', ['bk']),
  ];
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

/** その駒がいま名乗りうる駒種（1 つなら確定）。 */
function kindsOf(position: Position, pieceId: string): string[] {
  const kindMap = buildInitialKindMap(position);
  for (const row of position.board) {
    for (const cell of row) {
      if (cell?.pieceId === pieceId) {
        return cell.candidates && !cell.replaced
          ? resolveCandidateKinds(chess, cell.candidates, cell.promoted, kindMap).sort()
          : [cell.kind];
      }
    }
  }
  return [];
}

function pieceOf(position: Position, pieceId: string): PieceInstance | null {
  for (const row of position.board) {
    for (const cell of row) if (cell?.pieceId === pieceId) return cell;
  }
  return null;
}

/** a7 の駒が a8 へ進む手（昇格するもの／しないもの）。 */
function forwardMoves(position: Position): BoardMove[] {
  return generateLegalMoves(chess, position).filter(
    (m): m is BoardMove =>
      m.type === 'move' && m.pieceId === 'wA' && m.to.row === 0 && m.to.col === 0,
  );
}

describe('§Q23.1 昇格はポーンの確定である', () => {
  it('★名札がルークでも、正体がポーンでありうるなら昇格の手が生まれる（4 通り）', () => {
    const p = nearBackRank(['wA', 'wB']);
    expect(kindsOf(p, 'wA')).toEqual(['pawn', 'rook']); // まだ決まっていない

    const promoting = forwardMoves(p).filter((m) => m.promote);
    // クイーン・ルーク・ビショップ・ナイトの 4 通り
    expect(promoting.map((m) => m.promoteTo).sort()).toEqual(['bishop', 'knight', 'queen', 'rook']);
  });

  it('★昇格した時点でポーンに確定し、駒はクイーンになる', () => {
    const p = nearBackRank(['wA', 'wB']);
    const move = forwardMoves(p).find((m) => m.promote && m.promoteTo === 'queen');
    expect(move).toBeTruthy();

    const after = candidateUpdate(applyMove(chess, p, move as BoardMove), chess);
    const moved = pieceOf(after, 'wA');
    expect(moved?.kind).toBe('queen');
    // ★候補は「元が誰だったか」＝ポーンに絞られている（ルークでは昇格を説明できない）
    const kindMap = buildInitialKindMap(after);
    expect(resolveCandidateKinds(chess, moved!.candidates!, moved!.promoted, kindMap)).toEqual(['pawn']);
  });

  it('★昇格した駒の候補が空にならない（強制成りの制約が巻き込まない）', () => {
    // これが無いと、最奥段に居るのに成っていない駒として扱われ、**確定したばかりの
    // ポーン候補まで落ちて**候補が空になる（量子異常）。
    const p = nearBackRank(['wA', 'wB']);
    const move = forwardMoves(p).find((m) => m.promote && m.promoteTo === 'queen') as BoardMove;
    const after = candidateUpdate(applyMove(chess, p, move), chess);
    expect(pieceOf(after, 'wA')?.candidates?.size).toBeGreaterThan(0);
  });

  it('★昇格した駒はクイーンとして動き、クイーンの顔で出る', () => {
    const p = nearBackRank(['wA', 'wB']);
    const move = forwardMoves(p).find((m) => m.promote && m.promoteTo === 'queen') as BoardMove;
    const after = candidateUpdate(applyMove(chess, p, move), chess);

    // 顔＝クイーン 1 つ（候補から作り直すとポーンの顔になってしまう）
    expect(displayKindsFor(chess, pieceOf(after, 'wA')!, buildInitialKindMap(after))).toEqual(['queen']);

    // 動き＝斜めに長く滑れる（ポーンの動きしか無ければ 0 になる）
    const withTurn: Position = { ...after, sideToMove: 'player1' };
    const diagonal = generateLegalMoves(chess, withTurn).filter(
      (m) => m.type === 'move' && m.pieceId === 'wA' && m.to.row > 2 && m.to.col > 2,
    );
    expect(diagonal.length).toBeGreaterThan(0);
  });

  it('★一度昇格した駒は、二度と昇格しない', () => {
    const p = nearBackRank(['wA', 'wB']);
    const move = forwardMoves(p).find((m) => m.promote && m.promoteTo === 'queen') as BoardMove;
    const after = candidateUpdate(applyMove(chess, p, move), chess);
    const withTurn: Position = { ...after, sideToMove: 'player1' };
    expect(generateLegalMoves(chess, withTurn).filter((m) => m.type === 'move' && m.promote)).toHaveLength(0);
  });
});

describe('§Q23.2 最奥段に着いた駒が、ポーンとは限らない', () => {
  it('★ポーンの可能性を持つ未確定の駒には、昇格しない手も残る（尋ねられる形）', () => {
    const p = nearBackRank(['wA', 'wB']);
    const plain = forwardMoves(p).filter((m) => !m.promote);
    expect(plain).toHaveLength(1); // ルークとして 1 マス進む手
  });

  it('★「昇格しない」を選ぶと、ポーンの候補が落ちる（将棋とは逆向き）', () => {
    const p = nearBackRank(['wA', 'wB']);
    const plain = forwardMoves(p).find((m) => !m.promote) as BoardMove;
    const after = candidateUpdate(applyMove(chess, p, plain), chess);
    expect(kindsOf(after, 'wA')).toEqual(['rook']);
  });

  it('ポーンに確定している駒は、昇格しない手を持たない（昇格は必須）', () => {
    const p = nearBackRank(['wB']);
    expect(kindsOf(p, 'wA')).toEqual(['pawn']);
    expect(forwardMoves(p).filter((m) => !m.promote)).toHaveLength(0);
  });
});
