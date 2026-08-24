/**
 * 終局の「起こし方」を規定から読む (親 v1.65 §3.10.0・第 9 段 9-3a)。
 *
 * 意味論は変えず、**「誰が・いつ」の区分がデータに書かれて読まれる**ことを固定する。
 * あわせて、宣言に要る敵陣の駒数もルール定義から読む (以前は直書きだった)。
 */

import { describe, it, expect } from 'vitest';
import type { Mgf } from '../mgf/types';
import { hondou } from '../mgf/loader';
import { canProposeJishogi, requiredPieceCountOf } from './nyugyoku';
import type { PieceInstance, Position } from '../position/types';

const P = (kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance => ({
  pieceId: `${owner}_${kind}_${Math.abs(kind.length * 7)}`,
  kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row: -1, col: -1 }, promoted,
});

function buildPos(pieces: Array<{ row: number; col: number; piece: PieceInstance }>): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null));
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return { width: 9, height: 9, board, hands: { player1: [], player2: [] },
    sideToMove: 'player1', moveNumber: 1, history: [] };
}

/** 双方が入玉していて双方 24 点以上ある局面 (jishogi.test.ts と同じ組み立て)。 */
function bothEnteredPosition(): Position {
  const pieces: Array<{ row: number; col: number; piece: PieceInstance }> = [
    { row: 0, col: 0, piece: P('ou', 'player1') },
    { row: 8, col: 8, piece: P('ou', 'player2') },
  ];
  [1, 2, 3, 4, 5, 6, 7].forEach((col, i) => pieces.push({ row: 4, col, piece: P(i < 2 ? 'kin' : 'fu', 'player1') }));
  [1, 2, 3, 4, 5, 6, 7].forEach((col, i) => pieces.push({ row: 5, col, piece: P(i < 2 ? 'kin' : 'fu', 'player2') }));
  const pos = buildPos(pieces);
  return { ...pos, hands: {
    player1: [P('hi', 'player1'), P('hi', 'player1'), P('kaku', 'player1'), ...Array.from({ length: 6 }, () => P('fu', 'player1'))],
    player2: [P('kaku', 'player2'), P('kaku', 'player2'), P('hi', 'player2'), ...Array.from({ length: 6 }, () => P('fu', 'player2'))],
  } };
}

describe('§3.10.0 起こし方の欄', () => {
  it('本将棋の入玉宣言は「主張」、持将棋は「合意」と定義に書いてある', () => {
    expect(hondou.victory?.entering_king?.trigger).toBe('claim');
    expect(hondou.victory?.jishogi?.trigger).toBe('agree');
  });

  it('持将棋の提案は「合意」のときだけ出せる（起こし方を読んでいる）', () => {
    // ★空振りしない検査にする＝**合意なら true になる局面**で確かめる。初期局面だと
    //   点数条件で常に false になり、トリガを読んでいなくても緑になってしまう。
    const pos = bothEnteredPosition();
    expect(canProposeJishogi(hondou, pos)).toBe(true); // 合意（既定）＝出せる

    // 起こし方を「自動」に差し替えると、同じ局面でも出せなくなる（＝欄が読まれている証拠）。
    const notAgree: Mgf = {
      ...hondou,
      victory: {
        ...hondou.victory,
        jishogi: { ...hondou.victory!.jishogi, trigger: 'auto' },
      },
    };
    expect(canProposeJishogi(notAgree, pos)).toBe(false);
  });
});

describe('§5.5.8 宣言に要る敵陣の駒数', () => {
  it('本将棋は 10（定義から読む・既定と一致）', () => {
    expect(requiredPieceCountOf(hondou)).toBe(10);
  });

  it('ルール定義が別の枚数を書けば、それを読む', () => {
    const eight: Mgf = {
      ...hondou,
      victory: {
        ...hondou.victory,
        entering_king: { ...hondou.victory!.entering_king, required_piece_count: 8 },
      },
    };
    expect(requiredPieceCountOf(eight)).toBe(8);
  });

  it('欄が無ければ既定 10 にフォールバックする', () => {
    const noField: Mgf = {
      ...hondou,
      victory: {
        ...hondou.victory,
        entering_king: {
          enabled: true,
          zone: 'enemy_promotion',
          point_threshold: { player1: 28, player2: 27 },
        },
      },
    };
    expect(requiredPieceCountOf(noField)).toBe(10);
  });
});
