import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoMatchmakingInitOptions, MomoRole } from './client';
import { handleShogiMessage } from './messageDispatcher';
import { PROTOCOL_VERSION } from './protocol';
import { useMatchmakingStore } from './store';
import './gameConnector';
import {
  acceptSpectateMigrate,
  declineSpectateMigrate,
  dismissSpectateEnded,
  noteSpectatedRoomClosed,
  resetSpectateMigrate,
  useSpectateMigrateStore,
} from './spectateMigrate';
import { joinMigratedReviewRoom, leaveReviewRoom } from './reviewRoom';
import { useRouteStore } from '../../core/store/route-store';
import { get as pluginGet, register } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';

/**
 * ★v1.59（第56セッション・2026-08-21）＝**段3＝観戦者を感想戦へ連れて移る**。
 *
 * ## この段でいちばん間違えやすいところ
 *
 * **ホストは移り先を知らせた直後に部屋を出る**（親 §6.3.6 の手順 2〜3）ので、
 * **観戦者の部屋はほぼ必ず閉じる**。v1.55〜v1.58 の規定どおり「確認中に部屋が閉じたら
 * 引っ込める」を当てはめると、**確認は出た直後に消え、観戦者は決して連れて行かれない**。
 * v1.59 で **引っ込めるのは「知らせが来ないまま閉じたとき」だけ** に改めた。
 *
 * **分ける根拠は行き先を持っているかどうか**であって、画面の名前でも部屋の状態でもない。
 */

const fakeApiFactory = (
  sent: { data: unknown; to?: string }[],
  joins: { roomId: string; password: string; name: string; role?: MomoRole }[],
  onInit?: (o: MomoMatchmakingInitOptions) => void,
) => ({
  init: (o: MomoMatchmakingInitOptions) => onInit?.(o),
  createRoom: () => {},
  joinRoom: (roomId: string, password: string, name: string, role?: MomoRole) =>
    joins.push({ roomId, password, name, role }),
  send: (data: unknown, to?: string) => sent.push({ data, to }),
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
  changeGameType: () => {},
});

let opts: MomoMatchmakingInitOptions | null = null;
let sent: { data: unknown; to?: string }[] = [];
let joins: { roomId: string; password: string; name: string; role?: MomoRole }[] = [];

function bodyOf(x: { data: unknown }): { type?: string; room?: string; pass?: string } {
  const d = x.data as { type?: string; body?: unknown };
  return (d?.body ?? d) as { type?: string; room?: string; pass?: string };
}

beforeEach(() => {
  sent = [];
  joins = [];
  (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(
    sent,
    joins,
    (o) => {
      opts = o;
    },
  );
  ensureMatchmakingInit();
  // **口を実際に置いて動かす**＝置かずに「何も起きない」を見ると、
  // つながっていなくても緑になる（素通りの検査になる）。
  register('reviewRoom:leave', leaveReviewRoom as never);
  register('reviewRoom:joinMigrated', joinMigratedReviewRoom as never);
  resetSpectateMigrate();
  useRouteStore.setState({ screen: 'game' });
});

afterEach(() => {
  resetSpectateMigrate();
});

describe('v1.59 段3: ホストは観戦者へ移り先を知らせる（親 §6.8.6）', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({
      myRole: 'host',
      myPid: 'p0',
      isHost: true,
      currentRoomId: 'r1',
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'p1', role: 'player', name: '花子' },
        { pid: 'v1', role: 'spectator', name: '見物人' },
        { pid: 'v2', role: 'spectator', name: '見物人2' },
      ],
    });
  });

  it('★観戦者ひとりずつに宛てて送る（土台に「観戦者全員」という宛先が無い）', () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.notifySpectatorsReviewMigrate('部屋#review', 'abc123');
    const migrates = sent.filter((x) => bodyOf(x).type === 'review_migrate');
    expect(migrates.map((x) => x.to).sort()).toEqual(['v1', 'v2']);
    expect(bodyOf(migrates[0])).toMatchObject({ room: '部屋#review', pass: 'abc123' });
  });

  it('★席のある相手には送らない（相手は自分たちのやり取りで移り先を知っている）', () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.notifySpectatorsReviewMigrate('部屋#review', 'abc123');
    const migrates = sent.filter((x) => bodyOf(x).type === 'review_migrate');
    expect(migrates.some((x) => x.to === 'p1')).toBe(false);
    expect(migrates.some((x) => x.to === undefined)).toBe(false);
  });

  it('★送るのはホストだけ＝二人が別々の移り先を配ると、どちらが正か誰も言えない', () => {
    useMatchmakingStore.setState({ isHost: false, myRole: 'player', myPid: 'p1' });
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.notifySpectatorsReviewMigrate('部屋#review', 'abc123');
    expect(sent.filter((x) => bodyOf(x).type === 'review_migrate')).toHaveLength(0);
  });
});

