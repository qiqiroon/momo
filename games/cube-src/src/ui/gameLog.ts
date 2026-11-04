// プレイ記録（2026-11-04 作者の指示）。シャッフルの中身と、そのあとの手をすべて覚え、保存・再生する
// - 覚えるもの：大きさ・シャッフルの手・始めたときの全体の向き・そのあとの手（戻す・やり直すも、その順に）・全体の回転
// - 全体の回転は手数には数えないが、覚えて再生する
// - 手は画面の向きによらない「キューブの軸・層・回す量」で覚える（全体の向きと別に再生しても同じ姿になる）
// - ブラウザに保存する（localStorage['cube.games.v1']）。ファイルへの書き出し・読み込みもできる
import { makeMove } from '../core/move';
import { AXES, type Axis, type Move, type MoveOrigin } from '../core/types';
import type { StorageLike } from './records';
import { MAX_NAME, newId } from './sequences';

export const GAMES_KEY = 'cube.games.v1';
export const GAMES_FILE_KIND = 'momo-cube-games';
/** 保存しておけるプレイ記録の数 */
export const MAX_GAMES = 100;
/** 1 つのプレイ記録に覚える手の数の上限（超えたら、そこから先は覚えない） */
export const MAX_STEPS = 20000;

/** 手：[軸 0〜2, 層の印, 回す量] */
export type LogMove = [number, number, number];
/** 全体の向き（四元数 x, y, z, w） */
export type LogView = [number, number, number, number];
/** そのあとの 1 歩：手・戻す・やり直す・全体の向き */
export type LogStep = LogMove | ['u'] | ['r'] | ['v', number, number, number, number];

export interface GameLog {
  n: number;
  scramble: LogMove[];
  /** 始めたときの全体の向き */
  view0: LogView;
  steps: LogStep[];
  /** 計っていてそろったときの時間（ms） */
  timeMs?: number;
}

export interface SavedGame {
  id: string;
  name: string;
  savedAt: number;
  log: GameLog;
}

const TURNS = new Set([-2, -1, 1, 2]);

export function encodeMove(m: Move): LogMove {
  return [AXES.indexOf(m.axis), m.slices, m.turns];
}

export function decodeMove(n: number, s: LogMove): Move {
  return makeMove(n, AXES[s[0]] as Axis, s[1], s[2] as Move['turns']);
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
export function encodeView(q: { x: number; y: number; z: number; w: number }): LogView {
  return [round(q.x), round(q.y), round(q.z), round(q.w)];
}

/** 手数（全体の回転は数えない。戻すと 1 つ減り、やり直すと 1 つ増える＝ゲームの手数と同じ数え方） */
export function moveCountOf(log: GameLog): number {
  let k = 0;
  for (const s of log.steps) {
    if (s[0] === 'u') k = Math.max(0, k - 1);
    else if (s[0] === 'r') k++;
    else if (s[0] !== 'v') k++;
  }
  return k;
}

/** 全体の回転の数 */
export function viewCountOf(log: GameLog): number {
  return log.steps.filter((s) => s[0] === 'v').length;
}

/** いまのゲームを覚える係 */
export class GameRecorder {
  private _log: GameLog = { n: 3, scramble: [], view0: [0, 0, 0, 1], steps: [] };
  /** 上限を超えて、覚えるのをやめた */
  full = false;
  onChange: () => void = () => {};

  get log(): GameLog {
    return this._log;
  }

  /** シャッフル・そろえる・大きさを変えたとき。そこから覚え直す */
  start(n: number, scramble: readonly Move[], view: LogView): void {
    this._log = { n, scramble: scramble.map(encodeMove), view0: view, steps: [] };
    this.full = false;
    this.onChange();
  }

  /** 手が確定した */
  committed(move: Move, origin: MoveOrigin): void {
    if (move.n !== this._log.n) return;
    if (origin === 'user' || origin === 'solver') this.push(encodeMove(move));
    else if (origin === 'undo') this.push(['u']);
    else if (origin === 'redo') this.push(['r']);
  }

  /** 全体の向きが決まった（回し始めた・手を離した）。前と同じ向きなら覚えない */
  view(q: LogView): void {
    const last = this.lastView();
    if (last.every((v, i) => Math.abs(v - q[i]) < 1e-4)) return;
    this.push(['v', ...q]);
  }

  /** 計っていてそろった */
  solved(timeMs: number): void {
    this._log.timeMs = timeMs;
    this.onChange();
  }

  private lastView(): LogView {
    for (let i = this._log.steps.length - 1; i >= 0; i--) {
      const s = this._log.steps[i];
      if (s[0] === 'v') return [s[1], s[2], s[3], s[4]];
    }
    return this._log.view0;
  }

  private push(step: LogStep): void {
    if (this._log.steps.length >= MAX_STEPS) {
      this.full = true;
      return;
    }
    this._log.steps.push(step);
    this.onChange();
  }
}

/** 何が入っていても、使える記録に直す（だめなら null） */
export function sanitizeLog(x: unknown): GameLog | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const n = r.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) return null;
  const isMove = (v: unknown): v is LogMove => Array.isArray(v) && v.length === 3
    && Number.isInteger(v[0]) && v[0] >= 0 && v[0] <= 2
    && Number.isInteger(v[1]) && v[1] > 0 && v[1] < 1 << n
    && TURNS.has(v[2]);
  const isView = (v: unknown[]): boolean => v.length === 4 && v.every((k) => typeof k === 'number' && Number.isFinite(k) && Math.abs(k) <= 1.0001);
  if (!Array.isArray(r.scramble) || !r.scramble.every(isMove) || r.scramble.length > 999) return null;
  if (!Array.isArray(r.view0) || !isView(r.view0)) return null;
  if (!Array.isArray(r.steps) || r.steps.length > MAX_STEPS) return null;
  const steps: LogStep[] = [];
  for (const s of r.steps as unknown[]) {
    if (isMove(s)) steps.push([s[0], s[1], s[2]]);
    else if (Array.isArray(s) && s.length === 1 && (s[0] === 'u' || s[0] === 'r')) steps.push([s[0]]);
    else if (Array.isArray(s) && s[0] === 'v' && isView(s.slice(1))) steps.push(['v', s[1], s[2], s[3], s[4]]);
    else return null;
  }
  const log: GameLog = {
    n, scramble: (r.scramble as LogMove[]).map((m) => [m[0], m[1], m[2]]),
    view0: [...(r.view0 as number[])] as LogView, steps,
  };
  if (typeof r.timeMs === 'number' && Number.isFinite(r.timeMs) && r.timeMs >= 0) log.timeMs = r.timeMs;
  return log;
}

