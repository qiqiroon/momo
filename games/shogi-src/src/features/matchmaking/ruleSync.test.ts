import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../../core/store/game-store';
import { chess } from '../../core/engine/mgf/loader';
import { DEFAULT_QUANTUM_PARAMS } from '../../core/store/quantum-params';
import { normalizeIncomingRules } from './bootstrap';
import { handleShogiMessage } from './messageDispatcher';
import { CLIENT_CAPABILITIES, PROTOCOL_VERSION, ruleDigest, unwrapShogiMessage, type SyncedRules } from './protocol';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore } from './store';
import { rulesFromConfig } from './rulesSync';

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
    // ★段B② で custom は扱えるようになったので、例は**まだ名乗っていない種類**に替えた
    //（この検査が見張っているのは「知らない種類を断ること」であって custom ではない）。
    handleShogiMessage(ruleSyncMsg({ ...HOST_RULES, gameType: 'chuushogi' as SyncedRules['gameType'] }));

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


/**
 * ★段B② (親 §6.5・ユーザー判断 2026-08-25): **カスタムルールの届き方は 2 通り**。
 *
 * - **公式一覧 (`rules/`) にあるルール**＝ホストは**目印だけ**を送り、受け取った側が
 *   自分で取ってくる（線に大きな定義を流さない）。
 * - **作った本人が配っているルール**＝取りに行く先が無いので、**ホストが定義を配る**。
 *
 * どちらでも用意できなければ**断る**＝黙って本将棋で始めると、部屋の札には相手が
 * 選んだルール名が出たまま、まったく別のゲームを指すことになる。
 */
describe('カスタムルールの届き方 (公式は自分で取る・自作はホストが配る)', () => {
  /** 公式一覧にあるが**アプリには焼き込まれていない**ルール（＝取りに行くしかない）。 */
  const remoteRule = {
    ...chess,
    metadata: { ...chess.metadata, game_id: 'chuushogi-test', game_name: '取りに行くルール' },
  };

  let fetchCalls: string[] = [];
  /** `rules/index.json` と定義ファイルだけを返す偽のサーバー。 */
  function installFetch(available: boolean) {
    fetchCalls = [];
    (globalThis as { fetch?: unknown }).fetch = ((url: string) => {
      fetchCalls.push(String(url));
      if (!available) return Promise.resolve({ ok: false, status: 404 });
      if (String(url).endsWith('index.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rules: [{ id: remoteRule.metadata.game_id, file: 'x.json', name: 'x' }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(remoteRule) });
    }) as unknown as typeof fetch;
  }
  /** 取ってくる処理が終わるまで待つ（受領確認は定義が揃ってから出る）。 */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  const customRules = (over: Partial<SyncedRules>): SyncedRules => ({
    ...HOST_RULES,
    gameType: 'custom',
    quantum: false,
    torusMode: 'none',
    ...over,
  });

  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('公式一覧のルールは、目印だけ届いても自分で取ってきて盤にする', async () => {
    installFetch(true);
    handleShogiMessage(
      ruleSyncMsg(customRules({ customRuleId: remoteRule.metadata.game_id, customRuleName: remoteRule.metadata.game_name })),
    );
    await settle();

    expect(fetchCalls.length).toBeGreaterThan(0); // 自分で取りに行った
    expect(useMatchmakingStore.getState().activeRoomConfig?.customMgf?.metadata.game_id).toBe(
      remoteRule.metadata.game_id,
    );
    expect(sent.find((m) => m.type === 'rule_ack')?.ok).toBe(true);
  });

  it('アプリが持っている公式ルールなら、取りに行かずに済ませる', async () => {
    installFetch(true);
    handleShogiMessage(ruleSyncMsg(customRules({ customRuleId: chess.metadata.game_id })));
    await settle();

    expect(fetchCalls).toEqual([]); // 手元にあるものを取りに行かない
    expect(useMatchmakingStore.getState().activeRoomConfig?.customMgf?.metadata.game_id).toBe('chess');
    expect(sent.find((m) => m.type === 'rule_ack')?.ok).toBe(true);
  });

  it('取ってこられなかったら断る（黙って本将棋で始めない）', async () => {
    // ★**返事を出さずに止まらない**＝黙るとホストは受領確認を永久に待つ。
    installFetch(false);
    handleShogiMessage(ruleSyncMsg(customRules({ customRuleId: 'nowhere' })));
    await settle();

    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(ack?.ok).toBe(false);
    expect(ack?.reason).toBe('custom_rule_unavailable');
    expect(useMatchmakingStore.getState().ruleSyncPhase).toBe('failed');
    expect(useMatchmakingStore.getState().activeRoomConfig?.gameType).toBe('shogi');
  });

  it('自作ルールはホストが配った定義で盤にする（取りに行かない）', async () => {
    installFetch(true);
    handleShogiMessage(ruleSyncMsg(customRules({ customMgf: remoteRule, customRuleName: remoteRule.metadata.game_name })));
    await settle();

    expect(fetchCalls).toEqual([]);
    expect(useMatchmakingStore.getState().activeRoomConfig?.customMgf?.metadata.game_id).toBe(
      remoteRule.metadata.game_id,
    );
    expect(sent.find((m) => m.type === 'rule_ack')?.ok).toBe(true);
  });

  it('先後が決まると、用意した定義そのもので盤ができる', async () => {
    // ★ここが本題＝**名札ではなく定義が盤を作る**。用意しても盤へ渡していなければ、
    // 9×9 の本将棋のまま始まる（部屋の札にはチェスと出たまま別のゲームを指す）。
    installFetch(true);
    handleShogiMessage(ruleSyncMsg(customRules({ customRuleId: chess.metadata.game_id })));
    await settle();
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'game_start', hostSide: 'sente', guestSide: 'gote' });

    const pos = useGameStore.getState().position;
    expect(pos.width).toBe(chess.board.width);
    expect(pos.height).toBe(chess.board.height);
    expect(useGameStore.getState().mgf.metadata.game_id).toBe('chess');
  });

  it('目印も定義も入っていない custom は断る', async () => {
    installFetch(true);
    handleShogiMessage(ruleSyncMsg(customRules({ customRuleName: 'なまえだけ' })));
    await settle();

    const ack = sent.find((m) => m.type === 'rule_ack');
    expect(ack?.ok).toBe(false);
    expect(ack?.reason).toBe('custom_rule_missing');
    expect(useMatchmakingStore.getState().activeRoomConfig?.gameType).toBe('shogi');
  });
});

