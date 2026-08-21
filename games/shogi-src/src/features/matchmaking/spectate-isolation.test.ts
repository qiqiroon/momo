import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoMatchmakingInitOptions } from './client';
import { handleShogiMessage } from './messageDispatcher';
import {
  PROTOCOL_VERSION,
  senderOfMessage,
  wrapShogiMessage,
  type ShogiMessage,
} from './protocol';
import { useMatchmakingStore } from './store';
import './gameConnector';
import { useGameStore } from '../../core/store/game-store';
import { useRouteStore } from '../../core/store/route-store';
import { useChatStore } from '../../core/store/chat-store';
import { useOffersStore } from '../../core/store/offers-store';
import { get as pluginGet, register } from '../../core/plugin/registry';
import { keepsScreenAwake } from '../../core/ui-core/useWakeLock';

/**
 * ★v1.55（第55セッション・2026-08-21 実機のご報告からの直し）。
 *
 * v1.68 で観戦者を部屋へ入れたとき、**伝言の既定の宛先が「自分以外の全員」**なので、
 * **二人で決めるための伝言まで観戦者に届き、観戦者側の仕掛けが反応していた**。
 * 実機では次の形で出た。
 *   - **感想戦の打診が観戦者にも届き、観戦者が「受ける」と答えられて対局相手が置き去り**
 *   - **振り駒のコミットが二人ぶん届いて必ず食い違い「改ざんの疑い」の警告**
 *   - **観戦者が対局者の入室を「相手が来た」と受け取り、状態合わせを送り返して
 *     二人の準備状態を上書き**（対局が始まっても観戦者の画面が始まらない）
 *   - **観戦者の発言が「後手」と表示**（席を持たないのに席を名乗っていた）
 */

const fakeApiFactory = (
  sent: { data: unknown; to?: string }[],
  onInit?: (o: MomoMatchmakingInitOptions) => void,
) => ({
  init: (o: MomoMatchmakingInitOptions) => onInit?.(o),
  createRoom: () => {},
  joinRoom: () => {},
  send: (data: unknown, to?: string) => sent.push({ data, to }),
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: false, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
  changeGameType: () => {},
});

describe('v1.55: 観戦者は「二人で決める伝言」に関わらない（親 §6.8.1）', () => {
  let opts: MomoMatchmakingInitOptions | null = null;
  let sent: { data: unknown; to?: string }[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(
      sent,
      (o) => {
        opts = o;
      },
    );
    ensureMatchmakingInit();
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({
      myRole: 'spectator',
      myPid: 'v1',
      isHost: false,
      opponentName: '',
      oppSideChoice: null,
      oppReady: false,
      oppFurigomaCommit: null,
      furigomaError: null,
      gameStartInfo: null,
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'v1', role: 'spectator', name: '見物人' },
      ],
    });
    useOffersStore.setState({ reviewOfferFrom: null });
  });

  it('★感想戦の打診も諾否も、感想戦の側へ渡さない（観戦者が「受ける」と答えられていた）', () => {
    // ★**受け口を実際に置いて、呼ばれないことを見る**＝置かずに「何も起きない」を
    //   見ると、弾けていなくても緑になる（素通りの検査になる）。
    const got: unknown[] = [];
    register('review:message', ((m: unknown) => got.push(m)) as never);
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'review', payload: { kind: 'offer' } });
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'review',
      payload: { kind: 'reply', accepted: true },
    });
    expect(got).toHaveLength(0);
    register('review:message', undefined as never);
  });

  it('感想戦でも盤を追う伝言は受け取る＝打診と諾否だけを弾く（弾きすぎない）', () => {
    const got: unknown[] = [];
    register('review:message', ((m: unknown) => got.push(m)) as never);
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'review',
      payload: { kind: 'seek', base: [], ply: 3 },
    });
    expect(got).toEqual([{ kind: 'seek', base: [], ply: 3 }]);
    register('review:message', undefined as never);
  });

  it('★振り駒のやり取りに反応しない（二人ぶん受け取って必ず食い違っていた）', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'furigoma_commit', commit: 'aaa' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'furigoma_commit', commit: 'bbb' });
    expect(useMatchmakingStore.getState().oppFurigomaCommit).toBeNull();
    expect(useMatchmakingStore.getState().furigomaError).toBeNull();
  });

  it('先後の選択・準備完了・状態合わせにも反応しない', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'side_select', choice: 'sente' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'ready', ready: true });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'state_sync', choice: 'gote', ready: true });
    expect(useMatchmakingStore.getState().oppSideChoice).toBeNull();
    expect(useMatchmakingStore.getState().oppReady).toBe(false);
  });

  it('★盤を追うための伝言は今までどおり受け取る', () => {
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'game_start',
      hostSide: 'sente',
      guestSide: 'gote',
    });
    expect(useMatchmakingStore.getState().gameStartInfo).toEqual({
      hostSide: 'sente',
      guestSide: 'gote',
    });
  });

  it('対局者は今までどおり全部受け取る（縮退互換）', () => {
    useMatchmakingStore.setState({ myRole: 'player' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'ready', ready: true });
    expect(useMatchmakingStore.getState().oppReady).toBe(true);
  });

  it('★観戦者は対局者の入室を「自分の相手が来た」と受け取らない', () => {
    opts?.onParticipantJoined?.('p1', 'player', '花子', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    // 名簿は更新されるが、相手としては拾わない
    expect(useMatchmakingStore.getState().roster).toHaveLength(3);
    expect(useMatchmakingStore.getState().opponentName).toBe('');
  });
});

