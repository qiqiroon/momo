// 遊んでいる最中の状態（置いた駒・選んでいる駒）と、その操作（仕様書 §4）。DOM を触らない。
//
// 選んでいる駒は「アンカー（駒の中心付近の1マス）が盤面のどのマスにあるか」で持つ（§4.3）。
// 回す・裏返すときはアンカーのマスを動かさないので、駒はその場で向きだけ変わる

import { type Cell, holesOf, orient, sizeOf } from './geometry';
import { boardCells, boardSize, piecesOf, pieceTotal, type LevelDef, type PieceDef, type Placement } from './levels';

export interface PieceRef {
  piece: number;
  /** 同じ形が複数個あるレベル（4 レガシー）での何個目か（0 から） */
  copy: number;
}

export const refKey = (r: PieceRef): string => `${r.piece}:${r.copy}`;
const cellKey = (x: number, y: number): string => x + ',' + y;

/**
 * アンカー：駒を囲む最小の長方形の中心に、いちばん近い駒のマス。
 * 同じ近さなら左上寄り（上を先に、次に左）（仕様書 §4.3）
 */
export function anchorOf(cells: readonly Cell[]): Cell {
  const { w, h } = sizeOf(cells);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  let best = cells[0], bd = Infinity;
  for (const c of cells) {
    const d = (c[0] - cx) ** 2 + (c[1] - cy) ** 2;
    const tie = Math.abs(d - bd) < 1e-9;
    if ((!tie && d < bd) || (tie && (c[1] < best[1] || (c[1] === best[1] && c[0] < best[0])))) {
      best = c;
      bd = d;
    }
  }
  return best;
}

/** 時計回り（dir=1）・反時計回り（dir=-1）に 90° 回したときの向きの番号 */
export function rotateO(o: number, dir: 1 | -1): number {
  const f = o >= 4 ? 4 : 0;
  return f + ((o % 4) + (dir > 0 ? 1 : 3)) % 4;
}

/**
 * 画面の上で左右に裏返したときの向きの番号（上下の裏返しは持たない。§4.5）。
 * 鏡 M と回転 R には M·R = R⁻¹·M の関係があるので、裏返すと回転の向きも逆になる
 */
export function flipO(o: number): number {
  return (o >= 4 ? 0 : 4) + (4 - (o % 4)) % 4;
}

export interface Selection {
  ref: PieceRef;
  o: number;
  /** アンカーが乗っている盤面のマス。リストから選んで、まだ盤面に触れていないときは null */
  at: Cell | null;
  /** 盤面に置いてあった駒を選んだときの、もとの置き場所（取り消すとここへ戻る。§4.7） */
  origin: Placement | null;
  /** 選んでから動かした・回した・裏返したか（置いてあった駒は、動かし始めるまでリストでは「置いた」のまま。§4.6） */
  moved: boolean;
}

/** 中身が変わるたびに rev を1つ進める Map（置いた駒の一覧。描き直し・数え直しの目印にする） */
export class TrackedMap<K, V> extends Map<K, V> {
  rev = 0;
  override set(k: K, v: V): this { this.rev++; return super.set(k, v); }
  override delete(k: K): boolean { this.rev++; return super.delete(k); }
  override clear(): void { this.rev++; super.clear(); }
}

/** 駒のある向きの形（駒の番号×8＋向きごとに1回だけ作って使い回す） */
interface Oriented {
  cells: Cell[];
  holes: Cell[];
  anchor: Cell;
  w: number;
  h: number;
}

export class Game {
  readonly pieces: PieceDef[];
  readonly size: { w: number; h: number };
  readonly total: number;
  private readonly board: Set<string>;
  readonly placements = new TrackedMap<string, Placement>();
  sel: Selection | null = null;
  private readonly shapes = new Map<number, Oriented>();
  /** マスごとに、そこに置いてある駒（置いた順）。placements が変わったら作り直す（大きい盤面で毎回全部の駒を調べないため） */
  private occ: { rev: number; map: Map<string, string[]>; conflicts: Set<string>; parked: Set<string> } | null = null;
  /**
   * 盤面のまわりの、駒を逃がしておける余白（マス）。盤面を囲む長方形をこれだけ広げた範囲（area）に駒を置ける。
   * 盤面に1マスもかからない駒は「外に仮置き」：はみ出しにならず、置いた数にも入らない（2026-11-07 利用者の指示）
   */
  readonly pad: number;
  readonly area: { x0: number; y0: number; x1: number; y1: number };

