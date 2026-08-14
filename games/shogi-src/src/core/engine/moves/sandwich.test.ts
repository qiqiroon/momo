/**
 * はさみ将棋 — 親仕様 v1.29 §5.3 / §3.8 `post_move_topology` (Phase 6)。
 *
 * 確定した標準バリアントを、盤の側から確かめる:
 *   飛車型のスライド・移動では取れない・自駒 2 枚で挟む・まとめて取る・
 *   自分から挟まれに入っても取られない・隅は囲めば取れる・相手が 2 枚以下で勝ち。
 * 盤の端がつながっているとき (円筒・完全トーラス) の振る舞いも併せて固定する。
 */

import { describe, it, expect } from 'vitest';
import { hasami, hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { applyMove } from '../position/apply';
import { generatePieceMoves } from './generator';
import { generateLegalMoves } from './legal';
import { sandwichCaptures, countBoardPieces, annihilationLoser } from './sandwich';
import type { BoardTopology, PieceInstance, Position, Square } from '../position/types';
import type { Player } from '../mgf/types';

const CYLINDER: BoardTopology = { wrapX: true, wrapY: false };
const FULL_TORUS: BoardTopology = { wrapX: true, wrapY: true };

/** 空の盤に駒を置いて局面を作る (テスト専用の組み立て)。 */
function board(
  placements: { row: number; col: number; owner: Player; id: string }[],
  sideToMove: Player = 'player1',
  topology?: BoardTopology,
): Position {
  const empty = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null));
  for (const p of placements) {
    empty[p.row][p.col] = {
      pieceId: p.id,
      kind: 'fu',
      owner: p.owner,
      initialOwner: p.owner,
      initialKind: 'fu',
      initialSquare: { row: p.row, col: p.col },
      promoted: false,
    };
  }
  return {
    width: 9,
    height: 9,
    board: empty,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
    ...(topology ? { topology } : {}),
  };
}

/** 盤上に残っている駒の ID (順不同で比べる)。 */
function idsOnBoard(pos: Position): string[] {
  const out: string[] = [];
  for (const row of pos.board) for (const cell of row) if (cell) out.push(cell.pieceId);
  return out.sort();
}

function moveTo(pos: Position, from: Square, to: Square): Position {
  const piece = pos.board[from.row][from.col];
  if (!piece) throw new Error('no piece at from');
  return applyMove(hasami, pos, { type: 'move', pieceId: piece.pieceId, from, to, promote: false });
}

describe('はさみ将棋のルール定義', () => {
  it('歩だけ 9 枚ずつが最奥段に並ぶ (盤 18 枚)', () => {
    const pos = initPosition(hasami);
    expect(countBoardPieces(pos, 'player1')).toBe(9);
    expect(countBoardPieces(pos, 'player2')).toBe(9);
    for (let col = 0; col < 9; col++) {
      expect(pos.board[8][col]?.owner).toBe('player1');
      expect(pos.board[0][col]?.owner).toBe('player2');
      expect(pos.board[8][col]?.kind).toBe('fu');
    }
    // 中央 7 段は空
    for (let row = 1; row <= 7; row++) {
      for (let col = 0; col < 9; col++) expect(pos.board[row][col]).toBeNull();
    }
  });

  it('持ち駒・成り・手合いを持たない', () => {
    const fu = hasami.pieces.find((p) => p.id === 'fu');
    expect(hasami.pieces).toHaveLength(1);
    expect(fu?.can_promote).toBe(false);
    expect(fu?.is_hand_piece).toBe(false);
    expect(hasami.handicap).toBeUndefined();
    // 王を持たないので、王手・詰みの判定は出番が無い
    expect(hasami.pieces.some((p) => p.is_royal)).toBe(false);
  });

  it('量子は非対応・トーラスは可', () => {
    expect(hasami.compatible_modifiers?.quantum?.enabled).toBe(false);
    expect(hasami.compatible_modifiers?.torus?.cylinder).toBe(true);
    expect(hasami.compatible_modifiers?.torus?.full_torus).toBe(true);
  });
});

