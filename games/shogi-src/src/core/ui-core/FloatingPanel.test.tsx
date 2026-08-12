import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingPanel } from './FloatingPanel';

/**
 * 終局パネルなどを動かせること (ユーザー要望 2026-08-12)。
 *
 * 「動かせるようにしてほしい」という報告を受けて実測したところ、つまみ自体は
 * v0.32 から正しく動いていた。壊れていたのではなく**つかむ場所が見つからなかった**
 * ので、v1.21 でパネル全体をつかめるようにした。ボタンの上だけは押す操作のまま。
 */
function panelOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.floating-result') as HTMLElement;
}

describe('FloatingPanel を動かす', () => {
  it('つまみをマウスで引っぱるとパネルが動く', () => {
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <div>本文</div>
      </FloatingPanel>,
    );
    const before = panelOf(container).style.transform;

    const handle = screen.getByText('対局終了').parentElement as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 160, clientY: 140 });
    fireEvent.mouseUp(window);

    const after = panelOf(container).style.transform;
    expect(after).not.toBe(before);
    expect(after).toContain('60px');
    expect(after).toContain('40px');
  });

  it('つまみを指でなぞってもパネルが動く', () => {
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <div>本文</div>
      </FloatingPanel>,
    );
    const handle = screen.getByText('対局終了').parentElement as HTMLElement;
    fireEvent.touchStart(handle, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 30, clientY: 90 }] });
    fireEvent.touchEnd(window);

    const after = panelOf(container).style.transform;
    expect(after).toContain('-20px');
    expect(after).toContain('40px');
  });

  it('放したあとにマウスを動かしてもついてこない', () => {
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <div>本文</div>
      </FloatingPanel>,
    );
    const handle = screen.getByText('対局終了').parentElement as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(window);
    const parked = panelOf(container).style.transform;

    fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
    expect(panelOf(container).style.transform).toBe(parked);
  });

  it('本文をつかんでも動く (つまみを探さなくてよい)', () => {
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <div className="verdict">あなたの勝ち</div>
      </FloatingPanel>,
    );
    fireEvent.mouseDown(screen.getByText('あなたの勝ち'), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 25 });
    fireEvent.mouseUp(window);

    const after = panelOf(container).style.transform;
    expect(after).toContain('70px');
    expect(after).toContain('25px');
  });

  it('ボタンの上から始めた操作では動かない (押す操作を邪魔しない)', () => {
    let clicked = false;
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <button type="button" onClick={() => { clicked = true; }}>閉じる</button>
      </FloatingPanel>,
    );
    const before = panelOf(container).style.transform;

    const btn = screen.getByRole('button', { name: '閉じる' });
    fireEvent.mouseDown(btn, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 120 });
    fireEvent.mouseUp(window);
    fireEvent.click(btn);

    expect(panelOf(container).style.transform).toBe(before);
    expect(clicked).toBe(true);
  });

  it('二度目に引っぱるときは前の位置から続く', () => {
    const { container } = render(
      <FloatingPanel className="floating-result" title="対局終了">
        <div>本文</div>
      </FloatingPanel>,
    );
    const handle = screen.getByText('対局終了').parentElement as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 0 });
    fireEvent.mouseUp(window);

    expect(panelOf(container).style.transform).toContain('50px');
  });
});
