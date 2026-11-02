// N 対応の記法パーサ／フォーマッタ（設計 02 §2、08 §5）
import { makeMove, slicesFromDepths } from './move';
import { sliceOf, turnsForFace } from './rotations';
import { AXIS_FACES, FACE_AXIS, type Axis, type Face, type Move } from './types';

export type ParseErrorReason =
  | 'unknown-token' | 'depth-out-of-range' | 'width-out-of-range' | 'middle-needs-odd';

export class ParseError extends Error {
  readonly input: string;
  readonly position: number;
  readonly reason: ParseErrorReason;

  constructor(input: string, position: number, reason: ParseErrorReason) {
    super(`${reason} at ${position}: ${input}`);
    this.name = 'ParseError';
    this.input = input;
    this.position = position;
    this.reason = reason;
  }
}

// 記号ごとの「プライムなし」の向き
const ROTATION_FACE: Record<'x' | 'y' | 'z', Face> = { x: 'R', y: 'U', z: 'F' };
const MIDDLE_FACE: Record<'M' | 'E' | 'S', Face> = { M: 'L', E: 'D', S: 'F' };
const MIDDLE_OF_AXIS: Record<Axis, 'M' | 'E' | 'S'> = { x: 'M', y: 'E', z: 'S' };

const MOVE_RE = /^(?:(10|[1-9])?([UDLRFB])(w)?|([udlrfb])|([MES])|([xyz]))(2'|'2|2|')?$/;
const DEBUG_RE = /^([xyz]):(\d+):(-?[12])$/;

function applySuffix(base: 1 | -1, suffix: string | undefined): Move['turns'] {
  switch (suffix) {
    case undefined: case '': return base;
    case "'": return -base as Move['turns'];
    case '2': return (2 * base) as Move['turns'];
    default: return (-2 * base) as Move['turns'];
  }
}

const cwBase = (face: Face): 1 | -1 => turnsForFace(face, 'cw') as 1 | -1;

function parseToken(token: string, n: number, input: string, position: number): Move {
  const fail = (reason: ParseErrorReason): never => {
    throw new ParseError(input, position, reason);
  };

  const dbg = DEBUG_RE.exec(token);
  if (dbg) {
    const slices = Number(dbg[2]);
    if (slices <= 0 || slices >= 1 << n) fail('depth-out-of-range');
    return makeMove(n, dbg[1] as Axis, slices, Number(dbg[3]) as Move['turns']);
  }

  const m = MOVE_RE.exec(token);
  if (!m) return fail('unknown-token');
  const [, depthText, face, wide, lower, middle, rotation, suffix] = m;

  if (rotation) {
    const r = rotation as 'x' | 'y' | 'z';
    return makeMove(n, r, (1 << n) - 1, applySuffix(cwBase(ROTATION_FACE[r]), suffix));
  }
  if (middle) {
    if (n % 2 === 0) fail('middle-needs-odd');
    const f = MIDDLE_FACE[middle as 'M' | 'E' | 'S'];
    const mid = (n - 1) / 2;
    return makeMove(n, FACE_AXIS[f], 1 << mid, applySuffix(cwBase(f), suffix));
  }

  const f = (face ?? lower.toUpperCase()) as Face;
  const depth = depthText === undefined ? undefined : Number(depthText);
  let from = 1;
  let to = 1;
  if (wide || lower) {
    to = depth ?? 2;
    if (to > n) fail(depth === undefined ? 'width-out-of-range' : 'depth-out-of-range');
  } else if (depth !== undefined) {
    if (depth > n) fail('depth-out-of-range');
    from = to = depth;
  }
  return makeMove(n, FACE_AXIS[f], slicesFromDepths(f, from, to, n), applySuffix(cwBase(f), suffix));
}

/** 1 手を読む。失敗時 ParseError */
export function parseMove(text: string, n: number): Move {
  const token = text.trim();
  return parseToken(token, n, text, text.indexOf(token));
}

export function tryParseMove(text: string, n: number): Move | null {
  try {
    return parseMove(text, n);
  } catch (e) {
    if (e instanceof ParseError) return null;
    throw e;
  }
}

/** 空白区切りの手順を読む */
export function parseSequence(text: string, n: number): Move[] {
  const out: Move[] = [];
  for (const m of text.matchAll(/\S+/g)) out.push(parseToken(m[0], n, text, m.index!));
  return out;
}

function suffixFor(base: 1 | -1, turns: Move['turns']): string {
  if (turns === base) return '';
  if (turns === -base) return "'";
  if (turns === 2 * base) return '2';
  return "2'";
}

/** 面から見た深さの集合（昇順） */
function depthsFrom(face: Face, slices: number, n: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= n; d++) if (slices & (1 << sliceOf(face, d, n))) out.push(d);
  return out;
}

/** 正準形 → 最も短い表記（設計 02 §2.3） */
export function formatMove(m: Move): string {
  const { n, axis, slices, turns } = m;
  if (slices === (1 << n) - 1) return axis + suffixFor(cwBase(ROTATION_FACE[axis]), turns);
  if (n % 2 === 1 && slices === 1 << ((n - 1) / 2)) {
    const sym = MIDDLE_OF_AXIS[axis];
    return sym + suffixFor(cwBase(MIDDLE_FACE[sym]), turns);
  }
  // 符号が負なら正方向の面、正なら負方向の面を先に試す（プライムが少ない側）
  const [pos, neg] = AXIS_FACES[axis];
  const faces: Face[] = turns < 0 ? [pos, neg] : [neg, pos];
  for (const f of faces) {
    const ds = depthsFrom(f, slices, n);
    const k = ds.length;
    if (ds[0] === 1 && ds[k - 1] === k) {
      const head = k === 1 ? f : k === 2 ? `${f}w` : `${k}${f}w`;
      return head + suffixFor(cwBase(f), turns);
    }
  }
  for (const f of faces) {
    const ds = depthsFrom(f, slices, n);
    if (ds.length === 1) return `${ds[0]}${f}` + suffixFor(cwBase(f), turns);
  }
  return `${axis}:${slices}:${turns}`;
}

export function formatSequence(moves: readonly Move[], perLine?: number): string {
  const tokens = moves.map(formatMove);
  if (!perLine || perLine <= 0) return tokens.join(' ');
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += perLine) lines.push(tokens.slice(i, i + perLine).join(' '));
  return lines.join('\n');
}
