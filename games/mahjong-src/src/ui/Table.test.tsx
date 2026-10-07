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

/** ツモアガリで終わる局を種を替えながら探す（検査用の打ち手は 1 割ほどアガる） */
function wonLog() {
  for (let i = 0; i < 200; i++) {
    const r = playOne(`table-${i}`, GENERAL_RULES, benchCpu);
    if (r.ending === 'tsumo' && !r.failure) return r.log;
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

describe('流局の宣言と結果（段階2）', () => {
  /** 席 0 がテンパイ（リーチなし）のまま流局したところ */
  function exhaustView() {
    let s = riichiView();
    s = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'discard', seat: 0, tile: 29 * 4 + 3, tsumogiri: true } });
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
