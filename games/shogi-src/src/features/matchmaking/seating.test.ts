import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoCreateRoomOptions, MomoMatchmakingInitOptions, MomoRoomInfo } from './client';
import {
  createSeatedRoom,
  hasSeat,
  isRoomPlayersFull,
  opponentOf,
  SHOGI_MAX_PLAYERS,
} from './roster';
import { useMatchmakingStore } from './store';

/**
 * v1.53 段1：**通信の土台をサーバー中継へ載せ替えたときの決めごと**（親 §6.1／§6.2）。
 *
 * ここが受け持つのは**「誰が対局相手か」と「いつ対局できる状態になるか」**。
 * どちらも **2 台ないと手元では気づけない**箇所なので、検査で押さえる。
 *   - 部屋は**席＋観戦枠**を持つ形で建てる（建てる場所ごとに書かない）
 *   - 対局相手は**名簿の席**から選ぶ（**自分以外の 1 人**ではない）
 *   - **部屋に入ったこと**と**相手が居ること**は別（`onConnected` で兼用しない）
 */

const room = (over: Partial<MomoRoomInfo>): MomoRoomInfo => ({
  id: 'r1',
  name: '部屋',
  hostName: '太郎',
  hasPassword: false,
  isPublic: true,
  ...over,
});

describe('v1.53 段1: 席と名簿の読み方', () => {
  it('席を持つのはホストと対局者だけで、観戦者は持たない', () => {
    expect(hasSeat('host')).toBe(true);
    expect(hasSeat('player')).toBe(true);
    expect(hasSeat('spectator')).toBe(false);
    expect(hasSeat(null)).toBe(false);
  });

  it('★対局相手は名簿の席から選ぶ＝観戦者を相手にしない', () => {
    const roster = [
      { pid: 'p0', role: 'host' as const, name: '太郎' },
      { pid: 'v1', role: 'spectator' as const, name: '見物人' },
      { pid: 'p1', role: 'player' as const, name: '花子' },
    ];
    // 自分がホストなら、相手は席を持つ「花子」。先に名簿に載っている観戦者ではない。
    expect(opponentOf(roster, 'p0')?.name).toBe('花子');
    // 自分が対局者なら、相手はホスト。
    expect(opponentOf(roster, 'p1')?.name).toBe('太郎');
  });

  it('席に着いているのが自分だけなら対局相手は居ない（観戦者が何人居ても同じ）', () => {
    const roster = [
      { pid: 'p0', role: 'host' as const, name: '太郎' },
      { pid: 'v1', role: 'spectator' as const, name: '見物人' },
      { pid: 'v2', role: 'spectator' as const, name: '見物人2' },
    ];
    expect(opponentOf(roster, 'p0')).toBeNull();
  });

  it('★満席かどうかは席の数で見る＝観戦者が居ても席が空いていれば入れる', () => {
    const open = room({ mode: 'multi', playerCount: 1, maxPlayers: 2, spectatorCount: 5 });
    const full = room({ mode: 'multi', playerCount: 2, maxPlayers: 2, spectatorCount: 0 });
    expect(isRoomPlayersFull(open)).toBe(false);
    expect(isRoomPlayersFull(full)).toBe(true);
  });

  it('席の数が知らされていない多人数の部屋は将棋の 2 席とみなす', () => {
    expect(SHOGI_MAX_PLAYERS).toBe(2);
    expect(isRoomPlayersFull(room({ mode: 'multi', playerCount: 2 }))).toBe(true);
    expect(isRoomPlayersFull(room({ mode: 'multi', playerCount: 1 }))).toBe(false);
  });

  it('従来の 1 対 1 で建てられた部屋は今までどおりの見方で満席を判断する', () => {
    // 多人数の部屋には guestConnected が無いので、そちらと取り違えないこと。
    expect(isRoomPlayersFull(room({ guestConnected: true }))).toBe(true);
    expect(isRoomPlayersFull(room({ guestConnected: false }))).toBe(false);
  });

  it('★部屋は必ず席と観戦枠を持つ形で建つ（呼んだ側が指定しなくても付く）', () => {
    let got: MomoCreateRoomOptions | null = null;
    const client = {
      createRoom: (o: MomoCreateRoomOptions) => {
        got = o;
      },
    } as never;
    createSeatedRoom(client, { name: '部屋', hostName: '太郎' });
    const o = got as unknown as MomoCreateRoomOptions;
    expect(o.mode).toBe('multi');
    expect(o.maxPlayers).toBe(2);
    // 段1 では観戦者は入れない（観戦は段2）。枠の指定そのものは付いていること。
    expect(o.maxSpectators).toBe(0);
    // 呼んだ側が渡した中身は失われない
    expect(o.name).toBe('部屋');
  });
});

