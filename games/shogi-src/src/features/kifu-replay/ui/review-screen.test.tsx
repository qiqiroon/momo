import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useKifuGuardStore } from '../../../core/store/kifu-guard';
import { generateLegalMoves } from '../../../core/engine';
import '../index';
import { discardKifu, kifuMemoryState, loadLastKifu, markKifuSaved } from '../storage';
import { setReviewTarget } from '../review';
import { ReviewScreen } from './ReviewScreen';

/**
 * 感想戦画面 (S11)。意味論の正典＝親 v1.42 §9.4・画面の要件＝画面機能 v0.37 §3 S11。
 *
 * ここで固定したいのは、**設計で決めたことのうち、壊れても画面を見ただけでは
 * 気づきにくいもの**。
 *   - **記録を作らない**＝分岐で何をしても記憶は動かない（保存済みの印も消えない）
 *   - **手番の縛りが無い**＝どちらの駒でも掴める。ただし**合法手だけ**
 *   - **「次へ」は分岐を捨てて本譜の次の一手**／**「戻す」は分岐 → 本譜の順**
 *   - **離れるときは入る前の盤をそのまま戻す**（呼び出し元が指し掛けに見えないように）
 *   - **戻るは入ってきた画面へ**（S08 の「常にモード選択」とは扱いが違う）
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

/** 終局まで進めて、未保存の棋譜を記憶に置く（＝感想戦の対象ができる）。 */
function finishedGame(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  playMoves(moves);
  useGameStore.getState().resign('player2');
}

/** 記憶している 1 局で感想戦へ入る用意をする。 */
function enterFrom(from: 'game' | 'kifu-replay' | 'lobby'): void {
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  setReviewTarget(file, from);
}

/** 盤のマス。反転なし（viewerSide が player1）なので index = 段 * 9 + 筋。 */
function squareAt(container: HTMLElement, row: number, col: number): Element {
  const all = container.querySelectorAll('.board .sq');
  return all[row * 9 + col];
}

beforeEach(() => {
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'review' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S11 入ったところ', () => {
  beforeEach(() => {
    finishedGame(6);
    enterFrom('game');
  });

  it('0 手目（初期配置）から始まり、画面名が出ている', () => {
    render(<ReviewScreen />);
    expect(screen.getByText('感想戦')).toBeInTheDocument();
    expect(screen.getByText('0 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().position.history).toHaveLength(0);
  });

  it('★入っただけでは記憶に触らない（感想戦は破棄の契機ではない）', () => {
    markKifuSaved();
    const { unmount } = render(<ReviewScreen />);
    expect(kifuMemoryState()).toBe('saved');
    unmount();
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
  });
});

describe('S11 どちらの駒でも指せる（手番の縛りが無い）', () => {
  beforeEach(() => {
    finishedGame(6);
    enterFrom('game');
  });

  it('★手番でない側の駒も掴める（掴んだ側の手番になる）', () => {
    const { container } = render(<ReviewScreen />);
    // 0 手目の手番は先手 (player1)。上段の後手 (player2) の歩に触れる。
    expect(useGameStore.getState().position.sideToMove).toBe('player1');
    fireEvent.click(squareAt(container, 2, 4));

    expect(useGameStore.getState().selectedSquare).toEqual({ row: 2, col: 4 });
    expect(useGameStore.getState().position.sideToMove).toBe('player2');
  });

  it('★指せるのは合法手だけ（盤面編集ではない）', () => {
    const { container } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 2, 4));
    // 歩は 1 マス前へしか行けない。**2 マス先を押しても、そこへは置けない**
    // （対局画面と同じく、行けない空きマスを押すと持っていた駒を放す）。
    fireEvent.click(squareAt(container, 4, 4));
    expect(useGameStore.getState().moveHistory).toHaveLength(0);
    expect(useGameStore.getState().selectedSquare).toBeNull();

    // 行ける先なら指せる。
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(useGameStore.getState().moveHistory).toHaveLength(1);
  });

  it('★分岐しても記憶は変わらない（盤 → 記録は作らない）', () => {
    markKifuSaved();
    const { container, unmount } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(useGameStore.getState().moveHistory).toHaveLength(1);

    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
    unmount();
    // 離れたあとも印は「保存済み」のまま＝分岐が新しい対局として記録されていない。
    expect(kifuMemoryState()).toBe('saved');
    expect(loadLastKifu()?.moves).toHaveLength(6);
  });

  it('分岐中は盤の外枠が破線になり、「本譜へ」と保存の注記が出る', () => {
    const { container } = render(<ReviewScreen />);
    expect(container.querySelector('.board-outer.branching')).toBeNull();
    expect(screen.queryByText('本譜へ')).not.toBeInTheDocument();

    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));

    expect(container.querySelector('.board-outer.branching')).not.toBeNull();
    expect(screen.getByText('本譜へ')).toBeInTheDocument();
    expect(screen.getByText('本譜を保存します（分岐は入りません）')).toBeInTheDocument();
    // 手数の数え方は本譜と分けて出す（本譜 0 手＋分岐 1 手）。
    expect(screen.getByText(/0 \/ 6/)).toBeInTheDocument();
  });

  it('分岐の手は手数リストに枝として出る（番号を振らない）', () => {
    const { container } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));

    const br = container.querySelector('.mv.br');
    expect(br).not.toBeNull();
    expect(br?.querySelector('.no')?.textContent).toBe('└');
    expect(screen.getByText('分岐')).toBeInTheDocument();
  });
});

