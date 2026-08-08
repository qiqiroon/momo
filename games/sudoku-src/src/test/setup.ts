import '@testing-library/jest-dom/vitest';
// IndexedDB は jsdom に無いため、検査では代用の実装を使う
import 'fake-indexeddb/auto';

/**
 * Canvas の 2D コンテキストも jsdom には無い。
 * **実機のブラウザには必ずある**ため、ここでは何もしない代用を置いて画面を組み立てられるようにする。
 * 描画そのものの検査は `ui/canvas/renderer.test.ts` が、命令を記録する専用の代用で行う。
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = (): void => {};
  const context = {
    canvas: null,
    setTransform: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    measureText: (text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  };

  HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
    return context;
  } as unknown as HTMLCanvasElement['getContext'];
}
