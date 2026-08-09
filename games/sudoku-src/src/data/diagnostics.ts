/**
 * 取り込みの記録（C-168）
 *
 * **⑳「データが取り込めない」の追跡のために置く裏方である。**
 * 手元の検査では一度も再現せず、ユーザーの実機でのみ起きる。
 * 「通信の失敗」としか分からない状態では原因を二手に絞れないため、
 * **1回ごとの取り込みが、どう終わったのかを事実として残す**。
 *
 * - 記録は**常に取る**（`?debug=1` は表示の可否だけを決める）。
 *   失敗に気づいてから付け直すと再読込になり、その回の記録が消えてしまうため。
 * - 保持は直近 `DIAG_CAPACITY` 件のみ。古いものから捨てる。
 * - **層をまたがない。** ここはデータ層であり、UI も React も知らない。
 */

import { APP_VERSION } from '../version';

/** 保持する件数。1回の出題で数件しか使わないため、数回ぶんを覚えておけば足りる */
export const DIAG_CAPACITY = 40;

/**
 * 1回の取り込みがどう終わったか。
 *
 * - `ok` … 取れた
 * - `http` … サーバーが 2xx 以外を返した（`status` に番号が入る）
 * - `timeout` … こちらの制限時間で打ち切った
 * - `aborted` … 制限時間より前に中断された（画面遷移・回線切断など）
 * - `offline` … 通信そのものが成立しなかった
 * - `parse` … 取れたが JSON として読めなかった
 */
export type AttemptOutcome = 'ok' | 'http' | 'timeout' | 'aborted' | 'offline' | 'parse';

export interface AttemptRecord {
  /** 通し番号。抜けの有無が分かる */
  seq: number;
  /** 何を取りに行ったか */
  url: string;
  /** 同一URLに対する何回目の試みか（0 が初回） */
  attempt: number;
  outcome: AttemptOutcome;
  /** かかった時間（ミリ秒） */
  elapsedMs: number;
  /** HTTP の番号。`http` 以外では欠ける場合がある */
  status?: number;
  /** サーバーが申告した長さ。申告が無ければ null */
  declaredBytes?: number | null;
  /** 実際に受け取った文字数。**申告と食い違えば途中で切れている** */
  receivedChars?: number;
  /** 例外の中身など、機械では分類しきれない補足 */
  detail?: string;
}

/**
 * 取り込み以外の「できごと」（C-179）
 *
 * **完成音が遅れる件を追うために置く。** 完成を検知した時刻と、音が実際に鳴り始めた時刻を
 * 並べれば、遅れがどこで生まれているのかが引き算で分かる。
 * 時刻は単調増加の計測時計（`performance.now`）で取る。壁時計は補正で飛ぶことがある。
 */
export interface EventRecord {
  seq: number;
  /** 何が起きたか。人が読む短い名前 */
  label: string;
  /** ページを開いてからの経過（ミリ秒） */
  atMs: number;
  detail?: string;
}

let seq = 0;
const records: AttemptRecord[] = [];
const events: EventRecord[] = [];

