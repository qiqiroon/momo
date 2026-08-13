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
 * - 未確定駒の見せ方がカード式になり、操作の可否が spec 駒UI v0.9 §4.4 の分岐に従うこと
 *
 * 見せ方の分岐は 2 台そろえないと実機で見られないので、描画で固定する。
 * v1.24: 分岐は「部屋の値」だけで決まる。ルールを決めた側かどうかでは変わらない。
 */
function mockConnector(isRuleSetter: boolean) {
  register('gameConnector', { isRuleSetter: () => isRuleSetter });
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
    // 音セクションの 1 つ目のスイッチが秒読み音 (モックと同じスイッチ形式)
    const sw = screen.getAllByRole('switch')[0];
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(localStorage.getItem('shogi.settings.sound.byomu')).toBe('false');
  });

  it('移動先ヒントを消すと設定に残る (指せる場所は変えない)', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    // 対局セクションのスイッチ (2 つ目) が移動先ヒント
    const sw = screen.getAllByRole('switch')[1];
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(useGameStore.getState().hintAlwaysOn).toBe(false);
  });

  it('カードが 2 枚並び、いま選んでいる方に印が付く', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    const cards = screen.getAllByRole('radio');
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.getAttribute('aria-checked') === 'true')?.textContent).toContain('巡回');
  });

  // ★v1.24 で直した不具合 (ユーザー報告 2026-08-13)。
  // 重ねで始めた部屋なのに、ホストの画面では巡回のカードが押せてしまっていた。
  it('部屋が重ねなら、ルールを決めた側も固定で押しても変わらない', () => {
    useGameStore.setState({ roomQuantumDisplay: 'stack', quantumDisplay: 'stack' });
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText(/重ね固定/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[1]); // 巡回を押してみる
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
    expect(useGameStore.getState().roomQuantumDisplay).toBe('stack');
  });

  it('部屋が重ねなら、決めた側でない人も固定で押しても変わらない', () => {
    useGameStore.setState({ roomQuantumDisplay: 'stack', quantumDisplay: 'stack' });
    mockConnector(false);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText(/重ね固定/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[1]); // 巡回を押してみる
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
  });

  it('部屋が巡回なら、ルールを決めた側も「自分の画面のみ」で切り替えられる', () => {
    mockConnector(true);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('自分の画面のみ')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[0]); // 重ね
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
    // ★決めた側でも部屋は動かない＝相手の画面は巡回のまま
    expect(useGameStore.getState().roomQuantumDisplay).toBe('cycle');
  });

  it('部屋が巡回なら、決めた側でない人も「自分の画面のみ」で切り替えられる', () => {
    mockConnector(false);
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.getByText('自分の画面のみ')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio')[0]); // 重ね
    expect(useGameStore.getState().quantumDisplay).toBe('stack');
    expect(useGameStore.getState().roomQuantumDisplay).toBe('cycle'); // 部屋は動かない
  });

  it('量子でない対局ではカードごと出さない', () => {
    mockConnector(true);
    useGameStore.setState({ currentQuantum: false });
    render(<SettingsPopup open onClose={() => {}} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('全設定を既定に戻すは線より上、クレジットは線の下', () => {
    mockConnector(true);
    useDebugStore.setState({ enabled: true });
    const { container } = render(<SettingsPopup open onClose={() => {}} />);
    const reset = screen.getByText('全設定を既定に戻す');
    const credits = screen.getByText('クレジット');
    // 並び順: リセット → クレジット
    expect(reset.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // クレジット側の枠が区切り線を持ち、リセット側は持たない
    expect(credits.parentElement?.style.borderTop).toContain('1px solid');
    expect(reset.parentElement?.style.borderTop).toBe('');
    // デバッグパネルへの入口も線の下 (クレジットと同じ枠)
    expect(credits.parentElement?.contains(screen.getByText('デバッグパネル'))).toBe(true);
    expect(container).toBeTruthy();
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
