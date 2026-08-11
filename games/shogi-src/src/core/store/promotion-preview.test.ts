import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './game-store';
import type { Position } from '../engine';
import '../../features/quantum/index';

/**
 * 成る/成らずの選択肢は「その手を指した後の候補」で出す (v1.11)。
 *
 * 動くこと自体が候補を狭めるので、動く前の候補を並べるとその手ではあり得ない駒が
 * 選択肢に出てしまう。成る側はさらに「成れない駒 (王・金) ではあり得ない」で狭まる。
 */
describe('成り確認の候補 (v1.11)', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ quantum: true });
  });

  /** 先手の未確定駒を 5 六 (3,4) に移し、その 1 マス前 (2,4) を空ける。 */
  function stageForwardStepIntoZone(): void {
    const pos = useGameStore.getState().position;
    const mover = pos.board[6][4]!;
    const board = pos.board.map((r) => r.slice());
    board[6][4] = null;
    board[2][4] = null; // 後手の駒をどかして、取らずに進めるようにする
    board[3][4] = mover;
    const staged: Position = { ...pos, board, sideToMove: 'player1' };
    useGameStore.setState({
      position: staged,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      status: 'playing',
    });
  }

  it('真っすぐ 1 マス前に進んだ手では、その動きを説明できない駒が選択肢から消える', () => {
    stageForwardStepIntoZone();
    const st = useGameStore.getState();
    st.selectSquare({ row: 3, col: 4 });
    st.tryMove({ row: 2, col: 4 });

    const pending = useGameStore.getState().pendingPromotion;
    expect(pending).not.toBeNull();

    const kinds = new Set(pending!.candidateKinds);
    // 前 1 マスを説明できる駒だけが残る
    expect(kinds).toEqual(new Set(['ou', 'hi', 'kin', 'gin', 'kyo', 'fu']));
    // 角は斜めしか動けない・桂は跳ぶしかないので、この手では説明できない
    expect(kinds.has('kaku')).toBe(false);
    expect(kinds.has('kei')).toBe(false);
  });

  it('成る側は、成れない駒 (王・金) が落ちた候補になる', () => {
    stageForwardStepIntoZone();
    const st = useGameStore.getState();
    st.selectSquare({ row: 3, col: 4 });
    st.tryMove({ row: 2, col: 4 });

    const pending = useGameStore.getState().pendingPromotion!;
    const promoted = new Set(pending.promotedCandidateKinds);

    expect(promoted).toEqual(new Set(['ryu', 'narigin', 'narikyo', 'to']));
    // 王・金は成れないので、成った姿はあり得ない
    expect(promoted.has('ou')).toBe(false);
    expect(promoted.has('kin')).toBe(false);
  });

  it('候補は強さの降順で並ぶ (盤の巡回表示と同じ順)', () => {
    stageForwardStepIntoZone();
    const st = useGameStore.getState();
    st.selectSquare({ row: 3, col: 4 });
    st.tryMove({ row: 2, col: 4 });

    const pending = useGameStore.getState().pendingPromotion!;
    expect(pending.candidateKinds).toEqual(['ou', 'hi', 'kin', 'gin', 'kyo', 'fu']);
    expect(pending.promotedCandidateKinds).toEqual(['ryu', 'narigin', 'narikyo', 'to']);
  });

  it('本将棋モードでは従来どおり 1 個ずつ (歩 → と)', () => {
    useGameStore.getState().reset({ quantum: false });
    const pos = useGameStore.getState().position;
    const board = pos.board.map((r) => r.slice());
    const mover = board[6][4]!;
    board[6][4] = null;
    board[2][4] = null;
    board[3][4] = mover;
    useGameStore.setState({
      position: { ...pos, board, sideToMove: 'player1' },
      selectedSquare: null,
      legalDestinations: [],
      pendingPromotion: null,
      status: 'playing',
    });

    const st = useGameStore.getState();
    st.selectSquare({ row: 3, col: 4 });
    st.tryMove({ row: 2, col: 4 });

    const pending = useGameStore.getState().pendingPromotion!;
    expect(pending.candidateKinds).toEqual(['fu']);
    expect(pending.promotedCandidateKinds).toEqual(['to']);
  });
});