describe('S11 進める・戻す', () => {
  beforeEach(() => {
    finishedGame(6);
    enterFrom('game');
  });

  it('★「次へ」は分岐を捨てて、本譜の次の一手を指す', () => {
    const { container } = render(<ReviewScreen />);
    fireEvent.click(screen.getByText('▶'));
    fireEvent.click(screen.getByText('▶'));
    expect(screen.getByText('2 / 6')).toBeInTheDocument();

    // 2 手目から分岐する
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(useGameStore.getState().moveHistory).toHaveLength(3);

    // 「次へ」＝分岐は消え、本譜 3 手目の局面になる（尋ねない）
    fireEvent.click(screen.getByText('▶'));
    expect(screen.getByText('3 / 6')).toBeInTheDocument();
    expect(useGameStore.getState().moveHistory).toHaveLength(3);
    expect(container.querySelector('.board-outer.branching')).toBeNull();
    const honpu = loadLastKifu();
    expect(useGameStore.getState().position.history).toHaveLength(3);
    expect(honpu?.moves).toHaveLength(6);
  });

  it('★「戻す」は分岐の手を先に戻し、無くなったら本譜を戻す', () => {
    const { container } = render(<ReviewScreen />);
    fireEvent.click(screen.getByText('▶'));
    fireEvent.click(screen.getByText('▶'));

    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(useGameStore.getState().moveHistory).toHaveLength(3);

    // 1 回目＝分岐の 1 手が戻る（本譜の手数は動かない）
    fireEvent.click(screen.getByText('◀'));
    expect(useGameStore.getState().moveHistory).toHaveLength(2);
    expect(screen.getByText('2 / 6')).toBeInTheDocument();

    // 2 回目＝本譜が 1 手戻る
    fireEvent.click(screen.getByText('◀'));
    expect(screen.getByText('1 / 6')).toBeInTheDocument();
  });

  it('分岐した手は何手でも戻せる', () => {
    const { container } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    fireEvent.click(squareAt(container, 6, 2));
    fireEvent.click(squareAt(container, 5, 2));
    expect(useGameStore.getState().moveHistory).toHaveLength(2);

    fireEvent.click(screen.getByText('◀'));
    fireEvent.click(screen.getByText('◀'));
    expect(useGameStore.getState().moveHistory).toHaveLength(0);
    expect(screen.getByText('0 / 6')).toBeInTheDocument();
  });
});

describe('S11 画面を離れるとき', () => {
  it('★入る前の盤をそのまま戻す（呼び出し元が指し掛けに見えない）', () => {
    finishedGame(6);
    enterFrom('game');
    const before = useGameStore.getState().status;
    expect(before).not.toBe('playing');

    const { container, unmount } = render(<ReviewScreen />);
    fireEvent.click(squareAt(container, 2, 4));
    fireEvent.click(squareAt(container, 3, 4));
    expect(useGameStore.getState().status).toBe('playing');

    unmount();
    expect(useGameStore.getState().position.history).toHaveLength(6);
    expect(useGameStore.getState().status).toBe(before);
  });

  it('★戻るは入ってきた画面へ（結果／棋譜再生／モード選択）', () => {
    finishedGame(6);

    enterFrom('game');
    const a = render(<ReviewScreen />);
    fireEvent.click(screen.getByText('結果へ'));
    expect(useRouteStore.getState().screen).toBe('game');
    a.unmount();

    useRouteStore.setState({ screen: 'review' });
    enterFrom('kifu-replay');
    const b = render(<ReviewScreen />);
    fireEvent.click(screen.getByText('棋譜再生へ'));
    expect(useRouteStore.getState().screen).toBe('kifu-replay');
    b.unmount();

    useRouteStore.setState({ screen: 'review' });
    enterFrom('lobby');
    render(<ReviewScreen />);
    fireEvent.click(screen.getByText('モード選択'));
    expect(useRouteStore.getState().screen).toBe('lobby');
  });
});
