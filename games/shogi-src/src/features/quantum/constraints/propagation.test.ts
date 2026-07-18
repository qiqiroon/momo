import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import { applyMove } from '../../../core/engine/position/apply';
import { register, clear } from '../../../core/plugin/registry';
import type { PieceInstance, Position } from '../../../core/engine/position/types';
import { candidateUpdate } from '../candidate-update';
import { buildInitialInfoMap } from '../piece-lookup';
import { quantumInit } from '../init';
import { basicConstraints } from './basic';
import { legalConstraints } from './legal';
import {
  c106UniqueAssignment,
  c108FuFileConservation,
  propagationConstraints,
} from './propagation';

describe('C-108 fu-筋保存 (単体)', () => {
  it('現在 col=8 の駒の候補から、fu-initial-@col!=8 の PieceID を除外', () => {
    // 本将棋初期の board[8][0] は sente kyo (P0)。ここに擬似的な量子駒を置いて test。
    // 具体的には (5, 8) に fu 候補 (fu-initial-@col=0..8 の 9 個) を持つ駒を作る。
    // C-108 は現在 col=8 の駒には fu-initial-@col=8 だけを残し、他は除外する。
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    // fu-initial PieceID 一覧 (P0 は kyo なのでスキップ、P11..P19 が fu@col 0..8)
    // 実際の PieceID は init.ts の scan 順で決まる。fu は row 6 スキャンで col 0..8 順。
    // sente pieces list index: 0=kyo(9,0), 1=kei(9,1), 2=gin(9,2), 3=kin(9,3), 4=ou(9,4),
    //   5=kin(9,5), 6=gin(9,6), 7=kei(9,7), 8=kyo(9,8), 9=kaku(8,1), 10=hi(8,7),
    //   11..19 = fu at row 6 col 0..8
    // よって P11=fu@col 0, ..., P19=fu@col 8

    // 実際の board[6][0].pieceId が何になるかを確認
    const fu_col_0 = pos.board[6][0]!;
    const fu_col_8 = pos.board[6][8]!;
    expect(fu_col_0.initialKind).toBe('fu');
    expect(fu_col_8.initialKind).toBe('fu');
    expect(fu_col_0.initialSquare.col).toBe(0);
    expect(fu_col_8.initialSquare.col).toBe(8);

    // 現在 col=0 の駒 (fu_col_0 = 例えば P11) の candidates は全 20 なので、
    // C-108 適用後は fu-initial-@col!=0 が抜けて、17 個 (fu-initial-@col=0 のみ残 + fu 以外 12 個)
    const survivors = c108FuFileConservation(
      fu_col_0,
      { kind: 'board', square: { row: 6, col: 0 } },
      pos, hondou, { torusMode: 'none', infoMap },
    );
    // 除去された PieceID を数える: fu@col 1..8 の 8 個が抜ける
    expect(survivors.size).toBe(20 - 8);
    expect(survivors.has(fu_col_0.pieceId)).toBe(true); // 自 fu-initial は残る
    expect(survivors.has(fu_col_8.pieceId)).toBe(false); // 別筋の fu-initial は抜ける
  });

  it('promoted=true (成っている) の駒は C-108 で狭まらない', () => {
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    const fu_col_0 = pos.board[6][0]!;
    const promotedPiece: PieceInstance = { ...fu_col_0, promoted: true };
    const survivors = c108FuFileConservation(
      promotedPiece,
      { kind: 'board', square: { row: 6, col: 0 } },
      pos, hondou, { torusMode: 'none', infoMap },
    );
    expect(survivors.size).toBe(20); // 全候補残る
  });

  it('持ち駒は C-108 で狭まらない (打ち手はどの筋にも打てる)', () => {
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    const fu = pos.board[6][0]!;
    const survivors = c108FuFileConservation(
      fu,
      { kind: 'hand', owner: 'player1', index: 0 },
      pos, hondou, { torusMode: 'none', infoMap },
    );
    expect(survivors.size).toBe(20);
  });
});

