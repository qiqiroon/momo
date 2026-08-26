/**
 * 引き分けの主張（親 v1.65 §3.10.0 `claim`・チェス §5.5.5・第 9 段 9-4d）。
 *
 * 押さえたいことは 4 つ。
 * 1. **主張は申し出とは別物**＝相手の同意なしにその場で引き分けになる
 * 2. **条件を満たしているときだけ**主張できる（満たしていなければ何も起きない）
 * 3. **条件が立ち上がった瞬間に 1 度だけ尋ねる**（断ってもボタンからは主張できる）
 * 4. **主張を書いていないルールでは、手立てそのものが現れない**（将棋は従来どおり）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { chess, hondou } from '../mgf/loader';
import type { Mgf } from '../mgf/types';
import type { PieceInstance, Position } from '../position/types';
import { drawClaimAvailable } from './draw-claim';
import { positionHash } from '../position/hash';
import { useGameStore, winnerOf } from '../../store/game-store';

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

/**
 * 王 2 枚とナイト 1 枚ずつの盤（同じ形を何度でも作り直せる）。
 *
 * ★**往復させるのはナイト**＝**王とルークを動かすと、その 1 手目でキャスリングの
 * 権利が変わり、同じ配置に戻っても「同じ局面」ではなくなる**（§4.2.1・実装はそれを
 * 正しく弾く）。**繰り返しそのものを確かめたいので、権利の動かない駒で往復させる。**
 */
function shuffleBoard(): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  board[7][0] = mk('king', 'player1', 7, 0);
  board[7][6] = mk('knight', 'player1', 7, 6);
  board[0][4] = mk('king', 'player2', 0, 4);
  board[0][1] = mk('knight', 'player2', 0, 1);
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

/** その局面から始める（印の数えも 1 から始め直す＝実際の対局と同じ形にする）。 */
function startFrom(pos: Position) {
  useGameStore.setState({
    position: pos,
    positionCounts: { [positionHash(pos)]: 1 },
    positionHistory: [],
    positionCountsHistory: [],
    selectedSquare: null,
    selectedHandPieceId: null,
    legalDestinations: [],
  });
}

/** ナイトを往復させて、元の形へ戻る 4 手を指す。 */
function shuffleOnce() {
  const st = useGameStore.getState();
  st.selectSquare({ row: 7, col: 6 });
  expect(st.tryMove({ row: 5, col: 5 })).toBe(true);
  st.selectSquare({ row: 0, col: 1 });
  expect(st.tryMove({ row: 2, col: 2 })).toBe(true);
  st.selectSquare({ row: 5, col: 5 });
  expect(st.tryMove({ row: 7, col: 6 })).toBe(true);
  st.selectSquare({ row: 2, col: 2 });
  expect(st.tryMove({ row: 0, col: 1 })).toBe(true);
}

describe('9-4d 引き分けの主張（同じ形の繰り返し）', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess });
    startFrom(shuffleBoard());
  });

  it('3 回目に届くまでは主張できない', () => {
    expect(useGameStore.getState().claimableDraw).toBeNull();
    shuffleOnce(); // 2 回目
    expect(useGameStore.getState().claimableDraw).toBeNull();
  });

  it('3 回目に届いたら主張でき、押すと相手の同意なしで引き分けになる', () => {
    shuffleOnce();
    shuffleOnce(); // 3 回目
    const mid = useGameStore.getState();
    expect(mid.claimableDraw).toBe('repetition');
    expect(mid.status).toBe('playing'); // 自動では終わらない（自動は 5 回）

    expect(mid.claimDraw('player1')).toBe(true);
    const s = useGameStore.getState();
    expect(s.status).toBe('sennichite');
    expect(winnerOf(s.status, s.position.sideToMove)).toBeNull();
    // 相手と観戦者へ知らせる印が立つ（送るのは画面側の 1 か所）
    expect(s.drawClaimAnnounce).toEqual({ side: 'player1', reason: 'repetition' });
  });

  it('条件を満たしていなければ、押しても何も起きない', () => {
    const st = useGameStore.getState();
    expect(st.claimDraw('player1')).toBe(false);
    expect(useGameStore.getState().status).toBe('playing');
  });

  it('主張できるようになった立ち上がりで 1 度だけ尋ねる', () => {
    shuffleOnce();
    expect(useGameStore.getState().drawClaimPromptSide).toBeNull();
    shuffleOnce();
    // 尋ねる相手は「いま手番の側」
    const s = useGameStore.getState();
    expect(s.drawClaimPromptSide).toBe(s.position.sideToMove);
  });

  it('一度断ったら、条件が続いていても尋ね直さない（急かさない）', () => {
    shuffleOnce();
    shuffleOnce();
    expect(useGameStore.getState().drawClaimPromptSide).not.toBeNull();
    useGameStore.getState().setDrawClaimPrompt(null); // 「しない」と答えた
    shuffleOnce(); // 4 回目＝条件は続いている
    const s = useGameStore.getState();
    expect(s.claimableDraw).toBe('repetition'); // ボタンからはいつでも主張できる
    expect(s.drawClaimPromptSide).toBeNull(); // が、尋ね直しはしない
  });

  it('形が変わって主張できなくなったら、尋ねる印も下りる', () => {
    shuffleOnce();
    shuffleOnce();
    expect(useGameStore.getState().drawClaimPromptSide).not.toBeNull();
    const st = useGameStore.getState();
    // **往復に使っていないマスへ**動かす＝行き来していたマスへ戻すと、そちらも
    // 3 回目なので主張できるままになる（繰り返しは形ごとに数える）。
    st.selectSquare({ row: 7, col: 6 });
    expect(st.tryMove({ row: 6, col: 4 })).toBe(true);
    const s = useGameStore.getState();
    expect(s.claimableDraw).toBeNull();
    expect(s.drawClaimPromptSide).toBeNull();
  });

  it('届いた主張はそのまま適用する（数え直して突き合わせない）', () => {
    useGameStore.getState().applyRemoteDrawClaim('move_limit');
    expect(useGameStore.getState().status).toBe('move_limit');
  });
});

