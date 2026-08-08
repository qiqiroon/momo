/**
 * 段階6 前半の受入条件（6-2 / 6-3 / 6-4 / 6-6）
 *
 * 実際に配る `public/data/manifest.json` そのものを取得させて確かめる。
 * **見た目（ヘッダーの高さなど）は検査では出ない。実機で確かめる**（第3分冊 v1.03 の教訓）。
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '../../storage/localStore';
import { readData } from '../../test/fixtures';
import { answerSoundAsk } from '../../test/settle';
import { resetInFlight } from '../../data/fetchJson';
import { STORAGE_VERSION } from '../../data/config';
import { setLocale } from '../../i18n/locale';
import { AppShell } from './AppShell';

const REAL_MANIFEST = readData('manifest.json');

function stubFetchOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response),
  );
}

function stubFetchFail(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
}

/** 画面から離れる・戻るを起こす（C-180 の訊き直しを確かめるため） */
function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  fireEvent(document, new Event('visibilitychange'));
}

/** 言語セレクタを操作する。値は表示言語ではなくモード（`auto` を含む） */
function selectMode(mode: string): void {
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: mode } });
}

async function renderShell(): Promise<void> {
  render(<AppShell />);
  answerSoundAsk();
  // 起動時のマニフェスト取得が終わるまで待つ（2.4 の手順[3]）
  await waitFor(() => expect(screen.getByRole('button', { name: '9' })).toBeEnabled());
}

