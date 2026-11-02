// 画面基準の指定（「画面の右の面を、深さ 2 で、逆に」など）→ Move・視点コマンド（設計 04 §5.4・§6）
// キー・操作パネル・（M6.5 の）矢印が同じ関数を通す。入力の入口が違っても同じ Move になる（I4）
import { isEquivalent, makeMove, slicesFromDepths } from '../core/move';
import { turnsForFace } from '../core/rotations';
import { FACE_AXIS, type Face, type Move } from '../core/types';
import type { ViewCommand } from './viewController';
import { toWorldFace, type ViewFrame } from './viewFrame';

export type Variant = 'cw' | 'ccw' | 'double';
export type MiddleSlice = 'M' | 'E' | 'S';

/** 中央の層：M は左、E は下、S は正面と同じ向き */
export const MIDDLE_FACE: Record<MiddleSlice, Face> = { M: 'L', E: 'D', S: 'F' };
/** 全体の回転：x は右、y は上、z は正面と同じ向き */
export const WHOLE_FACE: Record<'x' | 'y' | 'z', Face> = { x: 'R', y: 'U', z: 'F' };

/** 画面基準の面 screenFace から数えて深さ from〜to を回す。大きさを越えたら null */
export function faceMove(
  n: number, frame: ViewFrame, screenFace: Face, variant: Variant, from: number, to: number,
): Move | null {
  if (from < 1 || to < from || to > n) return null;
  const f = toWorldFace(screenFace, frame);
  return makeMove(n, FACE_AXIS[f], slicesFromDepths(f, from, to, n), turnsForFace(f, variant));
}

/** 真ん中の層。N が偶数のときは無いので null */
export function middleMove(n: number, frame: ViewFrame, slice: MiddleSlice, variant: Variant): Move | null {
  if (n % 2 === 0) return null;
  const mid = (n + 1) / 2;
  return faceMove(n, frame, MIDDLE_FACE[slice], variant, mid, mid);
}

/** 全体を画面の面 screenFace の向きへ回す視点コマンド（手数に数えない） */
export function wholeCommand(frame: ViewFrame, screenFace: Face, variant: Variant): ViewCommand {
  // どの面でも「その面の時計回り」は外向き法線まわり −90°（'R' の cw が −1）
  const quarter = turnsForFace('R', variant) as -2 | -1 | 1 | 2;
  return { kind: 'rotate', about: toWorldFace(screenFace, frame), quarter };
}

export interface ScreenMove {
  face: Face;
  variant: Variant;
  from: number;
  to: number;
}

const SCREEN_FACES: readonly Face[] = ['R', 'U', 'F', 'L', 'D', 'B'];
const VARIANT_ORDER: readonly Variant[] = ['cw', 'ccw', 'double'];

/** 手 move を、いまの画面の言葉（画面の右の面から 2 枚目を時計回り、など）に直す。外から近い面を選ぶ。直せなければ null */
export function describeMove(n: number, frame: ViewFrame, move: Move): ScreenMove | null {
  let best: ScreenMove | null = null;
  for (const face of SCREEN_FACES) {
    for (let from = 1; from <= n; from++) {
      for (let to = from; to <= n; to++) {
        if (best && to >= best.to) break;
        for (const variant of VARIANT_ORDER) {
          const m = faceMove(n, frame, face, variant, from, to);
          if (m && isEquivalent(m, move)) {
            best = { face, variant, from, to };
            break;
          }
        }
      }
    }
  }
  return best;
}
