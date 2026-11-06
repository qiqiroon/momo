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
  private readonly items: HTMLElement;
  private readonly up: HTMLButtonElement;
  private readonly down: HTMLButtonElement;
  private readonly byKey = new Map<string, HTMLButtonElement>();
  private readonly ro: ResizeObserver;
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
    this.up = this.scrollButton('▲', S.listUp, -1);
    this.items = document.createElement('div');
    this.items.id = 'piece-items';
    this.down = this.scrollButton('▼', S.listDown, 1);
    root.append(this.head, this.up, this.items, this.down);
    this.items.addEventListener('scroll', () => this.updateScrollButtons(), { passive: true });
    this.ro = new ResizeObserver(() => this.build());
    this.ro.observe(root);
    this.build();
  }

  dispose(): void {
    this.ro.disconnect();
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
    const cell = Math.max(6, Math.min(16, Math.floor((listW - 32) / maxW)));
    if (cell === this.cell && this.byKey.size) { this.update(); return; }
    this.cell = cell;
    this.byKey.clear();
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
    }
    this.update();
  }

  /** 並び・色・選んでいる印・残りの数を今の状態に合わせる（スクロールの位置は保つ） */
  update(): void {
    const total = this.game.total;
    this.head.textContent = S.remaining(total - this.game.placedCount(), total);
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
        el.dataset.state = state;
        el.classList.toggle('placed', placed);
        const p = this.game.pieces[ref.piece];
        el.innerHTML =
          shapeSvg(p.cells, p.holes, {
            cell: this.cell,
            // 立体に描くため色は #rrggbb で（--orange-mid と同じ色）
            fill: placed ? '#555555' : '#ea580c',
            stroke: '#000',
            strokeWidth: 1.2,
            holeFill: 'var(--surface2)',
            bevel: true,
          }) + `<span class="name">${pieceLabel(this.game.level, ref)}</span>`;
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
