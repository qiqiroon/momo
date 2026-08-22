import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { register } from '../../../core/plugin/registry';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { KifuReplayScreen } from './KifuReplayScreen';
import { ReviewScreen } from './ReviewScreen';

/**
 * ★v1.62（2026-08-22 実機のご報告・iPhone・第56セッション）
 * ＝**手数リストは、自分の箱の中だけを巻き取る**。
 *
 * ## 何が起きていたか
 *
 * v1.61 までは `scrollIntoView` で「いまの手」を見せていた。**あれは入れ子の外側も
 * ページごと巻き取る**。**携帯（縦長）では手数リストが盤の下に回る**ので、
 * 手が進むたびに**ページが下へスクロールして盤が画面から消えて**いた
 * （ご報告＝「棋譜が表示されることで下の方にスクロールしてしまう」）。
 *
 * ## ここで固定すること
 *
 * **`scrollIntoView` を使わない**。やりたいのは「いまの手をリストの中で見えるように
 * する」ことだけで、**外側を動かす必要はどこにも無い**。
 *
 * **画面を描いて呼ばれないことを見る**＝呼び出しの有無だけを見ると、
 * **そもそも描いていなくても緑になる**（素通りの検査になる）。
 */

function registerConnector() {
  register('gameConnector', {
    isOnline: () => false,
    isSpectating: () => false,
    getSeatNames: () => null,
    getSpectators: () => [],
    getMySide: () => 'player1' as const,
    getMyChatSide: () => 'player1' as const,
    getMyName: () => '太郎',
    isSpectateWaiting: () => false,
    getActiveRules: () => null,
    sendChat: () => {},
    sendReview: () => {},
    notifySpectatorsReviewMigrate: () => {},
    getOpponentName: () => '',
    isRoomHost: () => false,
    subscribe: () => () => {},
  } as never);
}

let scrolled = 0;

beforeEach(() => {
  scrolled = 0;
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useGameStore.getState().reset({ gameType: 'shogi' });
  registerConnector();
  // **画面を実際に描いたうえで、外側を動かす呼び出しが来ないことを見る。**
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {
    scrolled += 1;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  register('gameConnector', undefined as never);
});

describe('v1.62: 手数リストはページを動かさない（付録D-8 §5.1／実機のご報告）', () => {
  it('★感想戦（S11）＝いまの手を見せるためにページを巻き取らない', () => {
    useRouteStore.setState({ screen: 'review' });
    const view = render(<ReviewScreen />);
    expect(scrolled).toBe(0);
    view.unmount();
  });

  it('★棋譜再生（S08）＝同じ仕掛けなので同じに直す（2 か所で違う形にしない）', () => {
    useRouteStore.setState({ screen: 'kifu-replay' });
    const view = render(<KifuReplayScreen />);
    expect(scrolled).toBe(0);
    view.unmount();
  });
});
