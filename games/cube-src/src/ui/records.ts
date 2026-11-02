// ゲームの記録（設計 05 §4・要求仕様 §16）。1 回のプレイ（シャッフル → そろう）を 1 件とする
// 保存に失敗しても（容量・プライベートモード）記録だけ静かにあきらめ、ゲームは続ける

export interface SolveRecord {
  n: number;
  timeMs: number;
  /** そろった時点の手数（戻した手は数えない） */
  moves: number;
  scrambleLength: number;
  /** Date.now() */
  completedAt: number;
  /** 第一段階では常に false */
  usedHint: boolean;
  /** 第一段階では常に false。true の記録はベストの集計から外す */
  usedSolver: boolean;
}

export const RECORDS_KEY = 'cube.records.v1';
const VERSION = 1;
/** 大きさごとに残す件数 */
export const KEEP_PER_SIZE = 100;

/** localStorage と同じ形（テストで差し替える） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AddResult {
  record: SolveRecord;
  /** 足す前のそのサイズのベストタイム（無ければ null） */
  previousBest: SolveRecord | null;
  /** タイムの新記録か（初めての記録も含む） */
  newBestTime: boolean;
  /** 手数の新記録か（初めての記録は含まない） */
  newBestMoves: boolean;
}

export class RecordStore {
  private records: SolveRecord[];
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.records = load(storage);
  }

  add(r: Omit<SolveRecord, 'usedHint' | 'usedSolver'> & Partial<SolveRecord>): AddResult {
    const record: SolveRecord = { usedHint: false, usedSolver: false, ...r };
    const previousBest = this.bestTime(record.n);
    const previousMoves = this.bestMoves(record.n);
    this.records.push(record);
    // 大きさごとに新しい KEEP_PER_SIZE 件だけ残す
    const same = this.records.filter((x) => x.n === record.n);
    if (same.length > KEEP_PER_SIZE) {
      const drop = new Set(same.slice(0, same.length - KEEP_PER_SIZE));
      this.records = this.records.filter((x) => !drop.has(x));
    }
    this.save();
    const counts = isRanked(record);
    return {
      record,
      previousBest,
      newBestTime: counts && (!previousBest || record.timeMs < previousBest.timeMs),
      newBestMoves: counts && !!previousMoves && record.moves < previousMoves.moves,
    };
  }

  all(n: number): readonly SolveRecord[] {
    return this.records.filter((r) => r.n === n);
  }

  count(n: number): number {
    return this.all(n).length;
  }

  bestTime(n: number): SolveRecord | null {
    return pickBest(this.all(n), (r) => r.timeMs);
  }

  bestMoves(n: number): SolveRecord | null {
    return pickBest(this.all(n), (r) => r.moves);
  }

  /** 直近 lastK 件（集計の対象になるもの）の平均タイム */
  averageTime(n: number, lastK: number): number | null {
    const xs = this.all(n).filter(isRanked).slice(-lastK);
    if (xs.length === 0) return null;
    return xs.reduce((s, r) => s + r.timeMs, 0) / xs.length;
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(RECORDS_KEY, JSON.stringify({ version: VERSION, records: this.records }));
    } catch {
      // 容量超過・プライベートモード：記録だけあきらめる
    }
  }
}

/** ヒント・自動解答を使った記録はベストに数えない */
const isRanked = (r: SolveRecord): boolean => !r.usedHint && !r.usedSolver;

function pickBest(xs: readonly SolveRecord[], key: (r: SolveRecord) => number): SolveRecord | null {
  let best: SolveRecord | null = null;
  for (const r of xs) {
    if (isRanked(r) && (!best || key(r) < key(best))) best = r;
  }
  return best;
}

function load(storage: StorageLike | null): SolveRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as { version?: unknown; records?: unknown };
    if (data.version !== VERSION || !Array.isArray(data.records)) return [];
    return data.records.filter(isRecord);
  } catch {
    return [];
  }
}

function isRecord(x: unknown): x is SolveRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  return int(r.n, 1, 10) && typeof r.timeMs === 'number' && Number.isFinite(r.timeMs) && r.timeMs >= 0
    && int(r.moves, 0, Number.MAX_SAFE_INTEGER) && int(r.scrambleLength, 0, Number.MAX_SAFE_INTEGER)
    && typeof r.completedAt === 'number' && typeof r.usedHint === 'boolean' && typeof r.usedSolver === 'boolean';
}

/** 画面の localStorage（使えなければ null） */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 時間の表示 mm:ss.d（1 時間以上は h:mm:ss）。05 §2 */
export function formatTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100));
  const tenths = t % 10;
  const s = Math.floor(t / 10);
  const pad = (v: number) => String(v).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${tenths}`;
}

