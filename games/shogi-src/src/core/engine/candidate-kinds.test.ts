import { describe, it, expect } from 'vitest';
import { hondou } from './mgf/loader';
import { initPosition } from './position/init';
import { quantumInit } from '../../features/quantum/init';
import { buildInitialKindMap, displayKindsFor, groupCandidatesByKind, resolveCandidateKinds } from './candidate-kinds';
import type { PieceInstance, Position } from './position/types';

/** 盤上の 1 マスの駒を差し替えた Position を返す。 */
function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) =>
      ri === row ? r.map((cell, ci) => (ci === col ? piece : cell)) : r,
    ),
  };
}

/** 初期配置から、指定 initialKind の駒の PieceID を 1 個取り出す。 */
function pidOfKind(pos: Position, kind: string): string {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === 'player1' && cell.initialKind === kind) return cell.pieceId;
    }
  }
  throw new Error(`no player1 piece with initialKind=${kind}`);
}

describe('core/engine/candidate-kinds (Phase 5-11)', () => {
  it('本将棋モード (candidates 無し) は piece.kind の 1 個だけを返す', () => {
    const pos = initPosition(hondou);
    const kindMap = buildInitialKindMap(pos);
    const fu = pos.board[6][4]!;

    expect(displayKindsFor(hondou, fu, kindMap)).toEqual(['fu']);
  });

  it('量子初期状態は自陣営 8 駒種すべてを候補に持つ', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);
    const piece = pos.board[6][4]!;

    const kinds = displayKindsFor(hondou, piece, kindMap);

    expect(new Set(kinds)).toEqual(new Set(['ou', 'hi', 'kaku', 'kin', 'gin', 'kei', 'kyo', 'fu']));
  });

  it('表示順は強さの降順 (巡回表示が毎回同じ順で回るように)', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);
    const piece = pos.board[6][4]!;

    expect(displayKindsFor(hondou, piece, kindMap)).toEqual([
      'ou', 'hi', 'kaku', 'kin', 'gin', 'kei', 'kyo', 'fu',
    ]);
  });

  it('候補が 1 個に絞れた駒は、初期位置の駒種ではなく候補の駒種を返す', () => {
    const pos = quantumInit(initPosition(hondou));
    // 7 七の歩 (board[6][2]) の候補を「角」だけに絞る = 正体は角
    const target = pos.board[6][2]!;
    const kakuPid = pidOfKind(pos, 'kaku');
    const staged = withBoardPiece(pos, 6, 2, {
      ...target,
      candidates: new Set([kakuPid]),
      confirmed: true,
    });
    const kindMap = buildInitialKindMap(staged);

    // 元の kind は 'fu' のままだが、表示は候補が示す 'kaku' になる
    expect(staged.board[6][2]!.kind).toBe('fu');
    expect(displayKindsFor(hondou, staged.board[6][2]!, kindMap)).toEqual(['kaku']);
  });

  it('成っている駒は成り駒側の駒種になり、成れない駒種 (玉・金) は落ちる', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][2]!;
    const staged = withBoardPiece(pos, 6, 2, {
      ...target,
      promoted: true,
      candidates: new Set([pidOfKind(pos, 'fu'), pidOfKind(pos, 'hi'), pidOfKind(pos, 'ou'), pidOfKind(pos, 'kin')]),
    });
    const kindMap = buildInitialKindMap(staged);

    const kinds = displayKindsFor(hondou, staged.board[6][2]!, kindMap);

    expect(new Set(kinds)).toEqual(new Set(['ryu', 'to']));
  });

  it('候補が空 (矛盾局面) でも描画が消えないよう現在の kind に落ちる', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][2]!;
    const staged = withBoardPiece(pos, 6, 2, { ...target, candidates: new Set() });
    const kindMap = buildInitialKindMap(staged);

    expect(displayKindsFor(hondou, staged.board[6][2]!, kindMap)).toEqual(['fu']);
  });

  it('駒種ごとの束ね方: 同じ駒種の候補 PieceID は 1 グループにまとまる', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);
    const piece = pos.board[6][4]!;

    const groups = groupCandidatesByKind(hondou, piece.candidates!, false, kindMap);

    // 先手陣は歩 9 枚・香 2 枚・玉 1 枚
    expect(groups.get('fu')!.length).toBe(9);
    expect(groups.get('kyo')!.length).toBe(2);
    expect(groups.get('ou')!.length).toBe(1);
    // グループ数 = 駒種数 = resolveCandidateKinds の結果と一致する
    expect(groups.size).toBe(resolveCandidateKinds(hondou, piece.candidates!, false, kindMap).length);
  });

  it('対応表に無い PieceID は無視する (テスト等の orphan 参照で描画を壊さない)', () => {
    const pos = quantumInit(initPosition(hondou));
    const kindMap = buildInitialKindMap(pos);
    const target = pos.board[6][2]!;
    const staged = { ...target, candidates: new Set([pidOfKind(pos, 'gin'), 'NOT_A_PIECE']) };

    expect(displayKindsFor(hondou, staged, kindMap)).toEqual(['gin']);
  });
});
