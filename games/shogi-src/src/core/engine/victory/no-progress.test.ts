/**
 * 無進展手数（親 v1.65 §3.10 `move_limit`・チェスの 50 手ルール・第 9 段 9-4d）。
 *
 * 押さえたいことは 4 つ。
 * 1. **取る手と、ルール定義が名指しした駒が動く手**だけが数えを 0 に戻す
 * 2. **数えは手を遡って出す**＝待ったや感想戦のために別の数えを持ち歩かない
 * 3. **手数は「両者が指して 1 手」**（チェスの 50 手ルール＝内部の数えでは 100）
 * 4. **上限に達したら主張が無くても自動で引き分け**（チェスの 75 手）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chess, hondou } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import type { BoardMove, PieceInstance, Position } from '../position/types';
import { applyMove } from '../position/apply';
import {
  canClaimMoveLimit,
  countNoProgressPlies,
  isProgressMove,
  reachedMoveLimitAuto,
} from './no-progress';
import { useGameStore, winnerOf } from '../../store/game-store';
import { endingLabel } from '../../../features/kifu-replay/ui/ending';

function mk(kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return {
    pieceId: `${owner}-${kind}-${row}-${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function posWith(pieces: PieceInstance[], sideToMove: 'player1' | 'player2' = 'player1'): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

const move = (piece: PieceInstance, to: { row: number; col: number }): BoardMove => ({
  type: 'move',
  pieceId: piece.pieceId,
  from: piece.initialSquare,
  to,
  promote: false,
});

describe('9-4d 無進展手数（何が数えを 0 に戻すか）', () => {
  it('駒を取る手は進展（名指しは要らない）', () => {
    const rook = mk('rook', 'player1', 7, 7);
    const target = mk('knight', 'player2', 4, 7);
    const pos = posWith([rook, target, mk('king', 'player1', 7, 0), mk('king', 'player2', 0, 4)]);
    expect(isProgressMove(chess, pos, move(rook, { row: 4, col: 7 }))).toBe(true);
  });

  it('名指しされた駒（ポーン）が動く手は進展', () => {
    const pawn = mk('pawn', 'player1', 6, 4);
    const pos = posWith([pawn, mk('king', 'player1', 7, 0), mk('king', 'player2', 0, 4)]);
    expect(isProgressMove(chess, pos, move(pawn, { row: 5, col: 4 }))).toBe(true);
  });

  it('それ以外の駒が空いたマスへ動く手は進展ではない', () => {
    const rook = mk('rook', 'player1', 7, 7);
    const pos = posWith([rook, mk('king', 'player1', 7, 0), mk('king', 'player2', 0, 4)]);
    expect(isProgressMove(chess, pos, move(rook, { row: 5, col: 7 }))).toBe(false);
  });

  it('名指しの欄が無いルールでは、取る手だけが進展（本将棋は素通り）', () => {
    const hi = mk('hi', 'player1', 7, 7);
    const pos = posWith([hi, mk('ou', 'player1', 7, 4), mk('ou', 'player2', 0, 4)]);
    expect(hondou.victory?.move_limit).toBeUndefined();
    expect(isProgressMove(hondou, pos, move(hi, { row: 5, col: 7 }))).toBe(false);
    expect(countNoProgressPlies(hondou, [], pos)).toBe(0);
  });
});

describe('9-4d 無進展手数（遡って数える）', () => {
  /** 指し継いで、指す前の局面の並びと最後の局面を返す。 */
  function play(start: Position, moves: BoardMove[]): { past: Position[]; current: Position } {
    const past: Position[] = [];
    let cur = start;
    for (const m of moves) {
      past.push(cur);
      cur = applyMove(chess, cur, m);
    }
    return { past, current: cur };
  }

  it('取る手もポーンも無いまま指した分だけ数える', () => {
    const wr = mk('rook', 'player1', 7, 7);
    const wk = mk('king', 'player1', 7, 0);
    const bk = mk('king', 'player2', 0, 4);
    const start = posWith([wr, wk, bk]);
    const { past, current } = play(start, [
      move(wr, { row: 5, col: 7 }),
      { type: 'move', pieceId: bk.pieceId, from: { row: 0, col: 4 }, to: { row: 0, col: 3 }, promote: false },
      { type: 'move', pieceId: wr.pieceId, from: { row: 5, col: 7 }, to: { row: 7, col: 7 }, promote: false },
    ]);
    expect(countNoProgressPlies(chess, past, current)).toBe(3);
  });

  it('取った手より前は数えない（そこで 0 に戻る）', () => {
    const wr = mk('rook', 'player1', 7, 7);
    const wk = mk('king', 'player1', 7, 0);
    const bk = mk('king', 'player2', 0, 4);
    const bn = mk('knight', 'player2', 5, 7);
    const start = posWith([wr, wk, bk, bn]);
    const { past, current } = play(start, [
      move(wr, { row: 5, col: 7 }), // ナイトを取る = 進展
      { type: 'move', pieceId: bk.pieceId, from: { row: 0, col: 4 }, to: { row: 0, col: 3 }, promote: false },
    ]);
    expect(countNoProgressPlies(chess, past, current)).toBe(1);
  });

  it('昇格した駒の名札に釣られない（クイーンの手をポーンの手と読み違えない）', () => {
    // ポーンが 8 段目へ進んでクイーンに入れ替わり、そのあとクイーンとして動く。
    // 昇格の手は「ポーンが動く手」なので進展＝そこで 0 に戻り、以降のクイーンの手だけ数える。
    const wp = mk('pawn', 'player1', 1, 0); // a7
    const wk = mk('king', 'player1', 7, 0);
    const bk = mk('king', 'player2', 0, 4);
    const start = posWith([wp, wk, bk]);
    const promo: BoardMove = {
      type: 'move',
      pieceId: wp.pieceId,
      from: { row: 1, col: 0 },
      to: { row: 0, col: 0 },
      promote: true,
      promoteTo: 'queen',
    };
    const { past, current } = play(start, [
      promo,
      { type: 'move', pieceId: bk.pieceId, from: { row: 0, col: 4 }, to: { row: 1, col: 4 }, promote: false },
      { type: 'move', pieceId: wp.pieceId, from: { row: 0, col: 0 }, to: { row: 0, col: 3 }, promote: false },
    ]);
    expect(current.board[0][3]?.kind).toBe('queen');
    expect(countNoProgressPlies(chess, past, current)).toBe(2);
  });
});

