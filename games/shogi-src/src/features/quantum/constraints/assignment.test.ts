import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import { register, clear } from '../../../core/plugin/registry';
import type { Player } from '../../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../../core/engine/position/types';
import { candidateUpdate } from '../candidate-update';
import { buildInitialInfoMap } from '../piece-lookup';
import { quantumInit } from '../init';
import { basicConstraints } from './basic';
import { legalConstraints } from './legal';
import { propagationConstraints } from './propagation';
import { c303AssignmentConsistency } from './assignment';

/** 元の所属 side・初期駒種 kind の身元 (PieceID) 一覧。 */
function idsOfKind(pos: Position, side: Player, kind: string): PieceId[] {
  return Array.from(buildInitialInfoMap(pos).values())
    .filter((i) => i.initialOwner === side && i.initialKind === kind)
    .map((i) => i.pieceId)
    .sort();
}

/** 指定 pieceId の駒の候補を差し替えた新しい Position を返す (盤上・持ち駒とも対象)。 */
function withCandidates(pos: Position, pieceId: PieceId, ids: PieceId[]): Position {
  const swap = (p: PieceInstance): PieceInstance =>
    p.pieceId === pieceId ? { ...p, candidates: new Set(ids) } : p;
  return {
    ...pos,
    board: pos.board.map((row) => row.map((cell) => (cell ? swap(cell) : null))),
    hands: {
      player1: pos.hands.player1.map(swap),
      player2: pos.hands.player2.map(swap),
    },
  };
}

/** 盤上・持ち駒から pieceId の駒を探す。 */
function findPiece(pos: Position, pieceId: PieceId): PieceInstance {
  for (const row of pos.board) {
    for (const cell of row) if (cell && cell.pieceId === pieceId) return cell;
  }
  for (const p of pos.hands.player1) if (p.pieceId === pieceId) return p;
  for (const p of pos.hands.player2) if (p.pieceId === pieceId) return p;
  throw new Error(`piece not found: ${pieceId}`);
}

/** C-303 を 1 駒に適用した結果。location は本制約では参照されないのでダミーでよい。 */
function allowedFor(pos: Position, pieceId: PieceId): Set<PieceId> {
  const piece = findPiece(pos, pieceId);
  return new Set(
    c303AssignmentConsistency(
      piece,
      { kind: 'board', square: piece.initialSquare },
      pos,
      hondou,
      { torusMode: 'none', infoMap: buildInitialInfoMap(pos) },
    ),
  );
}

/** 盤上の駒を取って side の持ち駒へ移した Position (元の所属は変えない)。 */
function captureToHand(pos: Position, pieceId: PieceId, captor: Player): Position {
  const piece = findPiece(pos, pieceId);
  const board = pos.board.map((row) =>
    row.map((cell) => (cell && cell.pieceId === pieceId ? null : cell)),
  );
  const taken: PieceInstance = { ...piece, owner: captor, promoted: false };
  return {
    ...pos,
    board,
    hands: {
      player1: captor === 'player1' ? [...pos.hands.player1, taken] : pos.hands.player1,
      player2: captor === 'player2' ? [...pos.hands.player2, taken] : pos.hands.player2,
    },
  };
}

