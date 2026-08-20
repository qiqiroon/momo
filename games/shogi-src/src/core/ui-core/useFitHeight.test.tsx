import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFitHeight } from './useFitHeight';

/**
 * 盤以外に置くものの高さを毎回測る仕掛け（付録D-8 v1.12 §5.1.3）。
 *
 * ここで固定したいのは 3 点。
 *   - **★測るのは「盤が入っている列」だけ**＝「盤の列の外にあるもの」＋「盤の列の中で
 *     盤以外のもの」。**右の列（チャット・観戦者・デバッグ情報）の高さは入れない。**
 *     v1.61 まで「画面全体の高さ − 盤の高さ」で出しており、**盤が小さくなって画面の高さを
 *     決めるのが右の列に入れ替わると、盤が縮むほど引く値が増えて止まらなくなった**
 *     （実測＝窓 900×430・デバッグ表示ありで引く値 277px → 600px・盤 488px → 38px）。
 *   - **`--cell` の値は読みに行かない**＝CSS の変数は式のまま返ることがあり、数として
 *     読めない。
 *   - **★書き込むのは横長のときだけ**＝縦長では使わないうえ、**測り直しの知らせが
 *     届かない場面がある**（確認用の環境では `resize` が 1 件も発火しないことを
 *     2026-08-20 に実測）。**縦長で測った値が横長へ持ち越されると、盤が要らぬほど
 *     小さくなる**（実測＝1536×864 で 512px のはずが 263px になった）。
 */

/** 高さを仕込む小道具（測られる側は実際に高さを持たないので、返す値を差し替える）。 */
const fixHeight = (el: Element | null, height: number) => {
  if (!el) return;
  el.getBoundingClientRect = () =>
    ({ height, width: 1000, top: 0, left: 0, right: 1000, bottom: height }) as DOMRect;
};

/**
 * 画面・盤の列・盤・右の列の高さを、測られる側として仕込む。
 *
 * `chatColH` は**測ってはいけない側**なので、わざと大きな値を渡す試験に使う。
 */
function Harness({
  stageH,
  gridH,
  mainColH,
  boardH,
}: {
  stageH: number;
  gridH: number;
  mainColH: number;
  boardH: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFitHeight(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (!el) return;
        fixHeight(el, stageH);
        fixHeight(el.querySelector('.grid'), gridH);
        fixHeight(el.querySelector('.main-col'), mainColH);
        const board = el.querySelector('.board');
        if (board) Object.defineProperty(board, 'clientHeight', { value: boardH, configurable: true });
      }}
    >
      <div className="grid">
        <div className="main-col">
          <div className="board" />
        </div>
        <div className="chat-col" />
      </div>
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

  it('横長では「列の外にあるもの ＋ 列の中で盤以外のもの」を書き込む', () => {
    // 画面 788 − 列 700 ＝ 88（ヘッダ・すき間・余白）、列 700 − 盤 434 ＝ 266。合計 354。
    const { container } = render(<Harness stageH={788} gridH={700} mainColH={700} boardH={434} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('354px');
  });

  it('★右の列のほうが高くても、その高さは引く値に入らない', () => {
    // 右の列が高いので画面全体は 1000 になっているが、**盤の列は 700 のまま**。
    // 「画面全体 − 盤」で出すと 566px になり、盤が要らぬほど小さくなる（v1.61 の不具合）。
    const { container } = render(<Harness stageH={1000} gridH={912} mainColH={700} boardH={434} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('354px');
  });

  it('★盤が小さくなっても引く値は増えない（縮み続ける逆向きの関係を作らない）', () => {
    // 盤だけ 434 → 100 に縮めた。列も同じだけ縮む（列 ＝ 盤 ＋ 盤以外 266）。
    // 右の列は高いままなので画面全体は 1000 のまま。引く値は 354 から動いてはならない。
    const { container } = render(<Harness stageH={1000} gridH={912} mainColH={366} boardH={100} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('354px');
  });

  it('正方形は横長として扱う（正方形までを横長・ユーザー判断 2026-08-20）', () => {
    setViewport(600, 600);
    const { container } = render(<Harness stageH={494} gridH={420} mainColH={420} boardH={151} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('343px');
  });

  it('★縦長では書き込まない（前に横長で測った値を上書きしない）', () => {
    setViewport(390, 844);
    const { container } = render(<Harness stageH={842} gridH={780} mainColH={500} boardH={227} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('');
  });

  it('盤がまだ無い間は書き込まない', () => {
    const { container } = render(<Harness stageH={788} gridH={700} mainColH={700} boardH={0} />);
    const stage = container.firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--fit-v')).toBe('');
  });
});
