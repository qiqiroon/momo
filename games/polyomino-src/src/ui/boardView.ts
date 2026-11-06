// 盤面を canvas に描く。大きい盤面（n=8 で 2958 マス）でも軽く描けるよう、駒ごとの DOM は作らない。
// 見る位置と大きさ（拡大縮小・スクロール。仕様書 §4.8）もここで持つ。操作の受け付けは boardControl.ts

import { type Cell, holesOf, orient, outlineEdges } from '../core/geometry';
import { type Game, refKey } from '../core/game';
import { boardCells, type Placement } from '../core/levels';
import { pieceColors } from '../core/progress';
import { shade } from './shapeSvg';

/** 盤面の上の駒の色（オレンジの濃淡）。どの駒が何色かは、完成形で隣どうしが違う色になるよう決める（core/progress の pieceColors） */
const PIECE_FILLS = ['#fb923c', '#ea580c', '#c2410c', '#fdba74', '#f97316', '#9a3412'];
/** 拡大の上限：1マスがおよそこの大きさ（px）。駒リストの駒（1マス 16〜20px）の約 3 倍（§4.8） */
const MAX_CELL = 60;
const MARGIN = 18; // 盤面のまわりの余白（お盆の縁が入る幅）

interface Anim {
  /** 描き始めの回転（度）と左右の向き（-1 は鏡うつし）。時間とともに 0・1 へ寄せる */
  angle: number;
  flip: number;
  t0: number;
  dur: number;
}