describe('C-303 割り当て整合 (単体)', () => {
  it('初期配置では 1 つも候補を削らない (最初の 3 枚を飛車・香車と決めつけない)', () => {
    const pos = quantumInit(initPosition(hondou));
    // 全駒が自陣営 20 個すべてを候補に持つ = どの候補も「不可能」ではない
    for (const row of pos.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(allowedFor(pos, cell.pieceId).size).toBe(20);
      }
    }
  });

  it('長距離直進を見せた駒が 3 枚になると、4 枚目から飛車・香車の可能性が消える', () => {
    let pos = quantumInit(initPosition(hondou));
    const hi = idsOfKind(pos, 'player1', 'hi');
    const kyo = idsOfKind(pos, 'player1', 'kyo');
    const longIds = [...hi, ...kyo];
    expect(longIds).toHaveLength(3); // 飛車 1 + 香車 2

    // 3 枚が長距離直進を見せた状態 (候補が飛車・香車だけに狭まっている) を作る
    const movers = [pos.board[6][0]!, pos.board[6][1]!, pos.board[6][2]!].map((p) => p.pieceId);
    for (const id of movers) pos = withCandidates(pos, id, longIds);

    // 4 枚目 (まだ全候補を持つ駒) からは飛車・香車の 3 個が消える
    const other = pos.board[6][3]!.pieceId;
    const allowed = allowedFor(pos, other);
    for (const id of longIds) expect(allowed.has(id)).toBe(false);
    expect(allowed.size).toBe(17);

    // 3 枚のほうは「どれが飛車か」を決めつけない = 3 個のまま
    for (const id of movers) expect(allowedFor(pos, id).size).toBe(3);
  });

  it('2 枚しか狭まっていなければ何も消さない (3 個の身元を 2 枚では使い切れない)', () => {
    let pos = quantumInit(initPosition(hondou));
    const longIds = [...idsOfKind(pos, 'player1', 'hi'), ...idsOfKind(pos, 'player1', 'kyo')];
    for (const id of [pos.board[6][0]!.pieceId, pos.board[6][1]!.pieceId]) {
      pos = withCandidates(pos, id, longIds);
    }
    expect(allowedFor(pos, pos.board[6][3]!.pieceId).size).toBe(20);
  });

  it('取られて相手の持ち駒になっていても、元の所属で数える', () => {
    let pos = quantumInit(initPosition(hondou));
    const longIds = [...idsOfKind(pos, 'player1', 'hi'), ...idsOfKind(pos, 'player1', 'kyo')];
    const movers = [pos.board[6][0]!, pos.board[6][1]!, pos.board[6][2]!].map((p) => p.pieceId);
    for (const id of movers) pos = withCandidates(pos, id, longIds);
    // 3 枚のうち 1 枚を後手が取って持ち駒にする (元の所属は player1 のまま)
    pos = captureToHand(pos, movers[2], 'player2');
    expect(findPiece(pos, movers[2]).owner).toBe('player2');
    expect(findPiece(pos, movers[2]).initialOwner).toBe('player1');

    const allowed = allowedFor(pos, pos.board[6][3]!.pieceId);
    for (const id of longIds) expect(allowed.has(id)).toBe(false);
  });

  it('元後手側の駒は元先手側の絞り込みに影響されない (20 枚ずつ独立に数える)', () => {
    let pos = quantumInit(initPosition(hondou));
    const longIds = [...idsOfKind(pos, 'player1', 'hi'), ...idsOfKind(pos, 'player1', 'kyo')];
    for (const p of [pos.board[6][0]!, pos.board[6][1]!, pos.board[6][2]!]) {
      pos = withCandidates(pos, p.pieceId, longIds);
    }
    // 後手の駒 (row 2 の歩) は 20 個のまま
    expect(allowedFor(pos, pos.board[2][0]!.pieceId).size).toBe(20);
  });

  it('身元が 1 個に確定した駒があれば、他の駒からその身元が消える (C-107 相当も包含)', () => {
    let pos = quantumInit(initPosition(hondou));
    const hi = idsOfKind(pos, 'player1', 'hi')[0];
    const confirmed = pos.board[6][0]!.pieceId;
    pos = withCandidates(pos, confirmed, [hi]);
    expect(allowedFor(pos, pos.board[6][1]!.pieceId).has(hi)).toBe(false);
  });

  it('どう並べ替えても割り当てられない局面では候補を空にする (異常状態の検出)', () => {
    let pos = quantumInit(initPosition(hondou));
    const hi = idsOfKind(pos, 'player1', 'hi')[0];
    // 2 枚とも「飛車で確定」= 飛車は 1 枚しかないので矛盾
    pos = withCandidates(pos, pos.board[6][0]!.pieceId, [hi]);
    pos = withCandidates(pos, pos.board[6][1]!.pieceId, [hi]);
    const sizes = [
      allowedFor(pos, pos.board[6][0]!.pieceId).size,
      allowedFor(pos, pos.board[6][1]!.pieceId).size,
    ];
    expect(Math.min(...sizes)).toBe(0);
  });
});

describe('C-303 割り当て整合 (統合・候補更新の反復経由)', () => {
  afterEach(() => {
    clear();
  });

  it('候補更新を通しても 4 枚目から飛車・香車が消え、初期配置では何も消えない', () => {
    register('quantum:constraints', [
      ...basicConstraints,
      ...legalConstraints,
      ...propagationConstraints,
    ]);

    let pos = quantumInit(initPosition(hondou));
    const longIds = [...idsOfKind(pos, 'player1', 'hi'), ...idsOfKind(pos, 'player1', 'kyo')];
    for (const p of [pos.board[6][0]!, pos.board[6][1]!, pos.board[6][2]!]) {
      pos = withCandidates(pos, p.pieceId, longIds);
    }

    const after = candidateUpdate(pos, hondou);
    const other = after.board[6][3]!;
    for (const id of longIds) expect(other.candidates!.has(id)).toBe(false);
    // 3 枚はどれが飛車か決まらないまま
    for (const p of [after.board[6][0]!, after.board[6][1]!, after.board[6][2]!]) {
      expect(p.candidates!.size).toBe(3);
      expect(p.confirmed).toBe(false);
    }
  });

  it('初期配置に候補更新をかけても、C-303 は 1 つも候補を削らない', () => {
    register('quantum:constraints', [...basicConstraints, ...propagationConstraints]);
    const pos = quantumInit(initPosition(hondou));
    const after = candidateUpdate(pos, hondou);
    // C-108 (歩の筋の保存) だけが効くので、飛車・香車の身元はどの駒からも消えない
    const longIds = [...idsOfKind(pos, 'player1', 'hi'), ...idsOfKind(pos, 'player1', 'kyo')];
    for (const id of longIds) {
      const carriers = after.board
        .flat()
        .filter((c): c is PieceInstance => !!c && c.initialOwner === 'player1')
        .filter((c) => c.candidates!.has(id));
      expect(carriers.length).toBe(20);
    }
  });
});
