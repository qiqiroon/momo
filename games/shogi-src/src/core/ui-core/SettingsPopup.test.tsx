import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPopup } from './SettingsPopup';
import { useGameStore } from '../store/game-store';
import { useDebugStore } from '../store/debug-store';
import { register, clear as clearPlugins } from '../plugin/registry';
import { clearUiSettings } from '../store/ui-settings';

/**
 * v1.22: S10 設定画面。
 *
 * - モックにあって画面に無かった項目 (移動先ヒント・全設定を既定に戻す) を足したこと
 * - 元から画面にあった項目 (クレジット・デバッグパネルへの入口) を削っていないこと
 * - 未確定駒の見せ方がカード式になり、操作の可否が spec 駒UI v0.8 §4.4 の分岐に従うこと
 *
 * 見せ方の分岐は 2 台そろえないと実機で見られないので、描画で固定する。
 */
function mockConnector(isRuleSetter: boolean) {
  register('gameConnector', {
    isRuleSetter: () => isRuleSetter,
    setQuantumDisplayMode: () => {},
  });
}

describe('S10 設定画面', () => {
  beforeEach(() => {
    clearPlugins();
    clearUiSettings();
    useDebugStore.setState({ enabled: false, panelOpen: false });
    useGameStore.setState({
      currentQuantum: true,
      roomQuantumDisplay: 'cycle',
      myQuantumDisplay: 'cycle',
      quantumDisplay: 'cycle',
      hintAlwaysOn: true,
    });
  });
  afterEach(() => {
    clearPlugins();
    clearUiSettings();
  });

  it('元からある項目を削っていない (クレジット)', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('クレジット')).toBeTruthy();
  });

  it('デバッグ起動時はデバッグパネルへの入口が残る', () => {
    mockConnector(true);
    useDebugStore.setState({ enabled: true });
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('デバッグパネル')).toBeTruthy();
  });

  it('モックにあった項目を足した (秒読み音・移動先ヒント・全設定を既定に戻す)', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('秒読み音')).toBeTruthy();
    expect(screen.getByText('移動先ヒント')).toBeTruthy();
    expect(screen.getByText('全設定を既定に戻す')).toBeTruthy();
  });

  it('秒読み音は値を覚える (音そのものは未実装なので鳴らない)', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    // 音セクションの 1 つ目のチェックボックスが秒読み音
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(localStorage.getItem('shogi.settings.sound.byomu')).toBe('false');
  });

  it('移動先ヒントを消すと設定に残る (指せる場所は変えない)', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    // 対局セクションのチェックボックス (2 つ目) が移動先ヒント
    const box = screen.getAllByRole('checkbox')[1] as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(useGameStore.getState().hintAlwaysOn).toBe(false);
  });

  it('カードが 2 枚並び、いま選んでいる方に印が付く', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    const cards = screen.getAllByRole('radio');
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.getAttribute('aria-checked') === 'true')?.textContent).toContain('巡回');
  });

  it('ルール設定者はバッジなしで両方押せる', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.queryByText('自分の画面のみ')).toBeNull();
    expect(screen.queryByText(/重ね固定/)).toBeNull();
    fireEvent.click(screen.getAllByRole('radio')[0]); // 重ね
    expect(useGameStore.getState().roomQuantumDisplay).toBe('stack');
  });

  it('部屋が巡回なら、設定者でない側は「自分の画面のみ」で切り替えられる', () => {
    mockConnector(false);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('自分の画面のみ')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[0]); // 重ね
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
    expect(useGameStore.getState().roomQuantumDisplay).toBe('cycle'); // 部屋は動かない
  });

  it('部屋が重ねなら、設定者でない側は固定で押しても変わらない', () => {
    useGameStore.setState({ roomQuantumDisplay: 'stack', quantumDisplay: 'stack' });
    mockConnector(false);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText(/重ね固定/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[1]); // 巡回を押してみる
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
  });

  it('量子でない対局ではカードごと出さない', () => {
    mockConnector(true);
    useGameStore.setState({ currentQuantum: false });
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('リセットは確認を挟んでから既定に戻す', () => {
    mockConnector(true);
    useGameStore.setState({ hintAlwaysOn: false });
    render(<SettingsPopup open onClose={() => {}} />);
    fireEvent.click(screen.getByText('全設定を既定に戻す'));
    expect(screen.getByText(/よろしいですか/)).toBeTruthy();
    // 確認の中の「全設定を既定に戻す」ボタン (2 個目) を押す
    const buttons = screen.getAllByText('全設定を既定に戻す');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(useGameStore.getState().hintAlwaysOn).toBe(true);
  });
});
