// 操作パネル（設計 04 §6・05 §3）。ボタンは <button>、手は panelModel が作る（キーと同じ関数を通す）
import type { Face, Move } from '../core/types';
import { keyHint, type KeyAction, type Keymap } from '../input/keymap';
import type { MiddleSlice, Variant } from '../input/screenMoves';
import type { ViewCommand } from '../input/viewController';
import type { ViewFrame } from '../input/viewFrame';
import {
  clampLayer, depthChoices, MOTION_ICON, motionOf, PANEL_FACES, panelFaceMove, panelMiddleMove, panelWholeCommand,
  showMiddle, VARIANTS, type LayerChoice, type Motion,
} from './panelModel';
import { S } from './strings';

export interface PanelDeps {
  getSize: () => number;
  getFrame: () => ViewFrame;
  getKeymap: () => Keymap;
  move: (move: Move) => boolean;
  view: (command: ViewCommand) => void;
  home: () => void;
  scramble: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  openKeymap: () => void;
  openSettings: () => void;
  /** 次の 1 手を教える */
  hint: () => void;
  /** 自動でそろえる（動いている間は止める） */
  solve: () => void;
  /** 層を示す（null で消す） */
  highlight: (move: Move | null) => void;
  /** 層の選択が変わった（HUD の表示用） */
  layerChanged: () => void;
}

export interface PanelState {
  canUndo: boolean;
  canRedo: boolean;
  canScramble: boolean;
  canReset: boolean;
  /** そろっていない（教える手がある） */
  canHint: boolean;
  /** 自動でそろえている最中 */
  solving: boolean;
}

const SHAKE_MS = 120;

export class ControlPanel {
  private readonly deps: PanelDeps;
  private layer: LayerChoice = { depth: 1, wide: false };
  private lastFace: Face = 'R';
  private n = 0;
  private readonly gameButtons: Record<
    'scramble' | 'reset' | 'undo' | 'redo' | 'hint' | 'solve' | 'home' | 'keys' | 'settings' | 'wholeToggle',
    HTMLButtonElement
  >;
  private solving = false;
  private readonly layerRow: HTMLElement;
  private readonly faceRow: HTMLElement;
  private readonly middleRow: HTMLElement;
  private readonly wholeRow: HTMLElement;
  /** 狭い画面の 1 段目：回す面を選ぶ（05 §1.1）。2 段目は選んだ面の 3 ボタンだけを見せる */
  private readonly pickerRow: HTMLElement;
  private picked = 'R';
  private lastPressed: HTMLElement | null = null;

  constructor(root: HTMLElement, deps: PanelDeps) {
    this.deps = deps;
    root.classList.add('panel');

    const game = div('panel-row panel-game');
    // 文字は relabel で入れる（言語を切り替えたときも同じ関数で入れ直す）
    this.gameButtons = {
      scramble: button('', deps.scramble),
      reset: button('', deps.reset),
      undo: button('', deps.undo),
      redo: button('', deps.redo),
      home: button('', deps.home),
      wholeToggle: button('', () => this.wholeRow.classList.toggle('open')),
      hint: button('', deps.hint),
      solve: button('', deps.solve),
      keys: button('', deps.openKeymap),
      settings: button('', deps.openSettings),
    };
    this.gameButtons.wholeToggle.classList.add('whole-toggle');
    this.gameButtons.settings.classList.add('settings-btn');
    game.append(...Object.values(this.gameButtons));

    this.layerRow = div('panel-row panel-layer');
    this.pickerRow = div('panel-row panel-picker');
    this.pickerRow.setAttribute('role', 'group');
    this.faceRow = div('panel-row panel-faces');
    this.middleRow = div('panel-row panel-faces panel-middle');
    this.wholeRow = div('panel-row panel-whole');
    root.append(game, this.layerRow, this.pickerRow, this.faceRow, this.middleRow, this.wholeRow);
    root.addEventListener('pointerleave', () => deps.highlight(null));
    this.relabel();
  }

