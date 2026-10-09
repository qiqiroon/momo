import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { APP_VERSION } from './version';
import { baseOf, translate } from './i18n/strings';

const container = () => document.body;

/** 始めるボタン（言語が変わっても見つかるよう、主ボタンの印で探す） */
const startButton = () => {
  // モード選択にいるときは「CPU と対局」を押して、ルールを選ぶ画面の始めるボタンを返す
  if (!document.querySelector('.btn-start')) fireEvent.click(document.querySelector('.mode-row')!);
  return document.querySelector<HTMLButtonElement>('.btn-start')!;
};

describe('始める画面', () => {
  it('アプリ名・版番号・始めるボタンが出る', () => {
    render(<App startConsented />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('MOMO');
    expect(h1).toHaveTextContent('Mahjong');
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument(); // 言語選択
    expect(container().querySelector('.header-right .icon-btn')).not.toBeNull(); // 歯車
  });

  it('言語を選ぶと画面の言葉が切り替わる', () => {
    render(<App startConsented />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByText('Play vs CPU')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh' } });
    expect(screen.getByText('与电脑对局')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
  });

  it('CAT を選ぶと、日本語から選んだときは にゃあ 系の鳴き声になり、描き直しても同じ言葉のまま', () => {
    render(<App startConsented />);
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
    render(<App startConsented />);
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

  /** 河に出ている牌の数 */
  const riverCount = (container: HTMLElement) => container.querySelectorAll('.river .tile, .river-row .tile').length;
  /** 自分の番（14 枚で切れる）まで進める。親決めで起家が CPU のこともある。チー・ポンできるときは見送る */
  const untilMyTurn = (container: HTMLElement) => {
    for (let i = 0; i < 30 && myTiles(container).length !== 14; i++) {
      run(600);
      const pass = container.querySelector('.btn-pass');
      if (pass) fireEvent.click(pass);
    }
  };

  /** 自分の手牌のボタン（押せるものだけ） */
  const myTiles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('.hand-tile')).filter((b) => !b.disabled);

  it('自分の番になると 14 枚。牌を 1 枚切ると河に出て、CPU の番が回って自分の番に戻る', () => {
    const { container } = render(<App startConsented />);
    fireEvent.click(startButton());
    untilMyTurn(container);

    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(14);
    // 他の人の手牌は伏せた絵だけ（表の絵が画面に届いていない）
    const others = container.querySelectorAll('.seat-hand:not(.rel-0) .tile, .lane-count .tile');
    expect(others.length).toBeGreaterThan(0);
    others.forEach((el) => expect(el.querySelector('img')!.getAttribute('src')).toMatch(/back\.svg$/));

    const before = riverCount(container);
    const first = myTiles(container)[0];
    fireEvent.pointerUp(first, { pointerType: 'mouse' });
    expect(container.querySelectorAll('.my-hand .hand-tile')).toHaveLength(13);
    expect(riverCount(container)).toBe(before + 1);

    // CPU 3 人が打つ（それぞれツモと打牌の間を置く）。CPU の牌でチー・ポンできるときは止まるので見送る
    for (let i = 0; i < 10; i++) {
      run(600);
      const pass = container.querySelector('.btn-pass');
      if (pass) fireEvent.click(pass);
    }
    expect(riverCount(container)).toBeGreaterThanOrEqual(before + 4);
    expect(myTiles(container)).toHaveLength(14);
  });

  it('指で押すときは 1 回目で浮かせるだけ、2 回目で切る', () => {
    const { container } = render(<App startConsented />);
    fireEvent.click(startButton());
    untilMyTurn(container);
    const before = riverCount(container);
    const tile = myTiles(container)[3];
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(tile).toHaveClass('raised');
    expect(riverCount(container)).toBe(before);
    fireEvent.pointerUp(tile, { pointerType: 'touch' });
    expect(riverCount(container)).toBe(before + 1);
  });

  it('自分がツモ切りを続けると、局が終わって結果ともう一局のボタンが出る', () => {
    const { container } = render(<App startConsented />);
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

  it('開いた瞬間に出て、閉じるボタンは無く、同意すると消える。端末には覚えない', () => {
    render(<App />);
    expect(screen.getByRole('dialog')).toHaveTextContent('賭けに使わないでください');
    expect(screen.queryByText('閉じる')).toBeNull();
    fireEvent.click(agree()!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('momo-mahjong.consent')).toBeNull();
  });

  it('同意画面からリンク先（公平性）を開いて戻れる。戻るまで同意のボタンは出ない', () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '対局の公平性とルールの再現について' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('公平性について');
    expect(agree()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(agree()).not.toBeNull();
  });

  it('起動するたびに出す（前に同意した記録が端末に残っていても出す）', () => {
    const { unmount } = render(<App />);
    fireEvent.click(agree()!);
    unmount();
    localStorage.setItem('momo-mahjong.consent', 'v0.03'); // v0.05 までの版が残した記録
    render(<App />);
    expect(screen.getByRole('dialog')).toHaveTextContent('賭けに使わないでください');
    localStorage.removeItem('momo-mahjong.consent');
  });

  it('同意したあとはトップ画面の下のリンクから読み返せて、閉じられる', () => {
    render(<App startConsented />);
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

describe('モード選択と、そこから入る画面', () => {
  it('3 つのメニューが牌（ピンズの 1〜3）の絵と並び、フッターにこのアプリの説明と MOMO Works へのリンクがある', () => {
    render(<App startConsented />);
    const rows = [...document.querySelectorAll('.mode-list .mode-row')];
    expect(rows.map((r) => r.querySelector('.mode-name')!.textContent)).toEqual(['CPU と対局', 'オンライン対局', '対局の再生']);
    expect(rows.map((r) => r.querySelector('img')!.getAttribute('src'))).toEqual(['/momo/games/mahjong/tiles/1p.svg', '/momo/games/mahjong/tiles/2p.svg', '/momo/games/mahjong/tiles/3p.svg']);
    const footer = document.querySelector('.site-footer')!;
    expect(footer).toHaveTextContent('MOMO Mahjong について');
    expect([...footer.querySelectorAll('.foot-links a')].map((a) => a.getAttribute('href'))).toEqual(['../../', '../../games/', '../../tools/']);
    expect(footer.querySelector('.title-foot')).toHaveTextContent('賭けには使えません');
  });

  it('CPU と対局：ルールセットは一般ルールが選ばれ、まだ動かないセットを押しても変わらない。モード選択へ戻れる', () => {
    render(<App startConsented />);
    fireEvent.click(screen.getByText('CPU と対局'));
    expect(document.querySelector('.sets .seg button.on')).toHaveTextContent('一般ルール');
    fireEvent.click(screen.getByRole('button', { name: /天鳳/ }));
    expect(document.querySelector('.sets .seg button.on')).toHaveTextContent('一般ルール');
    expect(document.querySelector('.site-footer')).toBeNull();
    // 対局を始めるは見出しのすぐ下（ルールセットより前）、戻るはその右
    const start = document.querySelector('.btn-start')!;
    expect(start.compareDocumentPosition(document.querySelector('.gset')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.nextElementSibling).toHaveTextContent('戻る');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(3);
  });

  it('対局の再生：前回の対局が無いときは、前回の対局の再生と保存は押せない。端末のファイルは選べる', () => {
    localStorage.removeItem('momo-mahjong.lastGame');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('対局の再生'));
    fireEvent.click(screen.getByText('再生する'));
    expect(screen.getByRole('button', { name: '前回の対局' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'この端末のファイル' })).not.toBeDisabled();
    fireEvent.click(screen.getByText('前回の対局を保存する'));
    // 開くのは押した行の下だけ（再生の選択肢は閉じる）＝出ている選択肢は保存先の 2 つ
    const choices = [...document.querySelectorAll('.mode-choices button')];
    expect(choices.map((b) => b.textContent)).toEqual(['この端末のファイル', 'Google ドライブ']);
    for (const b of choices) expect(b).toBeDisabled();
  });
});

describe('見出しのボタン（対局の中断・画面切替）と同意画面の赤い見出し', () => {
  it('モード選択には「対局を中断」も「画面切替」も出ない。対局中だけ出て、中断は確かめてからモード選択へ戻る', () => {
    render(<App startConsented />);
    expect(screen.queryByText('対局を中断')).toBeNull();
    expect(screen.queryByText('画面切替')).toBeNull();
    fireEvent.click(startButton());
    expect(screen.getByText('対局を中断')).toBeInTheDocument();
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByText('対局を中断'));
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(0); // やめるを選べば対局のまま
    fireEvent.click(screen.getByText('対局を中断'));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(3);
    ask.mockRestore();
  });

  it('牌譜の再生中も卓を出す画面なので「画面切替」が出る（再生の入口の画面には出ない）', () => {
    render(<App startConsented />);
    fireEvent.click(startButton());
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('対局を中断')); // 途中までの対局が「前回の対局」になる
    ask.mockRestore();
    fireEvent.click(screen.getByText('対局の再生'));
    expect(screen.queryByText('画面切替')).toBeNull();
    fireEvent.click(screen.getByText('再生する'));
    fireEvent.click(screen.getByRole('button', { name: '前回の対局' }));
    expect(screen.getByText('画面切替')).toBeInTheDocument();
    fireEvent.click(screen.getByText('再生を終える'));
    expect(screen.queryByText('画面切替')).toBeNull();
  });

  it('同意画面は、隠れている所まで送って読むまで同意を押せない', () => {
    // 本文が窓より長い（1000px の中身を 300px で見ている）ことにする
    const h = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    const c = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    render(<App />);
    const agree = document.querySelector<HTMLButtonElement>('.btn-agree')!;
    expect(agree).toBeDisabled();
    expect(screen.getByText('最後まで読むと、同意のボタンを押せます。')).toBeInTheDocument();
    const body = document.querySelector<HTMLElement>('.notice-body')!;
    body.scrollTop = 700;
    fireEvent.scroll(body);
    expect(document.querySelector('.btn-agree')).not.toBeDisabled();
    h.mockRestore();
    c.mockRestore();
  });

  it('同意画面の「賭けに使わないでください」の見出しは赤い字の印が付く', () => {
    render(<App />);
    expect(document.querySelector('.notice-warn')).toHaveTextContent('賭けに使わないでください');
  });
});
