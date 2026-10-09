import '@testing-library/jest-dom/vitest';

// jsdom には PointerEvent が無く、pointerType（マウスか指か）が画面に届かない。本物のブラウザと同じく渡す
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventShim extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? '';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
}

// 画面の検査では、配る演出の待ちと、最初の操作で出す「音楽を再生しますか？」を入れない
// （演出と音の窓は別の検査で確かめる）
import { setDealHold } from '../game/useTable';
import { setFirstGestureCapture } from '../audio/firstGesture';
setDealHold(0);
setFirstGestureCapture(false);
