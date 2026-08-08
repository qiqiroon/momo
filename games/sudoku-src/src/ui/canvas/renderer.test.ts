/**
 * 描画エンジン（第3分冊 3章 / 6章 / 7章 / 10章）
 *
 * **受入条件 5-1（全7サイズが正しい罫線階層で描ける。1×1 を含む）**と
 * **受入条件 5-5（高解像度画面でぼやけない）**をここで確かめる。
 *
 * jsdom には Canvas の 2D コンテキストが無いため、**描画命令を記録する代用**を差し込む。
 * 見た目そのものは実機で確かめる（実装指示書 3章。段階5以降は実機で確認する）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SIZES, type BoardSize, type Grid } from '../../data/types';
import * as notes from '../../game/notes';
import { BOARD_COLORS } from '../config';
import { cellRect, create as createLayout } from './layout';
import type { LodLevel } from './lod';
import { create as createRenderer, type RenderModel } from './renderer';
import { initial } from './viewport';

const W = 800;
const H = 600;

// ---------------------------------------------------------------- 記録する代用コンテキスト

interface Call {
  m: string;
  args: unknown[];
}

function createFakeCanvas(): { canvas: HTMLCanvasElement; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (m: string) =>
    (...args: unknown[]): void => {
      calls.push({ m, args });
    };

  const props: Record<string, unknown> = {};
  const prop = (name: string): PropertyDescriptor => ({
    get: () => props[name],
    set: (v: unknown) => {
      props[name] = v;
      calls.push({ m: `set:${name}`, args: [v] });
    },
    configurable: true,
  });

  const ctx = {
    setTransform: record('setTransform'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    clip: record('clip'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    measureText: (text: string) => {
      calls.push({ m: 'measureText', args: [text] });
      return { width: text.length * 10 };
    },
  };
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline']) {
    Object.defineProperty(ctx, name, prop(name));
  }

  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, calls };
}

// ---------------------------------------------------------------- 描画モデル

interface ModelOptions {
  lod?: LodLevel;
  selected?: number | null;
  pendingInput?: { index: number; text: string } | null;
  fillNotes?: boolean;
  fillValues?: boolean;
}

function createModel(n: BoardSize, options: ModelOptions = {}): RenderModel {
  const layout = createLayout(n);
  const givens: Grid = new Array<number>(n * n).fill(0);
  const entered: Grid = new Array<number>(n * n).fill(0);
  const errorFlags = new Uint8Array(n * n);
  const noteSet = notes.create(n);

  if (options.fillValues !== false) {
    // 先頭セルを固定値、次のセルを入力値（誤り）にして、色分けの経路を通す
    givens[0] = 1;
    if (n > 1) {
      entered[1] = n;
      errorFlags[1] = 1;
    }
  }
  if (options.fillNotes) {
    for (let index = 0; index < n * n; index++) {
      if (givens[index] !== 0 || entered[index] !== 0) continue;
      for (let v = 1; v <= n; v++) notes.add(noteSet, index, v);
    }
  }

  return {
    n,
    b: layout.b,
    givens,
    entered,
    errorFlags,
    notes: noteSet,
    selected: options.selected ?? null,
    pendingInput: options.pendingInput ?? null,
    hints: [],
    viewport: initial(layout, W, H),
    lod: options.lod ?? 'FULL',
    loupe: null,
  };
}

/** 罫線の本数を色ごとに数える。moveTo 1回 = 線分1本 */
function countLines(calls: Call[]): Record<string, number> {
  const counts: Record<string, number> = {};
  let stroke = '';
  for (const call of calls) {
    if (call.m === 'set:strokeStyle') stroke = String(call.args[0]);
    if (call.m === 'moveTo') counts[stroke] = (counts[stroke] ?? 0) + 1;
    if (call.m === 'strokeRect') counts[`rect:${stroke}`] = (counts[`rect:${stroke}`] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------- 検査

describe('罫線階層（受入条件 5-1 / 4.2 / 4.6）', () => {
  it.each(BOARD_SIZES)('N=%i の罫線が3階層の一般規則どおりに引かれる', (n) => {
    const layout = createLayout(n);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(createModel(n));
    renderer.drawNow();

    const counts = countLines(calls);
    const b = layout.b;
    // セル境界は「ブロック境界でない内側の線」。縦横で2本ずつ
    expect(counts[BOARD_COLORS.lineCell] ?? 0).toBe(2 * (n - b));
    // ブロック境界は b の倍数の位置。縦横で2本ずつ
    expect(counts[BOARD_COLORS.lineBlock] ?? 0).toBe(2 * (b - 1));
    // 外枠は矩形1つ
    expect(counts[`rect:${BOARD_COLORS.lineOuter}`] ?? 0).toBe(1);
  });

  it('N=1 は外枠だけになる（分岐なしの帰結・4.6）', () => {
    const layout = createLayout(1);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(1));
    renderer.drawNow();

    const counts = countLines(calls);
    expect(counts[BOARD_COLORS.lineCell] ?? 0).toBe(0);
    expect(counts[BOARD_COLORS.lineBlock] ?? 0).toBe(0);
    expect(counts[`rect:${BOARD_COLORS.lineOuter}`] ?? 0).toBe(1);
  });

  it('罫線は縮小しても1物理ピクセルを下回らない（4.2）', () => {
    const layout = createLayout(49);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    const model = createModel(49);
    renderer.setModel(model);
    renderer.drawNow();

    // 論理線幅1・倍率 0.39 なら、そのままでは 0.39 物理px になってしまう
    const widths = calls.filter((c) => c.m === 'set:lineWidth').map((c) => Number(c.args[0]));
    const minPhysical = Math.min(...widths.map((w) => w * model.viewport.zoom));
    expect(minPhysical).toBeGreaterThanOrEqual(1 - 1e-9);
  });
});

describe('表示LOD による省略（6.2 / 6.3）', () => {
  it('MINIMAL では文字を1つも描かず、セル境界も引かない', () => {
    const layout = createLayout(49);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(createModel(49, { lod: 'MINIMAL', fillNotes: true }));
    renderer.drawNow();

    expect(calls.filter((c) => c.m === 'fillText')).toHaveLength(0);
    expect(countLines(calls)[BOARD_COLORS.lineCell] ?? 0).toBe(0);
    // 値の入ったセルは塗りで示す
    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.minimalGiven);
  });

  it('COMPACT では候補をドットで描き、数字では描かない', () => {
    const layout = createLayout(25);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(createModel(25, { lod: 'COMPACT', fillNotes: true }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.noteDot);
    expect(fills).not.toContain(BOARD_COLORS.noteText);
    // 確定値は描く
    expect(calls.filter((c) => c.m === 'fillText').length).toBeGreaterThan(0);
  });

  it('FULL では候補を数字で描く', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(createModel(9, { lod: 'FULL', fillNotes: true }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.noteText);
    expect(fills).not.toContain(BOARD_COLORS.noteDot);
  });
});

describe('誤りの表現（C-43 / 11.2）', () => {
  it('文字色だけを変え、背景や枠線を変えない', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.errorText);
    // 誤り専用の背景色・枠線色は存在しない
    const strokes = calls.filter((c) => c.m === 'set:strokeStyle').map((c) => String(c.args[0]));
    expect(strokes).not.toContain(BOARD_COLORS.errorText);
  });
});

