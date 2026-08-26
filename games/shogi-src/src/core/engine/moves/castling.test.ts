/**
 * キャスリング (親 v1.65 §5.5.4／§5.5.6／§5.5.7・第 9 段 9-4c)。
 *
 * 成立条件 4 つ・王の 1 手として運ぶこと・棋譜表記・左右がつながった盤での両回り・
 * そして**将棋とはさみ将棋が素通りすること**を固定する。
 */

import { describe, it, expect } from 'vitest';
import { chess, hondou } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import { initPosition } from '../position/init';
import { applyMove } from '../position/apply';
import { generateLegalMoves } from './legal';
import { isSquareAttackedBy, isSquareCapturableBy } from './check';
import { formatMove } from '../kifu/format';
import type { BoardMove, Move, PieceInstance, Position } from '../position/types';

/** チェス盤の内部座標。row 7 = 段 1 (先手の最奥)・col 0 = a 列。 */
const E1 = { row: 7, col: 4 };
const A1 = { row: 7, col: 0 };
const H1 = { row: 7, col: 7 };
const G1 = { row: 7, col: 6 };
const F1 = { row: 7, col: 5 };
const C1 = { row: 7, col: 2 };
const D1 = { row: 7, col: 3 };
const E8 = { row: 0, col: 4 };

