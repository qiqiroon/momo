import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { quantumInit } from '../../../features/quantum/init';
import { candidateUpdate } from '../../../features/quantum/candidate-update';
import '../../../features/quantum';
import { applyMove } from '../position/apply';
import { generateLegalMoves } from './legal';
import type { PieceId, PieceInstance, Position } from '../position/types';

/**
 * 二歩まわりの判定 (v1.15・ユーザー指摘)。
 *
 * 対局開始時と同じ「絞り込みを 1 回通した局面」を土台にする。この 1 回で
 * 「歩は成らない限り筋を移れない」が効き、各筋の歩の身元はその筋の駒だけが
 * 担える状態になる (＝どちらかは必ず歩)。
 */
function startedPosition(): Position {
  return candidateUpdate(quantumInit(initPosition(hondou)), hondou);
}

/** 指定 initialOwner・initialKind・初期筋の駒の身元 (PieceID) を探す。 */
function identityOf(pos: Position, owner: 'player1' | 'player2', kind: string, col?: number): PieceId {
  const all = [...pos.board.flat(), ...pos.hands.player1, ...pos.hands.player2];
  for (const cell of all) {
    if (!cell || cell.initialOwner !== owner || cell.initialKind !== kind) continue;
    if (col !== undefined && cell.initialSquare.col !== col) continue;
    return cell.pieceId;
  }
  throw new Error(`no ${owner}/${kind} identity`);
}

/**
 * player1 の持ち駒を 1 枚足す (相手から取ってきた駒＝初期陣営は player2)。
 *
 * 取ってきた以上、後手の盤上の駒は 1 枚減っていなければならない。片側の駒の枚数と
 * 身元の個数は必ず一致する (C-303 割り当て整合) ので、足すだけだと後手が 21 枚になり
 * 実際の対局では起こらない矛盾した局面になる。よって盤から 1 枚取り除いてから足す。
 * 取り除くのは 2 筋の歩 (同じ筋に後手の駒がまだ 2 枚残るので、身元の担い手が 1 枚に
 * なって別の確定が誘発されることがない)。
 */
function withHandPiece(pos: Position, pieceId: string, candidates: PieceId[]): Position {
  const board = pos.board.map((r) => r.slice());
  board[2][1] = null;
  pos = { ...pos, board };
  const piece: PieceInstance = {
    pieceId,
    kind: 'fu',
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

/** その筋の先手の駒を後手が全部取った状態にする (筋から先手の歩が消える)。 */
function captureFile(pos: Position, col: number): Position {
  const board = pos.board.map((r) => r.slice());
  const taken: PieceInstance[] = [];
  for (let row = 0; row < pos.height; row++) {
    const cell = board[row][col];
    if (cell && cell.owner === 'player1') {
      taken.push({ ...cell, owner: 'player2' });
      board[row][col] = null;
    }
  }
  return { ...pos, board, hands: { ...pos.hands, player2: [...pos.hands.player2, ...taken] } };
}

function dropColumnsOf(pos: Position, pieceId: string): Set<number> {
  const cols = new Set<number>();
  for (const m of generateLegalMoves(hondou, pos)) {
    if (m.type === 'drop' && m.pieceId === pieceId) cols.add(m.to.col);
  }
  return cols;
}

describe('二歩の判定 (v1.15)', () => {
  it('開始直後はどの筋も「どちらかは必ず歩」なので、歩と確定した持ち駒はどこにも打てない', () => {
    const base = startedPosition();
    const pos = withHandPiece(base, 'HAND1', [identityOf(base, 'player2', 'fu')]);

    expect(dropColumnsOf(pos, 'HAND1')).toEqual(new Set());
  });

  it('その筋の駒が居なくなれば、歩と確定した持ち駒を打てる', () => {
    const base = captureFile(startedPosition(), 3);
    const pos = withHandPiece(base, 'HAND1', [identityOf(base, 'player2', 'fu')]);

    // 空いた 1 筋だけが打てる。他の筋は「どちらかは必ず歩」のまま。
    expect(dropColumnsOf(pos, 'HAND1')).toEqual(new Set([3]));
  });

  it('二歩はいま持っている陣営で数える (相手の歩が居ても打てる)', () => {
    const cleared = captureFile(startedPosition(), 3);
    // 3 筋に残っているのは後手の駒。そのうち 1 枚を「歩と確定」にする。
    const goteFu = identityOf(cleared, 'player2', 'fu', 3);
    const board = cleared.board.map((r) => r.slice());
    for (let row = 0; row < cleared.height; row++) {
      const cell = board[row][3];
      if (cell && cell.owner === 'player2') {
        board[row][3] = { ...cell, candidates: new Set([goteFu]), confirmed: true };
        break;
      }
    }
    const pos = withHandPiece({ ...cleared, board }, 'HAND1', [identityOf(cleared, 'player2', 'fu', 0)]);

    // 相手 (後手) の歩は自分の二歩には関係しないので打てる
    expect(dropColumnsOf(pos, 'HAND1').has(3)).toBe(true);
  });

  it('自分の歩と確定した駒が居る筋には打てない', () => {
    const cleared = captureFile(startedPosition(), 3);
    // 空いた 3 筋に、自分 (先手) の歩と確定した駒を 1 枚置く
    const senteFu = identityOf(cleared, 'player1', 'fu', 3);
    const sample = cleared.board[6][4]!;
    const board = cleared.board.map((r) => r.slice());
    board[5][3] = { ...sample, candidates: new Set([senteFu]), confirmed: true };
    const pos = withHandPiece({ ...cleared, board }, 'HAND1', [identityOf(cleared, 'player2', 'fu', 0)]);

    expect(dropColumnsOf(pos, 'HAND1').has(3)).toBe(false);
  });

  it('歩の可能性があるだけの持ち駒は打ててよく、打った後に歩の可能性が外れる', () => {
    const base = startedPosition();
    const fu = identityOf(base, 'player2', 'fu');
    const kin = identityOf(base, 'player2', 'kin');
    const pos = withHandPiece(base, 'HAND1', [fu, kin]);

    // 「どちらかは必ず歩」の筋でも、金の可能性があるので打てる
    expect(dropColumnsOf(pos, 'HAND1').has(4)).toBe(true);

    const after = candidateUpdate(
      applyMove(hondou, pos, { type: 'drop', pieceId: 'HAND1', to: { row: 4, col: 4 } }),
      hondou,
    );
    const dropped = after.board[4][4]!;
    expect(dropped.candidates!.has(fu)).toBe(false);
    expect(dropped.candidates!.has(kin)).toBe(true);
  });

  it('取った歩は元の筋を離れて打てる (打った後に候補が空にならない)', () => {
    const base = captureFile(startedPosition(), 3);
    // 5 筋生まれの後手の歩。3 筋に打つ = 元の筋ではない。
    const goteFuAt4 = identityOf(base, 'player2', 'fu', 4);
    const pos = withHandPiece(base, 'HAND1', [goteFuAt4]);

    expect(dropColumnsOf(pos, 'HAND1').has(3)).toBe(true);

    const after = candidateUpdate(
      applyMove(hondou, pos, { type: 'drop', pieceId: 'HAND1', to: { row: 4, col: 3 } }),
      hondou,
    );
    expect(after.board[4][3]!.candidates!.has(goteFuAt4)).toBe(true);
  });
});
