import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import { useAiStore } from '../../../core/store/ai-store';
import type { MomoRole } from '../client';
import { useMatchmakingStore } from '../store';
import { SpectateLobbyScreen } from './SpectateLobbyScreen';
import { RoomScreen } from './RoomScreen';

/**
 * ★v1.55 S13 観戦ロビー／観戦者から見た準備画面（親 §6.8・画面機能 v0.49 §3 S13／S05）。
 *
 * ここで固定するのは 4 つ。
 *   - **観戦を許していない部屋は一覧に出さない**（観戦枠 0）
 *   - **満員の部屋は出すが押せない。理由は色ではなく言葉で出す**
 *   - **入るときは役を渡す**（渡さないと席に着いてしまう）
 *   - **観戦者の準備画面には先後選択も準備完了も出さない**（見るだけ）
 */

let joined: { roomId: string; role?: MomoRole } | null = null;

const fakeApi = {
  init: (o: { onWsOpen?: () => void }) => {
    o.onWsOpen?.();
  },
  createRoom: () => {},
  joinRoom: (roomId: string, _pw: string, _name: string, role?: MomoRole) => {
    joined = { roomId, role };
  },
  send: () => {},
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: false, connected: true, currentRoomId: null, currentRoomName: '' }),
  changeGameType: () => {},
};

function watchableRoom(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'へや',
    hostName: '花子',
    isPublic: true,
    hasPassword: false,
    mode: 'multi' as const,
    playerCount: 1,
    maxPlayers: 2,
    spectatorCount: 0,
    maxSpectators: 8,
    ...over,
  };
}

beforeEach(() => {
  joined = null;
  (window as unknown as { MomoMatchmaking: typeof fakeApi }).MomoMatchmaking = fakeApi;
  useAiStore.setState({ enabled: false });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ screen: 'spectate-lobby' });
  // ★記憶している棋譜は空にしておく＝確認をはさまずに入れることだけを見る
  //   （確認そのものは kifu-guard 側の検査が持つ）。
  useGameStore.getState().reset({ gameType: 'shogi' });
  useMatchmakingStore.setState({
    connection: 'connected',
    playerName: '太郎',
    currentRoomId: null,
    rooms: [],
    roster: [],
    myRole: null,
    myPid: null,
    seatNames: null,
    spectateWaiting: false,
    gameStartInfo: null,
  });
});