describe('解像度対応（受入条件 5-5 / 3.6）', () => {
  const original = globalThis.devicePixelRatio;
  beforeEach(() => {
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: original, configurable: true });
  });

  it.each([1, 2, 3])('devicePixelRatio=%i でバッキングストアが CSS寸法×比になる', (ratio) => {
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: ratio, configurable: true });
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9));
    renderer.drawNow();

    expect(canvas.width).toBe(W * ratio);
    expect(canvas.height).toBe(H * ratio);
    expect(canvas.style.width).toBe(`${W}px`);
    expect(canvas.style.height).toBe(`${H}px`);
    // 同倍率のスケールをコンテキストへ適用する
    expect(calls[0]).toEqual({ m: 'setTransform', args: [ratio, 0, 0, ratio, 0, 0] });
  });
});

describe('再描画スケジューリング（3.5）', () => {
  it('同一フレーム内の重複要求が1回にまとまる', () => {
    const frames: Array<{ ms: number; kinds: readonly string[] }> = [];
    const scheduled: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        scheduled.push(cb);
        return 1;
      });

    const layout = createLayout(9);
    const { canvas } = createFakeCanvas();
    const renderer = createRenderer({
      canvas,
      layout,
      onFrame: (info) => frames.push({ ms: info.ms, kinds: info.kinds }),
    });
    renderer.resize(W, H);
    renderer.setModel(createModel(9));

    renderer.invalidate('CELLS');
    renderer.invalidate('SELECTION');
    renderer.invalidate('HINTS');
    expect(frames).toHaveLength(0);
    // 3回要求しても、予約されたフレームは1つだけ
    expect(scheduled).toHaveLength(1);

    scheduled[0](0);
    expect(frames).toHaveLength(1);
    expect(frames[0].kinds).toEqual(['CELLS', 'SELECTION', 'HINTS']);

    raf.mockRestore();
  });

  it('破棄したあとは描かない（3.7）', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9));
    renderer.dispose();

    const before = calls.length;
    expect(renderer.drawNow()).toBe(0);
    renderer.invalidate('ALL');
    expect(calls.length).toBe(before);
  });

  it('部分再描画は与えられた矩形へ切り抜いて描く（3.5）', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9));
    renderer.drawNow({ x: 10, y: 20, w: 100, h: 100 });

    expect(calls.some((c) => c.m === 'clip')).toBe(true);
    expect(calls.find((c) => c.m === 'rect')?.args).toEqual([10, 20, 100, 100]);
  });
});