  constructor(readonly level: LevelDef) {
    this.pieces = piecesOf(level);
    this.size = boardSize(level);
    this.total = pieceTotal(level);
    this.board = new Set(boardCells(level).map(([x, y]) => cellKey(x, y)));
    // どの駒も、向きを選べば厚さ2（n≦4）・3（n≧5）マスの帯に収まる。そこから盤面と少し離して置けるよう、さらに2マス広げる（2026-11-07 利用者の指示）
    this.pad = level.n <= 4 ? 4 : 5;
    this.area = { x0: -this.pad, y0: -this.pad, x1: this.size.w + this.pad, y1: this.size.h + this.pad };
  }

  /** すべての駒（同じ形の個数も含めて、リストの基準の並び） */
  refs(): PieceRef[] {
    const out: PieceRef[] = [];
    this.pieces.forEach((_, piece) => { for (let copy = 0; copy < this.level.count; copy++) out.push({ piece, copy }); });
    return out;
  }

  /** 駒のある向きの形・穴・アンカー・大きさ */
  oriented(piece: number, o: number): Oriented {
    const k = piece * 8 + o;
    let v = this.shapes.get(k);
    if (!v) {
      const cells = orient(this.pieces[piece].cells, o);
      const { w, h } = sizeOf(cells);
      v = { cells, holes: holesOf(cells), anchor: anchorOf(cells), w, h };
      this.shapes.set(k, v);
    }
    return v;
  }

  /** 駒が占めるマス（穴あき駒の穴のマスも含む。§6.2） */
  occupied(pl: Placement): Cell[] {
    const v = this.oriented(pl.piece, pl.o);
    const out: Cell[] = [];
    for (const [x, y] of v.cells) out.push([x + pl.x, y + pl.y]);
    for (const [x, y] of v.holes) out.push([x + pl.x, y + pl.y]);
    return out;
  }

  /** 駒の形だけ（穴を除く）。描くとき用 */
  shapeCells(pl: Placement): Cell[] {
    return this.oriented(pl.piece, pl.o).cells.map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
  }

  /** 駒の穴のマス（盤面の上の位置） */
  holeCells(pl: Placement): Cell[] {
    return this.oriented(pl.piece, pl.o).holes.map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
  }

  /** 駒を囲む長方形（マス。x0・y0 から幅 w・高さ h） */
  boxOf(pl: Placement): { x: number; y: number; w: number; h: number } {
    const v = this.oriented(pl.piece, pl.o);
    return { x: pl.x, y: pl.y, w: v.w, h: v.h };
  }

  /** 置いた駒の一覧が変わった回数（描き直しの目印） */
  get rev(): number {
    return this.placements.rev;
  }

  /** マスごとの置いた駒と、重なり・はみ出しのマス（置いた駒が変わったときだけ作り直す） */
  private occupancy(): { map: Map<string, string[]>; conflicts: Set<string>; parked: Set<string> } {
    if (this.occ && this.occ.rev === this.placements.rev) return this.occ;
    const map = new Map<string, string[]>();
    const conflicts = new Set<string>();
    const parked = new Set<string>();
    for (const [key, pl] of this.placements) {
      const cells = this.occupied(pl).map(([x, y]) => cellKey(x, y));
      // 盤面に1マスもかからない駒は外に逃がした駒：はみ出しにしない（重なりは印を付ける）
      const out = !cells.some((k) => this.board.has(k));
      if (out) parked.add(key);
      for (const k of cells) {
        const list = map.get(k);
        if (list) { list.push(key); conflicts.add(k); } else map.set(k, [key]);
        if (!out && !this.board.has(k)) conflicts.add(k);
      }
    }
    this.occ = { rev: this.placements.rev, map, conflicts, parked };
    return this.occ;
  }

