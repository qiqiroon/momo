import { describe, it, expect, beforeEach } from 'vitest';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';
import type { MomoMatchmakingInitOptions, MomoRole } from './client';
import { ensureMatchmakingInit } from './bootstrap';
import { decodeRoomName, encodeRoomName } from './roomNameCodec';
import { buildMigratedRoomName, createMigratedReviewRoom, joinMigratedReviewRoom } from './reviewRoom';
import { useMatchmakingStore } from './store';
import './gameConnector';

/**
 * ★v1.61（2026-08-22 実機のご報告・第56セッション）＝**感想戦の部屋の「人の入れ方」**。
 *
 * ## 直した形
 *
 * v1.49〜v1.60 は**その場限りの合言葉を部屋のパスワードとして使い、非公開で建てて**いた。
 * そのため**元の部屋が公開でも移り先は必ず非公開＋人の知らない合言葉**になり、
 * **感想戦から抜けた観戦者は二度と入り直せなかった**（ご報告）。
 *
 * **§9.4.4 は元から「非公開とパスワードは引き継ぐ」と定めており、手順の側だけが
 * それに従っていなかった**（規定どうしの食い違い）。
 *
 * ## ここで固定すること
 *
 * - **公開・非公開とパスワードは元の部屋のものを引き継ぐ**
 * - **待ち合わせの印は部屋名に載せる**（パスワードではない・人には見せない）
 * - **見分けるのは印**（名前だけで見分けない）
 */

let created: { name: string; password: string; isPublic: boolean }[] = [];
let joined: { roomId: string; password: string; role?: MomoRole }[] = [];
let sent: unknown[] = [];

const fakeApi = (onInit?: (o: MomoMatchmakingInitOptions) => void) => ({
  init: (o: MomoMatchmakingInitOptions) => onInit?.(o),
  createRoom: (o: { name: string; password?: string; isPublic?: boolean }) =>
    created.push({ name: o.name, password: o.password ?? '', isPublic: o.isPublic !== false }),
  joinRoom: (roomId: string, password: string, _name: string, role?: MomoRole) =>
    joined.push({ roomId, password, role }),
  send: (d: unknown) => sent.push(d),
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '' }),
  changeGameType: () => {},
});

beforeEach(() => {
  created = [];
  joined = [];
  sent = [];
  (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi();
  ensureMatchmakingInit();
  useMatchmakingStore.setState({
    currentRoomId: 'r1',
    currentRoomName: encodeRoomName({
      gameType: 'shogi',
      torus: false,
      quantum: false,
      userRoomName: '私の部屋',
    }),
    isHost: true,
    roomPassword: 'himitsu',
    roomIsPublic: true,
  });
});

describe('v1.61: 待ち合わせの印は部屋名に載せる（親 §6.3.6）', () => {
  it('★印は部屋名に載り、人に見える部屋名は変わらない', () => {
    const name = buildMigratedRoomName('私の部屋', 'abc123');
    const parts = decodeRoomName(name);
    expect(parts.meetToken).toBe('abc123');
    expect(parts.userRoomName).toBe('私の部屋');
    expect(parts.review).toBe(true);
  });

  it('★印はバッジに出さない（人には見せない）', () => {
    const parts = decodeRoomName(buildMigratedRoomName('私の部屋', 'abc123'));
    expect(parts.unknownFlags).toEqual([]);
  });

  it('印の無い部屋名は今までどおり読める（縮退互換）', () => {
    const parts = decodeRoomName('[本+TF] ふつうの部屋');
    expect(parts.meetToken).toBeUndefined();
    expect(parts.userRoomName).toBe('ふつうの部屋');
  });
});

describe('v1.61: 移り先は元の部屋の入れ方を引き継ぐ（親 §9.4.4）', () => {
  it('★公開の部屋から移ったら、移り先も公開＋同じ合言葉', () => {
    createMigratedReviewRoom({ room: '[本+感+Mabc] 私の部屋', pass: 'abc' });
    expect(created).toHaveLength(1);
    expect(created[0].isPublic).toBe(true);
    expect(created[0].password).toBe('himitsu');
  });

  it('★非公開の部屋から移ったら、移り先も非公開（人の入れ方を勝手に広げない）', () => {
    useMatchmakingStore.setState({ roomIsPublic: false, roomPassword: 'pw' });
    createMigratedReviewRoom({ room: '[本+感+Mabc] 私の部屋', pass: 'abc' });
    expect(created[0].isPublic).toBe(false);
    expect(created[0].password).toBe('pw');
  });

  it('★合言葉の無い部屋から移ったら、移り先も合言葉なし（勝手に付けない）', () => {
    useMatchmakingStore.setState({ roomPassword: '', roomIsPublic: true });
    createMigratedReviewRoom({ room: '[本+感+Mabc] 私の部屋', pass: 'abc' });
    expect(created[0].password).toBe('');
    expect(created[0].isPublic).toBe(true);
  });
});

describe('v1.61: 移り先は印で見分ける（親 §6.3.6）', () => {
  beforeEach(() => {
    useMatchmakingStore.setState({
      currentRoomId: null,
      roomPassword: 'himitsu',
      rooms: [
        { id: 'x1', name: '[本+感] 私の部屋', isPublic: true, hasPassword: true } as never,
        { id: 'x2', name: '[本+感+Mabc123] 私の部屋', isPublic: true, hasPassword: true } as never,
      ],
    });
  });

  it('★同じ名前の部屋が 2 つあっても、印の合う部屋を選ぶ', () => {
    joinMigratedReviewRoom({ room: '[本+感+Mabc123] 私の部屋', pass: 'abc123' });
    expect(joined).toHaveLength(1);
    expect(joined[0].roomId).toBe('x2');
  });

  it('★入るときは元の部屋の合言葉を使う（印を合言葉として使わない）', () => {
    joinMigratedReviewRoom({ room: '[本+感+Mabc123] 私の部屋', pass: 'abc123' });
    expect(joined[0].password).toBe('himitsu');
  });

  it('★観戦者として移るときは立場を渡す', () => {
    joinMigratedReviewRoom({ room: '[本+感+Mabc123] 私の部屋', pass: 'abc123', asSpectator: true });
    expect(joined[0].role).toBe('spectator');
  });
});

describe('v1.61: ホストは観戦者を退室させられる（親 §6.8.4）', () => {
  it('★pid を添えて送る（pid 無しの口は多人数では効かない）', () => {
    useMatchmakingStore.setState({ currentRoomId: 'r1', isHost: true });
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.kickSpectator('v1');
    expect(sent).toEqual([{ type: 'kick', pid: 'v1' }]);
  });

  it('★ホストでなければ送らない', () => {
    useMatchmakingStore.setState({ currentRoomId: 'r1', isHost: false });
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.kickSpectator('v1');
    expect(sent).toEqual([]);
  });
});
