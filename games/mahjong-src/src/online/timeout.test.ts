// 時間切れのときに選ぶこと（段階10の2）。決まった場面を手で組む検査と、時間切れだけで対局を回す検査。
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import type { Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { rulesOfCnSet } from '../engine/ruleSets';
import { initialState, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';
import { playOne } from '../selfplay/run';
import { timeoutAction } from './timeout';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
/** "1m" → その種類の 1 枚目の背番号（同じ種類の 2 枚目は "1m'"） */
const id = (s: string): TileId => (BASE[s[1] as 'm'] + Number(s[0]) - 1) * 4 + (s.endsWith("'") ? 1 : 0);
const ids = (s: string) => s.split(' ').map(id);

/** 席 0 の局面（必要なところだけ） */
function view(phase: GameState['phase'], hand: string, drawn: string | null = null): GameState {
  const s = initialState();
  const hands = s.hands.map(() => [] as TileId[]);
  hands[0] = ids(hand);
  const dr = s.drawn.slice();
  dr[0] = drawn === null ? null : id(drawn);
  return { ...s, phase, hands, drawn: dr };
}

describe('時間切れのときに選ぶこと', () => {
  it('返事は見送る（ロン・ポンができても）', () => {
    const legal: Action[] = [{ type: 'ron' }, { type: 'pon', tiles: ids('5p 5p\'') }, { type: 'pass' }];
    expect(timeoutAction(view('claim', '1m'), 0, legal)).toEqual({ type: 'pass' });
  });

  it('自分の番はツモ切り（ツモアガリ・リーチができても）', () => {
    const v = view('discard', '1m 2m 3m 9s', '9s');
    const legal: Action[] = [{ type: 'tsumo' }, ...v.hands[0].map((tile): Action => ({ type: 'discard', tile })), { type: 'riichi', tile: id('1m') }];
    expect(timeoutAction(v, 0, legal)).toEqual({ type: 'discard', tile: id('9s') });
  });

  it('ポン・チーした直後（引いた牌が無い）は、手牌の左端', () => {
    const v = view('discard', '7s 1z 3p 2m 9m');
    const legal = v.hands[0].map((tile): Action => ({ type: 'discard', tile }));
    expect(timeoutAction(v, 0, legal)).toEqual({ type: 'discard', tile: id('2m') });
  });

  it('切れない牌（喰い替え・缺一門の縛り）は飛ばして、その次の左', () => {
    const v = view('discard', '2m 3m 4p 5s', '5s');
    // 引いた 5s も 2m も切れない
    const legal: Action[] = [{ type: 'discard', tile: id('3m') }, { type: 'discard', tile: id('4p') }];
    expect(timeoutAction(v, 0, legal)).toEqual({ type: 'discard', tile: id('3m') });
  });

  it('九種九牌：流さずにツモ切り。「必ず流す」（切れない）ときだけ流す', () => {
    const v = view('discard', '1m 9m 1p', '1z');
    expect(timeoutAction(v, 0, [{ type: 'kyushu' }, { type: 'discard', tile: id('1z') }, { type: 'discard', tile: id('1m') }])).toEqual({ type: 'discard', tile: id('1z') });
    expect(timeoutAction(v, 0, [{ type: 'kyushu' }])).toEqual({ type: 'kyushu' });
  });

  it('流局の宣言はテンパイならテンパイ・やめるかは続ける', () => {
    expect(timeoutAction(view('declare', '1m'), 0, [{ type: 'tenpai' }, { type: 'noten' }])).toEqual({ type: 'tenpai' });
    expect(timeoutAction(view('ended', '1m'), 0, [{ type: 'yame', stop: true }, { type: 'yame', stop: false }])).toEqual({ type: 'yame', stop: false });
  });

  it('缺一門：左端の牌の色（並べた順）', () => {
    const v = view('que', '8s 3p 6m 9s');
    const legal: Action[] = v.hands[0].map((tile): Action => ({ type: 'que', tile, suit: Math.floor(kindOf(tile) / 9) }));
    expect(timeoutAction(v, 0, legal)).toEqual({ type: 'que', tile: id('6m'), suit: 0 });
  });

  it('換三張：左端の牌の色から左の 3 枚。3 枚に満たなければ次の色', () => {
    const v = view('huan3', '9s 1m 2p 5p 3p 7s 8s');
    // 萬子は 1 枚だけ → 筒子の 2p 3p 5p
    const legal: Action[] = [{ type: 'huan3', tiles: ids('2p 3p 5p') }, { type: 'huan3', tiles: ids('7s 8s 9s') }];
    const a = timeoutAction(v, 0, legal);
    expect(a).toEqual({ type: 'huan3', tiles: ids('2p 3p 5p') });
  });
});

/** 時間切れだけで打つ（鳴かない・アガらない）。ポン・チーの直後の道も通すため、鳴きは検査用の打ち手に任せる版も */
const timeoutOnly = (v: GameState, seat: Seat): Action => timeoutAction(v, seat, legalActions(v, seat))!;
const callerThenTimeout = (v: GameState, seat: Seat): Action => (v.phase === 'claim' ? benchCpu(v, seat) : timeoutOnly(v, seat));

describe('時間切れだけで対局を回す', () => {
  it('一般ルール：半荘を最後まで（ポン・チー直後の左端も通る）', () => {
    let afterCall = 0;
    const counting = (v: GameState, seat: Seat): Action => {
      if (v.phase === 'discard' && v.drawn[seat] === null) afterCall++;
      return callerThenTimeout(v, seat);
    };
    for (let i = 0; i < 6; i++) {
      const r = playOne(`timeout-${i}`, GENERAL_RULES, i % 2 ? counting : timeoutOnly, true);
      expect(r.failure).toBeNull();
      expect(r.final.phase).toBe('gameover');
    }
    expect(afterCall).toBeGreaterThan(0);
    // 半荘 6 回で 3 秒ほど。ほかの検査と同時に回って混むと既定の 5 秒を超えた（第26）
  }, 30_000);

  it('四川：缺一門・換三張も時間切れの選び方で進む', () => {
    let que = 0;
    let huan3 = 0;
    const counting = (v: GameState, seat: Seat): Action => {
      if (v.phase === 'que') que++;
      if (v.phase === 'huan3') huan3++;
      return callerThenTimeout(v, seat);
    };
    const rules = rulesOfCnSet('sichuan');
    const withHuan3 = { ...rules, values: { ...rules.values, huan3: 'on' } } as typeof rules;
    for (let i = 0; i < 6; i++) {
      const r = playOne(`timeout-sc-${i}`, i % 2 ? withHuan3 : rules, counting);
      expect(r.failure).toBeNull();
    }
    expect(que).toBeGreaterThan(0);
    expect(huan3).toBeGreaterThan(0);
  });
});
