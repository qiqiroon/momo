// 右側の駒リスト（仕様書 §3.2）。
// 未配置の駒を上・配置済みを下に並べる。未配置はオレンジ、配置済みはグレー。
// リストの駒は回転・裏返しをせず、常に基準の向きで出す。
// 指：押す（指を離す）と選ぶ。ドラッグはリストのスクロール（§4.2）。
// マウス：押した瞬間に駒をつかむ。そのまま盤面までドラッグして離せば置ける（2026-11-06 利用者の指示）。
//         リストのスクロールはホイール・▲▼・スクロールバーで

import { sizeOf } from '../core/geometry';
import { type Game, type PieceRef, refKey } from '../core/game';
import { type LevelDef, piecesOf } from '../core/levels';
import { shapeSvg } from './shapeSvg';
import { S } from './strings';

export function pieceLabel(level: LevelDef, ref: PieceRef): string {
  const name = piecesOf(level)[ref.piece].name;
  return level.count > 1 ? `${name}-${ref.copy + 1}` : name;
}

export class PieceList {
  private readonly head: HTMLElement;
  private readonly count: HTMLElement;
  private readonly find: HTMLInputElement;
  private findTimer = 0;
  private cols = 1;
  private readonly items: HTMLElement;
  private readonly up: HTMLButtonElement;
  private readonly down: HTMLButtonElement;
  private readonly byKey = new Map<string, HTMLButtonElement>();
  private readonly ro: ResizeObserver;
  /** 駒の絵は、リストの見えている所に来たときに作る（駒が何千個あるレベルでも軽く。§2.1） */
  private readonly io: IntersectionObserver;
  private cell = 0;

  /**
   * @param onPick 未配置の駒を押した（選ぶ／選んでいる駒なら取り消す）
   * @param onShow 置いた駒を押した（盤面のその駒の位置へ動かすだけ）
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
    private readonly onPick: (ref: PieceRef, mouse: boolean) => void,
    private readonly onShow: (key: string) => void,
  ) {
    root.replaceChildren();
    this.head = document.createElement('div');
    this.head.className = 'head';
    // 番号の欄（並びの左上。打った番号の駒をリストの左上に出す。盤面に置いてあれば盤面の駒も光らせる）
    this.find = document.createElement('input');
    this.find.type = 'text';
    this.find.inputMode = 'numeric';
    this.find.className = 'find';
    this.find.placeholder = S.findPlaceholder;
    this.find.title = S.findLabel;
    this.find.setAttribute('aria-label', S.findLabel);
    this.find.autocomplete = 'off';
    this.find.spellcheck = false;
    this.find.addEventListener('input', () => {
      clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.jump(this.find.value), 450);
    });
    this.find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(this.findTimer); this.jump(this.find.value); }
      else if (e.key === 'Escape') this.find.blur();
    });
    this.count = document.createElement('span');
    this.count.className = 'count';
    this.head.append(this.find, this.count);
    this.up = this.scrollButton('▲', S.listUp, -1);
    this.items = document.createElement('div');
    this.items.id = 'piece-items';
    this.down = this.scrollButton('▼', S.listDown, 1);
    root.append(this.head, this.up, this.items, this.down);
    this.items.addEventListener('scroll', () => this.updateScrollButtons(), { passive: true });
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.paint(e.target as HTMLButtonElement);
    }, { root: this.items, rootMargin: '400px 0px' });
    this.ro = new ResizeObserver(() => this.build());
    this.ro.observe(root);
    this.build();
  }

  dispose(): void {
    clearTimeout(this.findTimer);
    this.ro.disconnect();
    this.io.disconnect();
  }

  /** 少ないレベルは絵をすぐ作る。多いレベルは見えてから（IntersectionObserver） */
  private get lazy(): boolean {
    return this.game.total > 120;
  }

