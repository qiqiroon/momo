// 面の選択・カーソル・矢印の表示と押下（設計 10 §6）。矢印の中身は arrowActions、描画は ArrowView
import type { Face, Move, Vec3 } from '../core/types';
import type { ArrowView } from '../render/arrowView';
import {
  arrowsFor, arrowToAction, isCursorArrow, keyLabelFor, pickArrow, sameArrow, showsLabel,
  type ArrowAction, type ArrowId, type ArrowLabelMode, type ArrowLayout,
} from './arrowActions';
import type { Keymap } from './keymap';
import type { ViewCommand } from './viewController';
import type { ViewFrame } from './viewFrame';

/** 押した瞬間の色を出す長さ（ms） */
const FLASH_MS = 120;

const COLOR = {
  strip: 0x8c8c8c,
  stripCursor: 0xffffff,
  faceTurn: 0xd9b93a,
  whole: 0x55bfe0,
  hover: 0xffffff,
  pressed: 0xffe066,
  refused: 0xff4a4a,
};

export interface ArrowControlsDeps {
  view: ArrowView;
  getSize: () => number;
  getFrame: () => ViewFrame;
  getKeymap: () => Keymap;
  /** 手を待ち行列に入れる。あふれたら false */
  move: (move: Move) => boolean;
  command: (command: ViewCommand) => void;
  /** 回す層を示す（null で消す） */
  highlight: (move: Move | null) => void;
  /** 描き直しが要る */
  change: () => void;
}

export interface ArrowLabel {
  readonly layout: ArrowLayout;
  readonly text: string;
}

export class ArrowControls {
  private readonly deps: ArrowControlsDeps;
  private face: Face | null = null;
  private cell: { u: number; v: number } | null = null;
  private n = 0;
  private layouts: ArrowLayout[] = [];
  private hovered: ArrowId | null = null;
  private flash: { id: ArrowId; color: number; left: number } | null = null;
  labelMode: ArrowLabelMode = 'auto';
  /** 札の中身が変わるたびに増える（札の書き換えを中身が変わったときだけにする） */
  private labelVersion = 0;
  private labelCache: { key: string; labels: ArrowLabel[] } | null = null;

  constructor(deps: ArrowControlsDeps) {
    this.deps = deps;
  }

  get selected(): { face: Face; cell: { u: number; v: number } | null; n: number } | null {
    return this.face ? { face: this.face, cell: this.cell, n: this.n } : null;
  }

  /** 面を選ぶ（別の面なら切り替え、同じ面ならカーソルだけ移す） */
  select(face: Face, cell: { u: number; v: number } | null): void {
    this.face = face;
    this.cell = cell;
    this.n = this.deps.getSize();
    this.layouts = arrowsFor(face, this.n);
    this.hovered = null;
    this.flash = null;
    this.redraw(true);
  }

  clear(): void {
    if (!this.face) return;
    this.face = null;
    this.cell = null;
    this.layouts = [];
    this.hovered = null;
    this.flash = null;
    this.redraw(true);
  }

  /** 視線の候補のどれかが当たった矢印（鏡に映った矢印は押せない。候補は本体の視線だけ） */
  pick(rays: readonly { o: Vec3; r: Vec3 }[]): ArrowId | null {
    if (!this.face) return null;
    for (const { o, r } of rays) {
      const id = pickArrow(o, r, this.face, this.n);
      if (id) return id;
    }
    return null;
  }

  actionOf(id: ArrowId): ArrowAction {
    return arrowToAction(id, this.n);
  }

  press(id: ArrowId): void {
    const action = this.actionOf(id);
    let ok = true;
    if (action.kind === 'move') {
      ok = this.deps.move(action.move);
      if (ok) this.deps.highlight(action.move);
    } else {
      this.deps.command(action.command);
    }
    this.flash = { id, color: ok ? COLOR.pressed : COLOR.refused, left: FLASH_MS };
    this.redraw(false);
  }

  /** マウスを乗せた矢印（null で外す）。層を回す矢印なら、その層を示す */
  hover(id: ArrowId | null): void {
    if (sameArrow(id, this.hovered)) return;
    this.hovered = id;
    const action = id ? this.actionOf(id) : null;
    this.deps.highlight(action?.kind === 'move' ? action.move : null);
    this.redraw(false);
  }

  /** 毎フレーム。見た目が変わったら true */
  update(dtMs: number): boolean {
    if (!this.flash) return false;
    this.flash.left -= dtMs;
    if (this.flash.left <= 0) this.flash = null;
    this.redraw(false);
    return true;
  }

  /** いま出す札（中身はキー割り当て・向き・カーソルが変わったときだけ作り直す） */
  labels(): { version: number; labels: ArrowLabel[] } {
    if (!this.face) {
      if (this.labelCache) {
        this.labelCache = null;
        this.labelVersion++;
      }
      return { version: this.labelVersion, labels: [] };
    }
    const frame = this.deps.getFrame();
    const keymap = this.deps.getKeymap();
    const key = JSON.stringify([this.face, this.n, this.cell, frame.ori, keymap, this.labelMode]);
    if (this.labelCache?.key !== key) {
      const labels: ArrowLabel[] = [];
      for (const layout of this.layouts) {
        if (!showsLabel(layout.id, this.n, this.cell, this.labelMode)) continue;
        const text = keyLabelFor(this.actionOf(layout.id), keymap, frame, this.n);
        if (text) labels.push({ layout, text });
      }
      this.labelCache = { key, labels };
      this.labelVersion++;
    }
    return { version: this.labelVersion, labels: this.labelCache.labels };
  }

  private colorOf(id: ArrowId): number {
    if (this.flash && sameArrow(id, this.flash.id)) return this.flash.color;
    if (sameArrow(id, this.hovered)) return COLOR.hover;
    switch (id.kind) {
      case 'strip': return isCursorArrow(id, this.cell) ? COLOR.stripCursor : COLOR.strip;
      case 'faceTurn': return COLOR.faceTurn;
      default: return COLOR.whole;
    }
  }

  private redraw(layout: boolean): void {
    const v = this.deps.view;
    if (layout) {
      v.show(this.face, this.n, this.layouts);
      v.showCursor(this.face, this.n, this.cell);
    }
    if (this.face) v.paint((id) => this.colorOf(id));
    this.deps.change();
  }
}
