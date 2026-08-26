/**
 * 同じ局面かの見分け方（親 v1.65 §4.2.1・第 9 段 9-4d）。
 *
 * 押さえたいことは 3 つ。
 * 1. **将棋には盤に現れない権利が無い**＝指紋は空で、数え方は従来どおり
 * 2. **チェスでは、配置が同じでも権利が違えば別の局面**（キャスリング・アンパッサン）
 * 3. **アンパッサンは「実際に取れるか」で見る**＝取れる駒が居なければ同じ局面として数える
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chess, hondou } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import type { BoardMove, PieceInstance, Position } from '../position/types';
import { countSamePositions, hiddenRightsFingerprint } from './repetition';
import { positionHash } from '../position/hash';
import { useGameStore } from '../../store/game-store';

function mk(
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
  initial?: { row: number; col: number },
): PieceInstance {
  return {
    pieceId: `${owner}-${kind}-${initial?.row ?? row}-${initial?.col ?? col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: initial ?? { row, col },
    promoted: false,
  };
}

/** `at` の位置に置く（初期マスとは別に指定できる）。 */
function place(board: (PieceInstance | null)[][], piece: PieceInstance, row: number, col: number) {
  board[row][col] = piece;
}

function emptyBoard(size = 8) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null as PieceInstance | null),
  );
}

function posOf(
  board: (PieceInstance | null)[][],
  history: BoardMove[],
  sideToMove: 'player1' | 'player2' = 'player1',
  size = 8,
): Position {
  return {
    width: size,
    height: size,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: history.length + 1,
    history,
  };
}

const step = (piece: PieceInstance, from: number[], to: number[]): BoardMove => ({
  type: 'move',
  pieceId: piece.pieceId,
  from: { row: from[0], col: from[1] },
  to: { row: to[0], col: to[1] },
  promote: false,
});

describe('9-4d 同じ局面か（将棋は盤に現れない権利を持たない）', () => {
  it('本将棋の指紋は空＝遡らずに、印だけで数える', () => {
    const board = emptyBoard(9);
    place(board, mk('ou', 'player1', 8, 4), 8, 4);
    place(board, mk('ou', 'player2', 0, 4), 0, 4);
    const pos = posOf(board, [], 'player1', 9);
    expect(hiddenRightsFingerprint(hondou, pos)).toBe('');
  });

  it('本将棋では、同じ配置なら手順が違っても同じ局面として数える', () => {
    const ou1 = mk('ou', 'player1', 8, 4);
    const ou2 = mk('ou', 'player2', 0, 4);
    const build = (history: BoardMove[]) => {
      const board = emptyBoard(9);
      place(board, ou1, 8, 4);
      place(board, ou2, 0, 4);
      return posOf(board, history, 'player1', 9);
    };
    const first = build([]);
    const later = build([
      step(ou1, [8, 4], [8, 3]),
      step(ou2, [0, 4], [0, 3]),
      step(ou1, [8, 3], [8, 4]),
      step(ou2, [0, 3], [0, 4]),
    ]);
    expect(positionHash(first)).toBe(positionHash(later));
    expect(countSamePositions(hondou, [first], later)).toBe(2);
  });
});

describe('9-4d 同じ局面か（チェスは権利まで確かめる）', () => {
  const wk = mk('king', 'player1', 7, 4);
  const wr = mk('rook', 'player1', 7, 0);
  const bk = mk('king', 'player2', 0, 4);

  const castlingPos = (history: BoardMove[]) => {
    const board = emptyBoard();
    place(board, wk, 7, 4);
    place(board, wr, 7, 0);
    place(board, bk, 0, 4);
    return posOf(board, history);
  };

  it('王が動いて戻った局面は、一度も動いていない局面と同じには数えない', () => {
    const never = castlingPos([]);
    const moved = castlingPos([
      step(wk, [7, 4], [7, 5]),
      step(bk, [0, 4], [0, 5]),
      step(wk, [7, 5], [7, 4]),
      step(bk, [0, 5], [0, 4]),
    ]);
    // 盤・持ち駒・手番はまったく同じ（粗い印では区別が付かない）
    expect(positionHash(never)).toBe(positionHash(moved));
    // 権利が違うので 1 回きり
    expect(countSamePositions(chess, [never], moved)).toBe(1);
  });

  it('権利まで同じなら、いつもどおり数える', () => {
    const a = castlingPos([]);
    const b = castlingPos([]);
    expect(countSamePositions(chess, [a], b)).toBe(2);
  });
});

