import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../../core/store/game-store';
import { DEFAULT_QUANTUM_PARAMS } from '../../core/store/quantum-params';
import { normalizeIncomingRules } from './bootstrap';
import { handleShogiMessage } from './messageDispatcher';
import { CLIENT_CAPABILITIES, PROTOCOL_VERSION, ruleDigest, unwrapShogiMessage, type SyncedRules } from './protocol';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore } from './store';

/**
 * Phase 5-12 ルール同期の往復 (親 §6.5 / §6.5.2)。
 *
 * 送受信の口をモックして、ゲスト側が受け取ったルールを本当に採用するか・ホスト側が
 * 食い違いに気づくかを固定する。
 */

type SentMsg = Record<string, unknown>;
let sent: SentMsg[] = [];

function installMockClient() {
  const mockApi = {
    init: () => {},
    createRoom: () => {},
    joinRoom: () => {},
    // ★v1.53: 対局の伝言は包みに入って線に乗る（親 §6.2）ので、
    // 検査は**取り出してから**中身を見る。見たいものは今までと同じ。
    send: (m: unknown) => { sent.push(unwrapShogiMessage(m) as SentMsg); },
    leaveRoom: () => {},
    refreshRooms: () => {},
    kickGuest: () => {},
    getState: () => ({ isHost: false, connected: true, currentRoomId: 'r1', currentRoomName: 'x' }),
    changeGameType: () => {},
  };
  (window as unknown as { MomoMatchmaking: typeof mockApi }).MomoMatchmaking = mockApi;
}

const HOST_RULES: SyncedRules = {
  gameType: 'shogi',
  torusMode: 'full',
  quantum: true,
  quantumDisplayMode: 'stack',
  timeControl: { mode: 'byoyomi', mainSeconds: 900, byoyomiSeconds: 30 },
  quantumParams: { ...DEFAULT_QUANTUM_PARAMS, maxIterations: 64 },
  handicap: null,
};

function ruleSyncMsg(rules: SyncedRules = HOST_RULES) {
  return {
    v: PROTOCOL_VERSION,
    type: 'rule_sync' as const,
    rules,
    digest: ruleDigest(rules),
    capabilities: CLIENT_CAPABILITIES,
  };
}

beforeEach(() => {
  sent = [];
  installMockClient();
  useMatchmakingStore.setState({
    activeRoomConfig: { ...DEFAULT_ROOM_CONFIG },
    ruleSyncPhase: 'idle',
    ruleSyncReason: null,
  });
  useGameStore.getState().setQuantumParams(DEFAULT_QUANTUM_PARAMS);
});

afterEach(() => {
  delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
});

describe('ゲスト側: ルールを受け取る', () => {
  it('ホストが決めたルールをそのまま採用し、受領確認を返す', () => {
    handleShogiMessage(ruleSyncMsg());

    const cfg = useMatchmakingStore.getState().activeRoomConfig;
    expect(cfg?.torusMode).toBe('full');
    expect(cfg?.torus).toBe(true);
    expect(cfg?.quantum).toBe(true);
    expect(cfg?.quantumDisplayMode).toBe('stack');
    expect(cfg?.timeControl.byoyomiSeconds).toBe(30);
    expect(useMatchmakingStore.getState().ruleSyncPhase).toBe('ok');

    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(ack).toBeTruthy();
    expect(ack?.ok).toBe(true);
  });

  it('量子の実行時パラメータもホストの値に揃える', () => {
    // v1.19 の申し送り。片側だけ反復上限が違うと両者の計算結果がずれる。
    handleShogiMessage(ruleSyncMsg());
    expect(useGameStore.getState().quantumParams.maxIterations).toBe(64);
  });

  it('量子 ON なら駒の身元の並びを添えて返す', () => {
    handleShogiMessage(ruleSyncMsg());
    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(typeof ack?.pieceIdListHash).toBe('string');
  });

  it('量子 OFF では駒の身元の並びを送らない (§6.5.2)', () => {
    handleShogiMessage(ruleSyncMsg({ ...HOST_RULES, quantum: false }));
    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(ack?.pieceIdListHash).toBeUndefined();
  });

  it('扱えないルールなら理由を付けて断り、採用しない', () => {
    handleShogiMessage(ruleSyncMsg({ ...HOST_RULES, gameType: 'shogi-custom' }));

    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(ack?.ok).toBe(false);
    expect(ack?.reason).toBe('unsupported_game_type');
    expect(useMatchmakingStore.getState().ruleSyncPhase).toBe('failed');
    // 断ったのに設定だけ書き換わっていたら、断った意味がない
    expect(useMatchmakingStore.getState().activeRoomConfig?.gameType).toBe('shogi');
  });
});

