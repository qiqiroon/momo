import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { searchBestMove } from './search';
import { evaluate, MATE_VALUE } from './evaluate';

function piece(
  pieceId: string,
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
): PieceInstance {
  return {
    pieceId,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function buildPos(
  placed: Array<{ row: number; col: number; piece: PieceInstance }>,
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece: p } of placed) board[row][col] = p;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

const FIXED = { jitter: 0, random: () => 0 };

describe('駒得の評価', () => {
  it('初期局面は互角 (どちらから見ても 0)', () => {
    const pos = initPosition(hondou);
    expect(evaluate(hondou, pos)).toBe(0);
  });

  it('駒を多く持っている側から見て有利になる', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 4, piece: piece('k', 'ou', 'player2', 0, 4) },
      { row: 4, col: 4, piece: piece('R', 'hi', 'player1', 4, 4) },
    ]);
    expect(evaluate(hondou, pos)).toBeGreaterThan(500);
    expect(evaluate(hondou, { ...pos, sideToMove: 'player2' })).toBeLessThan(-500);
  });
});

describe('読み筋', () => {
  it('ただで取れる飛車があれば取る', () => {
    // 先手の飛が 5五、後手の飛が 5三 (取り返す駒は無い)。
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 4, col: 4, piece: piece('R', 'hi', 'player1', 4, 4) },
      { row: 2, col: 4, piece: piece('r', 'hi', 'player2', 2, 4) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 3000, maxDepth: 3, ...FIXED });
    expect(r.move).not.toBeNull();
    expect(r.move?.type).toBe('move');
    if (r.move?.type === 'move') {
      expect(r.move.to).toEqual({ row: 2, col: 4 });
    }
  });

  it('取り返される駒には手を出さない (取り合いの先まで読む)', () => {
    // 5三の後手の歩は、取ると 5二の金に取り返される。飛を歩と刺し違えるのは損。
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 3, col: 4, piece: piece('R', 'hi', 'player1', 3, 4) },
      { row: 2, col: 4, piece: piece('p', 'fu', 'player2', 2, 4) },
      { row: 1, col: 4, piece: piece('g', 'kin', 'player2', 1, 4) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 3000, maxDepth: 3, ...FIXED });
    expect(r.move?.type).toBe('move');
    if (r.move?.type === 'move') {
      expect(r.move.to).not.toEqual({ row: 2, col: 4 });
    }
  });

  it('1 手で詰むなら詰ます', () => {
    // 後手玉 1一。先手の金 1三・飛 9二 → 金 1二 で詰み。
    const pos = buildPos([
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 8, col: 8, piece: piece('K', 'ou', 'player1', 8, 8) },
      { row: 2, col: 0, piece: piece('G', 'kin', 'player1', 2, 0) },
      { row: 1, col: 8, piece: piece('R', 'hi', 'player1', 1, 8) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 5000, maxDepth: 4, ...FIXED });
    expect(r.move).not.toBeNull();
    // 実際に指してみて、後手に指す手が無くなる (詰んでいる) ことを確かめる
    const after = applyMove(hondou, pos, r.move!);
    expect(generateLegalMoves(hondou, after)).toHaveLength(0);
    expect(r.score).toBeGreaterThan(MATE_VALUE - 1000);
  });

  it('指す手が無ければ null を返す', () => {
    // 後手玉 1一が先手の金 1二・飛 9二で詰んでいる状態から、後手の手番で読ませる
    const pos = buildPos(
      [
        { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
        { row: 8, col: 8, piece: piece('K', 'ou', 'player1', 8, 8) },
        { row: 1, col: 0, piece: piece('G', 'kin', 'player1', 1, 0) },
        { row: 1, col: 8, piece: piece('R', 'hi', 'player1', 1, 8) },
      ],
      'player2',
    );
    const r = searchBestMove(hondou, pos, { movetimeMs: 1000, maxDepth: 3, ...FIXED });
    expect(r.move).toBeNull();
  });

  it('初期局面から返る手は必ず合法手', () => {
    const pos = initPosition(hondou);
    const legal = generateLegalMoves(hondou, pos);
    const r = searchBestMove(hondou, pos, { movetimeMs: 800, maxDepth: 6 });
    expect(r.move).not.toBeNull();
    expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(r.move))).toBe(true);
  });

  it('時間の上限を守る (深さは時間で決まる)', () => {
    const pos = initPosition(hondou);
    const budget = 400;
    const r = searchBestMove(hondou, pos, { movetimeMs: budget, maxDepth: 20, ...FIXED });
    expect(r.move).not.toBeNull();
    // 打ち切りは節目でしか見ないので多少はみ出す。倍を超えないことを見る。
    expect(r.elapsedMs).toBeLessThan(budget * 2);
    expect(r.depth).toBeGreaterThanOrEqual(1);
  });

  /**
   * v1.39 の再発防止 (親 §7.3.3)。
   *
   * 枝刈りは**最善手以外に正確な点数を出さない**。それを確定値として同点扱いすると、
   * 実際には大損する手が候補に混ざる。v1.38 まではこれで**駒がぶつかった局面の 12 件中 9 件**
   * で歩 1 枚以上、最悪 3818 点を損する手を選んでいた。
   *
   * **駒が数枚しかない作り物の局面では出ない**ので (上の検査が全部緑だったのはそのため)、
   * ここでは実戦と同じように駒が詰まった局面を作り、当たりのある形で確かめる。
   * また**同点崩しを 0 にすると隠れる**ので、対局と同じ幅を渡して確かめること。
   */
  it('駒がぶつかった局面で、最善から同点崩しの幅より大きく損しない', () => {
    const JITTER = 20;
    const DEPTH = 3;

    for (let seed = 0; seed < 4; seed++) {
      // でたらめな手で進めて、当たり (取り合い) のある局面を作る
      let s = (1000 + seed) >>> 0;
      const rnd = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      let pos = initPosition(hondou);
      for (let i = 0; i < 24; i++) {
        const legal = generateLegalMoves(hondou, pos);
        if (legal.length === 0) break;
        pos = applyMove(hondou, pos, legal[Math.floor(rnd() * legal.length)]);
      }

      const chosen = searchBestMove(hondou, pos, {
        movetimeMs: 60000,
        maxDepth: DEPTH,
        jitter: JITTER,
        random: rnd,
      });
      expect(chosen.move).not.toBeNull();

      // 全部の手を full window で測り直して、選んだ手の本当の値打ちを知る
      let trueBest = -Infinity;
      let chosenValue = NaN;
      for (const m of generateLegalMoves(hondou, pos)) {
        const sub = searchBestMove(hondou, applyMove(hondou, pos, m), {
          movetimeMs: 60000,
          maxDepth: DEPTH - 1,
          jitter: 0,
          random: () => 0,
        });
        const v = -sub.score;
        if (v > trueBest) trueBest = v;
        if (JSON.stringify(m) === JSON.stringify(chosen.move)) chosenValue = v;
      }
      expect(chosenValue).not.toBeNaN();
      expect(trueBest - chosenValue).toBeLessThanOrEqual(JITTER);
    }
  });

  it('外から打ち切られても 1 手は返す', () => {
    const pos = initPosition(hondou);
    const r = searchBestMove(hondou, pos, {
      movetimeMs: 10000,
      maxDepth: 20,
      shouldStop: () => true,
      ...FIXED,
    });
    expect(r.move).not.toBeNull();
  });
});
