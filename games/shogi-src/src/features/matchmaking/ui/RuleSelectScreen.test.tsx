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

  it('★カスタムの札を押すと読み込めるルールの一覧が出て、選ぶとその定義が入る', async () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));
    fireEvent.click(await screen.findByText('チェス'));

    await waitFor(() => {
      expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('custom');
    });
    const cfg = useMatchmakingStore.getState().pendingRoomConfig;
    // ★**定義そのもの**が入ること＝種類の名札だけでは盤が作れない。
    expect(cfg.customMgf?.board.width).toBe(8);
    expect(cfg.customRuleName).toBe('チェス');
  });

  it('★ネット対戦の経路では、カスタムの札は押しても何も起きない', async () => {
    mockConnector(true);
    mockRules();
    useRouteStore.setState({ ruleSelectReturn: 'net-lobby' });
    render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));
    await Promise.resolve();

    // 一覧も出ない・選んだことにもならない（理由も保護も出さない＝無反応）。
    expect(screen.queryByText('チェス')).toBeNull();
    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('shogi');
  });

  it('一覧が取れないときは、選んだことにしない（定義の無い custom を作らない）', async () => {
    mockConnector(true);
    mockRules(false);
    useRouteStore.setState({ ruleSelectReturn: 'offline-rule' });
    render(<RuleSelectScreen />);

    fireEvent.click(screen.getByText('カスタム'));

    expect(await screen.findByText('ルールの一覧を読み込めませんでした。')).toBeTruthy();
    expect(useMatchmakingStore.getState().pendingRoomConfig.gameType).toBe('shogi');
    expect(useMatchmakingStore.getState().pendingRoomConfig.customMgf).toBeUndefined();
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
