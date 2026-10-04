import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RuleSelectScreen } from './RuleSelectScreen';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore } from '../store';
import { useGameStore } from '../../../core/store/game-store';
import { register, clear as clearPlugins } from '../../../core/plugin/registry';
import { clearUiSettings } from '../../../core/store/ui-settings';
import { useRouteStore } from '../../../core/store/route-store';
import chessRaw from '../../../core/engine/mgf/chess.json';

/**
 * v1.22: S02 ルール選択画面の「未確定駒の見せ方」。
 *
 * ここで決めるのは部屋の値＝対局の基準 (spec 駒デザイン・対局UI v0.9 §4.4 / 付録D-2 v1.4)。
 * **部屋の値が決まるのはこの画面だけ**で、対局が始まったら誰も動かせない。
 * S10 と同じ分岐を持つ必要があるので、こちらでも固定しておく。
 */
function mockConnector(isRuleSetter: boolean) {
  register('gameConnector', { isRuleSetter: () => isRuleSetter });
}

function setup(displayMode: 'cycle' | 'stack' = 'cycle') {
  useMatchmakingStore.setState({
    pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG, quantum: true, quantumDisplayMode: displayMode },
  });
}

describe('S02 未確定駒の見せ方', () => {
  beforeEach(() => {
    clearPlugins();
    clearUiSettings();
    useGameStore.setState({ roomQuantumDisplay: 'cycle', myQuantumDisplay: 'cycle', quantumDisplay: 'cycle' });
  });
  afterEach(() => {
    clearPlugins();
    clearUiSettings();
  });

  // 段B① (§5.0 一本化): チェスは S02 の同梱カードでなく「読み込んで遊ぶカスタムルール」に
  // なった。S02 は元から入っている本将棋・はさみだけを並べ、チェスのカードは出さない
  // (読み込んだルールは「カスタム」の札から選ぶ)。9-4b で入れた
  // 「チェスのカードが出る」検査を、撤去後の正しい姿に反転させたもの。
  it('ルール一覧は本将棋・はさみだけで、チェスのカードは出さない (読み込み経路へ移った)', () => {
    mockConnector(true);
    setup();
    render(<RuleSelectScreen />);
    expect(screen.getByText('本将棋')).toBeTruthy();
    expect(screen.getByText('はさみ将棋')).toBeTruthy();
    expect(screen.queryByText('チェス')).toBeNull();
  });

  // v1.24: 理屈を並べるのをやめ、どちらを選ぶと何ができるかを 2 行で言い切る
  // (ユーザー判断 2026-08-13・見やすさ優先)。
  it('決まりを 2 行で言い切る文面が出る', () => {
    mockConnector(true);
    setup();
    render(<RuleSelectScreen />);
    expect(screen.getByText('巡回にすると、プレイヤーごとに重ねに変更できます')).toBeTruthy();
    expect(screen.getByText('重ねにすると両者重ねに固定です')).toBeTruthy();
    // 前の版の長い言い回しは残っていない
    expect(screen.queryByText(/対局の基準になります/)).toBeNull();
    expect(screen.queryByText(/両プレイヤーに共通で適用されます/)).toBeNull();
  });

  it('ルールを決める側は部屋の値を変えられる', () => {
    mockConnector(true);
    setup();
    render(<RuleSelectScreen />);
    fireEvent.click(screen.getByText('重ね'));
    expect(useMatchmakingStore.getState().pendingRoomConfig.quantumDisplayMode).toBe('stack');
  });

  it('決める側でなく部屋が巡回なら、自分の画面の値だけが変わる', () => {
    mockConnector(false);
    setup('cycle');
    render(<RuleSelectScreen />);
    fireEvent.click(screen.getByText('重ね'));
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
    // 部屋の値は動かさない
    expect(useMatchmakingStore.getState().pendingRoomConfig.quantumDisplayMode).toBe('cycle');
  });

  it('決める側でなく部屋が重ねなら、固定で理由が出る', () => {
    mockConnector(false);
    setup('stack');
    render(<RuleSelectScreen />);
    expect(screen.getByText(/重ね固定/)).toBeTruthy();
    fireEvent.click(screen.getByText('巡回'));
    expect(useMatchmakingStore.getState().pendingRoomConfig.quantumDisplayMode).toBe('stack');
    expect(useGameStore.getState().quantumDisplay).toBe('cycle'); // 自分の値も動かない
  });
});


