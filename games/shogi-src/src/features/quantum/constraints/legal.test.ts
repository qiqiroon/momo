import { describe, it, expect } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import type { PieceInstance, Position } from '../../../core/engine/position/types';
import { makeQuantumContext } from '../candidate-update';
import { buildInitialInfoMap } from '../piece-lookup';
import {
  c101ActionPossibility,
  c103Nifu,
  c104DeadZone,
  c105ForcedPromotion,
  c109UnpromotableExclusion,
} from './legal';

/**
 * PieceID ベースのテスト補助。position に「初期 kind K で initialSquare (row0, col0) の
 * 参照駒」を持ち駒として置き、その pieceId を返す。制約が pid → initialKind を resolve
 * するときにその参照駒経由で K が返る。
 */
function makeRefPiece(pieceId: string, initialKind: string, owner: 'player1' | 'player2', initialCol: number = 4): PieceInstance {
  return {
    pieceId, kind: initialKind, owner, initialOwner: owner,
    initialKind, initialSquare: { row: owner === 'player1' ? 6 : 2, col: initialCol },
    promoted: false,
  };
}

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

/**
 * 「参照駒 7 枚 (P_fu, P_kyo, P_kei, P_gin, P_kin, P_kaku, P_hi, P_ou)」を持ち駒に置いて、
 * 各 initialKind を PieceID として resolve できる position を作る。
 */
function makeQuantumPosWithRefs(quantumPiece: PieceInstance, quantumSquare: { row: number; col: number }): Position {
  let pos = withPieceAt(emptyPos(), quantumSquare.row, quantumSquare.col, quantumPiece);
  const refs = [
    makeRefPiece('P_ref_fu', 'fu', 'player1', 2),
    makeRefPiece('P_ref_kyo', 'kyo', 'player1', 0),
    makeRefPiece('P_ref_kei', 'kei', 'player1', 1),
    makeRefPiece('P_ref_gin', 'gin', 'player1', 6),
    makeRefPiece('P_ref_kin', 'kin', 'player1', 3),
    makeRefPiece('P_ref_kaku', 'kaku', 'player1', 1),
    makeRefPiece('P_ref_hi', 'hi', 'player1', 7),
    makeRefPiece('P_ref_ou', 'ou', 'player1', 4),
  ];
  pos = { ...pos, hands: { ...pos.hands, player1: refs } };
  return pos;
}

function candidatesForAll8Kinds(): Set<string> {
  return new Set([
    'P_ref_fu', 'P_ref_kyo', 'P_ref_kei', 'P_ref_gin',
    'P_ref_kin', 'P_ref_kaku', 'P_ref_hi', 'P_ref_ou',
  ]);
}

function makeSentePiece(overrides: Partial<PieceInstance> = {}): PieceInstance {
  return {
    pieceId: 'P',
    kind: 'fu',
    owner: 'player1',
    initialOwner: 'player1',
    initialKind: 'fu',
    initialSquare: { row: -1, col: -1 },
    promoted: false,
    candidates: candidatesForAll8Kinds(),
    confirmed: false,
    ...overrides,
  };
}

