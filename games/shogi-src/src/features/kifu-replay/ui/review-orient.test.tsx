import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useKifuGuardStore } from '../../../core/store/kifu-guard';
import { generateLegalMoves } from '../../../core/engine';
import '../index';
import { adoptLoadedKifu } from '../index';
import {
  discardKifu,
  lastKifuIsOwnGame,
  loadLastKifu,
  markKifuSaved,
  rememberKifu,
} from '../storage';
import { setReviewMySide, setReviewTarget } from '../review';
import { useReviewShareStore } from '../review-share';
import type { KifuFile } from '../types';
import { ReviewScreen } from './ReviewScreen';
import { KifuReplayScreen } from './KifuReplayScreen';

/**
 * ★v1.57: **盤をどちら側から見るか**（親 v1.51 §9.2.5・§6.3.6）と、
 * **盤の位置を操作の行に決めさせない**（付録D-12 v1.6 §2）。
 *
 * ここで固定したいのは、**壊れても手元では気づきにくいもの**。
 *   - **自分の対局を振り返るときは自分の側が手前**＝二人のときは**それぞれ違う向き**に
 *     なるので、**1 台では絶対に気づけない**（実機で「ゲストの盤だけ上下が逆」として
 *     現れた不具合＝2026-08-19 ご報告）
 *   - **その「自分の側」は控えたものを使う**＝部屋を移ると先後は消えるので、
 *     その場で聞きに行く作りへ戻すと**また逆さになる**
 *   - **外から読み込んだ棋譜は先手が下**（S08 と S11 で同じ）
 *   - **見出しと操作の行は列の外**＝行が伸び縮みしても盤が動かない
 *
 * ★**下ごしらえで前の状態を消さない**＝記憶している 1 局を残したまま始める
 * （検査の下ごしらえが本番に無い工程を肩代わりしないため）。
 */

/** 決まった順で指す（乱数を使わない＝落ちたとき再現できる）。 */
function playMoves(count: number): void {
  for (let i = 0; i < count; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') return;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) return;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) return;
  }
}

function finishedGame(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  playMoves(moves);
  useGameStore.getState().resign('player2');
}

/**
 * 記憶している 1 局を「ネット対戦の棋譜」に仕立てる。
 * `viewerSide` は**書き出した人から見た向き**なので、ホストが配るとゲストにもこれが届く。
 */
function rememberedAs(viewerSide: 'player1' | 'player2', own: boolean): KifuFile {
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  const shaped: KifuFile = { ...file, meta: { ...file.meta, viewerSide } };
  rememberKifu(shaped, 'unsaved', own);
  return shaped;
}

/** 盤が上下逆に出ているか（付録D-12 §4）。 */
function flipped(container: HTMLElement): boolean {
  return container.querySelector('.board-with-coords.flipped') !== null;
}

/** 二人の感想戦に居る状態にする（通信そのものは通さない）。 */
function inSharedReview(role: 'host' | 'guest'): void {
  useReviewShareStore.setState({
    role,
    opponentName: '相手',
    opponentPresent: true,
    ready: true,
    incoming: null,
    notice: null,
    migrating: false,
    ownsRoom: role === 'host',
  });
}

beforeEach(() => {
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'review' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  useReviewShareStore.setState({ role: null, ready: false, migrating: false, incoming: null });
  setReviewMySide(null);
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  useReviewShareStore.setState({ role: null, ready: false, migrating: false, incoming: null });
  setReviewMySide(null);
});

describe('S11 二人の感想戦：盤はそれぞれ自分の側から見る（親 §6.3.6／§9.2.5）', () => {
  beforeEach(() => finishedGame(6));

  it('★後手だったゲストの盤は上下が逆になる（配られた棋譜はホストの向き）', () => {
    // 配られる棋譜はホスト（先手）が書き出したもの。
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);
    // ★対局の部屋を出る前に控えた「自分の側」。移った先ではこれしか手掛かりが無い。
    setReviewMySide('player2');
    inSharedReview('guest');

    const { container } = render(<ReviewScreen />);
    expect(flipped(container)).toBe(true);
  });

  it('先手だったホストの盤はそのまま（同じ 1 局が二人で違う向きに出る）', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);
    setReviewMySide('player1');
    inSharedReview('host');

    const { container } = render(<ReviewScreen />);
    expect(flipped(container)).toBe(false);
  });

  it('★控えが無ければ棋譜の向きに落ちる（控える工程を外すと逆さに戻る）', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);
    // 部屋を移ると先後は消える＝控えていなければ聞く先が無い、という状態。
    setReviewMySide(null);
    inSharedReview('guest');

    const { container } = render(<ReviewScreen />);
    // ホストの向き（先手が下）のまま出る＝これが v1.55〜v1.56 の不具合の姿。
    expect(flipped(container)).toBe(false);
  });
});

