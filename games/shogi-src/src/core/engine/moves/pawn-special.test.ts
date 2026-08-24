import { describe, it, expect } from 'vitest';
import { chess } from '../mgf/loader';
import { generatePieceMoves } from './generator';
import { generateLegalMoves } from './legal';
import { applyMove } from '../position/apply';
import type { BoardMove, Move, PieceInstance, Position, Square } from '../position/types';

/**
 * ポーンの特殊な手 (親 v1.65 §5.5.3・第 9 段 9-4b)。初手 2 マスとアンパッサンを、
 * **手を生む側**から確かめる。適用側 (extra_steps・discard) は 9-2 の検査が受け持つ。
 *
 * ★空振りにしない：初手 2 マスは「間・着地が空のとき出て、ふさがれば出ない」を両方見る。
 * アンパッサンは「直後の 1 手だけ・別マスの相手ポーンを取り除く・自玉が開くなら非合法」
 * まで通す (最後の 1 つが 9-4b で洗った検算側の穴＝legal の省略の直し)。
 */

function pawn(owner: 'player1' | 'player2', _row: number, col: number, initRow: number, id: string): PieceInstance {
  return {
    pieceId: id, kind: 'pawn', owner, initialOwner: owner, initialKind: 'pawn',
    initialSquare: { row: initRow, col }, promoted: false,
  };
}

function king(owner: 'player1' | 'player2', row: number, col: number, id: string): PieceInstance {
  return {
    pieceId: id, kind: 'king', owner, initialOwner: owner, initialKind: 'king',
    initialSquare: { row, col }, promoted: false,
  };
}

/** 駒をそのまま「いまいるマス」へ置いて盤を組む (初期マスと現在マスが違ってよい)。 */
function place(cells: { piece: PieceInstance; at: Square }[], sideToMove: 'player1' | 'player2', history: Move[] = []): Position {
  const board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null as PieceInstance | null));
  for (const { piece, at } of cells) board[at.row][at.col] = piece;
  return { width: 8, height: 8, board, hands: { player1: [], player2: [] }, sideToMove, moveNumber: 1, history };
}

function toKey(sq: Square): string {
  return `${sq.row},${sq.col}`;
}

describe('9-4b 初手 2 マス', () => {
  it('初期マスのポーンは 1 マスと 2 マスの両方を生む (間・着地が空)', () => {
    const p = pawn('player1', 6, 4, 6, 'P0'); // e2 相当・初期マスにいる
    const pos = place([{ piece: p, at: { row: 6, col: 4 } }, { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } }, { piece: king('player2', 0, 0, 'p0'), at: { row: 0, col: 0 } }], 'player1');
    const dests = generatePieceMoves(chess, pos, { row: 6, col: 4 }).map((m) => toKey(m.to)).sort();
    expect(dests).toEqual(['4,4', '5,4']); // 1 マス (row5) と 2 マス (row4)
  });

  it('間のマスがふさがっていれば 2 マスは出ない (1 マスも出ない)', () => {
    const p = pawn('player1', 6, 4, 6, 'P0');
    const pos = place(
      [
        { piece: p, at: { row: 6, col: 4 } },
        { piece: pawn('player2', 5, 4, 1, 'q'), at: { row: 5, col: 4 } }, // 目の前をふさぐ
        { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } },
        { piece: king('player2', 0, 0, 'p0'), at: { row: 0, col: 0 } },
      ],
      'player1',
    );
    expect(generatePieceMoves(chess, pos, { row: 6, col: 4 }).map((m) => toKey(m.to))).toEqual([]);
  });

  it('着地マスだけふさがっていれば 1 マスは出るが 2 マスは出ない', () => {
    const p = pawn('player1', 6, 4, 6, 'P0');
    const pos = place(
      [
        { piece: p, at: { row: 6, col: 4 } },
        { piece: pawn('player2', 4, 4, 1, 'q'), at: { row: 4, col: 4 } }, // 2 マス先をふさぐ
        { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } },
        { piece: king('player2', 0, 0, 'p0'), at: { row: 0, col: 0 } },
      ],
      'player1',
    );
    expect(generatePieceMoves(chess, pos, { row: 6, col: 4 }).map((m) => toKey(m.to))).toEqual(['5,4']);
  });

  it('一度動いたポーン (初期マスにいない) は 2 マスを生まない', () => {
    // 現在 row5・初期マス row6 = すでに 1 マス動いている。
    const p = pawn('player1', 5, 4, 6, 'P0');
    const pos = place([{ piece: p, at: { row: 5, col: 4 } }, { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } }, { piece: king('player2', 0, 0, 'p0'), at: { row: 0, col: 0 } }], 'player1');
    expect(generatePieceMoves(chess, pos, { row: 5, col: 4 }).map((m) => toKey(m.to))).toEqual(['4,4']);
  });

  it('後手 (上側) も初期マスから前 (下) へ 2 マス', () => {
    const p = pawn('player2', 1, 4, 1, 'p0'); // e7 相当
    const pos = place([{ piece: p, at: { row: 1, col: 4 } }, { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } }, { piece: king('player2', 0, 0, 'p9'), at: { row: 0, col: 0 } }], 'player2');
    const dests = generatePieceMoves(chess, pos, { row: 1, col: 4 }).map((m) => toKey(m.to)).sort();
    expect(dests).toEqual(['2,4', '3,4']);
  });

  it('2 マス進みを適用すると、ポーンが 2 つ先に着地する', () => {
    const p = pawn('player1', 6, 4, 6, 'P0');
    const pos = place([{ piece: p, at: { row: 6, col: 4 } }, { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } }, { piece: king('player2', 0, 0, 'p0'), at: { row: 0, col: 0 } }], 'player1');
    const dbl = generatePieceMoves(chess, pos, { row: 6, col: 4 }).find((m) => toKey(m.to) === '4,4')!;
    const next = applyMove(chess, pos, dbl);
    expect(next.board[6][4]).toBeNull();
    expect(next.board[4][4]).toMatchObject({ kind: 'pawn', owner: 'player1' });
  });
});

