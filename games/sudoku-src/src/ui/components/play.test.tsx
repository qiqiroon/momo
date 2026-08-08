/**
 * 段階6 後半の受入条件（6-1 / 6-5 / 6-7）
 *
 * 実際に配る `public/data/` をそのまま取得させて確かめる。
 * 1×1 は在庫が1問で、固定値が無く解が `1` である。**中断が完成形のまま再開される**状況を、
 * サイズ固有の細工をせずに作れるため、完成の提示の確認に用いる。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_VERSION } from '../../data/config';
import { resetInFlight } from '../../data/fetchJson';
import { indexLoader } from '../../data/indexLoader';
import { setLocale } from '../../i18n/locale';
import { KEYS } from '../../storage/localStore';
import { readData } from '../../test/fixtures';
import { answerSoundAsk } from '../../test/settle';
import { AppShell } from './AppShell';

const MANIFEST = readData('manifest.json');
const N01_INDEX = readData('n01/index.json');
const N01_CHUNK = readData('n01/c0000.json');
const N09_INDEX = readData('n09/index.json');
const N09_CHUNKS = ['c0000.json', 'c0001.json', 'c0002.json', 'c0003.json'].map((file) => ({
  file: `n09/${file}`,
  body: readData(`n09/${file}`),
}));

/** URL ごとに実データを返す。取得できない URL は失敗させる */
function stubFetch(): ReturnType<typeof vi.fn> {
  const table: Record<string, unknown> = {
    'manifest.json': MANIFEST,
    'n01/index.json': N01_INDEX,
    'n01/c0000.json': N01_CHUNK,
    'n09/index.json': N09_INDEX,
  };
  for (const chunk of N09_CHUNKS) table[chunk.file] = chunk.body;
  const mock = vi.fn(async (url: string) => {
    const hit = Object.keys(table).find((key) => url.endsWith(key));
    if (hit === undefined) return { ok: false, status: 404 } as unknown as Response;
    return { ok: true, status: 200, text: async () => JSON.stringify(table[hit]) } as unknown as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const identityOrder = (n: number): number[] =>
  Array.from({ length: Math.round(Math.sqrt(n)) }, (_, i) => i);

const identityOrders = (n: number): number[][] =>
  Array.from({ length: Math.round(Math.sqrt(n)) }, () => identityOrder(n));

/** 中断セッションを1件置く。`entered` を与えると、その記入内容で再開される */
function putSuspended(options: {
  n: number;
  difficulty?: string;
  sourceId: string;
  entered: number[];
  notes?: number[][];
  mistakeCount?: number;
  failed?: boolean;
  elapsedMs?: number;
}): void {
  localStorage.setItem(
    KEYS.session,
    JSON.stringify({
      schemaVersion: STORAGE_VERSION,
      savedAt: '2026-08-06T00:00:00.000Z',
      n: options.n,
      difficulty: options.difficulty ?? 'Easy',
      sourceId: options.sourceId,
      // 恒等変換（回転なし・入替なし）。1×1 では唯一の変換である
      transformParams: {
        version: 1,
        rotation: 0,
        mirror: false,
        symbolMap: Array.from({ length: options.n }, (_, i) => i + 1),
        bandOrder: identityOrder(options.n),
        rowOrderInBand: identityOrders(options.n),
        stackOrder: identityOrder(options.n),
        colOrderInStack: identityOrders(options.n),
      },
      entered: options.entered,
      notes: options.notes ?? [],
      elapsedMs: options.elapsedMs ?? 12_000,
      mistakeCount: options.mistakeCount ?? 0,
      failed: options.failed ?? false,
      hintUsed: 0,
    }),
  );
}

describe('段階6 後半: 起動と中断からの再開', () => {
  beforeEach(async () => {
    resetInFlight();
    indexLoader.invalidate();
    localStorage.clear();
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------- 6-1

  it('6-1: 取得の完了を待たずに、共通ヘッダーとタイトルビューが出る', () => {
    render(<AppShell />);
    answerSoundAsk();
    // 取得は解決していないが、この時点で既に描けている（2.4 手順[2]）
    expect(screen.getByText('MOMO')).toBeInTheDocument();
    expect(screen.getByText('盤面サイズ')).toBeInTheDocument();
    expect(screen.getByText('問題データを読み込んでいます…')).toBeInTheDocument();
  });

  it('6-1: 取得が終わるとサイズの選択が有効になる', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByRole('button', { name: /^9$/ })).toBeEnabled());
    expect(screen.queryByText('問題データを読み込んでいます…')).not.toBeInTheDocument();
  });

  it('⑪ 状態表示はヘッダーの中にある（盤面と一緒にスクロールしない）', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByRole('button', { name: /^9$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    await screen.findByTestId('board');

    const status = screen.getByTestId('status-time');
    // 以前は盤面と同じ入れ物にあり、画面を送ると外へ出ていた
    expect(status.closest('.app-header')).not.toBeNull();
    expect(status.closest('.play-view')).toBeNull();
  });

  it('6-1: 新しく始めるとプレイビューへ切り替わり、状態バーが出る', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByRole('button', { name: /^9$/ })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /^9$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apocalypse' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    // **利用者が選んだ難易度が出る**（C-178）。元問題の格付けではない。
    // サイズと難易度のあいだに区切り記号は置かず、空白1文字だけとする
    expect(screen.getByText('9×9 Apocalypse')).toBeInTheDocument();
    expect(screen.getByTestId('status-time')).toHaveTextContent('0:00');
    // ヘッダーは同じものが載ったままである（2.3）
    expect(screen.getByText('MOMO')).toBeInTheDocument();
  });

  /**
   * ⑬ 在庫が無い難易度でも、遊ぶのは選んだ難易度（C-178）
   *
   * 1×1 は問題が1通りしか存在せず、その1問は Easy と格付けされている。
   * よって Hard を選ぶと**必ず難易度の落とし込みが起きる**（第1分冊 3.5）。
   * 従来は元問題の格付けをそのまま採っていたため、Hard を選んでも Easy として遊ばされ、
   * **Easy の自動候補が出て、成績も Easy に付いていた。**
   *
   * 見た目で分かる差として、**メモの操作は Easy でだけ出ない**（C-53）ことを使う。
   */
  it('⑬ 在庫の無い難易度を選んでも、選んだ難易度で遊ぶ（C-178）', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByRole('button', { name: /^1$/ })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /^1$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(screen.getByText('1×1 Hard')).toBeInTheDocument();
    // Easy に落とされていれば、メモの操作は出ない
    expect(screen.getByTestId('action-note')).toBeInTheDocument();
  });

  it('出題が確定すると既出へ積まれ、中断は捨てられる（第2分冊 12.3 / 8.3）', async () => {
    putSuspended({ n: 1, sourceId: 'N1-000001', entered: [0] });
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());

    // いったん中断して戻り、破棄して新規開始する
    fireEvent.click(screen.getByRole('button', { name: '中断して戻る' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '破棄して始める' }),
    );

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    // 新規開始は設定のサイズ（既定 9）で行われる
    const recent = JSON.parse(localStorage.getItem(KEYS.recent) ?? '{}') as {
      buffers: Record<string, string[]>;
    };
    expect(recent.buffers['9']).toHaveLength(1);
    expect(recent.buffers['9'][0]).toMatch(/^N9-/);
    expect(localStorage.getItem(KEYS.session)).toBeNull();
  });

  // ---------------------------------------------------------------- 6-5

  it('6-5: 中断があると、確認なしでそのまま再開する（C-38）', async () => {
    putSuspended({ n: 9, difficulty: 'Easy', sourceId: 'N9-000001', entered: new Array(81).fill(0), elapsedMs: 65_000 });
    render(<AppShell />);
    answerSoundAsk();

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    // 確認ダイアログを一度も出さない
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // 経過時間は保存されていた値から続く
    expect(screen.getByTestId('status-time')).toHaveTextContent('1:05');
  });

  it('6-5: 再開に失敗したら、通知せずタイトルビューに留まる（C-40）', async () => {
    // 在庫に無い元問題を指す中断
    putSuspended({ n: 9, sourceId: 'N9-999999', entered: new Array(81).fill(0) });
    render(<AppShell />);
    answerSoundAsk();

    await waitFor(() => expect(screen.getByRole('button', { name: /^9$/ })).toBeEnabled());
    await waitFor(() => expect(localStorage.getItem(KEYS.session)).toBeNull());

    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // トーストも出さない
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前回の続きから' })).toBeDisabled();
  });

  it('6-5: 中断して戻ると、保存されてタイトルビューへ帰る（2.5）', async () => {
    putSuspended({ n: 9, sourceId: 'N9-000001', entered: new Array(81).fill(0) });
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '中断して戻る' }));

    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEYS.session)).not.toBeNull();
    expect(screen.getByRole('button', { name: '前回の続きから' })).toBeEnabled();
  });

  it('6-5: ミスと失敗の状態も中断から戻る（11.1）', async () => {
    putSuspended({
      n: 9,
      difficulty: 'Hard',
      sourceId: 'N9-000001',
      entered: new Array(81).fill(0),
      mistakeCount: 3,
      failed: true,
    });
    render(<AppShell />);
    answerSoundAsk();

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(screen.getByTestId('status-mistake')).toHaveTextContent('ミス 3 / 3');
    expect(screen.getByTestId('status-failed')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------- 6-7

  it('6-7: 完成すると結果が出て、閉じるとタイトルビューへ戻る', async () => {
    // 1×1 は固定値が無く解が 1。記入済みの中断＝完成した状態である
    putSuspended({ n: 1, sourceId: 'N1-000001', entered: [1], elapsedMs: 61_000 });
    render(<AppShell />);
    answerSoundAsk();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('完成しました')).toBeInTheDocument();
    expect(within(dialog).getByText('1×1 Easy')).toBeInTheDocument();
    expect(within(dialog).getByText('所要時間 1:01')).toBeInTheDocument();
    expect(within(dialog).getByTestId('best-updated')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'タイトルへ戻る' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(screen.getByText('盤面サイズ')).toBeInTheDocument();
  });

  it('6-7: 完成した時点で成績に記録され、中断は残らない（第2分冊 10.4）', async () => {
    putSuspended({ n: 1, sourceId: 'N1-000001', entered: [1], elapsedMs: 61_000 });
    render(<AppShell />);
    answerSoundAsk();
    await screen.findByRole('dialog');

    const stats = JSON.parse(localStorage.getItem(KEYS.stats) ?? '{}') as {
      entries: Record<string, { clearCount: number; bestTimeMs: number; playCount: number }>;
    };
    expect(stats.entries['1:Easy'].clearCount).toBe(1);
    // 保存されていた 61 秒から続いて計られる（実時間ぶんだけ増える）
    expect(stats.entries['1:Easy'].bestTimeMs).toBeGreaterThanOrEqual(61_000);
    expect(stats.entries['1:Easy'].bestTimeMs).toBeLessThan(62_000);
    expect(localStorage.getItem(KEYS.session)).toBeNull();
  });

  it('6-7: 「同じ条件でもう1問」は、同じサイズ・難易度で出題し直す', async () => {
    putSuspended({ n: 1, sourceId: 'N1-000001', entered: [1] });
    render(<AppShell />);
    answerSoundAsk();
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: '同じ条件でもう1問' }));

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(screen.getByText('1×1 Easy')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('6-7: 完成の結果は成績にも現れる（サイズ×難易度）', async () => {
    putSuspended({ n: 1, sourceId: 'N1-000001', entered: [1], elapsedMs: 61_000 });
    render(<AppShell />);
    answerSoundAsk();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'タイトルへ戻る' }));

    fireEvent.click(screen.getByRole('button', { name: /成績/ }));
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '1',
      'Easy',
      '1',
      '0',
      '1:01',
      '1',
      '0',
    ]);
  });

  // ---------------------------------------------------------------- 破棄確認（D-01 / C-39）

  /**
   * 中断がある状態でタイトルビューを出す。
   * 起動時は確認なしで再開されるため（C-38）、**いったんプレイしてから戻る**のが唯一の経路である（2.6）。
   */
  async function backToTitleWithSuspended(): Promise<void> {
    putSuspended({ n: 9, sourceId: 'N9-000001', entered: new Array(81).fill(0) });
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '中断して戻る' }));
  }

  it('中断があるときだけ「前回の続きから」が押せる', async () => {
    await backToTitleWithSuspended();
    expect(screen.getByRole('button', { name: '前回の続きから' })).toBeEnabled();
  });

  it('中断がある状態で「新しく始める」を選ぶと破棄確認が出る。既定はキャンセル', async () => {
    await backToTitleWithSuspended();
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('中断中のゲームを破棄しますか')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'キャンセル' }));
  });

  it('キャンセルすると中断は残る', async () => {
    await backToTitleWithSuspended();
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEYS.session)).not.toBeNull();
    expect(screen.getByRole('button', { name: '前回の続きから' })).toBeEnabled();
  });

  it('Esc は取り消しとして働く（12.1）', async () => {
    await backToTitleWithSuspended();
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEYS.session)).not.toBeNull();
  });

  it('破棄して始めると、前の中断は消えて新しい出題になる（12.3）', async () => {
    await backToTitleWithSuspended();
    const before = localStorage.getItem(KEYS.session);
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '破棄して始める' }),
    );

    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(localStorage.getItem(KEYS.session)).not.toBe(before);
    expect(localStorage.getItem(KEYS.session)).toBeNull();
  });

  // ---------------------------------------------------------------- 可視性（15.8）

  it('画面が隠れると中断が保存される（第1分冊 3.6.4）', async () => {
    putSuspended({ n: 9, sourceId: 'N9-000001', entered: new Array(81).fill(0) });
    render(<AppShell />);
    answerSoundAsk();
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());

    localStorage.removeItem(KEYS.session);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(localStorage.getItem(KEYS.session)).not.toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});
