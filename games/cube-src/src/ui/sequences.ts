// 手順の記録と再生（2026-11-04 作者の指示）。描画に依存しない部分
//
// - 手順は「記録を始めたときの画面の言葉」（画面の右の面を外から 1 枚目、時計回り…）で持つ。
//   途中で全体を回しても、記録した手はキューブに対して同じまま。再生は「いまの向き」から見て同じ動きになる
// - 記録中に戻すと、戻した手は覚えない（戻すことを覚えるのではなく、前の手を忘れる）。やり直すと、また覚える
// - ブラウザ（localStorage['cube.sequences.v1']）に保存し、ファイルにも書き出し・読み込みができる
// - 手順ごとにマーク（ui/marks.ts）を 1 組持つ。位置は「その手順を始めるときの姿」で見たセル（2026-11-04 作者：
//   マークは手順に付けるもの。手順の名前を選ぶと、そのマークが出る）
// - 手順は記録した大きさで分けて持つ。別の大きさでも、外から何段目かをそのまま合わせて再生できる。
//   ただし大きいキューブの手順を小さいキューブで回すとき、段数が半分を超える手があれば再生できない（adaptStep）
import { MAX_SIZE, MIN_SIZE, type Face, type Move, type MoveOrigin } from '../core/types';
import { MAX_MARKS, onSurface, type SeqMark } from './marks';
import { describeMove, faceMove, type Variant } from '../input/screenMoves';
import type { ViewFrame } from '../input/viewFrame';
import type { StorageLike } from './records';

/** 1 手：[画面の面, 向き, 外から何枚目から, 何枚目まで] */
export type SeqStep = readonly [Face, Variant, number, number];

export interface Sequence {
  id: string;
  name: string;
  /** 記録した大きさ（同じ大きさのときだけ再生できる） */
  n: number;
  steps: SeqStep[];
  /** マーク（付けた順）。手順を始めるときの姿で、マークを付けたときの画面の向きから見た位置 */
  marks: SeqMark[];
}

/**
 * 大きさ m で記録した 1 手を、大きさ n で回す手に直す。外から何段目かはそのまま。
 * 全体を回す手（1 段目から m 段目まで）は、全体を回す手のまま。
 * 小さいキューブへ移すとき、段数が n の半分を超える手は回せない（null）
 */
export function adaptStep(step: SeqStep, m: number, n: number): SeqStep | null {
  if (m === n) return step;
  const [face, variant, from, to] = step;
  if (from === 1 && to === m) return [face, variant, 1, n];
  if (to > n || (m > n && 2 * to > n)) return null;
  return step;
}

/** 大きさ m の手順を、大きさ n で再生できるか */
export function playableOn(seq: Sequence, n: number): boolean {
  return seq.steps.length > 0 && seq.steps.every((s) => adaptStep(s, seq.n, n) !== null);
}

/**
 * 大きさ m で付けたマークを、大きさ n のセルに移す。各向きで、近いほうの外側から何段目かを合わせる
 * （真ん中は真ん中へ）。移せないもの（n の半分を超える段・偶数の大きさの真ん中）は null
 */
export function adaptMark(mark: SeqMark, m: number, n: number): SeqMark | null {
  if (m === n) return mark;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c = mark[1 + k] as number;
    const low = c;
    const high = m - 1 - c;
    if (low === high) {
      if (n % 2 === 0) return null;
      out[k] = (n - 1) / 2;
    } else {
      const d = Math.min(low, high);
      if (2 * (d + 1) > n) return null;
      out[k] = low < high ? d : n - 1 - d;
    }
  }
  const moved: SeqMark = [mark[0], out[0], out[1], out[2]];
  return onSurface(n, { pos: [out[0], out[1], out[2]], face: mark[0] }) ? moved : null;
}

export const SEQUENCES_KEY = 'cube.sequences.v1';
const VERSION = 1;
/** ファイルの印（ほかのファイルを読み込まないため） */
export const FILE_KIND = 'momo-cube-sequences';
export const MAX_NAME = 40;
/** 手順セットの説明の長さの上限（キューブの下の知らせ欄に出す） */
export const MAX_NOTE = 200;
/** 1 つの手順に覚える手の上限（保存が大きくなりすぎないため） */
export const MAX_STEPS = 10000;

