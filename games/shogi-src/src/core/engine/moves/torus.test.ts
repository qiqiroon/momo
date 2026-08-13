import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { BoardTopology, PieceInstance, Position } from '../position/types';
import { generatePieceMoves } from './generator';
import { isInCheck } from './check';
import { isMoveLegal } from './legal';

/**
 * Phase 4 トーラス (親 §3.4) の、盤の座標そのものに関わる部分。
 *
 * ここで固定するのは「盤の端がつながっているときに何が変わり、何が変わらないか」。
 * 変わらない側 (円筒での縦方向・行き所のない駒) も一緒に押さえておかないと、
 * 回り込みを入れた拍子に平面のルールまで緩んだことに気づけない。
 *
 * モードの解釈と完全トーラス専用の追加制限は features/torus 側のテストで見る。
 */

const CYLINDER: BoardTopology = { wrapX: true, wrapY: false };
const FULL: BoardTopology = { wrapX: true, wrapY: true };

function emptyPos(topology?: BoardTopology): Position {
  return {
    width: 9,
    height: 9,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null)),
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
    ...(topology ? { topology } : {}),
  };
}

function piece(kind: string, owner: 'player1' | 'player2', id: string): PieceInstance {
  return {
    pieceId: id,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row: -1, col: -1 },
    promoted: false,
  };
}

function place(pos: Position, row: number, col: number, p: PieceInstance): Position {
  const board = pos.board.map((r) => r.slice());
  board[row][col] = p;
  return { ...pos, board };
}

function destinations(pos: Position, row: number, col: number): string[] {
  return generatePieceMoves(hondou, pos, { row, col })
    .map((m) => `${m.to.row},${m.to.col}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

describe('円筒 (左右だけつながる)', () => {
  it('左端の飛車が左へ出ると右端から入る', () => {
    // 右隣を自分の歩で塞ぐ。平面なら横へは 1 マスも動けない。
    // 右端 (4,8) へ届くのは左へ抜けて回り込んだときだけ。
    const build = (topology?: BoardTopology) => {
      const withRook = place(emptyPos(topology), 4, 0, piece('hi', 'player1', 'P1'));
      return place(withRook, 4, 1, piece('fu', 'player1', 'P2'));
    };
    const sideways = (pos: Position) => destinations(pos, 4, 0).filter((d) => d.startsWith('4,'));
    expect(sideways(build(CYLINDER))).toContain('4,8');
    expect(sideways(build())).toHaveLength(0);
  });

  it('一周しても出発マスには戻らない (走り駒の打ち切り)', () => {
    const pos = place(emptyPos(CYLINDER), 4, 0, piece('hi', 'player1', 'P1'));
    const sideways = destinations(pos, 4, 0).filter((d) => d.startsWith('4,'));
    expect(sideways).toHaveLength(8);
    expect(sideways).not.toContain('4,0');
  });

  it('端の玉は左右の反対側へも動ける (平面では 5 マス・円筒では 8 マス)', () => {
    const cyl = place(emptyPos(CYLINDER), 4, 0, piece('ou', 'player1', 'P1'));
    const plane = place(emptyPos(), 4, 0, piece('ou', 'player1', 'P1'));
    expect(destinations(cyl, 4, 0)).toHaveLength(8);
    expect(destinations(cyl, 4, 0)).toContain('4,8');
    expect(destinations(plane, 4, 0)).toHaveLength(5);
    expect(destinations(plane, 4, 0)).not.toContain('4,8');
  });

  it('上下は端のままなので、香車は盤の外へ抜けない', () => {
    const pos = place(emptyPos(CYLINDER), 0, 4, piece('kyo', 'player1', 'P1'));
    expect(destinations(pos, 0, 4)).toHaveLength(0);
  });

  it('斜めに走る角も回り込む', () => {
    const pos = place(emptyPos(CYLINDER), 4, 0, piece('kaku', 'player1', 'P1'));
    // 左上へ 1 歩 = 右端の 1 つ上の段
    expect(destinations(pos, 4, 0)).toContain('3,8');
  });

  it('回り込んだ利きでも王手になる', () => {
    let pos = place(emptyPos(CYLINDER), 4, 0, piece('hi', 'player2', 'p1'));
    pos = place(pos, 4, 8, piece('ou', 'player1', 'P1'));
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
  });

  it('自分の駒が回り込んだ先にあれば、そこで止まる', () => {
    let pos = place(emptyPos(CYLINDER), 4, 0, piece('hi', 'player1', 'P1'));
    pos = place(pos, 4, 8, piece('fu', 'player1', 'P2'));
    const sideways = destinations(pos, 4, 0).filter((d) => d.startsWith('4,'));
    expect(sideways).not.toContain('4,8');
    expect(sideways).toHaveLength(7);
  });

  it('縦は端があるので、行き所のない駒 (最奥への歩打ち) は従来どおり打てない', () => {
    const fu = piece('fu', 'player1', 'P1');
    const pos: Position = { ...emptyPos(CYLINDER), hands: { player1: [fu], player2: [] } };
    expect(isMoveLegal(hondou, pos, { type: 'drop', pieceId: 'P1', to: { row: 0, col: 4 } })).toBe(false);
  });
});

describe('完全トーラス (上下もつながる)', () => {
  it('上端の香車が上へ出ると下端から入る', () => {
    const pos = place(emptyPos(FULL), 0, 4, piece('kyo', 'player1', 'P1'));
    expect(destinations(pos, 0, 4)).toContain('8,4');
  });

  it('最奥でも行き所のない駒にならないので、歩を打てる', () => {
    const fu = piece('fu', 'player1', 'P1');
    const pos: Position = { ...emptyPos(FULL), hands: { player1: [fu], player2: [] } };
    expect(isMoveLegal(hondou, pos, { type: 'drop', pieceId: 'P1', to: { row: 0, col: 4 } })).toBe(true);
  });

  it('最奥へ動いても強制成りにならない (不成のまま指せる)', () => {
    const pos = place(emptyPos(FULL), 1, 4, piece('fu', 'player1', 'P1'));
    const moves = generatePieceMoves(hondou, pos, { row: 1, col: 4 });
    expect(moves.some((m) => m.to.row === 0 && !m.promote)).toBe(true);
  });
});

describe('つないでいない盤 (既定)', () => {
  it('上端の香車は盤の外へ抜けない', () => {
    const pos = place(emptyPos(), 0, 4, piece('kyo', 'player1', 'P1'));
    expect(destinations(pos, 0, 4)).toHaveLength(0);
  });

  it('最奥への歩打ちは打てない (従来どおり)', () => {
    const fu = piece('fu', 'player1', 'P1');
    const pos: Position = { ...emptyPos(), hands: { player1: [fu], player2: [] } };
    expect(isMoveLegal(hondou, pos, { type: 'drop', pieceId: 'P1', to: { row: 0, col: 4 } })).toBe(false);
  });
});

describe('対局開始局面', () => {
  it('端のつなぎ方を渡さなければ平面のまま (通常の将棋)', () => {
    expect(initPosition(hondou).topology).toBeUndefined();
  });

  it('円筒を渡すと局面が左右つながりを持つ', () => {
    expect(initPosition(hondou, CYLINDER).topology).toEqual(CYLINDER);
  });

  it('本将棋の初期配置 × 円筒: 香車の手は増えない (回り込みが縦へ漏れていない)', () => {
    const pos = initPosition(hondou, CYLINDER);
    expect(destinations(pos, 8, 0)).toEqual(['7,0']);
  });
});
