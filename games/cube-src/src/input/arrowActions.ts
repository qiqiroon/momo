// 矢印操作の純粋な計算（設計 10 §2・§4・§5・§6.3）：置き場所、矢印 → 手・視点コマンド、
// 当たり判定、キー表示の逆引き。Three.js にも DOM にも依存しない
//
// 列矢印はドラッグと同じ pushToMove を通す（決定 D16）。キー表示は、キーと同じ関数
// （faceMove・middleMove・wholeCommand）で候補を作り、同じ手になる押し方を探す。
// こうすると「表示どおりに押せば、矢印と同じ回転になる」ことが作りの上で保証される
import { isEquivalent, makeMove, slicesFromDepths } from '../core/move';
import { turnsForFace } from '../core/rotations';
import {
  AXIS_INDEX, FACES, FACE_AXIS, FACE_NORMAL, FACE_SIGN, OPPOSITE, type Face, type GridPos, type Move, type Vec3,
} from '../core/types';
import { CUBE_WORLD_SIZE } from '../render/cubeView';
import { pushAxis, pushToMove } from './dragToMove';
import { keyHint, type Keymap } from './keymap';
import { faceMove, middleMove, WHOLE_FACE, wholeCommand, type MiddleSlice, type Variant } from './screenMoves';
import type { ViewCommand } from './viewController';
import type { ViewFrame } from './viewFrame';

export type InPlaneDir = 'up' | 'down' | 'left' | 'right';
export const IN_PLANE_DIRS: readonly InPlaneDir[] = ['up', 'down', 'left', 'right'];

export type ArrowId =
  | { kind: 'strip'; face: Face; dir: InPlaneDir; index: number } // index：面を外から見て左から・下から 0..n-1
  | { kind: 'faceTurn'; face: Face; cw: boolean }
  | { kind: 'wholeTwist'; face: Face; cw: boolean }
  | { kind: 'wholeRoll'; face: Face; dir: InPlaneDir };

export type ArrowAction =
  | { kind: 'move'; move: Move }
  | { kind: 'view'; command: ViewCommand };

/** 面の中の座標軸：e_u（右）と e_v（上）を、その向きの面で表す（10 §2.1。展開図を外から見た向き） */
export const FACE_FRAME: Record<Face, { u: Face; v: Face }> = {
  F: { u: 'R', v: 'U' },
  B: { u: 'L', v: 'U' },
  R: { u: 'B', v: 'U' },
  L: { u: 'F', v: 'U' },
  U: { u: 'R', v: 'B' },
  D: { u: 'R', v: 'F' },
};

/** 面 face の中の向き dir を、その向きの面で表す */
export function dirFace(face: Face, dir: InPlaneDir): Face {
  const { u, v } = FACE_FRAME[face];
  switch (dir) {
    case 'up': return v;
    case 'down': return OPPOSITE[v];
    case 'right': return u;
    case 'left': return OPPOSITE[u];
  }
}

/** 寸法（10 §2.2）。h は面までの距離、unit は 1 マス */
export function arrowMetrics(n: number) {
  const h = CUBE_WORLD_SIZE / 2;
  const unit = CUBE_WORLD_SIZE / n;
  const gap = 0.1;
  const len = Math.min(0.9, Math.max(0.3, unit * 0.9));
  const width = unit * 0.62;
  const lift = 0.02;
  const ring2 = gap + len + 0.18;
  /** 曲がった矢印（四隅）の中心 */
  const corner = h + gap + len / 2;
  /** 列矢印以外の当たり範囲の半径 */
  const hitRadius = Math.max(len, 0.35);
  return { h, unit, gap, len, width, lift, ring2, corner, hitRadius };
}

export interface ArrowLayout {
  readonly id: ArrowId;
  /** 面の中の位置（e_u 方向 s・e_v 方向 t。面の中心が 0） */
  readonly s: number;
  readonly t: number;
  /** まっすぐな矢印の向き（曲がった矢印は null） */
  readonly dir: InPlaneDir | null;
  /** 描く大きさ：矢印の向きの長さと幅（曲がった矢印は直径） */
  readonly length: number;
  readonly width: number;
}

const gridPos = (k: number, n: number, unit: number): number => (k - (n - 1) / 2) * unit;

