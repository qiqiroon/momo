/**
 * ★v2.05 秒読みの読み上げと、時間切れを決める端末 (2026-10-04 利用者の指示)。
 *
 * - 読み上げるのは 30秒・20秒・10秒・5秒・4・3・2・1・時間切れ
 * - 残りの秒数は指している人・相手・観戦者の全員に読み上げる
 * - 「時間切れ」は指している人の端末でだけ
 * - **時間切れを決めるのは指している人の端末だけ**＝相手と観戦者は自分の時計が 0 になっても
 *   負けを決めず、指している人の端末からの判定を信用する
 * - 量子異常の投票中は時計を止める
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { calloutFor, countdownMs, voiceLangFor } from '../audio/byoyomi-voice';
import type { ClockState, TimeControl } from '../engine/time-control';
import { useGameStore } from '../store/game-store';
import { useRouteStore } from '../store/route-store';
import { useI18nStore } from '../store/i18n-store';
import { useAiStore } from '../store/ai-store';
import { register, clear as clearPlugins } from '../plugin/registry';
import { clearUiSettings, saveByomuSound } from '../store/ui-settings';

const played = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('../audio/byoyomi-voice', async (orig) => {
  const real = await orig<typeof import('../audio/byoyomi-voice')>();
  return { ...real, playVoice: (_locale: string, line: string) => played.lines.push(line) };
});

const { useByoyomiVoice } = await import('./useByoyomiVoice');

const BYO: TimeControl = { mode: 'byoyomi', mainSeconds: 0, byoyomiSeconds: 60 };
const SUDDEN: TimeControl = { mode: 'sudden_death', mainSeconds: 600 };
const clk = (ms: number, inByoyomi = false): ClockState => ({ mainMs: inByoyomi ? 0 : ms, byoyomiMs: inByoyomi ? ms : 0, inByoyomi });

describe('どの残り時間を・どこで読むか', () => {
  it('区切りを上から下へ越えたときだけ・一度に越えたらいちばん小さい区切り', () => {
    expect(calloutFor(30_100, 29_900)).toBe('sec30');
    expect(calloutFor(30_000, 29_900)).toBeNull(); // ちょうど 30 から始まったら言わない
    expect(calloutFor(10_050, 9_950)).toBe('sec10');
    expect(calloutFor(4_050, 3_950)).toBe('n4');
    expect(calloutFor(3_050, 2_950)).toBe('n3');
    expect(calloutFor(1_050, 950)).toBe('n1');
    expect(calloutFor(25_000, 3_500)).toBe('n4'); // 刻みが飛んだら最後の区切りだけ
    expect(calloutFor(null, 900)).toBeNull();
    expect(calloutFor(900, 30_000)).toBeNull(); // 増えた (秒読みが戻った) ときは言わない
  });

  it('秒読み方式は秒読みに入ってから・切れ負けは本時間・時間制限なしは読まない', () => {
    expect(countdownMs(BYO, clk(5_000))).toBeNull();
    expect(countdownMs(BYO, clk(5_000, true))).toBe(5_000);
    expect(countdownMs(SUDDEN, clk(5_000))).toBe(5_000);
    expect(countdownMs({ mode: 'no_limit', mainSeconds: 0 }, clk(5_000))).toBeNull();
  });

  it('言語ごとの声 (日本語・英語・中国語)・声の無い猫語は日本語', () => {
    expect(voiceLangFor('ja')).toBe('ja');
    expect(voiceLangFor('en')).toBe('en');
    expect(voiceLangFor('zh')).toBe('zh');
    expect(voiceLangFor('cat')).toBe('ja');
  });
});

describe('時計の動きに合わせて読み上げる', () => {
  beforeEach(() => {
    played.lines = [];
    clearUiSettings();
  });

  function run(localSides: readonly ('player1' | 'player2')[], steps: { side: 'player1' | 'player2'; ms: number; status?: string }[], tc = BYO) {
    const first = steps[0];
    const props = (st: (typeof steps)[number]) => ({
      status: st.status ?? 'playing',
      activeClockSide: st.side,
      clocks: { player1: clk(st.side === 'player1' ? st.ms : 60_000, true), player2: clk(st.side === 'player2' ? st.ms : 60_000, true) },
      timeControl: tc,
      locale: 'ja',
      localSides,
    });
    const h = renderHook((p) => useByoyomiVoice(p), { initialProps: props(first) });
    for (const st of steps.slice(1)) h.rerender(props(st));
  }

  it('★60 秒の秒読みで 30秒・20秒・10秒・5秒・4・3・2・1 を順に言う', () => {
    const ms = [60_000, 31_000, 29_900, 19_900, 9_900, 4_900, 3_900, 2_900, 1_900, 900, 100];
    run(['player1'], ms.map((m) => ({ side: 'player1' as const, ms: m })));
    expect(played.lines).toEqual(['sec30', 'sec20', 'sec10', 'sec5', 'n4', 'n3', 'n2', 'n1']);
  });

  it('★相手の手番の残りも読み上げる (観戦者も)', () => {
    run([], [{ side: 'player2', ms: 11_000 }, { side: 'player2', ms: 9_900 }]);
    expect(played.lines).toEqual(['sec10']);
  });

  it('手番が替わったら数え直す＝替わった直後には言わない', () => {
    run(['player1'], [{ side: 'player1', ms: 11_000 }, { side: 'player2', ms: 9_000 }, { side: 'player2', ms: 4_900 }]);
    expect(played.lines).toEqual(['sec5']);
  });

  it('★「時間切れ」はこの端末で指している人が切れたときだけ (相手・観戦者・AI が切れても言わない)', () => {
    run(['player1'], [{ side: 'player1', ms: 500 }, { side: 'player1', ms: 0, status: 'timeout_p1' }]);
    expect(played.lines).toEqual(['timeup']);
    played.lines = [];
    run(['player1'], [{ side: 'player2', ms: 500 }, { side: 'player2', ms: 0, status: 'timeout_p2' }]);
    expect(played.lines).toEqual([]);
    run([], [{ side: 'player2', ms: 500 }, { side: 'player2', ms: 0, status: 'timeout_p2' }]);
    expect(played.lines).toEqual([]);
  });

  it('設定の「秒読み音」が OFF なら何も言わない', () => {
    saveByomuSound(false);
    run(['player1'], [{ side: 'player1', ms: 11_000 }, { side: 'player1', ms: 9_900 }, { side: 'player1', ms: 0, status: 'timeout_p1' }]);
    expect(played.lines).toEqual([]);
  });
});

describe('★時間切れを決めるのは指している人の端末だけ', () => {
  function connector(mySide: 'player1' | 'player2' | null) {
    const sent: string[] = [];
    const base: Record<string, unknown> = {
      isOnline: () => true,
      getMySide: () => mySide,
      getMyChatSide: () => mySide,
      getMyName: () => 'me',
      getOpponentName: () => 'you',
      isSpectating: () => mySide === null,
      getSeatNames: () => ({ player1: 'a', player2: 'b' }),
      getSpectators: () => [],
      isSpectateWaiting: () => false,
      getActiveRules: () => null,
      isRuleSetter: () => true,
      subscribe: () => () => {},
      sendTimeout: (side: string) => sent.push(side),
    };
    register('gameConnector', new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }));
    return sent;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    clearPlugins();
    clearUiSettings();
    useI18nStore.setState({ locale: 'ja' });
    useRouteStore.setState({ screen: 'game' });
    useAiStore.setState({ enabled: false, aiSide: 'player2', thinking: false });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    clearPlugins();
  });

  async function playUntilZero(mySide: 'player1' | 'player2' | null) {
    const sent = connector(mySide);
    const { App } = await import('../../App');
    render(<App variant="b" />);
    act(() => {
      useGameStore.getState().setTimeControl({ mode: 'sudden_death', mainSeconds: 1 });
    });
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    return sent;
  }

  it('自分の手番で 0 になったら、自分の端末が時間切れを決めて相手へ知らせる', async () => {
    const sent = await playUntilZero('player1');
    expect(useGameStore.getState().status).toBe('timeout_p1');
    expect(sent).toContain('player1');
  }, 30_000);

  it('★相手の手番で 0 になっても、受け取る側は負けを決めない (0 のまま相手の判定を待つ)', async () => {
    const sent = await playUntilZero('player2');
    const s = useGameStore.getState();
    expect(s.status).toBe('playing');
    expect(s.clocks.player1.mainMs).toBe(0);
    expect(sent).toEqual([]);
    // 指している人の端末から時間切れが届いたら、それを信用して終わる
    act(() => {
      useGameStore.getState().timeout('player1');
    });
    expect(useGameStore.getState().status).toBe('timeout_p1');
  }, 30_000);

  it('★観戦者も負けを決めない', async () => {
    const sent = await playUntilZero(null);
    expect(useGameStore.getState().status).toBe('playing');
    expect(sent).toEqual([]);
  }, 30_000);

  it('★量子異常の投票中は時計が止まる', async () => {
    connector('player1');
    const { App } = await import('../../App');
    render(<App variant="b" />);
    act(() => {
      useGameStore.getState().setTimeControl({ mode: 'sudden_death', mainSeconds: 10 });
    });
    act(() => {
      useGameStore.setState({ anomaly: { cause: 'empty_candidates', vote: true, myVote: null, oppVote: null } as never });
    });
    const before = useGameStore.getState().clocks.player1.mainMs;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(useGameStore.getState().clocks.player1.mainMs).toBe(before);
    expect(useGameStore.getState().status).toBe('playing');
  }, 30_000);
});
