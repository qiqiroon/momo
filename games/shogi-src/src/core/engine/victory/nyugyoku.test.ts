import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { PieceInstance, Position } from '../position/types';
import { canDeclareNyugyoku, computeEnterZonePoints, countEnterZonePieces } from './nyugyoku';

function buildPos(pieces: Array<{ row: number; col: number; piece: PieceInstance }>, sideToMove: 'player1' | 'player2' = 'player1'): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const { row, col, piece } of pieces) board[row][col] = piece;
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

const P = (kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance => ({
  pieceId: `${owner}_${kind}`,
  kind,
  owner,
  initialOwner: owner,
  initialKind: kind,
  initialSquare: { row: -1, col: -1 },
  promoted,
});

describe('computeEnterZonePoints', () => {
  it('initial position: 0 points for both (no piece in enemy zone yet)', () => {
    const pos = initPosition(hondou);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(0);
    expect(computeEnterZonePoints(hondou, pos, 'player2')).toBe(0);
  });

  it('sente 飛 at row 2 (rank 3): 5 points', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
    ]);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(5);
  });

  it('does not count 王 in enemy zone', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
    ]);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(0);
  });

  it('counts hand pieces: 大駒 5点、小駒 1点', () => {
    let pos = buildPos([{ row: 8, col: 4, piece: P('ou', 'player1') }]);
    pos = {
      ...pos,
      hands: {
        player1: [
          P('hi', 'player1'),
          P('kaku', 'player1'),
          P('fu', 'player1'),
          P('fu', 'player1'),
        ],
        player2: [],
      },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(5 + 5 + 1 + 1);
  });
});

describe('canDeclareNyugyoku', () => {
  it('initial position: cannot declare (king not in enemy zone)', () => {
    const pos = initPosition(hondou);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
    expect(canDeclareNyugyoku(hondou, pos, 'player2')).toBe(false);
  });

  it('★v1.84: 先手は 28 点で宣言でき、27 点では宣言できない (27 点法・親 v1.62 §3.10)', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 0, piece: P('hi', 'player1') },
      { row: 2, col: 1, piece: P('kaku', 'player1') },
      { row: 2, col: 2, piece: P('kin', 'player1') },
      { row: 2, col: 3, piece: P('gin', 'player1') },
      { row: 2, col: 5, piece: P('gin', 'player1') },
      { row: 2, col: 6, piece: P('kin', 'player1') },
      { row: 2, col: 7, piece: P('kei', 'player1') },
      { row: 2, col: 8, piece: P('kyo', 'player1') },
      { row: 1, col: 0, piece: P('fu', 'player1') },
      { row: 1, col: 1, piece: P('fu', 'player1') },
      { row: 1, col: 2, piece: P('fu', 'player1') },
      { row: 1, col: 3, piece: P('fu', 'player1') },
      { row: 1, col: 5, piece: P('fu', 'player1') },
      { row: 1, col: 6, piece: P('fu', 'player1') },
    ]);
    // 盤上: 飛5 + 角5 + 金1 + 銀1 + 銀1 + 金1 + 桂1 + 香1 + 歩1 × 6 = 22 (王の分 1 を引いて 22)。
    // 持ち駒で 27 点ちょうどに合わせる → **先手は 28 点要るのでまだ宣言できない**。
    pos = {
      ...pos,
      hands: { player1: [P('kaku', 'player1')], player2: [] },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(27);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
    // 1 点足して 28 点 → 宣言できる。
    pos = {
      ...pos,
      hands: { player1: [P('kaku', 'player1'), P('fu', 'player1')], player2: [] },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(28);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(true);
  });

  it('★v1.84: 後手は 27 点で宣言できる (先手より 1 点低い・27 点法)', () => {
    // 先手の配置を上下・左右に写して後手側に作る (後手の敵陣は下 3 段)。
    let pos = buildPos(
      [
        { row: 8, col: 4, piece: P('ou', 'player2') },
        { row: 6, col: 0, piece: P('hi', 'player2') },
        { row: 6, col: 1, piece: P('kaku', 'player2') },
        { row: 6, col: 2, piece: P('kin', 'player2') },
        { row: 6, col: 3, piece: P('gin', 'player2') },
        { row: 6, col: 5, piece: P('gin', 'player2') },
        { row: 6, col: 6, piece: P('kin', 'player2') },
        { row: 6, col: 7, piece: P('kei', 'player2') },
        { row: 6, col: 8, piece: P('kyo', 'player2') },
        { row: 7, col: 0, piece: P('fu', 'player2') },
        { row: 7, col: 1, piece: P('fu', 'player2') },
        { row: 7, col: 2, piece: P('fu', 'player2') },
        { row: 7, col: 3, piece: P('fu', 'player2') },
        { row: 7, col: 5, piece: P('fu', 'player2') },
        { row: 7, col: 6, piece: P('fu', 'player2') },
      ],
      'player2',
    );
    pos = { ...pos, hands: { player1: [], player2: [P('kaku', 'player2')] } };
    expect(computeEnterZonePoints(hondou, pos, 'player2')).toBe(27);
    // **同じ 27 点でも、先手なら不可・後手なら可**＝先後で 1 点違うことの検査。
    expect(canDeclareNyugyoku(hondou, pos, 'player2')).toBe(true);
  });

  it('king in enemy zone but only 10 points: cannot declare', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
    ]);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });

  it('4 大駒 + 11 小駒手駒 だが敵陣内自駒 4 枚のみ: 10 枚未満で宣言不可 (段階1-7 追加条件)', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 0, piece: P('hi', 'player1') },
      { row: 2, col: 2, piece: P('kaku', 'player1') },
      { row: 2, col: 6, piece: P('hi', 'player1') },
      { row: 2, col: 8, piece: P('kaku', 'player1') },
    ]);
    pos = {
      ...pos,
      hands: {
        player1: Array.from({ length: 11 }, () => P('fu', 'player1', false)),
        player2: [],
      },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(24);
    expect(countEnterZonePieces(hondou, pos, 'player1')).toBe(4);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });

  it('敵陣内自駒 10 枚 + 24 点以上: 宣言可', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 0, piece: P('hi', 'player1') },
      { row: 2, col: 1, piece: P('kaku', 'player1') },
      { row: 2, col: 2, piece: P('kin', 'player1') },
      { row: 2, col: 3, piece: P('gin', 'player1') },
      { row: 2, col: 5, piece: P('gin', 'player1') },
      { row: 2, col: 6, piece: P('kin', 'player1') },
      { row: 2, col: 7, piece: P('kei', 'player1') },
      { row: 2, col: 8, piece: P('kyo', 'player1') },
      { row: 1, col: 0, piece: P('fu', 'player1') },
      { row: 1, col: 1, piece: P('fu', 'player1') },
    ]);
    expect(countEnterZonePieces(hondou, pos, 'player1')).toBe(10);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(18);
    pos = {
      ...pos,
      hands: { player1: [P('kaku', 'player1'), P('hi', 'player1')], player2: [] },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(24);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(true);
  });

  it('king in enemy zone + high points but in check: cannot declare', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
      { row: 2, col: 4, piece: P('hi', 'player2') }, // 王手 (gote 飛 attacks king via col 4)
    ]);
    pos = {
      ...pos,
      hands: {
        player1: Array.from({ length: 20 }, () => P('fu', 'player1', false)),
        player2: [],
      },
    };
    // Points would be way over 24
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThan(24);
    // But in check → cannot declare
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });
});

