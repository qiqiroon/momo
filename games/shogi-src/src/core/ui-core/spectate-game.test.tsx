import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { register } from '../plugin/registry';
import { useI18nStore } from '../store/i18n-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { GameScreen } from './GameScreen';

/**
 * ★v1.55 観戦者から見た対局画面（親 §6.8.4・画面機能 v0.49 §3 S06）。
 *
 * ここで固定するのは 3 つ。
 *   - **手を出す操作を置かない**（投了・待った・引分・中断・威嚇。**灰色で置くのではなく置かない**）
 *   - **代わりに盤の上下を入れ替える手立てを置く**（対局者には置かない）
 *   - **観戦者の欄に人が並ぶ**（v1.54 までは常に空だった）
 */

interface SpecConnector {
  spectating: boolean;
  watchers: { pid: string; name: string }[];
  seatNames: { player1: string; player2: string } | null;
}

function registerConnector(over: Partial<SpecConnector> = {}) {
  const c: SpecConnector = {
    spectating: false,
    watchers: [],
    seatNames: null,
    ...over,
  };
  register('gameConnector', {
    isOnline: () => true,
    // ★観戦者は席を持たないので、どちらの側でもない（本物の connector と同じ）。
    getMySide: () => (c.spectating ? null : ('player1' as const)),
    getMyChatSide: () => 'player1' as const,
    getMyName: () => '太郎',
    getOpponentName: () => '花子',
    getActiveRules: () => null,
    isRuleSetter: () => false,
    getPendingRules: () => null,
    getPendingTimeControl: () => null,
    commitPendingToActive: () => {},
    sendMove: () => {},
    sendChat: () => {},
    subscribe: () => () => {},
    isSpectating: () => c.spectating,
    getSeatNames: () => c.seatNames,
    getSpectators: () => c.watchers,
    isSpectateWaiting: () => false,
    // 対局画面が読む残りの口（本筋ではないので当たり障りのない値を返す）。
    getOpponentLeftDuringGame: () => false,
    getWsPendingReconnect: () => false,
    getLastPeerMessageAt: () => null,
    isRoomHost: () => false,
    leaveOnline: () => {},
    markConnectionDead: () => {},
    markConnectionHealthy: () => {},
    returnToPreparation: () => {},
    sendAnomalyRaise: () => {},
    sendAnomalyVote: () => {},
    sendDrawCancel: () => {},
    sendDrawOffer: () => {},
    sendDrawResponse: () => {},
    sendPauseNotify: () => {},
    sendPing: () => {},
    sendResign: () => {},
    sendResumeOffer: () => {},
    sendResumeResponse: () => {},
    sendReview: () => {},
    sendTimeout: () => {},
    sendUndoCancel: () => {},
    sendUndoOffer: () => {},
    sendUndoResponse: () => {},
  });
}

beforeEach(() => {
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
  useGameStore.getState().reset({ gameType: 'shogi' });
});

afterEach(() => {
  register('gameConnector', undefined as never);
});