describe('9-4d 引き分けの主張（無進展手数）', () => {
  /** 主張は 1 手（＝2 手分）から・自動は遠くに置いたチェス。 */
  function earlyClaimRule(): Mgf {
    const rule = JSON.parse(JSON.stringify(chess)) as Mgf;
    rule.victory!.move_limit = { claim_at: 1, auto_at: 100, reset_on: ['pawn'], trigger: 'claim' };
    return rule;
  }

  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: earlyClaimRule() });
    startFrom(shuffleBoard());
  });

  it('手数が届いたら主張でき、押すと無進展の引き分けになる', () => {
    const st = useGameStore.getState();
    st.selectSquare({ row: 7, col: 6 });
    expect(st.tryMove({ row: 5, col: 5 })).toBe(true);
    expect(useGameStore.getState().claimableDraw).toBeNull(); // まだ 1 手ぶん
    st.selectSquare({ row: 0, col: 1 });
    expect(st.tryMove({ row: 2, col: 2 })).toBe(true);

    const mid = useGameStore.getState();
    expect(mid.claimableDraw).toBe('move_limit');
    expect(mid.status).toBe('playing');
    expect(mid.claimDraw('player2')).toBe(true);

    const s = useGameStore.getState();
    expect(s.status).toBe('move_limit');
    expect(s.drawClaimAnnounce).toEqual({ side: 'player2', reason: 'move_limit' });
  });
});

describe('9-4d 引き分けの主張（書いていないルールでは現れない）', () => {
  it('本将棋は主張の回数も手数も書いていないので、常に主張できない', () => {
    const pos = shuffleBoard();
    const counts = { [positionHash(pos)]: 99 };
    expect(drawClaimAvailable(hondou, [pos, pos, pos], pos, counts)).toBeNull();
  });

  it('チェスは書いてあるので、届けば主張できる', () => {
    const pos = shuffleBoard();
    const counts = { [positionHash(pos)]: 3 };
    expect(drawClaimAvailable(chess, [pos, pos], pos, counts)).toBe('repetition');
  });

  it('粗い印が届いていても、遡って権利が違えば主張できない', () => {
    const pos = shuffleBoard();
    // 王が動いて戻ってきた並びを持つ局面は、キャスリングの権利が違う＝同じ形ではない
    const movedBack: Position = {
      ...pos,
      history: [
        { type: 'move', pieceId: 'player1-king-7-0', from: { row: 7, col: 0 }, to: { row: 6, col: 0 }, promote: false },
        { type: 'move', pieceId: 'player2-knight-0-1', from: { row: 0, col: 1 }, to: { row: 2, col: 2 }, promote: false },
        { type: 'move', pieceId: 'player1-king-6-0', from: { row: 6, col: 0 }, to: { row: 7, col: 0 }, promote: false },
        { type: 'move', pieceId: 'player2-knight-2-2', from: { row: 2, col: 2 }, to: { row: 0, col: 1 }, promote: false },
      ],
    };
    const counts = { [positionHash(pos)]: 3 };
    // 粗い印では 3 回だが、権利の同じ局面は 1 回しかない
    expect(drawClaimAvailable(chess, [movedBack, movedBack], pos, counts)).toBeNull();
  });
});