const FACE_SET = new Set<string>(['U', 'D', 'L', 'R', 'F', 'B']);
const VARIANT_SET = new Set<string>(['cw', 'ccw', 'double']);

/** 手 move を、画面の向き frame での言葉に直す。直せなければ null */
export function stepOf(n: number, frame: ViewFrame, move: Move): SeqStep | null {
  const d = describeMove(n, frame, move);
  return d ? [d.face, d.variant, d.from, d.to] : null;
}

/** 手順の 1 手を、画面の向き frame での手に直す */
export function moveOf(n: number, frame: ViewFrame, step: SeqStep): Move | null {
  return faceMove(n, frame, step[0], step[1], step[2], step[3]);
}

function sanitizeMark(v: unknown, n: number): SeqMark | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [face, x, y, z] = v;
  if (typeof face !== 'string' || !FACE_SET.has(face)) return null;
  const spot = { pos: [x, y, z] as const, face: face as Face };
  return onSurface(n, spot) ? [face as Face, x, y, z] : null;
}

function sanitizeStep(v: unknown, n: number): SeqStep | null {
  // 5 つ目（前の試作で手ごとに持っていたマーク）は読み捨てる
  if (!Array.isArray(v) || (v.length !== 4 && v.length !== 5)) return null;
  const [face, variant, from, to] = v;
  if (typeof face !== 'string' || !FACE_SET.has(face)) return null;
  if (typeof variant !== 'string' || !VARIANT_SET.has(variant)) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > n) return null;
  return [face as Face, variant as Variant, from, to];
}

/** 何が入っていても、使える手順に直す。直せなければ null */
export function sanitizeSequence(v: unknown, makeId: () => string): Sequence | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = o.n;
  if (!Number.isInteger(n) || (n as number) < MIN_SIZE || (n as number) > MAX_SIZE) return null;
  if (!Array.isArray(o.steps)) return null;
  const steps: SeqStep[] = [];
  for (const s of o.steps.slice(0, MAX_STEPS)) {
    const step = sanitizeStep(s, n as number);
    if (!step) return null;
    steps.push(step);
  }
  const marks: SeqMark[] = [];
  if (o.marks !== undefined) {
    if (!Array.isArray(o.marks)) return null;
    for (const m of o.marks.slice(0, MAX_MARKS)) {
      const mark = sanitizeMark(m, n as number);
      if (!mark) return null;
      marks.push(mark);
    }
  }
  const name = typeof o.name === 'string' ? o.name.slice(0, MAX_NAME) : '';
  const id = typeof o.id === 'string' && o.id ? o.id : makeId();
  return { id, name, n: n as number, steps, marks };
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** 手順の一覧。変えたらすぐブラウザに保存する（保存できなくても一覧は使える） */
export class SequenceStore {
  private list: Sequence[] = [];
  /** 手順セットの説明（2026-11-04 作者）。すべての大きさに共通で 1 つ＝ファイル 1 つに 1 つ */
  private noteText = '';
  private readonly storage: StorageLike | null;
  /** 最後の保存に失敗した */
  saveFailed = false;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.load();
  }

  get all(): readonly Sequence[] {
    return this.list;
  }

  get(id: string): Sequence | undefined {
    return this.list.find((s) => s.id === id);
  }

  add(name: string, n: number): Sequence {
    const s: Sequence = { id: newId(), name: name.slice(0, MAX_NAME), n, steps: [], marks: [] };
    this.list.push(s);
    this.save();
    return s;
  }

  remove(id: string): void {
    this.list = this.list.filter((s) => s.id !== id);
    this.save();
  }

  rename(id: string, name: string): void {
    const s = this.get(id);
    if (!s) return;
    s.name = name.slice(0, MAX_NAME);
    this.save();
  }

  /** 手順の中身を入れ替える（記録） */
  setSteps(id: string, n: number, steps: readonly SeqStep[]): void {
    const s = this.get(id);
    if (!s) return;
    s.n = n;
    s.steps = steps.slice(0, MAX_STEPS);
    this.save();
  }

  /** マークを入れ替える */
  setMarks(id: string, marks: readonly SeqMark[]): void {
    const s = this.get(id);
    if (!s) return;
    s.marks = marks.slice(0, MAX_MARKS);
    this.save();
  }

  /** 手順セットの説明（無ければ空） */
  get note(): string {
    return this.noteText;
  }

  setNote(text: string): void {
    this.noteText = text.trim() ? text.slice(0, MAX_NOTE) : '';
    this.save();
  }

  /** ファイルに書く中身（JSON の文字） */
  toFile(): string {
    return JSON.stringify({
      kind: FILE_KIND,
      version: VERSION,
      sequences: this.list.map(({ name, n, steps, marks }) => ({ name, n, steps, marks })),
      note: this.noteText,
    }, null, 1);
  }

  /** ファイルの中身を読んで、一覧の後ろに足す。足した数（読めなければ -1） */
  importFile(text: string): number {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return -1;
    }
    const o = data as Record<string, unknown> | null;
    if (!o || o.kind !== FILE_KIND || !Array.isArray(o.sequences)) return -1;
    let added = 0;
    for (const v of o.sequences) {
      // 読み込んだものには新しい id を付ける（同じファイルを 2 回読んでもぶつからない）
      const s = sanitizeSequence({ ...(v as object), id: undefined }, newId);
      if (s) {
        this.list.push(s);
        added++;
      }
    }
    // 説明：いまの説明が空ならそのまま入れ、あれば後ろに改行して足す（同じものは足さない）
    let noted = false;
    const v = sanitizeNote(o.note);
    if (v && !this.noteText.includes(v)) {
      this.noteText = (this.noteText ? `${this.noteText}\n${v}` : v).slice(0, MAX_NOTE);
      noted = true;
    }
    if (added > 0 || noted) this.save();
    return added;
  }

  private load(): void {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(SEQUENCES_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as { version?: unknown; sequences?: unknown; note?: unknown };
      if (o.version !== VERSION || !Array.isArray(o.sequences)) return;
      this.list = o.sequences.map((v) => sanitizeSequence(v, newId)).filter((s): s is Sequence => s !== null);
      this.noteText = sanitizeNote(o.note);
    } catch {
      this.list = [];
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(SEQUENCES_KEY, JSON.stringify({ version: VERSION, sequences: this.list, note: this.noteText }));
      this.saveFailed = false;
    } catch {
      this.saveFailed = true;
    }
  }
}

