// 色分け・タイム・保存（仕様書 §6.3・§10）。DOM を触らない（保存先は呼ぶ側が渡す）

import { holesOf, orient } from './geometry';
import { type LevelDef, piecesOf, type Placement } from './levels';

const cellKey = (x: number, y: number): string => x + ',' + y;

/**
 * 駒ごとの色の番号（0〜colors-1）。完成形で辺を接する駒どうしが同じ色にならないよう塗り分ける。
 * 平面の地図なので 6 色あれば必ず塗れる（小さい次数から外していく順で塗る）。
 * 使える色のうち、それまでに使われた回数が少ない色を選び、色が片寄らないようにする
 */
export function pieceColors(level: LevelDef, colors = 6): Map<string, number> {
  const pieces = piecesOf(level);
  const owner = new Map<string, string>();
  const keys: string[] = [];
  for (const pl of level.solution) {
    const key = `${pl.piece}:${pl.copy}`;
    keys.push(key);
    const shape = orient(pieces[pl.piece].cells, pl.o);
    for (const [x, y] of [...shape, ...holesOf(shape)]) owner.set(cellKey(x + pl.x, y + pl.y), key);
  }
  const adj = new Map<string, Set<string>>(keys.map((k) => [k, new Set()]));
  for (const [ck, k] of owner) {
    const [x, y] = ck.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const o = owner.get(cellKey(x + dx, y + dy));
      if (o && o !== k) { adj.get(k)!.add(o); adj.get(o)!.add(k); }
    }
  }
  // 次数の小さい駒から順に外していき、外した逆順に塗る
  const deg = new Map(keys.map((k) => [k, adj.get(k)!.size]));
  const left = new Set(keys);
  const stack: string[] = [];
  while (left.size) {
    let best = '', bd = Infinity;
    for (const k of left) if (deg.get(k)! < bd) { bd = deg.get(k)!; best = k; }
    left.delete(best);
    stack.push(best);
    for (const n of adj.get(best)!) if (left.has(n)) deg.set(n, deg.get(n)! - 1);
  }
  const out = new Map<string, number>();
  const used = new Array(colors).fill(0);
  for (const k of stack.reverse()) {
    const taken = new Set([...adj.get(k)!].map((n) => out.get(n)).filter((c) => c !== undefined));
    let pick = -1;
    for (let c = 0; c < colors; c++) if (!taken.has(c) && (pick < 0 || used[c] < used[pick])) pick = c;
    if (pick < 0) pick = 0;
    out.set(k, pick);
    used[pick]++;
  }
  return out;
}

/** 止めたり動かしたりできる時計。中断中は進まず、再開後は続きから足す（§6.3） */
export class Stopwatch {
  private base: number;
  private startedAt: number | null = null;

  constructor(elapsed = 0) {
    this.base = elapsed;
  }

  get running(): boolean {
    return this.startedAt !== null;
  }

  start(now: number): void {
    if (this.startedAt === null) this.startedAt = now;
  }

  stop(now: number): void {
    if (this.startedAt === null) return;
    this.base += now - this.startedAt;
    this.startedAt = null;
  }

  value(now: number): number {
    return this.base + (this.startedAt === null ? 0 : now - this.startedAt);
  }
}

/** 時間の表示（59:59 までは m:ss、それより長ければ h:mm:ss） */
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// ── 保存（localStorage。1 つのキーにまとめる）

export interface SavedGame {
  /** 確定した駒だけ（仮置きの駒は保存しない） */
  placements: Placement[];
  /** 遊んだ時間の累計（ms） */
  elapsed: number;
}

export interface SaveData {
  v: 1;
  /** レベル（'4-legacy' など）ごとのベストタイム（ms） */
  best: Record<string, number>;
  /** 遊びかけの面 */
  games: Record<string, SavedGame>;
  /** iPhone・iPad の 7 日の注意を閉じたか */
  iosNoticeClosed?: boolean;
}

export const SAVE_KEY = 'momo-polyomino';

/** 保存先（localStorage と同じ形。テストでは入れ替える） */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function emptySave(): SaveData {
  return { v: 1, best: {}, games: {} };
}

/** 読む。壊れていたり形が違ったりしたら空から始める（§12-15） */
export function loadSave(kv: KV | null): SaveData {
  try {
    const raw = kv?.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (!d || d.v !== 1 || typeof d.best !== 'object' || typeof d.games !== 'object') return emptySave();
    const best: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.best ?? {})) if (typeof v === 'number' && v > 0) best[k] = v;
    const games: Record<string, SavedGame> = {};
    for (const [k, g] of Object.entries(d.games ?? {})) {
      if (g && Array.isArray(g.placements) && typeof g.elapsed === 'number') games[k] = { placements: g.placements, elapsed: Math.max(0, g.elapsed) };
    }
    return { v: 1, best, games, iosNoticeClosed: !!d.iosNoticeClosed };
  } catch {
    return emptySave();
  }
}

export function writeSave(kv: KV | null, d: SaveData): void {
  try {
    kv?.setItem(SAVE_KEY, JSON.stringify(d));
  } catch {
    // 容量いっぱい・使えない設定のときは保存をあきらめる（遊ぶのは続けられる）
  }
}

/** ベストを更新したら true */
export function recordBest(d: SaveData, levelId: string, ms: number): boolean {
  const prev = d.best[levelId];
  if (prev !== undefined && prev <= ms) return false;
  d.best[levelId] = ms;
  return true;
}