describe('S02 カスタムの札から読み込んだルールを選ぶ (仕様 S02 のルール一覧)', () => {
  /** `rules/` のマニフェストと定義を、取りに行かずに返す。 */
  function mockRules(indexOk = true) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('rules/index.json')) {
          return indexOk
            ? { ok: true, status: 200, json: async () => ({ rules: [{ id: 'chess', file: 'chess.json', name: 'チェス' }] }) }
            : { ok: false, status: 500, json: async () => ({}) };
        }
        if (url.endsWith('rules/chess.json')) return { ok: true, status: 200, json: async () => chessRaw };
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  }

  beforeEach(() => {
    clearPlugins();
    clearUiSettings();
    useMatchmakingStore.setState({ pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG } });
  });
  afterEach(() => {
    clearPlugins();
    clearUiSettings();
    vi.unstubAllGlobals();
  });

  /**
   * ★v2.04 (2026-10-04 利用者の指摘・付録D-2 v1.10 §3.2)＝**押した瞬間に選んだ状態**。
   * v2.03 までは一覧を開くだけで、一覧からチェスを選ぶまでオレンジにならなかった。
   * 定義は同梱の既定 (チェス) から待たずに入る＝定義の無い custom は生まれない。
   */
  it('★カスタムの札を押した瞬間に custom (チェスの定義つき) になり、一覧のチェスに印が付く', async () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    const { container } = render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));

    // 一覧を待たずに決まっている
    const cfg = useMatchmakingStore.getState().pendingRoomConfig;
    expect(cfg.gameType).toBe('custom');
    // ★**定義そのもの**が入ること＝種類の名札だけでは盤が作れない。
    expect(cfg.customMgf?.board.width).toBe(8);
    expect(cfg.customRuleName).toBe('チェス');
    expect(cfg.customRuleId).toBe('chess');
    // 札がオレンジ (選択状態) になる
    expect(container.querySelector('.rule-card.selected .rc-name')?.textContent).toBe('カスタム');
    // 一覧が出て、チェスの行に印
    await waitFor(() => {
      expect(container.querySelector('.rule-pick-row.selected')?.textContent).toContain('チェス');
    });
  });

  it('カスタムを選んでいる間に札をもう一度押しても、選んだまま (一覧も閉じない)', async () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    const { container } = render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));
    await waitFor(() => expect(container.querySelector('.rule-pick-row.selected')).toBeTruthy());
    fireEvent.click(container.querySelector('.rule-card.selected') as HTMLElement);

    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('custom');
    expect(container.querySelector('.rule-pick')).toBeTruthy();
  });

  it('ほかのルールへ移ると一覧は消え、もう一度カスタムを押すと前に選んだ定義で戻る', async () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    const { container } = render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));
    fireEvent.click(screen.getByText('本将棋'));
    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('shogi');
    expect(container.querySelector('.rule-pick')).toBeNull();

    fireEvent.click(screen.getByText('カスタム'));
    expect(useMatchmakingStore.getState().pendingRoomConfig.customRuleId).toBe('chess');
  });

  /**
   * ネット対戦の経路でも押せる (段B②・親 §6.5＝定義をルール同期で運べるようになった)。
   * ★v2.03 までここには「ネット対戦の経路では押しても何も起きない」という検査があったが、
   * **一覧の取得が終わる前に見ていたので通っていただけ**で、コードはすでに押せる作りだった。
   */
  it('ネット対戦の経路でも、カスタムの札を押すと選んだ状態になる', () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'net-lobby' });
    render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));

    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('custom');
  });

  it('一覧が取れなくても、同梱の既定 (チェス) で選んだ状態は保つ (定義の無い custom は作らない)', async () => {
    mockConnector(true);
    mockRules(false);
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));

    expect(await screen.findByText('ルールの一覧を読み込めませんでした。')).toBeTruthy();
    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('custom');
    expect(useMatchmakingStore.getState().pendingRoomConfig.customMgf?.metadata.game_id).toBe('chess');
  });
});

/**
 * ★2026-08-26（親 §3.2.1）＝**変則条件の可否はルール定義から引く**。
 *
 * v1.91 まではこの画面が可否の一覧を持っており、**カスタムだけは中身を見ずに「可」と
 * 決め打ち**だった＝**「量子とは併用しない」と宣言したカスタムルールでも量子で始められた**。
 * ここで見張るのは、**読み込んだ定義の宣言が実際に効いていること**。
 */
describe('S02 変則条件の可否は、そのルールの定義から引く', () => {
  beforeEach(() => {
    clearPlugins();
    clearUiSettings();
  });
  afterEach(() => {
    clearPlugins();
    clearUiSettings();
  });

  /** そのカスタム定義を選んだ状態にする。 */
  function setupCustom(mgf: unknown) {
    useMatchmakingStore.setState({
      pendingRoomConfig: {
        ...DEFAULT_ROOM_CONFIG,
        gameType: 'custom',
        customMgf: mgf as never,
        quantum: false,
      },
    });
  }

  const quantumButtons = () =>
    screen.getAllByRole('button').filter((b) => b.textContent === 'ON' || b.textContent === 'OFF');

  it('★量子を許さないと宣言したカスタムルールでは、量子を選べない', () => {
    mockConnector(true);
    setupCustom({ ...chessRaw, compatible_modifiers: { quantum: { enabled: false } } });
    render(<RuleSelectScreen />);

    // 「このルールでは量子を使えません」が出て、ON/OFF が押せない
    expect(screen.getByText(/量子を使えません/)).toBeTruthy();
    for (const b of quantumButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('★チェス（量子を許すと宣言）では、量子を選べる', () => {
    mockConnector(true);
    setupCustom(chessRaw);
    render(<RuleSelectScreen />);

    expect(screen.queryByText(/量子を使えません/)).toBeNull();
    const buttons = quantumButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(false);
  });
});
