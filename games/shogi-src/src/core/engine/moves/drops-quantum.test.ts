import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { quantumInit } from '../../../features/quantum/init';
import { generateLegalMoves } from './legal';
import { generateDropMoves } from './drops';
import type { PieceId, PieceInstance, Position } from '../position/types';

/** 指定 initialOwner・initialKind の駒を 1 個探す。 */
function pieceOfKind(pos: Position, owner: 'player1' | 'player2', kind: string): PieceInstance {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === owner && cell.initialKind === kind) return cell;
    }
  }
  throw new Error(`no ${owner} piece with initialKind=${kind}`);
}

function pidOfKind(pos: Position, owner: 'player1' | 'player2', kind: string): PieceId {
  return pieceOfKind(pos, owner, kind).pieceId;
}

/** player1 の持ち駒として、指定候補を持つ駒を 1 枚足した Position を返す。 */
function withHandPiece(pos: Position, pieceId: string, candidates: PieceId[]): Position {
  const piece: PieceInstance = {
    pieceId,
    kind: 'fu', // 捕獲時に基本駒へ戻った記録上の駒種 (正体ではない)
    owner: 'player1',
    initialOwner: 'player2',
    initialKind: 'fu',
    initialSquare: { row: -1, col: -1 },
    promoted: false,
    candidates: new Set(candidates),
    confirmed: candidates.length === 1,
  };
  return { ...pos, hands: { ...pos.hands, player1: [...pos.hands.player1, piece] } };
}

/** 盤上の 1 マスを差し替える。 */
function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) =>
      ri === row ? r.map((c, ci) => (ci === col ? piece : c)) : r,
    ),
  };
}

function dropColumns(pos: Position): Set<number> {
  const cols = new Set<number>();
  for (const m of generateLegalMoves(hondou, pos)) {
    if (m.type === 'drop') cols.add(m.to.col);
  }
  return cols;
}

describe('打つ手の量子対応 (v1.09)', () => {
  it('歩以外の可能性を持つ持ち駒は、どの筋にも打てる', () => {
    const base = quantumInit(initPosition(hondou));
    // 相手から取った駒。歩の可能性も持つが、飛・角・金・銀・桂・香の可能性もある
    const candidates = [
      pidOfKind(base, 'player2', 'fu'),
      pidOfKind(base, 'player2', 'hi'),
      pidOfKind(base, 'player2', 'kaku'),
      pidOfKind(base, 'player2', 'kin'),
      pidOfKind(base, 'player2', 'gin'),
      pidOfKind(base, 'player2', 'kei'),
      pidOfKind(base, 'player2', 'kyo'),
    ];
    const pos = withHandPiece(base, 'HAND1', candidates);

    // 初期配置では各筋に「初期駒種が歩」の駒が居るが、どれも歩と確定していないので
    // 二歩で塞がれてはいけない。9 筋すべてに打てるはず。
    expect(dropColumns(pos)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('歩と確定した駒が居る筋でも、歩以外の可能性があれば打てる', () => {
    const base = quantumInit(initPosition(hondou));
    // 7 七 (board[6][2]) を「歩と確定」にする
    const target = base.board[6][2]!;
    const fuPid = pidOfKind(base, 'player1', 'fu');
    const staged = withBoardPiece(base, 6, 2, {
      ...target,
      candidates: new Set([fuPid]),
      confirmed: true,
    });
    const pos = withHandPiece(staged, 'HAND1', [
      pidOfKind(base, 'player2', 'fu'),
      pidOfKind(base, 'player2', 'kin'),
    ]);

    expect(dropColumns(pos).has(2)).toBe(true);
  });

  it('歩と確定した持ち駒は、歩と確定した駒が居る筋には打てない (二歩)', () => {
    const base = quantumInit(initPosition(hondou));
    const target = base.board[6][2]!;
    const myFuPid = pidOfKind(base, 'player1', 'fu');
    const staged = withBoardPiece(base, 6, 2, {
      ...target,
      candidates: new Set([myFuPid]),
      confirmed: true,
    });
    // 持ち駒側も歩と確定 (候補 1 個)
    const pos = withHandPiece(staged, 'HAND1', [pidOfKind(base, 'player2', 'fu')]);

    const cols = dropColumns(pos);
    expect(cols.has(2)).toBe(false);
    // 他の筋には歩と確定した駒が居ないので打てる
    expect(cols.has(3)).toBe(true);
  });

  it('候補の中身が違う持ち駒は、それぞれ別に打つ手が出る', () => {
    const base = quantumInit(initPosition(hondou));
    const withTwo = withHandPiece(
      withHandPiece(base, 'HAND1', [pidOfKind(base, 'player2', 'fu'), pidOfKind(base, 'player2', 'kin')]),
      'HAND2',
      [pidOfKind(base, 'player2', 'hi')],
    );

    const ids = new Set(generateDropMoves(hondou, withTwo).map((m) => m.pieceId));

    expect(ids).toEqual(new Set(['HAND1', 'HAND2']));
  });

  it('駒種の顔ぶれが同じでも身元が違う持ち駒は、それぞれ別に打つ手が出る (v1.16 ユーザー報告)', () => {
    const base = quantumInit(initPosition(hondou));
    const kin = pidOfKind(base, 'player2', 'kin');
    // 2 枚とも「金か歩」だが、担える歩の身元が違う (別の筋の歩)。駒種の顔ぶれは同じ。
    const fuA = pieceOfKind(base, 'player2', 'fu').pieceId;
    const fuB = base.board.flat().find(
      (c) => c && c.initialOwner === 'player2' && c.initialKind === 'fu' && c.pieceId !== fuA,
    )!.pieceId;
    const withTwo = withHandPiece(withHandPiece(base, 'HAND1', [kin, fuA]), 'HAND2', [kin, fuB]);

    const ids = new Set(generateDropMoves(hondou, withTwo).map((m) => m.pieceId));

    expect(ids).toEqual(new Set(['HAND1', 'HAND2']));
  });

  it('本将棋モードは従来どおり: 自分の歩が居る筋には歩を打てない', () => {
    const base = initPosition(hondou);
    const goteFu = pieceOfKind(base, 'player2', 'fu');
    const pos: Position = {
      ...base,
      hands: {
        ...base.hands,
        player1: [{ ...goteFu, owner: 'player1', kind: 'fu', initialSquare: { row: -1, col: -1 } }],
      },
    };

    // 初期配置は全 9 筋に自分の歩が居るので、歩を打てる筋は 1 つも無い
    expect(dropColumns(pos).size).toBe(0);
  });
});
