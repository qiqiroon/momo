// CPU どうしの強さ比べ（段階7の1）。2 種類の打ち手 A・B を向かい合わせに座らせ（A B A B）、
// 同じ種（同じ親決め・同じ山）でもう一度、席を入れ替えて（B A B A）打つ。山の運を打ち消すため。
// ★成績の差を言う前に対局数を見る。数が少ないと平均の順位はそれらしく見えても偶然で動く。

import { finalResult } from '../engine/final';
import { GENERAL_RULES, type Rules } from '../engine/rules';
import { apply, initialState } from '../engine/state';
import { playOne, type Player } from './run';

export interface SideStats {
  /** 打った席の数（対局数×2） */
  seats: number;
  /** 順位の合計（平均＝rankSum／seats） */
  rankSum: number;
  /** 1 位の回数（同点の 1 位も数える） */
  tops: number;
  /** 4 位の回数 */
  lasts: number;
  /** 終わったときの持ち点（供託を受け取ったあと）の合計 */
  pointsSum: number;
  /** 局の数×席（アガリ率・放銃率の分母） */
  handSeats: number;
  wins: number;
  /** アガリで得た点の合計（平均の打点） */
  winGain: number;
  dealIns: number;
  /** 流局で花豬（捨てる色を残した）になった回数（中国式） */
  pigs: number;
}

export interface ArenaResult {
  games: number;
  hands: number;
  a: SideStats;
  b: SideStats;
  failures: { seed: string; reasons: string[] }[];
}

const empty = (): SideStats => ({ seats: 0, rankSum: 0, tops: 0, lasts: 0, pointsSum: 0, handSeats: 0, wins: 0, winGain: 0, dealIns: 0, pigs: 0 });

/** pairs 組の種について、席の並べ方 2 通りずつ打つ（対局数は pairs×2） */
export function arena(a: Player, b: Player, pairs: number, seedPrefix = 'arena', rules: Rules = GENERAL_RULES): ArenaResult {
  const out: ArenaResult = { games: 0, hands: 0, a: empty(), b: empty(), failures: [] };
  for (let i = 0; i < pairs; i++) {
    const seed = `${seedPrefix}-${i}`;
    for (const swap of [false, true]) {
      const seats: Player[] = swap ? [b, a, b, a] : [a, b, a, b];
      const side = (seat: number) => ((seat % 2 === 0) !== swap ? out.a : out.b);
      const r = playOne(seed, rules, seats, true);
      if (r.failure || r.final.phase !== 'gameover') {
        out.failures.push({ seed: `${seed}${swap ? '/swap' : ''}`, reasons: r.failure?.reasons ?? ['対局の終わりまで行かなかった'] });
        continue;
      }
      out.games++;
      for (const row of finalResult(r.final)) {
        const s = side(row.seat);
        s.seats++;
        s.rankSum += row.rank;
        if (row.rank === 1) s.tops++;
        if (row.rank === 4) s.lasts++;
        s.pointsSum += row.points + row.kyotaku;
      }
      // 局ごとのアガリと放銃は、出来事の列を当てはめ直して局の終わりで数える
      let st = initialState();
      for (const env of r.log) {
        const before = st.phase;
        st = apply(st, env);
        if (before === 'ended' || st.phase !== 'ended' || !st.result) continue;
        out.hands++;
        for (let seat = 0; seat < 4; seat++) side(seat).handSeats++;
        const res = st.result;
        const pay = st.settlement ?? [0, 0, 0, 0];
        // 中国式（血戦到底）：1 局に何人もアガる。打点はアガリそのものの受け取り（カン・查叫は入れない）。放銃は捨て牌ごとに 1 回
        if (res.type === 'cnWin') {
          for (const w of res.wins) {
            side(w.seat).wins++;
            side(w.seat).winGain += w.pays[w.seat];
          }
          res.draw?.states.forEach((st, seat) => {
            if (st === 'pig') side(seat).pigs++;
          });
          for (const key of new Set(res.wins.filter((w) => w.from !== null).map((w) => `${w.from}:${w.winTile}`))) side(Number(key.split(':')[0])).dealIns++;
          continue;
        }
        const winners = res.type === 'tsumo' ? [res.seat] : res.type === 'ron' ? res.wins.map((w) => w.seat) : [];
        for (const w of winners) {
          side(w).wins++;
          side(w).winGain += pay[w];
        }
        if (res.type === 'ron') side(res.from).dealIns++;
      }
    }
  }
  return out;
}

/** 結果を人が読む形の行にする */
export function arenaReport(r: ArenaResult, nameA: string, nameB: string): string[] {
  const line = (name: string, s: SideStats) => {
    const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : '-') + '%';
    return `${name.padEnd(10)} 平均順位 ${(s.rankSum / s.seats).toFixed(3)}  トップ ${pct(s.tops, s.seats)}  ラス ${pct(s.lasts, s.seats)}  平均持ち点 ${Math.round(s.pointsSum / s.seats)}  アガリ ${pct(s.wins, s.handSeats)}  放銃 ${pct(s.dealIns, s.handSeats)}  平均打点 ${s.wins ? Math.round(s.winGain / s.wins) : '-'}${s.pigs ? `  花豬 ${s.pigs}` : ''}`;
  };
  return [
    `対局 ${r.games}（種 ${r.games / 2} 組×席の入れ替え 2 通り）・局 ${r.hands}・失敗 ${r.failures.length}`,
    line(nameA, r.a),
    line(nameB, r.b),
    ...r.failures.slice(0, 5).map((f) => `  失敗 ${f.seed}：${f.reasons.join(' / ')}`),
  ];
}
