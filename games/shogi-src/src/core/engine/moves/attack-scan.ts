/**
 * 「このマスは脅かされているか」を**マスの側から**調べる (2026-08-14・読む速さの改善)。
 *
 * ★なぜ作り替えたか
 * 以前は「相手の全部の駒について全部の動きを作り、その中に目標マスがあるか」を見ていた。
 * 王手放置の判定は**指せる手 1 つごとに 1 回**走るので、初期局面なら 30 手 × 相手 20 駒ぶんの
 * 動きの生成になる。実測ではこれが 1 節点 0.344ms のうち **0.340ms** を占めていて、
 * AI が 2 秒かけても深さ 4 までしか読めない原因そのものだった。
 *
 * ここでは逆に、**目標マスから外へ向かって「そこへ届きうる駒がいる場所」だけを拾う**。
 * 拾った数マスについてだけ、これまでどおり動きを作って本当に届くか確かめる。
 * 確かめる部分は前と同じ関数を使うので、**判定の中身は変わらない** (速さだけが変わる)。
 *
 * ★正しさの理屈
 * 拾う場所は「本当に届く駒がいる場所」を**必ず含む**ようにしてある (取りこぼさない)。
 *   - 1 マスだけ動く駒 (歩・桂など) … 目標から動き分を引いた 1 マス
 *   - 走る駒 (飛・角・香など) … 目標から逆向きに進み、**最初にぶつかった駒**の場所
 *     (それより先の駒は間に挟まれて届かない＝生成側 generator と同じ止め方)
 * どの駒がどう動けるかはルール定義から集めるので、**独自ルールの駒でも取りこぼさない**。
 * 量子モードでも、駒の正体が決まっていない駒は「どの駒かもしれない」＝全種類ぶんの
 * 動きを集めた一覧を使うので、こちらも取りこぼさない。
 *
 * ★盤の端がつながっている場合 (トーラス)
 * 逆向きに進むところも生成側と同じ回り込みを使う。**平面でしか成り立たない省略はしない**
 * (回り込む盤では「間に挟まれているか」の見え方が変わるため)。
 */

import type { Mgf, Player } from '../mgf/types';
import type { BoardTopology, Position, Square } from '../position/types';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { directionOffsets, type Offset } from './directions';

interface OffsetProfile {
  /** 1 マスだけ動く動き (step / jump)。 */
  steps: Offset[];
  /** 何マスでも走る動き (slide)。間に駒があれば止まる。 */
  rays: Offset[];
}

const cache = new WeakMap<Mgf, Partial<Record<Player, OffsetProfile>>>();

/**
 * そのルールに出てくる**すべての駒の動き方**を 1 つにまとめる。
 *
 * 駒ごとに分けないのは、ここでは「届きうる場所」を広めに拾えばよいため
 * (本当に届くかは呼び出し側で確かめる)。ルール定義は対局中に変わらないので 1 回で済む。
 */
function profileOf(mgf: Mgf, player: Player): OffsetProfile {
  let byPlayer = cache.get(mgf);
  if (!byPlayer) {
    byPlayer = {};
    cache.set(mgf, byPlayer);
  }
  const hit = byPlayer[player];
  if (hit) return hit;

  const steps = new Map<string, Offset>();
  const rays = new Map<string, Offset>();
  for (const def of mgf.pieces) {
    for (const ability of def.move_logic?.abilities ?? []) {
      const bucket = ability.type === 'slide' ? rays : steps;
      for (const offset of directionOffsets(ability.direction, player)) {
        bucket.set(`${offset.drow},${offset.dcol}`, offset);
      }
    }
  }
  const profile: OffsetProfile = { steps: [...steps.values()], rays: [...rays.values()] };
  byPlayer[player] = profile;
  return profile;
}

/** 回り込む方向は一周ぶん、そうでなければ盤の一辺ぶんで打ち切る (生成側と同じ)。 */
function rayCap(offset: Offset, topology: BoardTopology, width: number, height: number): number {
  const wraps = (offset.dcol !== 0 && topology.wrapX) || (offset.drow !== 0 && topology.wrapY);
  return wraps ? width * height : Math.max(width, height);
}

/**
 * 目標マスへ届きうる駒がいる場所を拾う (attacker の駒だけ)。
 *
 * **本当に届くかはここでは決めない**。取りこぼさないことだけを保証する。
 */
export function collectAttackCandidates(
  mgf: Mgf,
  position: Position,
  target: Square,
  attacker: Player,
): Square[] {
  const { width, height } = position;
  const topology = topologyOf(position);
  const profile = profileOf(mgf, attacker);
  const out: Square[] = [];
  const seen = new Set<string>();

  const add = (sq: Square) => {
    const key = `${sq.row},${sq.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(sq);
  };

  // 1 マスだけ動く駒: 目標から動き分を引いた場所にいれば届きうる。
  for (const { drow, dcol } of profile.steps) {
    const sq = wrapSquare({ row: target.row - drow, col: target.col - dcol }, width, height, topology);
    if (!sq) continue;
    const cell = position.board[sq.row][sq.col];
    if (cell && cell.owner === attacker) add(sq);
  }

  // 走る駒: 目標から逆向きにたどり、最初にぶつかった駒だけが届きうる。
  for (const offset of profile.rays) {
    const cap = rayCap(offset, topology, width, height);
    let cur = wrapSquare({ row: target.row - offset.drow, col: target.col - offset.dcol }, width, height, topology);
    let step = 1;
    while (step <= cap && cur !== null) {
      if (cur.row === target.row && cur.col === target.col) break; // 一周して戻った
      const cell = position.board[cur.row][cur.col];
      if (cell) {
        if (cell.owner === attacker) add(cur);
        break; // その先は間に挟まれる
      }
      cur = wrapSquare({ row: cur.row - offset.drow, col: cur.col - offset.dcol }, width, height, topology);
      step++;
    }
  }

  return out;
}