/** 面 face のまわりの矢印すべて（4n + 8 本。10 §2.3） */
export function arrowsFor(face: Face, n: number): ArrowLayout[] {
  const m = arrowMetrics(n);
  const out: ArrowLayout[] = [];
  const edge = m.h + m.gap + m.len / 2;
  for (let k = 0; k < n; k++) {
    const p = gridPos(k, n, m.unit);
    const strip = (dir: InPlaneDir, s: number, t: number): ArrowLayout =>
      ({ id: { kind: 'strip', face, dir, index: k }, s, t, dir, length: m.len, width: m.width });
    out.push(strip('up', p, edge), strip('down', p, -edge), strip('right', edge, p), strip('left', -edge, p));
  }
  const curved = (id: ArrowId, s: number, t: number, scale: number): ArrowLayout =>
    ({ id, s, t, dir: null, length: m.len * scale, width: m.len * scale });
  const c = m.corner;
  out.push(
    curved({ kind: 'faceTurn', face, cw: true }, c, c, 1),
    curved({ kind: 'faceTurn', face, cw: false }, -c, c, 1),
    curved({ kind: 'wholeTwist', face, cw: true }, c, -c, 1.15),
    curved({ kind: 'wholeTwist', face, cw: false }, -c, -c, 1.15),
  );
  const r = m.h + m.ring2 + m.len / 2;
  const roll = (dir: InPlaneDir, s: number, t: number): ArrowLayout =>
    ({ id: { kind: 'wholeRoll', face, dir }, s, t, dir, length: m.len, width: Math.max(m.len, 0.45) * 1.1 });
  out.push(roll('up', 0, r), roll('down', 0, -r), roll('right', r, 0), roll('left', -r, 0));
  return out;
}

/** 面の中の格子位置 k → 回転軸の上の格子添字（その辺に沿う面の軸が負の向きなら逆から数える） */
function gridIndex(along: Face, k: number, n: number): number {
  return FACE_SIGN[along] > 0 ? k : n - 1 - k;
}

/** 矢印を押したときの手・視点コマンド（10 §4） */
export function arrowToAction(id: ArrowId, n: number): ArrowAction {
  switch (id.kind) {
    case 'strip': {
      const { u, v } = FACE_FRAME[id.face];
      // 上下の矢印は縦の列（e_u 方向の位置）、左右の矢印は横の行（e_v 方向の位置）を送る
      const along = id.dir === 'up' || id.dir === 'down' ? u : v;
      return { kind: 'move', move: pushToMove(n, id.face, dirFace(id.face, id.dir), gridIndex(along, id.index, n)) };
    }
    case 'faceTurn': {
      const f = id.face;
      return {
        kind: 'move',
        move: makeMove(n, FACE_AXIS[f], slicesFromDepths(f, 1, 1, n), turnsForFace(f, id.cw ? 'cw' : 'ccw')),
      };
    }
    case 'wholeTwist':
      // 面の時計回り＝外向き法線まわり −90°
      return { kind: 'view', command: { kind: 'rotate', about: id.face, quarter: id.cw ? -1 : 1 } };
    case 'wholeRoll': {
      // 軸 a = n × d まわりに +90°（ドラッグの Ctrl と同じ。面の手前の部分が矢印の向きへ転がる）
      const { axis, sign } = pushAxis(id.face, dirFace(id.face, id.dir));
      const about = FACES.find((f) => FACE_AXIS[f] === axis && FACE_SIGN[f] === sign)!;
      return { kind: 'view', command: { kind: 'rotate', about, quarter: 1 } };
    }
  }
}