  /** 文言を入れ直す（言語の切り替え）。ボタンの組みも作り直す */
  relabel(): void {
    const b = this.gameButtons;
    const set = (el: HTMLButtonElement, text: string, title?: string) => {
      el.textContent = text;
      if (title) el.title = title;
      else el.removeAttribute('title');
    };
    set(b.scramble, S.scramble);
    set(b.reset, S.reset);
    set(b.undo, S.undo, `${S.undo}（Ctrl+Z）`);
    set(b.redo, S.redo, `${S.redo}（Ctrl+Y）`);
    set(b.home, S.home, S.homeTitle);
    set(b.wholeToggle, S.wholeToggle);
    set(b.hint, S.hint, S.hintTitle);
    set(b.solve, this.solving ? S.solveStop : S.solve, S.solveTitle);
    set(b.keys, S.keys, S.keysTitle);
    // 歯車は MOMO Hanafuda・Sudoku と同じ絵
    b.settings.replaceChildren(gearIcon(), document.createTextNode(S.settings));
    b.settings.title = S.settingsTitleAttr;
    this.pickerRow.setAttribute('aria-label', S.pickerLabel);
    this.rebuild();
  }

  get layerChoice(): LayerChoice {
    return this.layer;
  }

  /** 大きさ・割り当て・画面の向きが変わったら作り直す */
  rebuild(): void {
    const n = this.deps.getSize();
    if (n !== this.n) {
      this.n = n;
      this.layer = clampLayer(n, this.layer);
    }
    this.buildLayerRow();
    this.buildFaceRow();
    this.buildMiddleRow();
    this.buildWholeRow();
    this.buildPickerRow();
  }

  update(s: PanelState): void {
    this.gameButtons.undo.disabled = !s.canUndo;
    this.gameButtons.redo.disabled = !s.canRedo;
    this.gameButtons.scramble.disabled = !s.canScramble;
    this.gameButtons.reset.disabled = !s.canReset;
    this.gameButtons.hint.disabled = !s.canHint || s.solving;
    const solve = this.gameButtons.solve;
    solve.disabled = !s.canHint && !s.solving;
    this.solving = s.solving;
    const label = s.solving ? S.solveStop : S.solve;
    if (solve.textContent !== label) solve.textContent = label;
    solve.classList.toggle('active', s.solving);
  }

  /** 待ち行列があふれて手を受けられなかった（05 §6 queue:full） */
  shake(): void {
    const b = this.lastPressed;
    if (!b) return;
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
    setTimeout(() => b.classList.remove('shake'), SHAKE_MS);
  }