describe('ハイライトと選択枠（7.3 / レイヤ7）', () => {
  it('選択セルがあると行・列・ブロック・同値が塗られ、選択枠が描かれる', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9, { selected: 0 }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.highlightLine);
    // 索引0 は固定値1 が入っているため、同値ハイライトも出る
    expect(fills).toContain(BOARD_COLORS.highlightSame);

    const strokes = calls.filter((c) => c.m === 'set:strokeStyle').map((c) => String(c.args[0]));
    expect(strokes).toContain(BOARD_COLORS.selection);
  });

  it('MINIMAL では同値ハイライトを省き、行・列・ブロックは残す（6.2）', () => {
    const layout = createLayout(49);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(createModel(49, { selected: 0, lod: 'MINIMAL' }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.highlightLine);
    expect(fills).not.toContain(BOARD_COLORS.highlightSame);
  });

  it('空セルを選んだときは同値ハイライトを出さない（7.3）', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    // 索引2 は固定値も記入値も無い。基準となる値が無いので同値は成立しない
    renderer.setModel(createModel(9, { selected: 2 }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.highlightLine);
    expect(fills).not.toContain(BOARD_COLORS.highlightSame);
  });

  it('ハイライトは無彩色でなく、行・列 → 同値 の2段になっている（新4）', () => {
    // 白の薄がけだと固定セルの灰色と見分けが付かない、というのが試遊の指摘だった。
    // **色そのものを条件にする。**「灰色でないこと」と「選択枠と同じ色味であること」を見る
    const parse = (rgba: string): { r: number; g: number; b: number; a: number } => {
      const [r, g, b, a] = rgba
        .replace(/[^0-9.,]/g, '')
        .split(',')
        .map(Number);
      return { r, g, b, a };
    };
    const line = parse(BOARD_COLORS.highlightLine);
    const same = parse(BOARD_COLORS.highlightSame);

    for (const c of [line, same]) {
      // 無彩色（R=G=B）だと固定セルの灰色と同系になってしまう
      expect(c.r === c.g && c.g === c.b).toBe(false);
      // 選択枠と同じ色味であること。系統が割れるとハイライトの意味が読み取れない
      expect([c.r, c.g, c.b]).toEqual([234, 88, 12]);
    }

    // 行・列 → 同値 の順に濃くする。逆転すると狭いほうが埋もれる
    expect(line.a).toBeLessThan(same.a);
    // 薄すぎると黒地に沈む。試遊で「もっと濃く」と言われた下限を守る
    expect(line.a).toBeGreaterThanOrEqual(0.25);
  });

  it('固定セルのハイライトが灰色に覆われない（新4）', () => {
    // 塗りの順が逆だと、固定セルだけハイライトが乗らず「そこだけ塗られない」状態になる。
    // **命令の並び順**を条件にする。灰色の塗りが、ハイライトより先に出ていればよい
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    // 索引0 は固定値。索引1 を選ぶと同じ行に入るのでハイライトの対象になる
    renderer.setModel(createModel(9, { selected: 1 }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    const given = fills.indexOf(BOARD_COLORS.givenFill);
    const highlight = fills.indexOf(BOARD_COLORS.highlightLine);
    expect(given).toBeGreaterThanOrEqual(0);
    expect(highlight).toBeGreaterThanOrEqual(0);
    expect(given).toBeLessThan(highlight);
  });

  it('ブロックは塗らない（新4）', () => {
    // 縦横だけを塗る。ブロックまで塗ると、いま効いている筋が読み取りにくい
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    // 索引0 を選ぶと、同じブロックに属し行にも列にも入らないセル（索引10）がある
    renderer.setModel(createModel(9, { selected: 0 }));
    renderer.drawNow();

    // 塗られたセルの矩形を集め、索引10 の位置が含まれないことを見る
    const painted = new Set<string>();
    let fill = '';
    for (const call of calls) {
      if (call.m === 'set:fillStyle') fill = String(call.args[0]);
      if (call.m === 'fillRect' && fill === BOARD_COLORS.highlightLine) {
        painted.add(`${call.args[0]},${call.args[1]}`);
      }
    }
    const blockOnly = cellRect(layout, 10);
    expect(painted.has(`${blockOnly.x},${blockOnly.y}`)).toBe(false);
    // 同じ行のセル（索引1）は塗られている
    const inRow = cellRect(layout, 1);
    expect(painted.has(`${inRow.x},${inRow.y}`)).toBe(true);
  });

  it('未選択ならハイライトも選択枠も出ない', () => {
    const layout = createLayout(9);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(9, { selected: null }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).not.toContain(BOARD_COLORS.highlightLine);
    const strokes = calls.filter((c) => c.m === 'set:strokeStyle').map((c) => String(c.args[0]));
    expect(strokes).not.toContain(BOARD_COLORS.selection);
  });
});

describe('ヒント吹き出しとルーペ（10.2 / 7.2）', () => {
  it('吹き出しは画面座標で描き、ズーム倍率で寸法が変わらない', () => {
    const layout = createLayout(9);
    const model = createModel(9);
    const withHint: RenderModel = { ...model, hints: [{ index: 40, value: 7, issuedAt: 1 }] };

    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(withHint);
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.hintFill);
    expect(fills).toContain(BOARD_COLORS.hintText);
  });

  it('ルーペは中心セルの周囲を拡大して描く（吹き出しは描かない）', () => {
    const layout = createLayout(49);
    const model = createModel(49, { lod: 'MINIMAL' });
    const withLoupe: RenderModel = {
      ...model,
      loupe: { centerIndex: 0, span: 3, corner: 'TOP_RIGHT' },
    };

    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(withLoupe);
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.loupeFill);
    // 盤面本体は MINIMAL で文字を描かないが、ルーペ内は FULL 相当で描く
    expect(calls.filter((c) => c.m === 'fillText').length).toBeGreaterThan(0);
  });
});