describe('v1.53 段1: 通信の受け口（親 §6.2）', () => {
  let opts: MomoMatchmakingInitOptions | null = null;

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
    getState: () => ({ isHost: true, connected: true, currentRoomId: null, currentRoomName: '' }),
    changeGameType: () => {},
  };

  beforeEach(() => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi;
    ensureMatchmakingInit();
    useMatchmakingStore.setState({
      connection: 'connected',
      opponentName: '',
      roster: [],
      myPid: null,
      myRole: null,
      gameStartInfo: null,
    });
  });

  /** ホストとして部屋を建てたところまで進める。 */
  const createRoomAsHost = () => {
    opts?.onRoomCreated?.('r1', '部屋', undefined, {
      mode: 'multi',
      pid: 'p0',
      role: 'host',
      roster: [{ pid: 'p0', role: 'host', name: '太郎' }],
    });
    opts?.onConnected?.();
  };

  it('★部屋を建てただけでは対局できる状態にならない（まだ誰も来ていない）', () => {
    createRoomAsHost();
    // 「部屋に入った」ことは成立している
    expect(useMatchmakingStore.getState().currentRoomName).toBe('部屋');
    // しかし相手は居ないので、対局できる状態へは進まない
    expect(useMatchmakingStore.getState().connection).toBe('in_room');
    expect(useMatchmakingStore.getState().opponentName).toBe('');
  });

  it('★席のある人が入って初めて相手の名前が入り、対局できる状態になる', () => {
    createRoomAsHost();
    opts?.onParticipantJoined?.('p1', 'player', '花子', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
    ]);
    expect(useMatchmakingStore.getState().opponentName).toBe('花子');
    expect(useMatchmakingStore.getState().connection).toBe('game_connected');
  });

  it('★観戦者が入ってきても対局相手にはならない', () => {
    createRoomAsHost();
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    expect(useMatchmakingStore.getState().opponentName).toBe('');
    expect(useMatchmakingStore.getState().connection).toBe('in_room');
    // 名簿そのものは受け取っている（観戦者の人数を出すのは段2）
    expect(useMatchmakingStore.getState().roster).toHaveLength(2);
  });

  it('観戦者が抜けても対局には何も起きない', () => {
    createRoomAsHost();
    opts?.onParticipantJoined?.('p1', 'player', '花子', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
    ]);
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    opts?.onParticipantLeft?.('v1', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
    ]);
    expect(useMatchmakingStore.getState().opponentName).toBe('花子');
  });

  it('対局相手が抜けたら今までどおり相手が居ない扱いになる', () => {
    createRoomAsHost();
    opts?.onParticipantJoined?.('p1', 'player', '花子', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
    ]);
    opts?.onParticipantLeft?.('p1', [{ pid: 'p0', role: 'host', name: '太郎' }]);
    expect(useMatchmakingStore.getState().opponentName).toBe('');
  });

  it('入室した側は名簿の席から相手を読む（ホスト名の受け売りにしない）', () => {
    opts?.onJoinedRoom?.('r1', '部屋', '太郎', undefined, {
      mode: 'multi',
      pid: 'p1',
      role: 'player',
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'p1', role: 'player', name: '花子' },
      ],
    });
    opts?.onConnected?.();
    expect(useMatchmakingStore.getState().opponentName).toBe('太郎');
    expect(useMatchmakingStore.getState().connection).toBe('game_connected');
  });
});
