import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { register } from '../plugin/registry';
import { useI18nStore } from '../store/i18n-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import { ChatConsole } from './ChatConsole';
import { t as _t } from '../i18n';

/**
 * ★v1.55 観戦者への「届き先の知らせ」（親 v1.57 §6.8.5）。
 *
 * **観戦者の発言が観戦者どうしに絞られるのは「対局が進んでいる間」だけ**。
 * したがってこの一言も**同じ条件**で出す。
 *
 * ★**購読して読むこと**＝口越しに一度だけ聞く形にしていたため、実サーバーで
 * **終局しても一言が消えず、届いているのに「届いていません」と出し続けていた**
 * （2026-08-21）。**送る側と読む側で別の決め方をしない。**
 */

function registerConnector(spectating: boolean) {
  register('gameConnector', {
    isOnline: () => true,
    getMySide: () => (spectating ? null : ('player1' as const)),
    getMyChatSide: () => (spectating ? null : ('player1' as const)),
    getMyName: () => (spectating ? '見物ハナコ' : 'ホスト太郎'),
    getOpponentName: () => 'ゲスト次郎',
    subscribe: () => () => {},
    sendChat: () => {},
    isSpectating: () => spectating,
    getSeatNames: () => null,
    getSpectators: () => [],
    isSpectateWaiting: () => false,
  } as never);
}

const t = (k: string) => _t(k, 'ja');
const NOTE = '観戦者どうしにだけ見えます';

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useChatStore.getState().clearChat();
  useGameStore.getState().reset({ gameType: 'shogi' });
});

afterEach(() => {
  register('gameConnector', undefined as never);
});

describe('観戦者への「届き先の知らせ」（v1.55）', () => {
  it('★対局が進んでいる間だけ出す', () => {
    registerConnector(true);
    useRouteStore.setState({ screen: 'game' });
    const view = render(<ChatConsole t={t} />);
    expect(screen.queryByText(NOTE)).toBeTruthy();
    view.unmount();
  });

  it('★終局したら消える（届いているのに「届いていません」と出し続けない）', () => {
    registerConnector(true);
    useRouteStore.setState({ screen: 'game' });
    const view = render(<ChatConsole t={t} />);
    expect(screen.queryByText(NOTE)).toBeTruthy();
    // ★ここが肝＝**描き直しに乗ること**（口越しに一度聞くだけでは古いまま残る）
    act(() => {
      useGameStore.getState().resign('player1');
    });
    expect(screen.queryByText(NOTE)).toBeNull();
    view.unmount();
  });

  it('★対戦準備室では出さない（そこでは全員に届く）', () => {
    registerConnector(true);
    useRouteStore.setState({ screen: 'room' });
    const view = render(<ChatConsole t={t} />);
    expect(screen.queryByText(NOTE)).toBeNull();
    view.unmount();
  });

  it('★感想戦では出さない（そこでは全員に届く）', () => {
    registerConnector(true);
    useRouteStore.setState({ screen: 'review' });
    const view = render(<ChatConsole t={t} />);
    expect(screen.queryByText(NOTE)).toBeNull();
    view.unmount();
  });

  it('対局者には出さない（絞られるのは観戦者の発言だけ）', () => {
    registerConnector(false);
    useRouteStore.setState({ screen: 'game' });
    const view = render(<ChatConsole t={t} />);
    expect(screen.queryByText(NOTE)).toBeNull();
    view.unmount();
  });
});