/**
 * ★段B②: **見取り図は名札ではなく中身を見る**。
 *
 * 公式一覧のルールは定義が線に乗らないので、**中身の印を別に添えて運ぶ**。
 * 添えないと「同じ名前の別物」が黙って一致として通り、両者が違う盤で指し始める。
 */
describe('照合の見取り図: 定義の中身で突き合わせる', () => {
  const base: SyncedRules = {
    ...HOST_RULES,
    gameType: 'custom',
    customRuleId: chess.metadata.game_id,
    customRuleName: chess.metadata.game_name,
    customRuleDigest: 'chess/0.1.0/8x8/12p/aaaaaaaa',
  };

  it('目印が同じでも中身の印が違えば見取り図が変わる', () => {
    const other = { ...base, customRuleDigest: 'chess/0.1.0/8x8/12p/bbbbbbbb' };
    expect(ruleDigest(other)).not.toBe(ruleDigest(base));
  });

  it('中身の印が欠けたまま届けば見取り図が変わる（黙って通らない）', () => {
    expect(ruleDigest({ ...base, customRuleDigest: undefined })).not.toBe(ruleDigest(base));
  });

  it('目印が違えば見取り図が変わる', () => {
    expect(ruleDigest({ ...base, customRuleId: 'other' })).not.toBe(ruleDigest(base));
  });
});

/**
 * ★段B②: **ホストが何を線に乗せるか**（ユーザー判断 2026-08-25）。
 *
 * 公式一覧のルールは**定義を乗せない**。自作ルールは**乗せる**。どちらでも
 * **中身の印は必ず添える**（照合の材料が消えないように）。
 */
describe('ホスト側: 公式は目印だけ・自作は定義ごと送る', () => {
  const withRule = (over: Partial<typeof DEFAULT_ROOM_CONFIG>) => ({
    ...DEFAULT_ROOM_CONFIG,
    gameType: 'custom' as const,
    customRuleName: chess.metadata.game_name,
    customMgf: chess,
    ...over,
  });

  it('公式一覧のルールは定義を送らず、目印と中身の印だけ送る', () => {
    const rules = rulesFromConfig(withRule({ customRuleId: chess.metadata.game_id }));
    expect(rules.customMgf).toBeUndefined();
    expect(rules.customRuleId).toBe('chess');
    expect(rules.customRuleDigest).toBeTruthy();
  });

  it('自作ルール (目印なし) は定義ごと送る', () => {
    // ★印を付け忘れたときも**送る側へ倒れる**＝重くなるだけで、盤は食い違わない。
    const rules = rulesFromConfig(withRule({}));
    expect(rules.customMgf?.metadata.game_id).toBe('chess');
    expect(rules.customRuleId).toBeUndefined();
    expect(rules.customRuleDigest).toBeTruthy();
  });

  it('中身の印は定義の中身から決まる（同じ定義なら同じ・違えば違う）', () => {
    const a = rulesFromConfig(withRule({ customRuleId: 'chess' }));
    const b = rulesFromConfig(withRule({ customRuleId: 'chess' }));
    const c = rulesFromConfig(
      withRule({ customRuleId: 'chess', customMgf: { ...chess, board: { ...chess.board, width: 9 } } }),
    );
    expect(a.customRuleDigest).toBe(b.customRuleDigest);
    expect(c.customRuleDigest).not.toBe(a.customRuleDigest);
  });
});
