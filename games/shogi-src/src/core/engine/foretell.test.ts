import { describe, it, expect } from 'vitest';
import { hondou } from './mgf/loader';
import { initPosition } from './position/init';
import { quantumInit } from '../../features/quantum/init';
import { buildInitialKindMap } from './candidate-kinds';
import { foretellKindByDestination } from './foretell';
import type { PieceInstance, Position } from './position/types';

function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) =>
      ri === row ? r.map((cell, ci) => (ci === col ? piece : cell)) : r,
    ),
  };
}

function pidOfKind(pos: Position, kind: string): string {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === 'player1' && cell.initialKind === kind) return cell.pieceId;
    }
  }
  throw new Error(`no player1 piece with initialKind=${kind}`);
}

describe('core/engine/foretell (Phase 5-11 §4.3 移動先による駒種確定の予告)', () => {
  it('桂馬跳びの行き先は桂しか到達できないので「桂に決まる」と予告する', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);

    // 7 七 (board[6][2]) の未確定駒。候補は先手全 20 駒 = 8 駒種。
    const map = foretellKindByDestination(hondou, pos, { row: 6, col: 2 }, kindMap);

    // 桂馬跳び先 (2 段前 + 1 筋横) は桂だけが届く
    expect(map.get('4,1')).toBe('kei');
    expect(map.get('4,3')).toBe('kei');
  });

  it('斜め 2 マス以上の行き先は角しか到達できない', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);

    const map = foretellKindByDestination(hondou, pos, { row: 6, col: 2 }, kindMap);

    expect(map.get('4,0')).toBe('kaku');
  });

  it('複数の駒種が届く行き先は予告しない', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);

    const map = foretellKindByDestination(hondou, pos, { row: 6, col: 2 }, kindMap);

    // 真上 1 マスは歩・香・飛・金・銀・玉が届く
    expect(map.has('5,2')).toBe(false);
    // 真上 2 マスは香と飛の 2 種が届く
    expect(map.has('4,2')).toBe(false);
  });

  it('候補が 1 駒種に絞れている駒は予告しない (もう決まっている)', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][2]!;
    const staged = withBoardPiece(pos, 6, 2, {
      ...target,
      candidates: new Set([pidOfKind(pos, 'kei')]),
      confirmed: true,
    });
    const kindMap = buildInitialKindMap(staged);

    const map = foretellKindByDestination(hondou, staged, { row: 6, col: 2 }, kindMap);

    expect(map.size).toBe(0);
  });

  it('本将棋モード (候補集合なし) では空を返す', () => {
    const pos = initPosition(hondou);
    const kindMap = buildInitialKindMap(pos);

    const map = foretellKindByDestination(hondou, pos, { row: 6, col: 2 }, kindMap);

    expect(map.size).toBe(0);
  });

  it('空マスを指しても落ちない', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);

    const map = foretellKindByDestination(hondou, pos, { row: 4, col: 4 }, kindMap);

    expect(map.size).toBe(0);
  });
});
