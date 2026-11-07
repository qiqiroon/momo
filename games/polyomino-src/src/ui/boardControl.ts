// 盤面の操作の受け付け（仕様書 §4.2〜§4.8）。
// 指・マウス・ホイール・キーを、Game（状態）と BoardView（見る位置・描画）への命令に変える。
// 盤面の上に浮かぶボタン（回す・裏返す・置く・やめる）、拡大縮小のボタン、端のスクロールボタンもここで作る。
//
// 指（携帯）とマウス（PC）で動きが違う（2026-11-06 利用者の指示。携帯は §4 のまま）:
//   マウス … クリックで駒をつかむ（リストの駒も盤面の駒も）。つかんだ駒は押さなくてもマウスに付いて動き、
//            もう一度クリックすると置く（重なり・はみ出しがあっても置ける）。リストから盤面へドラッグして離しても置ける。
//            盤面の駒を押したままドラッグして離しても置ける。浮かぶボタンは出さない（ホイール・右クリック・キーで操作）

import { anchorOf, type Game, type PieceRef } from '../core/game';
import { type Cell, orient } from '../core/geometry';
import { type Placement } from '../core/levels';
import { type BoardView } from './boardView';
import { pieceLabel } from './pieceList';
import { S } from './strings';

type Gesture =
  /** 何も選んでいないときの押下：離せば置いた駒を選ぶ、動かせば盤面のスクロール */
  | { kind: 'press'; id: number; sx: number; sy: number; x: number; y: number; moved: boolean }
  /**
   * 選んでいる駒を指で動かす（grab＝つかんだマスからアンカーまでのずれ）。
   * 動かし始めたら、駒を指の上へ lift px 持ち上げて動かす（小さい駒が指に隠れないように。2026-11-07 利用者の指示）
   */
  | { kind: 'move'; id: number; grab: Cell; sx: number; sy: number; lift: number | null }
  | { kind: 'pan'; id: number; x: number; y: number }
  | { kind: 'pinch'; d: number; mx: number; my: number }
  /** マウス：つかんでいる駒を置くための押下（離したら置く） */
  | { kind: 'mplace'; id: number }
  /** マウス：盤面の駒をつかんだ押下（動かしてから離せば置く。動かさずに離せばつかんだまま） */
  | { kind: 'mgrab'; id: number; sx: number; sy: number; moved: boolean }
  | null;

/** 押したまま、これ以上動いたら「ドラッグ」とみなす（px） */
const DRAG_PX = 6;
/** 指で動かす駒を、指先からどれだけ上に離すか（px）。駒がこれより大きく見えていれば持ち上げない */
const LIFT_GAP = 48;
const LIFT_MAX = 170;
const LIFT_BIG = 140;

const parseKey = (key: string): PieceRef => {
  const [piece, copy] = key.split(':').map(Number);
  return { piece, copy };
};

export class BoardControl {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = null;
  private readonly tools: HTMLElement;
  private readonly okBtn: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly edges: Record<'up' | 'down' | 'left' | 'right', HTMLButtonElement>;
  private readonly zoomBtns: { out: HTMLButtonElement; in: HTMLButtonElement; fit: HTMLButtonElement };
  private wheelAcc = 0;
  private wheelAt = 0;
  private readonly offs: Array<() => void> = [];
  /** 駒を触らせない（解提示の間・完成のあと）。その間に盤面に触れたりキーを押したりすると onLockedTap */
  locked = false;
  onLockedTap: (() => void) | null = null;
  /** マウスで駒をつかんでいる（grab＝マウスのマスからアンカーまでのずれ） */
  private mouseHold: { grab: Cell } | null = null;
  /** 盤面の上のホイールでページを動かさず、駒リストを動かす（2026-11-06 利用者の指示） */
  onListWheel: ((dy: number) => void) | null = null;
  /** 駒リスト（ここへ駒を落とすとリストへ戻る。2026-11-06 利用者の指示） */
  private dropZone: HTMLElement | null = null;
  private readonly toListBtn: HTMLButtonElement;