function nowMs(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

/** できごとを1件積む。古いものから溢れさせる */
export function recordEvent(label: string, detail?: string): void {
  events.push({ seq: ++seq, label, atMs: Math.round(nowMs()), detail });
  if (events.length > DIAG_CAPACITY) events.splice(0, events.length - DIAG_CAPACITY);
}

/** 積まれているできごと。新しいものが後ろ */
export function listEvents(): readonly EventRecord[] {
  return events;
}

/** 記録を1件積む。古いものから溢れさせる */
export function record(entry: Omit<AttemptRecord, 'seq'>): void {
  records.push({ seq: ++seq, ...entry });
  if (records.length > DIAG_CAPACITY) records.splice(0, records.length - DIAG_CAPACITY);
}

/** 積まれている記録。新しいものが後ろ */
export function list(): readonly AttemptRecord[] {
  return records;
}

/** 検査用。積んだものを捨てて番号も戻す */
export function reset(): void {
  records.length = 0;
  events.length = 0;
  seq = 0;
}

/**
 * `?debug=1` が付いているか。
 *
 * 付いているときだけ、失敗の中身を画面に出す（[[feedback_debug_log_security]] と同じ流儀）。
 * 判定は起動時の1回きりで、その後の履歴操作では変えない。
 */
let debugFlag: boolean | null = null;

export function isDebugMode(): boolean {
  if (debugFlag !== null) return debugFlag;
  try {
    debugFlag = new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    debugFlag = false;
  }
  return debugFlag;
}

/** 検査用。判定をやり直させる */
export function resetDebugMode(): void {
  debugFlag = null;
}

/** 1件を1行に畳む。人が読む前提の並び */
export function formatRecord(r: AttemptRecord): string {
  const parts = [`#${r.seq}`, `${r.outcome}`, `${Math.round(r.elapsedMs)}ms`];
  if (r.status !== undefined) parts.push(`HTTP ${r.status}`);
  if (r.attempt > 0) parts.push(`${r.attempt + 1}回目`);
  if (r.receivedChars !== undefined) {
    const declared = r.declaredBytes ?? null;
    // **申告と実受信が食い違うときは、そこが答えである**ため必ず並べて出す
    parts.push(declared === null ? `${r.receivedChars}字` : `${r.receivedChars}字/申告${declared}`);
  }
  if (r.detail) parts.push(r.detail);
  parts.push(r.url);
  return parts.join(' ');
}

/**
 * 画面の素性（C-207）
 *
 * **高さは3つ並べる。** 携帯の横画面で「見えている範囲より下まで器が伸びる」ことがあり、
 * そのとき**どの数字が食い違っているかが、そのまま原因を指す**。
 * 器＝土台に与えられた高さ、見え＝いま実際に見えている高さ、採用＝こちらが選んだ値。
 */
function screenLine(win: Window): string {
  const client = win.document?.documentElement?.clientHeight ?? 0;
  const visual = win.visualViewport;
  const seen = visual === null || visual === undefined ? '-' : `${Math.round(visual.height)}`;
  const scale = visual === null || visual === undefined ? '-' : `${visual.scale}`;
  const adopted = win.document?.documentElement?.style.getPropertyValue('--app-height') || '-';
  return (
    `画面 ${win.innerWidth}×${win.innerHeight} / 器 ${client} / 見え ${seen}(倍 ${scale})` +
    ` / 採用 ${adopted} / 倍率 ${win.devicePixelRatio}`
  );
}

/**
 * そのまま貼って渡せる形にまとめる。
 * ユーザーがコピーして送ってくるための出口であり、**環境の素性も一緒に載せる**
 * （同じ症状でも、端末と画面の大きさで原因が変わりうるため）。
 */
export function formatReport(): string {
  const head = [
    `MOMO Sudoku ${APP_VERSION} 取り込み記録`,
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof window === 'undefined' ? '' : screenLine(window),
    typeof navigator === 'undefined' || navigator.onLine === undefined
      ? ''
      : `オンライン判定 ${navigator.onLine ? 'あり' : 'なし'}`,
  ].filter((line) => line !== '');

  const body = records.length === 0 ? ['(記録なし)'] : records.map(formatRecord);

  // できごとは**直前のできごとからの間隔も併記する**。遅れがどこで生まれたかは差で読むため
  const eventBody =
    events.length === 0
      ? []
      : [
          '',
          '[できごと]',
          ...events.map((e, i) => {
            const gap = i === 0 ? '' : ` (+${e.atMs - events[i - 1].atMs}ms)`;
            return `#${e.seq} ${e.atMs}ms${gap} ${e.label}${e.detail ? ` ${e.detail}` : ''}`;
          }),
        ];

  return [...head, '', ...body, ...eventBody].join('\n');
}

export const diagnostics = {
  record,
  recordEvent,
  list,
  listEvents,
  reset,
  isDebugMode,
  formatRecord,
  formatReport,
};