  /** 盤面の外に逃がしてある駒か */
  isParked(key: string): boolean {
    if (this.occupancy().parked.has(key)) return true;
    const s = this.sel;
    return !!s && !!s.origin && !s.moved && refKey(s.ref) === key && this.offBoard(s.origin);
  }

  /** 駒が盤面に1マスもかからないか */
  offBoard(pl: Placement): boolean {
    return !this.occupied(pl).some(([x, y]) => this.board.has(cellKey(x, y)));
  }

  /** 盤面にかかっている置いた駒（外に逃がした駒を除く） */
  boardPlacements(): Placement[] {
    const parked = this.occupancy().parked;
    return [...this.placements].filter(([k]) => !parked.has(k)).map(([, pl]) => pl);
  }

  /** 駒を囲む長方形が置ける範囲（area）に収まるよう、アンカーのマスを寄せる */
  private clampAt(piece: number, o: number, at: Cell): Cell {
    const v = this.oriented(piece, o);
    const { x0, y0, x1, y1 } = this.area;
    return [
      Math.max(x0 + v.anchor[0], Math.min(x1 - v.w + v.anchor[0], at[0])),
      Math.max(y0 + v.anchor[1], Math.min(y1 - v.h + v.anchor[1], at[1])),
    ];
  }

  /** 選んでいる駒の置き場所（盤面に触れる前は null） */
  selPlacement(): Placement | null {
    const s = this.sel;
    if (!s || !s.at) return null;
    const a = this.oriented(s.ref.piece, s.o).anchor;
    return { piece: s.ref.piece, copy: s.ref.copy, o: s.o, x: s.at[0] - a[0], y: s.at[1] - a[1] };
  }

  /** 駒を選ぶ。選んでいた駒があれば先に取り消す（§4.7 の 2） */
  select(ref: PieceRef): void {
    if (this.sel) this.cancel();
    const key = refKey(ref);
    const pl = this.placements.get(key);
    if (pl) {
      this.placements.delete(key);
      const a = this.oriented(pl.piece, pl.o).anchor;
      this.sel = { ref, o: pl.o, at: [pl.x + a[0], pl.y + a[1]], origin: pl, moved: false };
    } else {
      this.sel = { ref, o: 0, at: null, origin: null, moved: false };
    }
  }

  /** アンカーを盤面のマスへ動かす（駒が置ける範囲 area に収まるよう寄せる）。動いたら true */
  moveTo(cell: Cell): boolean {
    const s = this.sel;
    if (!s) return false;
    const [x, y] = this.clampAt(s.ref.piece, s.o, cell);
    if (s.at && s.at[0] === x && s.at[1] === y) return false;
    s.at = [x, y];
    s.moved = true;
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    const s = this.sel;
    if (!s || !s.at) return false;
    s.o = rotateO(s.o, dir);
    s.at = this.clampAt(s.ref.piece, s.o, s.at);
    s.moved = true;
    return true;
  }

  flip(): boolean {
    const s = this.sel;
    if (!s || !s.at) return false;
    s.o = flipO(s.o);
    s.at = this.clampAt(s.ref.piece, s.o, s.at);
    s.moved = true;
    return true;
  }

  /** 選んでいる駒のマスのうち、盤面の外にはみ出たマスと、ほかの駒に重なったマス（盤面に1マスもかからなければ、はみ出しにしない） */
  problemCells(): Set<string> {
    const pl = this.selPlacement();
    const out = new Set<string>();
    if (!pl) return out;
    const others = this.occupancy().map;
    const parked = this.offBoard(pl);
    for (const [x, y] of this.occupied(pl)) {
      const k = cellKey(x, y);
      if ((!parked && !this.board.has(k)) || others.has(k)) out.add(k);
    }
    return out;
  }

  /** 確定できるか（重なり・はみ出しがある間は確定できない。§4.3） */
  canConfirm(): boolean {
    return !!this.selPlacement() && this.problemCells().size === 0;
  }

