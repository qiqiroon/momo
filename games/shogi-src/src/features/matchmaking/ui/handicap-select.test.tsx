import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleSelectScreen } from './RuleSelectScreen';
import { OfflineRuleScreen } from '../../../core/ui-core/OfflineRuleScreen';
import { useGameStore } from '../../../core/store/game-store';
import { applyHandicapToCells, quantumKindsFor } from './MiniBoardPreview';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore } from '../store';
import { useRouteStore } from '../../../core/store/route-store';
import { useI18nStore } from '../../../core/store/i18n-store';
import { register, clear as clearPlugins } from '../../../core/plugin/registry';

/**
 * v1.33: ルール選択画面 (S02) の手合い (駒落ち)。
 *
 * 決まりは付録D-2 v1.6 §3.1／§5・意味論は親 v1.28 §3.12.1:
 *   - 自分側・相手側それぞれで「平手または手合いの種類」を選べる
 *   - **片方を駒落ちにすると反対側は平手に戻る** (両方同時には落とせない)
 *   - 席の呼び名は経路ごとに変わる (対AI＝あなた/AI・対人＝手前側/向こう側)
 *   - 選べる種類はルール定義が持つ一覧から作る (持たないルールでは選べない)
 *   - プレビュー盤には落ちた形が写る
 */

function setup(dest: 'ai-setup' | 'offline-rule' | 'net-lobby' = 'ai-setup') {
  register('gameConnector', { isRuleSetter: () => true });
  useI18nStore.setState({ locale: 'ja' });
  useRouteStore.setState({ ruleSelectReturn: dest });
  useMatchmakingStore.setState({ pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG } });
}

const selfSelect = () => screen.getByLabelText('あなた') as HTMLSelectElement;
const aiSelect = () => screen.getByLabelText('AI') as HTMLSelectElement;

describe('S02 手合い (駒落ち)', () => {
  beforeEach(() => { clearPlugins(); setup(); });
  afterEach(() => { clearPlugins(); });

  it('自分側・相手側の 2 つの欄が出て、既定はどちらも平手', () => {
    render(<RuleSelectScreen />);
    expect(screen.getByText('手合い')).toBeTruthy();
    expect(selfSelect().value).toBe('');
    expect(aiSelect().value).toBe('');
    // 種類はルール定義が持つ一覧から作る (本将棋は 6 種類＋平手)
    expect(selfSelect().options.length).toBe(7);
  });

  it('片方を駒落ちにすると、反対側は平手のまま (排他)', () => {
    render(<RuleSelectScreen />);
    fireEvent.change(aiSelect(), { target: { value: 'ni' } });
    expect(useMatchmakingStore.getState().pendingRoomConfig.handicap)
      .toEqual({ typeId: 'ni', giver: 'opponent' });
    expect(selfSelect().value).toBe('');

    // 反対側を選び直すと、そちらへ移って元は平手に戻る
    fireEvent.change(selfSelect(), { target: { value: 'kaku' } });
    expect(useMatchmakingStore.getState().pendingRoomConfig.handicap)
      .toEqual({ typeId: 'kaku', giver: 'self' });
    expect(aiSelect().value).toBe('');
  });

  it('平手に戻せる', () => {
    render(<RuleSelectScreen />);
    fireEvent.change(aiSelect(), { target: { value: 'ni' } });
    fireEvent.change(aiSelect(), { target: { value: '' } });
    expect(useMatchmakingStore.getState().pendingRoomConfig.handicap).toBeNull();
  });

  it('席の呼び名は経路で変わる (人どうしなら手前側／向こう側)', () => {
    clearPlugins();
    setup('offline-rule');
    render(<RuleSelectScreen />);
    expect(screen.getByLabelText('手前側')).toBeTruthy();
    expect(screen.getByLabelText('向こう側')).toBeTruthy();
  });

  it('駒落ちを選ぶと「落とした側が先手」と出る', () => {
    render(<RuleSelectScreen />);
    expect(screen.queryByText('駒を落とした側が先手になります')).toBeNull();
    fireEvent.change(aiSelect(), { target: { value: 'ni' } });
    expect(screen.getByText('駒を落とした側が先手になります')).toBeTruthy();
  });

  it('手合いを持たないルールでは選べず、理由が出る', () => {
    useMatchmakingStore.setState({
      pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG, gameType: 'hasami' },
    });
    render(<RuleSelectScreen />);
    expect(selfSelect().disabled).toBe(true);
    expect(screen.getByText('このルールは駒落ちに対応していません（平手のみ）')).toBeTruthy();
  });

  it('駒落ちのまま対応しないルールへ移ると平手へ戻る', () => {
    render(<RuleSelectScreen />);
    fireEvent.change(aiSelect(), { target: { value: 'ni' } });
    fireEvent.click(screen.getByText('はさみ将棋'));
    expect(useMatchmakingStore.getState().pendingRoomConfig.handicap).toBeNull();
  });
});