describe('動き (飛車型のスライド・移動では取らない)', () => {
  it('縦横へ何マスでも進めるが、駒は飛び越せない', () => {
    const pos = board([
      { row: 4, col: 4, owner: 'player1', id: 'P0' },
      { row: 4, col: 7, owner: 'player1', id: 'P1' },
    ]);
    const dests = generatePieceMoves(hasami, pos, { row: 4, col: 4 }).map((m) => `${m.to.row},${m.to.col}`);
    expect(dests).toContain('0,4'); // 縦にまっすぐ
    expect(dests).toContain('4,6'); // 味方の手前まで
    expect(dests).not.toContain('4,7'); // 味方のマスへは入れない
    expect(dests).not.toContain('4,8'); // 飛び越せない
    expect(dests).not.toContain('3,3'); // 斜めには行けない
  });

  it('相手の駒がいるマスへは進めない (移動では取らない)', () => {
    const pos = board([
      { row: 4, col: 4, owner: 'player1', id: 'P0' },
      { row: 4, col: 6, owner: 'player2', id: 'p0' },
    ]);
    const dests = generatePieceMoves(hasami, pos, { row: 4, col: 4 }).map((m) => `${m.to.row},${m.to.col}`);
    expect(dests).toContain('4,5');
    expect(dests).not.toContain('4,6');
  });
});

describe('挟んで取る', () => {
  it('自分の駒 2 枚で挟むと取れる', () => {
    const pos = board([
      { row: 4, col: 3, owner: 'player1', id: 'P0' },
      { row: 4, col: 4, owner: 'player2', id: 'p0' },
      { row: 0, col: 5, owner: 'player1', id: 'P1' },
    ]);
    const after = moveTo(pos, { row: 0, col: 5 }, { row: 4, col: 5 });
    expect(idsOnBoard(after)).toEqual(['P0', 'P1']);
    // 取った駒は持ち駒にならない
    expect(after.hands.player1).toHaveLength(0);
  });

  it('並んだ相手の駒はまとめて取れる', () => {
    const pos = board([
      { row: 4, col: 2, owner: 'player1', id: 'P0' },
      { row: 4, col: 3, owner: 'player2', id: 'p0' },
      { row: 4, col: 4, owner: 'player2', id: 'p1' },
      { row: 4, col: 5, owner: 'player2', id: 'p2' },
      { row: 0, col: 6, owner: 'player1', id: 'P1' },
    ]);
    const after = moveTo(pos, { row: 0, col: 6 }, { row: 4, col: 6 });
    expect(idsOnBoard(after)).toEqual(['P0', 'P1']);
  });

  it('間に空マスがあれば取れない', () => {
    const pos = board([
      { row: 4, col: 2, owner: 'player1', id: 'P0' },
      { row: 4, col: 4, owner: 'player2', id: 'p0' },
      { row: 0, col: 5, owner: 'player1', id: 'P1' },
    ]);
    const after = moveTo(pos, { row: 0, col: 5 }, { row: 4, col: 5 });
    expect(idsOnBoard(after)).toEqual(['P0', 'P1', 'p0']);
  });

  it('盤の端は挟む役をしない (端に押し付けても取れない)', () => {
    const pos = board([
      { row: 4, col: 0, owner: 'player2', id: 'p0' },
      { row: 0, col: 1, owner: 'player1', id: 'P0' },
    ]);
    const after = moveTo(pos, { row: 0, col: 1 }, { row: 4, col: 1 });
    expect(idsOnBoard(after)).toContain('p0');
  });

  it('自分から挟まれる位置に入っても取られない', () => {
    const pos = board([
      { row: 4, col: 3, owner: 'player2', id: 'p0' },
      { row: 4, col: 5, owner: 'player2', id: 'p1' },
      { row: 0, col: 4, owner: 'player1', id: 'P0' },
    ]);
    const after = moveTo(pos, { row: 0, col: 4 }, { row: 4, col: 4 });
    expect(idsOnBoard(after)).toEqual(['P0', 'p0', 'p1']);
  });

  it('縦横は同時に見るが、閉じていない向きでは取らない', () => {
    // 横は自駒で閉じているので取れる。縦は先が空マスなので閉じていない
    const pos = board([
      { row: 4, col: 3, owner: 'player1', id: 'P0' },
      { row: 4, col: 4, owner: 'player2', id: 'p0' },
      { row: 3, col: 5, owner: 'player2', id: 'p1' },
      { row: 5, col: 5, owner: 'player1', id: 'P2' },
      { row: 0, col: 5, owner: 'player1', id: 'P1' },
    ]);
    const after = moveTo(pos, { row: 0, col: 5 }, { row: 4, col: 5 });
    // 横の p0 は取れる。縦の p1 は向こう側が空いているので残る
    expect(idsOnBoard(after)).toContain('p1');
    expect(idsOnBoard(after)).not.toContain('p0');
  });
});