function sanitizeGame(x: unknown): SavedGame | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const log = sanitizeLog(r.log);
  if (!log) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    name: typeof r.name === 'string' ? r.name.slice(0, MAX_NAME) : '',
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : Date.now(),
    log,
  };
}

const copyLog = (log: GameLog): GameLog => JSON.parse(JSON.stringify(log)) as GameLog;

export class GameStore {
  private list: SavedGame[] = [];
  private readonly storage: StorageLike | null;
  saveFailed = false;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(GAMES_KEY);
      const data = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(data)) {
        this.list = data.map(sanitizeGame).filter((g): g is SavedGame => g !== null).slice(0, MAX_GAMES);
      }
    } catch {
      this.list = [];
    }
  }

  get all(): readonly SavedGame[] {
    return this.list;
  }

  get(id: string): SavedGame | undefined {
    return this.list.find((g) => g.id === id);
  }

  /** 新しいものを上に足す。数が上限を超えたら、いちばん古いものから消える */
  add(name: string, log: GameLog, now = Date.now()): SavedGame {
    const g: SavedGame = { id: newId(), name: name.slice(0, MAX_NAME), savedAt: now, log: copyLog(log) };
    this.list.unshift(g);
    if (this.list.length > MAX_GAMES) this.list.length = MAX_GAMES;
    this.save();
    return g;
  }

  rename(id: string, name: string): void {
    const g = this.get(id);
    if (!g) return;
    g.name = name.slice(0, MAX_NAME);
    this.save();
  }

  remove(id: string): void {
    this.list = this.list.filter((g) => g.id !== id);
    this.save();
  }

  toFile(): string {
    return JSON.stringify({ kind: GAMES_FILE_KIND, version: 1, games: this.list });
  }

  /** ファイルの中身を読んで、一覧の上に足す。足した数 */
  importFile(text: string): number {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return 0;
    }
    const r = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (r.kind !== GAMES_FILE_KIND || !Array.isArray(r.games)) return 0;
    const games = r.games.map((g) => sanitizeGame({ ...(g as object), id: undefined }))
      .filter((g): g is SavedGame => g !== null);
    if (games.length === 0) return 0;
    this.list = [...games, ...this.list].slice(0, MAX_GAMES);
    this.save();
    return games.length;
  }

  private save(): void {
    try {
      this.storage?.setItem(GAMES_KEY, JSON.stringify(this.list));
      this.saveFailed = false;
    } catch {
      this.saveFailed = true;
    }
  }
}