describe('v1.59 段3: 観戦者が受け取ると確認が立つ（画面機能 §3 S07）', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({
      myRole: 'spectator',
      myPid: 'v1',
      isHost: false,
      currentRoomId: 'r1',
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'v1', role: 'spectator', name: '見物人' },
      ],
    });
  });

  it('観戦者は移り先を受け取って確認が立つ', () => {
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'review_migrate',
      room: '部屋#review',
      pass: 'abc123',
    });
    expect(useSpectateMigrateStore.getState().offer).toEqual({
      room: '部屋#review',
      pass: 'abc123',
    });
  });

  it('★対局者には確認が立たない（自分たちのやり取りで移るので二重に動かない）', () => {
    useMatchmakingStore.setState({ myRole: 'player' });
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'review_migrate',
      room: '部屋#review',
      pass: 'abc123',
    });
    expect(useSpectateMigrateStore.getState().offer).toBeNull();
  });

  it('★★知らせを受け取った後で部屋が閉じても、確認は引っ込めない（v1.59 の要点）', () => {
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'review_migrate',
      room: '部屋#review',
      pass: 'abc123',
    });
    // ホストが移り先を建てに行く＝**部屋は必ず閉じる**。これは予期されたこと。
    noteSpectatedRoomClosed();
    expect(useSpectateMigrateStore.getState().offer).not.toBeNull();
    expect(useSpectateMigrateStore.getState().ended).toBe(false);
  });

  it('★知らせが来ないまま閉じたら「対局が終わりました」＝黙って固まらない', () => {
    noteSpectatedRoomClosed();
    expect(useSpectateMigrateStore.getState().ended).toBe(true);
  });

  it('★席のある人が居なくなったときだけ終わりにする（観戦者どうしの出入りでは何も起きない）', () => {
    opts?.onParticipantLeft?.('v2', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    expect(useSpectateMigrateStore.getState().ended).toBe(false);

    opts?.onParticipantLeft?.('p0', [{ pid: 'v1', role: 'spectator', name: '見物人' }]);
    expect(useSpectateMigrateStore.getState().ended).toBe(true);
  });

  it('通信が一時的に切れただけのときは終わりにしない（待つ）', () => {
    opts?.onDisconnected?.('サーバーへ再接続中です');
    expect(useSpectateMigrateStore.getState().ended).toBe(false);
  });
});