/** アンパッサンの下ごしらえ：後手ポーンが e7→e5 (row1→row3) と 2 マス進んだ直後の局面。 */
function enPassantSetup(extra: { piece: PieceInstance; at: Square }[] = [], side: 'player1' | 'player2' = 'player1'): Position {
  const blackPawn = pawn('player2', 3, 4, 1, 'bp'); // 初期 row1・いま row3
  const last: BoardMove = { type: 'move', pieceId: 'bp', from: { row: 1, col: 4 }, to: { row: 3, col: 4 }, promote: false };
  return place(
    [
      { piece: blackPawn, at: { row: 3, col: 4 } },
      { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } },
      { piece: king('player2', 0, 7, 'p0'), at: { row: 0, col: 7 } },
      ...extra,
    ],
    side,
    [last],
  );
}

describe('9-4b アンパッサン', () => {
  it('直前の 2 マス進みの横にいる自ポーンは、通り過ぎたマスへ取れる (取られる駒を取り除く)', () => {
    // 白ポーン d5(row3col5) が、通り過ぎた e6(row2col4) へ進んで黒ポーン e5(row3col4) を取る。
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    const pos = enPassantSetup([{ piece: myPawn, at: { row: 3, col: 5 } }]);
    const ep = generatePieceMoves(chess, pos, { row: 3, col: 5 }).find((m) => toKey(m.to) === '2,4');
    expect(ep).toBeDefined();
    expect(ep!.extra_steps).toEqual([{ pieceId: 'bp', from: { row: 3, col: 4 }, dest: { kind: 'discard' } }]);
    expect(ep!.capturedPieceId).toBeUndefined(); // 着地マスは空＝本体では取らない
  });

  it('適用すると、相手ポーンが盤から消え・自ポーンは通り過ぎたマスに立ち・駒台には入らない', () => {
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    const pos = enPassantSetup([{ piece: myPawn, at: { row: 3, col: 5 } }]);
    const ep = generatePieceMoves(chess, pos, { row: 3, col: 5 }).find((m) => toKey(m.to) === '2,4')!;
    const next = applyMove(chess, pos, ep);
    expect(next.board[3][4]).toBeNull(); // 取られた黒ポーンが消えた (着地マスではないマス)
    expect(next.board[3][5]).toBeNull(); // 自ポーンは出発マスを離れた
    expect(next.board[2][4]).toMatchObject({ kind: 'pawn', owner: 'player1' });
    expect(next.hands.player1).toHaveLength(0); // チェスは駒台に溜めない
  });

  it('直後でなければ取れない (間に別の手が挟まると権利は消える)', () => {
    // 履歴の最後が「2 マス進み」でなく、白キングの 1 手なら、アンパッサンは出ない。
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    const notLast: Move = { type: 'move', pieceId: 'P1', from: { row: 7, col: 0 }, to: { row: 7, col: 1 }, promote: false };
    const pos = place(
      [
        { piece: pawn('player2', 3, 4, 1, 'bp'), at: { row: 3, col: 4 } },
        { piece: myPawn, at: { row: 3, col: 5 } },
        { piece: king('player1', 7, 1, 'P1'), at: { row: 7, col: 1 } },
        { piece: king('player2', 0, 7, 'p0'), at: { row: 0, col: 7 } },
      ],
      'player1',
      [notLast],
    );
    expect(generatePieceMoves(chess, pos, { row: 3, col: 5 }).some((m) => toKey(m.to) === '2,4')).toBe(false);
  });

  it('直前が 1 マス進みなら取れない (2 マス進みでないと権利は立たない)', () => {
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    // 黒ポーンが row2→row3 と 1 マスだけ進んだ (初期 row1 ではない)。
    const oneStep: BoardMove = { type: 'move', pieceId: 'bp', from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, promote: false };
    const pos = place(
      [
        { piece: pawn('player2', 3, 4, 1, 'bp'), at: { row: 3, col: 4 } },
        { piece: myPawn, at: { row: 3, col: 5 } },
        { piece: king('player1', 7, 0, 'P1'), at: { row: 7, col: 0 } },
        { piece: king('player2', 0, 7, 'p0'), at: { row: 0, col: 7 } },
      ],
      'player1',
      [oneStep],
    );
    expect(generatePieceMoves(chess, pos, { row: 3, col: 5 }).some((m) => toKey(m.to) === '2,4')).toBe(false);
  });

  it('安全な局面ではアンパッサンは合法手に入る', () => {
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    const pos = enPassantSetup([{ piece: myPawn, at: { row: 3, col: 5 } }]);
    const legal = generateLegalMoves(chess, pos);
    expect(legal.some((m) => m.type === 'move' && toKey(m.to) === '2,4' && m.extra_steps)).toBe(true);
  });

  it('★アンパッサンで自玉が横から王手される手は非合法 (省略の穴を塞いだことの錠)', () => {
    // 白玉 a5(row3col0)・白ポーン d5(row3col5)・黒ポーン e5(row3col4)・黒ルーク h5(row3col7)。
    // アンパッサンで白ポーンと黒ポーンが同じ段から消えると、ルークの利きが玉まで通る。
    const myPawn = pawn('player1', 3, 5, 6, 'P0');
    const pos = place(
      [
        { piece: pawn('player2', 3, 4, 1, 'bp'), at: { row: 3, col: 4 } },
        { piece: myPawn, at: { row: 3, col: 5 } },
        { piece: king('player1', 3, 0, 'P1'), at: { row: 3, col: 0 } },
        {
          piece: { pieceId: 'br', kind: 'rook', owner: 'player2', initialOwner: 'player2', initialKind: 'rook', initialSquare: { row: 3, col: 7 }, promoted: false },
          at: { row: 3, col: 7 },
        },
        { piece: king('player2', 0, 7, 'p0'), at: { row: 0, col: 7 } },
      ],
      'player1',
      [{ type: 'move', pieceId: 'bp', from: { row: 1, col: 4 }, to: { row: 3, col: 4 }, promote: false }],
    );
    // 擬合法手としては生成される (generatePieceMoves は玉の安全を見ない)。
    expect(generatePieceMoves(chess, pos, { row: 3, col: 5 }).some((m) => toKey(m.to) === '2,4')).toBe(true);
    // だが合法手には入らない (applyMove 後に自玉が王手のため)。
    expect(generateLegalMoves(chess, pos).some((m) => m.type === 'move' && toKey(m.to) === '2,4')).toBe(false);
  });
});
