import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { benchCpu } from './cpu/bench';
import { GENERAL_RULES } from './engine/rules';
import { decodeKifuLink, encodeKifuLink } from './kifu/link';
import { encodeSameLink, sameWallOf } from './kifu/same';
import type { KifuSource } from './kifu/kifu';
import type { Envelope } from './engine/events';
import { createRng, shuffle } from './engine/rng';
import { tileSetFor } from './engine/tiles';
import { decodeRuleLink } from './engine/ruleSets';
import { playOne } from './selfplay/run';
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
  // 山の種を固定する。種が毎回ちがうと、CPU が鳴く・アガる山（およそ 4%）に当たったときだけ
  // 「CPU 3 人が打って自分の番に戻る」が成り立たず、走らせるたびに結果が変わる（2026-10-13）。
  // 1 は鳴きもアガリも起きない種（種を変えたら、その山で上の決まりが成り立つか確かめ直す）
  const SEED_WORD = 1;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView>(a: T) => {
      if (a instanceof Uint32Array) a.fill(SEED_WORD);
      return a;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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
    expect(screen.getByRole('dialog')).toHaveTextContent('Do not use this app for gambling');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cat' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Do not use this app for gambling');
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

  it('CPU と対局：最初は一般ルール。日本式のセットと中国式の 3 セット（四川・香港・国標）を選べる。個別に変えるとカスタム。モード選択へ戻れる', () => {
    localStorage.removeItem('momo-mahjong.rules');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('CPU と対局'));
    const on = () => document.querySelector('.sets .seg button.on');
    expect(on()).toHaveTextContent('一般ルール');
    fireEvent.click(screen.getByRole('button', { name: /天鳳/ }));
    expect(on()).toHaveTextContent('天鳳');
    // 四川（段階9）：選べる。中国式の個別設定（2026-10-13 第16）：変えるとカスタム、矛盾する選択肢は押せない
    fireEvent.click(screen.getByRole('button', { name: '四川麻将' }));
    expect(on()).toHaveTextContent('四川麻将');
    expect(document.querySelector('.rule-rows')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).cn).toBe('sichuan');
    fireEvent.click(screen.getByRole('button', { name: /^▶ 点数/ }));
    const pay = [...document.querySelectorAll('.set-row')].find((r) => r.textContent?.startsWith('点の払い方'))! as HTMLElement;
    // 香港式の払いは、点数の数え方が香港の番でないと押せない（理由も出す）
    expect(within(pay).getByRole('button', { name: /香港式/ })).toBeDisabled();
    expect(pay.textContent).toContain('点数の数え方が「四川の番（倍々）」のため選べません');
    const tobi = () => [...document.querySelectorAll('.set-row')].find((r) => r.textContent?.startsWith('飛び'))! as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: /^▶ 対局の形/ }));
    if (!tobi()) fireEvent.click([...document.querySelectorAll('.group.fold.detail')][0]);
    fireEvent.click(within(tobi()).getByRole('button', { name: 'あり' }));
    expect(document.querySelector('.custom-chip.on')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).cnValues.tobi).toBe('on');
    // 香港（段階9 香港の手順1）・国標（国標の手順1）：選べる
    const sets = () => document.querySelector('.sets') as HTMLElement;
    fireEvent.click(within(sets()).getByRole('button', { name: /香港/ }));
    expect(on()).toHaveTextContent('香港麻雀');
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).cn).toBe('hk');
    fireEvent.click(within(sets()).getByRole('button', { name: /国標/ }));
    expect(on()).toHaveTextContent('国標');
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).cn).toBe('mcr');
    // 日本式のセットに戻ると、中国式の選択は外れる
    fireEvent.click(screen.getByRole('button', { name: /天鳳/ }));
    expect(on()).toHaveTextContent('天鳳');
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).cn).toBeUndefined();
    // 個別設定：まとまりを開いて喰いタンを「なし」にするとカスタム（どのセットとも違う）
    fireEvent.click(screen.getByRole('button', { name: /ドラ・役/ }));
    // どのセットも同じ値の項目は「細かい決まり」にさらに畳まれている
    const detail = [...document.querySelectorAll('.group.fold.detail')][0];
    if (detail) fireEvent.click(detail);
    const kuitan = [...document.querySelectorAll('.set-row')].find((r) => r.textContent?.startsWith('喰いタン'))!;
    fireEvent.click(within(kuitan as HTMLElement).getByRole('button', { name: 'なし' }));
    expect(on()).toBeNull();
    expect(document.querySelector('.custom-chip.on')).toHaveTextContent('カスタムルール');
    expect(document.querySelector('.rule-settings .cur')).toHaveTextContent('「天鳳」から変更');
    // 選んだルールは端末に覚える
    expect(JSON.parse(localStorage.getItem('momo-mahjong.rules')!).values.kuitan).toBe('off');
    expect(document.querySelector('.site-footer')).toBeNull();
    // 対局を始めるは見出しのすぐ下（ルールセットより前）、戻るはその右
    const start = document.querySelector('.btn-start')!;
    expect(start.compareDocumentPosition(document.querySelector('.gset')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.nextElementSibling).toHaveTextContent('戻る');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(3);
    localStorage.removeItem('momo-mahjong.rules');
  });

  it('CPU と対局：CPU の強さは最初 Hard。選ぶと端末に覚え、始めた対局の記録にも残る（段階7・Q4=A）', async () => {
    localStorage.removeItem('momo-mahjong.cpuStrength');
    localStorage.removeItem('momo-mahjong.lastGame');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('CPU と対局'));
    const row = document.querySelector('.strength-row') as HTMLElement;
    expect(row).toHaveTextContent('CPU の強さ');
    expect(within(row).getByRole('button', { name: 'Hard' })).toHaveClass('on');
    fireEvent.click(within(row).getByRole('button', { name: 'Apocalypse' }));
    expect(within(row).getByRole('button', { name: 'Apocalypse' })).toHaveClass('on');
    expect(localStorage.getItem('momo-mahjong.cpuStrength')).toBe('apocalypse');
    // 強さの行は、対局を始めるとルールセットのあいだ
    const start = document.querySelector('.btn-start')!;
    expect(start.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(document.querySelector('.gset')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(start);
    // 最後の対局は少し待ってまとめて書く
    await waitFor(() => expect(JSON.parse(localStorage.getItem('momo-mahjong.lastGame') ?? '{}').cpu).toBe('apocalypse'), { timeout: 3000 });
    localStorage.removeItem('momo-mahjong.cpuStrength');
    localStorage.removeItem('momo-mahjong.lastGame');
  });

  it('押せない理由：返し点を「なし」にすると、オカは選べず理由が出る', () => {
    localStorage.removeItem('momo-mahjong.rules');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('CPU と対局'));
    fireEvent.click(screen.getByRole('button', { name: /対局の形/ }));
    const rowOf = (name: string) => [...document.querySelectorAll('.set-row')].find((r) => r.textContent?.startsWith(name)) as HTMLElement;
    fireEvent.click(within(rowOf('返し点')).getByRole('button', { name: 'なし（素点のまま）' }));
    expect(rowOf('オカ')).toHaveTextContent('返し点が「なし（素点のまま）」のため選べません');
    expect(within(rowOf('オカ')).getByRole('button', { name: 'あり' })).toBeDisabled();
    localStorage.removeItem('momo-mahjong.rules');
  });

  it('対局の再生：まだ対局が無いときは、最後に打った・開いた対局の再生と保存は押せない。端末のファイルは選べる', () => {
    localStorage.removeItem('momo-mahjong.lastGame');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('対局の再生'));
    fireEvent.click(screen.getByText('再生する'));
    expect(screen.getByRole('button', { name: '最後に打った・開いた対局' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'この端末のファイル' })).not.toBeDisabled();
    fireEvent.click(screen.getByText('最後に打った・開いた対局を保存する'));
    // 開くのは押した行の下だけ（再生の選択肢は閉じる）＝出ている選択肢は保存先の 4 つ（ファイル・ドライブ・リンク・同じ山で勝負）
    const choices = [...document.querySelectorAll('.mode-choices button')];
    expect(choices.map((b) => b.querySelector('.choice-label')?.textContent)).toEqual(['この端末のファイル', 'Google ドライブ', '対局再生のリンクをコピー', '同じ山で勝負のリンクをコピー']);
    // 4 行とも、何のための保存かの説明が付く
    expect(choices.every((b) => (b.querySelector('.choice-desc')?.textContent ?? '').length > 0)).toBe(true);
    for (const b of choices) expect(b).toBeDisabled();
  });
});