describe('C-101 行動可能性 (§Q7 移動履歴依存)', () => {
  it('直近の指し手が斜め前 1: fu/kyo/kei/hi は説明不能で除外、gin/kin/kaku/ou は残る', () => {
    const piece = makeSentePiece({ pieceId: 'P_diag' });
    let pos = makeQuantumPosWithRefs(piece, { row: 5, col: 6 });
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_diag', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 6 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kyo')).toBe(false);
    expect(result.has('P_ref_kei')).toBe(false);
    expect(result.has('P_ref_hi')).toBe(false);
    expect(result.has('P_ref_gin')).toBe(true);
    expect(result.has('P_ref_kin')).toBe(true);
    expect(result.has('P_ref_kaku')).toBe(true);
    expect(result.has('P_ref_ou')).toBe(true);
  });

  it('直近の指し手が前 1 (真上): fu/kyo/gin/kin/hi/ou は残るが kei/kaku は除外', () => {
    const piece = makeSentePiece({ pieceId: 'P_fwd' });
    let pos = makeQuantumPosWithRefs(piece, { row: 5, col: 4 });
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_fwd', from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(true);
    expect(result.has('P_ref_kyo')).toBe(true);
    expect(result.has('P_ref_kei')).toBe(false);
    expect(result.has('P_ref_gin')).toBe(true);
    expect(result.has('P_ref_kin')).toBe(true);
    expect(result.has('P_ref_kaku')).toBe(false);
    expect(result.has('P_ref_hi')).toBe(true);
    expect(result.has('P_ref_ou')).toBe(true);
  });

  it('直近の指し手が桂馬ジャンプ (前2 横1): kei のみ残る', () => {
    const piece = makeSentePiece({ pieceId: 'P_kei' });
    let pos = makeQuantumPosWithRefs(piece, { row: 5, col: 6 });
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_kei', from: { row: 7, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 6 } }, pos, hondou, ctx);
    expect(result.has('P_ref_kei')).toBe(true);
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kyo')).toBe(false);
    expect(result.has('P_ref_gin')).toBe(false);
    expect(result.has('P_ref_kin')).toBe(false);
    expect(result.has('P_ref_kaku')).toBe(false);
    expect(result.has('P_ref_hi')).toBe(false);
    expect(result.has('P_ref_ou')).toBe(false);
  });

  it('動いていない駒は candidates を触らない', () => {
    const mover = makeSentePiece({ pieceId: 'P_mover' });
    const still = makeSentePiece({ pieceId: 'P_still' });
    let pos = makeQuantumPosWithRefs(mover, { row: 5, col: 6 });
    pos = withPieceAt(pos, 8, 7, still);
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_mover', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(still, { kind: 'board', square: { row: 8, col: 7 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });

  it('持ち駒はこの制約で狭まらない', () => {
    const piece = makeSentePiece({ pieceId: 'H1' });
    let pos = makeQuantumPosWithRefs(piece, { row: 0, col: 0 });
    // 上の pos で盤に置かれた piece は退避させる
    pos = { ...pos, board: emptyPos().board };
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'H1', from: { row: 6, col: 7 }, to: { row: 5, col: 6 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'hand', owner: 'player1', index: 0 }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });

  it('history が空 (初手前): 全候補残る', () => {
    const piece = makeSentePiece({ pieceId: 'P_new' });
    const pos = makeQuantumPosWithRefs(piece, { row: 5, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 5, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });

  it('前 4 マススライドで成った駒: kyo と hi 両方残る (成る前の姿で移動 → unpromoted で判定)', () => {
    // v1.01 バグ: piece.promoted のみで判定すると narikyo は 4 マススライド不可 → kyo 除外
    // 正しくは lastMove.promote=true なら move 中は未成 → unpromoted kyo で判定 → 残る
    const piece = makeSentePiece({
      pieceId: 'P_prom',
      kind: 'to', // 成って「と」になった (表示 kind は無関係だが仕様として)
      promoted: true,
    });
    let pos = makeQuantumPosWithRefs(piece, { row: 2, col: 8 });
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_prom', from: { row: 6, col: 8 }, to: { row: 2, col: 8 }, promote: true }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 2, col: 8 } }, pos, hondou, ctx);
    // 未成の kyo と hi は前 4 マススライド可能 → 残る
    expect(result.has('P_ref_kyo')).toBe(true);
    expect(result.has('P_ref_hi')).toBe(true);
    // 1 マスしか動けない駒は除外
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kei')).toBe(false);
    expect(result.has('P_ref_gin')).toBe(false);
    expect(result.has('P_ref_kin')).toBe(false);
    expect(result.has('P_ref_kaku')).toBe(false);
    expect(result.has('P_ref_ou')).toBe(false);
  });

  it('前 4 マススライドで既成の駒 (ryu が動いた): 未成 hi のみでなく、成 promoted_id 判定を通ることを確認', () => {
    // move.promote=false かつ piece.promoted=true = 元から成り駒 → promoted_id (ryu) で判定
    // ryu は前後左右 slide + 斜め 1 → 前 4 マススライドは説明可能 → hi 残る
    // 一方 kyo は narikyo (成香) で 1 マスしか動けない → 除外されるべき
    const piece = makeSentePiece({
      pieceId: 'P_already',
      kind: 'ryu',
      promoted: true,
    });
    let pos = makeQuantumPosWithRefs(piece, { row: 2, col: 8 });
    pos = {
      ...pos,
      history: [{ type: 'move', pieceId: 'P_already', from: { row: 6, col: 8 }, to: { row: 2, col: 8 }, promote: false }],
    };
    const ctx = makeQuantumContext(pos);
    const result = c101ActionPossibility(piece, { kind: 'board', square: { row: 2, col: 8 } }, pos, hondou, ctx);
    // 既に成っていた駒の move → promoted_id で判定
    // ryu (hi の成り) は前 4 マススライド可 → hi 残る
    expect(result.has('P_ref_hi')).toBe(true);
    // narikyo (kyo の成り) は 1 マス step のみ → kyo 除外
    expect(result.has('P_ref_kyo')).toBe(false);
  });
});

describe('C-103 二歩', () => {
  it('同筋に自初期陣の確定 fu が居ると候補から fu 除外', () => {
    // (6,4) に fu 確定の駒、(4,4) に候補 有の駒
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1',
      initialKind: 'fu', initialSquare: { row: 6, col: 4 }, promoted: false,
      candidates: new Set(['P_fix']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = makeQuantumPosWithRefs(q, { row: 4, col: 4 });
    pos = withPieceAt(pos, 6, 4, fixed);
    const ctx = makeQuantumContext(pos);
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kyo')).toBe(true);
    expect(result.has('P_ref_hi')).toBe(true);
  });

  it('異なる筋 (col) には二歩制約が働かない', () => {
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1',
      initialKind: 'fu', initialSquare: { row: 6, col: 3 }, promoted: false,
      candidates: new Set(['P_fix']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = makeQuantumPosWithRefs(q, { row: 4, col: 4 });
    pos = withPieceAt(pos, 6, 3, fixed);
    const ctx = makeQuantumContext(pos);
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(true);
  });

  it('相手 (異なる初期陣営) の fu なら二歩制約は働かない', () => {
    const enemyFu: PieceInstance = {
      pieceId: 'P_e', kind: 'fu', owner: 'player2', initialOwner: 'player2',
      initialKind: 'fu', initialSquare: { row: 2, col: 4 }, promoted: false,
      candidates: new Set(['P_e']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = makeQuantumPosWithRefs(q, { row: 6, col: 4 });
    pos = withPieceAt(pos, 2, 4, enemyFu);
    const ctx = makeQuantumContext(pos);
    const result = c103Nifu(q, { kind: 'board', square: { row: 6, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(true);
  });

  it('torus ON の時は二歩制約が発火しない', () => {
    const fixed: PieceInstance = {
      pieceId: 'P_fix', kind: 'fu', owner: 'player1', initialOwner: 'player1',
      initialKind: 'fu', initialSquare: { row: 6, col: 4 }, promoted: false,
      candidates: new Set(['P_fix']), confirmed: true,
    };
    const q = makeSentePiece({ pieceId: 'P_q' });
    let pos = makeQuantumPosWithRefs(q, { row: 4, col: 4 });
    pos = withPieceAt(pos, 6, 4, fixed);
    const infoMap = buildInitialInfoMap(pos);
    const result = c103Nifu(q, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, { torusMode: 'cylinder', infoMap });
    expect(result.has('P_ref_fu')).toBe(true);
  });
});

describe('C-104 行き所のない駒', () => {
  it('sente 歩を row=0 (敵陣最奥) に置くと fu/kyo/kei 除外', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 0, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kyo')).toBe(false);
    expect(result.has('P_ref_kei')).toBe(false);
  });

  it('sente 桂を row=1 (rank 2) に置くと kei 除外 (fu/kyo は残る)', () => {
    const piece = makeSentePiece({ pieceId: 'P_kei' });
    const pos = makeQuantumPosWithRefs(piece, { row: 1, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 1, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_kei')).toBe(false);
    expect(result.has('P_ref_fu')).toBe(true);
    expect(result.has('P_ref_kyo')).toBe(true);
  });

  it('中央 row=4 col=4: 全候補残る', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });

  it('torus ON の時は dead zone 制約が発火しない', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 0, col: 4 });
    const infoMap = buildInitialInfoMap(pos);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, { torusMode: 'full', infoMap });
    expect(result.size).toBe(8);
  });

  it('promoted=true の駒は dead zone 対象外', () => {
    const piece = makeSentePiece({ kind: 'to', promoted: true });
    const pos = makeQuantumPosWithRefs(piece, { row: 0, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c104DeadZone(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });
});

describe('C-105 強制成り', () => {
  it('sente 歩 row=0 で不成: fu/kyo/kei は除外', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 0, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_fu')).toBe(false);
    expect(result.has('P_ref_kyo')).toBe(false);
    expect(result.has('P_ref_kei')).toBe(false);
    expect(result.has('P_ref_ou')).toBe(true);
    expect(result.has('P_ref_kin')).toBe(true);
    expect(result.has('P_ref_gin')).toBe(true);
  });

  it('中央 row=4: 全候補残る', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });

  it('promoted=true なら C-105 は発火しない', () => {
    const piece = makeSentePiece({ kind: 'to', promoted: true });
    const pos = makeQuantumPosWithRefs(piece, { row: 0, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c105ForcedPromotion(piece, { kind: 'board', square: { row: 0, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
  });
});

describe('c109UnpromotableExclusion (Phase 5-10 追補・§Q8.4 拡張)', () => {
  it('promoted=false なら候補変化なし', () => {
    const piece = makeSentePiece();
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c109UnpromotableExclusion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(8);
    expect(result.has('P_ref_ou')).toBe(true);
    expect(result.has('P_ref_kin')).toBe(true);
  });

  it('promoted=true なら ou と kin (can_promote=false な initialKind) を候補から除外', () => {
    const piece = makeSentePiece({ kind: 'to', promoted: true });
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c109UnpromotableExclusion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.has('P_ref_ou')).toBe(false);
    expect(result.has('P_ref_kin')).toBe(false);
    // 成れる駒種の候補は保持 (fu/kyo/kei/gin/kaku/hi の 6 個)
    expect(result.has('P_ref_fu')).toBe(true);
    expect(result.has('P_ref_kyo')).toBe(true);
    expect(result.has('P_ref_kei')).toBe(true);
    expect(result.has('P_ref_gin')).toBe(true);
    expect(result.has('P_ref_kaku')).toBe(true);
    expect(result.has('P_ref_hi')).toBe(true);
    expect(result.size).toBe(6);
  });

  it('通常将棋モード (candidates=undefined) は空 Set を返す (縮退互換)', () => {
    const piece: PieceInstance = {
      pieceId: 'P', kind: 'to', owner: 'player1', initialOwner: 'player1',
      initialKind: 'fu', initialSquare: { row: 6, col: 4 }, promoted: true,
    };
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c109UnpromotableExclusion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(0);
  });

  it('promoted=true でも候補に ou/kin が無ければ変化なし', () => {
    const piece = makeSentePiece({
      kind: 'to',
      promoted: true,
      candidates: new Set(['P_ref_fu', 'P_ref_kyo', 'P_ref_hi']),
    });
    const pos = makeQuantumPosWithRefs(piece, { row: 4, col: 4 });
    const ctx = makeQuantumContext(pos);
    const result = c109UnpromotableExclusion(piece, { kind: 'board', square: { row: 4, col: 4 } }, pos, hondou, ctx);
    expect(result.size).toBe(3);
    expect(result.has('P_ref_fu')).toBe(true);
    expect(result.has('P_ref_kyo')).toBe(true);
    expect(result.has('P_ref_hi')).toBe(true);
  });
});
