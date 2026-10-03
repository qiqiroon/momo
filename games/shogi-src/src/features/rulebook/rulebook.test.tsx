/**
 * ★v1.99 ルールブックの窓 (画面機能 v0.59 §4.1 M08) と入口 3 か所。
 *
 * 固定すること:
 *   - 文章の書式の読み取り (見出し・目次・囲み・表・箇条書き・太字・区切り線)
 *   - 配る文章 (public/rulebook) が 3 言語そろっていて、節の数が同じ (訳し漏れの見張り)
 *   - 窓：一覧から／本文から開く・「‹ 一覧」で戻る・目次・閉じ方 3 つ・猫語は猫語の前の言語・読み込めないときの言葉
 *   - 入口：S01「遊び方」・S02 のリンク・S06 のボタン (量子の対局のときだけ・短い名前も持つ)
 *   - 窓を積んでいないビルドでは入口を出さない
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown, splitBold } from './markdown-lite';
import { RulebookWindow } from './RulebookWindow';
import { clearRulebookCache, rulebookUrl } from './load';
import { useRulebookStore } from '../../core/store/rulebook-store';
import { useI18nStore } from '../../core/store/i18n-store';
import { useGameStore } from '../../core/store/game-store';
import { useRouteStore } from '../../core/store/route-store';
import { useAiStore } from '../../core/store/ai-store';
import { register, clear as clearPlugins } from '../../core/plugin/registry';
import { App } from '../../App';

vi.mock('../matchmaking/bootstrap', () => ({ ensureMatchmakingInit: () => {} }));

const PUBLIC = resolve(__dirname, '../../../public/rulebook');
const DOCS = { ja: readFileSync(`${PUBLIC}/quantum.ja.md`, 'utf8'), en: readFileSync(`${PUBLIC}/quantum.en.md`, 'utf8'), zh: readFileSync(`${PUBLIC}/quantum.zh.md`, 'utf8') };

describe('文章の書式の読み取り', () => {
  const src = [
    '# 題名',
    'Version 1.0',
    '---',
    '# 第一節',
    '本文の **太字** と <b>タグのような文字</b>',
    '二行目',
    '\\---',
    '## 小見出し',
    '- 一つ目',
    '* 二つ目',
    '```',
    '駒A　金・銀',
    '```',
    '# 第二節',
    '| 用語 | 意味 |',
    '|------|------|',
    '| 候補 | 駒がなり得る駒種 |',
  ].join('\r\n');
  const { blocks, toc } = parseMarkdown(src);

  it('目次は大見出しから、最初の 1 つ (題名) を除いて作る', () => {
    expect(toc.map((e) => e.text)).toEqual(['第一節', '第二節']);
  });
  it('段落は空行まで 1 つ・区切り線 (\\--- も) は段落に混ぜない', () => {
    const paras = blocks.filter((b) => b.t === 'p');
    expect(paras).toContainEqual({ t: 'p', lines: ['Version 1.0'] });
    expect(paras).toContainEqual({ t: 'p', lines: ['本文の **太字** と <b>タグのような文字</b>', '二行目'] });
    expect(blocks.filter((b) => b.t === 'hr')).toHaveLength(2);
  });
  it('箇条書き (- と *)・囲み・表 (区切りの行は捨てる)', () => {
    expect(blocks).toContainEqual({ t: 'ul', items: ['一つ目', '二つ目'] });
    expect(blocks).toContainEqual({ t: 'pre', text: '駒A　金・銀' });
    expect(blocks).toContainEqual({ t: 'table', head: ['用語', '意味'], rows: [['候補', '駒がなり得る駒種']] });
  });
  it('太字を切り分け、閉じていない ** は文字のまま', () => {
    expect(splitBold('a **b** c')).toEqual([{ bold: false, text: 'a ' }, { bold: true, text: 'b' }, { bold: false, text: ' c' }]);
    expect(splitBold('a ** b')).toEqual([{ bold: false, text: 'a ** b' }]);
  });
});

describe('配る文章 (public/rulebook)', () => {
  it('3 言語そろっていて、題名に「MOMO Shogi」が残っている (消さない＝利用者)', () => {
    for (const d of Object.values(DOCS)) expect(d.split('\n')[0]).toContain('MOMO Shogi');
  });
  it('3 言語で節の数・目次の数・表・囲みの数が同じ (訳し漏れの見張り)', () => {
    const shape = (d: string) => {
      const p = parseMarkdown(d);
      const n = (t: string) => p.blocks.filter((b) => b.t === t).length;
      return { toc: p.toc.length, h: n('h'), table: n('table'), pre: n('pre') };
    };
    expect(shape(DOCS.en)).toEqual(shape(DOCS.ja));
    expect(shape(DOCS.zh)).toEqual(shape(DOCS.ja));
    expect(shape(DOCS.ja).toc).toBeGreaterThan(20);
  });
  it('書き直しで決めた言葉になっている (伝搬・量子もつれ・詰ませると勝ち)', () => {
    expect(DOCS.ja).not.toContain('伝播');
    expect(DOCS.ja).toContain('量子もつれ');
    expect(DOCS.ja).toContain('詰ませると勝ち');
    expect(DOCS.ja).not.toContain('勝利条件は一つ');
  });
});

/** fetch の代わり。言語ごとの文章を返し、呼ばれた URL を控える。 */
function mockFetch(fail = false): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    if (fail) return { ok: false, status: 404, text: async () => '' };
    const lang = url.match(/quantum\.(ja|en|zh)\.md$/)?.[1] as 'ja' | 'en' | 'zh';
    return { ok: true, status: 200, text: async () => DOCS[lang] };
  });
  return urls;
}

