// 一人用の卓の進行役（画面側）。人間は席 0、ほかの 3 席は仮の CPU。
// 出来事の列を持ち、全部を知る局面（full）と、席 0 から見える局面（view）を並べて育てる。
// 画面には view だけを渡す＝他の人の手牌や山の並びは画面に届かない。
// 一人用は自分の端末が山を作る（オンラインの配り方は段階5）。

import { useCallback, useEffect, useReducer } from 'react';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { mask, type Envelope, type Seat } from '../engine/events';
import { act, advance, legalActions, startRound, type Action } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { apply, initialState, type GameState } from '../engine/state';

export const HUMAN: Seat = 0;
/** CPU が考えているように見せる間（ミリ秒） */
const CPU_DELAY = 420;

interface TableState {
  log: Envelope[];
  full: GameState;
  view: GameState;
}

const empty = (): TableState => ({ log: [], full: initialState(), view: initialState() });

function pushAll(s: TableState, envs: readonly Envelope[]): TableState {
  // 古い局面から作った出来事（二重に届いたもの）は捨てる
  if (envs.length === 0 || envs[0].seq !== s.full.nextSeq) return s;
  let { full, view } = s;
  for (const e of envs) {
    full = apply(full, e);
    view = apply(view, mask(e, HUMAN));
  }
  return { log: [...s.log, ...envs], full, view };
}

type Msg = { type: 'reset' } | { type: 'push'; envs: Envelope[] };

function reducer(s: TableState, m: Msg): TableState {
  return m.type === 'reset' ? empty() : pushAll(s, m.envs);
}

function newSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n.toString(36)).join('');
}

export function useTable() {
  const [s, dispatch] = useReducer(reducer, undefined, empty);
  const { full, view } = s;

  const start = useCallback(() => {
    const first: Envelope = { seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } };
    const afterStart = apply(initialState(), first);
    dispatch({ type: 'reset' });
    dispatch({ type: 'push', envs: [first, ...startRound(afterStart, newSeed(), 0, 0)] });
  }, []);

  // 自動で進むところ：ツモ（人間の番はすぐ・CPU の番は少し間を置く）と CPU の打牌
  useEffect(() => {
    if (full.phase === 'deal' || full.phase === 'draw') {
      const wait = full.turn === HUMAN || full.phase === 'deal' ? 0 : CPU_DELAY / 2;
      const id = setTimeout(() => dispatch({ type: 'push', envs: advance(full) }), wait);
      return () => clearTimeout(id);
    }
    // 流局の宣言：自分が言えることが 1 つだけなら自動で言う（テンパイを隠せるときだけボタンで選ぶ）
    if (full.phase === 'declare' && full.turn === HUMAN) {
      const options = legalActions(full, HUMAN);
      if (options.length !== 1) return undefined;
      const id = setTimeout(() => dispatch({ type: 'push', envs: act(full, HUMAN, options[0]) }), CPU_DELAY / 2);
      return () => clearTimeout(id);
    }
    if ((full.phase === 'discard' || full.phase === 'declare') && full.turn !== HUMAN) {
      const seat = full.turn;
      // CPU には、その席から見える局面だけを渡す
      const cpuView = s.log.reduce((st, e) => apply(st, mask(e, seat)), initialState());
      const id = setTimeout(() => dispatch({ type: 'push', envs: act(full, seat, tsumogiriCpu(cpuView, seat)) }), CPU_DELAY);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [full, s.log]);

  const choose = useCallback(
    (a: Action) => {
      if ((full.phase !== 'discard' && full.phase !== 'declare') || full.turn !== HUMAN) return;
      dispatch({ type: 'push', envs: act(full, HUMAN, a) });
    },
    [full],
  );

  return { view, legal: legalActions(view, HUMAN), start, choose, started: s.log.length > 0 };
}
