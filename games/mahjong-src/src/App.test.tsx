import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { APP_VERSION } from './version';

describe('始める画面', () => {
  it('アプリ名・版番号・始めるボタンが出る', () => {
    render(<App />);
    const h1 = screen.getByRole('heading');
    expect(h1).toHaveTextContent('MOMO');
    expect(h1).toHaveTextContent('Mahjong');
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('卓の画面（段階1）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** 時計を少しずつ進める（1 回の待ちごとに画面の更新を挟む＝本物と同じ順で進む） */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) act(() => vi.advanceTimersByTime(100));
  };

  /** 自分の手牌のボタン（押せるものだけ） */
  const myTiles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('.hand-tile')).filter((b) => !b.disabled);

  it('始めると親の自分に 14 枚。牌を 1 枚切ると河に出て、CPU の番が回って自分の番に戻る', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button'));
    run(100);

    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(14);
    // 他の人の手牌は伏せた絵だけ（表の絵が画面に届いていない）
    const others = container.querySelectorAll('.seat-hand:not(.rel-0) .tile, .lane-count .tile');
    expect(others.length).toBeGreaterThan(0);
    others.forEach((el) => expect(el.querySelector('img')!.getAttribute('src')).toMatch(/back\.svg$/));

    const first = myTiles(container)[0];
    fireEvent.pointerUp(first, { pointerType: 'mouse' });
    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(13);
    expect(container.querySelectorAll('.river .tile').length).toBe(1);

    // CPU 3 人が打つ（それぞれツモと打牌の間を置く）
    run(5000);
    expect(container.querySelectorAll('.river .tile').length).toBeGreaterThanOrEqual(4);
    expect(myTiles(container)).toHaveLength(14);
  });

  it('指で押すときは 1 回目で浮かせるだけ、2 回目で切る', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button'));
    run(100);
    const tile = myTiles(container)[3];
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(tile).toHaveClass('raised');
    expect(container.querySelectorAll('.river .tile').length).toBe(0);
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(container.querySelectorAll('.river .tile').length).toBe(1);
  });

  it('自分がツモ切りを続けると、局が終わって結果ともう一局のボタンが出る', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button'));
    for (let i = 0; i < 40 && !container.querySelector('.result'); i++) {
      run(5000);
      const tsumo = Array.from(container.querySelectorAll('.hand-actions .btn-primary'));
      const mine = myTiles(container);
      if (tsumo.length) fireEvent.click(tsumo[0]);
      else if (mine.length) fireEvent.pointerUp(mine[mine.length - 1], { pointerType: 'mouse' });
    }
    run(5000);
    expect(container.querySelector('.result')).not.toBeNull();
    expect(screen.getByRole('dialog').querySelector('button')).not.toBeNull();
  });
});
