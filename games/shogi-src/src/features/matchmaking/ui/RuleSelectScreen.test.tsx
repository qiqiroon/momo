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
 * ここで決めるのは部屋の値＝対局の基準 (spec 駒デザイン・対局UI v0.8 §4.4 / 付録D-2 v1.3)。
 * S10 と同じ分岐を持つ必要があるので、こちらでも固定しておく。
 */
function mockConnector(isRuleSetter: boolean) {
  register('gameConnector', {
    isRuleSetter: () => isRuleSetter,
    setQuantumDisplayMode: () => {},
  });
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

  it('新しい決まりを説明する文面が出る (両者共通で適用、ではない)', () => {
    mockConnector(true);
    setup();
    render(<RuleSelectScreen />);
    expect(screen.getByText(/対局の基準になります/)).toBeTruthy();
    expect(screen.getByText(/巡回にすると、相手も観戦者も自分の画面だけを重ねに変えられます/)).toBeTruthy();
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
