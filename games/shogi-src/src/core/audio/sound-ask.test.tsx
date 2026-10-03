/**
 * ★v2.01 音の確認と最初のクリック・ミュート (2026-10-03 ユーザー報告と指示・Fireworks と同じ)。
 *
 * 固定すること:
 *   - 最初のクリックは止めて預かり、窓で選んだあとにそのクリックを起こす
 *     (v2.00 までは押し下げで窓を出し、クリックが窓の背景に当たって消えていた)
 *   - 窓が出ている間のクリックは止めない／選び終えたら以後は止めない／1 時間後はもう一度
 *   - 「再生しない」＝両方ミュート・音量はそのまま・**音の出口は開ける**
 *     (v2.00 までは音量を 0 にするだけで出口を開けず、あとで歯車から上げても鳴らなかった)
 *   - ミュートは音量と別に覚え、外せばその音量で鳴る
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { armAudioAsk, finishAudioAsk, rearmAudioAsk, resetFirstGestureForTest, setFirstGestureCapture } from './first-gesture';

/** 鳴った大きさを見るための AudioContext の代わり。 */
class FakeGain {
  gain = { value: 1 };
  connect() { return this; }
}
class FakeCtx {
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' = 'suspended';
  destination = {};
  gains: FakeGain[] = [];
  constructor() { FakeCtx.last = this; }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createBufferSource() { return { connect: () => ({ connect: () => {} }), start: () => {}, stop: () => {}, buffer: null, loop: false, onended: null }; }
  decodeAudioData() { return Promise.reject(new Error('no audio in test')); }
}

