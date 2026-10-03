/**
 * ★v2.02 打ち歩詰めを「打った結果、歩と確定する駒」にも広げる (ルールブック 7・2026-10-03 利用者判断)。
 *
 * 局面＝後手玉 1 一 (0,0)・先手の金 (2,0) が 1 二 (1,0) を支える・先手の香 (4,1) が 2 一 (0,1) を塞ぐ。
 * 先手の持ち駒 1 枚を 1 二 (1,0) へ打つと詰む。
 *   - 持ち駒が「歩・桂」→ 桂は 2 段目に置けないので打った瞬間に歩＝**打ち歩詰め＝打てない**
 *     (v2.01 までは打てて、打った直後に候補が空＝量子異常になっていた・2026-10-03 実測)
 *   - 持ち駒が「歩・金」→ 歩でなく金なら成り立つ＝**打てて、歩の候補が消えて金になる** (今までどおり)
 *   - 持ち駒が「歩・桂」でも王手にならない場所 (5 五) へは打てる
 */
import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { advancePosition } from '../../core/engine/position/advance';
import { buildInitialKindMap } from '../../core/engine/candidate-kinds';
import './index';

function find(pos: Position, owner: 'player1' | 'player2', kind: string): PieceInstance {
  for (const row of pos.board) for (const c of row) if (c && c.initialOwner === owner && c.initialKind === kind) return c;
  throw new Error(kind);
}

function build(partner: 'kei' | 'kin'): { pos: Position; dropId: string } {
  const src = initPosition(hondou);
  const gOu = find(src, 'player2', 'ou');
  const gFu = find(src, 'player2', 'fu');
  const gPartner = find(src, 'player2', partner);
  const sKin = find(src, 'player1', 'kin');
  const sKyo = find(src, 'player1', 'kyo');
  const sOu = find(src, 'player1', 'ou');
  const conf = (p: PieceInstance): PieceInstance => ({ ...p, candidates: new Set([p.pieceId]), confirmed: true });
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null));
  board[0][0] = conf(gOu);
  board[2][0] = conf(sKin);
  board[4][1] = conf(sKyo);
  board[8][8] = conf(sOu);
  const shared = new Set([gFu.pieceId, gPartner.pieceId]);
  const hand: PieceInstance = { ...gFu, owner: 'player1', kind: 'fu', candidates: shared, confirmed: false };
  // 相方 (同じ 2 つの身元を持つ後手の駒) は歩の元の筋に置く (歩の筋の縛り)
  board[5][gFu.initialSquare.col] = { ...gPartner, owner: 'player2', candidates: shared, confirmed: false };
  return { pos: { ...src, board, hands: { player1: [hand], player2: [] }, sideToMove: 'player1', history: [] }, dropId: hand.pieceId };
}

const dropTo = (pos: Position, id: string, row: number, col: number) =>
  generateLegalMoves(hondou, pos).find((m) => m.type === 'drop' && m.pieceId === id && m.to.row === row && m.to.col === col);

describe('打ち歩詰めの広がり (打った結果、歩と確定する駒)', () => {
  it('「歩・桂」を 2 段目に打って詰ませる手は打てない', () => {
    const { pos, dropId } = build('kei');
    expect(dropTo(pos, dropId, 1, 0)).toBeUndefined();
  });

  it('「歩・桂」でも王手にならない場所へは打てる (調べるのは王手になる打ちだけ)', () => {
    const { pos, dropId } = build('kei');
    expect(dropTo(pos, dropId, 4, 4)).toBeDefined();
  });

  it('「歩・金」を同じ所へ打って詰ませる手は打てて、歩の候補が消えて金になる (今までどおり)', () => {
    const { pos, dropId } = build('kin');
    const m = dropTo(pos, dropId, 1, 0);
    expect(m).toBeDefined();
    const r = advancePosition(hondou, pos, m!, { quantum: true });
    expect(r.anomaly).toBeNull();
    const km = buildInitialKindMap(r.position);
    expect([...r.position.board[1][0]!.candidates!].map((id) => km.get(id))).toEqual(['kin']);
  });
});