  /**
   * 確定する。force のときは、はみ出し・重なりがあっても置く（PC のマウス操作。2026-11-06 利用者の指示）。
   * そうして置いた駒の重なりは conflictCells で分かり、重なりがある間は完成にならない
   */
  confirm(force = false): boolean {
    if (!this.selPlacement()) return false;
    if (!force && !this.canConfirm()) return false;
    const pl = this.selPlacement()!;
    this.placements.set(refKey(this.sel!.ref), pl);
    this.sel = null;
    return true;
  }

  /** 取り消す。盤面に置いてあった駒はもとの場所へ、リストから選んだ駒はリストへ戻る（§4.7） */
  cancel(): void {
    const s = this.sel;
    if (!s) return;
    if (s.origin) this.placements.set(refKey(s.ref), s.origin);
    this.sel = null;
  }

  /** 選んでいる駒をリストへ戻す（盤面に置いてあった駒も、もとの場所には戻さずリストへ。2026-11-06 利用者の指示） */
  returnToList(): boolean {
    if (!this.sel) return false;
    this.sel = null;
    return true;
  }

  /** 盤面を空に戻す（§4.9） */
  reset(): void {
    this.sel = null;
    this.placements.clear();
  }

  /**
   * 保存しておいた置き場所から戻す（§10）。駒の番号・向きが合わないもの、アンカーが盤面の外に出るものは捨てる
   * （解データを作り直して駒の並びが変わった場合などに備える）
   */
  restore(list: readonly unknown[]): void {
    this.reset();
    for (const item of list) {
      const pl = item as Partial<Placement> | null;
      if (!pl || ![pl.piece, pl.copy, pl.o, pl.x, pl.y].every((v) => Number.isInteger(v))) continue;
      const { piece, copy, o, x, y } = pl as Placement;
      if (!this.pieces[piece] || copy < 0 || copy >= this.level.count || o < 0 || o > 7) continue;
      if (this.placements.has(refKey({ piece, copy }))) continue;
      const a = this.oriented(piece, o).anchor;
      const at: Cell = [x + a[0], y + a[1]];
      // 駒は置ける範囲（area）の中にしか置けない（moveTo と同じ）。重なり・はみ出し・外への仮置きはそのまま戻す
      const c = this.clampAt(piece, o, at);
      if (c[0] !== at[0] || c[1] !== at[1]) continue;
      this.sel = { ref: { piece, copy }, o, at, origin: null, moved: true };
      this.confirm(true);
      this.sel = null;
    }
  }

  /** 置いた駒どうしの重なりと、盤面からのはみ出しのマス（PC で無理に置いたとき） */
  conflictCells(): Set<string> {
    return this.occupancy().conflicts;
  }

  /** そのマスに置いてある駒（選んでいる駒は除く。重なっていれば後から置いた駒） */
  placedAt(cell: Cell): string | null {
    const list = this.occupancy().map.get(cellKey(cell[0], cell[1]));
    return list ? list[list.length - 1] : null;
  }

  /** リストで「置いた」と出すか（置いてあった駒を選んだだけで、まだ動かしていないときも「置いた」）。外に逃がした駒は入れない */
  isPlaced(key: string): boolean {
    if (this.placements.has(key)) return !this.occupancy().parked.has(key);
    const s = this.sel;
    return !!s && !!s.origin && !s.moved && refKey(s.ref) === key && !this.offBoard(s.origin);
  }

  /** リストでの状態：置いた・外に逃がした・まだ置いていない */
  stateOf(key: string): 'placed' | 'parked' | 'free' {
    return this.isPlaced(key) ? 'placed' : this.isParked(key) ? 'parked' : 'free';
  }

  placedCount(): number {
    return this.refs().filter((r) => this.isPlaced(refKey(r))).length;
  }

  /** 完成：全部の駒が確定していて、盤面の全マスが駒のマスか駒の穴で覆われている（§6.2） */
  isComplete(): boolean {
    if (this.sel || this.placements.size !== this.total) return false;
    const { map, conflicts, parked } = this.occupancy();
    return parked.size === 0 && conflicts.size === 0 && map.size === this.board.size;
  }
}
