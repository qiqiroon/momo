import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useRouteStore } from '../../core/store/route-store';
import { useGameStore } from '../../core/store/game-store';
import { useAiStore } from '../../core/store/ai-store';
import { register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { ReviewMessage } from '../../core/plugin/review';
import { generateLegalMoves } from '../../core/engine';
import '../kifu-replay/index';
import { discardKifu, loadLastKifu } from '../kifu-replay/storage';
import { setReviewTarget } from '../kifu-replay/review';
import { endSharedReview, useReviewShareStore } from '../kifu-replay/review-share';
import { useMatchmakingStore } from './store';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoMatchmakingInitOptions } from './client';

/**
 * 感想戦の部屋の**行き先**（v1.50・画面機能 v0.40 §3 S04・付録D-12 §8）。
 *
 * ここが受け持つのは、**通信側の出来事と感想戦のつなぎ目**＝画面や伝言の中身は
 * 別の検査が見ている。つなぎ目だけは**壊れても手元では気づけない**（2 台ないと
 * 起きない）ので、ここで押さえる。
 *   - **感想戦の部屋へ入ったら、待機画面 (S05) ではなく感想戦へ進む**
 *   - **対局の部屋は今までどおり待機画面へ**（巻き添えにしない）
 *   - **自分の建てた感想戦の部屋に客が来たら、そこで棋譜を配り始める**
 *     ＝終局から入る経路の「受ける」の返事に当たる合図が、この経路には無い
 */

/** 通信側のコールバックを捕まえる偽の窓口。**実物には触れない**。 */
let opts: MomoMatchmakingInitOptions | null = null;
let iAmHost = false;
let sent: ReviewMessage[] = [];

const fakeApi = {
  init: (o: MomoMatchmakingInitOptions) => {
    opts = o;
  },
  createRoom: () => {},
  joinRoom: () => {},
  send: () => {},
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: iAmHost, connected: true, currentRoomId: null, currentRoomName: '' }),
  changeGameType: () => {},
};

const fakeConnector = {
  isOnline: () => true,
  isRoomHost: () => iAmHost,
  getOpponentName: () => '花子',
  getMyName: () => '太郎',
  getMySide: () => 'player1' as const,
  getMyChatSide: () => 'player1' as const,
  getActiveRules: () => null,
  subscribe: () => () => {},
  sendReview: (msg: ReviewMessage) => {
    sent.push(msg);
  },
} as unknown as OnlineGameConnector;

function finishedGame(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  for (let i = 0; i < moves; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') break;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) break;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) break;
  }
  useGameStore.getState().resign('player2');
  const file = loadLastKifu();
  if (!file) throw new Error('棋譜が記憶されていない');
  setReviewTarget(file, 'game');
}

beforeEach(() => {
  sent = [];
  iAmHost = false;
  (window as unknown as { MomoMatchmaking: typeof fakeApi }).MomoMatchmaking = fakeApi;
  register<OnlineGameConnector>('gameConnector', fakeConnector);
  ensureMatchmakingInit();
  endSharedReview();
  discardKifu();
  useAiStore.setState({ enabled: false });
  useRouteStore.setState({ screen: 'game' });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  endSharedReview();
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('感想戦の部屋へ入ったとき', () => {
  it('★感想戦の部屋なら、待機画面ではなく感想戦へ進む', () => {
    expect(opts).not.toBeNull();
    opts?.onJoinedRoom?.('r1', '[本+量+感] 量子将棋の感想戦', '花子', {});
    expect(useRouteStore.getState().screen).toBe('review');
    // **棋譜が配られるまで触れない**（画面機能 §3 S11）。
    expect(useReviewShareStore.getState().ready).toBe(false);
  });

  it('★対局の部屋は今までどおり待機画面へ（巻き添えにしない）', () => {
    opts?.onJoinedRoom?.('r2', '[本+TB15.30] ふつうの対局', '花子', {});
    expect(useRouteStore.getState().screen).toBe('room');
    expect(useReviewShareStore.getState().role).toBeNull();
  });
});

describe('感想戦の部屋に客が来たとき', () => {
  it('★自分の建てた感想戦の部屋なら、そこで棋譜を配り始める', () => {
    finishedGame(6);
    iAmHost = true;
    useReviewShareStore.setState({ ownsRoom: true });
    sent = [];

    opts?.onGuestJoined?.('花子');

    expect(useMatchmakingStore.getState().opponentName).toBe('花子');
    expect(useReviewShareStore.getState().role).toBe('host');
    const state = sent.find((m) => m.kind === 'state');
    expect(state && 'kifu' in state ? state.kifu : undefined).toBeTruthy();
  });

  it('対局の部屋なら、客が来ても棋譜は配らない', () => {
    finishedGame(6);
    iAmHost = true;
    sent = [];

    opts?.onGuestJoined?.('花子');

    expect(useMatchmakingStore.getState().opponentName).toBe('花子');
    expect(sent).toHaveLength(0);
  });
});