afterEach(() => {
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('S13 観戦ロビー（v1.55）', () => {
  it('★観戦を許していない部屋は一覧に出さない', () => {
    useMatchmakingStore.setState({
      rooms: [watchableRoom('r1'), watchableRoom('r2', { maxSpectators: 0 })],
    });
    const view = render(<SpectateLobbyScreen />);
    // 観戦できるのは 1 部屋だけ＝「観戦する」ボタンも 1 つだけ
    expect(screen.getAllByRole('button').filter((b) => b.textContent === '観戦する')).toHaveLength(1);
    view.unmount();
  });

  it('★観戦できる部屋が 1 つも無いときは、その旨を言葉で出す', () => {
    useMatchmakingStore.setState({ rooms: [watchableRoom('r2', { maxSpectators: 0 })] });
    const view = render(<SpectateLobbyScreen />);
    expect(screen.getByText('いま観戦できる部屋はありません')).toBeTruthy();
    view.unmount();
  });

  it('★満員の部屋は一覧に出すが押せない。理由は色ではなく言葉で出す', () => {
    useMatchmakingStore.setState({
      rooms: [watchableRoom('r1', { spectatorCount: 8, maxSpectators: 8 })],
    });
    const view = render(<SpectateLobbyScreen />);
    const btn = screen.getAllByRole('button').find((b) => b.textContent === '観戦する') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    // **押せない理由を言葉で出す**（灰色は「押せない」だけを意味する）
    expect(screen.getByText('観戦がいっぱいです')).toBeTruthy();
    view.unmount();
  });

  it('★入るときは「観戦者」として入る（役を渡さないと席に着いてしまう）', () => {
    useMatchmakingStore.setState({ rooms: [watchableRoom('r1')] });
    const view = render(<SpectateLobbyScreen />);
    const btn = screen.getAllByRole('button').find((b) => b.textContent === '観戦する')!;
    fireEvent.click(btn);
    expect(joined).toEqual({ roomId: 'r1', role: 'spectator' });
    view.unmount();
  });

  it('★部屋の段はサーバーが持っている事実から出す（席の数で推し量らない）', () => {
    useMatchmakingStore.setState({
      rooms: [
        // 席が 2 つ埋まっていても、先後を決めている最中なら「対局中」ではない
        watchableRoom('r1', { playerCount: 2, gameState: 'lobby' }),
        watchableRoom('r2', { playerCount: 2, gameState: 'playing' }),
        watchableRoom('r3', { playerCount: 2, gameState: 'ended' }),
      ],
    });
    const view = render(<SpectateLobbyScreen />);
    expect(screen.getByText('対局前')).toBeTruthy();
    expect(screen.getByText('対局中')).toBeTruthy();
    expect(screen.getByText('終局後')).toBeTruthy();
    view.unmount();
  });

  it('★段を知らせてこない部屋は席の数で当てにいかず、素直に「対局前」と出す', () => {
    useMatchmakingStore.setState({
      rooms: [watchableRoom('r1', { playerCount: 1 }), watchableRoom('r2', { playerCount: 2 })],
    });
    const view = render(<SpectateLobbyScreen />);
    // **席が 2 つ埋まっていても「対局中」とは書かない**（先後を決めている最中かもしれない）
    expect(screen.getAllByText('対局前')).toHaveLength(2);
    expect(screen.queryByText('対局中')).toBeNull();
    view.unmount();
  });
});

describe('S05 準備画面を観戦者から見たとき（v1.55）', () => {
  /** その部屋に観戦者として入っている状態にする。 */
  const asSpectator = () => {
    useMatchmakingStore.setState({
      connection: 'in_room',
      currentRoomId: 'r1',
      currentRoomName: 'へや',
      isHost: false,
      myRole: 'spectator',
      myPid: 'v1',
      opponentName: '',
      roster: [
        { pid: 'p0', role: 'host', name: '花子' },
        { pid: 'p1', role: 'player', name: '次郎' },
        { pid: 'v1', role: 'spectator', name: '太郎' },
      ],
    });
  };

  it('★観戦者には「準備完了」を出さず、代わりに自動で始まることを言葉で出す', () => {
    asSpectator();
    const view = render(<RoomScreen />);
    expect(screen.queryByText('準備完了')).toBeNull();
    // **空白のまま空けない**＝押すものが無いのか、まだ出ていないのかを区別できないため
    expect(screen.getByText('対局者がそろうと自動で始まります')).toBeTruthy();
    view.unmount();
  });

  it('★観戦者には先後の選択を出さない（灰色で置くのではなく置かない）', () => {
    asSpectator();
    const view = render(<RoomScreen />);
    // 先後カードの説明文（対局者にだけ出るもの）
    expect(screen.queryByText('あなたが先に指します')).toBeNull();
    view.unmount();
  });

  it('★押すものが無い人に「押してください」と言わない（2026-08-21 実サーバーで見つけた）', () => {
    asSpectator();
    const view = render(<RoomScreen />);
    // 先後の状態メッセージ＝「先手か後手を選んでください」は選べない人には出さない
    expect(screen.queryByText('先手か後手を選んでください')).toBeNull();
    // 準備完了カードのリード文＝「準備完了を押してください」も同じ
    expect(
      screen.queryAllByText((_t, el) => (el?.textContent ?? '').includes('「準備完了」を押して')),
    ).toHaveLength(0);
    // 「相手」という言い方の行も出さない（観戦者に相手は居ない）
    expect(screen.queryByText('相手の入室と同期の完了をお待ちください')).toBeNull();
    view.unmount();
  });

  it('★受け取っている間は「対局を受け取っています」と出す（黙って空の盤を見せない）', () => {
    asSpectator();
    useMatchmakingStore.setState({ spectateWaiting: true });
    const view = render(<RoomScreen />);
    expect(screen.getByText('対局を受け取っています…')).toBeTruthy();
    view.unmount();
  });

  it('★参加者の欄に対局者二人と観戦者が並び、観戦者には印が付く', () => {
    asSpectator();
    const view = render(<RoomScreen />);
    expect(screen.getByText('花子')).toBeTruthy();
    expect(screen.getByText('次郎')).toBeTruthy();
    expect(screen.getByText('太郎（観戦者）')).toBeTruthy();
    view.unmount();
  });

  it('観戦者が居ない部屋の準備画面は今までどおり（自分と相手の 2 行だけ）', () => {
    useMatchmakingStore.setState({
      connection: 'game_connected',
      currentRoomId: 'r1',
      currentRoomName: 'へや',
      isHost: true,
      myRole: 'host',
      myPid: 'p0',
      opponentName: '次郎',
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'p1', role: 'player', name: '次郎' },
      ],
    });
    const view = render(<RoomScreen />);
    // 準備完了も先後選択も従来どおり出る
    expect(screen.getByText('準備完了')).toBeTruthy();
    expect(screen.getByText('あなたが先に指します')).toBeTruthy();
    // 観戦者の見出しは出さない（0 人のときに空の見出しを置かない）
    expect(screen.queryByText('観戦者（0）')).toBeNull();
    view.unmount();
  });
});
