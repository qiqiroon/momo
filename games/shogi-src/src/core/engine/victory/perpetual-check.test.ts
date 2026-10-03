/**
 * ★v2.02 連続王手の千日手 (親 §4.4・ルール定義 `on_check_repetition: 'loss'`)。
 *
 * 同じ局面が 4 回現れたとき、**その局面が最初に現れてから一方の手がすべて王手**なら
 * 王手をかけ続けた側の負け。そうでなければ今までどおり引き分け (千日手)。
 * 2026-10-03 までは `loss` と書いてあるのに実装が読まず、連続王手でも引き分けだった。
 *
 * 対局の記憶 (game-store) を通して、実際に手を指して確かめる。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, winnerOf } from '../../store/game-store';
import { hondou } from '../mgf/loader';
import { isInCheck } from '../moves/check';
import { perpetualChecker } from './repetition';
import { positionHash } from '../position/hash';
import type { PieceInstance, Position, Square } from '../position/types';

function pc(id: string, kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}

/** 後手玉 (0,0)・先手玉 (8,8)・先手の飛車 rook・後手の金 gold (後手が王手をかける局面用)。 */
function start(rook: Square, extra: PieceInstance[] = [], side: 'player1' | 'player2' = 'player1'): Position {
  const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  board[0][0] = pc('k', 'ou', 'player2', 0, 0);
  board[8][8] = pc('K', 'ou', 'player1', 8, 8);
  board[rook.row][rook.col] = pc('R', 'hi', 'player1', rook.row, rook.col);
  for (const p of extra) board[p.initialSquare.row][p.initialSquare.col] = p;
  return { width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove: side, moveNumber: 1, history: [] };
}

function play(from: Square, to: Square): void {
  const s = useGameStore.getState();
  s.selectSquare(from);
  useGameStore.getState().tryMove(to);
}

function setup(pos: Position): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  // 差し込んだ最初の局面も 1 回目として数える (対局の始めと同じ)。
  useGameStore.setState({ position: pos, positionCounts: { [positionHash(pos)]: 1 }, positionHistory: [], positionCountsHistory: [] } as never);
}