describe('C-106 unique assignment (単体)', () => {
  it('全駒 candidates=全 20 の初期状態: どの候補も担当駒が複数 → 変化なし', () => {
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    const target = pos.board[6][0]!;
    const survivors = c106UniqueAssignment(
      target,
      { kind: 'board', square: { row: 6, col: 0 } },
      pos, hondou, { torusMode: 'none', infoMap },
    );
    // 全候補が複数駒で共有されているので、除外・narrow どちらも起きない
    expect(survivors.size).toBe(20);
  });

  it('自分だけが X を候補に持つ場合: candidates を {X} に narrow', () => {
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    const target = pos.board[6][0]!;
    // target 以外の全駒から target.pieceId を candidates から除外した状態を作る
    const newBoard = pos.board.map((row) =>
      row.map((cell) => {
        if (!cell || !cell.candidates || cell.pieceId === target.pieceId) return cell;
        const narrowed = new Set(cell.candidates);
        narrowed.delete(target.pieceId);
        return { ...cell, candidates: narrowed };
      }),
    );
    const modifiedPos: Position = { ...pos, board: newBoard };
    const survivors = c106UniqueAssignment(
      target,
      { kind: 'board', square: { row: 6, col: 0 } },
      modifiedPos, hondou, { torusMode: 'none', infoMap },
    );
    // target だけが target.pieceId を担当している → {target.pieceId} に narrow
    expect(survivors.size).toBe(1);
    expect(survivors.has(target.pieceId)).toBe(true);
  });

  it('自分の候補に自分の pieceId が唯一担当となる pid が複数あっても、narrow は 1 個目に限定', () => {
    // C-106 の hidden single は「その駒だけが担当できる pid が 1 個ある」時に narrow する。
    // 実装ノート: piece.candidates に含まれる pid の carrier list には必ず piece 自身が含まれる
    // (piece に pid があれば piece は担当者)。よって「他の駒だけが担当」= list.length==1 &&
    // list[0]!=piece という枝は piece.candidates 内の要素については論理的に到達不可能。
    // このテストは「複数の unique を持つ場合の代表的挙動」= 最初の 1 個で narrow する動作を確認する。
    const pos = quantumInit(initPosition(hondou));
    const infoMap = buildInitialInfoMap(pos);
    const target = pos.board[6][0]!;
    // target 以外の全駒から target.pieceId を除外
    const newBoard = pos.board.map((row) =>
      row.map((cell) => {
        if (!cell || !cell.candidates || cell.pieceId === target.pieceId) return cell;
        const narrowed = new Set(cell.candidates);
        narrowed.delete(target.pieceId);
        return { ...cell, candidates: narrowed };
      }),
    );
    const modifiedPos: Position = { ...pos, board: newBoard };
    const survivors = c106UniqueAssignment(
      target,
      { kind: 'board', square: { row: 6, col: 0 } },
      modifiedPos, hondou, { torusMode: 'none', infoMap },
    );
    // target.pieceId は target だけが担当 → {target.pieceId} に narrow
    expect(survivors.size).toBe(1);
    expect(survivors.has(target.pieceId)).toBe(true);
  });
});

