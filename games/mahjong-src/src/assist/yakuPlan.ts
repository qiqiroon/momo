// アシストモードの役の候補一覧（日本式・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md §4）。
//
// 1 行＝実際にアガったときに付く役の組み合わせ（利用者指示 10-22：「自風 北＋混一色」が成り立つならその行と両立する待ち牌、
// 北だけになる形もあるなら別の行「自風 北」と、混一色にならず北だけになる待ち牌）。
// 組み合わせごとに「その組み合わせでアガれる形まで、最短であと何枚引けばよいか」を数える（Q2=A）。
//  - アガリの形（目標の手）を、今の手牌から足りない枚数が少ない順に探す（0 枚・1 枚・2 枚…と広げる）。
//    足りない枚数＝目標の手にあって今の手牌に無い牌の数（アガリの 1 枚も数える）
//  - 目標の手の役は engine の judgeAll・scoreWin でそのまま判定する（役の表を 2 か所に持たない）
//  - 足りない牌が場に見えている牌で尽きる目標は作れない＝探さない（もう使えない役は出さない）。
//    ほかの人が持っているかもしれない牌は考えない（見えていない牌は全部まだある、として数える）
//  - 見えている局面（その席から見える形）だけを受け取る。画面は触らない
//
// 1 つの役の結果から、ほかの表示も出す：
//  - 近づく牌＝いちばん近い目標の手に足りない牌（テンパイなら待ち）と、その残りの枚数
//  - つぶれる役＝ある牌を切ると「あと何枚」が増える役（いちばん近い目標の手のどれも、その牌を全部使う）

import { SITUATIONAL } from '../engine/hints';
import type { Seat } from '../engine/events';
import { scoreWin } from '../engine/score';
import { cnScoreIfWin, meldTiles, roundWindOf, seatWindOf, yakuMelds, type GameState } from '../engine/state';
import { kindOf, tileSetFor, type KindId, type TileId } from '../engine/tiles';
import type { WinContext } from '../engine/yaku';
import { visibleCounts } from '../cpu/shanten';

/**
 * 中国式の場面で付く番（どの牌で待っても同じ・形で狙えない）。四川・香港・国標
 * （国標の和绝张は場に見えた枚数、花牌は引いた花の数で付く＝形で狙うものではない）
 */
const CN_SITUATIONAL: ReadonlySet<string> = new Set([
  'haidi', 'gangkai', 'gangpao', 'qianggang',
  'zimo', 'qianggangHk', 'gangkaiHk', 'haidiHk', 'tianhu', 'dihu',
  'miaoshou', 'haidilaoyue', 'gangkaiG', 'qiangganghe', 'hejuezhang', 'zimoG', 'buqiuren', 'huapai',
]);

export interface YakuPlan {
  /**
   * 役の組み合わせ（その形でアガったときに付く役・番。場面で付く役は除く。並びは役の判定の順）。
   * 日本式は YakuId、中国式は番の id（cnFan_◯◯ の言葉）。中国式で番が 1 つも付かないアガリ（四川の平胡）は空
   */
  ids: string[];
  /** 組み合わせの見分け（役の名前を並べ替えてつないだもの） */
  key: string;
  /** あと何枚引けばその組み合わせでアガれるか（0＝もうアガリの形） */
  need: number;
  /** その組み合わせでアガったときの点（ロン・ドラ・赤を含む。ドラの入り方で違えば高いほう） */
  points: number;
  /** 中国式：番の合計（点の数え方が四川・香港・国標で違うので、画面は番で出す）。日本式は 0 */
  fan: number;
  /** 次に引くと 1 枚近づく牌（残りの多い順）。left＝場に見えていない枚数 */
  tiles: { kind: KindId; left: number }[];
  /** テンパイ（need＝1）で、待ちが全部自分の捨て牌にある（ロンできない・ツモならアガれる） */
  furiten: boolean;
  /** 余っている牌（いちばん近い目標の手のどれかで使わない牌）。手牌が 14 枚のとき、これ以外を切るとこの組み合わせは遠くなる */
  spare: ReadonlySet<KindId>;
  /** 考える時間が切れて、この枚数の目標の手を全部は見ていない（近づく牌・余っている牌が足りないことがある＝つぶれる役に出さない） */
  partial: boolean;
  /**
   * 中国式：1 番の番だけを入れ替えた組み合わせをまとめた行（利用者指示 10-22）。mine＝この行に出した 1 番の番、
   * alts＝入れ替えられるほかの 1 番の番（の組）。まとめた行の待ち（近づく牌）は代表に出した組み合わせのものだけ（利用者補足 10-22）
   */
  swap?: { mine: string[]; alts: string[][] };
}

