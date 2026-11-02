// 小キューブ本体とステッカーのマテリアル（設計 03 §3）
// 鏡の色味は鏡の板（render/mirrorRoom.ts）の側で付ける
import { MeshLambertMaterial } from 'three';

const STICKER_CORNER = 0.14;

/** 本体：暗い樹脂色 */
export function createBodyMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: 0x14161a });
}

/**
 * ステッカー：色はインスタンス色（初期化時に一度だけ書く）。
 * 角丸は頂点を増やさず、フラグメントで角丸正方形の外を捨てる
 */
export function createStickerMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStickerUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStickerUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStickerUv;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          float r = ${STICKER_CORNER.toFixed(3)};
          vec2 q = abs(vStickerUv - 0.5) - (0.5 - r);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
          if (d > 0.0) discard;
        }`,
      );
  };
  return mat;
}