/**
 * 人どうしのオフライン対局 (S01)。v1.33 でここでも駒落ちを使えるようにした。
 *
 * 上手＝先手＝player1 なので、**向こう側が落とすと手前に座っている人は後手**になる。
 * 盤は手前の人が下に来るように向きを決める＝プレビューで見た形とそろう。
 */
describe('人どうしの対局で駒落ちを使う', () => {
  beforeEach(() => { clearPlugins(); setup('offline-rule'); });
  afterEach(() => { clearPlugins(); });

  const startOffline = (handicap: { typeId: string; giver: 'self' | 'opponent' } | null) => {
    useMatchmakingStore.setState({
      pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG, handicap },
    });
    register('gameConnector', {
      isRuleSetter: () => true,
      getPendingRules: () => ({
        gameType: 'shogi' as const, torusMode: 'none' as const,
        quantum: false, quantumDisplayMode: 'cycle' as const, handicap,
      }),
      getPendingTimeControl: () => DEFAULT_ROOM_CONFIG.timeControl,
      commitPendingToActive: () => {},
    });
    render(<OfflineRuleScreen />);
    fireEvent.click(screen.getByText('対局開始'));
    return useGameStore.getState();
  };

  it('手前側が落とすと、手前が先手で駒が減る', () => {
    const gs = startOffline({ typeId: 'ni', giver: 'self' });
    expect(gs.currentHandicap).toEqual({ typeId: 'ni', giver: 'player1' });
    expect(gs.localViewerSide).toBe('player1'); // 手前＝先手＝下側
    expect(gs.position.board.flat().filter((c) => c && c.owner === 'player1')).toHaveLength(18);
  });

  it('向こう側が落とすと、向こうが先手になり手前は後手になる', () => {
    const gs = startOffline({ typeId: 'ni', giver: 'opponent' });
    expect(gs.position.sideToMove).toBe('player1'); // 先手＝落とした側
    expect(gs.localViewerSide).toBe('player2'); // 手前に座るのは落としていない側
  });

  it('平手なら手前が先手のまま', () => {
    const gs = startOffline(null);
    expect(gs.currentHandicap).toBeNull();
    expect(gs.localViewerSide).toBe('player1');
    expect(gs.position.board.flat().filter((c) => c !== null)).toHaveLength(40);
  });
});