  /** @param onChange 駒の状態が変わった（駒リストを合わせる） */
  constructor(
    wrap: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly view: BoardView,
    private readonly game: Game,
    private readonly onChange: () => void,
  ) {
    // 浮かぶボタン（仮置きの駒に付いて動く。§4.3）
    this.tools = el('div', 'float-tools');
    const rot = this.button('⟳', S.rotate, () => {});
    rot.classList.add('rot');
    this.traceRotate(rot);
    const flip = this.button('⇆', S.flip, () => this.flip());
    this.okBtn = this.button('✓', S.confirm, () => this.confirm());
    this.okBtn.classList.add('ok');
    const cancel = this.button('✕', S.cancel, () => this.cancel());
    // 盤面に置いてあった駒をリストへ戻す（指の操作用。マウスはリストの上でクリック・ドロップ）
    this.toListBtn = this.button('↩', S.toList, () => this.returnToList());
    this.toListBtn.classList.add('to-list');
    this.tools.append(rot, flip, this.okBtn, this.toListBtn, cancel);

    this.hint = el('div', 'place-hint');

    // 拡大・縮小・全体表示（§4.8）
    const zoom = el('div', 'zoom-tools');
    this.zoomBtns = {
      out: this.button('−', S.zoomOut, () => this.zoomCenter(1 / 1.4)),
      in: this.button('+', S.zoomIn, () => this.zoomCenter(1.4)),
      fit: this.button('⤢', S.zoomFit, () => this.view.fit()),
    };
    zoom.append(this.zoomBtns.out, this.zoomBtns.in, this.zoomBtns.fit);

    // 端のスクロールボタン（その向きに見えていない盤面があるときだけ出る）
    const mk = (dir: 'up' | 'down' | 'left' | 'right', ch: string, dx: number, dy: number) => {
      const b = this.button(ch, S.scroll[dir], () => this.view.panBy(dx * this.view.width * 0.6, dy * this.view.height * 0.6));
      b.classList.add('edge', dir);
      return b;
    };
    this.edges = { up: mk('up', '▲', 0, 1), down: mk('down', '▼', 0, -1), left: mk('left', '◀', 1, 0), right: mk('right', '▶', -1, 0) };

    wrap.append(this.hint, ...Object.values(this.edges), zoom, this.tools);

    this.on(canvas, 'pointerdown', (e) => this.down(e as PointerEvent));
    this.on(canvas, 'pointermove', (e) => this.move(e as PointerEvent));
    this.on(canvas, 'pointerup', (e) => this.up(e as PointerEvent));
    this.on(canvas, 'pointercancel', (e) => this.up(e as PointerEvent, true));
    // 指を離した知らせが届かなかった指を残さない（残ると、次に触れた指が2本目になり、ずっと拡大縮小になる）
    this.on(canvas, 'lostpointercapture', (e) => { if ((e as PointerEvent).pointerType !== 'mouse') this.up(e as PointerEvent, true); });
    this.on(canvas, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
    this.on(canvas, 'contextmenu', (e) => { e.preventDefault(); this.cancel(); });
    this.on(canvas, 'auxclick', (e) => e.preventDefault());
    this.on(window, 'keydown', (e) => this.key(e as KeyboardEvent));
    // iPhone の Safari は touch-action だけではページの拡大を止めきれないので、遊ぶ画面の間は二本指の拡大を止める
    this.on(document, 'gesturestart', (e) => e.preventDefault());

    view.onDraw = () => this.layout();
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    this.view.onDraw = null;
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void, opt?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, opt);
    this.offs.push(() => t.removeEventListener(type, fn, opt));
  }

