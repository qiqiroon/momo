// 一人用の卓の進行役（画面側）。人間は席 0、ほかの 3 席は仮の CPU。
// 出来事の列を持ち、全部を知る局面（full）と、席 0 から見える局面（view）を並べて育てる。
// 画面には view だけを渡す＝他の人の手牌や山の並びは画面に届かない。
// 一人用は自分の端末が山を作る（オンラインの配り方は段階5）。

import { useCallback, useEffect, useReducer } from 'react';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { mask, type Envelope, type Seat } from '../engine/events';
import { nextStep } from '../engine/game';
import { act, advance, legalActions, nextHand, startRound, type Action } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { apply, initialState, type GameState } from '../engine/state';

export const HUMAN: Seat = 0;
/** CPU が考えているように見せる間（ミリ秒） */
const CPU_DELAY = 420;

interface TableState {
  /** 対局の種（局ごとの山の種はここから作る） */
  seed: string;
  log: Envelope[];
  full: GameState;
  view: GameState;
}

const empty = (seed = ''): TableState => ({ seed, log: [], full: initialState(), view: initialState() });

function pushAll(s: TableState, envs: readonly Envelope[]): TableState {
  // 古い局面から作った出来事（二重に届いたもの）は捨てる
  if (envs.length === 0 || envs[0].seq !== s.full.nextSeq) return s;
  let { full, view } = s;
  for (const e of envs) {
    full = apply(full, e);
    view = apply(view, mask(e, HUMAN));
  }
  return { seed: s.seed, log: [...s.log, ...envs], full, view };
}

type Msg = { type: 'reset'; seed: string } | { type: 'push'; envs: Envelope[] };

function reducer(s: TableState, m: Msg): TableState {
  return m.type === 'reset' ? empty(m.seed) : pushAll(s, m.envs);
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
    const seed = newSeed();
    dispatch({ type: 'reset', seed });
    dispatch({ type: 'push', envs: [first, ...startRound(afterStart, seed, 0, 0)] });
  }, []);

  // 局が終わったあと「次の局へ」：次の局を配る（オーラスでやめるか選ぶ番なら、親が選ぶまで何もしない）
  const next = useCallback(() => {
    if (full.phase !== 'ended') return;
    const envs = nextHand(full, s.seed);
    if (envs.length > 0) dispatch({ type: 'push', envs });
  }, [full, s.seed]);

  // 自動で進むところ：ツモ（人間の番はすぐ・CPU の番は少し間を置く）と CPU の打牌・切られた牌への返事
  useEffect(() => {
    // 切られた牌への返事：CPU は自分の見える局面で決める。人間はロンできるときだけ止まって押すのを待つ（制限時間なし）、
    // できないときは自動で見送る。返事は下家から順にまとめて出す（ロンが無ければ待たずに次のツモへ）
    if (full.phase === 'claim' && full.claim) {
      const from = full.claim.from;
      let next = full;
      const envs: Envelope[] = [];
      let cpuRon = false;
      for (const d of [1, 2, 3]) {
        const seat = ((from + d) % 4) as Seat;
        if (next.claim?.replies[seat] !== null) continue;
        let a: Action;
        if (seat === HUMAN) {
          const options = legalActions(next, HUMAN);
          if (options.length !== 1) continue;
          a = options[0];
        } else {
          const cpuView = [...s.log, ...envs].reduce((st, e) => apply(st, mask(e, seat)), initialState());
          a = tsumogiriCpu(cpuView, seat);
          if (a.type === 'ron') cpuRon = true;
        }
        const out = act(next, seat, a);
        for (const e of out) next = apply(next, e);
        envs.push(...out);
      }
      if (envs.length === 0) return undefined;
      const id = setTimeout(() => dispatch({ type: 'push', envs }), cpuRon ? CPU_DELAY : 0);
      return () => clearTimeout(id);
    }
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
    // オーラスでトップの親が CPU なら、やめるか続けるかを CPU が選ぶ
    if (full.phase === 'ended') {
      const n = nextStep(full);
      if (n.type !== 'yame' || n.seat === HUMAN) return undefined;
      const seat = n.seat;
      const cpuView = s.log.reduce((st, e) => apply(st, mask(e, seat)), initialState());
      const id = setTimeout(() => dispatch({ type: 'push', envs: act(full, seat, tsumogiriCpu(cpuView, seat)) }), CPU_DELAY);
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
      const replying = full.phase === 'claim' && full.claim?.replies[HUMAN] === null;
      const yame = full.phase === 'ended' && a.type === 'yame';
      if (!replying && !yame && ((full.phase !== 'discard' && full.phase !== 'declare') || full.turn !== HUMAN)) return;
      dispatch({ type: 'push', envs: act(full, HUMAN, a) });
    },
    [full],
  );

  return { view, legal: legalActions(view, HUMAN), start, next, choose, started: s.log.length > 0 };
}
