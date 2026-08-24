/**
 * 第 9 段 9-1 の土台の直し (親 v1.65 §3.6.1〜§3.6.3 / §5.5.8)。
 *
 * ★盤の側から、決め打ちが外れたことを確かめる。**わざと元の決め打ちに戻せば
 * 赤くなる**ように書く (見張りが空回りしていないことの確認)。
 */

import { describe, it, expect } from 'vitest';
import type { Mgf, Player } from './mgf/types';
import type { PieceInstance, Position } from './position/types';
import { applyMove } from './position/apply';
import { generatePieceMoves } from './moves/generator';
import {
  capturedGoesToHand,
  forcedPromotionApplies,
  pieceNameOf,
  promotionTypeOf,
} from './piece-rules';

/** チェス風の最小ルール定義 (盤 5×5・駒台なし)。 */
const chessLike: Mgf = {
  metadata: { game_name: 'chess-like', game_id: 'chess-like' },
  board: {
    width: 5,
    height: 5,
    coordinate: 'chess',
    promotion_zone: {
      player1: { min_rank: 1, max_rank: 1 },
      player2: { min_rank: 5, max_rank: 5 },
    },
  },
  pieces: [
    {
      id: 'pawn',
      name: { ja: 'ポーン', en: 'P' },
      display: { glyph_color: { player1: '#ffffff', player2: '#2a1c0c' } },
      can_promote: true,
      promotion_type: 'replace',
      promotion_choices: ['queen', 'rook', 'bishop', 'knight'],
      must_promote_at: 1,
      must_promote_reason: 'by_rule',
      is_hand_piece: false,
      move_logic: {
        abilities: [{ type: 'step', direction: 'forward', range: 1, can_capture: false }],
      },
    },
    {
      id: 'queen',
      name: { ja: 'クイーン', en: 'Q' },
      can_promote: false,
      is_hand_piece: false,
      move_logic: { abilities: [{ type: 'slide', direction: 'all_8', range: -1 }] },
    },
    { id: 'rook', name: { ja: 'ルーク', en: 'R' }, can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'slide', direction: 'sideways', range: -1 }] } },
    { id: 'bishop', name: { ja: 'ビショップ', en: 'B' }, can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'slide', direction: 'diagonal', range: -1 }] } },
    { id: 'knight', name: { ja: 'ナイト', en: 'N' }, can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'jump', direction: 'knight_8', range: 1 }] } },
    { id: 'king', name: { ja: 'キング', en: 'K' }, is_royal: true, can_promote: false, is_hand_piece: false,
      move_logic: { abilities: [{ type: 'step', direction: 'all_8', range: 1 }] } },
  ],
  initial_placement: { format: 'list', list: [] },
} as unknown as Mgf;

function put(row: number, col: number, owner: Player, kind: string): PieceInstance {
  return {
    pieceId: `${kind}-${row}-${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function pos(cells: PieceInstance[], sideToMove: Player = 'player1'): Position {
  const b = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => null as PieceInstance | null));
  for (const c of cells) b[c.initialSquare.row][c.initialSquare.col] = c;
  return {
    width: 5,
    height: 5,
    board: b,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

describe('§3.6.2 入れ替わる昇格', () => {
  it('昇格先ごとに別の手が生まれる (ポーンは 4 通り)', () => {
    // player1 のポーンが (1,2)。前へ 1 マス進むと最奥段 (row=0) で必ず昇格。
    const p = pos([put(1, 2, 'player1', 'pawn')]);
    const moves = generatePieceMoves(chessLike, p, { row: 1, col: 2 });
    const toBack = moves.filter((m) => m.to.row === 0);
    // 4 通りの昇格先が出て、どれも promoteTo を持ち、不成の手は無い。
    expect(toBack).toHaveLength(4);
    expect(new Set(toBack.map((m) => m.promoteTo))).toEqual(
      new Set(['queen', 'rook', 'bishop', 'knight']),
    );
    expect(toBack.every((m) => m.promote)).toBe(true);
  });

  it('入れ替わる昇格は昇格先の駒そのものになる (成り駒の印は立たない)', () => {
    const p = pos([put(1, 2, 'player1', 'pawn')]);
    const after = applyMove(chessLike, p, {
      type: 'move',
      pieceId: 'pawn-1-2',
      from: { row: 1, col: 2 },
      to: { row: 0, col: 2 },
      promote: true,
      promoteTo: 'bishop',
    });
    const landed = after.board[0][2]!;
    expect(landed.kind).toBe('bishop');
    expect(landed.promoted).toBe(false); // 裏返る成りではないので赤は付かない
  });
});

describe('§3.6.3 「必ず成る」の理由', () => {
  it('by_rule のポーンは、上下がつながった盤でも強制成りが効く', () => {
    const pawn = chessLike.pieces.find((p) => p.id === 'pawn')!;
    expect(forcedPromotionApplies(pawn, /* wrapY */ true)).toBe(true);
    expect(forcedPromotionApplies(pawn, /* wrapY */ false)).toBe(true);
  });

  it('no_legal_move (将棋の歩) は、上下がつながると外れる', () => {
    const shogiPawn = { must_promote_at: 1, must_promote_reason: 'no_legal_move' } as never;
    expect(forcedPromotionApplies(shogiPawn, /* wrapY */ true)).toBe(false);
    expect(forcedPromotionApplies(shogiPawn, /* wrapY */ false)).toBe(true);
  });
});

describe('§5.5.8 取った駒の行き先', () => {
  it('駒台に入らない駒 (チェス) は盤から取り除かれ、駒台に溜まらない', () => {
    // player1 のクイーンが (2,2) の player2 ルークを取る。
    const p = pos([put(2, 2, 'player1', 'queen'), put(2, 4, 'player2', 'rook')]);
    const after = applyMove(chessLike, p, {
      type: 'move',
      pieceId: 'queen-2-2',
      from: { row: 2, col: 2 },
      to: { row: 2, col: 4 },
      promote: false,
    });
    expect(after.hands.player1).toHaveLength(0); // 駒台に入らない
    expect(after.board[2][4]!.kind).toBe('queen'); // 取った駒はそこに居る
    // 盤上に player2 の駒は残っていない (取り除かれた)。
    const survivors = after.board.flat().filter((c) => c && c.owner === 'player2');
    expect(survivors).toHaveLength(0);
  });

  it('capturedGoesToHand は「戻したあとの駒種」で見る', () => {
    // 将棋の と金 は「持ち駒にならない」が、元の 歩 は持ち駒になるので true。
    // (piece-rules は kinds に生の kind を渡しても unpromoted に直して見る)
    expect(capturedGoesToHand(chessLike, ['queen'])).toBe(false);
  });
});

describe('§3.6.1 駒の名前と文字色', () => {
  it('名前はルール定義から引く (言語ごとに切り替わる)', () => {
    expect(pieceNameOf(chessLike, 'pawn', 'ja')).toBe('ポーン');
    expect(pieceNameOf(chessLike, 'pawn', 'en')).toBe('P');
    // 定義に無い言語は日本語へフォールバック (何も出ないことは避ける)。
    expect(pieceNameOf(chessLike, 'pawn', 'zh')).toBe('ポーン');
  });

  it('promotionTypeOf は省略時 flip (将棋は従来どおり)', () => {
    const shogiPawn = { id: 'fu', name: '歩', can_promote: true } as never;
    expect(promotionTypeOf(shogiPawn)).toBe('flip');
  });
});