describe('段階6 前半: 共通ヘッダーとタイトルビュー', () => {
  beforeEach(async () => {
    resetInFlight();
    localStorage.clear();
    // 言語モードの正本は共通ライブラリ（momo-lang）の共有キーである。
    // 端末の言語に検査が左右されないよう、日本語を明示しておく。
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');
    stubFetchOk(REAL_MANIFEST);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------- 6-4

  it('6-4: 36 / 49 は選べない状態で表示され、他の5サイズは選べる', async () => {
    await renderShell();

    for (const n of ['1', '4', '9', '16', '25']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${n}$`) })).toBeEnabled();
    }
    for (const n of ['36', '49']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${n}` ) });
      expect(button).toBeDisabled();
      // 存在自体は示す（2.6）
      expect(button).toBeInTheDocument();
    }
  });

  it('6-4: 未解放のサイズには理由が添えられる', async () => {
    await renderShell();
    expect(screen.getByRole('button', { name: /^36/ })).toHaveTextContent('準備中');
  });

  it('選んだサイズと難易度は即時に保存される（3.6.3）', async () => {
    await renderShell();

    fireEvent.click(screen.getByRole('button', { name: /^16$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apocalypse' }));

    const saved = JSON.parse(localStorage.getItem(KEYS.settings) ?? '{}') as Record<string, unknown>;
    expect(saved.lastSize).toBe(16);
    expect(saved.lastDifficulty).toBe('Apocalypse');
  });

  // ---------------------------------------------------------------- 6-2

  it('6-2: 4言語が即時に切り替わる', async () => {
    await renderShell();
    expect(screen.getByText('盤面サイズ')).toBeInTheDocument();

    selectMode('en');
    expect(screen.getByText('Board size')).toBeInTheDocument();
    expect(screen.queryByText('盤面サイズ')).not.toBeInTheDocument();

    selectMode('zh');
    expect(screen.getByText('盘面大小')).toBeInTheDocument();

    selectMode('ja');
    expect(screen.getByText('盤面サイズ')).toBeInTheDocument();
  });

  it('6-2: 猫語では鳴き声になり、盤面サイズの数字は文言化されない（14.3）', async () => {
    await renderShell();
    selectMode('cat');

    expect(screen.queryByText('盤面サイズ')).not.toBeInTheDocument();
    // 数字は全言語共通（設計書 2.1）
    for (const n of ['1', '4', '9', '16', '25']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${n}$`) })).toBeInTheDocument();
    }
    // 難易度のランク名も固有名詞として共通
    expect(screen.getByRole('button', { name: 'Hard' })).toBeInTheDocument();
  });

  it('6-2: 言語を切り替えても、選んだサイズ・難易度は変わらない（14.4）', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /^16$/ }));

    selectMode('en');
    expect(screen.getByRole('button', { name: /^16$/ })).toHaveAttribute('aria-pressed', 'true');
    selectMode('cat');
    expect(screen.getByRole('button', { name: /^16$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('言語の選択は設定へ即時に保存される（14.4）', async () => {
    await renderShell();
    selectMode('zh');

    const saved = JSON.parse(localStorage.getItem(KEYS.settings) ?? '{}') as Record<string, unknown>;
    expect(saved.locale).toBe('zh');
  });

  // ---------------------------------------------------------------- 6-3

  it('6-3: 猫語でもサブタイトルは消えず、猫語を選ぶ前の言語のまま出る（⑰）', async () => {
    // 段階6 では猫語のとき中身を描かない決まりだったが、**消えるのは見た目の欠けである**
    // という指摘を受けて改めた。訳すと語呂合わせの意味が消えるので、猫語だけは通さない
    await renderShell();

    const sub = screen.getByTestId('header-sub');
    expect(sub).toHaveTextContent("You'll call it Su-doom.");

    selectMode('cat');
    expect(screen.getByTestId('header-sub')).toHaveTextContent("You'll call it Su-doom.");

    selectMode('zh');
    expect(screen.getByTestId('header-sub')).toHaveTextContent('你会叫它数毒。');

    // 中国語から猫語へ移ると、猫語の元になるのは中国語のほうである
    selectMode('cat');
    expect(screen.getByTestId('header-sub')).toHaveTextContent('你会叫它数毒。');
  });

  it('6-3: ヘッダーの構成は言語で変わらない（要素の数が同じ）', async () => {
    await renderShell();
    const before = document.querySelectorAll('.app-header *').length;

    selectMode('cat');
    expect(document.querySelectorAll('.app-header *').length).toBe(before);
  });

  // ------------------------------------------------- 試遊の直し（A群）

  /**
   * ⑧ 音の問いかけの出しどき（C-180 / MOMO Hanafuda v1.90 準拠）
   *
   * **起動した瞬間には出さない。最初のひと押しを横取りして、そこで出す。**
   * いきなり塞ぐと、まだ何をする画面かも分からないうちに判断を迫ることになる。
   */
  it('⑧ 起動した瞬間には問いかけを出さない', async () => {
    render(<AppShell />);
    expect(screen.queryByRole('dialog', { name: '音を鳴らしますか？' })).not.toBeInTheDocument();
  });

  it('⑧ 最初のひと押しで問いかけが出て、答えると設定に入る', async () => {
    render(<AppShell />);
    // ブラウザは人が画面を触るまで音を出さない。この問いかけへの返事が、その合図を兼ねる
    fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
    const ask = screen.getByRole('dialog', { name: '音を鳴らしますか？' });
    expect(ask).toBeInTheDocument();

    fireEvent.click(within(ask).getByRole('button', { name: '鳴らさない' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
    const sound = screen.getByRole('checkbox', { name: '効果音' });
    expect(sound).not.toBeChecked();
  });

  it('⑧ 横取りしたひと押しは、答えたあとにやり直される', async () => {
    vi.useFakeTimers();
    try {
      render(<AppShell />);
      // この押下は問いかけに食われる。押し直さなくても効くのが決まりである
      fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
      const ask = screen.getByRole('dialog', { name: '音を鳴らしますか？' });
      fireEvent.click(within(ask).getByRole('button', { name: '鳴らさない' }));
      // やり直しは問いかけを閉じたあとに回る
      expect(screen.queryByRole('checkbox', { name: '効果音' })).not.toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByRole('checkbox', { name: '効果音' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('⑧ 「鳴らす」を選ぶと効果音と触覚が入る', async () => {
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
    const ask = screen.getByRole('dialog', { name: '音を鳴らしますか？' });
    fireEvent.click(within(ask).getByRole('button', { name: '鳴らす' }));

    fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
    expect(screen.getByRole('checkbox', { name: '効果音' })).toBeChecked();
  });

  /**
   * ⑧ 長く離れて戻ったときは訊き直す（C-180）
   *
   * 離れているあいだにブラウザが音の許可を落としていることがある。
   * **短い出入りでは訊き直さない**（少し他の画面を見て戻るたびに問われては煩わしい）。
   */
  it('⑧ 1時間以上ぶりに戻ると訊き直す。短い出入りでは訊かない', async () => {
    const now = vi.spyOn(Date, 'now');
    try {
      render(<AppShell />);
      answerSoundAsk();
      expect(screen.queryByRole('dialog', { name: '音を鳴らしますか？' })).not.toBeInTheDocument();

      const hide = (at: number) => {
        now.mockReturnValue(at);
        setVisibility('hidden');
      };
      const show = (at: number) => {
        now.mockReturnValue(at);
        setVisibility('visible');
      };

      // 5分の出入り → 訊かない
      hide(0);
      show(5 * 60 * 1000);
      fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
      expect(screen.queryByRole('dialog', { name: '音を鳴らしますか？' })).not.toBeInTheDocument();

      // 2時間の出入り → 次のひと押しで訊き直す
      hide(0);
      show(2 * 60 * 60 * 1000);
      fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
      expect(screen.getByRole('dialog', { name: '音を鳴らしますか？' })).toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });

  it('⑩ タイトル画面にアプリ説明のフッターがあり、言語で切り替わる', async () => {
    await renderShell();
    const footer = screen.getByTestId('site-footer');
    expect(footer).toHaveTextContent('MOMO Sudoku について');
    // 検索から来た人がたどれるよう、他の一覧への行き先を持つ
    expect(within(footer).getByRole('link', { name: 'ゲーム一覧' })).toHaveAttribute(
      'href',
      '../../games/',
    );

    selectMode('en');
    expect(screen.getByTestId('site-footer')).toHaveTextContent('About MOMO Sudoku');
  });

  // ---------------------------------------------------------------- 6-6

  it('6-6: 成績はサイズ×難易度で並び、失敗数が別の項目として出る', async () => {
    localStorage.setItem(
      KEYS.stats,
      JSON.stringify({
        schemaVersion: STORAGE_VERSION,
        updatedAt: '2026-08-06T00:00:00.000Z',
        entries: {
          '9:Hard': { clearCount: 3, failedCount: 2, bestTimeMs: 125_000, hintUsedTotal: 4, playCount: 6 },
          '4:Easy': { clearCount: 1, failedCount: 0, bestTimeMs: 61_000, hintUsedTotal: 0, playCount: 1 },
        },
      }),
    );

    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /成績/ }));

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // 見出し行を除く
    expect(rows).toHaveLength(2);

    // サイズの小さい順・難易度の順に並ぶ
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '4',
      'Easy',
      '1',
      '0',
      '1:01',
      '1',
      '0',
    ]);
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '9',
      'Hard',
      '3',
      '2',
      '2:05',
      '6',
      '4',
    ]);
  });

  it('6-6: 中身が空の組み合わせは、記録として保存されていても行に出ない', async () => {
    localStorage.setItem(
      KEYS.stats,
      JSON.stringify({
        schemaVersion: STORAGE_VERSION,
        updatedAt: '2026-08-06T00:00:00.000Z',
        entries: {
          '9:Hard': { clearCount: 1, failedCount: 0, bestTimeMs: 60_000, hintUsedTotal: 0, playCount: 1 },
          // 一度も遊んでいない組み合わせ
          '25:Easy': { clearCount: 0, failedCount: 0, bestTimeMs: null, hintUsedTotal: 0, playCount: 0 },
        },
      }),
    );

    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /成績/ }));

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('9');
    expect(screen.getByRole('table')).not.toHaveTextContent('Easy');
  });

  it('6-6: 実績の無い組み合わせは行に出ない。皆無なら「記録がありません」', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /成績/ }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('まだ記録がありません。')).toBeInTheDocument();
  });

  it('6-6: 成績に編集・リセットの操作を置かない（C-35）', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /成績/ }));

    expect(screen.queryByRole('button', { name: /リセット|削除|消去/ })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------- 起動と通知

  it('マニフェストも退避も無い場合は、トーストではなくビュー内の案内を出す（11.5）', async () => {
    stubFetchFail();
    render(<AppShell />);
    answerSoundAsk();

    // 取得は指数バックオフで2回まで挑み直すため、待ち時間を長めに取る（3.3.4）
    await waitFor(
      () =>
        expect(
          screen.getByText('問題データを取得できませんでした。通信の状態を確かめてください。'),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByRole('button', { name: 'もう一度試す' })).toBeInTheDocument();
    // どのサイズも選べない（未解放と同じ扱いになり、理由が添えられる）
    expect(screen.getByRole('button', { name: /^9/ })).toBeDisabled();
  });

  it('取得に失敗しても、退避マニフェストがあればそれを使う（3.9.3）', async () => {
    stubFetchOk(REAL_MANIFEST);
    await renderShell();
    cleanup();

    // 2回目の起動は通信できない状態にする
    resetInFlight();
    stubFetchFail();
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByRole('button', { name: /^9$/ })).toBeEnabled(), {
      timeout: 5000,
    });
  });

  it('ヘッダーに戻る操作を置かない（C-41）', async () => {
    await renderShell();
    expect(document.querySelector('.app-header')?.textContent).not.toMatch(/戻る/);
  });
});