describe('隅の囲み取り', () => {
  it('隅の駒は直交 2 マスを塞ぐと取れる', () => {
    const pos = board([
      { row: 0, col: 0, owner: 'player2', id: 'p0' },
      { row: 0, col: 1, owner: 'player1', id: 'P0' },
      { row: 4, col: 0, owner: 'player1', id: 'P1' },
    ]);
    const after = moveTo(pos, { row: 4, col: 0 }, { row: 1, col: 0 });
    expect(idsOnBoard(after)).toEqual(['P0', 'P1']);
  });

  it('片方だけでは取れない', () => {
    const pos = board([
      { row: 8, col: 8, owner: 'player2', id: 'p0' },
      { row: 4, col: 8, owner: 'player1', id: 'P0' },
    ]);
    const after = moveTo(pos, { row: 4, col: 8 }, { row: 7, col: 8 });
    expect(idsOnBoard(after)).toContain('p0');
  });
});

describe('盤の端がつながっているとき', () => {
  it('円筒では回り込んで挟める', () => {
    const pos = board(
      [
        { row: 4, col: 8, owner: 'player1', id: 'P0' },
        { row: 4, col: 0, owner: 'player2', id: 'p0' },
        { row: 0, col: 1, owner: 'player1', id: 'P1' },
      ],
      'player1',
      CYLINDER,
    );
    const after = moveTo(pos, { row: 0, col: 1 }, { row: 4, col: 1 });
    expect(idsOnBoard(after)).toEqual(['P0', 'P1']);
  });

  it('円筒では左右の端が無くなるので隅の囲み取りも成立しない', () => {
    const pos = board(
      [
        { row: 0, col: 0, owner: 'player2', id: 'p0' },
        { row: 0, col: 1, owner: 'player1', id: 'P0' },
        { row: 4, col: 0, owner: 'player1', id: 'P1' },
      ],
      'player1',
      CYLINDER,
    );
    const after = moveTo(pos, { row: 4, col: 0 }, { row: 1, col: 0 });
    expect(idsOnBoard(after)).toContain('p0');
  });

  it('完全トーラスで一周ぐるりと相手の駒しか無いときは取れない', () => {
    // 4 段目は自駒 1 枚 + 相手 8 枚。挟む相手側の駒が無いので閉じていない
    const placements = [{ row: 4, col: 0, owner: 'player1' as Player, id: 'P0' }];
    for (let col = 1; col < 9; col++) {
      placements.push({ row: 4, col, owner: 'player2' as Player, id: `p${col}` });
    }
    placements.push({ row: 0, col: 0, owner: 'player1' as Player, id: 'P1' });
    const pos = board(placements, 'player1', FULL_TORUS);
    // P1 を 4 段目から離れた位置へ動かしても、一周した先は自分自身なので取れない
    const after = moveTo(pos, { row: 0, col: 0 }, { row: 2, col: 0 });
    expect(countBoardPieces(after, 'player2')).toBe(8);
  });
});

describe('勝ち負け (全滅)', () => {
  it('相手の駒が 2 枚以下になったら負け', () => {
    const two = board([
      { row: 0, col: 0, owner: 'player2', id: 'p0' },
      { row: 0, col: 1, owner: 'player2', id: 'p1' },
      { row: 8, col: 0, owner: 'player1', id: 'P0' },
      { row: 8, col: 1, owner: 'player1', id: 'P1' },
      { row: 8, col: 2, owner: 'player1', id: 'P2' },
    ]);
    expect(annihilationLoser(hasami, two)).toBe('player2');

    const three = board([
      { row: 0, col: 0, owner: 'player2', id: 'p0' },
      { row: 0, col: 1, owner: 'player2', id: 'p1' },
      { row: 0, col: 2, owner: 'player2', id: 'p2' },
      { row: 8, col: 0, owner: 'player1', id: 'P0' },
      { row: 8, col: 1, owner: 'player1', id: 'P1' },
      { row: 8, col: 2, owner: 'player1', id: 'P2' },
    ]);
    expect(annihilationLoser(hasami, three)).toBeNull();
  });

  it('開始局面では決着していない', () => {
    expect(annihilationLoser(hasami, initPosition(hasami))).toBeNull();
  });
});

describe('本将棋には影響しない', () => {
  it('挟みの決まりを持たないので何も取られない', () => {
    const pos = initPosition(hondou);
    expect(sandwichCaptures(hondou, pos, { row: 6, col: 0 })).toEqual([]);
    expect(annihilationLoser(hondou, pos)).toBeNull();
  });

  it('開始局面の合法手の数は従来どおり 30 手', () => {
    expect(generateLegalMoves(hondou, initPosition(hondou))).toHaveLength(30);
  });
});