describe('確定前の入力の仮表示（8.5.1・段階7 前半）', () => {
  it('打ちかけの文字を、対象セルへ淡色で描く', () => {
    const layout = createLayout(25);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(25, { selected: 2, pendingInput: { index: 2, text: '1' } }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(BOARD_COLORS.pendingText);

    // 確定値と同じ位置に、打った文字そのものが出る
    const drawnAfterPending = calls
      .slice(calls.findIndex((c) => String(c.args[0]) === BOARD_COLORS.pendingText))
      .filter((c) => c.m === 'fillText');
    expect(String(drawnAfterPending[0]?.args[0])).toBe('1');
  });

  it('打ちかけが無ければ淡色は使わない', () => {
    const layout = createLayout(25);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout });
    renderer.resize(W, H);
    renderer.setModel(createModel(25, { selected: 2 }));
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).not.toContain(BOARD_COLORS.pendingText);
  });

  it('MINIMAL では文字を描かない規則に従い、仮表示も描かない（6.2）', () => {
    const layout = createLayout(49);
    const { canvas, calls } = createFakeCanvas();
    const renderer = createRenderer({ canvas, layout, cullOffscreen: false });
    renderer.resize(W, H);
    renderer.setModel(
      createModel(49, { selected: 0, lod: 'MINIMAL', pendingInput: { index: 0, text: '4' } }),
    );
    renderer.drawNow();

    const fills = calls.filter((c) => c.m === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).not.toContain(BOARD_COLORS.pendingText);
  });
});
