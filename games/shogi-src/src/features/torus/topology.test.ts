import { describe, it, expect, beforeEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { initPosition } from '../../core/engine/position/init';
import { generatePieceMoves } from '../../core/engine/moves/generator';
import { generateLegalMoves, isMoveLegal } from '../../core/engine/moves/legal';
import { isInCheck } from '../../core/engine/moves/check';
import { clear as clearPlugins, register } from '../../core/plugin/registry';
import { noRoyalCaptureRoyal, noRoyalCheckRoyal, topologyFor } from './topology';

/**
 * 完全トーラス専用の追加制限 (親 §3.4.2)。
 *
 * 禁じるのは**玉で敵の玉を取ること 1 点だけ**。他の駒が盤を回り込んで王手・王取りを
 * するのは仕様として残す (「意外なことができると知ることがエンタメ」)。
 * 塞ぎすぎていないことも一緒に固定しておく。
 */

function emptyPos(mode: 'none' | 'cylinder' | 'full'): Position {
  const topology = topologyFor(mode);
  return {
    width: 9,
    height: 9,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null)),
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
    ...(mode === 'none' ? {} : { topology }),
  };
}

function piece(kind: string, owner: 'player1' | 'player2', id: string): PieceInstance {
  return {
    pieceId: id,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row: -1, col: -1 },
    promoted: false,
  };
}

function place(pos: Position, row: number, col: number, p: PieceInstance): Position {
  const board = pos.board.map((r) => r.slice());
  board[row][col] = p;
  return { ...pos, board };
}

/** 上端の自駒 → 下端の敵玉へ、盤の外をまたいで動く手。 */
function crossEdgeMove(pieceId: string) {
  return {
    type: 'move' as const,
    pieceId,
    from: { row: 0, col: 4 },
    to: { row: 8, col: 4 },
    promote: false,
  };
}

describe('モードの解釈', () => {
  it('なし = どこもつながらない', () => {
    expect(topologyFor('none')).toEqual({ wrapX: false, wrapY: false });
  });

  it('円筒 = 左右だけ', () => {
    expect(topologyFor('cylinder')).toEqual({ wrapX: true, wrapY: false });
  });

  it('完全トーラス = 上下左右', () => {
    expect(topologyFor('full')).toEqual({ wrapX: true, wrapY: true });
  });
});

describe('完全トーラスの「王で敵王を取れない」', () => {
  beforeEach(() => {
    clearPlugins();
    register('topology:moveFilter', noRoyalCaptureRoyal);
    register('topology:attackFilter', noRoyalCheckRoyal);
  });

  it('玉で敵の玉は取れない', () => {
    let pos = place(emptyPos('full'), 0, 4, piece('ou', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('ou', 'player2', 'p1'));
    // 手そのものは生成される (盤がつながっているので届く) が、指せない
    expect(generatePieceMoves(hondou, pos, { row: 0, col: 4 })
      .some((m) => m.to.row === 8 && m.to.col === 4)).toBe(true);
    expect(isMoveLegal(hondou, pos, crossEdgeMove('P1'))).toBe(false);
  });

  it('玉以外なら回り込んで王を取れる (周回利きは塞がない)', () => {
    let pos = place(emptyPos('full'), 0, 4, piece('kin', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('ou', 'player2', 'p1'));
    expect(isMoveLegal(hondou, pos, crossEdgeMove('P1'))).toBe(true);
  });

  it('玉で玉以外を取るのは自由', () => {
    let pos = place(emptyPos('full'), 0, 4, piece('ou', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('fu', 'player2', 'p1'));
    expect(isMoveLegal(hondou, pos, crossEdgeMove('P1'))).toBe(true);
  });

  it('円筒では上下がつながらないので、この制限は出番がない', () => {
    let pos = place(emptyPos('cylinder'), 0, 4, piece('ou', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('ou', 'player2', 'p1'));
    expect(noRoyalCaptureRoyal(hondou, pos, crossEdgeMove('P1'))).toBe(true);
  });

  /**
   * v1.26 (ユーザー報告 2026-08-14「完全トーラスでどこへも行けなくなった」)。
   *
   * 取れないようにするだけでは、**王手はかかったまま**だった。上下がつながった盤では
   * 開始局面で両者の玉が背中合わせに隣り合うので、先手は王手を受けた状態で始まり、
   * 玉を逃がす手以外がすべて反則になっていた。玉どうしは取れないし王手にもならない、
   * とすることで開始局面が普通に指せる状態に戻る。
   */
  it('玉どうしは王手にもならない (開始局面が固まらない)', () => {
    const pos = initPosition(hondou, topologyFor('full'));
    expect(isInCheck(hondou, pos, 'player1')).toBe(false);
    expect(isInCheck(hondou, pos, 'player2')).toBe(false);
  });

  it('開始局面で玉以外の駒も動ける (報告された症状そのもの)', () => {
    const pos = initPosition(hondou, topologyFor('full'));
    const movers = new Set(
      generateLegalMoves(hondou, pos)
        .filter((m) => m.type === 'move')
        .map((m) => m.pieceId),
    );
    expect(movers.size).toBeGreaterThan(1);
    // 歩が 1 枚も動けないなら、また玉一択に戻っている
    const pawnCanMove = generateLegalMoves(hondou, pos).some(
      (m) => m.type === 'move' && pos.board[m.from.row][m.from.col]?.kind === 'fu',
    );
    expect(pawnCanMove).toBe(true);
  });

  it('玉以外からの周回王手はそのまま成立する (塞いでいない)', () => {
    let pos = place(emptyPos('full'), 0, 4, piece('ou', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('kin', 'player2', 'p1'));
    // 後手の金が下端から上端へ回り込んで先手玉に利いている
    expect(isInCheck(hondou, { ...pos, sideToMove: 'player1' }, 'player1')).toBe(true);
  });

  it('円筒では玉どうしの扱いを変えない (上下がつながらないので出番がない)', () => {
    let pos = place(emptyPos('cylinder'), 0, 4, piece('ou', 'player1', 'P1'));
    pos = place(pos, 8, 4, piece('ou', 'player2', 'p1'));
    expect(noRoyalCheckRoyal(hondou, pos, { row: 8, col: 4 }, { row: 0, col: 4 })).toBe(true);
  });

  it('未確定の駒どうしは止めない (量子モード・玉と言い切れないため)', () => {
    const mover: PieceInstance = {
      ...piece('ou', 'player1', 'P1'),
      candidates: new Set(['P1', 'P2']),
    };
    const target: PieceInstance = {
      ...piece('ou', 'player2', 'p1'),
      candidates: new Set(['p1', 'p2']),
    };
    let pos = place(emptyPos('full'), 0, 4, mover);
    pos = place(pos, 8, 4, target);
    pos = place(pos, 5, 0, { ...piece('kin', 'player1', 'P2'), candidates: new Set(['P1', 'P2']) });
    pos = place(pos, 5, 8, { ...piece('kin', 'player2', 'p2'), candidates: new Set(['p1', 'p2']) });
    expect(noRoyalCaptureRoyal(hondou, pos, crossEdgeMove('P1'))).toBe(true);
  });
});