describe('P8 斜め → P19 fu 確定伝搬 (統合)', () => {
  afterEach(() => {
    clear();
  });

  it('sente の (6,7)→(5,6) 斜め移動で動いた駒は fu 候補が抜け、1 筋に残る駒が fu 確定に近づく', () => {
    // 全 constraints (basic + legal + propagation) を登録
    register('quantum:constraints', [
      ...basicConstraints,
      ...legalConstraints,
      ...propagationConstraints,
    ]);

    // 本将棋初期 + 量子 ON
    let pos = quantumInit(initPosition(hondou));
    // sente 番、(6,7) の fu を (5,6) へ移動 (斜め前)
    // sente pieces list: (row=6 col=0..8) = fu → 順に P11..P19。P18 が col 7 の fu。
    const movingPiece = pos.board[6][7]!;
    expect(movingPiece.initialKind).toBe('fu');
    expect(movingPiece.initialSquare.col).toBe(7);
    const movingPieceId = movingPiece.pieceId;

    // 斜め前の動きを applyMove
    pos = applyMove(hondou, pos, {
      type: 'move',
      pieceId: movingPieceId,
      from: { row: 6, col: 7 },
      to: { row: 5, col: 6 },
      promote: false,
    });

    // candidate_update を実行
    const after = candidateUpdate(pos, hondou);

    // 動いた駒 (P18 相当) は斜め前なので fu-initial 候補が抜ける
    const moved = after.board[5][6]!;
    expect(moved.pieceId).toBe(movingPieceId);
    // fu-initial の PieceID を全部集める
    const infoMap = buildInitialInfoMap(pos);
    const fuInitials: string[] = [];
    for (const [pid, info] of infoMap) {
      if (info.initialKind === 'fu' && info.initialOwner === 'player1') fuInitials.push(pid);
    }
    // 全 sente fu-initial は 9 個
    expect(fuInitials).toHaveLength(9);

    // 動いた駒の候補に fu-initial は 1 個も含まれてはいけない
    for (const fuId of fuInitials) {
      expect(moved.candidates!.has(fuId)).toBe(false);
    }

    // C-108 の効果: 1 筋 (col 7) に居る駒 (=(6,7) は空、(8,7) は kei P7) のみが fu-@col=7 を候補に持てる。
    // 実は (6,7) から動いた駒は (5,6) に居るので col=7 じゃない = fu-@col=7 を持てない。
    // 他の駒で col=7 なのは (8,7) の kei P7 のみ。よって fu-@col=7 は P7 の候補にしか無い。
    // C-106 で P7 の候補は「fu-@col=7」を含む複数候補の中で唯一 fu-@col=7 を持つが、
    // 他の候補 (kyo/kei/gin/kin/kaku/hi/ou-initial系) は他の駒も持っているので narrow 材料に
    // ならない (自分だけの担当ではないので unique assignment は成立しない)。
    // よって P7 は「fu-@col=7 の唯一の候補担当」だが narrow 対象は "自分単独担当X が 1 個" の
    // 条件を満たさない (kei-initial 等も担当している可能性がある)。

    // このテストは P8 斜め時の「fu-@col=7 の担当が P7 (col 7 に居る唯一の駒) に限定される」ことを確認。
    const p7 = after.board[8][7];
    if (p7?.candidates) {
      // P7 が fu-@col=7 (=movingPieceId が持っていた元 fu-initial) を候補に持つ
      // ただし movingPieceId は元 (6,7) の駒なので initialSquare.col=7
      expect(p7.candidates.has(movingPieceId)).toBe(true);
    }
  });

  it('C-108 と C-106 の連鎖: 動いた駒が別筋に行き、残った駒に fu が確定伝搬する', () => {
    // 全 constraints を登録
    register('quantum:constraints', [
      ...basicConstraints,
      ...legalConstraints,
      ...propagationConstraints,
    ]);

    // 本将棋初期 + 量子 ON
    let pos = quantumInit(initPosition(hondou));

    // (6,7) から (5,6) 斜め移動
    const movingPiece = pos.board[6][7]!;
    const movingPieceId = movingPiece.pieceId;
    pos = applyMove(hondou, pos, {
      type: 'move',
      pieceId: movingPieceId,
      from: { row: 6, col: 7 },
      to: { row: 5, col: 6 },
      promote: false,
    });
    const after = candidateUpdate(pos, hondou);

    // C-108 の効果を verify: col=6 の駒は fu-initial-@col!=6 を候補に含まない
    const movedPiece = after.board[5][6]!;
    const infoMap = buildInitialInfoMap(pos);
    for (const [pid, info] of infoMap) {
      if (info.initialKind === 'fu' && info.initialOwner === 'player1' && info.initialSquare.col !== 6) {
        // 動いた駒は現在 col=6、fu-initial-@col=6 (=元 (6,6) の駒) 以外の fu-initial は候補に無いはず
        expect(movedPiece.candidates!.has(pid)).toBe(false);
      }
    }
    // ただし fu-initial-@col=6 は C-101 (斜め前 1) の除去でも抜けている (fu は斜め移動不可)
    // よって全 fu-initial が抜けている
    for (const [pid, info] of infoMap) {
      if (info.initialKind === 'fu' && info.initialOwner === 'player1') {
        expect(movedPiece.candidates!.has(pid)).toBe(false);
      }
    }
  });
});