describe('ルールブックの窓', () => {
  beforeEach(() => {
    clearRulebookCache();
    useI18nStore.setState({ locale: 'ja', catBase: 'ja' });
    act(() => useRulebookStore.getState().close());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => useRulebookStore.getState().close());
  });

  it('本文から開く (S02・S06)＝一覧を通らず、「‹ 一覧」も出ない', async () => {
    const urls = mockFetch();
    render(<RulebookWindow />);
    act(() => useRulebookStore.getState().openDoc());
    expect(await screen.findByText('Quantum Shogiとは')).toBeTruthy();
    expect(screen.queryByText('‹ 一覧')).toBeNull();
    expect(urls[0]).toBe(rulebookUrl('quantum', 'ja'));
  });

  it('一覧から開く (S01 遊び方)＝項目の名前は「MOMO Shogi式量子将棋ルール」・選ぶと本文・「‹ 一覧」で戻る', async () => {
    mockFetch();
    render(<RulebookWindow />);
    act(() => useRulebookStore.getState().openList());
    expect(screen.getByText('ルールブックを選んでください')).toBeTruthy();
    fireEvent.click(screen.getByText('MOMO Shogi式量子将棋ルール'));
    expect(await screen.findByText('Quantum Shogiとは')).toBeTruthy();
    fireEvent.click(screen.getByText('‹ 一覧'));
    expect(screen.getByText('ルールブックを選んでください')).toBeTruthy();
  });

  it('目次を開いて節を選ぶと目次が閉じる', async () => {
    mockFetch();
    render(<RulebookWindow />);
    act(() => useRulebookStore.getState().openDoc());
    await screen.findByText('Quantum Shogiとは');
    fireEvent.click(screen.getByText('目次'));
    const nav = document.querySelector('.rb-toc')!;
    expect(nav).toBeTruthy();
    const entry = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent === '千日手')!;
    fireEvent.click(entry);
    expect(document.querySelector('.rb-toc')).toBeNull();
  });

  it('閉じ方 3 つ：✕・窓の外・Esc', async () => {
    mockFetch();
    render(<RulebookWindow />);
    for (const how of ['x', 'outside', 'esc'] as const) {
      act(() => useRulebookStore.getState().openDoc());
      await screen.findByText('Quantum Shogiとは');
      if (how === 'x') fireEvent.click(screen.getByLabelText('閉じる'));
      if (how === 'outside') fireEvent.click(document.querySelector('.rb-overlay')!);
      if (how === 'esc') fireEvent.keyDown(window, { key: 'Escape' });
      expect(useRulebookStore.getState().open).toBeNull();
      expect(document.querySelector('.rb-overlay')).toBeNull();
    }
  });

  it('窓の中を押しても閉じない', async () => {
    mockFetch();
    render(<RulebookWindow />);
    act(() => useRulebookStore.getState().openDoc());
    fireEvent.click(await screen.findByText('Quantum Shogiとは'));
    expect(useRulebookStore.getState().open).not.toBeNull();
  });

  it('英語・中国語は画面の言語で、猫語は猫語にする前の言語で本文を読む', async () => {
    const urls = mockFetch();
    render(<RulebookWindow />);
    useI18nStore.setState({ locale: 'en' });
    act(() => useRulebookStore.getState().openDoc());
    expect(await screen.findByText('What is Quantum Shogi?')).toBeTruthy();
    act(() => useRulebookStore.getState().close());
    useI18nStore.setState({ locale: 'cat', catBase: 'zh' });
    act(() => useRulebookStore.getState().openDoc());
    await waitFor(() => expect(urls.at(-1)).toBe(rulebookUrl('quantum', 'zh')));
  });

  it('読み込めないときは窓の中に言葉で知らせる', async () => {
    mockFetch(true);
    render(<RulebookWindow />);
    act(() => useRulebookStore.getState().openDoc());
    expect(await screen.findByText(/ルールブックを読み込めませんでした/)).toBeTruthy();
  });
});

