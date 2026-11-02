// 見た目の向き（Δ）と 24 通りの向き、画面基準の面 ↔ 世界の面（設計 04 §5.4）
import { Matrix4, Quaternion } from 'three';
import { BODY_FACE_OF, ROT_MATRICES, WORLD_FACE_OF } from '../core/rotations';
import { FACES, FACE_INDEX, type Face } from '../core/types';

/** いまの見た目の向きに最も近い 24 通りの向き（24 元回転群の添字） */
export interface ViewFrame {
  readonly ori: number;
}

export const HOME_FRAME: ViewFrame = { ori: 0 };

/** 24 元回転群の各要素の四元数 */
export const GROUP_QUATERNIONS: readonly Quaternion[] = ROT_MATRICES.map((m) =>
  new Quaternion().setFromRotationMatrix(
    new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1),
  ));

/** 2 つの向きの間の角度（ラジアン、0..π） */
export function angleBetween(a: Quaternion, b: Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

/** 最も近い 24 通りの向きの添字 */
export function nearestOri(q: Quaternion): number {
  let best = 0;
  let bestDot = -1;
  GROUP_QUATERNIONS.forEach((g, i) => {
    const d = Math.abs(g.dot(q));
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

/** 前回の向きを保つ幅。新しい候補のほうがこれ以下しか近くないなら切り替えない */
const HYSTERESIS = (10 * Math.PI) / 180 + 1e-6;

export function viewFrameOf(delta: Quaternion, prev: ViewFrame | null): ViewFrame {
  const ori = nearestOri(delta);
  if (prev && prev.ori !== ori) {
    const gain = angleBetween(delta, GROUP_QUATERNIONS[prev.ori]) - angleBetween(delta, GROUP_QUATERNIONS[ori]);
    if (gain <= HYSTERESIS) return prev;
  }
  return prev && prev.ori === ori ? prev : { ori };
}

/** 画面基準の面（いま画面の右に見えている面＝'R'）→ 世界の面 */
export function toWorldFace(screenFace: Face, frame: ViewFrame): Face {
  return FACES[BODY_FACE_OF[frame.ori * 6 + FACE_INDEX[screenFace]]];
}

/** 世界の面 → いまそれが見えている画面基準の面（キー表示の逆引き用） */
export function toScreenFace(worldFace: Face, frame: ViewFrame): Face {
  return FACES[WORLD_FACE_OF[frame.ori * 6 + FACE_INDEX[worldFace]]];
}
