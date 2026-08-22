/**
 * 持将棋の提案・応答の運び方（親 v1.62 §4.4.1.3）。
 *
 * ここで押さえたいことは 4 つ。
 * 1. **提案と応答は引分の申し出とは別の伝言**（成立したときの終局理由が違うため）
 * 2. **受け入れたら「持将棋」で終局する**（「合意による引分」にならない）
 * 3. **断ったときは終局しない**（対局継続）
 * 4. **観戦者は諾否に関わらないが、提案中であることだけは受け取る**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoMatchmakingInitOptions } from './client';
import { handleShogiMessage } from './messageDispatcher';
import { PROTOCOL_VERSION } from './protocol';
import { useMatchmakingStore } from './store';
import './gameConnector';
import { useGameStore } from '../../core/store/game-store';
import { useOffersStore } from '../../core/store/offers-store';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';

const fakeApiFactory = (sent: { data: unknown; to?: string }[]) => ({
  init: (_o: MomoMatchmakingInitOptions) => {},
  createRoom: () => {},
  joinRoom: () => {},
  send: (data: unknown, to?: string) => sent.push({ data, to }),
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
  changeGameType: () => {},
});

/**
 * 送られた伝言のうち、**包みの中身**だけを取り出す（親 §6.2）。
 * 対局の伝言は `{ type: 'shogi', body: {...} }` の形で運ばれる。
 */
function payloadsOf(sent: { data: unknown }[]): Record<string, unknown>[] {
  return sent
    .map((s) => (s.data as { body?: Record<string, unknown> })?.body)
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null);
}

describe('持将棋の提案と応答（対局者どうし）', () => {
  let sent: { data: unknown; to?: string }[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(sent);
    ensureMatchmakingInit();
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({ myRole: 'player', myPid: 'p0', isHost: true, roster: [] });
    useOffersStore.getState().clearAll();
  });

  it('相手からの提案を受け取ると「答える番」になり、締め切りが入る', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    const st = useOffersStore.getState();
    expect(st.jishogiOfferFrom).toBe('opp');
    expect(st.jishogiDeadline).not.toBeNull();
    // ★引分の申し出とは別の枠＝取り違えると、どちらに答えたのか分からなくなる
    expect(st.drawOfferFrom).toBeNull();
  });

  it('★受け入れると「持将棋」で終局する（合意による引分にはならない）', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    const c = pluginGet<OnlineGameConnector>('gameConnector')!;
    c.sendJishogiResponse(true);
    expect(useGameStore.getState().status).toBe('jishogi');
    expect(useOffersStore.getState().jishogiOfferFrom).toBeNull();
    expect(payloadsOf(sent).some((p) => p.type === 'jishogi_response' && p.accepted === true)).toBe(
      true,
    );
  });

  it('拒否すると終局しない（対局継続）が、答えは必ず送る', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    const c = pluginGet<OnlineGameConnector>('gameConnector')!;
    c.sendJishogiResponse(false);
    expect(useGameStore.getState().status).toBe('playing');
    // ★**断ったことも送る**＝送らないと提案した側は永久に待つ
    expect(payloadsOf(sent).some((p) => p.type === 'jishogi_response' && p.accepted === false)).toBe(
      true,
    );
  });

  it('提案すると「返事待ち」になり、jishogi_offer が送られる', () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector')!;
    c.sendJishogiOffer();
    expect(useOffersStore.getState().jishogiOfferFrom).toBe('me');
    expect(payloadsOf(sent).some((p) => p.type === 'jishogi_offer')).toBe(true);
  });

  it('相手が受け入れた知らせで「持将棋」終局・断りの知らせでは終局しない', () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector')!;
    c.sendJishogiOffer();
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_response', accepted: false });
    expect(useGameStore.getState().status).toBe('playing');
    expect(useOffersStore.getState().jishogiOfferFrom).toBeNull();
    // ★断られたことは「不成立」として画面へ渡す（次の自分の手番まで再提案しないため）
    expect(useOffersStore.getState().lastNoticeKind).toBe('jishogi');
    expect(useOffersStore.getState().lastNoticeType).toBe('rejected');

    c.sendJishogiOffer();
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_response', accepted: true });
    expect(useGameStore.getState().status).toBe('jishogi');
  });
});

describe('観戦者から見た持将棋の提案（親 §4.4.1.3）', () => {
  let sent: { data: unknown; to?: string }[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(sent);
    ensureMatchmakingInit();
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({ myRole: 'spectator', myPid: 'v1', isHost: false, roster: [] });
    useOffersStore.getState().clearAll();
  });

  it('★観戦者には諾否を出さない＝「提案中」の印だけが立つ', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    const st = useOffersStore.getState();
    // 答える番にしない（選ばせるものが無い）
    expect(st.jishogiOfferFrom).toBeNull();
    // 盤が止まるので、提案中であることだけは見せる
    expect(st.jishogiSpectatorNotice).toBe(true);
  });

  it('★観戦者の画面でも、応答が来たら印が消える（出しっぱなしにしない）', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_response', accepted: false });
    expect(useOffersStore.getState().jishogiSpectatorNotice).toBe(false);
  });

  it('★観戦者の端末で対局が「持将棋」で終わることは、応答の知らせで伝わる', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_offer' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'jishogi_response', accepted: true });
    // 観戦者は諾否に関わらないが、**結果は見届けられる**
    expect(useGameStore.getState().status).toBe('jishogi');
    expect(useOffersStore.getState().jishogiSpectatorNotice).toBe(false);
  });
});
