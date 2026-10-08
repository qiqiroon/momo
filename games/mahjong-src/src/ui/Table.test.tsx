// 卓の画面の検査（段階2）：ドラ表示牌・ツモアガリの役と点数の表示・リーチのボタン・流局の宣言と結果。
// アガリの局面は自動対局の打ち手で実際に回した出来事の列から作る。リーチは配る牌を指定した列から作る。
import { fireEvent, render, screen } from '@testing-library/react';
import type { Envelope, GameEvent } from '../engine/events';
import { act, legalActions, type Action } from '../engine/round';
import { benchCpu } from '../cpu/bench';
import { apply, initialState, viewFor } from '../engine/state';
import { playOne } from '../selfplay/run';
import { GENERAL_RULES } from '../engine/rules';
import { Table } from './Table';

/** 鳴いていない手のツモアガリで終わる局を種を替えながら探す（検査用の打ち手は 1 割ほどアガる。門前清自摸和が必ず付く形） */
function wonLog() {
  for (let i = 0; i < 200; i++) {
    const r = playOne(`table-${i}`, GENERAL_RULES, benchCpu);
    if (r.ending === 'tsumo' && !r.failure && r.result?.type === 'tsumo' && r.finalMelds[r.result.seat].length === 0) return r.log;
  }
  throw new Error('ツモアガリの局が見つからない');
}

describe('卓の画面（段階2）', () => {
  it('ツモアガリの結果に、役・翻・符・支払い・合計が出る（日本語）', () => {
    const view = viewFor(wonLog(), 0);
    if (view.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    const score = view.result.score;
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('門前清自摸和')).toBeInTheDocument(); // 鳴きの無い段階2のツモには必ず付く
    expect(screen.getByText(`合計 ${score.total}点`)).toBeInTheDocument();
    expect(document.querySelector('.score-level')!.textContent).toMatch(/翻|役満/);
    expect(document.querySelector('.score-pay')!.textContent).toMatch(/点/);
    // アガリ牌は手牌の右に離して印を付ける
    expect(document.querySelectorAll('.result-hand .win-tile')).toHaveLength(1);
    // ドラ表示牌が出ている
    expect(document.querySelector('.dora-ind')).not.toBeNull();
  });

  it('英語・中国語でも役の名前と合計が出る', () => {
    const view = viewFor(wonLog(), 0);
    if (view.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    const { unmount } = render(<Table view={view} legal={[]} lang="en" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('Menzen Tsumo')).toBeInTheDocument();
    expect(screen.getByText(`Total ${view.result.score.total}`)).toBeInTheDocument();
    unmount();
    render(<Table view={view} legal={[]} lang="zh" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('门前清自摸和')).toBeInTheDocument();
    expect(screen.getByText(`合计 ${view.result.score.total}点`)).toBeInTheDocument();
  });
});

/** 席 0（親）が 123m456p789s1122z をもらい、3z をツモったところ（3z を切ればリーチできる）。ほかの 3 人もテンパイ */
function riichiView() {
  let s = initialState();
  let seq = 0;
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => (s = apply(s, { seq: seq++, to, ev }));
  const kinds = (list: number[]) => list.map((kd, i) => kd * 4 + 3 - (list.slice(0, i).filter((x) => x === kd).length));
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles: kinds([0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 28, 28]) }, [0]);
  push({ type: 'deal', seat: 1, tiles: kinds([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7]) }, [1]);
  push({ type: 'deal', seat: 2, tiles: kinds([9, 9, 9, 10, 10, 10, 11, 11, 11, 15, 15, 15, 16]) }, [2]);
  push({ type: 'deal', seat: 3, tiles: kinds([18, 18, 18, 19, 19, 19, 20, 20, 20, 21, 21, 21, 22]) }, [3]);
  push({ type: 'doraReveal', tile: 33 * 4 + 3 });
  push({ type: 'draw', seat: 0, tile: 29 * 4 + 3 }, [0]);
  return s;
}

