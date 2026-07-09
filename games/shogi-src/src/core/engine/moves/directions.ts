import type { MgfDirection, Player } from '../mgf/types';

export interface Offset {
  drow: number;
  dcol: number;
}

/**
 * MgfDirection を (drow, dcol) の配列に変換。
 * "forward" は player1 (sente, 盤下端) 視点で row -1、player2 (gote, 盤上端) 視点で row +1。
 */
export function directionOffsets(direction: MgfDirection, player: Player): Offset[] {
  const forward = player === 'player1' ? -1 : 1;
  const backward = -forward;

  switch (direction) {
    case 'forward':
      return [{ drow: forward, dcol: 0 }];
    case 'backward':
      return [{ drow: backward, dcol: 0 }];
    case 'sideways':
      return [
        { drow: 0, dcol: -1 },
        { drow: 0, dcol: 1 },
      ];
    case 'forward_diagonal':
      return [
        { drow: forward, dcol: -1 },
        { drow: forward, dcol: 1 },
      ];
    case 'backward_diagonal':
      return [
        { drow: backward, dcol: -1 },
        { drow: backward, dcol: 1 },
      ];
    case 'diagonal':
      return [
        { drow: forward, dcol: -1 },
        { drow: forward, dcol: 1 },
        { drow: backward, dcol: -1 },
        { drow: backward, dcol: 1 },
      ];
    case 'all_8':
      return [
        { drow: -1, dcol: -1 },
        { drow: -1, dcol: 0 },
        { drow: -1, dcol: 1 },
        { drow: 0, dcol: -1 },
        { drow: 0, dcol: 1 },
        { drow: 1, dcol: -1 },
        { drow: 1, dcol: 0 },
        { drow: 1, dcol: 1 },
      ];
    case 'knight':
      return [
        { drow: forward * 2, dcol: -1 },
        { drow: forward * 2, dcol: 1 },
      ];
    case 'knight_8':
      return [
        { drow: -2, dcol: -1 },
        { drow: -2, dcol: 1 },
        { drow: 2, dcol: -1 },
        { drow: 2, dcol: 1 },
        { drow: -1, dcol: -2 },
        { drow: -1, dcol: 2 },
        { drow: 1, dcol: -2 },
        { drow: 1, dcol: 2 },
      ];
  }
}