  private buildLayerRow(): void {
    const choices = depthChoices(this.n);
    this.layerRow.replaceChildren();
    this.layerRow.hidden = choices.length === 0;
    if (choices.length === 0) return;
    const legend = span('panel-label', S.depthLegend);
    const group = div('depth-group');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', S.depthLegend);
    for (const d of choices) {
      const b = button(S.depthOption(d), () => this.setLayer({ ...this.layer, depth: d }), S.depthTitle(d));
      b.classList.add('depth');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(d === this.layer.depth));
      group.append(b);
    }
    const wideLabel = document.createElement('label');
    wideLabel.className = 'wide';
    const wide = document.createElement('input');
    wide.type = 'checkbox';
    wide.checked = this.layer.wide;
    wide.disabled = this.layer.depth === 1;
    wide.addEventListener('change', () => this.setLayer({ ...this.layer, wide: wide.checked }));
    wideLabel.title = S.wideTitle(this.layer.depth);
    wideLabel.append(wide, S.wide);
    this.layerRow.append(legend, group, wideLabel);
  }

  private setLayer(c: LayerChoice): void {
    this.layer = clampLayer(this.n, c);
    this.buildLayerRow();
    this.buildFaceRow();
    this.markPicked();
    this.deps.layerChanged();
    this.showHighlight(this.lastFace);
  }

  private buildFaceRow(): void {
    const keymap = this.deps.getKeymap();
    this.faceRow.replaceChildren();
    for (const face of PANEL_FACES) {
      const layer = this.layerName();
      const g = this.group(S.face[face], face, keymap[face], (v) =>
        panelFaceMove(this.n, this.deps.getFrame(), face, v, this.layer), (dir) => S.faceAria(S.face[face], layer, dir), true);
      g.dataset.key = face;
      this.faceRow.append(g);
    }
  }

  private buildMiddleRow(): void {
    const keymap = this.deps.getKeymap();
    this.middleRow.replaceChildren();
    this.middleRow.hidden = !showMiddle(this.n);
    if (this.middleRow.hidden) return;
    const motionFace: Record<MiddleSlice, Face> = { M: 'L', E: 'D', S: 'F' };
    for (const m of ['M', 'E', 'S'] as const) {
      const g = this.group(S.middleShort[m], motionFace[m], keymap[m], (v) =>
        panelMiddleMove(this.n, this.deps.getFrame(), m, v), (dir) => S.middleAria(S.middle[m], dir), false);
      g.dataset.key = m;
      this.middleRow.append(g);
    }
  }

  /** 狭い画面の面選び。広い画面では CSS で隠す */
  private buildPickerRow(): void {
    const keys: { key: string; label: string; face: Face | null }[] = PANEL_FACES.map((f) => ({ key: f, label: S.face[f], face: f }));
    if (showMiddle(this.n)) {
      for (const m of ['M', 'E', 'S'] as const) keys.push({ key: m, label: S.middleShort[m], face: null });
    }
    if (!keys.some((k) => k.key === this.picked)) this.picked = 'R';
    this.pickerRow.replaceChildren(...keys.map(({ key, label, face }) => {
      const b = button(label, () => {
        this.picked = key;
        this.markPicked();
        if (face) {
          this.lastFace = face;
          this.showHighlight(face);
        }
      }, S.pickerTitle(label));
      b.dataset.key = key;
      b.classList.add('pick');
      return b;
    }));
    this.markPicked();
  }

  private markPicked(): void {
    for (const el of [...this.pickerRow.children, ...this.faceRow.children, ...this.middleRow.children] as HTMLElement[]) {
      const on = el.dataset.key === this.picked;
      el.classList.toggle('picked', on);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(on));
    }
  }

  private buildWholeRow(): void {
    const keymap = this.deps.getKeymap();
    this.wholeRow.replaceChildren(span('panel-label', S.whole));
    this.wholeRow.title = S.wholeTitle;
    const motionFace = { x: 'R', y: 'U', z: 'F' } as const;
    for (const axis of ['x', 'y', 'z'] as const) {
      const g = div('btn-group');
      for (const v of VARIANTS) {
        const motion = motionOf(motionFace[axis], v);
        const b = this.turnButton(motion, keyHint(keymap[axis as KeyAction], v), S.wholeAria(dirText(motion)));
        b.addEventListener('click', () => {
          this.lastPressed = b;
          this.deps.view(panelWholeCommand(this.deps.getFrame(), axis, v));
        });
        g.append(b);
      }
      this.wholeRow.append(g);
    }
  }

  /** 面 1 つ分：名前と、時計回り・反時計回り・半回転の 3 ボタン */
  private group(
    label: string, motionFace: Face, code: string, make: (v: Variant) => Move | null,
    aria: (dir: string) => string, trackFace: boolean,
  ): HTMLElement {
    const g = div('btn-group');
    g.append(span('group-label', label));
    for (const v of VARIANTS) {
      const motion = motionOf(motionFace, v);
      const b = this.turnButton(motion, keyHint(code, v), aria(dirText(motion)));
      b.addEventListener('click', () => {
        this.lastPressed = b;
        const m = make(v);
        if (m) this.deps.move(m);
      });
      const show = (): void => {
        const m = make(v);
        if (m) this.deps.highlight(m);
      };
      b.addEventListener('pointerenter', show);
      b.addEventListener('focus', show);
      if (trackFace) {
        b.addEventListener('pointerenter', () => (this.lastFace = motionFace));
        b.addEventListener('focus', () => (this.lastFace = motionFace));
      }
      g.append(b);
    }
    return g;
  }

  private turnButton(motion: Motion | null, hint: string, aria: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'turn';
    b.setAttribute('aria-label', aria);
    b.title = aria;
    b.append(span('icon', motion ? MOTION_ICON[motion] : '180°'), span('key', hint));
    return b;
  }

  /** 読み上げに使う「面」「外から 2 枚目」など */
  private layerName(): string {
    const { depth, wide } = this.layer;
    if (depth === 1) return S.layerFace;
    return wide ? S.layerUpTo(depth) : S.layerNth(depth);
  }

  private showHighlight(face: Face): void {
    const m = panelFaceMove(this.n, this.deps.getFrame(), face, 'cw', this.layer);
    this.deps.highlight(m);
  }
}

function gearIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6 3.6 3.6 0 0 1-3.6 3.6z');
  svg.append(path);
  return svg;
}

function dirText(m: Motion | null): string {
  return m ? S.dir[m] : S.dir.half;
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

function button(text: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
