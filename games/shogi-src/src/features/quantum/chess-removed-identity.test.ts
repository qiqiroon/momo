/**
 * ★v2.03: 量子チェスで**取り除かれた駒の名札と一緒に身元が読めなくなる**ことの直し
 * (量子分冊 §Q23.5「取り除かれた駒も身元の勘定には残す」)。
 *
 * 身元 (候補の PieceID) を駒種へ読み替える表は、その PieceID を名札に持つ駒から作る。
 * チェスの捕獲は盤から駒を消すので、**王のマスから出た駒 (正体は確定済みの騎士) が
 * 取られると、王の身元を持つ駒が残っているのに誰も王と読み替えられなくなった**
 * (2026-10-04 利用者報告「AI 側の KING が無くなった」・下の棋譜そのもの)。
 * 白も 12 手目で同じことになっていた (e1 から出た駒が g2 で取られる)。
 *
 * もう 1 つ、同じ根の誤り＝**取り除いた駒が割り当ての勘定 (C-303) に入っていなかった**。
 * 報告の棋譜では黒が斜めに長く動いた駒が 4 枚 (6・10・12・14 手目) ある＝ビショップ 2 枚と
 * クイーン 1 枚の 3 枚しかないのに、**先に取られた 3 枚が身元を使い切ったことが数えられず**
 * 14 手目が指せていた。直したので報告の棋譜は 14 手目で止まる。王の確かめには、
 * 14 手目だけ差し替えて 15 手目 (e8 から出た駒を取る) まで進めた棋譜を使う。
 */

import { describe, it, expect } from 'vitest';
import './index';
import { chess } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { applyMove } from '../../core/engine/position/apply';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { advancePosition } from '../../core/engine/position/advance';
import { buildInitialKindMap, resolveCandidateKinds } from '../../core/engine/candidate-kinds';
import type { Player } from '../../core/engine/mgf/types';
import type { BoardMove, Position } from '../../core/engine/position/types';
import { quantumInit } from './init';

/** 利用者の棋譜 (2026-10-04)。盤のマス名で、どの駒を動かしたかは元のマスで決まる。 */
const REPORTED = [
  'h2-c7', 'b8-c7', 'c2-c7', 'e8-c7', 'b1-c3', 'g7-c3', 'd2-c3', 'g8-g2',
  'e1-g2', 'h8-c3', 'b2-c3', 'b7-g2', 'f1-g2', 'a8-g2', 'c3-c7', 'h7-h1',
];

/** 報告の棋譜の 14 手目を、指せる手 (a7-a6) に差し替えたもの。15 手目で e8 から出た駒が取られる。 */
const KING_CASE = [...REPORTED.slice(0, 13), 'a7-a6', 'c3-c7'];

const sq = (s: string) => ({ row: 8 - Number(s[1]), col: s.charCodeAt(0) - 97 });

function findMove(pos: Position, text: string): BoardMove | undefined {
  const [f, t] = text.split('-').map(sq);
  return generateLegalMoves(chess, pos).find(
    (m): m is BoardMove =>
      m.type === 'move' && m.from.row === f.row && m.from.col === f.col && m.to.row === t.row && m.to.col === t.col,
  );
}

function play(pos: Position, text: string): Position {
  const move = findMove(pos, text);
  expect(move, `${text} が合法手に無い`).toBeTruthy();
  const r = advancePosition(chess, pos, move as BoardMove, { quantum: true });
  expect(r.royalCaptured).toBe(false);
  return r.position;
}

/** 盤の上で、王でありうる (候補を駒種へ読み替えると king を含む) 駒の数。 */
function kingPossible(pos: Position, side: Player): number {
  const kindMap = buildInitialKindMap(pos);
  let n = 0;
  for (const row of pos.board) {
    for (const cell of row) {
      if (!cell || cell.owner !== side || !cell.candidates) continue;
      if (resolveCandidateKinds(chess, cell.candidates, cell.promoted, kindMap).includes('king')) n++;
    }
  }
  return n;
}

describe('§Q23.5 取り除かれた駒の身元は読み替えられ続ける', () => {
  it('★王のマスから出た駒が取られても、両陣営とも王でありうる駒が盤に残る', () => {
    let pos = quantumInit(initPosition(chess));
    KING_CASE.forEach((text, i) => {
      pos = play(pos, text);
      expect(kingPossible(pos, 'player1'), `${i + 1}. ${text} のあと 白`).toBeGreaterThan(0);
      expect(kingPossible(pos, 'player2'), `${i + 1}. ${text} のあと 黒`).toBeGreaterThan(0);
    });
  });

  it('★取り除いた駒も割り当ての勘定に入る＝4 枚目は斜めに長く動けない (報告の 14 手目)', () => {
    let pos = quantumInit(initPosition(chess));
    for (const text of REPORTED.slice(0, 13)) pos = play(pos, text);
    expect(findMove(pos, 'a8-g2')).toBeUndefined();
    // a8 の駒そのものは動ける (ルーク・ポーン等の可能性は残る)
    expect(findMove(pos, 'a8-b8')).toBeTruthy();
  });

  it('取り除いた量子の駒は removedPieces に残る (盤・駒台には現れない)', () => {
    let pos = quantumInit(initPosition(chess));
    expect(pos.removedPieces).toEqual([]);
    for (const text of REPORTED.slice(0, 4)) pos = play(pos, text);
    // 1〜4 手目はすべて c7 での取り＝4 枚が盤から消えている
    expect(pos.removedPieces).toHaveLength(4);
    expect(pos.hands.player1).toHaveLength(0);
    expect(pos.hands.player2).toHaveLength(0);
  });

  it('量子でないチェスの局面は removedPieces を持たない (振る舞いは変わらない)', () => {
    let pos = initPosition(chess);
    for (const text of ['e2-e4', 'd7-d5', 'e4-d5']) {
      const [f, t] = text.split('-').map(sq);
      const move = generateLegalMoves(chess, pos).find(
        (m): m is BoardMove =>
          m.type === 'move' && m.from.row === f.row && m.from.col === f.col && m.to.row === t.row && m.to.col === t.col,
      );
      pos = applyMove(chess, pos, move as BoardMove);
    }
    expect('removedPieces' in pos).toBe(false);
  });
});
