/**
 * 段階7 前半（入力・数値パレット・キーボード・値ハイライトの配線）の検査。
 *
 * 盤面のタップは画面上の座標を要するが、jsdom には配置計算が無く矩形がすべて 0 になる。
 * **座標を使わずに済む経路（矢印キー）で選択してから**、入力の疎通を確かめる。
 * 見た目そのもの（ハイライトの色・仮表示）は描画エンジンの検査が受け持つ。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { settleBoard, answerSoundAsk } from '../../test/settle';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SIZES, type BoardSize } from '../../data/types';
import { resetInFlight } from '../../data/fetchJson';
import { indexLoader } from '../../data/indexLoader';
import { setLocale } from '../../i18n/locale';
import { readData } from '../../test/fixtures';
import { AppShell, resolveDigit } from './AppShell';
import { ActionButtons } from './ActionButtons';
import { NumberPalette, columnsFor } from './NumberPalette';

// ---------------------------------------------------------------- 多桁入力の確定規則（8.5.1）

describe('多桁入力の確定規則（8.5.1 / V-15）', () => {
  it('9×9 では待ちが一度も起きない（10 以上の値が無い帰結・サイズ別の分岐ではない）', () => {
    for (const digit of ['1', '5', '9']) {
      expect(resolveDigit(9, '', digit)).toEqual({ kind: 'COMMIT', text: digit });
    }
  });

  it('25×25 では 2桁になりうる先頭だけが待つ', () => {
    // 1 は 1・10〜19 の可能性がある
    expect(resolveDigit(25, '', '1')).toEqual({ kind: 'WAIT', text: '1' });
    // 2 は 2・20〜25 の可能性がある
    expect(resolveDigit(25, '', '2')).toEqual({ kind: 'WAIT', text: '2' });
    // 3 は 30 台がすべて 25 を超えるので即確定
    expect(resolveDigit(25, '', '3')).toEqual({ kind: 'COMMIT', text: '3' });
  });

  it('2桁目が来たら、それ以上は伸びないので確定する', () => {
    expect(resolveDigit(25, '1', '2')).toEqual({ kind: 'COMMIT', text: '12' });
    expect(resolveDigit(49, '4', '9')).toEqual({ kind: 'COMMIT', text: '49' });
    expect(resolveDigit(16, '1', '6')).toEqual({ kind: 'COMMIT', text: '16' });
  });

  it('加えると N を超える桁は、手前を確定させて次の入力の先頭になる', () => {
    expect(resolveDigit(25, '2', '6')).toEqual({
      kind: 'COMMIT_AND_RESTART',
      text: '2',
      digit: '6',
    });
    expect(resolveDigit(16, '1', '7')).toEqual({
      kind: 'COMMIT_AND_RESTART',
      text: '1',
      digit: '7',
    });
  });

  it('その盤面に存在しない値は無効操作とする', () => {
    expect(resolveDigit(4, '', '7')).toEqual({ kind: 'IGNORE' });
  });

  /**
   * C-184: **先頭の `0` は「1桁で入れる」という宣言である。**
   *
   * 25×25 の `1` のように2桁になりうる数字を、待たずに1桁で入れる手段が無かった。
   * `0` を押すと仮に見えたままになり、次の1文字でその数字として確定する。
   */
  it('先頭の 0 は仮のまま待ち、次の1文字で1桁の数字として確定する', () => {
    expect(resolveDigit(25, '', '0')).toEqual({ kind: 'WAIT', text: '0' });
    // 0 → 1 で「1」。10 番台を待たずに確定する
    expect(resolveDigit(25, '0', '1')).toEqual({ kind: 'COMMIT', text: '1' });
    expect(resolveDigit(49, '0', '9')).toEqual({ kind: 'COMMIT', text: '9' });
  });

  it('先頭の 0 のあとに、その盤面に無い数字は受け付けない', () => {
    // 4×4 に 7 は無い。仮の 0 は消えずに残る
    expect(resolveDigit(4, '0', '7')).toEqual({ kind: 'IGNORE' });
  });

  it('0 のまま確定させると消去になる（0 を2回でも消える）', () => {
    // 選択を移したときの確定は、呼び出し側が値0＝消去として扱う
    expect(resolveDigit(9, '', '0')).toEqual({ kind: 'WAIT', text: '0' });
    expect(resolveDigit(9, '0', '0')).toEqual({ kind: 'COMMIT', text: '0' });
  });

  it('全サイズで、先頭の1桁は必ず「待つ・即確定・無効」のいずれかに決まる', () => {
    for (const n of BOARD_SIZES) {
      for (let digit = 0; digit <= 9; digit++) {
        const step = resolveDigit(n, '', String(digit));
        expect(['WAIT', 'COMMIT', 'IGNORE'], `${n}×${n} / ${digit}`).toContain(step.kind);
      }
    }
  });
});

// ---------------------------------------------------------------- 数値パレット（8.4）

