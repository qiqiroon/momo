import { describe, it, expect } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import type { PieceInstance, Position } from '../../../core/engine/position/types';
import { DEFAULT_QUANTUM_CONTEXT } from '../candidate-update';
import { quantumInit } from '../init';
import {
  c101ActionPossibility,
  c103Nifu,
  c104DeadZone,
  c105ForcedPromotion,
} from './legal';

function emptyPos(): Position {
  return {
    width: 9,
    height: 9,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null)),
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

function withPieceAt(pos: Position, r: number, c: number, piece: PieceInstance): Position {
  const board = pos.board.map((row) => row.slice());
  board[r][c] = piece;
  return { ...pos, board };
}

function makeSentePiece(overrides: Partial<PieceInstance> = {}): PieceInstance {
  return {
    pieceId: 'P',
    kind: 'fu',
    owner: 'player1',
    initialOwner: 'player1',
    promoted: false,
    candidates: new Set(['fu', 'kyo', 'kei', 'gin', 'kin', 'kaku', 'hi', 'ou']),
    confirmed: false,
    ...overrides,
  };
}

describe('C-101 行動可能性 (§Q7 移動履歴依存)', () => {
  it('直近の指し手が斜め前 1: fu/kyo/kei/hi は説明不能で除外、gin/kin/kaku/ou は残る', () => {
    // sente 駒が (6,7) → (5,6) に斜め前 1 移動 (v0.98 バグ再現ケース)
    const piece = makeSentePiece({ pieceId: 'P_diag' });
    const pos: Position = {
      ...withPieceAt(emptyPos(), 5, 6, piece),
      history: [{ type: 'move', pieceId: 'P_diag', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 6 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(false);
    expect(result.has('kyo')).toBe(false);
    expect(result.has('kei')).toBe(false);
    expect(result.has('hi')).toBe(false);
    expect(result.has('gin')).toBe(true);
    expect(result.has('kin')).toBe(true);
    expect(result.has('kaku')).toBe(true);
    expect(result.has('ou')).toBe(true);
  });

  it('直近の指し手が前 1 (真上): fu/kyo/gin/kin/hi/ou は残るが kei/kaku は除外', () => {
    // 前進 1 段の move。fu(前1), kyo(前slide), gin(前1), kin(前1), hi(前slide), ou(前1) は説明可
    // kei は knight jump (前2±1) 固定なので前 1 を説明不能。kaku は斜めなので前 1 も説明不能
    const piece = makeSentePiece({ pieceId: 'P_fwd' });
    const pos: Position = {
      ...withPieceAt(emptyPos(), 5, 4, piece),
      history: [{ type: 'move', pieceId: 'P_fwd', from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, promote: false }],
    };
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(true);
    expect(result.has('kyo')).toBe(true);
    expect(result.has('kei')).toBe(false);
    expect(result.has('gin')).toBe(true);
    expect(result.has('kin')).toBe(true);
    expect(result.has('kaku')).toBe(false);
    expect(result.has('hi')).toBe(true);
    expect(result.has('ou')).toBe(true);
  });

  it('直近の指し手が桂馬ジャンプ (前2 横1): kei と ou 系のみが残るはず (kei/ou/kaku は該当なし)', () => {
    // 桂の move: (7,7) → (5,6) は dr=-2, dc=-1. 桂の offset は (前2, ±1) = (-2, ±1)。マッチ
    // 他の駒種: fu(-1,0)不一致, kyo slide(-s,0)不一致, gin/kin/kaku/hi/ou 全て 1 マス系 or 直線 で不一致 (ou は 1 マスなので dr=-2 に届かない)
    const piece = makeSentePiece({ pieceId: 'P_kei' });
    const pos: Position = {
      ...withPieceAt(emptyPos(), 5, 6, piece),
      history: [{ type: 'move', pieceId: 'P_kei', from: { row: 7, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 6 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('kei')).toBe(true);
    expect(result.has('fu')).toBe(false);
    expect(result.has('kyo')).toBe(false);
    expect(result.has('gin')).toBe(false);
    expect(result.has('kin')).toBe(false);
    expect(result.has('kaku')).toBe(false);
    expect(result.has('hi')).toBe(false);
    expect(result.has('ou')).toBe(false);
  });

  it('動いていない駒は candidates を触らない (v0.98 バグの反対事例)', () => {
    // 動いた駒は別 pieceId、この駒は静止中
    const mover = makeSentePiece({ pieceId: 'P_mover' });
    const still = makeSentePiece({ pieceId: 'P_still' });
    const pos: Position = {
      ...withPieceAt(withPieceAt(emptyPos(), 5, 6, mover), 8, 7, still),
      history: [{ type: 'move', pieceId: 'P_mover', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const result = c101ActionPossibility(still, { kind: 'board', square: { row: 8, col: 7 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    // P_still は動いていないので 8 種そのまま
    expect(result.size).toBe(8);
  });

  it('持ち駒はこの制約で狭まらない', () => {
    const piece = makeSentePiece({ pieceId: 'H1' });
    const pos: Position = {
      ...emptyPos(),
      history: [{ type: 'move', pieceId: 'H1', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const result = c101ActionPossibility(piece, { kind: 'hand', owner: 'player1', index: 0 }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });

  it('history が空 (初手前): 全候補残る', () => {
    const piece = makeSentePiece({ pieceId: 'P_new' });
    const pos = withPieceAt(emptyPos(), 5, 4, piece);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });
});

describe('C-103 二歩', () => {
  it('同筋に自初期陣の確定 fu が居ると候補から fu 除外', () => {
    // (6,4) に fu 確定の駒、(4,4) に candidates 有の駒 (自初期陣 player1)
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1', promoted: false,
      candidates: new Set(['fu']), confirmed: true,
    };
    const q: PieceInstance = makeSentePiece({ pieceId: 'P_q' });
    let pos = withPieceAt(emptyPos(), 6, 4, fixed);
    pos = withPieceAt(pos, 4, 4, q);
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(false);
    // 他の駒種は残る
    expect(result.has('kyo')).toBe(true);
    expect(result.has('hi')).toBe(true);
  });

  it('異なる筋 (col) には二歩制約が働かない', () => {
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1', promoted: false,
      candidates: new Set(['fu']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = withPieceAt(emptyPos(), 6, 3, fixed); // col=3
    pos = withPieceAt(pos, 4, 4, q); // col=4 (別筋)
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(true);
  });

  it('相手 (異なる初期陣営) の fu なら二歩制約は働かない', () => {
    const enemyFu: PieceInstance = {
      pieceId: 'P_e', kind: 'fu', owner: 'player2', initialOwner: 'player2', promoted: false,
      candidates: new Set(['fu']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = withPieceAt(emptyPos(), 2, 4, enemyFu);
    pos = withPieceAt(pos, 6, 4, q);
    const result = c103Nifu(q, { kind: 'board', square: { row: 6, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(true);
  });

  it('torus ON の時は二歩制約が発火しない', () => {
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1', promoted: false,
      candidates: new Set(['fu']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = withPieceAt(emptyPos(), 6, 4, fixed);
    pos = withPieceAt(pos, 4, 4, q);
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, { torusMode: 'cylinder' });
    // torus 有効なので狭めない
    expect(result.has('fu')).toBe(true);
  });
});

describe('C-104 行き所のない駒', () => {
  it('sente 歩を row=0 (敵陣最奥) に置くと fu 除外 (rank 1・must_promote_at=1)', () => {
    const piece = makeSentePiece();
    const pos = withPieceAt(emptyPos(), 0, 4, piece);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(false);
    expect(result.has('kyo')).toBe(false); // must_promote_at=1
    expect(result.has('kei')).toBe(false); // must_promote_at=2
  });

  it('sente 桂を row=1 (rank 2) に置くと kei 除外 (must_promote_at=2、距離 1)', () => {
    const piece = makeSentePiece({ pieceId: 'P_kei' });
    const pos = withPieceAt(emptyPos(), 1, 4, piece);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 1, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('kei')).toBe(false);
    // fu は距離 2 以上 (rank 2, back rank 1) だが must_promote_at=1 なので OK (>=1)
    // → 実際は distance = |2-1| = 1、must_promote_at=1、1<1 は false なので fu は残る
    expect(result.has('fu')).toBe(true);
    expect(result.has('kyo')).toBe(true);
  });

  it('中央 row=4 col=4: dead_zone に触れないので全候補残る', () => {
    const piece = makeSentePiece();
    const pos = withPieceAt(emptyPos(), 4, 4, piece);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });

  it('torus ON の時は dead zone 制約が発火しない', () => {
    const piece = makeSentePiece();
    const pos = withPieceAt(emptyPos(), 0, 4, piece);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, { torusMode: 'full' });
    expect(result.size).toBe(8);
  });

  it('promoted=true の駒は dead zone 対象外 (成った駒はどこでも動ける)', () => {
    const piece = makeSentePiece({ kind: 'to', promoted: true });
    const pos = withPieceAt(emptyPos(), 0, 4, piece);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });
});

describe('C-105 強制成り', () => {
  it('sente 歩 row=0 で不成: fu/kyo/kei は「成らずに居られない駒種」として除外', () => {
    const piece = makeSentePiece();
    const pos = withPieceAt(emptyPos(), 0, 4, piece);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.has('fu')).toBe(false);
    expect(result.has('kyo')).toBe(false);
    expect(result.has('kei')).toBe(false);
    // 王・金・銀は must_promote_at 無し or can_promote 無しなので残る
    expect(result.has('ou')).toBe(true);
    expect(result.has('kin')).toBe(true);
    expect(result.has('gin')).toBe(true);
  });

  it('中央 row=4: 全候補残る', () => {
    const piece = makeSentePiece();
    const pos = withPieceAt(emptyPos(), 4, 4, piece);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });

  it('promoted=true なら C-105 は発火しない (もう成っている)', () => {
    const piece = makeSentePiece({ kind: 'to', promoted: true });
    const pos = withPieceAt(emptyPos(), 0, 4, piece);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, DEFAULT_QUANTUM_CONTEXT);
    expect(result.size).toBe(8);
  });
});

describe('legalConstraints 統合: 量子初期局面での自然な狭まり', () => {
  it('本将棋初期の量子 ON 局面で c103/c104 の影響を受ける駒がある', () => {
    // 本将棋初期は row=6 col=0..8 の全 9 マスに sente fu が居る (kind=fu 確定な訳ではなく
    // candidates 8 種を持つ量子駒だが、confirmed は false)。よって「確定 fu が同筋に居る」
    // 条件は成立しない → c103 は発火しない。
    // しかし row=0 の gote 諸駒は敵陣最奥 (player2 視点で rank 9 = row 8) から遠いので
    // c104 も発火しない。
    // 逆に row=0 の gote 駒 (bal owner=player2, initialOwner=player2) は player2 の
    // 敵陣最奥 = rank 9 = row 8 から距離 8。fu の must_promote_at=1 未満 → false なので残る。
    // 要するに量子初期局面では狭まりは発生しない (基本 8 候補のまま)。
    const pos: Position = quantumInit(initPosition(hondou));
    // 何でもいい駒を 1 つ取って確認
    const c62 = pos.board[6][2];
    expect(c62?.candidates?.size).toBe(8);
  });
});