  private button(text: string, label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  // ── 駒への命令

  private changed(): void {
    this.onChange();
    this.view.invalidate();
  }

  /** リストから駒を選ぶ（選んでいる駒をもう一度押したら取り消す。§4.7） */
  pick(ref: PieceRef, mouse = false): void {
    if (this.locked) { this.onLockedTap?.(); return; }
    const s = this.game.sel;
    if (s && s.ref.piece === ref.piece && s.ref.copy === ref.copy) {
      this.game.cancel();
      this.mouseHold = null;
    } else {
      this.game.select(ref);
      this.mouseHold = mouse ? { grab: [0, 0] } : null;
    }
    this.changed();
  }

  rotate(dir: 1 | -1): void {
    if (this.game.rotate(dir)) {
      this.view.animateRotate(dir > 0 ? -90 : 90);
      this.changed();
    }
  }

  flip(): void {
    if (this.game.flip()) {
      this.view.animateFlip();
      this.changed();
    }
  }

  /** 置く。重なり・はみ出しがあっても置ける（重なりがある間は完成にならないだけ。指でも同じ。2026-11-07 利用者の指示） */
  confirm(): void {
    if (this.game.confirm(true)) {
      this.mouseHold = null;
      this.changed();
    }
  }

  cancel(): void {
    this.mouseHold = null;
    if (!this.game.sel) return;
    this.game.cancel();
    this.changed();
  }

  private zoomCenter(f: number): void {
    const a = this.view.anchorPoint();
    this.view.zoomAt(f, a?.x ?? this.view.width / 2, a?.y ?? this.view.height / 2);
  }

  // ── 指・マウス

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button === 1) { e.preventDefault(); this.flip(); return; } // ホイールクリック＝裏返す
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.locked) { this.onLockedTap?.(); return; }
    if (e.pointerType === 'mouse') { this.mouseDown(e); return; }
    this.mouseHold = null; // 指で触れたら、指の操作に切り替える
    if (e.isPrimary) {
      // ほかに触れている指がない最初の指：前の指が残っていたら捨てる（拡大縮小から抜けられなくなるのを防ぐ）
      this.pointers.clear();
      this.gesture = null;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;

    const cell = this.view.toCell(p.x, p.y);
    const sel = this.game.sel;
    if (!sel) {
      this.gesture = { kind: 'press', id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false };
      return;
    }
    const sp = this.game.selPlacement();
    if (sp && sel.at && this.game.occupied(sp).some(([x, y]) => x === cell[0] && y === cell[1])) {
      // 選んでいる駒をつかんだ：つかんだ所を保ったまま動かす
      this.gesture = { kind: 'move', id: e.pointerId, grab: [sel.at[0] - cell[0], sel.at[1] - cell[1]], sx: p.x, sy: p.y, lift: null };
      return;
    }
    // 駒の外に触れた：駒がそこへ来る（§4.3）。
    // 触れた所にほかの駒があれば、そのあとのドラッグは盤面のスクロール（駒は盤面の上で止まったまま。§4.4）
    const onOther = this.game.placedAt(cell) !== null;
    if (this.game.moveTo(cell)) this.changed();
    this.gesture = onOther
      ? { kind: 'pan', id: e.pointerId, x: p.x, y: p.y }
      : { kind: 'move', id: e.pointerId, grab: [0, 0], sx: p.x, sy: p.y, lift: null };
  }

  private move(e: PointerEvent): void {
    if (e.pointerType === 'mouse') { this.mouseMove(e); return; }
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (g.d > 0) this.view.zoomAt(d / g.d, mx, my);
      this.view.panBy(mx - g.mx, my - g.my);
      Object.assign(g, { d, mx, my });
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.kind === 'press') {
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > DRAG_PX) g.moved = true;
      if (g.moved) this.view.panBy(p.x - g.x, p.y - g.y);
      g.x = p.x;
      g.y = p.y;
    } else if (g.kind === 'pan') {
      this.view.panBy(p.x - g.x, p.y - g.y);
      g.x = p.x;
      g.y = p.y;
    } else if (g.kind === 'move') {
      if (g.lift === null) {
        if (Math.hypot(p.x - g.sx, p.y - g.sy) <= DRAG_PX) return;
        g.lift = this.liftFor(g.sy);
      }
      const c = this.view.toCell(p.x, p.y - g.lift);
      if (this.game.moveTo([c[0] + g.grab[0], c[1] + g.grab[1]])) this.changed();
    }
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (e.pointerType === 'mouse') {
      // 左ボタン以外（ホイールクリック＝裏返すだけ・右クリック）を離しても、置かない
      if (e.button !== 0 && !cancelled) return;
      this.mouseUp(e, cancelled);
      return;
    }
    if (!this.pointers.delete(e.pointerId)) return;
    const g = this.gesture;
    if (g && g.kind === 'press' && g.id === e.pointerId && !g.moved && !cancelled) {
      // 置いた駒を押した（離した）：その駒を選ぶ（§4.2・§4.6）
      const key = this.game.placedAt(this.view.toCell(g.x, g.y));
      if (key) {
        this.game.select(parseKey(key));
        this.changed();
      }
    }
    if (g?.kind === 'pinch' || this.pointers.size === 0) this.gesture = null;
  }

  /** 指で動かし始めたときの持ち上げる量：駒の下の端が指先より LIFT_GAP 上に来るように（大きく見えている駒は持ち上げない） */
  private liftFor(fingerY: number): number {
    const sp = this.game.selPlacement();
    if (!sp) return 0;
    const r = this.view.rectOf(this.game.occupied(sp));
    if (Math.max(r.w, r.h) >= LIFT_BIG) return 0;
    return Math.min(LIFT_MAX, Math.max(0, r.y + r.h - fingerY) + LIFT_GAP);
  }

  // ── マウス（PC）

  /** マウスの位置のマスへ、つかんでいる駒を付いて行かせる */
  private follow(e: PointerEvent): void {
    if (!this.mouseHold || !this.game.sel) return;
    const p = this.local(e);
    const c = this.view.toCell(p.x, p.y);
    if (this.game.moveTo([c[0] + this.mouseHold.grab[0], c[1] + this.mouseHold.grab[1]])) this.changed();
  }

  private mouseDown(e: PointerEvent): void {
    const p = this.local(e);
    const cell = this.view.toCell(p.x, p.y);
    this.canvas.setPointerCapture(e.pointerId);
    const sel = this.game.sel;
    if (sel) {
      // つかんでいる駒を置く（離したときに置く）。指で選んでいた駒なら、ここからマウスでつかんだことにする
      if (!this.mouseHold) {
        const sp = this.game.selPlacement();
        const onSel = sp && sel.at && this.game.occupied(sp).some(([x, y]) => x === cell[0] && y === cell[1]);
        this.mouseHold = { grab: onSel ? [sel.at![0] - cell[0], sel.at![1] - cell[1]] : [0, 0] };
      }
      this.follow(e);
      this.gesture = { kind: 'mplace', id: e.pointerId };
      return;
    }
    const key = this.game.placedAt(cell);
    if (key) {
      // 盤面の駒をつかむ（つかんだ所を保つ）
      this.game.select(parseKey(key));
      const at = this.game.sel!.at!;
      this.mouseHold = { grab: [at[0] - cell[0], at[1] - cell[1]] };
      this.gesture = { kind: 'mgrab', id: e.pointerId, sx: p.x, sy: p.y, moved: false };
      this.changed();
      return;
    }
    // 何もない所：ドラッグで盤面のスクロール
    this.gesture = { kind: 'press', id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false };
  }

  private mouseMove(e: PointerEvent): void {
    const g = this.gesture;
    if (g?.kind === 'press' && g.id === e.pointerId) {
      const p = this.local(e);
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > DRAG_PX) g.moved = true;
      if (g.moved) this.view.panBy(p.x - g.x, p.y - g.y);
      g.x = p.x;
      g.y = p.y;
      return;
    }
    if (g?.kind === 'mgrab' && g.id === e.pointerId && !g.moved) {
      const p = this.local(e);
      if (Math.hypot(p.x - g.sx, p.y - g.sy) > DRAG_PX) g.moved = true;
    }
    this.markDrop(this.overDropZone(e)); // 押したまま運んでいるときは、リストの上でも canvas に届く
    this.follow(e); // 押していなくても付いて動く。リストからドラッグしてきたときもここ
    this.updateCursor(e);
  }

  private mouseUp(e: PointerEvent, cancelled: boolean): void {
    const g = this.gesture;
    this.gesture = null;
    if (cancelled) return;
    if (g?.kind === 'mgrab' && g.moved && this.overDropZone(e)) {
      // 盤面の駒を押したまま、駒リストまで運んで離した：リストへ戻す
      this.returnToList();
    } else if (g?.kind === 'mplace' || (g?.kind === 'mgrab' && g.moved)) {
      this.follow(e);
      this.confirm();
    } else if (!g && this.mouseHold && this.game.sel) {
      // リストからドラッグしてきて、盤面の上で離した
      this.follow(e);
      if (this.game.sel.at) this.confirm();
    }
    this.updateCursor(e);
  }

  /** 駒リストを、駒を落として戻す場所にする（リストの上でクリック、またはドラッグして離すと戻る） */
  setDropZone(el: HTMLElement): void {
    this.dropZone = el;
    // マウスでつかんでいるときにリストを押したら、リストの駒を選ぶのではなく、つかんでいる駒を戻す（capture で先に受ける）
    this.on(el, 'pointerdown', (ev) => {
      const e = ev as PointerEvent;
      if (e.pointerType !== 'mouse' || e.button !== 0 || !this.mouseHold || !this.game.sel) return;
      // スクロールバーや ▲▼ のボタンはそのまま使えるように、駒の並ぶ所と見出しだけで受ける
      const t = e.target as HTMLElement;
      if (t.closest('.list-scroll')) return;
      e.preventDefault();
      e.stopPropagation();
      this.returnToList();
      // このあとに来る click で、リストの駒を選ばないようにする
      this.swallowClick = true;
      setTimeout(() => { this.swallowClick = false; }, 1500);
    }, { capture: true });
    this.on(el, 'click', (ev) => { if (this.swallowClick) { this.swallowClick = false; ev.stopPropagation(); ev.preventDefault(); } }, { capture: true });
    this.on(el, 'pointermove', (e) => this.markDrop(this.overDropZone(e as PointerEvent)));
    this.on(el, 'pointerleave', () => this.markDrop(false));
  }

  private swallowClick = false;

  private overDropZone(e: PointerEvent): boolean {
    if (!this.dropZone) return false;
    const r = this.dropZone.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /** リストの上に駒を持ってきたら、リストを光らせる（落とせば戻ることを示す） */
  private markDrop(over: boolean): void {
    this.dropZone?.classList.toggle('drop-target', over && !!this.mouseHold && !!this.game.sel);
  }

  /** ヒント（§8.2）：その駒を、その置き場所に仮置き（選んだ状態）にする。確定はプレイヤーがする */
  placeHint(pl: Placement): void {
    this.mouseHold = null;
    this.game.select({ piece: pl.piece, copy: pl.copy });
    const s = this.game.sel!;
    const a = anchorOf(orient(this.game.pieces[pl.piece].cells, pl.o));
    s.o = pl.o;
    s.at = [pl.x + a[0], pl.y + a[1]];
    s.moved = true;
    this.view.showCells(this.game.occupied(pl));
    this.changed();
  }

  /** 選んでいる駒をリストへ戻す */
  returnToList(): void {
    if (this.locked) return;
    this.mouseHold = null;
    this.markDrop(false);
    if (this.game.returnToList()) {
      this.changed();
    }
  }

  private updateCursor(e: PointerEvent): void {
    let c = 'default';
    // つかんでいる間は矢印を消す（縮小して駒が小さいと、矢印に隠れて駒が見えないため。2026-11-06 利用者の指示）
    if (this.mouseHold && this.game.sel) c = 'none';
    else if (this.mouseHold) c = 'grabbing';
    else if (!this.locked) {
      const p = this.local(e);
      if (this.game.placedAt(this.view.toCell(p.x, p.y))) c = 'grab';
    }
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }

  private wheel(e: WheelEvent): void {
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey) {
      // Ctrl＋ホイール（とトラックパッドのピンチ）は拡大縮小
      e.preventDefault();
      const p = this.local(e);
      this.view.zoomAt(Math.exp(-dy * 0.0025), p.x, p.y);
      return;
    }
    if (this.game.sel) {
      // 駒を仮置きしている間は、ホイールで回す（ひと刻みで 90°）
      e.preventDefault();
      const now = performance.now();
      if (now - this.wheelAt > 300) this.wheelAcc = 0;
      this.wheelAcc += dy;
      if (Math.abs(this.wheelAcc) >= 40 && now - this.wheelAt > 140) {
        this.rotate(this.wheelAcc > 0 ? 1 : -1);
        this.wheelAcc = 0;
        this.wheelAt = now;
      }
      return;
    }
    // 何も選んでいないとき：ページは動かさず、駒リストを動かす（2026-11-06 利用者の指示）。
    // 盤面のスクロールは、ドラッグ・端のボタン・Ctrl＋ホイールの拡大縮小で
    e.preventDefault();
    this.onListWheel?.(dy || dx);
  }

  /** 回すボタン：押して離せば 90°、押したまま駒のまわりをなぞれば好きな角度へ回り、離すと 90° ごとに収まる（§4.5） */
  private traceRotate(btn: HTMLButtonElement): void {
    let st: { id: number; sx: number; sy: number; a0: number; last: number; total: number; live: boolean } | null = null;
    const angle = (p: { x: number; y: number }) => {
      const a = this.view.anchorPoint()!;
      return (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.view.anchorPoint()) return;
      btn.setPointerCapture(e.pointerId);
      const p = this.local(e);
      st = { id: e.pointerId, sx: p.x, sy: p.y, a0: angle(p), last: angle(p), total: 0, live: false };
    });
    btn.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const p = this.local(e);
      if (!st.live && Math.hypot(p.x - st.sx, p.y - st.sy) > DRAG_PX) st.live = true;
      if (!st.live) return;
      const a = angle(p);
      let d = a - st.last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      st.total += d;
      st.last = a;
      this.view.liveAngle = st.total;
      this.view.invalidate();
    });
    const end = (e: PointerEvent) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st;
      st = null;
      if (!s.live) { this.rotate(1); return; }
      const k = Math.round(s.total / 90);
      for (let i = 0; i < Math.abs(k) % 4; i++) this.game.rotate(k > 0 ? 1 : -1);
      this.view.liveAngle = 0;
      this.view.animateRotate(s.total - k * 90);
      this.changed();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    // なぞった後の click で、さらに 90° 回らないようにする（回すのは pointerup で済ませている）
    btn.addEventListener('click', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.rotate(1); }
    });
  }

  // ── キー（PC の補助）：R 回す（Shift+R 逆）・F 裏返す・Enter 置く・Esc やめる・矢印で動かす・＋− 拡大縮小

  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.locked) {
      if (t instanceof HTMLButtonElement) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.onLockedTap?.(); }
      return;
    }
    const sel = this.game.sel;
    const arrows: Record<string, Cell> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (e.key in arrows && sel?.at) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      if (this.game.moveTo([sel.at[0] + dx, sel.at[1] + dy])) this.changed();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r' && sel?.at) this.rotate(e.shiftKey ? -1 : 1);
    else if (k === 'f' && sel?.at) this.flip();
    else if (e.key === 'Enter' && sel?.at && !(t instanceof HTMLButtonElement)) this.confirm();
    else if (e.key === 'Escape') this.cancel();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) this.returnToList();
    else if (e.key === '+' || e.key === ';') this.zoomCenter(1.4);
    else if (e.key === '-') this.zoomCenter(1 / 1.4);
    else if (e.key === '0') this.view.fit();
    else return;
    e.preventDefault();
  }

  // ── 浮かぶボタンなどの位置と出し入れ（描くたびに呼ばれる）

  private layout(): void {
    const sel = this.game.sel;
    const sp = this.game.selPlacement();
    // 選んだが、まだ盤面に触れていない（指）／マウスでつかんでいる：盤面の上に案内を出す
    const mouse = !!this.mouseHold && !!sel;
    // 穴あきの駒を持っているときは、穴は埋めなくてよいことを添える（§4.8.4）
    const holey = !!sel && this.game.pieces[sel.ref.piece].holes.length > 0;
    this.hint.hidden = !(sel && (!sel.at || mouse || holey));
    let text = '';
    if (sel && mouse) text = S.mouseHint(pieceLabel(this.game.level, sel.ref));
    else if (sel && !sel.at) text = S.placeHint(pieceLabel(this.game.level, sel.ref));
    if (holey) text = text ? `${text}\n${S.holeNote}` : S.holeNote;
    if (sel && this.hint.textContent !== text) this.hint.textContent = text;
    if (!this.mouseHold && this.canvas.style.cursor === 'none') this.canvas.style.cursor = 'default';

    this.tools.hidden = !sp || mouse;
    this.toListBtn.hidden = !sel?.origin;
    if (sp) {
      // 重なり・はみ出しがあっても置ける（完成にならないだけ。ボタンの見た目は変えない。2026-11-07 利用者の指示）
      this.okBtn.disabled = false;
      const r = this.view.rectOf(this.game.occupied(sp));
      const tw = this.tools.offsetWidth, th = this.tools.offsetHeight;
      const W = this.view.width, H = this.view.height;
      let x = r.x + r.w / 2 - tw / 2;
      let y = r.y + r.h + 10;
      if (y + th > H - 4) y = r.y - th - 10; // 下に入らなければ上へ
      if (y < 4) y = Math.min(H - th - 4, r.y + r.h + 10);
      x = Math.max(4, Math.min(W - tw - 4, x));
      y = Math.max(4, Math.min(H - th - 4, y));
      this.tools.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    const can = this.view.canPan();
    (Object.keys(this.edges) as Array<keyof typeof can>).forEach((d) => { this.edges[d].hidden = !can[d]; });
    const fitted = this.view.isFitted();
    this.zoomBtns.out.disabled = fitted;
    this.zoomBtns.fit.disabled = fitted;
    this.zoomBtns.in.disabled = this.view.scale >= this.view.maxScale() - 1e-6;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
