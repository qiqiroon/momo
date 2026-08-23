import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { PieceInstance, Position } from '../position/types';
import { hasCandidateSets } from '../candidate-kinds';
import { listEnterZoneMajors } from './nyugyoku';

/**
 * 敵陣内の大駒の内訳 (★v1.86・量子分冊 v0.9 §Q21.7・付録D-3 v1.10 §3.4)。
 *
 * ここで固定したいのは 2 点。
 *   - **数えるのは §Q21.3 で 5 点として数えた駒と同じもの**＝点数と内訳が食い違わない
 *   - **名前を出せるのは姿が 1 つに決まっている駒だけ**＝候補が残っている駒を
 *     名前の側に混ぜない (混ぜると名札を正体として使うことになる)
 */

function buildPos(
  pieces: Array<{ row: number; col: number; piece: PieceInstance }>,
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

const P = (
  kind: string,
  owner: 'player1' | 'player2',
  candidates?: Set<string>,
  id?: string,
): PieceInstance => ({
  pieceId: id ?? `${owner}_${kind}_${candidates ? 'q' : 'n'}`,
  kind,
  owner,
  initialOwner: owner,
  initialKind: kind,
  initialSquare: { row: -1, col: -1 },
  promoted: false,
  ...(candidates ? { candidates } : {}),
});

describe('listEnterZoneMajors (敵陣内の大駒の内訳)', () => {
  it('初期局面では敵陣に自駒が居ないので 0 枚', () => {
    const pos = initPosition(hondou);
    expect(listEnterZoneMajors(hondou, pos, 'player1')).toEqual({ total: 0, byKind: [] });
  });

  it('敵陣内の飛と角を駒種ごとに数える (持ち駒は数えない＝敵陣「内」の話だから)', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 1, col: 2, piece: P('hi', 'player1') },
      { row: 2, col: 6, piece: P('kaku', 'player1') },
      { row: 2, col: 7, piece: P('fu', 'player1') },
      // 敵陣の外にある飛は数えない
      { row: 5, col: 0, piece: P('hi', 'player1') },
    ]);
    pos = { ...pos, hands: { player1: [P('kaku', 'player1')], player2: [] } };
    const got = listEnterZoneMajors(hondou, pos, 'player1');
    expect(got.total).toBe(2);
    // 並びは強さの降順 = 画面のほかの場所と同じ「王飛角金銀桂香歩」の順。
    expect(got.byKind).toEqual([
      { kind: 'hi', count: 1 },
      { kind: 'kaku', count: 1 },
    ]);
  });

  it('並び順は強さの降順で、局面の並べ方では変わらない', () => {
    const a = listEnterZoneMajors(
      hondou,
      buildPos([
        { row: 1, col: 0, piece: P('hi', 'player1') },
        { row: 1, col: 8, piece: P('kaku', 'player1') },
      ]),
      'player1',
    );
    const b = listEnterZoneMajors(
      hondou,
      buildPos([
        { row: 1, col: 0, piece: P('kaku', 'player1') },
        { row: 1, col: 8, piece: P('hi', 'player1') },
      ]),
      'player1',
    );
    expect(a.byKind.map((x) => x.kind)).toEqual(b.byKind.map((x) => x.kind));
  });

  it('★姿が決まっていない大駒は総数には入るが、名前の側には入らない (§Q21.7)', () => {
    // 候補が飛と角の 2 つ = 「すべて大駒」なので 5 点だが、どちらかは分からない。
    // 候補の中身は「初期 PieceID」なので、その身元の駒が局面に居る必要がある
    // (自陣に置く = 敵陣内の数には影響しない)。
    const pos = buildPos([
      { row: 8, col: 0, piece: P('hi', 'player1', undefined, 'q_hi') },
      { row: 8, col: 1, piece: P('kaku', 'player1', undefined, 'q_kaku') },
      { row: 1, col: 4, piece: P('hi', 'player1', new Set(['q_hi', 'q_kaku'])) },
    ]);
    const got = listEnterZoneMajors(hondou, pos, 'player1');
    expect(got.total).toBe(1);
    expect(got.byKind).toEqual([]);
  });

  it('候補に小駒が混ざっている駒は大駒として数えない (点数の 5 点条件と同じ)', () => {
    const pos = buildPos([
      { row: 8, col: 0, piece: P('hi', 'player1', undefined, 'q_hi') },
      { row: 8, col: 1, piece: P('fu', 'player1', undefined, 'q_fu') },
      { row: 1, col: 4, piece: P('hi', 'player1', new Set(['q_hi', 'q_fu'])) },
    ]);
    expect(listEnterZoneMajors(hondou, pos, 'player1').total).toBe(0);
  });
});

describe('hasCandidateSets (量子モードかどうか)', () => {
  it('通常将棋モードの初期局面は候補集合を持たない', () => {
    expect(hasCandidateSets(initPosition(hondou))).toBe(false);
  });

  it('盤上の駒が候補集合を持っていれば量子モード', () => {
    const pos = buildPos([
      { row: 8, col: 0, piece: P('hi', 'player1', undefined, 'q_hi') },
      { row: 1, col: 4, piece: P('hi', 'player1', new Set(['q_hi'])) },
    ]);
    expect(hasCandidateSets(pos)).toBe(true);
  });

  it('★持ち駒だけが候補集合を持つ場合も見落とさない', () => {
    const base = buildPos([{ row: 8, col: 4, piece: P('ou', 'player1') }]);
    const pos = {
      ...base,
      hands: { player1: [P('fu', 'player1', new Set(['q_fu']))], player2: [] },
    };
    expect(hasCandidateSets(pos)).toBe(true);
  });
});