describe('v1.55: チャットの送り分け（親 §6.8.5）', () => {
  let sent: { data: unknown; to?: string }[] = [];

  const connector = () => pluginGet<{ sendChat: (t: string) => void }>('gameConnector')!;
  const bodies = () => sent.map((x) => (x.data as { body?: ShogiMessage }).body);

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(sent);
    useChatStore.getState().clearChat();
    useRouteStore.setState({ screen: 'game' });
    useMatchmakingStore.setState({
      myRole: 'spectator',
      myPid: 'v1',
      playerName: '見物人',
      isHost: false,
      gameStartInfo: null,
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'p1', role: 'player', name: '花子' },
        { pid: 'v1', role: 'spectator', name: '見物人' },
        { pid: 'v2', role: 'spectator', name: '見物人2' },
      ],
    });
  });

  it('★観戦者の発言は観戦者へ一人ずつ宛てる（全員へ送って無視させる形は採らない）', () => {
    connector().sendChat('こんにちは');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('v2');
  });

  it('★観戦者の発言に席（先手／後手）を入れない（実機で「後手」と出ていた）', () => {
    connector().sendChat('こんにちは');
    const body = bodies()[0] as { type: string; side?: string };
    expect(body.type).toBe('chat');
    expect(body.side).toBeUndefined();
  });

  it('聞く人が居なくても、書いた本人の画面には出す', () => {
    useMatchmakingStore.setState({
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'v1', role: 'spectator', name: '見物人' },
      ],
    });
    connector().sendChat('ひとりごと');
    expect(sent).toHaveLength(0);
    expect(useChatStore.getState().messages).toEqual([
      { kind: 'spectator', name: '見物人', text: 'ひとりごと' },
    ]);
  });

  it('★感想戦では観戦者の発言も全員に届く（勝敗が無く助言という概念が無い場）', () => {
    useRouteStore.setState({ screen: 'review' });
    connector().sendChat('いい手でしたね');
    expect(sent).toHaveLength(1);
    // 宛先を指定しない＝自分以外の全員
    expect(sent[0].to).toBeUndefined();
  });

  it('対局者の発言は今までどおり席つきで全員へ（縮退互換）', () => {
    useMatchmakingStore.setState({
      myRole: 'player',
      isHost: true,
      gameStartInfo: { hostSide: 'sente', guestSide: 'gote' },
    });
    connector().sendChat('よろしく');
    const body = bodies()[0] as { side?: string };
    expect(body.side).toBe('player1');
    expect(sent[0].to).toBeUndefined();
  });

  it('★受け取った側は送り主を名簿に照らして振り分ける（発言に立場を書き込まない）', () => {
    useMatchmakingStore.setState({ myRole: 'spectator' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'chat', text: 'やあ' }, 'v2');
    expect(useChatStore.getState().messages).toEqual([
      { kind: 'spectator', name: '見物人2', text: 'やあ' },
    ]);
  });

  it('席のある人の発言は席つきの行として入る', () => {
    useMatchmakingStore.setState({ myRole: 'player' });
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'chat', side: 'player2', text: 'どうも' }, 'p1');
    expect(useChatStore.getState().messages).toEqual([
      { kind: 'player', side: 'player2', text: 'どうも' },
    ]);
  });

  it('★包みの外側に付いた送り主を捨てない（花札で起きた壊れ方と同じ形）', () => {
    const wrapped = {
      ...(wrapShogiMessage({ v: PROTOCOL_VERSION, type: 'ping' }) as object),
      from: 'p1',
    };
    expect(senderOfMessage(wrapped)).toBe('p1');
    expect(senderOfMessage({ v: 1, type: 'ping' })).toBeUndefined();
  });
});

describe('v1.55: 画面を消させない（画面機能 §4.0）', () => {
  it('★盤を眺めている画面でだけ効かせる', () => {
    for (const s of ['room', 'game', 'kifu-replay', 'review']) {
      expect(keepsScreenAwake(s)).toBe(true);
    }
    // 選ぶために触り続ける場所では効かせない
    for (const s of ['lobby', 'net-lobby', 'spectate-lobby', 'review-lobby', 'rule-select']) {
      expect(keepsScreenAwake(s)).toBe(false);
    }
  });
});