describe('S06 対局画面を観戦者から見たとき（v1.55）', () => {
  it('★手を出す操作を置かない（投了・待った・引分・中断・威嚇）', () => {
    registerConnector({ spectating: true });
    const view = render(<GameScreen variant="b" />);
    for (const label of ['投了', '待った', '引分', '中断', '威嚇']) {
      expect(
        screen.queryAllByRole('button').some((b) => (b.textContent ?? '').includes(label)),
      ).toBe(false);
    }
    view.unmount();
  });

  it('★代わりに盤の上下を入れ替える手立てを置く', () => {
    registerConnector({ spectating: true });
    const view = render(<GameScreen variant="b" />);
    expect(
      screen.queryAllByRole('button').some((b) => (b.textContent ?? '').includes('盤反転')),
    ).toBe(true);
    view.unmount();
  });

  it('★対局者には入れ替えの手立てを置かず、従来の操作がそのまま出る', () => {
    registerConnector({ spectating: false });
    const view = render(<GameScreen variant="b" />);
    expect(
      screen.queryAllByRole('button').some((b) => (b.textContent ?? '').includes('盤反転')),
    ).toBe(false);
    expect(
      screen.queryAllByRole('button').some((b) => (b.textContent ?? '').includes('投了')),
    ).toBe(true);
    view.unmount();
  });

  it('★観戦者の欄に人が並ぶ（v1.54 までは常に空だった）', () => {
    registerConnector({
      spectating: true,
      watchers: [
        { pid: 'v1', name: '見物人' },
        { pid: 'v2', name: '見物人2' },
      ],
    });
    const view = render(<GameScreen variant="b" />);
    expect(screen.getByText('見物人（観戦者）')).toBeTruthy();
    expect(screen.getByText('見物人2（観戦者）')).toBeTruthy();
    expect(screen.queryByText('観戦者はいません')).toBeNull();
    view.unmount();
  });

  it('★盤に並べ直したぶんを、画面へ来た拍子に消さない（2 台でしか出ない不具合）', () => {
    // 観戦者は画面へ来る**前に**、配られた対局を盤へ並べ直し終えている。
    const pawn = useGameStore.getState().position.board[6][2]!;
    useGameStore.getState().applyRemoteMove({
      kind: 'move',
      pieceId: pawn.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    });
    expect(useGameStore.getState().position.history).toHaveLength(1);

    registerConnector({ spectating: true });
    const view = render(<GameScreen variant="b" />);

    // ★ここで盤を作り直すと、**途中から入ったのに初期配置が出る**。
    expect(useGameStore.getState().position.history).toHaveLength(1);
    expect(useGameStore.getState().position.board[5][2]).not.toBeNull();
    view.unmount();
  });

  it('対局者のときは今までどおり、画面へ来たら盤を作り直す', () => {
    const pawn = useGameStore.getState().position.board[6][2]!;
    useGameStore.getState().applyRemoteMove({
      kind: 'move',
      pieceId: pawn.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    });
    registerConnector({ spectating: false });
    const view = render(<GameScreen variant="b" />);
    expect(useGameStore.getState().position.history).toHaveLength(0);
    view.unmount();
  });

  it('★終局しても観戦者には次アクションを出さない（他人の対局の始末・感想戦は二人で決める）', () => {
    registerConnector({ spectating: true });
    useGameStore.getState().resign('player1');
    const view = render(<GameScreen variant="b" />);
    // **終局パネルの中だけを見る**（同じ言葉がヘッダの戻る導線にもあるため）。
    const panel = view.container.querySelector('.floating-result') as HTMLElement;
    expect(panel).toBeTruthy();
    const labels = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent?.trim());
    // 残るのは「閉じる」だけ＝次アクションは 1 つも無い
    expect(labels).toEqual(['閉じる']);
    // **勝敗は見える**（見届けるために残るので減らさない）
    expect(panel.textContent).toContain('投了');
    // ★**観戦者に勝ち負けも相手も無い**＝「勝ち」「相手が投了」とは書かない
    //   （実サーバーで実際にそう出ていた・2026-08-21）。先手／後手の言い方にする。
    expect(panel.textContent).not.toContain('相手');
    expect(panel.textContent).toMatch(/先手|後手/);
    view.unmount();
  });

  it('対局者には終局の次アクションが今までどおり出る（縮退互換）', () => {
    registerConnector({ spectating: false });
    const view = render(<GameScreen variant="b" />);
    // ★対局者は**画面へ来た拍子に盤が作り直される**（従来どおり）ので、
    //   終わらせるのは描いたあと。観戦者側はそこが違う（上の検査）。
    act(() => {
      useGameStore.getState().resign('player2');
    });
    const panel = view.container.querySelector('.floating-result') as HTMLElement;
    const labels = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toContain('対局準備に戻る');
    expect(labels.length).toBeGreaterThan(1);
    view.unmount();
  });

  it('★観戦者には再戦の導線を出さず、退室は「観戦をやめる」にする', () => {
    registerConnector({ spectating: true });
    useGameStore.getState().resign('player1');
    const view = render(<GameScreen variant="b" />);
    const labels = screen.queryAllByRole('button').map((b) => (b.textContent ?? '').trim());
    // 再戦（対局準備に戻る）は対局者どうしの始末なので出さない
    expect(labels).not.toContain('対局準備に戻る');
    // 退室の言葉も立場に合わせる
    expect(labels).toContain('観戦をやめる');
    expect(labels).not.toContain('退室（オンライン対戦ロビーに戻る）');
    view.unmount();
  });

  it('対局者には再戦の導線と従来の退室が出る（縮退互換）', () => {
    registerConnector({ spectating: false });
    const view = render(<GameScreen variant="b" />);
    act(() => {
      useGameStore.getState().resign('player1');
    });
    const labels = screen.queryAllByRole('button').map((b) => (b.textContent ?? '').trim());
    expect(labels).toContain('対局準備に戻る');
    expect(labels).not.toContain('観戦をやめる');
    view.unmount();
  });

  it('★観戦者には対局者二人の名前を出す（「あなた／あいて」は使えない）', () => {
    registerConnector({
      spectating: true,
      seatNames: { player1: '先手さん', player2: '後手さん' },
    });
    const view = render(<GameScreen variant="b" />);
    expect(screen.getByText('先手さん')).toBeTruthy();
    expect(screen.getByText('後手さん')).toBeTruthy();
    view.unmount();
  });
});
