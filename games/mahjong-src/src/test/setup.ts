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
