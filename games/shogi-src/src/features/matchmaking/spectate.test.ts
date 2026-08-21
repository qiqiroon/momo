import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type {
  MomoCreateRoomOptions,
  MomoMatchmakingInitOptions,
  MomoRoomInfo,
} from './client';
import { handleShogiMessage } from './messageDispatcher';
import { PROTOCOL_VERSION, wrapShogiMessage, type ShogiMessage, type SpectateSyncMsg } from './protocol';
import {
  createSeatedRoom,
  isRoomSpectatorsFull,
  isSpectatable,
  isSpectator,
  SHOGI_MAX_SPECTATORS,
  spectatorSlotsFor,
  spectatorsOf,
} from './roster';
import { publishRoomPhase } from './roomState';
import { buildSpectateSync, movesFromHistory } from './spectate';
import { useMatchmakingStore } from './store';
import { useGameStore } from '../../core/store/game-store';
import { useRouteStore } from '../../core/store/route-store';

/**
 * ★v1.55 段2（ネット観戦・親 §6.8）の決めごとを固定する検査。
 *
 * ここが受け持つのは **2 台ないと手元では気づけない** 箇所：
 *   - **観戦を許さない部屋は観戦枠 0 で建つ**（可否を別の項目として持たない）
 *   - **観戦者が来たら、ホストがその 1 人に宛てていまの対局を丸ごと配る**
 *     （**まだ何も始まっていなくても配る**＝黙ると相手は永久に待つ）
 *   - **観戦者はルールの受領を返さない**（返すとホストが「ゲストが構えた」と取り違える）
 *   - **配られたものから盤を組み立て直す**（手を初手から並べ直す）
 */

const room = (over: Partial<MomoRoomInfo>): MomoRoomInfo => ({
  id: 'r1',
  name: '部屋',
  hostName: '太郎',
  hasPassword: false,
  isPublic: true,
  ...over,
});

describe('v1.55: 観戦できる部屋の見分け方（親 §6.8.2）', () => {
  it('★「席が無い」と「立場がまだ分からない」は別物として扱う', () => {
    expect(isSpectator('spectator')).toBe(true);
    expect(isSpectator('host')).toBe(false);
    expect(isSpectator('player')).toBe(false);
    // ★ここが肝＝!hasSeat() で書くと null まで観戦者になってしまう
    expect(isSpectator(null)).toBe(false);
    expect(isSpectator(undefined)).toBe(false);
  });

  it('★観戦の可否は「観戦枠の数」だけで表す（別の項目を持たない）', () => {
    expect(spectatorSlotsFor(true)).toBe(SHOGI_MAX_SPECTATORS);
    expect(spectatorSlotsFor(false)).toBe(0);
    expect(SHOGI_MAX_SPECTATORS).toBe(8);
  });

  it('★観戦を許さない部屋は観戦の一覧に出さない／満員でも出す', () => {
    // 許していない＝枠 0
    expect(isSpectatable(room({ mode: 'multi', maxSpectators: 0 }))).toBe(false);
    // 許している＝出す
    expect(isSpectatable(room({ mode: 'multi', maxSpectators: 8, spectatorCount: 0 }))).toBe(true);
    // 満員でも出す（押せないことと理由を見せるため）
    const full = room({ mode: 'multi', maxSpectators: 8, spectatorCount: 8 });
    expect(isSpectatable(full)).toBe(true);
    expect(isRoomSpectatorsFull(full)).toBe(true);
    expect(isRoomSpectatorsFull(room({ mode: 'multi', maxSpectators: 8, spectatorCount: 7 }))).toBe(
      false,
    );
  });

  it('★「観戦を許さない」で建てた部屋は枠 0 で建つ', () => {
    let got: MomoCreateRoomOptions | null = null;
    const client = {
      createRoom: (o: MomoCreateRoomOptions) => {
        got = o;
      },
    } as never;
    createSeatedRoom(client, { name: '部屋', hostName: '太郎', allowSpectators: false });
    const o = got as unknown as MomoCreateRoomOptions;
    expect(o.maxSpectators).toBe(0);
    // 席の数は変わらない（観戦を断っても対局はできる）
    expect(o.maxPlayers).toBe(2);
    // 内部で使うだけの項目が通信へ漏れていないこと
    expect((o as unknown as Record<string, unknown>).allowSpectators).toBeUndefined();
  });

  it('名簿から観戦者だけを取り出せる', () => {
    const roster = [
      { pid: 'p0', role: 'host' as const, name: '太郎' },
      { pid: 'v1', role: 'spectator' as const, name: '見物人' },
      { pid: 'p1', role: 'player' as const, name: '花子' },
      { pid: 'v2', role: 'spectator' as const, name: '見物人2' },
    ];
    expect(spectatorsOf(roster).map((p) => p.name)).toEqual(['見物人', '見物人2']);
  });
});

