// ポインタの振り分け（設計 04 §1・§2）
//
// 押した瞬間には決めず、少し動いた時点で用途を決める：
// - キューブ（色の境目・小キューブの隙間も含む）を左ボタン／1 本指で押した → その層を 90° 回す
//   （Alt＝外側から掴んだ層までまとめて、Ctrl＝キューブ全体をその向きへ 90°）。
//   回すかどうかと向きは、離したときに「押した所 → 離した所」の差だけで決める（途中の道筋は見ない）
// - キューブの外（背景・鏡） → キューブ全体を横回しか縦回し（最初に動いた向きで決める）
// - Shift・右ボタン・中ボタン → キューブ全体の自由回転（見えない球）
// - 2 本指 → ピンチでズーム。ホイール → ズーム
// 鏡に映った面は掴まない（2026-11-02 作者：鏡はクリックやドラッグに反応しない）。
// 動かさずに離した（タップ）ときは矢印の操作（設計 10 §6）：矢印を押す／ステッカーの面を選ぶ／背景で選択を外す。
// 矢印の上から始めたドラッグは、背景と同じく全体の回転
import type { Move } from '../core/types';
import type { ArrowId } from './arrowActions';
import type { Picker, StickerHit } from './picker';
import type { ViewCommand, ViewController } from './viewController';

const WHEEL_GAIN = 0.0012;
/** これより動いたらタップではない（px） */
export const DRAG_THRESHOLD = 6;
/**
 * 層を回すのに要る、押した所から離した所までの距離（px。マウス・ペン）。
 * 前の 6px の 1.5 倍（2026-11-04 作者：入力に要る移動量を 1.5 倍に）
 */
export const LAYER_THRESHOLD = 9;
/**
 * 指では、さらに長く要る（px。前の 14px の 1.5 倍）。指の当たり始めは揺れるので、
 * 短いと向きを取り違えやすい（2026-11-02 作者：回転の方向を間違えることがある）
 */
export const TOUCH_LAYER_THRESHOLD = 21;

/**
 * 層を回すかどうかと向きは、押した所と離した所の差だけで決める（2026-11-04 作者：途中でゆがんでも）。
 * 足りなければ null（何も回さない）
 */
export function layerDragOf(touch: boolean, dx: number, dy: number): { x: number; y: number } | null {
  return Math.hypot(dx, dy) >= (touch ? TOUCH_LAYER_THRESHOLD : LAYER_THRESHOLD) ? { x: dx, y: dy } : null;
}
/** これより長く押していたらタップとみなさない（10 §6.1） */
export const TAP_MS = 500;

type Mode = 'pending' | 'layer' | 'rotate' | 'free' | 'pinch';

interface Gesture {
  mode: Mode;
  startX: number;
  startY: number;
  hit: StickerHit | null;
  arrow: ArrowId | null;
  at: number;
  alt: boolean;
  ctrl: boolean;
  /** 自由回転（Shift・右ボタン・中ボタン） */
  free: boolean;
  touch: boolean;
  /** 6px より動いた（もうタップではない） */
  moved: boolean;
}

export interface PointerHandlers {
  /** 層を回す手が決まった */
  move: (move: Move) => void;
  /** 全体を回す視点コマンド（Ctrl＋ドラッグ） */
  view: (command: ViewCommand) => void;
  /** 描き直しが要る */
  change: () => void;
}

/** 矢印の操作（M6.5）。省略すればタップは何もしない */
export interface ArrowHandlers {
  /** 画面の点にある矢印（面が選ばれていなければ null） */
  pick: (clientX: number, clientY: number) => ArrowId | null;
  press: (id: ArrowId) => void;
  /** ステッカーをタップした：その面を選ぶ */
  select: (hit: StickerHit) => void;
  /** 背景をタップした：選択を外す */
  clear: () => void;
  /** マウスを乗せている矢印（null で外れた） */
  hover: (id: ArrowId | null) => void;
}

export class PointerRouter {
  private readonly el: HTMLElement;
  private readonly view: ViewController;
  private readonly picker: Picker;
  private readonly on: PointerHandlers;
  private readonly arrows: ArrowHandlers | null;
  private readonly points = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private pinchDistance = 0;
  private readonly abort = new AbortController();

