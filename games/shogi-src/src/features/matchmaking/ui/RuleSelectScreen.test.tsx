import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleSelectScreen } from './RuleSelectScreen';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore } from '../store';
import { useGameStore } from '../../../core/store/game-store';
import { register, clear as clearPlugins } from '../../../core/plugin/registry';
import { clearUiSettings } from '../../../core/store/ui-settings';

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
  // (実際の起動はメニュー「カスタムルール作成」→読み込み画面)。9-4b で入れた
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
