// CPU の強さ Hard・Apocalypse の考え方（段階7の3・4）。Easy に「考えに入れる項目」を足していく。
// 狙いのぶれは入れない＝同じ局面では必ず同じ手。
//
// Hard が Easy に足すもの：
//   - 待ちの広さ（受け入れ枚数。自分の手牌だけ引いて数える）
//   - 点数（ドラ・赤・役牌の対子を手放さない／喰いタンで役を作って鳴く）
//   - 守り（リーチされたら、アガリから遠い手は降りる＝通る牌から切る）
//   - 待ちの残りが 0 枚ならリーチしない／暗槓・加槓をする
//   - 缺一門（四川）：捨てる色の牌は手に無いものとして測る（Easy と同じ・common.ts の handCounts）
//   - 香港（3 番起糊）：手が 1 色＋字牌に寄っていれば混一色を狙う（ほかの色を手に無いものとして測り、その色と字牌で鳴く＝common.ts の flushPlan）
//   - 中国式で最低の番が要らない（四川）：役を気にせず近づく鳴き・手が崩れない大明槓（freeCalls）。守りはテンパイしていそうな人（defense.ts）
// Apocalypse がさらに足すもの（opts で切り替える）：
//   - 受け入れを「場に見えている枚数」で数え直す（visibleWaits）
//   - 危なさの見分けを細かく（壁・リーチ後に通った牌）（fineDanger）
//   - 点数の状況で押し引きを変える（オーラスのラス目は押す・トップ目は降りやすい）（placement）
//   - 香港の混一色を早めに狙う（目安 8 枚＝Hard は 9）
//   - 迷う場面だけ先読み：同じ近さの候補を「2 歩先の受け入れ」で比べる（simulate.ts）

