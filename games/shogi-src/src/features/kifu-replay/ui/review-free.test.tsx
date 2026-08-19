import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useKifuGuardStore } from '../../../core/store/kifu-guard';
import { generateLegalMoves } from '../../../core/engine';
import '../index';
import { discardKifu, loadLastKifu, markKifuSaved, kifuMemoryState } from '../storage';
import { setReviewTarget } from '../review';
import { useReviewShareStore } from '../review-share';
import { ReviewScreen } from './ReviewScreen';

/**
 * ★v1.55: 感想戦で**盤を自由に組み替える**（親 v1.49 §9.4.2.1）と、
 * **ハイライト**（同 §9.4.2.2）。
 *
 * ここで固定したいのは、**壊れても画面を見ただけでは気づきにくいもの**。
 *   - **合法でない置き方も通る**（王手を無視して指す・盤から盤へ移す・ルールを
 *     無視して打つ）＝弾かれると「動かないだけ」に見えて原因が読めない
 *   - **組み替えも 1 手として積む**＝**「戻す」で 1 つずつ戻せる**／**分岐に数えられる**
 *   - **記録は作らない**＝どれだけ組み替えても記憶は動かない（保存済みの印も消えない）
 *   - **ハイライトは盤が動くと消える**
 *
 * ★**下ごしらえで前の状態を消さない**＝記憶している 1 局を残したまま始める
 * （検査の下ごしらえが本番に無い工程を肩代わりしないため）。
 */

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

function enterFromGame(): void {
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  setReviewTarget(file, 'game');
}

/** 盤のマス。反転なし（viewerSide が player1）なので index = 段 * 9 + 筋。 */
function squareAt(container: HTMLElement, row: number, col: number): Element {
  return container.querySelectorAll('.board .sq')[row * 9 + col];
}

/** 自由な操作の的（掴んでいる間だけ出る）。 */
function target(container: HTMLElement, label: string): HTMLElement {
  const b = [...container.querySelectorAll('.free-targets .ft')].find(
    (x) => x.textContent === label,
  );
  if (!b) throw new Error(`的が見つからない: ${label}`);
  return b as HTMLElement;
}