describe('リーチのボタン（段階2）', () => {

  it('リーチを押すとリーチできる牌だけ押せて、押すとリーチで切る。もう一度押すとやめる', () => {
    const view = riichiView();
    const chosen: Action[] = [];
    render(<Table view={view} legal={legalActions(view, 0)} lang="ja" onChoose={(a) => chosen.push(a)} onAgain={() => {}} />);
    const riichi = () => document.querySelector<HTMLButtonElement>('.btn-riichi')!;
    const enabled = () => [...document.querySelectorAll<HTMLButtonElement>('.my-hand .hand-tile')].filter((b) => !b.disabled);
    expect(enabled()).toHaveLength(14);
    fireEvent.click(riichi());
    expect(screen.getByText('リーチで切る牌を選んでください')).toBeInTheDocument();
    expect(enabled()).toHaveLength(1);
    fireEvent.click(riichi()); // やめる
    expect(enabled()).toHaveLength(14);
    fireEvent.click(riichi());
    fireEvent.pointerUp(enabled()[0], { pointerType: 'mouse' });
    expect(chosen).toEqual([{ type: 'riichi', tile: 29 * 4 + 3 }]);
  });

  it('リーチした人の宣言牌は横に曲げ、名札に印が出る', () => {
    let view = riichiView();
    view = apply(view, { seq: view.nextSeq, to: 'all', ev: { type: 'discard', seat: 0, tile: 29 * 4 + 3, tsumogiri: true, riichi: true } });
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(document.querySelectorAll('.riichi-tile')).toHaveLength(1);
    expect(document.querySelectorAll('.riichi-mark').length).toBeGreaterThan(0);
  });
});

describe('フリテンの表示（段階2）', () => {
  /** 席 0 が 3z をツモ切りしたところ（1z・2z のシャンポン待ち）。河に別の 1z を足すとフリテン */
  function afterDiscard() {
    const v = riichiView();
    return apply(v, { seq: v.nextSeq, to: 'all', ev: { type: 'discard', seat: 0, tile: 29 * 4 + 3, tsumogiri: true } });
  }

  it('フリテンでなければ印も枠も出ない', () => {
    render(<Table view={afterDiscard()} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(document.querySelectorAll('.furiten-mark')).toHaveLength(0);
    expect(document.querySelectorAll('.furiten-cause')).toHaveLength(0);
  });

  it('待ち牌が自分の河にあれば、名札に「フリテン」が出て、その牌に枠が付く（他人の河の同じ牌には付かない）', () => {
    const v = afterDiscard();
    const view = { ...v, discards: [[27 * 4 + 0, ...v.discards[0]], [27 * 4 + 1], v.discards[2], v.discards[3]] };
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getAllByText('フリテン').length).toBeGreaterThan(0);
    const causes = [...document.querySelectorAll('.furiten-cause')];
    expect(causes).toHaveLength(1);
    expect(causes[0].getAttribute('data-tile')).toBe('1z');
  });

  it('見逃しだけのフリテンは、印だけで枠は付かない（英語・中国語の印）', () => {
    const view = { ...afterDiscard(), missedRiichi: [true, false, false, false] };
    const { unmount } = render(<Table view={view} legal={[]} lang="en" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getAllByText('Furiten').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.furiten-cause')).toHaveLength(0);
    unmount();
    render(<Table view={view} legal={[]} lang="zh" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getAllByText('振听').length).toBeGreaterThan(0);
  });
});

describe('流局の宣言と結果（段階2）', () => {
  /** 席 0 がテンパイ（リーチなし）のまま流局したところ */
  function exhaustView() {
    let s = riichiView();
    s = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'discard', seat: 0, tile: 29 * 4 + 3, tsumogiri: true } });
    for (const seat of [1, 2, 3] as const) s = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'pass', seat } });
    s = { ...s, wallLeft: 14 }; // 山を尽きさせる
    return apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'exhaust' } });
  }

  it('テンパイでリーチしていなければ「テンパイ」「ノーテン」のボタンが出る', () => {
    const view = exhaustView();
    const chosen: Action[] = [];
    render(<Table view={view} legal={legalActions(view, 0)} lang="ja" onChoose={(a) => chosen.push(a)} onAgain={() => {}} />);
    expect(document.querySelector('.btn-tenpai')).not.toBeNull();
    fireEvent.click(document.querySelector('.btn-noten')!);
    expect(chosen).toEqual([{ type: 'noten' }]);
  });

  it('全員が宣言すると、結果にテンパイ・ノーテンと点の動きが出る', () => {
    let view = exhaustView();
    // 自分（親）はテンパイを隠してノーテン、ほかの 3 人はテンパイ
    for (const e of act(view, 0, { type: 'noten' })) view = apply(view, e);
    while (view.phase === 'declare') for (const e of act(view, view.turn, legalActions(view, view.turn)[0])) view = apply(view, e);
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    // 表は自分から下家・対面・上家の順
    const pays = [...document.querySelectorAll('.exhaust-list tr:not(.exhaust-hand-row)')].map((r) => r.querySelector('.exhaust-pay')!.textContent);
    expect(pays).toEqual(['−3000', '+1000', '+1000', '+1000']);
    // テンパイの 3 人だけ手牌を開ける（名前の行の下に 1 行ずつ）
    expect(document.querySelectorAll('.exhaust-hand-row')).toHaveLength(3);
    expect(document.querySelectorAll('.exhaust-hand-row .tile')).toHaveLength(39);
  });
});

