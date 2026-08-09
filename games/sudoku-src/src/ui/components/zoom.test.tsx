/**
 * 段階7 後半（ズーム・パン／ルーペ／パレットの二段構え）の検査。
 *
 * jsdom には配置計算が無く、矩形はすべて 0 になる。**寸法を要する検査だけ**、
 * 要素の見かけの矩形を差し替えてから確かめる（画面の実寸から出る帰結を見たいため）。
 * 見た目そのもの（描かれた絵）は実機で確かめる。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { settleBoard, answerSoundAsk } from '../../test/settle';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SIZES, LOUPE_CORNERS, type BoardSize } from '../../data/types';
import { resetInFlight } from '../../data/fetchJson';
import { indexLoader } from '../../data/indexLoader';
import { setLocale } from '../../i18n/locale';
import { readData } from '../../test/fixtures';
import { create as createLayout } from '../canvas/layout';
import { chooseLoupeCorner, loupeRect, test as hitTest } from '../canvas/hitTest';
import { initial as initialViewport } from '../canvas/viewport';
import { LOUPE_BOX_PX, LOUPE_MARGIN_PX, PALETTE_MAX_HEIGHT_RATIO } from '../config';
import { AppShell } from './AppShell';
import {
  canFlipOverlay,
  ControlPanel,
  decidePlacement,
  hiddenByOverlay,
  needsTwoStage,
  rightPanelWidth,
} from './ControlPanel';
import { keyPxOf, paletteMetrics, paletteMetricsForHeight } from './NumberPalette';
import { fromSlider, toSlider } from './ZoomBar';

// ---------------------------------------------------------------- スライダの目盛り（5.5）

describe('ズームスライダの目盛り（5.5）', () => {
  it('両端がちょうど下限・上限に対応する', () => {
    expect(toSlider(1, 1, 8)).toBe(0);
    expect(toSlider(8, 1, 8)).toBe(100);
    expect(fromSlider(0, 1, 8)).toBeCloseTo(1, 10);
    expect(fromSlider(100, 1, 8)).toBeCloseTo(8, 10);
  });

  it('対数スケールである＝真ん中の目盛りが下限と上限の相乗平均になる', () => {
    // 線形なら (1+8)/2 = 4.5 になる。倍率は掛け算で変わるので相乗平均が正しい
    expect(fromSlider(50, 1, 8)).toBeCloseTo(Math.sqrt(8), 10);
  });

  it('目盛りと倍率が往復しても崩れない', () => {
    for (const zoom of [1, 1.7, 3, 5.5, 8]) {
      expect(fromSlider(toSlider(zoom, 1, 8), 1, 8)).toBeCloseTo(zoom, 1);
    }
  });

  it('ズームできない（下限＝上限）ときは下限を返し、0除算にならない', () => {
    expect(toSlider(2, 2, 2)).toBe(0);
    expect(fromSlider(50, 2, 2)).toBe(2);
  });
});

// ---------------------------------------------------------------- パレットの二段構え（U-46 / C-159）

describe('パレットが二段構えに入る条件（8.4 / U-46 / C-159）', () => {
  const WIDTH = 343; // 幅375px の画面（左右余白16px）
  const HEIGHT = 667;

  it('44px を守った実寸は V-14 の計測どおりになる', () => {
    expect(paletteMetrics(9, 3, WIDTH).heightPx).toBe(94);
    expect(paletteMetrics(16, 4, WIDTH).heightPx).toBe(144);
    expect(paletteMetrics(25, 5, WIDTH).heightPx).toBe(244);
    expect(paletteMetrics(36, 6, WIDTH).heightPx).toBe(294);
    expect(paletteMetrics(49, 7, WIDTH).heightPx).toBe(444);
  });

  /**
   * パレット以外の部分（ズームバー・操作ボタン・余白）の実寸。
   * 幅375px の実機で 4×4 から 25×25 まで一定して 171px だった（2026-08-07 の採寸）。
   */
  const CHROME = 171;

  const twoStageBottom = (n: BoardSize, windowHeight = HEIGHT): boolean =>
    needsTwoStage(n, Math.round(Math.sqrt(n)), 'BOTTOM', WIDTH, CHROME, windowHeight);

  it('パネル全体で判じる。9×9 までは常時表示、16×16 からは二段構えに入る（C-166）', () => {
    // 段階7 まではパレットだけを見ていたため 25×25 も常時表示になり、盤面が 151px しか残らなかった
    expect([1, 4, 9].map((n) => twoStageBottom(n as BoardSize))).toEqual([false, false, false]);
    expect([16, 25, 36, 49].map((n) => twoStageBottom(n as BoardSize))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('同じ 25×25 でも、画面が高ければ常時表示に戻る＝N による分岐ではない（B-6）', () => {
    // 244 + 171 = 415px が収まる高さがあれば常時表示でよい
    expect(twoStageBottom(25, 415 / PALETTE_MAX_HEIGHT_RATIO + 1)).toBe(false);
    expect(twoStageBottom(25, 415 / PALETTE_MAX_HEIGHT_RATIO - 1)).toBe(true);
  });

  it('寸法がまだ測れていないあいだは常時表示から始める（描画前の1回）', () => {
    for (const n of BOARD_SIZES) {
      const b = Math.round(Math.sqrt(n));
      expect(needsTwoStage(n, b, 'BOTTOM', 0, CHROME, HEIGHT), `${n}×${n}`).toBe(false);
      expect(needsTwoStage(n, b, 'RIGHT', 0, CHROME, WIDTH), `${n}×${n}`).toBe(false);
    }
  });

  it('右置きでは幅と比べる。向きが入れ替わるだけで規則は同じである（C-166）', () => {
    // 横1280px・パレットに使える高さ 500px なら、25×25 は 5列（274px）で収まる
    const wide = needsTwoStage(25, 5, 'RIGHT', 500, 24, 1280);
    expect(wide).toBe(false);
    // 横667px の小さな横画面では、同じ 25×25 が上限を超えるので二段構えに入る
    const narrow = needsTwoStage(25, 5, 'RIGHT', 120, 24, 667);
    expect(narrow).toBe(true);
  });
});

// ------------------------------------------- 拡大したパレットが選んだマスを避ける（ユーザー指示）

describe('拡大した数字ボタンは選んだマスを避ける', () => {
  const layout = createLayout(9);
  /** 盤面 360px・パネルの上段 100px・帯の高さ 260px → 盤面へかかるのは 160px */
  const VIEW_H = 360;
  const UPPER_H = 100;
  const OVERLAY_H = 260;
  const viewport = { zoom: 1, offsetX: 0, offsetY: 0, width: 360, height: VIEW_H };

  it('盤面の下のほうを選んでいると隠れると判じる', () => {
    // 9×9 の最下行。盤面の下 160px にかかる
    expect(hiddenByOverlay(viewport, layout, 76, OVERLAY_H, UPPER_H)).toBe(true);
  });

  it('盤面の上のほうを選んでいるときは隠れない', () => {
    expect(hiddenByOverlay(viewport, layout, 4, OVERLAY_H, UPPER_H)).toBe(false);
  });

  it('未選択のときは隠れようがない', () => {
    expect(hiddenByOverlay(viewport, layout, null, OVERLAY_H, UPPER_H)).toBe(false);
  });

  it('帯がパネルの中に収まっていれば盤面へはかからない', () => {
    expect(hiddenByOverlay(viewport, layout, 76, UPPER_H, UPPER_H)).toBe(false);
  });

  it('上へ逃がしてもルーペの帯が残るときだけ動かす（無理ならかぶってよい）', () => {
    // 盤面 360px、ルーペの帯 160px → 200px までなら逃がせる
    expect(canFlipOverlay(VIEW_H, 200)).toBe(true);
    expect(canFlipOverlay(VIEW_H, 240)).toBe(false);
  });

  it('N を引数に取らない＝サイズ固有の分岐が入り込む余地が無い（B-6）', () => {
    expect(canFlipOverlay.length).toBe(2);
  });
});

// ---------------------------------------------------------------- 置き場所（C-166）

describe('操作パネルの置き場所は画面の縦横比だけで決まる（C-166）', () => {
  it('横長なら右、縦長なら下', () => {
    expect(decidePlacement(667, 375)).toBe('RIGHT');
    expect(decidePlacement(375, 667)).toBe('BOTTOM');
    expect(decidePlacement(1280, 720)).toBe('RIGHT');
  });

  it('正方形は下置きとする（縦の器のまま扱う）', () => {
    expect(decidePlacement(500, 500)).toBe('BOTTOM');
  });

  it('N を引数に取らない＝サイズ固有の分岐が入り込む余地が無い（B-6）', () => {
    expect(decidePlacement.length).toBe(2);
  });
});

describe('右置きでは高さから列数が決まる（C-166）', () => {
  it('高さに余裕があれば b の倍数のうち細いものを選ぶ', () => {
    // 25 値・5行（244px）が収まるなら 5列＝274px の細い帯で済む
    expect(paletteMetricsForHeight(25, 5, 300)).toEqual({
      columns: 5,
      rows: 5,
      widthPx: 244,
      heightPx: 244,
    });
  });

  it('帯の幅には下限がある。1×1 でもズームバーが読める（C-166）', () => {
    expect(rightPanelWidth(paletteMetricsForHeight(1, 1, 300).widthPx)).toBe(220);
    expect(rightPanelWidth(paletteMetricsForHeight(25, 5, 300).widthPx)).toBe(268);
  });

  it('高さが足りなければ列を増やす（そのぶん帯は太くなる）', () => {
    expect(paletteMetricsForHeight(25, 5, 150).columns).toBe(10);
  });

  it('どの列数でも収まらないときは推奨列数まで広げる', () => {
    expect(paletteMetricsForHeight(25, 5, 10).columns).toBe(10);
  });
});

describe('二段構えの見え方（C-159）', () => {
  const layout = createLayout(49);
  const viewport = initialViewport(layout, 375, 400);
  const noop = (): void => {};
  const base = {
    n: 49 as BoardSize,
    b: 7,
    difficulty: 'Hard' as const,
    exhausted: Array.from({ length: 49 }, () => false),
    noteMode: false,
    canUndo: false,
    canRedo: false,
    selectedIsGiven: false,
    selectedHasValue: false,
    selectedHasNotes: false,
    viewport,
    layout,
    onInput: noop,
    onErase: noop,
    onToggleNoteMode: noop,
    onUndo: noop,
    onRedo: noop,
    onHint: noop,
    onSuspend: noop,
    onZoom: noop,
    paletteScale: 1,
    onCoveringChange: noop,
    paletteCollapsed: false,
    onTogglePaletteCollapsed: noop,
  };

  /** 操作パネルの実寸だけ実機並みに見せる。jsdom は矩形をすべて 0 にするため */
  let restoreRect: (() => void) | null = null;

  beforeEach(async () => {
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');

    // jsdom の既定は 1024×768 の横長で、そのままだと右置きになる。
    // ここで確かめたいのは下置きのせり上がりなので、縦画面に見せる（C-166）
    window.innerWidth = 375;
    window.innerHeight = 667;

    const original = Element.prototype.getBoundingClientRect;
    const fake = (width: number, height: number): DOMRect =>
      ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element): DOMRect {
      // パレットだけの置き場。こことパネル全体の差が「パレット以外の部分」になる（C-166）
      if (this.classList.contains('palette-slot')) return fake(359, 150);
      if (this.classList.contains('panel-upper')) return fake(359, 192);
      // パレット以外の部分（171px）を足したパネル全体
      if (this.classList.contains('control-panel')) return fake(375, 321);
      return original.call(this);
    };
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = original;
      window.innerWidth = 1024;
      window.innerHeight = 768;
    };
  });

  afterEach(() => {
    cleanup();
    restoreRect?.();
  });

  it('未選択のあいだは縮んだ姿だけを出す（盤面を広く見せる）', () => {
    render(<ControlPanel {...base} selected={null} />);
    expect(screen.getByTestId('palette-mini')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-overlay')).not.toBeInTheDocument();
  });

  it('縮んだ姿のボタンは押せない。入力先が無いためである', () => {
    render(<ControlPanel {...base} selected={null} />);
    const keys = screen.getByTestId('palette-mini').querySelectorAll('button');
    expect(keys).toHaveLength(49);
    for (const key of keys) expect(key).toBeDisabled();
  });

  it('セルを選ぶと、44px を守った姿がせり上がって押せるようになる', () => {
    render(<ControlPanel {...base} selected={10} />);
    const overlay = screen.getByTestId('palette-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay.querySelectorAll('button:not(:disabled)')).toHaveLength(49);
  });

  it('せり上がった姿は、ルーペの帯だけを必ず残す（承認済みの手当て）', () => {
    render(<ControlPanel {...base} selected={10} />);
    const overlay = screen.getByTestId('palette-overlay');
    // 盤面領域400px ＋ 自分の領域192px から、ルーペの帯（160px）を引いた残り
    expect(overlay.style.maxHeight).toBe('432px');
  });

  it('固定セルを選んだだけでは広がらない。入力できないからである（8.6）', () => {
    render(<ControlPanel {...base} selected={10} selectedIsGiven />);
    expect(screen.queryByTestId('palette-overlay')).not.toBeInTheDocument();
  });

  it('手で縮めているあいだは、セルを選んでいてもせり上がらない（C-204）', () => {
    render(<ControlPanel {...base} selected={10} paletteCollapsed />);
    expect(screen.queryByTestId('palette-overlay')).not.toBeInTheDocument();
    // 縮んだ姿は残る。**残数の一覧としては役に立つ**ためである
    expect(screen.getByTestId('palette-mini')).toBeInTheDocument();
  });

  it('縮める／戻すボタンは、二段構えのときだけ出る（C-204）', () => {
    render(<ControlPanel {...base} selected={10} />);
    expect(screen.getByTestId('action-palette')).toBeInTheDocument();

    cleanup();
    const small = createLayout(9);
    render(
      <ControlPanel
        {...base}
        n={9}
        b={3}
        exhausted={new Array(9).fill(false)}
        layout={small}
        viewport={initialViewport(small, 375, 400)}
        selected={10}
      />,
    );
    expect(screen.queryByTestId('action-palette')).not.toBeInTheDocument();
  });

  it('ボタンの文字は、いまの姿の逆（次にどうなるか）を示す（C-204）', () => {
    const { rerender } = render(<ControlPanel {...base} selected={10} />);
    expect(screen.getByTestId('action-palette')).toHaveTextContent('数字を縮める');

    rerender(<ControlPanel {...base} selected={10} paletteCollapsed />);
    expect(screen.getByTestId('action-palette')).toHaveTextContent('数字を戻す');
  });

  it('大きさを決めている最中は、手で縮めていても見せる（C-190 が優先・C-204）', () => {
    // いま何を決めているのかが見えないと、決めようがない
    render(<ControlPanel {...base} selected={null} paletteCollapsed sizePreview />);
    expect(screen.getByTestId('palette-overlay')).toBeInTheDocument();
  });

  it('二段構えに入らないサイズでは、縮んだ姿もせり上がりも現れない', () => {
    const small = createLayout(9);
    render(
      <ControlPanel
        {...base}
        n={9}
        b={3}
        exhausted={Array.from({ length: 9 }, () => false)}
        layout={small}
        viewport={initialViewport(small, 375, 400)}
        selected={10}
      />,
    );
    expect(screen.queryByTestId('palette-mini')).not.toBeInTheDocument();
    expect(screen.queryByTestId('palette-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('palette')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- ルーペ（7.1 / 7.2）

describe('ルーペの領域（7.2 / C-185・C-186）', () => {
  const layout = createLayout(49);
  const viewport = initialViewport(layout, 375, 500);
  const loupe = { corner: 'TOP_RIGHT' as const };

  it('四隅のどれにも置ける。箱の大きさは盤面サイズによらず一定である', () => {
    const s = LOUPE_BOX_PX;
    const m = LOUPE_MARGIN_PX;
    expect(loupeRect({ corner: 'TOP_LEFT' }, 375, 500)).toEqual({ x: m, y: m, w: s, h: s });
    expect(loupeRect({ corner: 'TOP_RIGHT' }, 375, 500)).toEqual({ x: 375 - s - m, y: m, w: s, h: s });
    expect(loupeRect({ corner: 'BOTTOM_LEFT' }, 375, 500)).toEqual({ x: m, y: 500 - s - m, w: s, h: s });
    expect(loupeRect({ corner: 'BOTTOM_RIGHT' }, 375, 500)).toEqual({
      x: 375 - s - m,
      y: 500 - s - m,
      w: s,
      h: s,
    });
  });

  it('上下左右が反対の角どうしは重ならない（携帯縦の盤面領域で確かめる）', () => {
    const top = loupeRect({ corner: 'TOP_RIGHT' }, 343, 343);
    const bottom = loupeRect({ corner: 'BOTTOM_RIGHT' }, 343, 343);
    expect(top.y + top.h).toBeLessThanOrEqual(bottom.y);
  });

  it('ルーペの上を押しても、裏にあるセルは選ばれない（表示専用）', () => {
    const rect = loupeRect(loupe, viewport.width, viewport.height);
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;

    // ルーペが無ければ、そこは盤面のセルである
    expect(hitTest(x, y, layout, viewport, [], null).kind).toBe('CELL');
    // ルーペがあれば透過しない
    expect(hitTest(x, y, layout, viewport, [], loupe).kind).toBe('NONE');
  });

  it('ルーペの外はこれまでどおりセルとして判定される', () => {
    const rect = loupeRect(loupe, viewport.width, viewport.height);
    const below = hitTest(rect.x + rect.w / 2, rect.y + rect.h + 20, layout, viewport, [], loupe);
    expect(below.kind).toBe('CELL');
  });
});

// ---------------------------------------------------------------- 画面との配線

const MANIFEST = readData('manifest.json');
const N09_INDEX = readData('n09/index.json');
const N09_CHUNKS = ['c0000.json', 'c0001.json', 'c0002.json', 'c0003.json'].map((file) => ({
  file: `n09/${file}`,
  body: readData(`n09/${file}`),
}));

function stubFetch(): void {
  const table: Record<string, unknown> = {
    'manifest.json': MANIFEST,
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

describe('ズーム操作の配線（5.5 / 受入 7-2）', () => {
  let restoreRect: (() => void) | null = null;

  beforeEach(async () => {
    resetInFlight();
    indexLoader.invalidate();
    localStorage.clear();
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');
    stubFetch();

    // 盤面領域に実機並みの寸法を与える。これが無いと倍率が動かせる余地が生まれない
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element): DOMRect {
      // 実際に測っているのは帯を除いた内枠である（C-165）
      if (this.classList.contains('board-frame') || this.classList.contains('board-host')) {
        return { width: 360, height: 360, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 360, toJSON: () => ({}) } as DOMRect;
      }
      return original.call(this);
    };
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = original;
    };
  });

  afterEach(() => {
    cleanup();
    restoreRect?.();
    vi.unstubAllGlobals();
  });

  async function start9x9(): Promise<void> {
    render(<AppShell />);
    answerSoundAsk();
    await screen.findByRole('button', { name: '9' });
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
    await screen.findByTestId('board');
    await settleBoard();
  }

  it('操作パネルの最上段にズームバーが出る（C-52 の集約）', async () => {
    await start9x9();
    expect(screen.getByTestId('zoom-bar')).toBeInTheDocument();
  });

  it('＋ で倍率が上がり、「全体」で盤面全体へ戻る（5.5）', async () => {
    await start9x9();
    const slider = screen.getByTestId('zoom-slider') as HTMLInputElement;
    const whole = Number(slider.value); // 初期倍率は盤面全体（C-48）

    fireEvent.click(screen.getByRole('button', { name: '拡大' }));
    expect(Number(slider.value)).toBeGreaterThan(whole);

    fireEvent.click(screen.getByRole('button', { name: '全体' }));
    expect(Number(slider.value)).toBe(whole);
  });

  it('「全体」より さらに縮小もできる（C-167）', async () => {
    // 段階7 までは盤面全体が下限で、それ以上は縮小できなかった
    await start9x9();
    const slider = screen.getByTestId('zoom-slider') as HTMLInputElement;
    const whole = Number(slider.value);
    expect(whole).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '縮小' }));
    expect(Number(slider.value)).toBeLessThan(whole);
  });

  it('盤面の上のホイールは、Ctrl を押しているときだけ拡大縮小になる（C-167）', async () => {
    await start9x9();
    const board = screen.getByTestId('board');

    const plain = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    board.dispatchEvent(plain);
    // 受け取らない＝ブラウザ本来の動きに任せる
    expect(plain.defaultPrevented).toBe(false);

    const withCtrl = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    board.dispatchEvent(withCtrl);
    expect(withCtrl.defaultPrevented).toBe(true);
  });

  it('倍率は fit倍率に対する比として保存される（5.3）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await start9x9();
      fireEvent.click(screen.getByRole('button', { name: '拡大' }));
      // 保存は待ってから1回だけ走る（操作中は書かない）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const saved = JSON.parse(localStorage.getItem('momo.sudoku.settings') ?? '{}');
      // 絶対倍率ではなく「盤面全体が入る倍率」に対する比なので、1.0 を超えた値になる。
      // 1目盛りぶんの大きさは盤面領域の実寸で決まるため（C-167）、上側は緩く見る
      expect(saved.zoomPreference).toBeGreaterThan(1);
      expect(saved.zoomPreference).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * ルーペが拡大パレットを避ける規則（C-185）
 *
 * **左右は必ず保つ。** 「右上」を選んだ人にとって、隠れたからといって左へ飛ぶのは
 * 探す手間そのものであり、角を固定した意味が消える。
 * パレットが覆うのは横一本の帯なので、避けられるのは上下の入れ替えだけである。
 */
/**
 * ルーペの逃がし方（C-191）
 *
 * **ふだんは設定した角。** 数字ボタンに覆われるときだけ、覆われ方がいちばん少ない角へ逃げる。
 * あわせて**映しているマス自身は隠さない**。
 */
describe('ルーペの逃がし方（C-191）', () => {
  const W = 343;
  const H = 500;

  it('覆われていなければ、設定した角のまま動かない', () => {
    for (const corner of LOUPE_CORNERS) {
      expect(chooseLoupeCorner(corner, W, H, null, null)).toBe(corner);
    }
  });

  it('覆われている側からは逃げる', () => {
    // 下から 200px ぶん覆われている
    const cover = { x: 0, y: H - 200, w: W, h: 200 };
    expect(chooseLoupeCorner('BOTTOM_RIGHT', W, H, cover, null)).not.toBe('BOTTOM_RIGHT');
    // 上の角は覆われていないので動かない
    expect(chooseLoupeCorner('TOP_RIGHT', W, H, cover, null)).toBe('TOP_RIGHT');
  });

  /**
   * C-197: **横長の画面では数字ボタンが右へ出る。** 帯は縦一本になり、右の角を覆う。
   *
   * 段階7 では「右置きなら上下が空いたままなので知らせることが無い」としていたが、
   * ルーペを四隅へ置くようにして前提が崩れた。実機の記録に「覆い なし」と出て判明した。
   */
  it('右へ出た帯からは、左の角へ逃げる', () => {
    // 右から 300px ぶん覆われている（横長画面の拡大した数字ボタン）
    const cover = { x: W - 300, y: 0, w: 300, h: H };
    expect(chooseLoupeCorner('TOP_RIGHT', W, H, cover, null)).toBe('TOP_LEFT');
    expect(chooseLoupeCorner('BOTTOM_RIGHT', W, H, cover, null)).toBe('TOP_LEFT');
    // 左の角は覆われていないので動かない
    expect(chooseLoupeCorner('TOP_LEFT', W, H, cover, null)).toBe('TOP_LEFT');
    expect(chooseLoupeCorner('BOTTOM_LEFT', W, H, cover, null)).toBe('BOTTOM_LEFT');
  });

  it('映しているマスを隠す角は選ばない', () => {
    // 右上のマスを映している。そこへ箱を置くと隠してしまう
    const target = loupeRect({ corner: 'TOP_RIGHT' }, W, H);
    const chosen = chooseLoupeCorner('TOP_RIGHT', W, H, null, target);
    expect(chosen).not.toBe('TOP_RIGHT');
  });

  it('どこも覆われていて逃げ場が無いときは、設定した角に留まる', () => {
    // 画面いっぱいが覆われている＝どの角も同じだけ覆われる
    const cover = { x: 0, y: 0, w: W, h: H };
    for (const corner of LOUPE_CORNERS) {
      expect(chooseLoupeCorner(corner, W, H, cover, null)).toBe(corner);
    }
  });
});

describe('数字ボタンの大きさ（C-190）', () => {
  it('倍率をかけた寸法になる。1 なら仕様書どおりの 44px', () => {
    expect(keyPxOf(1)).toBe(44);
    expect(keyPxOf(2)).toBe(88);
    expect(keyPxOf(0.5)).toBe(22);
  });

  it('**触れないほど小さくもできる**（利用者が自分で下げるぶんには止めない）', () => {
    expect(keyPxOf(0.4)).toBeLessThan(44);
    // ただし 0 にはしない。押しようが無くなると戻せなくなる
    expect(keyPxOf(0.0001)).toBeGreaterThan(0);
  });

  it('大きくすると二段構えに入る＝手の大小と自動判定が地続きである', () => {
    const small = needsTwoStage(9, 3, 'BOTTOM', 343, 171, 667, keyPxOf(0.4));
    const large = needsTwoStage(9, 3, 'BOTTOM', 343, 171, 667, keyPxOf(3));
    expect(small).toBe(false);
    expect(large).toBe(true);
  });
});