describe('見出しのボタン（対局の中断・画面切替）と同意画面の赤い見出し', () => {
  it('モード選択には「メニュー」も「画面切替」も出ない。対局中だけ出て、メニューの「対局を中断」は確かめてからモード選択へ戻る', () => {
    render(<App startConsented />);
    expect(screen.queryByText('メニュー')).toBeNull();
    expect(screen.queryByText('画面切替')).toBeNull();
    fireEvent.click(startButton());
    expect(screen.queryByText('対局を中断')).toBeNull(); // 中断はメニューの中（段階10・利用者指示 10-15）
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByText('メニュー'));
    fireEvent.click(screen.getByText('対局を中断'));
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(0); // やめるを選べば対局のまま
    fireEvent.click(screen.getByText('メニュー'));
    fireEvent.click(screen.getByText('対局を中断'));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.mode-list .mode-row')).toHaveLength(3);
    ask.mockRestore();
  });

  it('牌譜の再生中も卓を出す画面なので「画面切替」が出る（再生の入口の画面には出ない）', () => {
    render(<App startConsented />);
    fireEvent.click(startButton());
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('メニュー'));
    fireEvent.click(screen.getByText('対局を中断')); // 途中までの対局が「最後に打った・開いた対局」になる
    ask.mockRestore();
    fireEvent.click(screen.getByText('対局の再生'));
    expect(screen.queryByText('画面切替')).toBeNull();
    fireEvent.click(screen.getByText('再生する'));
    fireEvent.click(screen.getByRole('button', { name: '最後に打った・開いた対局' }));
    expect(screen.getByText('画面切替')).toBeInTheDocument();
    fireEvent.click(screen.getByText('再生を終える'));
    expect(screen.queryByText('画面切替')).toBeNull();
  });

  it('対局中のメニュー（一人用）：対局を中断・ルールブック・キャンセル。CPU に任せる・ほかの人の切り替えはオンラインだけ。キャンセルで閉じる', () => {
    render(<App startConsented />);
    fireEvent.click(startButton());
    fireEvent.click(screen.getByText('メニュー'));
    const items = [...document.querySelectorAll('.game-menu button')].map((b) => b.textContent);
    expect(items).toEqual(['対局を中断', 'ルールブック', 'キャンセル']);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(document.querySelector('.game-menu')).toBeNull();
    // ルールブックはメニューから開く
    fireEvent.click(screen.getByText('メニュー'));
    fireEvent.click(within(document.querySelector('.game-menu') as HTMLElement).getByText('ルールブック'));
    expect(document.querySelector('.game-menu')).toBeNull();
    expect(document.querySelector('.rb-head')).not.toBeNull();
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

describe('マイルールのリンク（6c）', () => {
  afterEach(() => {
    history.replaceState(null, '', location.pathname);
    localStorage.removeItem('momo-mahjong.rules');
  });

  it('リンクを開くとルールを見る画面が出て、「このルールで CPU と対局」を選ぶと控えに入り、設定画面がそのルールで開く', () => {
    history.replaceState(null, '', '#rules=tenhou.ippatsu_off');
    render(<App startConsented />);
    expect(screen.getByText('リンクで届いたルール')).toBeInTheDocument();
    expect(container().querySelector('.ro-set')).toHaveTextContent('カスタムルール');
    fireEvent.click(screen.getByText('このルールで CPU と対局'));
    const saved = JSON.parse(localStorage.getItem('momo-mahjong.rules')!);
    expect(saved.base).toBe('tenhou');
    expect(saved.values.ippatsu).toBe('off');
    expect(location.hash).toBe('');
    expect(container().querySelector('.btn-start')).not.toBeNull();
    expect(container().querySelector('.custom-chip.on')).not.toBeNull();
  });

  it('「使わない」なら控えは変わらない。読めないリンクはその旨を出す', () => {
    history.replaceState(null, '', '#rules=tenhou.ippatsu_off');
    render(<App startConsented />);
    fireEvent.click(screen.getByText('使わない'));
    expect(localStorage.getItem('momo-mahjong.rules')).toBeNull();
    expect(location.hash).toBe('');
  });

  it('読めないリンクは「読めませんでした」を出す', () => {
    history.replaceState(null, '', '#rules=nope');
    render(<App startConsented />);
    expect(screen.getByText(/リンクのルールを読めませんでした/)).toBeInTheDocument();
  });
});

describe('牌譜のリンク（6d）', () => {
  afterEach(() => history.replaceState(null, '', location.pathname));

  it('牌譜のリンクを開くと、同意のあとにその対局の再生が始まる。壊れたリンクは理由を出す', async () => {
    const r = playOne('applink', GENERAL_RULES, benchCpu, true);
    const code = await encodeKifuLink({ seed: 'applink', startedAt: '2026-10-11T12:00:00+09:00', players: [], set: 'general', events: r.log });
    history.replaceState(null, '', `#kifu=${code}`);
    render(<App startConsented />);
    await screen.findByText((_, el) => el?.classList.contains('replay') ?? false);
    expect(location.hash).toBe('');
    // 開いた牌譜は「最後に打った・開いた対局」に入る（Q49＝A）
    expect(JSON.parse(localStorage.getItem('momo-mahjong.lastGame')!).seed).toBe('applink');
  });

  it('壊れた牌譜のリンクは、対局の再生の画面に理由を出す', async () => {
    history.replaceState(null, '', '#kifu=abc');
    render(<App startConsented />);
    expect(await screen.findByText(/この牌譜は読めません|読め/)).toBeInTheDocument();
  });
});

describe('同じ山で勝負（6e）', () => {
  afterEach(() => {
    history.replaceState(null, '', location.pathname);
    localStorage.removeItem('momo-mahjong.rules');
  });

  it('リンクを開くと、送った人の成績とルールが出て、「この山で対局を始める」で対局が始まる（端末のルールの控えは変えない）', () => {
    const code = encodeSameLink({ choice: decodeRuleLink('tenhou')!, seed: 'same-seed', strength: 'easy', result: { rank: 1, total: 42.3 } });
    history.replaceState(null, '', `#same=${code}`);
    render(<App startConsented />);
    expect(screen.getByText('同じ山で勝負')).toBeInTheDocument();
    expect(screen.getByText('送ってくれた人の成績：1位・+42.3')).toBeInTheDocument();
    expect(screen.getByText('CPU の強さ：Easy（送ってくれた人と同じ）')).toBeInTheDocument();
    // 山が分かるので公平性は無いことを、始める前に出す（利用者指示 10-11）
    expect(document.querySelector('.same-fair')).toHaveTextContent('成績の比べ合いに公平性はありません');
    fireEvent.click(screen.getByText('この山で対局を始める'));
    expect(location.hash).toBe('');
    expect(container().querySelector('.table-wrap, .square, .lanes-wrap')).not.toBeNull();
    expect(localStorage.getItem('momo-mahjong.rules')).toBeNull();
  });

  it('オンライン対局から作ったリンク（Q5=A）：説明が出て、始めると送った人の席の配牌で打つ。その対局は山ごと牌譜のリンクにできる（オンライン対局とは記録しない）', async () => {
    const r = playOne('app-same-online', GENERAL_RULES, benchCpu, true);
    const walls = r.log.filter((e) => e.ev.type === 'wallSeed').map((e) => (e.ev.type === 'wallSeed' ? shuffle(tileSetFor(GENERAL_RULES), createRng(e.ev.seed ?? '')) : []));
    const sw = sameWallOf({ seed: 'online', startedAt: '2026-10-12T10:00:00+09:00', players: [], set: 'general', events: r.log, mode: 'online', walls, me: 1 });
    localStorage.removeItem('momo-mahjong.lastGame');
    history.replaceState(null, '', `#same=${encodeSameLink(sw)}`);
    render(<App startConsented />);
    // 単独で回すと言語が変わるので、文字でなく欄の印で確かめる
    expect(document.querySelector('.same-online')).not.toBeNull();
    expect(document.querySelector('.same-fair')).not.toBeNull();
    fireEvent.click(document.querySelector('.btn-start')!);
    await waitFor(() => expect(localStorage.getItem('momo-mahjong.lastGame')).not.toBeNull(), { timeout: 3000 });
    const src = JSON.parse(localStorage.getItem('momo-mahjong.lastGame')!) as KifuSource;
    // 自分（席 0）の配牌＝送った人（席 1）の最初の配牌
    const deals = (log: Envelope[], seat: number) => log.slice(0, 40).flatMap((e) => (e.ev.type === 'deal' && e.ev.seat === seat ? e.ev.tiles : []));
    expect(deals(src.events, 0)).toEqual(deals(r.log, 1));
    expect(src.walls?.[0]).toEqual(walls[0]);
    expect(src.mode).toBeUndefined();
    // 牌譜のリンクにして読み直すと、同じ出来事・同じ山（一人用のまま）
    const back = await decodeKifuLink(await encodeKifuLink(src));
    expect(back.events).toEqual(src.events);
    expect(back.mode).toBeUndefined();
    expect(back.walls?.[0]).toEqual(walls[0]);
    localStorage.removeItem('momo-mahjong.lastGame');
  });
  it('壊れたリンクは「読めませんでした」を出す', () => {
    history.replaceState(null, '', '#same=abc');
    render(<App startConsented />);
    expect(screen.getByText(/同じ山で勝負のリンクを読めませんでした/)).toBeInTheDocument();
  });
});