/** 席 0 に mine を配り、一巡して席 3 が last を切ったところ */
function roundView(mine: string, last: string) {
  let s = initialState();
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => (s = apply(s, { seq: s.nextSeq, to, ev }));
  const used = new Map<number, number>();
  const tiles = (str: string) =>
    [...str.matchAll(/(\d)([mpsz])/g)].map(([, d, suit]) => {
      const kind = { m: 0, p: 9, s: 18, z: 27 }[suit as 'm'] + Number(d) - 1;
      const n = used.get(kind) ?? 0;
      used.set(kind, n + 1);
      return kind * 4 + 3 - n;
    });
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles: tiles(mine) }, [0]);
  push({ type: 'deal', seat: 1, tiles: tiles('1m1m1m9m9m9m1p1p1p9p9p9p1z') }, [1]);
  push({ type: 'deal', seat: 2, tiles: tiles('2z2z3z3z4z4z6z6z1s1s9s9s7z') }, [2]);
  push({ type: 'deal', seat: 3, tiles: tiles('1m2m7m7m8p8p3s3s5z5z6z1z9m') }, [3]);
  push({ type: 'doraReveal', tile: tiles('8s')[0] });
  const round = (seat: 0 | 1 | 2 | 3, t: string) => {
    const tile = tiles(t)[0];
    push({ type: 'draw', seat, tile }, [seat]);
    push({ type: 'discard', seat, tile, tsumogiri: true });
    if (seat !== 3) for (const d of [1, 2, 3]) push({ type: 'pass', seat: ((seat + d) % 4) as 0 | 1 | 2 | 3 });
  };
  round(0, '7z');
  round(1, '5z');
  round(2, '4z');
  round(3, last);
  return s;
}