describe('v1.55: いまの対局を丸ごと配る（親 §6.8.4）', () => {
  let opts: MomoMatchmakingInitOptions | null = null;
  let sent: { data: unknown; to?: string }[] = [];

  const fakeApi = {
    init: (o: MomoMatchmakingInitOptions) => {
      opts = o;
    },
    createRoom: () => {},
    joinRoom: () => {},
    send: (data: unknown, to?: string) => {
      sent.push({ data, to });
    },
    leaveRoom: () => {},
    refreshRooms: () => {},
    kickGuest: () => {},
    getState: () => ({ isHost: true, connected: true, currentRoomId: null, currentRoomName: '' }),
    changeGameType: () => {},
  };

  beforeEach(() => {
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApi;
    ensureMatchmakingInit();
    sent = [];
    useMatchmakingStore.setState({
      connection: 'connected',
      isHost: true,
      opponentName: '',
      playerName: '太郎',
      roster: [],
      myPid: null,
      myRole: null,
      seatNames: null,
      spectateWaiting: false,
      gameStartInfo: null,
      activeRoomConfig: null,
    });
  });

  /** 観戦者が入ってきたときに送られたものを取り出す。 */
  const sentSpectateSync = () =>
    sent
      .map((x) => x.data as { body?: ShogiMessage })
      .map((x) => x.body)
      .find((m) => m?.type === 'spectate_sync') as SpectateSyncMsg | undefined;

  it('★観戦者が入ってきたら、ホストがその 1 人に宛てて配る', () => {
    opts?.onRoomCreated?.('r1', '部屋', undefined, {
      mode: 'multi',
      pid: 'p0',
      role: 'host',
      roster: [{ pid: 'p0', role: 'host', name: '太郎' }],
    });
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    const msg = sentSpectateSync();
    expect(msg).toBeDefined();
    // **入ってきたその人だけに宛てる**（全員に配らない）
    expect(sent.find((x) => (x.data as { body?: ShogiMessage }).body?.type === 'spectate_sync')?.to).toBe(
      'v1',
    );
  });

  it('★まだ何も始まっていなくても配る＝「無い」は送るべき事実（黙ると永久に待つ）', () => {
    opts?.onRoomCreated?.('r1', '部屋', undefined, {
      mode: 'multi',
      pid: 'p0',
      role: 'host',
      roster: [{ pid: 'p0', role: 'host', name: '太郎' }],
    });
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    const msg = sentSpectateSync();
    expect(msg?.phase).toBe('lobby');
    expect(msg?.sides).toBeNull();
    expect(msg?.moves).toEqual([]);
    // 名前は空でも「欄ごと省く」のではなく空として配る
    expect(msg?.names).toBeDefined();
  });

  it('★席のある人が入ってきたときは配らない（対局相手には要らない）', () => {
    opts?.onRoomCreated?.('r1', '部屋', undefined, {
      mode: 'multi',
      pid: 'p0',
      role: 'host',
      roster: [{ pid: 'p0', role: 'host', name: '太郎' }],
    });
    opts?.onParticipantJoined?.('p1', 'player', '花子', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'p1', role: 'player', name: '花子' },
    ]);
    expect(sentSpectateSync()).toBeUndefined();
  });

  it('配るのはホストだけ（ゲストは配らない＝二重に届かない）', () => {
    useMatchmakingStore.setState({ isHost: false });
    opts?.onParticipantJoined?.('v1', 'spectator', '見物人', [
      { pid: 'p0', role: 'host', name: '太郎' },
      { pid: 'v1', role: 'spectator', name: '見物人' },
    ]);
    expect(sentSpectateSync()).toBeUndefined();
  });

  it('★対局中なら、指した手を初手から全部そのまま載せて配る', () => {
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({
      gameStartInfo: { hostSide: 'sente', guestSide: 'gote' },
      roster: [
        { pid: 'p0', role: 'host', name: '太郎' },
        { pid: 'p1', role: 'player', name: '花子' },
      ],
      myPid: 'p0',
      myRole: 'host',
    });
    // 先手が 1 手指す（7七の歩を 7六へ）
    const before = useGameStore.getState().position;
    const pawn = before.board[6][2];
    expect(pawn).not.toBeNull();
    useGameStore.getState().applyRemoteMove({
      kind: 'move',
      pieceId: pawn!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    });
    const msg = buildSpectateSync();
    expect(msg.phase).toBe('playing');
    expect(msg.sides).toEqual({ hostSide: 'sente', guestSide: 'gote' });
    expect(msg.moves).toHaveLength(1);
    expect(msg.moves[0].kind).toBe('move');
    expect(msg.moves[0].to).toEqual({ row: 5, col: 2 });
    // 対局者の名前は名簿の席から読む（観戦者には「あなた／あいて」が無いため）
    expect(msg.names).toEqual({ host: '太郎', guest: '花子' });
  });

  it('感想戦で作られる「自由な手」は配り物に混ぜない（並べ直せないため）', () => {
    expect(
      movesFromHistory([
        { type: 'free', pieceId: 'P0', dest: { kind: 'discard' } },
        { type: 'drop', pieceId: 'P1', to: { row: 4, col: 4 } },
      ]),
    ).toHaveLength(1);
  });
});