describe('数値パレットの並び（8.4）', () => {
  it('列数は b の倍数であり、盤面サイズを超えない', () => {
    for (const n of BOARD_SIZES) {
      const b = Math.round(Math.sqrt(n));
      const columns = columnsFor(n, b);
      expect(columns % b, `${n}×${n}`).toBe(0);
      expect(columns, `${n}×${n}`).toBeLessThanOrEqual(n);
    }
  });

  it('1〜N のボタンが並び、使い切った値だけが押せない（C-119 の残数を写す）', () => {
    const exhausted = Array.from({ length: 9 }, (_, i) => i === 2);
    render(
      <NumberPalette n={9} b={3} exhausted={exhausted} noteMode={false} disabled={false} onInput={() => {}} />,
    );

    const keys = screen.getAllByRole('button');
    expect(keys).toHaveLength(9);
    expect(keys[0]).toBeEnabled();
    expect(keys[2]).toBeDisabled();
  });

  it('セルが選ばれていなければ、すべてのボタンが押せない（8.6）', () => {
    render(
      <NumberPalette
        n={4}
        b={2}
        exhausted={[false, false, false, false]}
        noteMode={false}
        disabled
        onInput={() => {}}
      />,
    );
    for (const key of screen.getAllByRole('button')) expect(key).toBeDisabled();
  });

  it('メモ入力中は確定入力と見た目を変える（9.2）', () => {
    const { rerender } = render(
      <NumberPalette n={4} b={2} exhausted={[]} noteMode={false} disabled={false} onInput={() => {}} />,
    );
    expect(screen.getByTestId('palette').className).not.toContain('palette-note');

    rerender(
      <NumberPalette n={4} b={2} exhausted={[]} noteMode disabled={false} onInput={() => {}} />,
    );
    expect(screen.getByTestId('palette').className).toContain('palette-note');
  });
});

// ---------------------------------------------------------------- 操作ボタン（8.6）

describe('操作ボタンの活性条件（8.6 / C-53）', () => {
  const noop = (): void => {};
  const base = {
    noteMode: false,
    canUndo: false,
    canRedo: false,
    canErase: false,
    canInput: true,
    onErase: noop,
    onToggleNoteMode: noop,
    onUndo: noop,
    onRedo: noop,
    onHint: noop,
    onSuspend: noop,
    canTogglePalette: false,
    paletteCollapsed: false,
    onTogglePalette: noop,
  };

  beforeEach(async () => {
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');
  });

  afterEach(cleanup);

  it('Easy ではメモを表示しない。Hard では表示する（C-53）', () => {
    const { rerender } = render(<ActionButtons {...base} difficulty="Easy" />);
    expect(screen.queryByTestId('action-note')).not.toBeInTheDocument();

    rerender(<ActionButtons {...base} difficulty="Hard" />);
    expect(screen.getByTestId('action-note')).toBeInTheDocument();
  });

  it('履歴が空なら取消・やり直しは押せない', () => {
    const { rerender } = render(<ActionButtons {...base} difficulty="Hard" />);
    expect(screen.getByTestId('action-undo')).toBeDisabled();
    expect(screen.getByTestId('action-redo')).toBeDisabled();

    rerender(<ActionButtons {...base} difficulty="Hard" canUndo canRedo />);
    expect(screen.getByTestId('action-undo')).toBeEnabled();
    expect(screen.getByTestId('action-redo')).toBeEnabled();
  });

  it('ヒントは常に押せる。対象外なら押しても何も起きないだけとする（8.6）', () => {
    render(<ActionButtons {...base} difficulty="Hard" canInput={false} />);
    expect(screen.getByTestId('action-hint')).toBeEnabled();
  });
});

// ---------------------------------------------------------------- 画面との配線

const MANIFEST = readData('manifest.json');
const N01_INDEX = readData('n01/index.json');
const N01_CHUNK = readData('n01/c0000.json');
const N09_INDEX = readData('n09/index.json');
const N09_CHUNKS = ['c0000.json', 'c0001.json', 'c0002.json', 'c0003.json'].map((file) => ({
  file: `n09/${file}`,
  body: readData(`n09/${file}`),
}));

function stubFetch(): void {
  const table: Record<string, unknown> = {
    'manifest.json': MANIFEST,
    'n01/index.json': N01_INDEX,
    'n01/c0000.json': N01_CHUNK,
    'n09/index.json': N09_INDEX,
  };
  for (const chunk of N09_CHUNKS) table[chunk.file] = chunk.body;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = Object.keys(table).find((key) => url.endsWith(key));
      if (hit === undefined) return { ok: false, status: 404 } as unknown as Response;
      return { ok: true, status: 200, text: async () => JSON.stringify(table[hit]) } as unknown as Response;
    }),
  );
}

/**
 * 1×1 を1局始める。**在庫は1問で固定値が無く、解が `1` である。**
 * 「1手入れたら完成する」状況を、サイズ固有の細工をせずに作れる。
 */