/**
 * v1.48 (ユーザー判断 2026-08-18・量子分冊 §Q21): 候補未確定時の入玉。
 * v1.47 までは駒の名札 (初期位置の駒種) で数えていたため、飛車のマスから来た駒は
 * 正体が歩でも 5 点として数えられ、王の除外も名札で行われていた。
 */
const Q = (
  pieceId: string,
  initialKind: string,
  candidates: string[],
  owner: 'player1' | 'player2' = 'player1',
): PieceInstance => ({
  pieceId,
  kind: initialKind,
  owner,
  initialOwner: owner,
  initialKind,
  initialSquare: { row: -1, col: -1 },
  promoted: false,
  candidates: new Set(candidates),
  confirmed: candidates.length === 1,
});

/** 先手の敵陣 (row 0..2) に 12 枚並べた局面。K と F1 の 2 枚が王候補を保持する。 */
function quantumEnteredPos(overrides: {
  f1At?: { row: number; col: number };
  gote?: Array<{ row: number; col: number; piece: PieceInstance }>;
} = {}): Position {
  const f1At = overrides.f1At ?? { row: 0, col: 5 };
  const pieces: Array<{ row: number; col: number; piece: PieceInstance }> = [
    { row: 0, col: 4, piece: Q('K', 'ou', ['K', 'F1']) },
    { row: f1At.row, col: f1At.col, piece: Q('F1', 'fu', ['K', 'F1']) },
    { row: 2, col: 0, piece: Q('R', 'hi', ['R']) },
    { row: 2, col: 1, piece: Q('B', 'kaku', ['B']) },
    ...['F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].map((id, i) => ({
      row: 1,
      col: i,
      piece: Q(id, 'fu', [id]),
    })),
    ...(overrides.gote ?? []),
  ];
  const pos = buildPos(pieces);
  return {
    ...pos,
    hands: { player1: [Q('H1', 'hi', ['H1']), Q('H2', 'kaku', ['H2'])], player2: [] },
  };
}

describe('入玉 (量子・候補未確定時) §Q21', () => {
  it('§Q21.3 候補がすべて大駒の駒だけ 5 点・混ざっていれば 1 点', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: Q('K', 'ou', ['K']) },        // 王 = 1 点 → −1 で消える
      { row: 2, col: 0, piece: Q('R', 'hi', ['R', 'B']) },   // 飛か角 → 5 点
      { row: 2, col: 1, piece: Q('B', 'kaku', ['B', 'F1']) }, // 角か歩 → 1 点
      { row: 2, col: 2, piece: Q('F1', 'fu', ['F1']) },       // 歩 → 1 点
    ]);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(1 + 5 + 1 + 1 - 1);
  });

  it('§Q21.2 王が確定していなくても、王候補がすべて敵陣・利きの外なら宣言できる', () => {
    const pos = quantumEnteredPos();
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(true);
  });

  it('§Q21.2 王候補を持つ駒が 1 枚でも敵陣の外にあると不成立', () => {
    const pos = quantumEnteredPos({ f1At: { row: 5, col: 5 } });
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });

  it('§Q21.2 王候補を持つ駒が 1 枚でも相手の利きの中にあると不成立', () => {
    // 後手の飛 (確定) が、王かもしれない駒 F1 (row0,col5) の隣で横に当たっている。
    // F1 は「王と決まってはいない」が、王候補を保持している以上これで不成立になる。
    const pos = quantumEnteredPos({
      gote: [{ row: 0, col: 6, piece: Q('g_hi', 'hi', ['g_hi'], 'player2') }],
    });
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });

  it('§Q21.3/§Q21.4 王候補が 2 枚あっても引くのは 1 回だけ', () => {
    const pos = quantumEnteredPos();
    // 敵陣内 12 枚 → 11 枚
    expect(countEnterZonePieces(hondou, pos, 'player1')).toBe(11);
    // 盤 (1+1+5+5+1×8=20) + 持ち駒 (5+5=10) = 30 → 王の分 1 を引いて 29
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(29);
  });
});
