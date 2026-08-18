import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { guardCancel, guardDiscard, useKifuGuardStore } from '../../../core/store/kifu-guard';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import { generateLegalMoves } from '../../../core/engine';
import '../../kifu-replay/index';
import { discardKifu, kifuMemoryState } from '../../kifu-replay/storage';
import { useMatchmakingStore } from '../store';
import { LobbyScreen } from './LobbyScreen';

/**
 * 部屋を建てる順番（v1.51・2026-08-18 実機で再現した不具合）。
 *
 * **未保存の棋譜があると、画面を移る仕組みが「保存する／破棄する／やめる」を割り込ませる**
 * （親 §9.2.3 ②）。v1.50 まではその**手前で先にサーバーへ部屋を建てて**いたため、
 * 「やめる」を選ぶと**画面はロビーのまま・誰も居ない部屋だけが一覧に残った**
 * ＝作った本人にも片付けられない（戻ってくる画面が無い）。
 *
 * **対局のあとは必ず未保存の棋譜がある**ので、感想戦を使うと毎回これを踏んでいた。
 * ここで固定するのは「**確認が済むまで建てない**」という順番そのもの。
 */

let created = 0;

const fakeApi = {
  // 画面が載ると起動処理が走って「接続中」に戻すので、**開いたことを知らせる**
  // ところまで真似る（そうしないと「部屋を作成」が押せないまま検査が素通りする）。
  init: (o: { onWsOpen?: () => void }) => {
    o.onWsOpen?.();
  },
  createRoom: () => {
    created += 1;
  },
  joinRoom: () => {},
  send: () => {},
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: false, connected: true, currentRoomId: null, currentRoomName: '' }),
  changeGameType: () => {},
};

/** 終局まで進めて、未保存の棋譜を記憶に置く。 */
function unsavedKifu(moves = 6): void {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  for (let i = 0; i < moves; i++) {
    const s = useGameStore.getState();
    if (s.status !== 'playing') break;
    const legal = generateLegalMoves(s.mgf, s.position);
    if (legal.length === 0) break;
    if (!useGameStore.getState().replayRecordedMove(legal[(i * 7 + 3) % legal.length])) break;
  }
  useGameStore.getState().resign('player2');
}

function pressCreate(): void {
  const btn = screen.getAllByRole('button').find((b) => b.textContent?.includes('部屋を作成'));
  if (!btn) throw new Error('部屋を作成 が見つからない');
  fireEvent.click(btn);
}

beforeEach(() => {
  created = 0;
  (window as unknown as { MomoMatchmaking: typeof fakeApi }).MomoMatchmaking = fakeApi;
  discardKifu();
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'net-lobby' });
  useKifuGuardStore.setState({ stage: null, saving: false, cancelled: false, failed: false, pending: null });
  useMatchmakingStore.setState({ connection: 'connected', playerName: '太郎', currentRoomId: null });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
});

afterEach(() => {
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('部屋を建てる順番', () => {
  it('★未保存の棋譜があるときは、確認に答えるまで部屋を建てない', () => {
    unsavedKifu(6);
    expect(kifuMemoryState()).toBe('unsaved');
    const view = render(<LobbyScreen />);

    pressCreate();

    // 確認が出ている段階では**まだ建てていない**。
    expect(useKifuGuardStore.getState().stage).toBe('kifu');
    expect(created).toBe(0);
    expect(useRouteStore.getState().screen).toBe('net-lobby');
    view.unmount();
  });

  it('★「やめる」を選んだら、部屋は残らない（誰も居ない部屋が一覧に並ばない）', () => {
    unsavedKifu(6);
    const view = render(<LobbyScreen />);
    pressCreate();

    // 確認そのものは全画面共通の重ね表示が受け持つので、ここでは答えだけを渡す。
    guardCancel();

    expect(created).toBe(0);
    expect(useRouteStore.getState().screen).toBe('net-lobby');
    // **記憶もそのまま**（親 v1.37 §9.2.3 ②＝何も起きなかったことにする）。
    expect(kifuMemoryState()).toBe('unsaved');
    view.unmount();
  });

  it('「破棄する」を選んだら、そこで建てて待機画面へ進む', () => {
    unsavedKifu(6);
    const view = render(<LobbyScreen />);
    pressCreate();

    guardDiscard();

    expect(created).toBe(1);
    expect(useRouteStore.getState().screen).toBe('room');
    view.unmount();
  });

  it('未保存の棋譜が無いときは、尋ねずにそのまま建てて進む', () => {
    const view = render(<LobbyScreen />);
    pressCreate();

    expect(useKifuGuardStore.getState().stage).toBeNull();
    expect(created).toBe(1);
    expect(useRouteStore.getState().screen).toBe('room');
    view.unmount();
  });
});
