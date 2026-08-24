/**
 * 続けて起きる動きの並び (親 v1.65 §3.7.1・第 9 段 9-2)。
 *
 * 手の種類は増やさず、「動かす手」に並びを持たせる。これ 1 つで性質の違う 3 つ
 * ——キャスリング／アンパッサン／獅子の 2 回行動——が表せることを盤の側から確かめる。
 * 並びを持たない手が従来どおり動く (素通りする) ことも固定する。
 */

import { describe, it, expect } from 'vitest';
import type { Mgf, Player } from '../mgf/types';
import type { BoardMove, PieceInstance, Position } from './types';
import { applyMove } from './apply';

const mgf: Mgf = {
  metadata: { game_name: 'composite', game_id: 'composite' },
  board: { width: 5, height: 5, coordinate: 'chess' },
  pieces: [
    { id: 'king', name: 'K', is_royal: true, can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'step', direction: 'all_8', range: 1 }] } },
    { id: 'rook', name: 'R', can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'slide', direction: 'sideways', range: -1 }] } },
    { id: 'pawn', name: 'P', can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'step', direction: 'forward', range: 1 }] } },
    // 駒台を持つ将棋風の駒 (取ると持ち駒になるか、の違いを見るため)。
    { id: 'gold', name: 'G', can_promote: false, is_hand_piece: true,
      move_logic: { abilities: [{ type: 'step', direction: 'all_8', range: 1 }] } },
    { id: 'lion', name: '獅', can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'step', direction: 'all_8', range: 2 }] } },
  ],
  initial_placement: { format: 'list', list: [] },
} as unknown as Mgf;

function put(row: number, col: number, owner: Player, kind: string): PieceInstance {
  return { pieceId: `${kind}-${row}-${col}`, kind, owner, initialOwner: owner,
    initialKind: kind, initialSquare: { row, col }, promoted: false };
}

function pos(cells: PieceInstance[], sideToMove: Player = 'player1'): Position {
  const b = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => null as PieceInstance | null));
  for (const c of cells) b[c.initialSquare.row][c.initialSquare.col] = c;
  return { width: 5, height: 5, board: b, hands: { player1: [], player2: [] },
    sideToMove, moveNumber: 1, history: [] };
}

const at = (p: Position, r: number, c: number) => p.board[r][c];

describe('§3.7.1 続けて起きる動きの並び', () => {
  it('キャスリング＝王が動き、並びでルークもマスへ移る（1 手で 2 枚）', () => {
    // 王 (4,4)・ルーク (4,0)。王が (4,2) へ、ルークが (4,0) から (4,3) へ。
    const p = pos([put(4, 4, 'player1', 'king'), put(4, 0, 'player1', 'rook')]);
    const move: BoardMove = {
      type: 'move',
      pieceId: 'king-4-4',
      from: { row: 4, col: 4 },
      to: { row: 4, col: 2 },
      promote: false,
      extra_steps: [
        { pieceId: 'rook-4-0', from: { row: 4, col: 0 }, dest: { kind: 'square', square: { row: 4, col: 3 } } },
      ],
    };
    const after = applyMove(mgf, p, move);
    expect(at(after, 4, 2)?.pieceId).toBe('king-4-4');
    expect(at(after, 4, 3)?.pieceId).toBe('rook-4-0');
    expect(at(after, 4, 0)).toBeNull(); // ルークは元の場所から居なくなる
    expect(after.sideToMove).toBe('player2'); // 1 手として手番は 1 回だけ渡る
  });

  it('アンパッサン＝動いた先にいない駒を、並びの「取り除く」で取る', () => {
    // 先手ポーン (2,2) が斜め前 (1,3) へ。取られる後手ポーンは (2,3)＝進んだ先ではない。
    const p = pos([put(2, 2, 'player1', 'pawn'), put(2, 3, 'player2', 'pawn')]);
    const move: BoardMove = {
      type: 'move',
      pieceId: 'pawn-2-2',
      from: { row: 2, col: 2 },
      to: { row: 1, col: 3 },
      promote: false,
      extra_steps: [
        { pieceId: 'pawn-2-3', from: { row: 2, col: 3 }, dest: { kind: 'discard' } },
      ],
    };
    const after = applyMove(mgf, p, move);
    expect(at(after, 1, 3)?.pieceId).toBe('pawn-2-2');
    expect(at(after, 2, 3)).toBeNull(); // 取り除かれた
    // チェスの捕獲なので駒台には入らない。
    expect(after.hands.player1).toHaveLength(0);
    expect(after.hands.player2).toHaveLength(0);
  });

  it('獅子の 2 回行動＝同じ駒が並びにもう一度出て、続けて動く', () => {
    // 獅子 (2,2) が中間 (2,3) へ、そこから並びで (2,4) の相手金を取る。
    const p = pos([put(2, 2, 'player1', 'lion'), put(2, 4, 'player2', 'gold')]);
    const move: BoardMove = {
      type: 'move',
      pieceId: 'lion-2-2',
      from: { row: 2, col: 2 },
      to: { row: 2, col: 3 },
      promote: false,
      extra_steps: [
        { pieceId: 'lion-2-2', from: { row: 2, col: 3 }, dest: { kind: 'square', square: { row: 2, col: 4 } } },
      ],
    };
    const after = applyMove(mgf, p, move);
    expect(at(after, 2, 4)?.pieceId).toBe('lion-2-2'); // 2 回目の着地
    expect(at(after, 2, 3)).toBeNull();
    // 取った金は駒台を持つ駒なので持ち駒に入る (§5.5.8 の判定が並びの中でも効く)。
    expect(after.hands.player1.map((h) => h.kind)).toContain('gold');
  });

  it('並びを持たない手は従来どおり動く（素通り）', () => {
    const p = pos([put(2, 2, 'player1', 'pawn')]);
    const after = applyMove(mgf, p, {
      type: 'move', pieceId: 'pawn-2-2', from: { row: 2, col: 2 }, to: { row: 1, col: 2 }, promote: false,
    });
    expect(at(after, 1, 2)?.pieceId).toBe('pawn-2-2');
    expect(at(after, 2, 2)).toBeNull();
  });
});