describe('S11 読み込んだ棋譜は先手が下（親 §9.2.5）', () => {
  beforeEach(() => finishedGame(6));

  it('★後手から書き出された棋譜でも、読み込んだものなら上下は逆にならない', () => {
    const file = rememberedAs('player2', false);
    setReviewTarget(file, 'lobby', false);

    const { container } = render(<ReviewScreen />);
    expect(flipped(container)).toBe(false);
  });

  it('自分の対局なら、後手の側から見た盤になる', () => {
    const file = rememberedAs('player2', true);
    setReviewTarget(file, 'game', true);

    const { container } = render(<ReviewScreen />);
    expect(flipped(container)).toBe(true);
  });
});

describe('S08 棋譜再生も同じ規定（親 §9.2.5・ユーザー判断＝2 つの画面で違う理屈を持たない）', () => {
  beforeEach(() => {
    finishedGame(6);
    useRouteStore.setState({ screen: 'kifu-replay' });
  });

  it('記憶している 1 局（自分の対局）は自分の側から見た盤になる', () => {
    rememberedAs('player2', true);
    const { container } = render(<KifuReplayScreen />);
    expect(flipped(container)).toBe(true);
  });

  it('★読み込んだ棋譜は先手が下（書き出した人の向きに従わない）', () => {
    const file = rememberedAs('player2', true);
    // 読み込みは記憶を置き換える。**このとき出どころも「読み込んだもの」に変わる**。
    adoptLoadedKifu(file);
    expect(lastKifuIsOwnGame()).toBe(false);

    const { container } = render(<KifuReplayScreen />);
    expect(flipped(container)).toBe(false);
  });
});

describe('棋譜の出どころは記憶と一緒に残る（親 §9.2.5）', () => {
  beforeEach(() => finishedGame(6));

  it('対局から生まれた 1 局は「自分の対局」', () => {
    expect(lastKifuIsOwnGame()).toBe(true);
  });

  it('★保存の印を付け替えても出どころは変わらない', () => {
    markKifuSaved();
    expect(lastKifuIsOwnGame()).toBe(true);

    const file = loadLastKifu();
    if (!file) throw new Error('棋譜が消えた');
    adoptLoadedKifu(file);
    markKifuSaved();
    expect(lastKifuIsOwnGame()).toBe(false);
  });

  it('出どころを持たない古い記憶は「自分の対局」として拾う（古い受け皿を捨てない）', () => {
    const file = loadLastKifu();
    if (!file) throw new Error('棋譜が消えた');
    localStorage.setItem('shogi.kifu.last', JSON.stringify({ mark: 'unsaved', file }));
    expect(lastKifuIsOwnGame()).toBe(true);
  });
});

describe('S11 盤の位置は操作の行に決めさせない（付録D-12 v1.6 §2）', () => {
  beforeEach(() => finishedGame(6));

  it('★見出しと操作の行は、盤の入っている列の外に置く', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);

    const { container } = render(<ReviewScreen />);
    const bar = container.querySelector('.s11-bar');
    const grid = container.querySelector('.grid');
    expect(bar).not.toBeNull();
    expect(grid).not.toBeNull();
    // 列の中に居ると、行の幅が列の幅を決めてしまい、**掴むたびに盤が左右に動く**。
    expect(grid?.contains(bar as Node)).toBe(false);
    // 盤のほうは列の中に居る（＝列の幅を決めるのは盤の側）。
    expect(grid?.querySelector('.board-with-coords')).not.toBeNull();
  });

  it('★再生の操作帯は右の列のいちばん上（盤と同じ高さから始まる）', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);

    const { container } = render(<ReviewScreen />);
    const col = container.querySelector('.moves-col');
    expect(col?.firstElementChild?.classList.contains('playbar')).toBe(true);
  });
});