export class BoardView {
  /** 今描いている先（画面の canvas か、置いた駒をまとめた下絵） */
  private ctx: CanvasRenderingContext2D;
  private readonly screenCtx: CanvasRenderingContext2D;
  /** 盤面と置いた駒の下絵（変わったときだけ描き直す。ぼかした影は重いので、駒を動かすたびに全部は描かない） */
  private readonly layer = document.createElement('canvas');
  private readonly layerCtx: CanvasRenderingContext2D;
  private layerSig = '';
  private dpr = 1;
  private readonly cells: Cell[];
  private readonly ro: ResizeObserver;
  /** 1マスの大きさ（CSS px）と、盤面の左上が来る画面上の位置 */
  scale = 0;
  tx = 0;
  ty = 0;
  /** 盤面全体を表示している状態か（画面の大きさが変わったら、全体表示に合わせ直す） */
  private fitted = true;
  private anim: Anim | null = null;
  /** なぞって回している途中の角度（度） */
  liveAngle = 0;
  private flash: { key: string; until: number } | null = null;
  private raf = 0;
  /** 描いたあとに呼ぶ（浮かぶボタンの位置合わせなど） */
  onDraw: (() => void) | null = null;
  private viewW = 0;
  private viewH = 0;
  private readonly colors: Map<string, number>;
  /** 開始時の解提示（§6.1）。見せている間は置いた駒の代わりに完成形を描き、そのあと右（駒リストの方）へ飛ばす */
  private reveal: { t0: number; show: number; fly: number; onEnd: () => void } | null = null;
  /** 完成の演出（§6.2）：左から右へ光が走る */
  private cheer: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly game: Game) {
    this.ctx = this.screenCtx = canvas.getContext('2d')!;
    this.layerCtx = this.layer.getContext('2d')!;
    this.cells = boardCells(game.level);
    this.colors = pieceColors(game.level);
    this.ro = new ResizeObserver(() => this.invalidate());
    this.ro.observe(canvas);
  }

  dispose(): void {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  get width(): number { return this.canvas.clientWidth; }
  get height(): number { return this.canvas.clientHeight; }

  // ── 見る位置と大きさ

  fitScale(): number {
    const { w, h } = this.game.size;
    return Math.max(2, Math.min((this.width - MARGIN * 2) / w, (this.height - MARGIN * 2) / h, MAX_CELL));
  }

  maxScale(): number {
    return Math.max(MAX_CELL, this.fitScale());
  }

  isFitted(): boolean {
    return this.fitted;
  }

  /** 盤面全体を表示する（いちばん縮めた状態。§4.8） */
  fit(): void {
    this.scale = this.fitScale();
    this.fitted = true;
    this.clamp();
    this.invalidate();
  }

  /** 画面上の点（px, py）を動かさずに拡大・縮小する */
  zoomAt(factor: number, px: number, py: number): void {
    const s = Math.max(this.fitScale(), Math.min(this.maxScale(), this.scale * factor));
    if (s === this.scale) return;
    this.tx = px - ((px - this.tx) * s) / this.scale;
    this.ty = py - ((py - this.ty) * s) / this.scale;
    this.scale = s;
    this.fitted = s <= this.fitScale() + 1e-6;
    this.clamp();
    this.invalidate();
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.clamp();
    this.invalidate();
  }

  /** 盤面が画面より小さい向きは真ん中に、大きい向きは端が画面の内側に入りすぎないようにする */
  private clamp(): void {
    if (this.fitted) this.scale = this.fitScale();
    const { w, h } = this.game.size;
    const bw = this.scale * w, bh = this.scale * h;
    this.tx = bw + MARGIN * 2 <= this.width + 0.5
      ? (this.width - bw) / 2
      : Math.min(MARGIN, Math.max(this.width - bw - MARGIN, this.tx));
    this.ty = bh + MARGIN * 2 <= this.height + 0.5
      ? (this.height - bh) / 2
      : Math.min(MARGIN, Math.max(this.height - bh - MARGIN, this.ty));
  }

  /** それぞれの向きに、まだ見えていない盤面があるか（スクロールボタンを出す向き） */
  canPan(): { left: boolean; right: boolean; up: boolean; down: boolean } {
    const { w, h } = this.game.size;
    return {
      left: this.tx < MARGIN - 0.5,
      right: this.tx + this.scale * w > this.width - MARGIN + 0.5,
      up: this.ty < MARGIN - 0.5,
      down: this.ty + this.scale * h > this.height - MARGIN + 0.5,
    };
  }

  /** 画面上の点がどのマスか（盤面の外でも、その延長のマスを返す） */
  toCell(px: number, py: number): Cell {
    return [Math.floor((px - this.tx) / this.scale), Math.floor((py - this.ty) / this.scale)];
  }

  /** マスの集まりが画面上で占める長方形 */
  rectOf(cells: readonly Cell[]): { x: number; y: number; w: number; h: number } {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of cells) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    const s = this.scale;
    return { x: this.tx + x0 * s, y: this.ty + y0 * s, w: (x1 - x0) * s, h: (y1 - y0) * s };
  }

  /** 選んでいる駒のアンカーのマスの中心（画面上） */
  anchorPoint(): { x: number; y: number } | null {
    const at = this.game.sel?.at;
    if (!at) return null;
    return { x: this.tx + (at[0] + 0.5) * this.scale, y: this.ty + (at[1] + 0.5) * this.scale };
  }

  /** 置いた駒が見えるところまで動かし、少しのあいだ光らせる（リストのグレーの駒を押したとき。§3.2） */
  showPiece(key: string): void {
    const pl = this.game.placements.get(key);
    if (!pl) return;
    const r = this.rectOf(this.game.occupied(pl));
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.width || r.y + r.h > this.height) {
      this.panBy(this.width / 2 - cx, this.height / 2 - cy);
    }
    this.flash = { key, until: performance.now() + 900 };
    this.invalidate();
  }

  /** マスの集まりが画面の外にはみ出していたら、真ん中に来るよう動かす（ヒントの駒を見せるとき） */
  showCells(cells: readonly Cell[]): void {
    const r = this.rectOf(cells);
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.width || r.y + r.h > this.height) {
      this.panBy(this.width / 2 - (r.x + r.w / 2), this.height / 2 - (r.y + r.h / 2));
    }
    this.invalidate();
  }

  // ── 動き

  /** 回したあと：fromDeg 度だけ戻った姿から、なめらかに今の向きへ回る（§4.5） */
  animateRotate(fromDeg: number): void {
    this.anim = { angle: fromDeg, flip: 1, t0: performance.now(), dur: 160 };
    this.invalidate();
  }

  animateFlip(): void {
    this.anim = { angle: 0, flip: -1, t0: performance.now(), dur: 180 };
    this.invalidate();
  }

  /** 完成形を見せ、少し置いてから駒を右へ飛ばす。終わったら（または skipReveal で）onEnd を呼ぶ */
  startReveal(onEnd: () => void, show = 1800, fly = 900): void {
    this.reveal = { t0: performance.now(), show, fly, onEnd };
    this.invalidate();
  }

  get revealing(): boolean {
    return !!this.reveal;
  }

  /** 解提示を飛ばす（触れたら始める） */
  skipReveal(): void {
    const r = this.reveal;
    if (!r) return;
    const now = performance.now();
    // 見せている途中なら、すぐ飛ばし始める。飛んでいる途中なら終わらせる
    if (now - r.t0 < r.show) r.t0 = now - r.show;
    else this.finishReveal();
    this.invalidate();
  }

  private finishReveal(): void {
    const r = this.reveal;
    if (!r) return;
    this.reveal = null;
    r.onEnd();
  }

  celebrate(): void {
    this.cheer = performance.now();
    this.invalidate();
  }

  invalidate(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  // ── 描く

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.width, cssH = this.height;
    if (!cssW || !cssH) return;
    if (cssW !== this.viewW || cssH !== this.viewH || !this.scale) {
      this.viewW = cssW;
      this.viewH = cssH;
      this.clamp();
    }
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.dpr = dpr;
    const now = performance.now();
    const cell = this.scale;
    const css = getComputedStyle(document.documentElement);
    const light = css.getPropertyValue('--orange-light').trim() || '#fb923c';

    // 下絵（盤面＋置いた駒）。見る位置・大きさ・置いた駒が変わったときだけ描き直す
    const sig = [cssW, cssH, dpr, this.scale, this.tx, this.ty, this.reveal ? 'r' : '', JSON.stringify([...this.game.placements])].join('|');
    if (sig !== this.layerSig) {
      this.layerSig = sig;
      if (this.layer.width !== this.canvas.width || this.layer.height !== this.canvas.height) {
        this.layer.width = this.canvas.width;
        this.layer.height = this.canvas.height;
      }
      this.ctx = this.layerCtx;
      this.drawLayer(cssW, cssH, dpr);
      this.ctx = this.screenCtx;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.layer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.reveal) {
      this.drawReveal(now);
      this.drawLip();
      if (this.reveal) this.invalidate();
      this.onDraw?.();
      return;
    }

    // 置いた駒の上の光（完成の光・リストから呼んだ駒の点滅）
    const cheerW = this.game.size.w + 6;
    for (const [key, pl] of this.game.placements) {
      if (this.cheer !== null) {
        // 完成の光：駒の左端から順に、白い枠が光って消える
        const t = (now - this.cheer) / 1400 - pl.x / cheerW;
        if (t > 0 && t < 0.45) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = Math.max(2, Math.min(5, cell / 5));
          g.globalAlpha = Math.sin((t / 0.45) * Math.PI);
          this.strokeEdges(outlineEdges(this.game.shapeCells(pl)));
          g.globalAlpha = 1;
        }
      }
      if (this.flash && this.flash.key === key && now < this.flash.until) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = Math.max(2, Math.min(4, cell / 6));
        g.globalAlpha = 0.3 + 0.7 * Math.sin(((this.flash.until - now) / 900) * Math.PI * 3) ** 2;
        this.strokeEdges(outlineEdges(this.game.shapeCells(pl)));
        g.globalAlpha = 1;
      }
    }
    if (this.flash && now >= this.flash.until) this.flash = null;
    if (this.cheer !== null && now - this.cheer > 1400 * 1.5) this.cheer = null;

    // 選んでいる駒（仮置き。§4.3）。持ち上げた駒として、大きめの影を付け、枠を明るい色で描く
    const sp = this.game.selPlacement();
    if (sp) {
      let angle = this.liveAngle, flip = 1;
      if (this.anim) {
        const t = Math.min(1, (now - this.anim.t0) / this.anim.dur);
        const e = 1 - (1 - t) ** 3;
        angle += this.anim.angle * (1 - e);
        flip = this.anim.flip + (1 - this.anim.flip) * e;
        if (t >= 1) this.anim = null;
      }
      const a = this.anchorPoint()!;
      g.save();
      g.translate(a.x, a.y);
      g.rotate((angle * Math.PI) / 180);
      g.scale(Math.abs(flip) < 0.04 ? 0.04 : flip, 1);
      g.translate(-a.x, -a.y);
      const shape = this.game.shapeCells(sp);
      this.drawPiece(sp, this.fillOf(refKey(sp)), 2.4);
      // はみ出し・重なりのマスは白い斜線
      if (!this.anim && !this.liveAngle) this.stripes(this.game.problemCells(), cssW, cssH);
      g.strokeStyle = light;
      g.lineWidth = Math.max(2, Math.min(4, cell / 7));
      g.lineCap = 'round';
      this.strokeEdges(outlineEdges(shape));
      // アンカーのしるし
      g.fillStyle = light;
      g.beginPath();
      g.arc(a.x, a.y, Math.max(2, Math.min(5, cell / 8)), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    if (this.anim || this.flash || this.cheer !== null) this.invalidate();
    this.onDraw?.();
  }

  /** 下絵を描く：盤面（マス・くぼみ・枠）と、置いた駒（影を先に全部、そのあと駒）、無理に置いた駒の斜線 */
  private drawLayer(cssW: number, cssH: number, dpr: number): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.layer.width, this.layer.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = this.scale, ox = this.tx, oy = this.ty;
    const css = getComputedStyle(document.documentElement);
    const surface2 = css.getPropertyValue('--surface2').trim() || '#1a1a1a';
    const border = css.getPropertyValue('--border-strong').trim() || '#444';
    const frame = css.getPropertyValue('--orange').trim() || '#c2410c';

    // 盤面のマス
    g.fillStyle = surface2;
    for (const [x, y] of this.cells) g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    // マスの目（細い線。小さすぎるときは描かない）
    if (cell >= 6) {
      g.strokeStyle = border;
      g.lineWidth = 1;
      g.beginPath();
      for (const [x, y] of this.cells) g.rect(ox + x * cell + 0.5, oy + y * cell + 0.5, cell - 1, cell - 1);
      g.globalAlpha = 0.5;
      g.stroke();
      g.globalAlpha = 1;
    }
    // 盤面のくぼみ（立体表示：駒が置かれる「お盆」に見せる）。
    // オレンジの枠線は手前に浮いて見え、くぼみに見えなくなる（2026-11-06 利用者）ので、立体のときは引かない
    const bevel = this.bevel();
    if (!bevel) {
      // 小さくて立体にできないときは、盤面の外周を線で示す
      g.strokeStyle = frame;
      g.lineWidth = Math.max(1.5, Math.min(3, cell / 8));
      g.lineCap = 'square';
      this.strokeEdges(outlineEdges(this.cells));
    }

    if (this.reveal) return; // 解提示の間は、駒を描いたあとで drawLip を画面に描く
    // 置いた駒（色は駒ごとに決まった色。置き直しても変わらない）。
    // 影を先に全部描く（あとから描いた駒の影が、先に描いた駒の上に落ちないように）
    for (const pl of this.game.placements.values()) this.drawShadow(pl, 1);
    for (const [key, pl] of this.game.placements) this.drawPiece(pl, this.fillOf(key), 1, false);
    // 無理に置いた駒（PC）の重なり・はみ出しは白い斜線
    this.stripes(this.game.conflictCells(), cssW, cssH);
    this.drawLip();
  }

  /**
   * お盆の縁（盤面のまわりを囲む壁）。駒より少し高く見せる（2026-11-06 利用者の指示）。
   * 駒より後に描くので、駒の影は縁に落ちず（縁の下に隠れる）、縁の影が盤面と駒の上に落ちる。
   * 縁の形は盤面を含まない輪（lipPath）。輪の落ち影が、外側には床へ、内側には盤面の上と左に落ちる
   */
  private drawLip(): void {
    const b = this.bevel();
    if (!b) return;
    const g = this.ctx, cell = this.scale;
    const lipW = b * 1.2;
    const lip = this.lipPath(lipW);
    const gl = g.createLinearGradient(this.tx, this.ty, this.tx + cell * this.game.size.w, this.ty + cell * this.game.size.h);
    gl.addColorStop(0, '#57504a');
    gl.addColorStop(1, '#3a3531');
    g.save();
    // 落ち影：駒の影（縁の幅の 0.5・0.8 倍）より遠くへ落とす＝駒より少し高い
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = lipW * 1.3 * this.dpr;
    g.shadowOffsetX = lipW * 0.7 * this.dpr;
    g.shadowOffsetY = lipW * 1.1 * this.dpr;
    g.fillStyle = gl;
    g.fill(lip);
    g.restore();
    // 縁の上面の角：左上に光・右下に陰（外側の角も、内側の角も。駒の縁と同じ描き方）
    this.inset(lip, 'rgba(255,255,255,0.3)', lipW * 0.15, lipW * 0.14, lipW * 0.14);
    this.inset(lip, 'rgba(0,0,0,0.6)', lipW * 0.2, -lipW * 0.18, -lipW * 0.18);
  }

  private fillOf(key: string): string {
    return PIECE_FILLS[(this.colors.get(key) ?? 0) % PIECE_FILLS.length];
  }

  /** 解提示：完成形を描く。飛ぶ時間に入ったら、駒ごとに少しずつずらして右へ飛ばし、うすくする */
  private drawReveal(now: number): void {
    const r = this.reveal!;
    const g = this.ctx;
    const t = now - r.t0 - r.show;
    const sol = this.game.level.solution;
    const n = sol.length;
    let allGone = t > 0;
    // 影を先に全部描き、そのあと駒を描く（隣の駒の上に影が落ちないように）
    for (const pass of ['shadow', 'piece'] as const) sol.forEach((pl, i) => {
      const key = refKey(pl);
      // 右の駒から先に飛ぶ（リストに近い方から）
      const order = n > 1 ? 1 - pl.x / Math.max(1, this.game.size.w) : 0;
      const p = t <= 0 ? 0 : Math.max(0, Math.min(1, (t - order * r.fly * 0.45) / (r.fly * 0.55)));
      if (p < 1 && pass === 'piece') allGone = false;
      if (p >= 1) return;
      const e = p * p;
      const rect = this.rectOf(this.game.occupied(pl));
      const dx = e * (this.width - rect.x + 40);
      const dy = e * ((i % 7) - 3) * 6;
      g.save();
      g.globalAlpha = 1 - e * 0.8;
      g.translate(rect.x + rect.w / 2 + dx, rect.y + rect.h / 2 + dy);
      const s = 1 - e * 0.5;
      g.scale(s, s);
      g.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
      if (pass === 'shadow') this.drawShadow(pl, 1 + e * 3);
      else this.drawPiece(pl, this.fillOf(key), 1, false);
      g.restore();
    });
    if (allGone) this.finishReveal();
  }

  /** 立体表示の縁（駒のまわりの出っ張り）の幅（1マスの 4 分の 1。2026-11-06 利用者の指示）。小さすぎて見えないときは 0＝平らに描く */
  private bevel(): number {
    const b = this.scale / 4;
    return b >= 1.5 ? b : 0;
  }

  /** マスの集まりを 1 つの形にした Path2D（今の見る位置・大きさで） */
  private cellsPath(cells: readonly Cell[]): Path2D {
    const path = new Path2D(), s = this.scale;
    for (const [x, y] of cells) path.rect(this.tx + x * s, this.ty + y * s, s, s);
    return path;
  }

  /**
   * ぼかした影を、形 region の内側にだけ落とす（内側の陰影）。
   * 形の外側を塗り、その影だけを形の内側に落とす。影のずらし幅・ぼかしは CSS px で渡す（canvas の影は変形を受けないので、ここで画素に直す）
   */
  private inset(region: Path2D, color: string, blur: number, dx: number, dy: number): void {
    const g = this.ctx;
    g.save();
    g.clip(region);
    const ring = new Path2D();
    ring.rect(-1e5, -1e5, 2e5, 2e5);
    ring.addPath(region);
    g.shadowColor = color;
    g.shadowBlur = blur * this.dpr;
    g.shadowOffsetX = dx * this.dpr;
    g.shadowOffsetY = dy * this.dpr;
    g.fillStyle = '#000';
    g.fill(ring, 'evenodd');
    g.restore();
  }

  /** ぼかした落ち影。形そのものは画面の外に塗り、影だけを（変形に関係なく）右下へ落とす */
  private drawShadow(pl: Placement, lift: number): void {
    const r = this.bevel();
    if (!r) return;
    const g = this.ctx;
    const far = 1e5;
    const m = g.getTransform();
    g.save();
    g.translate(-far, 0);
    const devX = -far * m.a, devY = -far * m.b; // 画面の外へずらした分（画素）
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = r * (0.9 + lift * 0.5) * this.dpr;
    g.shadowOffsetX = r * 0.5 * lift * this.dpr - devX;
    g.shadowOffsetY = r * 0.8 * lift * this.dpr - devY;
    g.fillStyle = '#000';
    g.fill(this.cellsPath(this.game.shapeCells(pl)));
    g.restore();
  }

  /**
   * お盆の縁の形：盤面のまわりの幅 w の輪（盤面は含まない）。重なりの無い四角だけで作る（inset の evenodd が欠けないように）。
   * 盤面の外の空きマスのうち、盤面に接する辺の帯（角を除く）＋盤面のマスが周りにある角の w×w
   */
  private lipPath(w: number): Path2D {
    const set = new Set(this.cells.map(([x, y]) => x + ',' + y));
    const has = (x: number, y: number) => set.has(x + ',' + y);
    const s = this.scale, path = new Path2D(), m = s - 2 * w;
    const empties = new Set<string>();
    for (const [x, y] of this.cells) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!has(x + dx, y + dy)) empties.add(x + dx + ',' + (y + dy));
    }
    for (const k of empties) {
      const [x, y] = k.split(',').map(Number);
      const X = this.tx + x * s, Y = this.ty + y * s;
      if (has(x, y - 1)) path.rect(X + w, Y, m, w);
      if (has(x, y + 1)) path.rect(X + w, Y + s - w, m, w);
      if (has(x - 1, y)) path.rect(X, Y + w, w, m);
      if (has(x + 1, y)) path.rect(X + s - w, Y + w, w, m);
      if (has(x - 1, y) || has(x, y - 1) || has(x - 1, y - 1)) path.rect(X, Y, w, w);
      if (has(x + 1, y) || has(x, y - 1) || has(x + 1, y - 1)) path.rect(X + s - w, Y, w, w);
      if (has(x - 1, y) || has(x, y + 1) || has(x - 1, y + 1)) path.rect(X, Y + s - w, w, w);
      if (has(x + 1, y) || has(x, y + 1) || has(x + 1, y + 1)) path.rect(X + s - w, Y + s - w, w, w);
    }
    return path;
  }

  /** 中の板の形：駒の形を縁の幅 r だけ内側へ縮めたもの（マスを 9 つに分け、つながる向きの分だけ残す） */
  private platePath(cells: readonly Cell[], r: number): Path2D {
    const set = new Set(cells.map(([x, y]) => x + ',' + y));
    const has = (x: number, y: number) => set.has(x + ',' + y);
    const s = this.scale, path = new Path2D(), m = s - 2 * r;
    for (const [x, y] of cells) {
      const X = this.tx + x * s, Y = this.ty + y * s;
      const L = has(x - 1, y), R = has(x + 1, y), T = has(x, y - 1), B = has(x, y + 1);
      path.rect(X + r, Y + r, m, m);
      if (T) path.rect(X + r, Y, m, r);
      if (B) path.rect(X + r, Y + s - r, m, r);
      if (L) path.rect(X, Y + r, r, m);
      if (R) path.rect(X + s - r, Y + r, r, m);
      if (T && L && has(x - 1, y - 1)) path.rect(X, Y, r, r);
      if (T && R && has(x + 1, y - 1)) path.rect(X + s - r, Y, r, r);
      if (B && L && has(x - 1, y + 1)) path.rect(X, Y + s - r, r, r);
      if (B && R && has(x + 1, y + 1)) path.rect(X + s - r, Y + s - r, r, r);
    }
    return path;
  }

  /**
   * 駒を立体に描く（2026-11-06 利用者の指示：H 鋼のような形で、本物らしく）。
   * 真ん中は薄い板で、まわりを幅（1マスの 4 分の 1）の縁が上下に出っ張って囲む。光は左上から当たる。上から見ると:
   *   縁の上面 … 駒の色に、左上が明るく右下が少し暗いつや（グラデーション）。外側の左上の角はぼかした光、右下はぼかした陰
   *   中の板 … 縁より一段低く暗い。左上の縁から、ぼかした影が落ちる。右下の縁の足もとはうすく明るい（照り返し）
   * 穴あき駒の穴は形に含めないので下の盤面が見え、穴のまわりも同じ縁で囲まれる。
   * lift は浮かせ具合（影の遠さ・ぼけ。置いた駒は 1）
   */
  private drawPiece(pl: Placement, fill: string, lift = 1, shadow = true): void {
    const g = this.ctx;
    const shape = this.game.shapeCells(pl);
    const path = this.cellsPath(shape);
    const r = this.bevel();
    if (shadow) this.drawShadow(pl, lift);
    if (!r) {
      g.fillStyle = fill;
      g.fill(path);
    } else {
      const box = this.rectOf(shape);
      // 縁の上面（つや）
      const gr = g.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      gr.addColorStop(0, shade(fill, 0.11)); // 左上の明るさは控えめに（2026-11-06 利用者：光りすぎ→半分）
      gr.addColorStop(0.5, fill);
      gr.addColorStop(1, shade(fill, -0.14));
      g.fillStyle = gr;
      g.fill(path);
      // 縁の外側の面（左上に光、右下に陰）
      this.inset(path, 'rgba(255,255,255,0.35)', r * 0.18, r * 0.16, r * 0.16);
      this.inset(path, 'rgba(0,0,0,0.55)', r * 0.22, -r * 0.2, -r * 0.2);
      // 中の板
      const plate = this.platePath(shape, r);
      const gp = g.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      gp.addColorStop(0, shade(fill, -0.12));
      gp.addColorStop(1, shade(fill, -0.32));
      g.fillStyle = gp;
      g.fill(plate);
      this.inset(plate, 'rgba(0,0,0,0.7)', r * 0.5, r * 0.3, r * 0.38); // 左上の縁から落ちる影
      this.inset(plate, 'rgba(255,255,255,0.1)', r * 0.15, -r * 0.12, -r * 0.12); // 右下の縁の照り返し
      // 縁と板の境目（段の角）をくっきりさせる細い線：左上は暗く、右下は明るく
      this.inset(plate, 'rgba(0,0,0,0.55)', 0, 1, 1);
      this.inset(plate, 'rgba(255,255,255,0.18)', 0, -1, -1);
    }
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = Math.max(1, Math.min(1.5, this.scale / 20));
    g.lineCap = 'square';
    this.strokeEdges(outlineEdges(shape));
    const holes = holesOf(orient(this.game.pieces[pl.piece].cells, pl.o)).map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
    if (holes.length) this.strokeEdges(outlineEdges(holes));
  }

  /** マス（"x,y" の集まり）に白い斜線を引く（はみ出し・重なりのしるし） */
  private stripes(cellKeys: ReadonlySet<string>, w: number, h: number): void {
    if (!cellKeys.size) return;
    const g = this.ctx, cell = this.scale;
    g.save();
    g.beginPath();
    for (const k of cellKeys) {
      const [x, y] = k.split(',').map(Number);
      g.rect(this.tx + x * cell, this.ty + y * cell, cell, cell);
    }
    g.clip();
    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.75;
    g.lineWidth = Math.max(1, cell / 14);
    const step = Math.max(4, cell / 4);
    g.beginPath();
    for (let d = -h; d < w + h; d += step) { g.moveTo(d, 0); g.lineTo(d + h, h); }
    g.stroke();
    g.restore();
  }

  private strokeEdges(edges: Array<[number, number, number, number]>): void {
    const g = this.ctx, cell = this.scale, ox = this.tx, oy = this.ty;
    g.beginPath();
    for (const [x1, y1, x2, y2] of edges) {
      g.moveTo(ox + x1 * cell, oy + y1 * cell);
      g.lineTo(ox + x2 * cell, oy + y2 * cell);
    }
    g.stroke();
  }
}