async function start1x1(): Promise<void> {
  render(<AppShell />);
    answerSoundAsk();
  const size: BoardSize = 1;
  await screen.findByRole('button', { name: `${size}` });
  fireEvent.click(screen.getByRole('button', { name: `${size}` }));
  fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
  await screen.findByTestId('board');
    await settleBoard();
}

/** 数値パレットのボタン */
function paletteKey(value: number): HTMLElement {
  const keys = screen.getByTestId('palette').querySelectorAll('button');
  return keys[value - 1] as HTMLElement;
}

describe('入力の配線（8.3 / 8.5 / U-45）', () => {
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

  it('セルを選ぶまで値は入れられない。矢印キーで選ぶと押せるようになる（8.1 / 8.5）', async () => {
    await start1x1();
    expect(paletteKey(1)).toBeDisabled();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(paletteKey(1)).toBeEnabled();
  });

  it('Esc で選択が外れる（8.3 の「解除は盤面外のタップまたは Esc」）', async () => {
    await start1x1();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(paletteKey(1)).toBeEnabled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(paletteKey(1)).toBeDisabled();
  });

  it('パレットで最後の1マスを埋めると、その場で完成が提示される（U-45）', async () => {
    await start1x1();
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    fireEvent.click(paletteKey(1));

    // セッションを差し替えていないので、段階6 までは気づけなかった経路である
    expect(await screen.findByText('完成しました')).toBeInTheDocument();
  });

  it('キーボードの数字でも同じように入り、完成が提示される（8.5）', async () => {
    await start1x1();
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    fireEvent.keyDown(window, { key: '1' });

    expect(await screen.findByText('完成しました')).toBeInTheDocument();
  });

  it('入れた値は取消で戻り、やり直しで入り直す（7.5 / 8.6）', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await screen.findByRole('button', { name: '9' });
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    await screen.findByTestId('board');
    await settleBoard();

    // **固定セルには入れられない**ので、入力できる升まで右へ進む（8.6）。
    // どの升が固定かは変換で毎回変わるため、位置を決め打ちにしない
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    for (let i = 0; i < 81 && (paletteKey(1) as HTMLButtonElement).disabled; i++) {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }
    expect(paletteKey(1)).toBeEnabled();
    expect(screen.getByTestId('action-undo')).toBeDisabled();

    fireEvent.click(paletteKey(1));
    expect(screen.getByTestId('action-undo')).toBeEnabled();
    // 消去が押せる＝その升に値が入っている（8.6）
    expect(screen.getByTestId('action-erase')).toBeEnabled();

    fireEvent.click(screen.getByTestId('action-undo'));
    expect(screen.getByTestId('action-undo')).toBeDisabled();
    expect(screen.getByTestId('action-erase')).toBeDisabled();
    expect(screen.getByTestId('action-redo')).toBeEnabled();

    fireEvent.click(screen.getByTestId('action-redo'));
    expect(screen.getByTestId('action-erase')).toBeEnabled();
  });

  /**
   * C-183: **打ちかけは時間では確定しない。**
   *
   * 段階7 までは 0.8秒で勝手に確定していたため、25×25 の `1` のように
   * 2桁になりうる数字を落ち着いて打てなかった。確定するのは
   * 「次の桁」「選択の移動」「Enter」のいずれかである。
   */
  it('打ちかけは時間では確定しない。Enter で初めて確定する（C-183 / C-184）', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await screen.findByRole('button', { name: '9' });
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    await screen.findByTestId('board');
    await settleBoard();

    // 入力できる升まで進む。どの升が固定かは変換で毎回変わる
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    for (let i = 0; i < 81 && (paletteKey(1) as HTMLButtonElement).disabled; i++) {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }
    fireEvent.click(paletteKey(1));
    // 消去が押せる＝その升に値が入っている
    expect(screen.getByTestId('action-erase')).toBeEnabled();

    // 先頭の「0」は消去の宣言だが、**押しただけでは確定しない**（C-184）
    fireEvent.keyDown(window, { key: '0' });
    vi.useFakeTimers();
    try {
      // **どれだけ待っても確定しない**（段階7 までは 0.8秒で確定していた）
      act(() => void vi.advanceTimersByTime(10_000));
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId('action-erase')).toBeEnabled();

    // Enter で初めて確定し、そこで消去が起きる
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('action-erase')).toBeDisabled();
  });

  it('ヒントを求めると使えるが、盤面のマスは埋まらない（C-24 / 10.1）', async () => {
    render(<AppShell />);
    answerSoundAsk();
    await screen.findByRole('button', { name: '9' });
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    await screen.findByTestId('board');
    await settleBoard();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    for (let i = 0; i < 81 && (paletteKey(1) as HTMLButtonElement).disabled; i++) {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }

    fireEvent.click(screen.getByTestId('action-hint'));

    // 埋めていないので、消去も取消も対象が無いままである
    expect(screen.getByTestId('action-erase')).toBeDisabled();
    expect(screen.getByTestId('action-undo')).toBeDisabled();
  });
});