/**
 * 記録中の手の列。確定した手を、どこから来たか（origin）と一緒に受け取る。
 * 戻した手は忘れ、やり直した手はまた覚える。記録を始める前の手を戻したり、やり直したりしたときは何も変えない
 */
export class SequenceRecorder {
  readonly n: number;
  readonly frame: ViewFrame;
  private readonly _steps: SeqStep[] = [];
  /** 記録を始める前の手を、いくつ戻しているか（やり直すときはそれから先に戻る） */
  private outside = 0;

  constructor(n: number, frame: ViewFrame) {
    this.n = n;
    this.frame = frame;
  }

  get steps(): readonly SeqStep[] {
    return this._steps;
  }

  /** 確定した手。覚えている手が変わったら true */
  committed(move: Move, origin: MoveOrigin): boolean {
    if (move.n !== this.n) return false;
    switch (origin) {
      case 'undo':
        if (this._steps.length > 0) {
          this._steps.pop();
          return true;
        }
        this.outside++;
        return false;
      case 'redo':
        if (this.outside > 0) {
          this.outside--;
          return false;
        }
        return this.push(move);
      case 'user':
      case 'solver':
        // 新しい手を指すと、やり直せる手は無くなる
        this.outside = 0;
        return this.push(move);
      default:
        return false;
    }
  }

  /** 覚えている手を、記録を始めたときの向きで回す手に直したもの（マークを始めの姿の位置へ戻すのに使う） */
  moves(): Move[] {
    return this._steps.map((s) => moveOf(this.n, this.frame, s)).filter((m): m is Move => m !== null);
  }

  private push(move: Move): boolean {
    if (this._steps.length >= MAX_STEPS) return false;
    const step = stepOf(this.n, this.frame, move);
    if (!step) return false;
    this._steps.push(step);
    return true;
  }
}

/** 説明を確かめる（空白だけなら空） */
function sanitizeNote(x: unknown): string {
  return typeof x === 'string' && x.trim() ? x.slice(0, MAX_NOTE) : '';
}