/** 面 face の上で、小キューブの位置 pos のマス（面を外から見て左から u・下から v） */
export function cellOf(face: Face, pos: GridPos, n: number): { u: number; v: number } {
  const { u, v } = FACE_FRAME[face];
  const at = (along: Face) => gridIndex(along, pos[AXIS_INDEX[FACE_AXIS[along]]], n);
  return { u: at(u), v: at(v) };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * 視線（原点 o・向き r）が、面 face のまわりのどの矢印に当たったか（10 §6.3）。
 * 面の平面との交点で調べる。面の内側・裏から見ているとき・当たらないときは null
 */
export function pickArrow(o: Vec3, r: Vec3, face: Face, n: number): ArrowId | null {
  const m = arrowMetrics(n);
  const nv = FACE_NORMAL[face];
  const denom = dot(nv, r);
  if (denom >= 0) return null;
  const k = (m.h + m.lift - dot(nv, o)) / denom;
  if (k <= 0) return null;
  const p: Vec3 = [o[0] + r[0] * k, o[1] + r[1] * k, o[2] + r[2] * k];
  const { u, v } = FACE_FRAME[face];
  const s = dot(p, FACE_NORMAL[u]);
  const t = dot(p, FACE_NORMAL[v]);
  if (Math.abs(s) <= m.h && Math.abs(t) <= m.h) return null;

  // 列矢印：列の幅 × （隙間＋長さ）の長方形
  const reach = m.h + m.gap + m.len;
  const col = (x: number) => Math.min(n - 1, Math.floor((x + m.h) / m.unit));
  if (Math.abs(s) < m.h) {
    if (t > m.h && t <= reach) return { kind: 'strip', face, dir: 'up', index: col(s) };
    if (t < -m.h && t >= -reach) return { kind: 'strip', face, dir: 'down', index: col(s) };
  }
  if (Math.abs(t) < m.h) {
    if (s > m.h && s <= reach) return { kind: 'strip', face, dir: 'right', index: col(t) };
    if (s < -m.h && s >= -reach) return { kind: 'strip', face, dir: 'left', index: col(t) };
  }
  // それ以外：いちばん近い矢印の中心から hitRadius 以内
  let best: ArrowId | null = null;
  let bestD = m.hitRadius;
  for (const a of arrowsFor(face, n)) {
    if (a.id.kind === 'strip') continue;
    const d = Math.hypot(a.s - s, a.t - t);
    if (d <= bestD) {
      bestD = d;
      best = a.id;
    }
  }
  return best;
}

/** 同じ回転を表す視点コマンドか（R の −90° と L の +90° は同じ） */
export function sameRotation(a: ViewCommand, b: ViewCommand): boolean {
  if (a.kind !== 'rotate' || b.kind !== 'rotate') return a.kind === b.kind;
  const q = (c: { about: Face; quarter: number }) => (((c.quarter * FACE_SIGN[c.about]) % 4) + 4) % 4;
  return FACE_AXIS[a.about] === FACE_AXIS[b.about] && q(a) === q(b);
}

const KEY_FACES: readonly Face[] = ['R', 'L', 'U', 'D', 'F', 'B'];
const QUARTER_VARIANTS: readonly Variant[] = ['cw', 'ccw'];
const MIDDLES: readonly MiddleSlice[] = ['M', 'E', 'S'];

/**
 * 矢印と同じ回転を起こすキーの押し方（10 §5）。例：`R`・`⇧R`・`3 R`・`M`・`X`。
 * キーと同じ関数で候補を作って照らすので、表示どおりに押せば必ず同じ回転になる。
 * 深さの小さい押し方を選ぶ（同じなら真ん中の層のキー）。見つからなければ null
 */
export function keyLabelFor(action: ArrowAction, keymap: Keymap, frame: ViewFrame, n: number): string | null {
  if (action.kind === 'view') {
    for (const a of ['x', 'y', 'z'] as const) {
      for (const v of QUARTER_VARIANTS) {
        if (sameRotation(wholeCommand(frame, WHOLE_FACE[a], v), action.command)) return keyHint(keymap[a], v);
      }
    }
    return null;
  }
  const target = action.move;
  for (let depth = 1; depth <= Math.ceil(n / 2); depth++) {
    if (n >= 3 && n % 2 === 1 && depth === (n + 1) / 2) {
      for (const s of MIDDLES) {
        for (const v of QUARTER_VARIANTS) {
          const m = middleMove(n, frame, s, v);
          if (m && isEquivalent(m, target)) return keyHint(keymap[s], v);
        }
      }
    }
    for (const f of KEY_FACES) {
      for (const v of QUARTER_VARIANTS) {
        const m = faceMove(n, frame, f, v, depth, depth);
        if (m && isEquivalent(m, target)) return `${depth > 1 ? `${depth} ` : ''}${keyHint(keymap[f], v)}`;
      }
    }
  }
  return null;
}

export type ArrowLabelMode = 'auto' | 'all' | 'none';

/** キー表示を出す矢印か（10 §3.3）。auto：N ≤ 3 は全部、N ≥ 4 はカーソルの列・行と、列矢印以外 */
export function showsLabel(id: ArrowId, n: number, cursor: { u: number; v: number } | null, mode: ArrowLabelMode): boolean {
  if (mode === 'none') return false;
  if (mode === 'all' || n <= 3 || id.kind !== 'strip') return true;
  return isCursorArrow(id, cursor);
}

/** カーソルのマスを通る列・行の列矢印か（強調する 4 本） */
export function isCursorArrow(id: ArrowId, cursor: { u: number; v: number } | null): boolean {
  if (id.kind !== 'strip' || !cursor) return false;
  return id.dir === 'up' || id.dir === 'down' ? id.index === cursor.u : id.index === cursor.v;
}

export function sameArrow(a: ArrowId | null, b: ArrowId | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