describe('連続王手の千日手', () => {
  beforeEach(() => setup(start({ row: 5, col: 1 })));

  it('先手が王手をかけ続けて同じ局面が 4 回＝先手の負け', () => {
    // 先手の飛車が 1 筋⇄2 筋で王手、後手玉が (0,0)⇄(0,1) で逃げる、を繰り返す。
    // 飛車 (5,1)→(5,0) で 1 筋に王手／玉 (0,0)→(0,1)／飛車 (5,0)→(5,1) で 2 筋に王手／玉 (0,1)→(0,0)。
    for (let round = 0; round < 3; round++) {
      play({ row: 5, col: 1 }, { row: 5, col: 0 });
      play({ row: 0, col: 0 }, { row: 0, col: 1 });
      play({ row: 5, col: 0 }, { row: 5, col: 1 });
      expect(useGameStore.getState().status).toBe('playing');
      play({ row: 0, col: 1 }, { row: 0, col: 0 });
    }
    const s = useGameStore.getState();
    expect(s.status).toBe('perpetual_check_loss_p1');
    expect(winnerOf(s.status, s.position.sideToMove)).toBe('player2');
  });

  it('繰り返しに入る前の王手でない手は数えない (その局面が最初に現れてからの手だけを見る)', () => {
    // 後手玉を (1,0)・飛車を (5,6) に置いて始め、王手でない 1 往復で繰り返しの局面に入る。
    const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
    board[1][0] = pc('k', 'ou', 'player2', 1, 0);
    board[8][8] = pc('K', 'ou', 'player1', 8, 8);
    board[5][6] = pc('R', 'hi', 'player1', 5, 6);
    setup({ width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove: 'player1', moveNumber: 1, history: [] });
    play({ row: 5, col: 6 }, { row: 5, col: 1 }); // 王手でない
    play({ row: 1, col: 0 }, { row: 0, col: 0 }); // ここで繰り返しの局面に入る (1 回目)
    for (let round = 0; round < 3; round++) {
      play({ row: 5, col: 1 }, { row: 5, col: 0 });
      play({ row: 0, col: 0 }, { row: 0, col: 1 });
      play({ row: 5, col: 0 }, { row: 5, col: 1 });
      play({ row: 0, col: 1 }, { row: 0, col: 0 });
    }
    expect(useGameStore.getState().status).toBe('perpetual_check_loss_p1');
  });

  it('王手でない手の繰り返しは今までどおり引き分け (千日手)', () => {
    setup(start({ row: 5, col: 5 }));
    for (let round = 0; round < 3; round++) {
      play({ row: 5, col: 5 }, { row: 5, col: 6 });
      play({ row: 0, col: 0 }, { row: 1, col: 0 });
      play({ row: 5, col: 6 }, { row: 5, col: 5 });
      play({ row: 1, col: 0 }, { row: 0, col: 0 });
    }
    expect(useGameStore.getState().status).toBe('sennichite');
  });

  it('途中に王手でない手が 1 つでも混ざれば引き分け', () => {
    // 1 周目だけ王手でない手 (飛車 (5,1)→(5,2)→(5,1)) を混ぜた並びを、遡って調べる部品で直接見る。
    // 王手の回だけで 4 回目に届く並びではないので、千日手の判定に混ざる手まで見ることを確かめる。
    const p0 = start({ row: 5, col: 1 });
    const seq: Position[] = [p0];
    const move = (pos: Position, from: Square, to: Square): Position => {
      const board = pos.board.map((r) => r.slice());
      board[to.row][to.col] = board[from.row][from.col];
      board[from.row][from.col] = null;
      return { ...pos, board, sideToMove: pos.sideToMove === 'player1' ? 'player2' : 'player1' };
    };
    let p = p0;
    p = move(p, { row: 5, col: 1 }, { row: 5, col: 2 }); seq.push(p); // 王手でない
    p = move(p, { row: 0, col: 0 }, { row: 1, col: 0 }); seq.push(p);
    p = move(p, { row: 5, col: 2 }, { row: 5, col: 1 }); seq.push(p); // 王手でない (2 筋に玉は居ない)
    p = move(p, { row: 1, col: 0 }, { row: 0, col: 0 }); // p0 と同じ局面に戻る
    expect(perpetualChecker(hondou, seq, p, isInCheck)).toBeNull();
  });

  it('後手が王手をかけ続ければ後手の負け (向きを取り違えない)', () => {
    // 盤を上下入れ替え: 先手玉 (8,8) を後手の飛車が 9 筋⇄8 筋で追う。
    const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
    board[8][8] = pc('K', 'ou', 'player1', 8, 8);
    board[0][0] = pc('k', 'ou', 'player2', 0, 0);
    board[3][7] = pc('r', 'hi', 'player2', 3, 7);
    setup({ width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove: 'player2', moveNumber: 1, history: [] });
    for (let round = 0; round < 3; round++) {
      play({ row: 3, col: 7 }, { row: 3, col: 8 });
      play({ row: 8, col: 8 }, { row: 8, col: 7 });
      play({ row: 3, col: 8 }, { row: 3, col: 7 });
      play({ row: 8, col: 7 }, { row: 8, col: 8 });
    }
    expect(useGameStore.getState().status).toBe('perpetual_check_loss_p2');
  });

  it('ルール定義が loss でなければ、連続王手でも引き分け', () => {
    useGameStore.setState({ mgf: { ...hondou, repetition: { ...hondou.repetition, on_check_repetition: 'none' } } } as never);
    for (let round = 0; round < 3; round++) {
      play({ row: 5, col: 1 }, { row: 5, col: 0 });
      play({ row: 0, col: 0 }, { row: 0, col: 1 });
      play({ row: 5, col: 0 }, { row: 5, col: 1 });
      play({ row: 0, col: 1 }, { row: 0, col: 0 });
    }
    expect(useGameStore.getState().status).toBe('sennichite');
  });
});