describe('入口 3 か所', () => {
  beforeEach(() => {
    clearPlugins();
    useI18nStore.setState({ locale: 'ja', catBase: 'ja' });
    useAiStore.setState({ enabled: false, aiSide: 'player2', thinking: false });
    act(() => useRulebookStore.getState().close());
  });
  afterEach(() => {
    clearPlugins();
    act(() => useRulebookStore.getState().close());
  });

  async function withRulebook() {
    register('overlay:rulebook', RulebookWindow);
    const { MenuScreen } = await import('../matchmaking/ui/MenuScreen');
    const { RuleSelectScreen } = await import('../matchmaking/ui/RuleSelectScreen');
    return { MenuScreen, RuleSelectScreen };
  }

  it('S01：区切り線のあとに「遊び方」があり、押すと一覧から開く', async () => {
    const { MenuScreen } = await withRulebook();
    render(<MenuScreen />);
    expect(document.querySelector('.mode-sep')).toBeTruthy();
    fireEvent.click(screen.getByText('遊び方'));
    expect(useRulebookStore.getState().open).toEqual({ view: 'list', fromList: true });
  });

  it('S02：量子の欄に「MOMO Shogi式量子将棋ルール ›」があり、押すと本文から開く', async () => {
    const { RuleSelectScreen } = await withRulebook();
    register('gameConnector', { isRuleSetter: () => true });
    render(<RuleSelectScreen />);
    fireEvent.click(screen.getByText('MOMO Shogi式量子将棋ルール ›'));
    expect(useRulebookStore.getState().open).toEqual({ view: 'doc', fromList: false });
  });

  it('S06：量子の対局のときだけボタンが出て、長い名前と短い名前の両方を持つ', async () => {
    await withRulebook();
    useRouteStore.setState({ screen: 'game' });
    useGameStore.getState().reset({ gameType: 'shogi', quantum: true, torusMode: 'none', handicap: null });
    const { unmount } = render(<App variant="b" />);
    const btn = document.querySelector('.rule-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.querySelector('.lbl-long')!.textContent).toBe('MOMO Shogi式量子将棋ルール');
    expect(btn.querySelector('.lbl-short')!.textContent).toBe('ルール');
    fireEvent.click(btn);
    expect(useRulebookStore.getState().open).toEqual({ view: 'doc', fromList: false });
    unmount();

    act(() => useRulebookStore.getState().close());
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    render(<App variant="b" />);
    expect(document.querySelector('.rule-btn')).toBeNull();
  });

  it('窓を積んでいないビルドでは、どの入口も出さない', async () => {
    const { MenuScreen } = await import('../matchmaking/ui/MenuScreen');
    render(<MenuScreen />);
    expect(screen.queryByText('遊び方')).toBeNull();
    expect(document.querySelector('.mode-sep')).toBeNull();
  });
});