function mk(
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
  id?: string,
): PieceInstance {
  return {
    pieceId: id ?? `${kind}-${row}-${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function posWith(
  pieces: PieceInstance[],
  sideToMove: 'player1' | 'player2' = 'player1',
  extra: Partial<Position> = {},
): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
    ...extra,
  };
}

/** 王とルーク 2 枚だけの盤 (間はすべて空)。相手の王は遠くに置く。 */
function bareCastlingBoard(extra: PieceInstance[] = []): Position {
  return posWith([
    mk('king', 'player1', E1.row, E1.col, 'wk'),
    mk('rook', 'player1', A1.row, A1.col, 'wra'),
    mk('rook', 'player1', H1.row, H1.col, 'wrh'),
    mk('king', 'player2', E8.row, E8.col, 'bk'),
    ...extra,
  ]);
}

/** 王が `to` へ動く合法手 (キャスリングなら並びを持つ)。 */
function kingMovesTo(position: Position, to: { row: number; col: number }): BoardMove[] {
  return generateLegalMoves(chess, position).filter(
    (m): m is BoardMove =>
      m.type === 'move' &&
      m.from.row === E1.row &&
      m.from.col === E1.col &&
      m.to.row === to.row &&
      m.to.col === to.col,
  );
}

/** 「その駒は既に動いた」ことにする 1 手 (中身は使わないので座標は問わない)。 */
function dummyHistoryMove(pieceId: string): Move {
  return {
    type: 'move',
    pieceId,
    from: { row: 5, col: 5 },
    to: { row: 5, col: 5 },
    promote: false,
  };
}

describe('9-4c キャスリングを生む', () => {
  it('王側・女王側の 2 通りが出て、ルークの動きは並びに書かれている', () => {
    const p = bareCastlingBoard();

    const kingSide = kingMovesTo(p, G1);
    expect(kingSide).toHaveLength(1);
    expect(kingSide[0].pieceId).toBe('wk');
    expect(kingSide[0].extra_steps).toEqual([
      { pieceId: 'wrh', from: H1, dest: { kind: 'square', square: F1 } },
    ]);

    const queenSide = kingMovesTo(p, C1);
    expect(queenSide).toHaveLength(1);
    expect(queenSide[0].extra_steps).toEqual([
      { pieceId: 'wra', from: A1, dest: { kind: 'square', square: D1 } },
    ]);
  });

  it('手の種類は増えていない＝どちらも「動かす手」のまま', () => {
    for (const m of [...kingMovesTo(bareCastlingBoard(), G1), ...kingMovesTo(bareCastlingBoard(), C1)]) {
      expect(m.type).toBe('move');
    }
  });

  it('王が一度でも動いていたら、どちらも出ない', () => {
    const p = { ...bareCastlingBoard(), history: [dummyHistoryMove('wk')] };
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(0);
  });

  it('そのルークだけが動いていたら、その側だけ出ない', () => {
    const p = { ...bareCastlingBoard(), history: [dummyHistoryMove('wrh')] };
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(1);
  });

  it('★並びで動いたルークも「動いた」と数える＝1 度キャスリングしたら 2 度目は無い', () => {
    // 王は戻れないので、ルーク側だけを見る (王を動かさずにルークだけ並びで動いた記録)。
    const moved: Move = {
      type: 'move',
      pieceId: 'bk',
      from: E8,
      to: E8,
      promote: false,
      extra_steps: [{ pieceId: 'wrh', from: H1, dest: { kind: 'square', square: F1 } }],
    };
    const p = { ...bareCastlingBoard(), history: [moved] };
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(1);
  });

  it('間に駒があると、その側は出ない (自分の駒でも相手の駒でも)', () => {
    const mine = bareCastlingBoard([mk('bishop', 'player1', F1.row, F1.col, 'wb')]);
    expect(kingMovesTo(mine, G1)).toHaveLength(0);
    expect(kingMovesTo(mine, C1)).toHaveLength(1);

    const theirs = bareCastlingBoard([mk('knight', 'player2', D1.row, D1.col, 'bn')]);
    expect(kingMovesTo(theirs, C1)).toHaveLength(0);
  });

  it('相方が名指しされた駒でなければ出ない (クイーンとはキャスリングしない)', () => {
    const p = posWith([
      mk('king', 'player1', E1.row, E1.col, 'wk'),
      mk('queen', 'player1', H1.row, H1.col, 'wq'),
      mk('king', 'player2', E8.row, E8.col, 'bk'),
    ]);
    expect(kingMovesTo(p, G1)).toHaveLength(0);
  });

  it('いま王手されていたら、どちらも出ない', () => {
    const p = bareCastlingBoard([mk('rook', 'player2', 3, E1.col, 'br')]);
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(0);
  });

  it('王が通り抜けるマスが狙われていたら、その側は出ない', () => {
    const p = bareCastlingBoard([mk('rook', 'player2', 3, F1.col, 'br')]);
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(1);
  });

  it('王が着地するマスが狙われていたら、その側は出ない', () => {
    const p = bareCastlingBoard([mk('rook', 'player2', 3, G1.col, 'br')]);
    expect(kingMovesTo(p, G1)).toHaveLength(0);
    expect(kingMovesTo(p, C1)).toHaveLength(1);
  });

  it('★ルークが通るマスが狙われていても構わない (見るのは王の道だけ)', () => {
    // 女王側のルークは b1 を通るが、b1 が狙われていても女王側は成立する。
    const p = bareCastlingBoard([mk('rook', 'player2', 3, 1, 'br')]);
    expect(kingMovesTo(p, C1)).toHaveLength(1);
  });

  it('盤に載せると、1 手で王とルークの 2 枚が動く', () => {
    const p = bareCastlingBoard();
    const after = applyMove(chess, p, kingMovesTo(p, G1)[0]);
    expect(after.board[G1.row][G1.col]?.pieceId).toBe('wk');
    expect(after.board[F1.row][F1.col]?.pieceId).toBe('wrh');
    expect(after.board[E1.row][E1.col]).toBeNull();
    expect(after.board[H1.row][H1.col]).toBeNull();
    expect(after.moveNumber).toBe(2);
  });
});

describe('9-4c 棋譜表記 (§5.5.6)', () => {
  it('王側は O-O・女王側は O-O-O', () => {
    const p = bareCastlingBoard();
    expect(formatMove(chess, p, kingMovesTo(p, G1)[0])).toBe('O-O');
    expect(formatMove(chess, p, kingMovesTo(p, C1)[0])).toBe('O-O-O');
  });

  it('後手のキャスリングも同じ書き方になる', () => {
    const p = posWith(
      [
        mk('king', 'player2', E8.row, E8.col, 'bk'),
        mk('rook', 'player2', 0, 7, 'brh'),
        mk('rook', 'player2', 0, 0, 'bra'),
        mk('king', 'player1', E1.row, E1.col, 'wk'),
      ],
      'player2',
    );
    const moves = generateLegalMoves(chess, p).filter(
      (m): m is BoardMove => m.type === 'move' && m.pieceId === 'bk' && !!m.extra_steps,
    );
    const written = moves.map((m) => formatMove(chess, p, m)).sort();
    expect(written).toEqual(['O-O', 'O-O-O']);
  });

  it('キャスリングでない王の手は、これまでどおり長い記法のまま', () => {
    const p = bareCastlingBoard();
    const step = kingMovesTo(p, { row: 6, col: 4 });
    expect(step).toHaveLength(1);
    expect(formatMove(chess, p, step[0])).toBe('Ke1-e2');
  });
});

describe('9-4c 左右がつながった盤 (§5.5.7)', () => {
  it('同じルークへ両回りで届く＝2 通り出る', () => {
    // h1 のルークを外し、a1 のルークだけ残す。東へ回り込んでも a1 に届く。
    const p = posWith(
      [
        mk('king', 'player1', E1.row, E1.col, 'wk'),
        mk('rook', 'player1', A1.row, A1.col, 'wra'),
        mk('king', 'player2', E8.row, E8.col, 'bk'),
      ],
      'player1',
      { topology: { wrapX: true, wrapY: false } },
    );
    expect(kingMovesTo(p, C1)).toHaveLength(1); // 西回り (a1 まで 4)
    expect(kingMovesTo(p, G1)).toHaveLength(1); // 東回り (h1 を越えて a1 まで 4)
  });
});

describe('9-4c 縮退互換', () => {
  it('本将棋には並びを持つ手が 1 つも生まれない', () => {
    const p = initPosition(hondou);
    const withSteps = generateLegalMoves(hondou, p).filter(
      (m) => m.type === 'move' && m.extra_steps !== undefined,
    );
    expect(withSteps).toHaveLength(0);
  });

  it('チェスの初期配置でもキャスリングは出ない (間が埋まっている)', () => {
    const p = initPosition(chess);
    const withSteps = generateLegalMoves(chess, p).filter(
      (m) => m.type === 'move' && m.extra_steps !== undefined,
    );
    expect(withSteps).toHaveLength(0);
  });

  it('キャスリングの指定を外したルールでは出ない', () => {
    const noCastling: Mgf = { ...chess, constraints: { ...chess.constraints, castling: undefined } };
    const p = bareCastlingBoard();
    const withSteps = generateLegalMoves(noCastling, p).filter(
      (m) => m.type === 'move' && m.extra_steps !== undefined,
    );
    expect(withSteps).toHaveLength(0);
  });
});

describe('9-4c 空のマスが狙われているかの数え方 (§5.5.4)', () => {
  it('★ポーンは前へ進めるだけで、そのマスを狙ってはいない', () => {
    // 後手のポーン f2。f1 へ進めるが、狙っているのは e1 と g1。
    const p = posWith([
      mk('king', 'player1', E1.row, E1.col, 'wk'),
      mk('pawn', 'player2', 6, F1.col, 'bp'),
      mk('king', 'player2', E8.row, E8.col, 'bk'),
    ]);
    // 「動ける手があるか」で見ると、空の f1 まで狙っていることになってしまう。
    expect(isSquareAttackedBy(chess, p, F1, 'player2')).toBe(true);
    // 「取られる駒が居たら取れるか」で見れば、狙っていない。
    expect(isSquareCapturableBy(chess, p, F1, 'player2')).toBe(false);
    // 斜め前の 2 マスは、駒が居なくても狙っている。
    expect(isSquareCapturableBy(chess, p, G1, 'player2')).toBe(true);
    expect(isSquareCapturableBy(chess, p, E1, 'player2')).toBe(true);
  });
});