describe('プレビュー盤の駒落ち', () => {
  /** 9×9 の並びから「駒がある升」の数を数える */
  const filled = (cells: { ch: string }[]) => cells.filter((c) => c.ch !== '').length;

  const shogi = () => {
    const g = (ch: string) => ({ ch, gote: true });
    const s = (ch: string) => ({ ch });
    const E = { ch: '' };
    return [
      g('香'), g('桂'), g('銀'), g('金'), g('玉'), g('金'), g('銀'), g('桂'), g('香'),
      E, g('飛'), E, E, E, E, E, g('角'), E,
      ...Array.from({ length: 9 }, () => g('歩')),
      ...Array.from({ length: 27 }, () => E),
      ...Array.from({ length: 9 }, () => s('歩')),
      E, s('角'), E, E, E, E, E, s('飛'), E,
      s('香'), s('桂'), s('銀'), s('金'), s('玉'), s('金'), s('銀'), s('桂'), s('香'),
    ];
  };

  it('二枚落ちなら 2 枚減る', () => {
    const out = applyHandicapToCells(shogi(), {
      giverIsBottom: true,
      remove: [{ piece: 'hi' }, { piece: 'kaku' }],
    });
    expect(filled(out)).toBe(38);
  });

  it('落ちるのは指定した側だけ (下側指定なら上側は減らない)', () => {
    const out = applyHandicapToCells(shogi(), { giverIsBottom: true, remove: [{ piece: 'hi' }] });
    // 上側の飛は残る (1 行目の列 1)
    expect(out[9 + 1].ch).toBe('飛');
    // 下側の飛が消える (7 行目の列 7)
    expect(out[7 * 9 + 7].ch).toBe('');
  });

  it('香落ちは「上手から見て左」の香が落ちる (下側なら 9 筋側)', () => {
    const bottom = applyHandicapToCells(shogi(), {
      giverIsBottom: true,
      remove: [{ piece: 'kyo', count: 1, pick: 'left' }],
    });
    expect(bottom[8 * 9 + 0].ch).toBe('');
    expect(bottom[8 * 9 + 8].ch).toBe('香');

    // 上側から見た左は反対側になる
    const top = applyHandicapToCells(shogi(), {
      giverIsBottom: false,
      remove: [{ piece: 'kyo', count: 1, pick: 'left' }],
    });
    expect(top[8].ch).toBe('');
    expect(top[0].ch).toBe('香');
  });

  it('六枚落ちなら 6 枚減る', () => {
    const out = applyHandicapToCells(shogi(), {
      giverIsBottom: false,
      remove: [
        { piece: 'hi' }, { piece: 'kaku' },
        { piece: 'kyo', count: 2 }, { piece: 'kei', count: 2 },
      ],
    });
    expect(filled(out)).toBe(34);
  });

  /**
   * v1.34 (付録D-2 v1.7 §5): 量子 ON のとき、落とした駒種はプレビューの候補からも消す。
   * 決め打ちの 8 種を回していたので、盤に 1 枚も無い飛や角が候補として回り続けていた。
   */
  describe('量子 ON の候補の顔ぶれ', () => {
    it('平手なら両側とも 8 種', () => {
      const cells = shogi();
      expect(quantumKindsFor(cells, false)).toEqual(['王', '飛', '角', '金', '銀', '桂', '香', '歩']);
      expect(quantumKindsFor(cells, true)).toHaveLength(8);
    });

    it('六枚落ちなら上手側は玉・金・銀・歩の 4 種だけになる', () => {
      const out = applyHandicapToCells(shogi(), {
        giverIsBottom: true,
        remove: [
          { piece: 'hi' }, { piece: 'kaku' },
          { piece: 'kyo', count: 2 }, { piece: 'kei', count: 2 },
        ],
      });
      expect(quantumKindsFor(out, false)).toEqual(['王', '金', '銀', '歩']);
      // 落としていない側は 8 種のまま
      expect(quantumKindsFor(out, true)).toHaveLength(8);
    });

    it('香落ちでは香が残る (1 枚あるため)', () => {
      const out = applyHandicapToCells(shogi(), {
        giverIsBottom: true,
        remove: [{ piece: 'kyo', count: 1, pick: 'left' }],
      });
      expect(quantumKindsFor(out, false)).toContain('香');
      expect(quantumKindsFor(out, false)).toHaveLength(8);
    });

    it('二枚落ちなら上手側から飛と角が消える', () => {
      const out = applyHandicapToCells(shogi(), {
        giverIsBottom: false,
        remove: [{ piece: 'hi' }, { piece: 'kaku' }],
      });
      const top = quantumKindsFor(out, true);
      expect(top).not.toContain('飛');
      expect(top).not.toContain('角');
      expect(top).toEqual(['王', '金', '銀', '桂', '香', '歩']);
      expect(quantumKindsFor(out, false)).toContain('飛');
    });
  });
});