/**
 * ★v1.58: **見ている人が上下を入れ替えられる**（親 v1.52 §9.2.5.1・
 * 画面機能 v0.46・付録D-8 v1.7 §3／D-12 v1.7 §3）。
 *
 * ここで固定したいのは、**壊れても手元では気づきにくいもの**。
 *   - **既定の向きは書き換わらない**＝入れ替えは上に重なるだけ
 *   - **画面に入るたび既定へ戻る**（ユーザー判断）＝残ると、次に別の棋譜を開いたときに
 *     **前の操作が効いたまま**になり、なぜ逆さなのかを人が説明できなくなる
 *   - **振り返る 1 局が差し替わったときも解ける**（向きが決まり直す瞬間だから）
 */
describe('★v1.58 盤の上下を入れ替える（親 §9.2.5.1）', () => {
  beforeEach(() => finishedGame(6));

  it('S11＝押すと上下が逆になり、もう一度押すと戻る', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);

    const { container, getByText } = render(<ReviewScreen />);
    expect(flipped(container)).toBe(false);

    fireEvent.click(getByText('盤反転'));
    expect(flipped(container)).toBe(true);

    fireEvent.click(getByText('盤反転'));
    expect(flipped(container)).toBe(false);
  });

  it('★S11＝画面に入り直すと既定の向きへ戻る（入れ替えは画面より長生きしない）', () => {
    const file = rememberedAs('player1', true);
    setReviewTarget(file, 'game', true);

    const first = render(<ReviewScreen />);
    fireEvent.click(first.getByText('盤反転'));
    expect(flipped(first.container)).toBe(true);
    first.unmount();

    const again = render(<ReviewScreen />);
    expect(flipped(again.container)).toBe(false);
  });

  it('★S11＝振り返る 1 局が差し替わると入れ替えは解ける（向きが決まり直す瞬間）', () => {
    const mine = rememberedAs('player1', true);
    setReviewTarget(mine, 'game', true);
    inSharedReview('guest');

    const { container, getByText } = render(<ReviewScreen />);
    fireEvent.click(getByText('盤反転'));
    expect(flipped(container)).toBe(true);

    // ホストが別の棋譜を読み込んで配り直した＝**読み込んだ棋譜なので先手が下**に戻る。
    const other: KifuFile = { ...mine, meta: { ...mine.meta, viewerSide: 'player2' } };
    act(() => {
      setReviewTarget(other, 'game', false);
      useReviewShareStore.setState({ incoming: { ply: 0, branch: [], seq: 1 } });
    });
    expect(flipped(container)).toBe(false);
  });

  it('S08＝押すと上下が逆になる（S11 とまったく同じ規定）', () => {
    rememberedAs('player1', true);
    useRouteStore.setState({ screen: 'kifu-replay' });

    const { container, getByText } = render(<KifuReplayScreen />);
    expect(flipped(container)).toBe(false);

    fireEvent.click(getByText('盤反転'));
    expect(flipped(container)).toBe(true);
  });

  it('★S08＝見出しと操作の行は、盤の入っている列の外に置く（S11 と同じ）', () => {
    rememberedAs('player1', true);
    useRouteStore.setState({ screen: 'kifu-replay' });

    const { container } = render(<KifuReplayScreen />);
    const bar = container.querySelector('.s08-toolbar');
    const grid = container.querySelector('.grid');
    expect(bar).not.toBeNull();
    expect(grid).not.toBeNull();
    // 列の中に居ると、**行の幅が列の幅を決める**＝棋譜の情報が長いと画面から
    // はみ出す（本番ビルドで実測＝窓幅 960px で 39px・900px で 99px）。
    expect(grid?.contains(bar as Node)).toBe(false);
    expect(grid?.querySelector('.board-with-coords')).not.toBeNull();
  });

  it('★S08＝画面に入り直すと既定の向きへ戻る', () => {
    rememberedAs('player1', true);
    useRouteStore.setState({ screen: 'kifu-replay' });

    const first = render(<KifuReplayScreen />);
    fireEvent.click(first.getByText('盤反転'));
    expect(flipped(first.container)).toBe(true);
    first.unmount();

    const again = render(<KifuReplayScreen />);
    expect(flipped(again.container)).toBe(false);
  });
});