beforeEach(() => {
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'review' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, pending: null });
  useReviewShareStore.setState({ role: null, ready: true, incoming: null, mark: null, migrating: false });
  finishedGame(6);
  enterFromGame();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('★v1.55 盤を自由に組み替える（親 §9.4.2.1）', () => {
  it('★合法でないマスへも置ける（v1.54 までは動かなかった）', () => {
    const view = render(<ReviewScreen />);

    // 先手の歩（6 段目 4 筋）を掴んで、2 段先の空きマスへ置く＝歩の動き方では届かない。
    fireEvent.click(squareAt(view.container, 6, 4));
    expect(useGameStore.getState().selectedSquare).not.toBeNull();
    fireEvent.click(squareAt(view.container, 4, 4));

    const pos = useGameStore.getState().position;
    expect(pos.board[4][4]?.kind).toBe('fu');
    expect(pos.board[6][4]).toBeNull();
    // **1 手として積まれる**＝分岐に数えられ、相手にもそのまま渡る形になる。
    expect(pos.history).toHaveLength(1);
    expect(pos.history[0].type).toBe('free');
    view.unmount();
  });

  it('★盤の駒をどちらの駒台へでも移せる（相手の駒台にも）', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(target(view.container, '後手の駒台'));

    const pos = useGameStore.getState().position;
    expect(pos.board[6][4]).toBeNull();
    // **相手の駒台へ渡せる**＝自分の駒でも相手の駒でも同じに扱う。
    expect(pos.hands.player2.some((p) => p.kind === 'fu')).toBe(true);
    view.unmount();
  });

  it('★駒を消せる（盤からも駒台からも取り除く）', () => {
    const view = render(<ReviewScreen />);
    const before = useGameStore.getState().position.hands.player1.length;

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(target(view.container, '消す'));

    const pos = useGameStore.getState().position;
    expect(pos.board[6][4]).toBeNull();
    // **どこにも行かない**＝駒台にも増えない。
    expect(pos.hands.player1).toHaveLength(before);
    expect(pos.hands.player2.some((p) => p.kind === 'fu')).toBe(false);
    view.unmount();
  });

  it('★成りと不成を切り替えられる', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(target(view.container, '成る'));

    expect(useGameStore.getState().position.board[6][4]?.promoted).toBe(true);

    // 戻す方向も同じ的から。
    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(target(view.container, '不成に'));
    expect(useGameStore.getState().position.board[6][4]?.promoted).toBe(false);
    view.unmount();
  });

  it('★「戻す」で 1 つずつ戻る（組み替えも手として積まれている）', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(squareAt(view.container, 4, 4));
    expect(useGameStore.getState().position.board[4][4]?.kind).toBe('fu');

    const back = [...view.container.querySelectorAll('.playbar button')].find(
      (b) => b.textContent === '◀',
    ) as HTMLElement;
    fireEvent.click(back);

    const pos = useGameStore.getState().position;
    expect(pos.board[6][4]?.kind).toBe('fu');
    expect(pos.board[4][4]).toBeNull();
    view.unmount();
  });

  it('★どれだけ組み替えても記憶は動かない（記録を作らない）', () => {
    markKifuSaved();
    const before = loadLastKifu();
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(squareAt(view.container, 4, 4));
    fireEvent.click(squareAt(view.container, 4, 4));
    fireEvent.click(target(view.container, '消す'));

    expect(loadLastKifu()?.moves).toEqual(before?.moves);
    // **保存済みの印も消えない**（親 §9.4.3）。
    expect(kifuMemoryState()).toBe('saved');
    view.unmount();
  });

  it('★手数リストに、組み替えの言葉で 1 行出る', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(target(view.container, '後手の駒台'));

    expect(useGameStore.getState().moveHistory[0]).toContain('後手の駒台');
    view.unmount();
  });
});

describe('★v1.55 ハイライト（親 §9.4.2.2）', () => {
  it('★何もないマスを触ると印が付き、別のマスを触ると移る（印は常に 1 つ）', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 4, 4));
    expect(view.container.querySelectorAll('.sq.review-mark')).toHaveLength(1);
    expect(squareAt(view.container, 4, 4).className).toContain('review-mark');

    fireEvent.click(squareAt(view.container, 3, 2));
    expect(view.container.querySelectorAll('.sq.review-mark')).toHaveLength(1);
    expect(squareAt(view.container, 3, 2).className).toContain('review-mark');
    view.unmount();
  });

  it('★盤が動くと印は消える', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 4, 4));
    expect(view.container.querySelectorAll('.sq.review-mark')).toHaveLength(1);

    // 1 手指す（合法手）。
    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(squareAt(view.container, 5, 4));

    expect(view.container.querySelectorAll('.sq.review-mark')).toHaveLength(0);
    view.unmount();
  });

  it('★駒を持って同じマスへ戻したときも印が付く（駒のあるマスを指し示す手立て）', () => {
    const view = render(<ReviewScreen />);

    fireEvent.click(squareAt(view.container, 6, 4));
    fireEvent.click(squareAt(view.container, 6, 4));

    expect(squareAt(view.container, 6, 4).className).toContain('review-mark');
    expect(useGameStore.getState().selectedSquare).toBeNull();
    view.unmount();
  });
});

describe('★v1.55 王手（親 §9.4.2.1）', () => {
  it('王手は画面に出す（ただし無視して指せる）', () => {
    // 後手の王に王手がかかった形を作る＝盤を自由に組み替えて作れる。
    const view = render(<ReviewScreen />);
    fireEvent.click(squareAt(view.container, 6, 4));
    // 後手の王の目の前（1 段目 4 筋の下）へ歩を置く。
    fireEvent.click(squareAt(view.container, 1, 4));

    expect(screen.getAllByText('（王手）').length).toBeGreaterThan(0);
    view.unmount();
  });
});
