import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { register } from '../../../core/plugin/registry';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { useReviewShareStore } from '../review-share';
import { ReviewScreen } from './ReviewScreen';

/**
 * ★v1.59 段3: **感想戦（S11）を観戦者から見たとき**（親 §6.8.6・画面機能 v0.51 §3 S11）。
 *
 * ここで固定するのは 4 つ。
 *   - **盤に起きることはすべて対局者が起こす**＝再生の操作帯を置かない
 *   - **棋譜の読み込み・保存・部屋を閉じるを置かない**（灰色で置くのではなく置かない）
 *   - **観戦者の欄に実際に人が並ぶ**（v1.58 までは常に空だった）
 *   - **戻り先は観戦の一覧**＝観戦者はどの画面から出ても同じ場所へ返す
 *     （S05／S07 と同じ扱い。v1.76 で対局画面の退室が対戦ロビーへ戻っていたのと同じ形）
 */

function registerConnector(spectating: boolean, watchers: { pid: string; name: string }[] = []) {
  register('gameConnector', {
    isOnline: () => true,
    getMySide: () => (spectating ? null : ('player1' as const)),
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
    isSpectating: () => spectating,
    getSeatNames: () => null,
    getSpectators: () => watchers,
    isSpectateWaiting: () => false,
    getOpponentLeftDuringGame: () => false,
    getWsPendingReconnect: () => false,
    getLastPeerMessageAt: () => null,
    isRoomHost: () => false,
    leaveOnline: () => {},
    markConnectionDead: () => {},
    markConnectionHealthy: () => {},
    returnToPreparation: () => {},
    notifySpectatorsReviewMigrate: () => {},
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

const labelsOf = () => screen.queryAllByRole('button').map((b) => b.textContent ?? '');

beforeEach(() => {
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'review' });
  useGameStore.getState().reset({ gameType: 'shogi' });
  // 二人の感想戦として成立している状態（観戦者もこの形で盤を追う）。
  useReviewShareStore.setState({ role: 'guest', ready: true, ownsRoom: true, opponentPresent: true });
});

afterEach(() => {
  register('gameConnector', undefined as never);
  useReviewShareStore.setState({ role: null, ready: true, ownsRoom: false });
});

describe('S11 感想戦を観戦者から見たとき（v1.59 段3）', () => {
  it('★再生の操作帯を置かない（盤に起きることはすべて対局者が起こす）', () => {
    registerConnector(true);
    const view = render(<ReviewScreen />);
    const labels = labelsOf();
    expect(labels.some((s) => s.includes('自動') || s.includes('▶'))).toBe(false);
    expect(labels.some((s) => s.includes('◀'))).toBe(false);
    view.unmount();
  });

  it('★棋譜の読み込み・保存・部屋を閉じるを置かない（灰色で置くのではなく置かない）', () => {
    registerConnector(true);
    const view = render(<ReviewScreen />);
    const labels = labelsOf();
    for (const label of ['棋譜読込', '棋譜保存', '部屋を閉じる']) {
      expect(labels.some((s) => s.includes(label))).toBe(false);
    }
    view.unmount();
  });

  it('★戻るは観戦の一覧へ（対局者はモード選択のまま）', () => {
    registerConnector(true);
    const view = render(<ReviewScreen />);
    expect(labelsOf().some((s) => s.includes('観戦をやめる'))).toBe(true);
    expect(labelsOf().some((s) => s.includes('モード選択'))).toBe(false);
    view.unmount();
  });

  it('★観戦者の欄に実際に人が並ぶ（v1.58 までは常に空だった）', () => {
    registerConnector(true, [
      { pid: 'v1', name: '見物人' },
      { pid: 'v2', name: '見物人2' },
    ]);
    const view = render(<ReviewScreen />);
    expect(screen.getByText('見物人（観戦者）')).toBeTruthy();
    expect(screen.getByText('見物人2（観戦者）')).toBeTruthy();
    view.unmount();
  });

  it('対局者の画面は今までどおり（縮退互換）＝操作帯も保存も戻るもそのまま', () => {
    registerConnector(false);
    const view = render(<ReviewScreen />);
    const labels = labelsOf();
    expect(labels.some((s) => s.includes('棋譜保存'))).toBe(true);
    expect(labels.some((s) => s.includes('◀'))).toBe(true);
    expect(labels.some((s) => s.includes('モード選択'))).toBe(true);
    view.unmount();
  });
});