describe('ホスト側: 受領確認を検証する', () => {
  function asHostWith(rules: SyncedRules) {
    useMatchmakingStore.setState({
      activeRoomConfig: {
        ...DEFAULT_ROOM_CONFIG,
        gameType: rules.gameType,
        torus: rules.torusMode !== 'none',
        torusMode: rules.torusMode,
        quantum: rules.quantum,
        quantumDisplayMode: rules.quantumDisplayMode,
        timeControl: rules.timeControl,
      },
      ruleSyncPhase: 'sent',
    });
    useGameStore.getState().setQuantumParams(rules.quantumParams);
  }

  it('同じ見取り図が返ってくれば揃ったことにする', () => {
    asHostWith(HOST_RULES);
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'rule_ack',
      ok: true,
      digest: ruleDigest(HOST_RULES),
      capabilities: CLIENT_CAPABILITIES,
    });
    expect(useMatchmakingStore.getState().ruleSyncPhase).toBe('ok');
  });

  it('相手が項目を落としていたら食い違いとして止める', () => {
    // 古いクライアントがトーラスの詳細を知らずに円筒として構えた、という筋書き。
    asHostWith(HOST_RULES);
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'rule_ack',
      ok: true,
      digest: ruleDigest({ ...HOST_RULES, torusMode: 'cylinder' }),
      capabilities: CLIENT_CAPABILITIES,
    });
    const s = useMatchmakingStore.getState();
    expect(s.ruleSyncPhase).toBe('failed');
    expect(s.ruleSyncReason).toBe('rule_digest_mismatch');
  });

  it('駒の身元の並びが違えば止める (§6.5.2)', () => {
    asHostWith(HOST_RULES);
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'rule_ack',
      ok: true,
      digest: ruleDigest(HOST_RULES),
      pieceIdListHash: 'P0:player1:0,0',
      capabilities: CLIENT_CAPABILITIES,
    });
    const s = useMatchmakingStore.getState();
    expect(s.ruleSyncPhase).toBe('failed');
    expect(s.ruleSyncReason).toBe('pieceid_hash_mismatch');
  });

  it('相手が断ってきたら理由を残して止める', () => {
    asHostWith(HOST_RULES);
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'rule_ack',
      ok: false,
      digest: ruleDigest(HOST_RULES),
      reason: 'engine_not_quantum_capable',
      capabilities: [],
    });
    const s = useMatchmakingStore.getState();
    expect(s.ruleSyncPhase).toBe('failed');
    expect(s.ruleSyncReason).toBe('engine_not_quantum_capable');
  });
});

describe('入室時に部屋から受け取るルール (サーバー中継)', () => {
  it('トーラスの詳細をそのまま復元する', () => {
    // v1.19 まで: ここが「つながっているなら円筒」の決め打ちで、ホストが完全トーラスを
    // 選んでもゲスト側は円筒に化けていた。
    const cfg = normalizeIncomingRules(
      { game: 'shogi', torus: true, torusMode: 'full', quantum: false, time: { mode: 'no_limit', mainSeconds: 0 } },
      '[本+環] テスト',
    );
    expect(cfg?.torusMode).toBe('full');
  });

  it('詳細を送ってこない旧版のホスト相手では従来どおり円筒として扱う', () => {
    const cfg = normalizeIncomingRules(
      { game: 'shogi', torus: true, quantum: false, time: { mode: 'no_limit', mainSeconds: 0 } },
      '[本+環] テスト',
    );
    expect(cfg?.torusMode).toBe('cylinder');
  });

  it('トーラス無しなら none のまま', () => {
    const cfg = normalizeIncomingRules(
      { game: 'shogi', torus: false, quantum: false, time: { mode: 'no_limit', mainSeconds: 0 } },
      '[本] テスト',
    );
    expect(cfg?.torusMode).toBe('none');
  });
});
