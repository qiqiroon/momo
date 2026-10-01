/**
 * ★v1.95 威嚇ボタン (音響 §2.5・画面機能 S06・付録 D-1 §7)。
 *
 * v1.94 までは**見た目だけ**のボタンだった (いつも「3」と出て、押しても何も起きない)。
 * ここで固定するのは画面と通信の側:
 *   - 押すと予約中の見た目になり、指すと残りが 1 減って予約が解ける
 *   - 0 になったら押せない・自分の手番でなければ押せない (AI の手番など)
 *   - ネット対戦では、威嚇つきの手だけに印を付けて相手へ送る
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';
import { useAiStore } from '../store/ai-store';
import { register } from '../plugin/registry';
import { generateLegalMoves } from '../engine';
import type { BoardMove } from '../engine/position/types';
import type { RemoteMovePayload } from '../plugin/gameConnector';
import { seTaunt } from '../audio/se-synth';

// 威嚇音が鳴ったかだけを見たいので、威嚇音の口だけを数える形に差し替える (他の音はそのまま)。
vi.mock('../audio/se-synth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audio/se-synth')>()),
  seTaunt: vi.fn(),
}));

function tauntButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /威嚇/ }) as HTMLButtonElement;
}

/** 盤を触って 1 手指す (人の手)。 */
function humanMove(): void {
  const s = useGameStore.getState();
  const m = generateLegalMoves(s.mgf, s.position).find((x) => x.type === 'move' && !x.promote) as BoardMove;
  act(() => {
    useGameStore.getState().selectSquare(m.from);
    useGameStore.getState().tryMove(m.to);
  });
}

/** ネット対戦の口 (使わない窓口は何もしない)。送られた手を控える。 */
function registerOnline(mySide: 'player1' | 'player2'): RemoteMovePayload[] {
  const sent: RemoteMovePayload[] = [];
  const known: Record<string, unknown> = {
    isOnline: () => true,
    getMySide: () => mySide,
    getMyChatSide: () => mySide,
    getMyName: () => '太郎',
    getOpponentName: () => '花子',
    getActiveRules: () => null,
    getPendingRules: () => null,
    getPendingTimeControl: () => null,
    isRuleSetter: () => false,
    isSpectating: () => false,
    getSeatNames: () => null,
    getSpectators: () => [],
    isSpectateWaiting: () => false,
    getOpponentLeftDuringGame: () => false,
    getWsPendingReconnect: () => false,
    getLastPeerMessageAt: () => null,
    isRoomHost: () => false,
    subscribe: () => () => {},
    sendMove: (p: RemoteMovePayload) => sent.push(p),
  };
  register(
    'gameConnector',
    new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => {}) }) as never,
  );
  return sent;
}

beforeEach(() => {
  vi.mocked(seTaunt).mockClear();
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'game' });
  useAiStore.setState({ enabled: false, aiSide: 'player2', thinking: false });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  register('gameConnector', undefined as never);
});

describe('威嚇ボタン (★v1.95)', () => {
  it('押すと予約中の見た目になり、指すと残りが 3 → 2 に減って予約が解ける', () => {
    render(<App variant="b" />);
    expect(tauntButton().textContent).toContain('3');
    fireEvent.click(tauntButton());
    expect(tauntButton().className).toContain('armed');
    humanMove();
    expect(tauntButton().className).not.toContain('armed');
    // 一人で両方を指すときは「いま手番の側」の回数を出す＝後手はまだ 3。
    expect(tauntButton().textContent).toContain('3');
    expect(useGameStore.getState().tauntsLeft.player1).toBe(2);
  });

  it('もう一度押せば取り消し (回数は減らない)', () => {
    render(<App variant="b" />);
    fireEvent.click(tauntButton());
    fireEvent.click(tauntButton());
    expect(tauntButton().className).not.toContain('armed');
    humanMove();
    expect(useGameStore.getState().tauntsLeft.player1).toBe(3);
  });

  it('残りが 0 なら押せない', () => {
    useGameStore.setState({ tauntsLeft: { player1: 0, player2: 3 } });
    render(<App variant="b" />);
    expect(tauntButton().textContent).toContain('0');
    expect(tauntButton().disabled).toBe(true);
  });

  it('AI の手番では押せない (人の側の回数を出す)', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player1', thinking: false });
    useGameStore.setState({ tauntsLeft: { player1: 3, player2: 1 } });
    render(<App variant="b" />);
    // 先手 (AI) の手番。出ているのは人 (後手) の回数。
    expect(tauntButton().textContent).toContain('1');
    expect(tauntButton().disabled).toBe(true);
  });

  it('ネット対戦では、威嚇つきの手にだけ印を付けて送る', () => {
    const sent = registerOnline('player1');
    render(<App variant="b" />);
    fireEvent.click(tauntButton());
    humanMove();
    expect(sent).toHaveLength(1);
    expect(sent[0].taunt).toBe(true);
  });

  it('ネット対戦で威嚇しなかった手には印を付けない', () => {
    const sent = registerOnline('player1');
    render(<App variant="b" />);
    humanMove();
    expect(sent).toHaveLength(1);
    expect(sent[0].taunt).toBeUndefined();
  });

  it('威嚇つきで指した手で威嚇音が鳴り、威嚇しなかった手では鳴らない', () => {
    render(<App variant="b" />);
    humanMove();
    expect(vi.mocked(seTaunt)).not.toHaveBeenCalled();
    fireEvent.click(tauntButton());
    humanMove();
    expect(vi.mocked(seTaunt)).toHaveBeenCalledTimes(1);
  });
});