import { doraOf } from '../engine/dora';
import { cnRoundsTotal } from '../engine/game';
import type { Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { isRed, kindOf, type KindId, type TileId } from '../engine/tiles';
import { chooseQue, connection, FLUSH_MIN, flushPlan, valuedWaits, setFlushMin, freeCalls, handCounts, hasOpenYakuhai, inPlan, isQueTile, pick, shantenAfterCall, yakuhaiKinds } from './common';
import { dangerOf, threats } from './defense';
import { acceptance, shanten, visibleCounts } from './shanten';
import { twoStepAcceptance } from './simulate';

export interface ThinkOptions {
  /** 香港の混一色を狙うと決める目安（common.ts の FLUSH_MIN） */
  flushMin: number;
  visibleWaits: boolean;
  fineDanger: boolean;
  placement: boolean;
  /** 迷う場面（同じ近さの候補が並ぶ）で 2 歩先の受け入れまで読んで決める */
  simulate: boolean;
}

export const HARD: ThinkOptions = { flushMin: FLUSH_MIN.hard, visibleWaits: false, fineDanger: false, placement: false, simulate: false };
export const APOCALYPSE: ThinkOptions = { flushMin: FLUSH_MIN.apocalypse, visibleWaits: true, fineDanger: true, placement: true, simulate: true };

const isTerminalOrHonor = (k: KindId) => k >= 27 || k % 9 === 0 || k % 9 === 8;

/** 切る候補 1 つの見立て */
export interface DiscardPlan {
  action: Action & { type: 'discard' | 'riichi' };
  tile: TileId;
  shanten: number;
  /** 受け入れ枚数（テンパイなら待ちの残り枚数） */
  waits: number;
  /** 手放す値打ち（ドラ・赤・役牌の対子） */
  valueLoss: number;
  danger: number;
  connection: number;
}

/** 手放すと点数が下がる度合い（ドラ 1 枚・赤 1 枚・役牌の対子を崩す） */
function valueLossOf(view: GameState, seat: Seat, tile: TileId, counts: readonly number[]): number {
  const k = kindOf(tile);
  let loss = 0;
  for (const ind of view.doraIndicators) if (doraOf(kindOf(ind)) === k) loss++;
  if (view.rules && isRed(tile, view.rules)) loss++;
  if (counts[k] === 2 && yakuhaiKinds(view, seat).has(k)) loss++;
  return loss;
}

/** 切る候補を全部見立てる（同じ種類は 1 回だけ計算する） */
export function discardPlans(view: GameState, seat: Seat, legal: readonly Action[], opts: ThinkOptions): DiscardPlan[] {
  const counts = handCounts(view, seat);
  const open = view.melds[seat].length;
  const visible = visibleCounts(view, seat);
  const byKind = new Map<KindId, { shanten: number; waits: number }>();
  const plans: DiscardPlan[] = [];
  for (const a of legal) {
    if (a.type !== 'discard') continue;
    const k = kindOf(a.tile);
    let m = byKind.get(k);
    if (!m) {
      // 缺一門の捨てる色の牌は数えていない＝切っても手は変わらない
      const que = isQueTile(view, seat, a.tile);
      if (!que) counts[k]--;
      const acc = acceptance(counts, open, opts.visibleWaits ? visible : counts);
      if (!que) counts[k]++;
      m = { shanten: acc.shanten, waits: acc.tiles };
      // 最低の番が要るルール：テンパイでも届く待ちが無ければ 1 歩手前と見る・待ちはアガれる牌だけ数える
      if (acc.shanten === 0) {
        const rest = view.hands[seat].slice();
        rest.splice(rest.indexOf(a.tile), 1);
        const valued = valuedWaits(view, seat, rest);
        if (valued !== null) m = valued > 0 ? { shanten: 0, waits: valued } : { shanten: 1, waits: acc.tiles };
      }
      byKind.set(k, m);
    }
    plans.push({
      action: a,
      tile: a.tile,
      shanten: m.shanten,
      waits: m.waits,
      valueLoss: valueLossOf(view, seat, a.tile, counts),
      danger: dangerOf(view, seat, k, visible, opts.fineDanger),
      connection: connection(a.tile, counts),
    });
  }
  return plans;
}

/** 攻めの順：近さ → 受け入れ（値打ち 1 つを 4 枚ぶんと見る）→ 孤立 */
function attackOrder(a: DiscardPlan, b: DiscardPlan): number {
  return a.shanten - b.shanten || (b.waits - 4 * b.valueLoss) - (a.waits - 4 * a.valueLoss) || a.connection - b.connection || a.tile - b.tile;
}

/** 守りの順：危なさ → 攻めの順 */
function defenseOrder(a: DiscardPlan, b: DiscardPlan): number {
  return a.danger - b.danger || attackOrder(a, b);
}

/** 点数の状況：自分の順位（1〜4）とオーラスか */
function standing(view: GameState, seat: Seat): { rank: number; allLast: boolean } {
  const me = view.scores[seat];
  const rank = 1 + view.scores.filter((p, s) => p > me || (p === me && s < seat)).length;
  // 予定の局の数：日本式＝東風 4・半荘 8／中国式＝圏×4（四川は 16）
  const length = view.rules?.family === 'cn' ? cnRoundsTotal(view) : view.rules?.values.length === 'east' ? 4 : 8;
  return { rank, allLast: view.roundIndex >= length - 1 };
}

/** 押すか降りるか。true＝押す（攻めの順で切る） */
function shouldPush(view: GameState, seat: Seat, best: DiscardPlan, opts: ThinkOptions): boolean {
  let limit = best.shanten <= 0 ? 99 : best.shanten === 1 ? 5 : -1;
  if (opts.placement) {
    const { rank, allLast } = standing(view, seat);
    if (allLast && rank === 4) limit = best.shanten <= 1 ? 99 : 6; // ラス目のオーラスは押す
    else if (rank === 1 && best.shanten >= 1) limit = Math.min(limit, 3); // トップ目は降りやすい
  }
  return best.danger <= limit;
}

export function makeThinker(opts: ThinkOptions) {
  return function thinkerCpu(view: GameState, seat: Seat): Action {
    setFlushMin(opts.flushMin);
    const legal = legalActions(view, seat);
    if (legal.length === 0) throw new Error(`席 ${seat} はいま選べることが無い`);
    if (view.phase === 'que') return chooseQue(view, seat, legal);
    const win = pick(legal, 'tsumo') ?? pick(legal, 'ron') ?? pick(legal, 'tenpai');
    if (win) return win;
    const stop = legal.find((a) => a.type === 'yame' && a.stop);
    if (stop) return stop;
    if (view.phase === 'claim') return claimReply(view, seat, legal);
    const kyushu = pick(legal, 'kyushu');
    if (kyushu) {
      // 么九牌が 11 種類以上なら国士無双を狙う（流さない）
      const kinds = new Set(view.hands[seat].map(kindOf).filter(isTerminalOrHonor)).size;
      if (kinds < 11 || !legal.some((a) => a.type === 'discard')) return kyushu;
    }
    const noten = pick(legal, 'noten');
    if (noten) return noten;
    return chooseDiscard(view, seat, legal, opts);
  };

  function claimReply(view: GameState, seat: Seat, legal: readonly Action[]): Action {
    const pass = pick(legal, 'pass')!;
    const c = view.claim!;
    const counts = handCounts(view, seat);
    const now = shanten(counts, view.melds[seat].length);
    // リーチされていて、テンパイから遠いなら鳴かない（降りる手で鳴くと切れる牌が減る）
    if (threats(view, seat).length > 0 && now >= 2) return pass;
    // 七対子に向かっている手（対子 5 つ以上）は鳴かない
    if (view.melds[seat].length === 0 && counts.filter((n) => n >= 2).length >= 5) return pass;
    // 中国式で最低の番が要らない（四川）なら、役を気にせず近づく鳴きをする。大明槓は手が崩れなければする（刮風下雨で点が入る）
    if (freeCalls(view)) {
      if (threats(view, seat).length === 0) {
        const kan = legal.find((a) => a.type === 'kan' && a.kan === 'minkan');
        if (kan && kan.type === 'kan' && minkanKeepsShanten(view, seat, kan.tiles, now)) return kan;
      }
      let best: Action | null = null;
      let bestSh = now;
      for (const a of legal) {
        if (a.type !== 'pon' && a.type !== 'chi') continue;
        const after = shantenAfterCall(view, seat, a.tiles);
        if (after < bestSh) [best, bestSh] = [a, after];
      }
      return best ?? pass;
    }
    const yakuhai = yakuhaiKinds(view, seat);
    const opened = hasOpenYakuhai(view, seat);
    const kuitan = view.rules?.family === 'jp' && view.rules.values.kuitan === 'on';
    const plan = flushPlan(view, seat);
    let best: Action | null = null;
    let bestSh = 99;
    for (const a of legal) {
      if (a.type !== 'pon' && a.type !== 'chi') continue;
      const after = shantenAfterCall(view, seat, a.tiles);
      const yakuPon = a.type === 'pon' && yakuhai.has(kindOf(c.tile));
      let ok = false;
      if (yakuPon) ok = after <= now;
      else if (opened) ok = after < now;
      // 香港で混一色を狙っている：狙う色か字牌の鳴きで近づくなら鳴く（3 番が付く）
      else if (plan !== null && inPlan(c.tile, plan)) ok = after < now;
      else if (kuitan && after < now && after <= 2 && tanyaoAfter(view, seat, a.tiles, c.tile)) ok = true;
      if (ok && after < bestSh) [best, bestSh] = [a, after];
    }
    return best ?? pass;
  }
}

/** 鳴いたあと断么九を目指せるか：鳴く面子と今までの面子が全部 2〜8、残りの手牌の么九牌が 1 枚以下 */
function tanyaoAfter(view: GameState, seat: Seat, tiles: readonly TileId[], called: TileId): boolean {
  if ([...tiles, called].some((t) => isTerminalOrHonor(kindOf(t)))) return false;
  if (view.melds[seat].some((m) => m.tiles.some((t) => isTerminalOrHonor(kindOf(t))))) return false;
  const rest = view.hands[seat].slice();
  for (const t of tiles) rest.splice(rest.indexOf(t), 1);
  return rest.filter((t) => isTerminalOrHonor(kindOf(t))).length <= 1;
}

function chooseDiscard(view: GameState, seat: Seat, legal: readonly Action[], opts: ThinkOptions): Action {
  const plans = discardPlans(view, seat, legal, opts);
  if (plans.length === 0) return legal[legal.length - 1];
  const attack = plans.slice().sort(attackOrder);
  const underThreat = threats(view, seat).length > 0;
  // 攻めで切る候補のうち、同じ近さ・同じ受け入れなら危なくないほう
  let choice = attack[0];
  if (underThreat) {
    const same = attack.filter((p) => p.shanten === choice.shanten && p.waits === choice.waits && p.valueLoss === choice.valueLoss);
    choice = same.sort((a, b) => a.danger - b.danger || attackOrder(a, b))[0];
    if (!shouldPush(view, seat, choice, opts)) choice = plans.slice().sort(defenseOrder)[0];
  }
  // 先読み：攻めるときで、同じ近さ（テンパイの 2 歩手前まで）・受け入れが近い候補が 2 つ以上あれば、2 歩先の受け入れで比べる
  if (opts.simulate && (!underThreat || choice === attack[0]) && choice.shanten >= 1 && choice.shanten <= 2) {
    const kinds = new Set<KindId>();
    const top = attack.filter((p) => {
      if (p.shanten !== choice.shanten || kinds.has(kindOf(p.tile))) return false;
      if (p.waits < choice.waits * 0.75 || p.valueLoss > choice.valueLoss) return false;
      if (underThreat && p.danger > choice.danger) return false;
      kinds.add(kindOf(p.tile));
      return true;
    }).slice(0, 4);
    if (top.length >= 2) {
      const counts = handCounts(view, seat);
      const visible = visibleCounts(view, seat);
      const open = view.melds[seat].length;
      const scores = top.map((p) => {
        const c = counts.slice();
        if (!isQueTile(view, seat, p.tile)) c[kindOf(p.tile)]--;
        return twoStepAcceptance(c, open, visible);
      });
      let bi = 0;
      for (let i = 1; i < top.length; i++) if (scores[i] > scores[bi]) bi = i;
      choice = top[bi];
    }
  }
  // 暗槓・加槓：リーチされていなければ、近さが変わらないならする（ドラが増える）
  if (!underThreat) {
    for (const a of legal) {
      if (a.type !== 'kan' || a.kan === 'minkan') continue;
      if (kanKeepsShanten(view, seat, a.tiles, a.kan)) return a;
    }
  } else {
    const kan = legal.find((a) => a.type === 'kan' && a.kan === 'ankan' && view.riichi[seat] !== 'none');
    if (kan) return kan;
  }
  // テンパイで待ちが残っていればリーチ（待ちの残りが 0 枚＝もう出ないならリーチしない）
  if (choice.shanten === 0 && choice.waits > 0) {
    const riichi = legal.find((a) => a.type === 'riichi' && kindOf(a.tile) === kindOf(choice.tile));
    if (riichi) return riichi;
  }
  return choice.action;
}

/** 大明槓のあと（手牌から 3 枚出し、嶺上牌を引いてから切る＝13 枚形）でも近さが今より悪くならないか */
function minkanKeepsShanten(view: GameState, seat: Seat, tiles: readonly TileId[], now: number): boolean {
  if (tiles.some((t) => isQueTile(view, seat, t))) return false;
  const counts = handCounts(view, seat);
  for (const t of tiles) counts[kindOf(t)]--;
  return shanten(counts, view.melds[seat].length + 1) <= now;
}

function kanKeepsShanten(view: GameState, seat: Seat, tiles: readonly TileId[], kan: 'ankan' | 'kakan'): boolean {
  // 缺一門の捨てる色の牌はカンしない（手に残すと花豬になる・捨て終えるのが遅れる）
  if (tiles.some((t) => isQueTile(view, seat, t))) return false;
  const counts = handCounts(view, seat);
  const open = view.melds[seat].length;
  // 今の手から 1 枚切ったときの一番近い形
  let before = 99;
  for (let k = 0; k < 34; k++) {
    if (!counts[k]) continue;
    counts[k]--;
    before = Math.min(before, shanten(counts, open));
    counts[k]++;
  }
  for (const t of tiles) counts[kindOf(t)]--;
  // カンのあとは嶺上牌を引いてから切る＝13 枚形の近さで比べる
  const after = shanten(counts, kan === 'ankan' ? open + 1 : open);
  return after <= before;
}