describe('v1.55: 配られたものから組み立て直す（親 §6.8.4）', () => {
  beforeEach(() => {
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({
      isHost: false,
      myRole: 'spectator',
      seatNames: null,
      spectateWaiting: true,
      gameStartInfo: null,
      activeRoomConfig: null,
    });
    useRouteStore.setState({ screen: 'room' });
  });

  const syncMsg = (over: Partial<SpectateSyncMsg> = {}): SpectateSyncMsg => ({
    v: PROTOCOL_VERSION,
    type: 'spectate_sync',
    phase: 'playing',
    rules: null,
    sides: { hostSide: 'sente', guestSide: 'gote' },
    names: { host: '太郎', guest: '花子' },
    moves: [],
    ...over,
  });

  it('★受け取ったら盤を作り直し、手を初手から並べ直す', () => {
    // 初期配置の 7七歩 → 7六 という 1 手だけを配る
    const pawn = useGameStore.getState().position.board[6][2]!;
    handleShogiMessage(
      unwrap(
        syncMsg({
          moves: [
            {
              v: PROTOCOL_VERSION,
              type: 'move',
              kind: 'move',
              pieceId: pawn.pieceId,
              from: { row: 6, col: 2 },
              to: { row: 5, col: 2 },
              promote: false,
            },
          ],
        }),
      ),
    );
    const pos = useGameStore.getState().position;
    expect(pos.history).toHaveLength(1);
    expect(pos.board[5][2]).not.toBeNull();
    expect(pos.board[6][2]).toBeNull();
    // 手番も並べ直した結果に従う（1 手指したので後手番）
    expect(pos.sideToMove).toBe('player2');
  });

  it('★受け取ったら「受け取っています」を下ろし、対局中なら盤へ移る', () => {
    handleShogiMessage(unwrap(syncMsg()));
    expect(useMatchmakingStore.getState().spectateWaiting).toBe(false);
    expect(useRouteStore.getState().screen).toBe('game');
    expect(useMatchmakingStore.getState().seatNames).toEqual({ host: '太郎', guest: '花子' });
  });

  it('★人待ちの部屋なら盤へは移らない（見るべき盤がまだ無い）', () => {
    handleShogiMessage(unwrap(syncMsg({ phase: 'lobby', sides: null })));
    expect(useMatchmakingStore.getState().spectateWaiting).toBe(false);
    // 準備画面のまま
    expect(useRouteStore.getState().screen).toBe('room');
  });
});