export interface PlanOptions {
  /** 何個まで（設計 §4.1 の 10 個） */
  limit?: number;
  /** 何枚まで探すか（既定 6） */
  maxNeed?: number;
  /** 考える長さの上限（ミリ秒）。過ぎたら、そこまでに見つけた分を返す */
  budgetMs?: number;
  /** 手牌を差し替える（切ったあとの手を測る＝つぶれる役） */
  hand?: readonly TileId[];
}

/** 面子の型：刻子 34 種・順子 21 種（萬筒索 × 1〜7） */
const SETS: readonly (readonly KindId[])[] = [
  ...Array.from({ length: 34 }, (_, k) => [k, k, k]),
  ...[0, 9, 18].flatMap((base) => Array.from({ length: 7 }, (_, i) => [base + i, base + i + 1, base + i + 2])),
];
/** 国士無双の 13 種 */
const ORPHANS: readonly KindId[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 役の候補一覧（日本式・中国式。手牌が見えなければ空） */
export function yakuPlan(s: GameState, seat: Seat, o: PlanOptions = {}): YakuPlan[] {
  const rules = s.rules;
  if (!rules) return [];
  const cn = rules.family === 'cn';
  const handIds = o.hand ?? s.hands[seat];
  if (handIds.some((t) => t < 0)) return [];
  const limit = o.limit ?? 10;
  // あと 7 枚より遠い形は目安にならない（配牌のままでも数えきれる長さに抑える。四川は番の種類が少なく 10 行に届かず、
  // 8 枚まで探すと毎回 1.5 秒の上限を使い切った＝2026-10-22 実測）
  const maxNeed = o.maxNeed ?? 6;
  const deadline = now() + (o.budgetMs ?? 30);

  const H = new Array<number>(34).fill(0);
  for (const t of handIds) H[kindOf(t)]++;
  // 見えている牌（自分の手牌を含む）。差し替えた手（切ったあと）でも同じ＝切った牌は自分の河に出て、やはり見えている
  const visible = visibleCounts(s, seat);
  // 使う牌の顔ぶれ（四川は字牌なし）。顔ぶれに無い牌は無いものとして数える
  const inSet = new Array<number>(34).fill(0);
  for (const t of tileSetFor(rules)) if (kindOf(t) < 34) inSet[kindOf(t)]++;
  const unseen = visible.map((v, k) => Math.max(0, inSet[k] - v));
  const melds = yakuMelds(s, seat);
  const sets = 4 - melds.length;
  const myDiscards = new Set(s.discards[seat].map(kindOf));
  const base: Omit<WinContext, 'concealed' | 'winTile' | 'tsumo'> = {
    melds,
    seatWind: seatWindOf(s, seat),
    roundWind: roundWindOf(s),
    honba: s.honba,
    riichi: 'none',
    rules,
  };
  const mTiles = meldTiles(s, seat);
  const dealer = seat === s.dealer;

  // 手牌の背番号（赤 5 を数えるため。足りない牌は赤でない背番号で足す）
  const idsByKind = new Map<KindId, TileId[]>();
  for (const t of handIds) {
    const k = kindOf(t);
    if (!idsByKind.has(k)) idsByKind.set(k, []);
    idsByKind.get(k)!.push(t);
  }
  const tilesOf = (T: readonly number[]): TileId[] => {
    const out: TileId[] = [];
    for (let k = 0; k < 34; k++) {
      if (!T[k]) continue;
      const have = idsByKind.get(k) ?? [];
      for (let i = 0; i < T[k]; i++) out.push(i < have.length ? have[i] : k * 4 + 3 - (i - have.length));
    }
    return out;
  };

  /** 目標の手をアガリ牌 w でアガったときの役（場面の役を除く）と点。アガれなければ null */
  const scoreOf = (T: number[], tiles: TileId[], w: { kind: KindId; tsumo: boolean }): { ids: string[]; points: number; fan: number; ones: string[] } | null => {
    if (cn) {
      // 中国式：アガリ牌を 1 枚抜いた手に、その牌が来たら（最低の番・缺一門も見る）
      const i = tiles.findIndex((t) => kindOf(t) === w.kind);
      const win = tiles[i];
      const sc = cnScoreIfWin(s, seat, [...tiles.slice(0, i), ...tiles.slice(i + 1)], win, w.tsumo ? 'tsumo' : 'ron');
      if (!sc) return null;
      const fans = sc.fans.filter((f) => !CN_SITUATIONAL.has(f.id));
      return { ids: fans.map((f) => f.id as string), points: sc.points, fan: sc.fan, ones: fans.filter((f) => f.fan === 1).map((f) => f.id as string) };
    }
    const ctx: WinContext = { ...base, concealed: T, winTile: w.kind, tsumo: w.tsumo };
    // 付く役は点数の一番高い読み方のもの（実際にアガったときと同じ）
    const sc = scoreWin({ ctx, tiles: [...tiles, ...mTiles], indicators: s.doraIndicators, ura: [], dealer });
    if (!sc) return null;
    const ids: string[] = sc.yaku.map((y) => y.id).filter((id) => !SITUATIONAL.has(id));
    // 日本式は役が無ければアガれない（場面の役だけ＝リーチが要る形は出さない）
    return ids.length > 0 ? { ids, points: sc.total, fan: 0, ones: [] } : null;
  };

  const found = new Map<string, { ids: string[]; ones: string[]; need: number; points: number; fan: number; tiles: Set<KindId>; spare: Set<KindId> }>();
  let truncated = false;
  /** 考える時間が切れた段（その段の組み合わせは全部の目標の手を見ていない） */
  let cutAt = -1;

  /** 目標の手（足りない枚数 need）の役の組み合わせを数えて覚える */
  const leaf = (T: number[], need: number) => {
    const missing: KindId[] = [];
    const spare: KindId[] = [];
    for (let k = 0; k < 34; k++) {
      if (T[k] > H[k]) missing.push(k);
      else if (H[k] > T[k]) spare.push(k);
    }
    // アガリ牌：もう形ができていればツモ（手牌の最後の牌）、そうでなければ足りない牌のどれか（ロン）。
    // テンパイ・あと 2 枚までは足りない牌を 1 つずつアガリ牌にして試す（待ち牌ごとに付く役が違う＝平和・三暗刻など）。
    // あと 3 枚以上の目標は、アガリ牌を 1 つに決めて 1 回だけ判定する（目標の手の数が多く、1 つずつ試すと時間の 8 割がここに使われた＝2026-10-22 実測）
    const wins: { kind: KindId; tsumo: boolean }[] =
      need === 0 ? [{ kind: kindOf(handIds[handIds.length - 1]), tsumo: true }] : need >= 3 ? [{ kind: missing[missing.length - 1], tsumo: false }] : missing.map((kind) => ({ kind, tsumo: false }));
    const ids = tilesOf(T);
    for (const w of wins) {
      const sc = scoreOf(T, ids, w);
      if (!sc) continue;
      const yaku = sc.ids;
      const key = [...yaku].sort().join('+');
      let f = found.get(key);
      if (!f) {
        f = { ids: yaku, ones: sc.ones, need, points: 0, fan: 0, tiles: new Set(), spare: new Set() };
        found.set(key, f);
      }
      if (f.need !== need) continue;
      f.points = Math.max(f.points, sc.points);
      f.fan = Math.max(f.fan, sc.fan);
      // 近づく牌＝この目標の手に足りない牌（テンパイなら足りないのはアガリ牌 1 枚＝この組み合わせになる待ち牌だけが入る）
      missing.forEach((k) => f!.tiles.add(k));
      spare.forEach((k) => f!.spare.add(k));
    }
  };

  // 足りない枚数 B ちょうどの目標の手を探す（B より少ないものは前の段で見た）
  const T = new Array<number>(34).fill(0);
  const seen = new Set<string>();
  /** 牌 k を n 枚足す。足りない枚数の増え方を返す（作れなければ -1） */
  const add = (k: KindId, n: number): number => {
    if (T[k] + n > 4) return -1;
    const before = Math.max(0, T[k] - H[k]);
    const after = Math.max(0, T[k] + n - H[k]);
    if (after > unseen[k]) return -1;
    T[k] += n;
    return after - before;
  };
  const leafOnce = (need: number) => {
    const key = T.join('');
    if (seen.has(key)) return;
    seen.add(key);
    leaf(T.slice(), need);
  };

  const standard = (slot: number, from: number, cost: number, B: number) => {
    if (now() > deadline) {
      truncated = true;
      return;
    }
    if (slot === sets) {
      for (let k = 0; k < 34; k++) {
        const d = add(k, 2);
        if (d >= 0) {
          if (cost + d === B) leafOnce(B);
          T[k] -= 2;
        }
      }
      return;
    }
    for (let i = from; i < SETS.length; i++) {
      const [a, b, c] = SETS[i];
      const da = add(a, 1);
      if (da < 0) continue;
      const db = add(b, 1);
      if (db < 0) {
        T[a]--;
        continue;
      }
      const dc = add(c, 1);
      if (dc >= 0) {
        const nc = cost + da + db + dc;
        if (nc <= B) standard(slot + 1, i, nc, B);
        T[c]--;
      }
      T[b]--;
      T[a]--;
      if (truncated) return;
    }
  };

  const sevenPairs = (n: number, from: number, cost: number, B: number) => {
    if (n === 7) {
      if (cost === B) leafOnce(B);
      return;
    }
    for (let k = from; k < 34; k++) {
      const d = add(k, 2);
      if (d < 0) continue;
      if (cost + d <= B) sevenPairs(n + 1, k + 1, cost + d, B);
      T[k] -= 2;
    }
  };

  const orphans = (B: number) => {
    for (const dup of ORPHANS) {
      let cost = 0;
      let ok = true;
      const added: KindId[] = [];
      for (const k of ORPHANS) {
        const d = add(k, k === dup ? 2 : 1);
        if (d < 0) {
          ok = false;
          break;
        }
        added.push(k);
        cost += d;
      }
      if (ok && cost === B) leafOnce(B);
      for (const k of added) T[k] -= k === dup ? 2 : 1;
    }
  };

  for (let B = 0; B <= maxNeed && !truncated; B++) {
    standard(0, 0, 0, B);
    if (melds.length === 0 && !truncated) {
      sevenPairs(0, 0, 0, B);
      orphans(B);
    }
    if (truncated) cutAt = B;
    if (rowsOf().length >= limit) break;
  }

  return rowsOf().slice(0, limit);

  /** 見つけた組み合わせを行にする（中国式は 1 番の番だけ違う行をまとめる）。あと何枚の少ない順・同じなら点の高い順 */
  function rowsOf(): YakuPlan[] {
    const rows: (YakuPlan & { ones: string[] })[] = [...found].map(([key, f]) => {
      const tiles = [...f.tiles].map((kind) => ({ kind, left: unseen[kind] })).filter((x) => x.left > 0).sort((a, b) => b.left - a.left || a.kind - b.kind);
      return { ids: f.ids, ones: f.ones, key, need: f.need, points: f.points, fan: f.fan, tiles, furiten: f.need === 1 && f.tiles.size > 0 && [...f.tiles].every((k) => myDiscards.has(k)), spare: f.spare, partial: f.need === cutAt };
    });
    const sorted = (xs: YakuPlan[]) => xs.sort((a, b) => a.need - b.need || b.points - a.points);
    if (!cn) return sorted(rows.map(({ ones: _ones, ...r }) => r));
    // 中国式：あと何枚・番の数・2 番以上の番が同じで、1 番の番だけが違う行は 1 つにまとめる（利用者指示 10-22）。
    // まとめる相手が無い行は 1 番の番も入れた組み合わせのまま（待ちも出す）
    const groups = new Map<string, (YakuPlan & { ones: string[] })[]>();
    for (const r of rows) {
      const big = r.ids.filter((id) => !r.ones.includes(id)).sort().join('+');
      const g = `${r.need}|${r.fan}|${big}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    const out: YakuPlan[] = [];
    for (const [g, members] of groups) {
      if (members.length === 1) {
        const { ones: _ones, ...r } = members[0];
        out.push(r);
        continue;
      }
      // 代表＝点の一番高い行（1 番の番を持つもの）
      const rep = [...members].sort((a, b) => b.points - a.points || b.ones.length - a.ones.length)[0];
      const spare = new Set<KindId>();
      members.forEach((m) => m.spare.forEach((k) => spare.add(k)));
      out.push({
        ids: rep.ids,
        key: `swap:${g}`,
        need: rep.need,
        points: Math.max(...members.map((m) => m.points)),
        fan: rep.fan,
        // 待ちは代表に出した組み合わせのものだけ（入れ替えたほかの組み合わせの待ちは出さない＝利用者補足 10-22）
        tiles: rep.tiles,
        furiten: rep.furiten,
        // まとめた行は、どの入れ替えでもその牌を使うときだけつぶれる
        spare,
        partial: members.some((m) => m.partial),
        // 書き添えは入れ替わる番だけ（どの行にもある 1 番の番は行の名前に残る）
        swap: (() => {
          const common = rep.ones.filter((id) => members.every((m) => m.ones.includes(id)));
          const diff = (ones: string[]) => ones.filter((id) => !common.includes(id));
          return { mine: diff(rep.ones), alts: members.filter((m) => m !== rep).map((m) => diff(m.ones)) };
        })(),
      });
    }
    return sorted(out);
  }
}
