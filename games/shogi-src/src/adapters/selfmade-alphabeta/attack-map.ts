/**
 * 利きの地図 (★v1.98・王の安全の評価のため)。
 *
 * 「どのマスに、どちらの駒が何枚利いているか」を、**盤を 1 回見回すだけ**で数える。
 *
 * ★なぜ王手の判定 (core/engine/moves/check.ts) を使わないか
 * あちらは 1 マスごとに「届きうる駒」を拾って、その駒の手を作って確かめる。答えは確かだが、
 * 玉の周り 9 マス × 両陣営を数えるだけで評価 1 回が 0.66µs → 約 75µs になる (2026-10-02 実測・
 * 本将棋の実戦 20 局面)。読みの末端で毎回呼ぶので、そのままでは読む速さが大きく落ちる。
 *
 * ★「利き」の意味
 * **そのマスに相手の駒が居たら取れるか**。自分の駒が乗っているマスにも数える (守っている)。
 * 取れない動き (チェスのポーンのまっすぐ前進＝`can_capture: false`) は数えない。
 * 王手の判定の `isSquareCapturableBy` と同じ意味で、**答えが一致することを検査で突き合わせる**
 * (attack-map.test.ts)。走る駒は最初にぶつかった駒で止まる (生成側と同じ止め方)。
 * 盤の端がつながっている盤では生成側と同じ回り込みを使い、一周したら止める。
 *
 * ★量子の駒 (正体が決まっていない) は扱わない＝呼ぶ側 (evaluate.ts) が量子では使わない。
 * ★完全トーラスの「玉は敵の玉に王手をかけない」は扱わない＝ここで数えるのは玉の**周り**の
 * マスなので、玉どうしの間の取り合いは関わらない (検査では玉の乗ったマスを突き合わせから外す)。
 */

import type { Mgf, MgfAbility, Player } from '../../core/engine/mgf/types';
import type { Position } from '../../core/engine/position/types';
import { directionOffsets } from '../../core/engine/moves/directions';
import { topologyOf, wrapSquare } from '../../core/engine/position/coordinates';

interface Reach {
  drow: number;
  dcol: number;
  /** 1 マスだけ (step / jump) か、走るか。 */
  slide: boolean;
  /** 走るときの上限 (-1＝どこまでも)。 */
  range: number;
}

/** 駒種 × 陣営ごとの「利きの届き方」。ルール定義は対局中に変わらないので 1 度だけ作る。 */
const cache = new WeakMap<Mgf, Map<string, Reach[]>>();

function reachOf(mgf: Mgf, kind: string, owner: Player): Reach[] {
  let byKind = cache.get(mgf);
  if (!byKind) {
    byKind = new Map();
    cache.set(mgf, byKind);
  }
  const key = `${kind}|${owner}`;
  const hit = byKind.get(key);
  if (hit) return hit;
  // 同じ向きを 2 つの動きが重ねて持つことがある (1 マスと走り) ので、向きごとに 1 つへまとめる
  // ＝同じ駒が同じマスを 2 枚ぶんに数えない。届く範囲は長いほうを採る (短いほうを含む)。
  const byDir = new Map<string, Reach>();
  const def = mgf.pieces.find((p) => p.id === kind);
  for (const ability of (def?.move_logic?.abilities ?? []) as MgfAbility[]) {
    if (ability.can_capture === false) continue;
    const slide = ability.type === 'slide';
    const reach = slide ? (ability.range === -1 ? Infinity : ability.range) : 1;
    for (const { drow, dcol } of directionOffsets(ability.direction, owner)) {
      const k = `${drow},${dcol}`;
      const prev = byDir.get(k);
      const prevReach = prev ? (prev.slide ? (prev.range === -1 ? Infinity : prev.range) : 1) : 0;
      if (reach > prevReach) byDir.set(k, { drow, dcol, slide, range: slide ? ability.range : 1 });
    }
  }
  const out = [...byDir.values()];
  byKind.set(key, out);
  return out;
}

export interface AttackMap {
  width: number;
  /** マス (row * width + col) ごとに、先手の駒が何枚利いているか。 */
  player1: Uint8Array;
  /** 同じく後手。 */
  player2: Uint8Array;
}

/**
 * 盤全体の利きを数える。**正体の決まっていない駒 (量子) は数えない**＝呼ぶ側で量子を外すこと。
 */
export function buildAttackMap(mgf: Mgf, position: Position): AttackMap {
  const { width, height } = position;
  const topology = topologyOf(position);
  const map: AttackMap = {
    width,
    player1: new Uint8Array(width * height),
    player2: new Uint8Array(width * height),
  };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const piece = position.board[row][col];
      if (!piece || piece.candidates !== undefined) continue;
      const counts = map[piece.owner];
      for (const r of reachOf(mgf, piece.kind, piece.owner)) {
        // 回り込む方向なら一周ぶん、そうでなければ盤の一辺ぶん (生成側と同じ上限)。
        const wraps = (r.dcol !== 0 && topology.wrapX) || (r.drow !== 0 && topology.wrapY);
        const unlimited = wraps ? width * height : Math.max(width, height);
        const maxRange = r.range === -1 ? unlimited : r.range;
        let cur = wrapSquare({ row: row + r.drow, col: col + r.dcol }, width, height, topology);
        let step = 1;
        while (step <= maxRange && cur !== null) {
          if (cur.row === row && cur.col === col) break; // 一周して戻った
          const idx = cur.row * width + cur.col;
          counts[idx] = Math.min(255, counts[idx] + 1);
          if (!r.slide || position.board[cur.row][cur.col] !== null) break;
          cur = wrapSquare({ row: cur.row + r.drow, col: cur.col + r.dcol }, width, height, topology);
          step++;
        }
      }
    }
  }
  return map;
}