describe('v1.55: 観戦者は正しさの担保に加わらない（親 §6.8.1）', () => {
  let sent: unknown[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = {
      init: () => {},
      createRoom: () => {},
      joinRoom: () => {},
      send: (data: unknown) => {
        sent.push(data);
      },
      leaveRoom: () => {},
      refreshRooms: () => {},
      kickGuest: () => {},
      getState: () => ({ isHost: false, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
      changeGameType: () => {},
    };
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({ activeRoomConfig: null, myRole: null });
  });

  const ruleSync = () => ({
    v: PROTOCOL_VERSION,
    type: 'rule_sync' as const,
    rules: {
      gameType: 'shogi' as const,
      torusMode: 'none' as const,
      quantum: false,
      quantumDisplayMode: 'cycle' as const,
      timeControl: useGameStore.getState().timeControl,
      handicap: null,
      quantumParams: useGameStore.getState().quantumParams,
    },
    digest: 'x',
    capabilities: ['shogi'],
  });

  const acks = () =>
    sent
      .map((d) => (d as { body?: ShogiMessage }).body)
      .filter((m) => m?.type === 'rule_ack');

  it('対局者はルールを受け取ったら受領を返す（従来どおり）', () => {
    useMatchmakingStore.setState({ myRole: 'player' });
    handleShogiMessage(ruleSync());
    expect(acks()).toHaveLength(1);
  });

  it('★観戦者はルールを受け取っても受領を返さない（返すと席が空でも対局できるように見える）', () => {
    useMatchmakingStore.setState({ myRole: 'spectator' });
    handleShogiMessage(ruleSync());
    expect(acks()).toHaveLength(0);
    // ただしルールは自分の盤に入っている（観戦者にも同じ盤が要る）
    expect(useMatchmakingStore.getState().activeRoomConfig?.gameType).toBe('shogi');
  });
});

describe('v1.55: 部屋の段をサーバーへ知らせる（親 §6.8.2）', () => {
  let sent: unknown[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = {
      init: () => {},
      createRoom: () => {},
      joinRoom: () => {},
      send: (data: unknown) => {
        sent.push(data);
      },
      leaveRoom: () => {},
      refreshRooms: () => {},
      kickGuest: () => {},
      getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
      changeGameType: () => {},
    };
    useMatchmakingStore.setState({ isHost: true, currentRoomId: 'r1' });
  });

  const states = () =>
    sent
      .map((d) => d as { type?: string; gameState?: string })
      .filter((d) => d.type === 'game_state_update')
      .map((d) => d.gameState);

  it('★項目名は gameState（実測＝state という名前では黙って無視される）', () => {
    publishRoomPhase('playing');
    const msg = sent[0] as Record<string, unknown>;
    expect(msg.type).toBe('game_state_update');
    expect(msg.gameState).toBe('playing');
    // ★包みに入れない＝これはサーバー自身に宛てた指示で、参加者への伝言ではない
    expect(msg.body).toBeUndefined();
  });

  // ★覚えているのはモジュールの中なので、検査ごとに**違う部屋**を使う
  //   （同じ部屋を使い回すと、前の検査が送ったぶんで黙ってしまう）。
  it('同じ部屋で同じ段は送り直さない', () => {
    useMatchmakingStore.setState({ currentRoomId: 'rA' });
    publishRoomPhase('playing');
    publishRoomPhase('playing');
    expect(states()).toEqual(['playing']);
  });

  it('★部屋が変われば同じ段でも送り直す（忘れる処理を別に置かなくて済む形）', () => {
    useMatchmakingStore.setState({ currentRoomId: 'rB' });
    publishRoomPhase('playing');
    useMatchmakingStore.setState({ currentRoomId: 'rC' });
    publishRoomPhase('playing');
    expect(states()).toEqual(['playing', 'playing']);
  });

  it('ホストでなければ知らせない（書き手を 1 人に絞る）', () => {
    useMatchmakingStore.setState({ isHost: false });
    publishRoomPhase('ended');
    expect(states()).toEqual([]);
  });

  it('部屋に居なければ知らせない', () => {
    useMatchmakingStore.setState({ currentRoomId: null });
    publishRoomPhase('ended');
    expect(states()).toEqual([]);
  });
});

/** 包みに入れずに直接 dispatcher へ渡すための小道具（送受信の形は protocol の検査が持つ）。 */
function unwrap(msg: SpectateSyncMsg): unknown {
  return (wrapShogiMessage(msg) as { body: unknown }).body;
}
