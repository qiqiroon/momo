import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { APP_VERSION } from './version';
import { CONSENT_VERSION } from './i18n/notice';
import { baseOf, translate } from './i18n/strings';

const container = () => document.body;

// 同意画面の検査以外は、同意済みの端末として始める
beforeEach(() => localStorage.setItem('momo-mahjong.consent', CONSENT_VERSION));
afterEach(() => localStorage.removeItem('momo-mahjong.consent'));
/** 始めるボタン（言語が変わっても見つかるよう、主ボタンの印で探す） */
const startButton = () => document.querySelector<HTMLButtonElement>('.btn-start')!;

describe('始める画面', () => {
  it('アプリ名・版番号・始めるボタンが出る', () => {
    render(<App />);
    const h1 = screen.getByRole('heading');
    expect(h1).toHaveTextContent('MOMO');
    expect(h1).toHaveTextContent('Mahjong');
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument(); // 言語選択
    expect(container().querySelector('.header-right .icon-btn')).not.toBeNull(); // 歯車
  });

  it('言語を選ぶと画面の言葉が切り替わる', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByText('Play vs CPU')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh' } });
    expect(screen.getByText('与电脑对局')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
  });

  it('CAT を選ぶと、日本語から選んだときは にゃあ 系の鳴き声になり、描き直しても同じ言葉のまま', () => {
    render(<App />);
    const sel = screen.getByRole('combobox');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toContain('CAT');
    fireEvent.change(sel, { target: { value: 'ja' } });
    fireEvent.change(sel, { target: { value: 'cat' } });
    const word = startButton().textContent;
    expect(['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！']).toContain(word);
    fireEvent.click(startButton());
    // 卓の言葉も鳴き声（局の表示）。もう一度描かれても同じ
    const round = document.querySelector('.round-label')!.textContent;
    expect(['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！']).toContain(round);
    // サブタイトルは猫語にしない（猫語を選ぶ直前の言語のまま）
    expect(document.querySelector('.subtitle')).toHaveTextContent('Any Rule, Any Table');
    fireEvent.change(sel, { target: { value: 'ja' } });
  });

  it('対局中も見出しはアイコン・タイトル・バージョン・サブタイトルを出し、右上に歯車と言語選択がある', () => {
    render(<App />);
    fireEvent.click(startButton());
    const header = container().querySelector('.site-header')!;
    expect(header.querySelector('.cat-icon')).not.toBeNull();
    expect(header.querySelector('.version-tag')).toHaveTextContent(APP_VERSION);
    expect(header.querySelector('.subtitle')).toHaveTextContent('Any Rule, Any Table');
    expect(header.querySelector('.header-right .icon-btn')).not.toBeNull();
    expect(header.querySelector('.header-right select')).not.toBeNull();
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
    fireEvent.click(startButton());
    run(100);

    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(14);
    // 他の人の手牌は伏せた絵だけ（表の絵が画面に届いていない）
    const others = container.querySelectorAll('.seat-hand:not(.rel-0) .tile, .lane-count .tile');
    expect(others.length).toBeGreaterThan(0);
    others.forEach((el) => expect(el.querySelector('img')!.getAttribute('src')).toMatch(/back\.svg$/));

    const first = myTiles(container)[0];
    fireEvent.pointerUp(first, { pointerType: 'mouse' });
    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(13);
    expect(container.querySelectorAll('.river .tile, .river-row .tile').length).toBe(1);

    // CPU 3 人が打つ（それぞれツモと打牌の間を置く）。CPU の牌でチー・ポンできるときは止まるので見送る
    for (let i = 0; i < 10; i++) {
      run(600);
      const pass = container.querySelector('.btn-pass');
      if (pass) fireEvent.click(pass);
    }
    expect(container.querySelectorAll('.river .tile, .river-row .tile').length).toBeGreaterThanOrEqual(4);
    expect(myTiles(container)).toHaveLength(14);
  });

  it('指で押すときは 1 回目で浮かせるだけ、2 回目で切る', () => {
    const { container } = render(<App />);
    fireEvent.click(startButton());
    run(100);
    const tile = myTiles(container)[3];
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(tile).toHaveClass('raised');
    expect(container.querySelectorAll('.river .tile, .river-row .tile').length).toBe(0);
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(container.querySelectorAll('.river .tile, .river-row .tile').length).toBe(1);
  });

  it('自分がツモ切りを続けると、局が終わって結果ともう一局のボタンが出る', () => {
    const { container } = render(<App />);
    fireEvent.click(startButton());
    for (let i = 0; i < 40 && !container.querySelector('.result'); i++) {
      run(5000);
      const tsumo = Array.from(container.querySelectorAll('.hand-actions .btn-tsumo'));
      const mine = myTiles(container);
      const tenpai = container.querySelector('.btn-tenpai');
      // 鳴ける・ロンできるときは止まって待つ＝見送る
      const pass = container.querySelector('.btn-pass');
      if (pass) fireEvent.click(pass);
      else if (tenpai) fireEvent.click(tenpai);
      else if (tsumo.length) fireEvent.click(tsumo[0]);
      else if (mine.length) fireEvent.pointerUp(mine[mine.length - 1], { pointerType: 'mouse' });
    }
    run(5000);
    expect(container.querySelector('.result')).not.toBeNull();
    expect(screen.getByRole('dialog').querySelector('button')).not.toBeNull();
  });
});

describe('ご利用にあたって（同意画面）', () => {
  const agree = () => document.querySelector<HTMLButtonElement>('.btn-agree');
  beforeEach(() => localStorage.removeItem('momo-mahjong.consent'));

  it('同意していない端末では開いた瞬間に出て、閉じるボタンは無く、同意すると消えて端末に覚える', () => {
    render(<App />);
    expect(screen.getByRole('dialog')).toHaveTextContent('賭けに使わないでください');
    expect(screen.queryByText('閉じる')).toBeNull();
    fireEvent.click(agree()!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('momo-mahjong.consent')).toBe(CONSENT_VERSION);
  });

  it('同意画面からリンク先（公平性）を開いて戻れる。戻るまで同意のボタンは出ない', () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '対局の公平性とルールの再現について' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('公平性について');
    expect(agree()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(agree()).not.toBeNull();
  });

  it('前の版の同意しか無い端末では、もう一度出す', () => {
    localStorage.setItem('momo-mahjong.consent', 'v0.00');
    render(<App />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('同意したあとはトップ画面の下のリンクから読み返せて、閉じられる', () => {
    localStorage.setItem('momo-mahjong.consent', CONSENT_VERSION);
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container().querySelector('.title-foot')).toHaveTextContent('娯楽目的のゲームです。賭けには使えません。');
    fireEvent.click(screen.getByRole('button', { name: '対局の公平性とルールの再現について' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('ルールの再現は完全ではありません');
    expect(screen.queryByRole('button', { name: '戻る' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container().querySelector('.title-foot a')?.getAttribute('href')).toBe('../../terms.html');
  });

  it('猫語のときも鳴き声にせず、猫語を選ぶ直前の言語で出す', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Do not use it for gambling.');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cat' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Do not use it for gambling.');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
  });
});

describe('対局終了の画面の1行', () => {
  it('「賭博に使用しないことに同意しています」を含み、猫語でも鳴き声にしない', () => {
    expect(translate('ja', 'noMoney')).toContain('賭博に使用しないことに同意しています');
    expect(translate('cat', 'noMoney')).toBe(translate(baseOf('cat'), 'noMoney'));
  });
});
