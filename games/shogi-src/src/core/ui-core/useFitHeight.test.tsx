import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFitHeight } from './useFitHeight';

/**
 * 盤以外に置くものの高さを毎回測る仕掛け（付録D-8 v1.10 §5.1.3）。
 *
 * ここで固定したいのは 2 点。
 *   - **測るのは「画面全体の高さ − 盤そのものの高さ」**（`--cell` の値は読みに行かない
 *     ＝CSS の変数は式のまま返ることがあり、数として読めない）
 *   - **★書き込むのは横長のときだけ**＝縦長では使わないうえ、**測り直しの知らせが
 *     届かない場面がある**（確認用の環境では `resize` も `ResizeObserver` も 1 件も
 *     発火しないことを 2026-08-20 に実測）。**縦長で測った値が横長へ持ち越されると、
 *     盤が要らぬほど小さくなる**（実測＝1536×864 で 512px のはずが 263px になった）。
 */

/** 画面の高さと盤の高さを、測られる側として仕込む。 */
function Harness({ stageH, boardH }: { stageH: number; boardH: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitHeight(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (!el) return;
        el.getBoundingClientRect = () =>
          ({ height: stageH, width: 1000, top: 0, left: 0, right: 1000, bottom: stageH }) as DOMRect;
        const board = el.querySelector('.board');
        if (board) Object.defineProperty(board, 'clientHeight', { value: boardH, configurable: true });
      }}
    >
      <div className="board" />
    </div>
  );
}

const setViewport = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
};

describe('盤以外に置くものの高さ（付録D-8 §5.1.3）', () => {
  beforeEach(() => setViewport(1280, 800));
  afterEach(() => cleanup());

  it('横長では「画面全体の高さ − 盤の高さ」を書き込む', () => {
    const { container } = render(<Harness stageH={788} boardH={434} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('354px');
  });

  it('正方形は横長として扱う（正方形までを横長・ユーザー判断 2026-08-20）', () => {
    setViewport(600, 600);
    const { container } = render(<Harness stageH={494} boardH={151} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('343px');
  });

  it('★縦長では書き込まない（前に横長で測った値を上書きしない）', () => {
    setViewport(390, 844);
    const { container } = render(<Harness stageH={842} boardH={227} />);
    const stage = container.firstElementChild as HTMLElement;
    // 書き込んでいたら 615px になる。**縦長では触らない**のが規定。
    expect(stage.style.getPropertyValue('--fit-v')).toBe('');
  });

  it('盤がまだ無い間は書き込まない', () => {
    const { container } = render(<Harness stageH={788} boardH={0} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('');
  });
});