describe('最初のクリックを預かって、選んだあとに起こす', () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    resetFirstGestureForTest();
    setFirstGestureCapture(true);
    open = vi.fn();
    armAudioAsk(open);
  });
  afterEach(() => {
    setFirstGestureCapture(false);
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function button() {
    const b = document.createElement('button');
    const span = document.createElement('span'); // 中の文字を押す (押した物はボタンの子)
    b.appendChild(span);
    let n = 0;
    b.addEventListener('click', () => n++);
    document.body.appendChild(b);
    return { b, span, count: () => n };
  }

  it('最初のクリックは止まり、窓が出る。選び終えると同じ物がクリックされる', () => {
    const { span, count } = button();
    fireEvent.click(span);
    expect(count()).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
    finishAudioAsk();
    vi.runAllTimers();
    expect(count()).toBe(1);
  });

  it('窓が出ている間のクリック (窓の中のボタン) は止めない／選び終えたら以後は止めない', () => {
    const first = button();
    const other = button();
    fireEvent.click(first.b);
    fireEvent.click(other.b); // 窓の中のボタンに当たる
    expect(other.count()).toBe(1);
    finishAudioAsk();
    vi.runAllTimers();
    fireEvent.click(first.b);
    expect(first.count()).toBe(2);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('1 時間以上離れて戻ったら、次のクリックでもう一度尋ねる (そのクリックも生かす)', () => {
    const { b, count } = button();
    fireEvent.click(b);
    finishAudioAsk();
    vi.runAllTimers();
    rearmAudioAsk();
    fireEvent.click(b);
    expect(open).toHaveBeenCalledTimes(2);
    expect(count()).toBe(1);
    finishAudioAsk();
    vi.runAllTimers();
    expect(count()).toBe(2);
  });

  it('キーボードで始めたときは窓を出すだけ (キー操作は生かさない)', () => {
    fireEvent.keyDown(document, { key: 'a' });
    expect(open).toHaveBeenCalledTimes(1);
    finishAudioAsk();
    vi.runAllTimers();
  });

  it('押した物が画面から消えていたら何も起こさない', () => {
    const { b, count } = button();
    fireEvent.click(b);
    b.remove();
    finishAudioAsk();
    vi.runAllTimers();
    expect(count()).toBe(0);
  });
});

describe('ミュートと「再生しない」', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal('AudioContext', FakeCtx);
    FakeCtx.last = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ミュートは音量と別に覚え、外せばその音量で鳴る', async () => {
    const eng = await import('./audio-engine');
    eng.setBgmVolume(40);
    eng.setSfxVolume(70);
    await eng.resumeAudio();
    const [bgm, sfx] = FakeCtx.last!.gains;
    expect(bgm.gain.value).toBeCloseTo(0.4);
    eng.setBgmMuted(true);
    eng.setSfxMuted(true);
    expect(bgm.gain.value).toBe(0);
    expect(sfx.gain.value).toBe(0);
    expect(eng.getBgmVolume()).toBe(40);
    expect(localStorage.getItem('shogi.audio.bgmMute')).toBe('1');
    eng.setSfxMuted(false);
    expect(sfx.gain.value).toBeCloseTo(0.7);
    // 次に開いたとき (読み込み直し) もミュートが残る
    vi.resetModules();
    const again = await import('./audio-engine');
    expect(again.getBgmMuted()).toBe(true);
    expect(again.getSfxMuted()).toBe(false);
  });

  it('「再生しない」＝両方ミュート・音量はそのまま・音の出口は開ける。歯車でミュートを外すと鳴る', async () => {
    const eng = await import('./audio-engine');
    eng.setBgmVolume(50);
    eng.setSfxVolume(80);
    const { MusicPrompt } = await import('../ui-core/MusicPrompt');
    const onClose = vi.fn();
    render(<MusicPrompt open onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByText('再生しない'));
    });
    expect(onClose).toHaveBeenCalled();
    expect(eng.getBgmMuted()).toBe(true);
    expect(eng.getSfxMuted()).toBe(true);
    expect(eng.getBgmVolume()).toBe(50);
    expect(eng.getSfxVolume()).toBe(80);
    expect(eng.isAudioRunning()).toBe(true);

    const { SettingsPopup } = await import('../ui-core/SettingsPopup');
    render(<SettingsPopup open onClose={() => {}} />);
    const boxes = screen.getAllByLabelText('ミュート') as HTMLInputElement[];
    const popupBoxes = boxes.slice(-2); // 歯車の欄の 2 つ (BGM・効果音)
    expect(popupBoxes.every((b) => b.checked)).toBe(true);
    fireEvent.click(popupBoxes[1]);
    expect(eng.getSfxMuted()).toBe(false);
    expect(FakeCtx.last!.gains[1].gain.value).toBeCloseTo(0.8);
  }, 30_000); // 部品を読み込み直すので重い (全部をいっせいに走らせると 5 秒を超える)

  it('「再生する」＝両方のミュートを外す', async () => {
    const eng = await import('./audio-engine');
    eng.setBgmMuted(true);
    eng.setSfxMuted(true);
    const { MusicPrompt } = await import('../ui-core/MusicPrompt');
    render(<MusicPrompt open onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText('再生する'));
    });
    expect(eng.getBgmMuted()).toBe(false);
    expect(eng.getSfxMuted()).toBe(false);
  });
});

describe('アプリ全体で：最初のクリックが窓のあとに生きる', () => {
  afterEach(() => {
    setFirstGestureCapture(false);
    resetFirstGestureForTest();
    vi.unstubAllGlobals();
  });

  it('対局画面の「モード選択」を最初に押す → 窓 → 「再生しない」→ モード選択へ移る', async () => {
    vi.stubGlobal('AudioContext', FakeCtx);
    const { App } = await import('../../App');
    const { useRouteStore } = await import('../store/route-store');
    const { useGameStore } = await import('../store/game-store');
    const { useI18nStore } = await import('../store/i18n-store');
    useI18nStore.setState({ locale: 'ja' });
    useRouteStore.setState({ screen: 'game' });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    // 前の検査で部品を読み込み直しているので、**アプリと同じ見張り**を操作する
    // (このファイルの先頭で読んだ見張りとは別物になっている)。
    setFirstGestureCapture(false);
    const fg = await import('./first-gesture');
    fg.resetFirstGestureForTest();
    fg.setFirstGestureCapture(true);
    render(<App variant="b" />);
    fireEvent.click(screen.getByText('モード選択'));
    expect(useRouteStore.getState().screen).toBe('game');
    expect(screen.getByText('BGM と効果音を再生してもよろしいですか？')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('再生しない'));
    });
    await vi.waitFor(() => expect(useRouteStore.getState().screen).toBe('lobby'));
    fg.setFirstGestureCapture(false);
  }, 30_000); // アプリ全体を読み込み直すので重い
});