describe('v1.59 段3: 「入る」と出口（付録D-3 §4.3）', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({
      myRole: 'spectator',
      myPid: 'v1',
      isHost: false,
      currentRoomId: null,
      // ★v1.61: 見分けるのは**部屋名に載った待ち合わせの印**（親 §6.3.6）。
      // **入り方は元の部屋と同じ**なので、公開・非公開もパスワードも引き継ぐ。
      roomPassword: 'himitsu',
      rooms: [
        {
          id: 'r2',
          name: '[本+感+Mabc] 部屋',
          isPublic: true,
          hasPassword: true,
        } as never,
      ],
    });
    useSpectateMigrateStore.setState({
      offer: { room: '[本+感+Mabc] 部屋', pass: 'abc' },
      moving: false,
      ended: false,
    });
  });

  it('★「入る」で**観戦者として**移り先へ入る（渡さないと席に着いてしまう）', () => {
    acceptSpectateMigrate();
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ roomId: 'r2', password: 'himitsu', role: 'spectator' });
    expect(useSpectateMigrateStore.getState().moving).toBe(true);
  });

  it('★入れないまま待ち切ったら「対局が終わりました」＝答えた時点と失う時点は別', () => {
    vi.useFakeTimers();
    useMatchmakingStore.setState({ rooms: [] });
    acceptSpectateMigrate();
    expect(useSpectateMigrateStore.getState().ended).toBe(false);
    vi.advanceTimersByTime(13_000);
    expect(useSpectateMigrateStore.getState().ended).toBe(true);
    vi.useRealTimers();
  });

  it('★出口を押したら観戦の一覧へ戻る（割り込む確認には必ず出口を置く）', () => {
    declineSpectateMigrate();
    expect(useSpectateMigrateStore.getState().offer).toBeNull();
    expect(useRouteStore.getState().screen).toBe('spectate-lobby');
  });

  it('「対局が終わりました」の OK でも観戦の一覧へ戻る', () => {
    useSpectateMigrateStore.setState({ offer: null, moving: false, ended: true });
    dismissSpectateEnded();
    expect(useSpectateMigrateStore.getState().ended).toBe(false);
    expect(useRouteStore.getState().screen).toBe('spectate-lobby');
  });

  it('★観戦者として部屋に入ったら控えを決め直す（前の確認が次の観戦に出てこない）', () => {
    opts?.onJoinedRoom?.('r9', '別の部屋', 'ホスト', {} as never, {
      pid: 'v1',
      role: 'spectator',
      roster: [{ pid: 'v1', role: 'spectator', name: '見物人' }],
    } as never);
    expect(useSpectateMigrateStore.getState().offer).toBeNull();
    expect(useSpectateMigrateStore.getState().moving).toBe(false);
  });
});

describe('v1.59 段3: 「自分から出た」の印は部屋に入るたび決め直す', () => {
  /**
   * ★実機で見つかった（2026-08-22・公開ページ）。**一度でも自分から部屋を出た人は、
   * 入り直した先で本物の切断を握りつぶしていた**＝印は「出た直後に返ってくる知らせ」を
   * 無視するための使い捨てなのに、**消えるのはその知らせが届いたときだけ**だった。
   *
   * 症状＝**観戦者が「観戦をやめる」を押してから入り直すと、対局者が全員抜けても
   * 「対局が終わりました」が出ず、画面が固まったままになる**（感想戦へ移る経路でも
   * 同じ＝移るときに一度部屋を出るため）。**新しいタブでは正しく出る**ので、
   * 手元の 1 回きりの試しでは気づけない。
   */
  it('★出たあと入り直したら、その部屋の切断はちゃんと届く', () => {
    // 自分から出た（印が立つ）。
    useMatchmakingStore.getState().resetRoomState();
    expect(useMatchmakingStore.getState().intentionallyLeft).toBe(true);
    // 出た直後の知らせが届かないまま、次の部屋へ入る。
    useMatchmakingStore.getState().setCurrentRoom({ roomId: 'r9', roomName: '部屋', isHost: false });
    expect(useMatchmakingStore.getState().intentionallyLeft).toBe(false);

    useMatchmakingStore.setState({
      myRole: 'spectator',
      myPid: 'v1',
      roster: [{ pid: 'v1', role: 'spectator', name: '見物人' }],
    });
    opts?.onDisconnected?.('部屋が閉じられました');
    expect(useSpectateMigrateStore.getState().ended).toBe(true);
  });
});

describe('v1.59 段3: 感想戦の部屋では配るものが違う（親 §6.8.6）', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({
      myRole: 'host',
      myPid: 'p0',
      isHost: true,
      currentRoomId: 'r1',
      roster: [{ pid: 'p0', role: 'host', name: '太郎' }],
    });
  });

  afterEach(() => {
    register('review:spectatorArrived', undefined as never);
  });

  it('★感想戦の部屋なら、対局を丸ごと配る仕掛けは動かさない', () => {
    const asked: string[] = [];
    register('review:spectatorArrived', ((pid: string) => {
      asked.push(pid);
      return true;
    }) as never);
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    expect(asked).toEqual(['v1']);
    expect(sent.filter((x) => bodyOf(x).type === 'spectate_sync')).toHaveLength(0);
  });

  it('対局の部屋なら今までどおり対局を丸ごと配る（縮退互換）', () => {
    register('review:spectatorArrived', (() => false) as never);
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    const syncs = sent.filter((x) => bodyOf(x).type === 'spectate_sync');
    expect(syncs).toHaveLength(1);
    expect(syncs[0].to).toBe('v1');
  });
});