describe('9-4d 無進展手数（しきい値）', () => {
  it('手数は「両者が指して 1 手」＝チェスの 50 手は内部の数えで 100', () => {
    expect(canClaimMoveLimit(chess, 99)).toBe(false);
    expect(canClaimMoveLimit(chess, 100)).toBe(true);
    expect(reachedMoveLimitAuto(chess, 149)).toBe(false);
    expect(reachedMoveLimitAuto(chess, 150)).toBe(true);
  });

  it('チェスの定義は 50 手で主張・75 手で自動、ポーンで数え直すと書いている', () => {
    expect(chess.victory?.move_limit).toMatchObject({
      claim_at: 50,
      auto_at: 75,
      reset_on: ['pawn'],
      trigger: 'claim',
    });
  });

  it('欄を持たないルールでは、いくら数えても成立しない', () => {
    expect(canClaimMoveLimit(hondou, 1000)).toBe(false);
    expect(reachedMoveLimitAuto(hondou, 1000)).toBe(false);
  });
});

describe('9-4d 無進展手数（上限で自動的に引き分けになる）', () => {
  /** 上限だけ小さくしたチェス（2 手＝内部の数えで 4）。 */
  function shortLimitRule(): Mgf {
    const rule = JSON.parse(JSON.stringify(chess)) as Mgf;
    rule.victory!.move_limit = { claim_at: 1, auto_at: 2, reset_on: ['pawn'], trigger: 'claim' };
    return rule;
  }

  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: shortLimitRule() });
  });

  it('進展の無い手が上限に達した瞬間、勝った側の居ない引き分けで終わる', () => {
    useGameStore.setState({
      position: posWith([
        mk('king', 'player1', 7, 0),
        mk('rook', 'player1', 7, 7),
        mk('king', 'player2', 0, 4),
      ]),
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
    });
    const st = useGameStore.getState();
    // 4 手（＝2 手ぶん）進展なし
    st.selectSquare({ row: 7, col: 7 });
    expect(st.tryMove({ row: 5, col: 7 })).toBe(true);
    expect(useGameStore.getState().status).toBe('playing');
    st.selectSquare({ row: 0, col: 4 });
    expect(st.tryMove({ row: 0, col: 3 })).toBe(true);
    st.selectSquare({ row: 5, col: 7 });
    expect(st.tryMove({ row: 7, col: 7 })).toBe(true);
    expect(useGameStore.getState().status).toBe('playing');
    st.selectSquare({ row: 0, col: 3 });
    expect(st.tryMove({ row: 0, col: 4 })).toBe(true);

    const s = useGameStore.getState();
    expect(s.status).toBe('move_limit');
    expect(winnerOf(s.status, s.position.sideToMove)).toBeNull();
  });

  it('棋譜の終局表示が対局画面と同じ言葉で出る', () => {
    expect(endingLabel({ status: 'move_limit', winner: null }, 'ja')).toBe('無進展手数・引分');
  });
});