  constructor(el: HTMLElement, view: ViewController, picker: Picker, handlers: PointerHandlers,
    arrows: ArrowHandlers | null = null) {
    this.el = el;
    this.arrows = arrows;
    this.view = view;
    this.picker = picker;
    this.on = handlers;
    const opts = { signal: this.abort.signal };
    el.addEventListener('pointerdown', (e) => this.down(e), opts);
    el.addEventListener('pointermove', (e) => this.move(e), opts);
    el.addEventListener('pointerup', (e) => this.up(e), opts);
    el.addEventListener('pointercancel', (e) => this.up(e, true), opts);
    el.addEventListener('pointerleave', () => this.arrows?.hover(null), opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    el.addEventListener('wheel', (e) => this.wheel(e), { signal: this.abort.signal, passive: false });
  }

  dispose(): void {
    this.abort.abort();
  }

  private down(e: PointerEvent): void {
    this.el.setPointerCapture(e.pointerId);
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.points.size === 2) {
      // 2 本目の指：層の操作はやめてピンチにする
      this.pinchDistance = this.spread();
      if (this.gesture) this.gesture.mode = 'pinch';
      return;
    }
    if (this.points.size > 2) return;
    // ステッカーを掴めるのは、左ボタン（または指・ペン）で Shift を押していないときだけ
    const canGrab = e.button === 0 && !e.shiftKey;
    // 矢印 → ステッカー → 背景の順（04 §2）。矢印の上ならステッカーは掴まない
    const arrow = canGrab ? this.arrows?.pick(e.clientX, e.clientY) ?? null : null;
    this.gesture = {
      mode: 'pending',
      startX: e.clientX,
      startY: e.clientY,
      hit: canGrab && !arrow ? this.picker.pick(e.clientX, e.clientY) : null,
      arrow,
      at: e.timeStamp,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      free: !canGrab,
      touch: e.pointerType === 'touch',
      moved: false,
    };
  }

  private move(e: PointerEvent): void {
    const prev = this.points.get(e.pointerId);
    const g = this.gesture;
    if (!g && e.pointerType === 'mouse') {
      this.arrows?.hover(this.arrows.pick(e.clientX, e.clientY));
      return;
    }
    if (!prev || !g) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (g.mode === 'pinch') {
      if (this.points.size === 2) {
        const d = this.spread();
        if (this.pinchDistance > 0 && d > 0) this.view.zoom(this.pinchDistance / d);
        this.pinchDistance = d;
        this.on.change();
      }
      return;
    }
    if (g.mode === 'layer') return;
    if (g.mode === 'pending') {
      const tx = e.clientX - g.startX;
      const ty = e.clientY - g.startY;
      const dist = Math.hypot(tx, ty);
      if (dist <= DRAG_THRESHOLD) return;
      g.moved = true;
      if (g.hit) {
        // 層を回す。どこを通ったかは見ず、離したときに押した所との差で決める（layerDragOf）
        g.mode = 'layer';
        return;
      }
      if (g.free) {
        g.mode = 'free';
        this.freeRotate(e.clientX, e.clientY, tx, ty);
      } else {
        g.mode = 'rotate';
        // 縦回しで上へ送る面は、キューブの左右どちら側で始めたかで決まる
        this.view.beginDrag(this.fromCubeCenter(g.startX, g.startY).x);
        this.view.dragRotate(tx, ty);
        this.on.change();
      }
      return;
    }
    if (g.mode === 'free') {
      this.freeRotate(e.clientX, e.clientY, dx, dy);
    } else {
      this.view.dragRotate(dx, dy);
      this.on.change();
    }
  }

  private freeRotate(clientX: number, clientY: number, dx: number, dy: number): void {
    const p = this.fromCubeCenter(clientX, clientY);
    this.view.freeRotate(p.x, p.y, dx, dy);
    this.on.change();
  }

  /** 画面の点の、キューブの重心が写る位置からのずれ（px、下向きが正。鏡の像も収めるため重心は画面中央からずれている） */
  private fromCubeCenter(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const o = this.view.cubeScreenOffset;
    return { x: clientX - (r.left + r.width / 2 + o.x), y: clientY - (r.top + r.height / 2 + o.y) };
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (!this.points.delete(e.pointerId)) return;
    const g = this.gesture;
    if (g && g.mode === 'layer' && !cancelled && this.points.size === 0) this.layerRelease(g, e);
    if (g && g.mode === 'pending' && !g.moved && !cancelled && this.points.size === 0 && e.timeStamp - g.at <= TAP_MS) {
      this.tap(g);
    }
    if (this.points.size > 0) {
      this.pinchDistance = this.points.size === 2 ? this.spread() : 0;
      return;
    }
    const mode = this.gesture?.mode;
    if (mode === 'rotate' || mode === 'free' || mode === 'pinch') {
      this.view.release();
      this.on.change();
    }
    this.gesture = null;
  }

  /** 層を掴んで離した。押した所と離した所の差で、回すかどうかと向きを決める */
  private layerRelease(g: Gesture, e: PointerEvent): void {
    if (!g.hit) return;
    const d = layerDragOf(g.touch, e.clientX - g.startX, e.clientY - g.startY);
    if (!d) return;
    const push = this.picker.pushFor(g.hit, d.x, d.y, g.alt ? 'wide' : 'single');
    if (!push) return;
    if (g.ctrl) this.on.view({ kind: 'rotate', about: push.about, quarter: 1 });
    else this.on.move(push.move);
  }

  /** 動かさずに離した */
  private tap(g: Gesture): void {
    const a = this.arrows;
    if (!a) return;
    if (g.arrow) a.press(g.arrow);
    else if (g.hit) a.select(g.hit);
    else if (!g.ctrl && !g.alt) a.clear();
    this.on.change();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.view.zoom(Math.exp(e.deltaY * WHEEL_GAIN));
    this.on.change();
  }

  private spread(): number {
    const [a, b] = [...this.points.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
