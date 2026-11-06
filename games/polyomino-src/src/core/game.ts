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

export class Game {
  readonly pieces: PieceDef[];
  readonly size: { w: number; h: number };
  readonly total: number;
  private readonly board: Set<string>;
  readonly placements = new Map<string, Placement>();
  sel: Selection | null = null;

  constructor(readonly level: LevelDef) {
    this.pieces = piecesOf(level);
    this.size = boardSize(level);
    this.total = pieceTotal(level);
    this.board = new Set(boardCells(level).map(([x, y]) => cellKey(x, y)));
  }

  /** すべての駒（同じ形の個数も含めて、リストの基準の並び） */
  refs(): PieceRef[] {
    const out: PieceRef[] = [];
    this.pieces.forEach((_, piece) => { for (let copy = 0; copy < this.level.count; copy++) out.push({ piece, copy }); });
    return out;
  }

  /** 駒が占めるマス（穴あき駒の穴のマスも含む。§6.2） */
  occupied(pl: Placement): Cell[] {
    const shape = orient(this.pieces[pl.piece].cells, pl.o);
    return [...shape, ...holesOf(shape)].map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
  }

  /** 駒の形だけ（穴を除く）。描くとき用 */
  shapeCells(pl: Placement): Cell[] {
    return orient(this.pieces[pl.piece].cells, pl.o).map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
  }

  /** 選んでいる駒の置き場所（盤面に触れる前は null） */
  selPlacement(): Placement | null {
    const s = this.sel;
    if (!s || !s.at) return null;
    const a = anchorOf(orient(this.pieces[s.ref.piece].cells, s.o));
    return { piece: s.ref.piece, copy: s.ref.copy, o: s.o, x: s.at[0] - a[0], y: s.at[1] - a[1] };
  }

  /** 駒を選ぶ。選んでいた駒があれば先に取り消す（§4.7 の 2） */
  select(ref: PieceRef): void {
    if (this.sel) this.cancel();
    const key = refKey(ref);
    const pl = this.placements.get(key);
    if (pl) {
      this.placements.delete(key);
      const a = anchorOf(orient(this.pieces[pl.piece].cells, pl.o));
      this.sel = { ref, o: pl.o, at: [pl.x + a[0], pl.y + a[1]], origin: pl, moved: false };
    } else {
      this.sel = { ref, o: 0, at: null, origin: null, moved: false };
    }
  }

  /** アンカーを盤面のマスへ動かす（盤面を囲む長方形の中に収める）。動いたら true */
  moveTo(cell: Cell): boolean {
    const s = this.sel;
    if (!s) return false;
    const x = Math.max(0, Math.min(this.size.w - 1, cell[0]));
    const y = Math.max(0, Math.min(this.size.h - 1, cell[1]));
    if (s.at && s.at[0] === x && s.at[1] === y) return false;
    s.at = [x, y];
    s.moved = true;
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    const s = this.sel;
    if (!s || !s.at) return false;
    s.o = rotateO(s.o, dir);
    s.moved = true;
    return true;
  }

  flip(): boolean {
    const s = this.sel;
    if (!s || !s.at) return false;
    s.o = flipO(s.o);
    s.moved = true;
    return true;
  }

  /** 選んでいる駒のマスのうち、盤面の外にはみ出たマスと、ほかの駒に重なったマス */
  problemCells(): Set<string> {
    const pl = this.selPlacement();
    const out = new Set<string>();
    if (!pl) return out;
    const others = new Set<string>();
    for (const p of this.placements.values()) for (const [x, y] of this.occupied(p)) others.add(cellKey(x, y));
    for (const [x, y] of this.occupied(pl)) {
      const k = cellKey(x, y);
      if (!this.board.has(k) || others.has(k)) out.add(k);
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
      const a = anchorOf(orient(this.pieces[piece].cells, o));
      const at: Cell = [x + a[0], y + a[1]];
      // アンカーは盤面を囲む長方形の中にしか置けない（moveTo と同じ）。重なり・はみ出しは PC では置けるので戻す
      if (at[0] < 0 || at[1] < 0 || at[0] >= this.size.w || at[1] >= this.size.h) continue;
      this.sel = { ref: { piece, copy }, o, at, origin: null, moved: true };
      this.confirm(true);
      this.sel = null;
    }
  }

  /** 置いた駒どうしの重なりと、盤面からのはみ出しのマス（PC で無理に置いたとき） */
  conflictCells(): Set<string> {
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const pl of this.placements.values()) {
      for (const [x, y] of this.occupied(pl)) {
        const k = cellKey(x, y);
        if (!this.board.has(k) || seen.has(k)) out.add(k);
        seen.add(k);
      }
    }
    return out;
  }

  /** そのマスに置いてある駒（選んでいる駒は除く。重なっていれば後から置いた駒） */
  placedAt(cell: Cell): string | null {
    let hit: string | null = null;
    for (const [key, pl] of this.placements) {
      if (this.occupied(pl).some(([x, y]) => x === cell[0] && y === cell[1])) hit = key;
    }
    return hit;
  }

  /** リストで「置いた」と出すか（置いてあった駒を選んだだけで、まだ動かしていないときも「置いた」） */
  isPlaced(key: string): boolean {
    if (this.placements.has(key)) return true;
    const s = this.sel;
    return !!s && !!s.origin && !s.moved && refKey(s.ref) === key;
  }

  placedCount(): number {
    return this.refs().filter((r) => this.isPlaced(refKey(r))).length;
  }

  /** 完成：全部の駒が確定していて、盤面の全マスが駒のマスか駒の穴で覆われている（§6.2） */
  isComplete(): boolean {
    if (this.sel || this.placements.size !== this.total) return false;
    const covered = new Set<string>();
    for (const pl of this.placements.values()) {
      for (const [x, y] of this.occupied(pl)) {
        const k = cellKey(x, y);
        if (!this.board.has(k) || covered.has(k)) return false;
        covered.add(k);
      }
    }
    return covered.size === this.board.size;
  }
}