describe('ロン（段階3）', () => {
  /** 席 0（あなた・親）が 2p・5s のシャンポン待ち（タンヤオ）。一巡して席 3 が 5s を切ったところ */
  function ronView() {
    return roundView('2m3m4m4p5p6p6s7s8s2p2p5s5s', '5s');
  }

  it('ロンできるときだけ「ロン」「見送る」が出て、押すとその返事を選ぶ', () => {
    const view = ronView();
    const chosen: Action[] = [];
    render(<Table view={view} legal={legalActions(view, 0)} lang="ja" onChoose={(a) => chosen.push(a)} onAgain={() => {}} />);
    expect(screen.getByText('切られた牌でアガれます。ロンしますか？')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.btn-ron')!);
    fireEvent.click(document.querySelector('.btn-pass')!);
    expect(chosen).toEqual([{ type: 'ron' }, { type: 'pass' }]);
  });

  it('ロンの結果に、誰から・役・点数が出る（親の 40 符 1 翻＝2000 点）', () => {
    let view = ronView();
    for (const ev of [{ type: 'ron', seat: 0, hand: view.hands[0].slice(), ura: [] }, { type: 'pass', seat: 1 }, { type: 'pass', seat: 2 }] as GameEvent[]) {
      view = apply(view, { seq: view.nextSeq, to: 'all', ev });
    }
    render(<Table view={view} legal={[]} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    expect(screen.getByText('あなたのロンアガリ（CPU 3から）')).toBeInTheDocument();
    expect(screen.getByText('断么九')).toBeInTheDocument();
    expect(screen.getByText('2000点')).toBeInTheDocument();
  });
});

describe('チー・ポン（段階3）', () => {
  // 席 0（あなた）が 2p2p を持ち、席 3 が 2p を切ったところ（テンパイではない＝ロンは無い）
  const ponView = () => roundView('2m3m4m4p5p6p6s7s8s2p2p5s9s', '2p');

  it('ポンできるときは「ポン」と出す 2 枚・「見送る」が出て、押すとそのポンを選ぶ', () => {
    const view = ponView();
    const chosen: Action[] = [];
    render(<Table view={view} legal={legalActions(view, 0)} lang="ja" onChoose={(a) => chosen.push(a)} onAgain={() => {}} />);
    expect(screen.getByText('鳴けます。鳴きますか？')).toBeInTheDocument();
    expect(document.querySelector('.btn-ron')).toBeNull();
    const pon = document.querySelector('.btn-pon')!;
    expect(pon.querySelectorAll('.call-tiles .tile')).toHaveLength(2);
    fireEvent.click(pon);
    expect(chosen[0].type).toBe('pon');
  });

  it('ポンしたら手牌の右に面子が並び、上家から鳴いた牌は左端で横に曲がる。鳴かれた牌は河から消える', () => {
    let view = ponView();
    const pon = legalActions(view, 0).find((a) => a.type === 'pon')!;
    if (pon.type !== 'pon') throw new Error('ポンのはず');
    for (const ev of [{ type: 'call', seat: 0, meld: 'pon', tiles: pon.tiles }, { type: 'pass', seat: 1 }, { type: 'pass', seat: 2 }] as GameEvent[]) {
      view = apply(view, { seq: view.nextSeq, to: 'all', ev });
    }
    expect(view.melds[0]).toHaveLength(1);
    const riverBefore = view.discards[3].length;
    render(<Table view={view} legal={legalActions(view, 0)} lang="ja" onChoose={() => {}} onAgain={() => {}} />);
    const meld = document.querySelector('.my-hand .meld')!;
    const tiles = [...meld.querySelectorAll('.tile')];
    expect(tiles).toHaveLength(3);
    expect(tiles[0].classList.contains('called-tile')).toBe(true); // 上家（席 3）から＝左端
    expect(document.querySelectorAll('.my-hand .hand-tile')).toHaveLength(11);
    // 席 3 は 1 枚切って、それを持っていかれた＝河には並びだけ残り、画面には出ない
    expect(riverBefore).toBe(1);
    const shown = [...document.querySelectorAll('.river, .river-rows')].map((r) => r.querySelectorAll('.tile').length);
    expect(shown.reduce((a, b) => a + b, 0)).toBe(view.discards.reduce((n, d) => n + d.length, 0) - 1);
  });
});