  private scrollButton(text: string, label: string, dir: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'list-scroll';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => this.items.scrollBy({ top: dir * this.items.clientHeight * 0.8, behavior: 'smooth' }));
    return b;
  }

  /** 駒の絵を作る（リストの幅が変わって、駒の絵の縮尺が変わるときだけ作り直す） */
  private build(): void {
    const pieces = this.game.pieces;
    const maxW = Math.max(...pieces.map((p) => sizeOf(p.cells).w));
    const listW = this.root.clientWidth || 100;
    // 列の数：1 マス 12px で駒が収まる幅（少なくとも 90px）が何本入るか。リストを広げると 2 列・3 列…になる
    const target = Math.max(90, maxW * 12 + 20);
    const usable = listW - 12; // 左右の余白
    const cols = Math.max(1, Math.floor((usable + 6) / (target + 6)));
    const colW = (usable - 6 * (cols - 1)) / cols;
    const cell = Math.max(6, Math.min(16, Math.floor((colW - 20) / maxW)));
    if (cols !== this.cols) {
      this.cols = cols;
      this.items.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    }
    if (cell === this.cell && this.byKey.size) { this.update(); return; }
    this.cell = cell;
    this.byKey.clear();
    this.io.disconnect();
    this.items.replaceChildren();
    for (const ref of this.game.refs()) {
      const key = refKey(ref);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'piece-item';
      item.dataset.piece = key;
      const label = pieceLabel(this.game.level, ref);
      item.setAttribute('aria-label', S.pieceAria(label));
      const activate = (mouse: boolean) => {
        if (this.game.isPlaced(key) && !(this.game.sel && refKey(this.game.sel.ref) === key)) this.onShow(key);
        else this.onPick(ref, mouse);
      };
      item.draggable = false;
      item.addEventListener('pointerdown', (e) => {
        this.mouseDown = e.pointerType === 'mouse';
        if (!this.mouseDown || e.button !== 0) return;
        e.preventDefault(); // 文字の選択・ブラウザのドラッグを始めない
        activate(true);
      });
      item.addEventListener('click', () => {
        // マウスは pointerdown で済ませた。指とキー（Enter・Space）はここ
        if (this.mouseDown) { this.mouseDown = false; return; }
        activate(false);
      });
      this.byKey.set(key, item);
      if (this.lazy) this.io.observe(item);
    }
    this.update();
  }

  /** 駒の絵を、今の状態（置いた／置いていない）で作る */
  private paint(el: HTMLButtonElement): void {
    const state = el.dataset.state;
    if (!state || el.dataset.painted === state) return;
    el.dataset.painted = state;
    const [piece, copy] = el.dataset.piece!.split(':').map(Number);
    const p = this.game.pieces[piece];
    el.innerHTML =
      shapeSvg(p.cells, p.holes, {
        cell: this.cell,
        // 立体に描くため色は #rrggbb で（--orange-mid と同じ色）
        fill: state === 'placed' ? '#555555' : '#ea580c',
        stroke: '#000',
        strokeWidth: 1.2,
        holeFill: 'var(--surface2)',
        bevel: true,
      }) + `<span class="name">${pieceLabel(this.game.level, { piece, copy })}</span>`;
  }

  /** 絵を作るまでの仮の中身（絵と同じ大きさの空き。スクロールの長さが変わらないように） */
  private placeholder(el: HTMLButtonElement): void {
    const [piece, copy] = el.dataset.piece!.split(':').map(Number);
    const { w, h } = sizeOf(this.game.pieces[piece].cells);
    const c = this.cell, extra = 1.2 + c / 4;
    el.innerHTML =
      `<span class="ph" style="display:block;width:${w * c + extra}px;height:${h * c + extra}px"></span>` +
      `<span class="name">${pieceLabel(this.game.level, { piece, copy })}</span>`;
  }

  /** 並び・色・選んでいる印・残りの数を今の状態に合わせる（スクロールの位置は保つ） */
  update(): void {
    const total = this.game.total;
    this.count.textContent = S.remaining(total - this.game.placedCount(), total);
    const selKey = this.game.sel ? refKey(this.game.sel.ref) : null;
    const refs = this.game.refs();
    const free = refs.filter((r) => !this.game.isPlaced(refKey(r)));
    const done = refs.filter((r) => this.game.isPlaced(refKey(r)));
    const want = [...free, ...done].map((r) => this.byKey.get(refKey(r))!);
    const top = this.items.scrollTop;
    want.forEach((el, i) => {
      if (this.items.children[i] !== el) this.items.insertBefore(el, this.items.children[i] ?? null);
    });
    for (const ref of refs) {
      const key = refKey(ref);
      const el = this.byKey.get(key)!;
      const placed = this.game.isPlaced(key);
      const state = placed ? 'placed' : 'free';
      if (el.dataset.state !== state) {
        const first = !el.dataset.state;
        el.dataset.state = state;
        el.classList.toggle('placed', placed);
        if (!this.lazy) this.paint(el);
        else if (first) this.placeholder(el);
        else if (this.near(el)) this.paint(el); // 見えている駒はすぐ描き直す。見えていない駒は見えてから
      }
      el.classList.toggle('selected', key === selKey);
      el.setAttribute('aria-pressed', String(key === selKey));
    }
    this.items.scrollTop = top;
    this.updateScrollButtons();
  }

  /** 選んだ駒がリストの見えるところにあるようにする */
  reveal(key: string): void {
    // scrollIntoView はページまで動かすことがあるので、リストの中だけを動かす
    const el = this.byKey.get(key);
    if (!el) return;
    const box = this.items, top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top - 6;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 6;
  }

  /**
   * 番号（駒の名前。2 個ずつのレベルは「名前-1」でも）の駒を、リストの左上に出す。
   * 盤面に置いてある駒なら、盤面のその駒を光らせ、リストはグレーの所へ動かす（2026-11-06 利用者の指示）
   */
  jump(text: string): boolean {
    const q = text.trim().toLowerCase().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (!q) return false;
    const refs = this.game.refs();
    const exact = refs.filter((r) => pieceLabel(this.game.level, r).toLowerCase() === q);
    const byName = refs.filter((r) => this.game.pieces[r.piece].name.toLowerCase() === q);
    // 名前だけで打ったときは、まだ置いていない方を先に
    const hits = exact.length ? exact : [...byName.filter((r) => !this.game.isPlaced(refKey(r))), ...byName];
    const ref = hits[0];
    if (!ref) {
      this.find.classList.add('miss');
      setTimeout(() => this.find.classList.remove('miss'), 600);
      return false;
    }
    const key = refKey(ref);
    if (this.game.isPlaced(key)) this.onShow(key);
    this.toTop(key);
    return true;
  }

  /** 駒をリストのいちばん上（左上の段）へスクロールして、少し光らせる */
  private toTop(key: string): void {
    const el = this.byKey.get(key);
    if (!el) return;
    const box = this.items;
    box.scrollTop = el.offsetTop - box.offsetTop - 6;
    this.paint(el);
    el.classList.remove('found');
    void el.offsetWidth; // 続けて同じ駒を呼んでも、もう一度光るように
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 1800);
    this.updateScrollButtons();
  }

  /** リストの見えている所（とその近く）にあるか */
  private near(el: HTMLElement): boolean {
    const box = this.items, top = el.offsetTop - box.offsetTop;
    return top + el.offsetHeight >= box.scrollTop - 400 && top <= box.scrollTop + box.clientHeight + 400;
  }

  private updateScrollButtons(): void {
    const el = this.items;
    const overflow = el.scrollHeight > el.clientHeight + 1;
    this.up.hidden = this.down.hidden = !overflow;
    this.up.disabled = el.scrollTop <= 0;
    this.down.disabled = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  }

  private mouseDown = false;

  /** ホイールで動かす（盤面の上のホイールもここへ回す） */
  scrollBy(dy: number): void {
    this.items.scrollTop += dy;
  }
}