describe('9-4d 同じ局面か（アンパッサンは「実際に取れるか」で見る）', () => {
  const wk = mk('king', 'player1', 7, 4);
  const bk = mk('king', 'player2', 0, 4);
  /** 後手のポーン。初期マスは d7、いまは d5。 */
  const bp = mk('pawn', 'player2', 3, 3, { row: 1, col: 3 });

  /** 先手のポーンを `col` に置いた盤（e5 なら隣で取れる・a5 なら取れない）。 */
  const withWhitePawn = (col: number, history: BoardMove[]) => {
    const wp = mk('pawn', 'player1', 3, col, { row: 6, col });
    const board = emptyBoard();
    place(board, wk, 7, 4);
    place(board, bk, 0, 4);
    place(board, bp, 3, 3);
    place(board, wp, 3, col);
    return posOf(board, history);
  };

  const doubleStep = step(bp, [1, 3], [3, 3]);
  const oneStep = step(bp, [2, 3], [3, 3]);

  it('隣に取れるポーンが居るなら、2 マス進んだ直後の局面は別の局面', () => {
    const justPassed = withWhitePawn(4, [doubleStep]);
    const arrivedSlowly = withWhitePawn(4, [oneStep]);
    expect(positionHash(justPassed)).toBe(positionHash(arrivedSlowly));
    expect(hiddenRightsFingerprint(chess, justPassed)).not.toBe(
      hiddenRightsFingerprint(chess, arrivedSlowly),
    );
    expect(countSamePositions(chess, [justPassed], arrivedSlowly)).toBe(1);
  });

  it('取れるポーンが居なければ、2 マス進んだ直後でも同じ局面として数える', () => {
    // 取れない位置（a5）に居る場合。ここを「直前が 2 マス進みか」だけで見ると
    // 別の局面に割ってしまい、**正しい主張を退ける**ことになる。
    const justPassed = withWhitePawn(0, [doubleStep]);
    const arrivedSlowly = withWhitePawn(0, [oneStep]);
    expect(countSamePositions(chess, [justPassed], arrivedSlowly)).toBe(2);
  });
});

describe('9-4d 自動で成立する側でも、権利まで確かめる', () => {
  /** 2 回目の出現で自動成立するチェス（主張は書かない）。 */
  function twiceRule(): Mgf {
    const rule = JSON.parse(JSON.stringify(chess)) as Mgf;
    rule.repetition = { type: 'draw', detection_threshold: 2 };
    return rule;
  }

  /** 王・ルーク・ナイトだけの盤（ルークを往復させると権利が変わる）。 */
  function rookBoard(): Position {
    const board = emptyBoard();
    place(board, mk('king', 'player1', 7, 0), 7, 0);
    place(board, mk('rook', 'player1', 7, 7), 7, 7);
    place(board, mk('king', 'player2', 0, 4), 0, 4);
    place(board, mk('knight', 'player2', 0, 1), 0, 1);
    return posOf(board, []);
  }

  /** ルークと相手のナイトを往復させて、同じ配置へ戻る 4 手。 */
  function roundTrip() {
    const st = useGameStore.getState();
    st.selectSquare({ row: 7, col: 7 });
    expect(st.tryMove({ row: 6, col: 7 })).toBe(true);
    st.selectSquare({ row: 0, col: 1 });
    expect(st.tryMove({ row: 2, col: 2 })).toBe(true);
    st.selectSquare({ row: 6, col: 7 });
    expect(st.tryMove({ row: 7, col: 7 })).toBe(true);
    st.selectSquare({ row: 2, col: 2 });
    expect(st.tryMove({ row: 0, col: 1 })).toBe(true);
  }

  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: twiceRule() });
    const pos = rookBoard();
    useGameStore.setState({
      position: pos,
      positionCounts: { [positionHash(pos)]: 1 },
      positionHistory: [],
      positionCountsHistory: [],
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
    });
  });

  it('配置が戻っても、ルークが動いて権利が変わっていれば成立しない', () => {
    roundTrip();
    // 粗い印では 2 回目だが、キャスリングの権利が違うので同じ局面ではない
    expect(useGameStore.getState().status).toBe('playing');
  });

  it('権利まで同じ形が 2 回目になったら成立する', () => {
    roundTrip();
    // ルークが動いたあとの形は、2 周目の 1 手目でもう 2 回目になる
    // （権利はどちらも「ルークは動いた後」で揃っているため）。
    const st = useGameStore.getState();
    st.selectSquare({ row: 7, col: 7 });
    expect(st.tryMove({ row: 6, col: 7 })).toBe(true);
    expect(useGameStore.getState().status).toBe('sennichite');
  });
});

describe('9-4d 繰り返しのしきい値', () => {
  it('チェスは 3 回で主張・5 回で自動と書いている', () => {
    expect(chess.repetition).toMatchObject({ detection_threshold: 5, claim_threshold: 3 });
  });

  it('本将棋は主張を書かず、自動だけ（従来どおり）', () => {
    expect(hondou.repetition?.claim_threshold).toBeUndefined();
  });
});
