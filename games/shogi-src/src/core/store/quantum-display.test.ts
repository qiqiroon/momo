import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from './game-store';
import { register, clear as clearPlugins } from '../plugin/registry';
import { SETTINGS_DEFAULTS, clearUiSettings } from './ui-settings';

/**
 * v1.22: 未確定駒の見せ方が 2 層になったこと (spec 駒デザイン・対局UI v0.9 §4.4)。
 *
 *   部屋の値   … ルール設定画面で決まり、ルール同期で相手・観戦者へ配る
 *   自分の値   … 端末ごと。送らない
 *   実際の見え方 = 部屋が重ねなら常に重ね / 巡回なら自分の値
 *
 * 要は「部屋の値より読みやすくはできない・読みにくくするのは自由」。
 *
 * v1.24 の改訂: **対局中に部屋の値を動かせる人は誰も居ない**。
 * ルールを決めた側だけが対局中に基準を動かせると、自分に有利な局面で読みやすさを
 * 変えられて不公平になるため (ユーザー判断 2026-08-13)。
 * 2 台そろえないと実機で確かめられない分岐なので、ここで固定しておく。
 */

/** ルール設定者かどうかだけを差し替える最小の身代わり。 */
function mockConnector(isRuleSetter: boolean) {
  register('gameConnector', { isRuleSetter: () => isRuleSetter });
}

describe('未確定駒の見せ方 2 層 (§4.4)', () => {
  beforeEach(() => {
    clearPlugins();
    clearUiSettings();
    useGameStore.setState({
      roomQuantumDisplay: 'cycle',
      myQuantumDisplay: 'cycle',
      quantumDisplay: 'cycle',
    });
  });
  afterEach(() => {
    clearPlugins();
    clearUiSettings();
  });

  // ★v1.24 で直した不具合そのもの (ユーザー報告 2026-08-13)。
  // 重ねで始めた部屋で、ホスト (＝ルールを決めた側) が対局中に巡回へ戻せてしまっていた。
  it('部屋が重ねなら、ルールを決めた側でも巡回へ逃げられない', () => {
    useGameStore.setState({ roomQuantumDisplay: 'stack', quantumDisplay: 'stack' });
    mockConnector(true);
    useGameStore.getState().setQuantumDisplay('cycle');
    const s = useGameStore.getState();
    expect(s.quantumDisplay).toBe('stack');
    expect(s.roomQuantumDisplay).toBe('stack');
  });

  it('部屋が重ねなら、決めた側でない人も巡回へ逃げられない', () => {
    useGameStore.setState({ roomQuantumDisplay: 'stack', quantumDisplay: 'stack' });
    mockConnector(false);
    useGameStore.getState().setQuantumDisplay('cycle');
    const s = useGameStore.getState();
    expect(s.quantumDisplay).toBe('stack');
    expect(s.roomQuantumDisplay).toBe('stack');
  });

  // 巡回 → 重ね は誰でもできる (読みにくくするのは自由)。
  it('部屋が巡回なら、ルールを決めた側も自分の画面だけ重ねにできる', () => {
    mockConnector(true);
    useGameStore.getState().setQuantumDisplay('stack');
    const s = useGameStore.getState();
    expect(s.myQuantumDisplay).toBe('stack');
    expect(s.quantumDisplay).toBe('stack');
    // ★決めた側でも部屋の値は動かさない＝相手の画面は巡回のまま。
    expect(s.roomQuantumDisplay).toBe('cycle');
  });

  it('部屋が巡回なら、決めた側でない人も自分の画面だけ重ねにできる', () => {
    mockConnector(false);
    useGameStore.getState().setQuantumDisplay('stack');
    const s = useGameStore.getState();
    expect(s.myQuantumDisplay).toBe('stack');
    expect(s.quantumDisplay).toBe('stack');
    expect(s.roomQuantumDisplay).toBe('cycle');
  });

  it('部屋の値が重ねに変わったら、自分の値は残したまま見え方だけ重ねへ落とす', () => {
    mockConnector(false);
    useGameStore.getState().setQuantumDisplay('cycle'); // 自分の値＝巡回
    useGameStore.getState().applyRoomQuantumDisplay('stack');
    let s = useGameStore.getState();
    expect(s.quantumDisplay).toBe('stack');
    expect(s.myQuantumDisplay).toBe('cycle'); // 捨てない

    // 部屋が巡回に戻れば、自分の値がまた効く
    useGameStore.getState().applyRoomQuantumDisplay('cycle');
    s = useGameStore.getState();
    expect(s.quantumDisplay).toBe('cycle');
  });

  it('対局開始で部屋の値を受け取っても、自分の値は上書きされない', () => {
    mockConnector(false);
    useGameStore.getState().setQuantumDisplay('stack'); // 自分の値＝重ね
    useGameStore.getState().reset({ quantum: true, quantumDisplay: 'cycle' });
    const s = useGameStore.getState();
    expect(s.roomQuantumDisplay).toBe('cycle');
    expect(s.myQuantumDisplay).toBe('stack');
    expect(s.quantumDisplay).toBe('stack'); // 部屋が巡回なので自分の値が効く
  });

  it('自分の値は端末に残る (次に開いたときも同じ見せ方)', () => {
    mockConnector(false);
    useGameStore.getState().setQuantumDisplay('stack');
    expect(localStorage.getItem('shogi.settings.game.quantumDisplay')).toBe('stack');
  });
});

describe('移動先ヒントの設定', () => {
  beforeEach(() => {
    clearUiSettings();
    useGameStore.setState({ hintAlwaysOn: SETTINGS_DEFAULTS.hintAlwaysOn });
  });
  afterEach(() => clearUiSettings());

  it('既定は ON', () => {
    expect(useGameStore.getState().hintAlwaysOn).toBe(true);
  });

  it('オフにすると端末に残る', () => {
    useGameStore.getState().setHintAlwaysOn(false);
    expect(useGameStore.getState().hintAlwaysOn).toBe(false);
    expect(localStorage.getItem('shogi.settings.game.hintAlwaysOn')).toBe('false');
  });
});
