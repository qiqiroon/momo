// 局の進め方（日本式・段階4の 2）。局が終わった局面から、次に何が起きるかを決める。
// 全員に見えること（結果・持ち点・局の番号・本場・ルール）だけで決まる＝どの端末でも同じ答えになる。
//
// 局の番号 roundIndex：0〜3＝東 1〜4 局、4〜7＝南、8〜11＝西。親は起家（席 0）から順に roundIndex % 4。
// 予定の最後の局（オーラス）：東風＝東 4 局、半荘＝南 4 局。延長（西入。東風なら南入）は次の風の 4 局まで。
// 返し点は 30000 点（どのセットも同じ。持ち点 25000＋オカ、または持ち点 30000）。

import type { Seat } from './events';
import type { GameState } from './state';

/** 返し点（ルールの kaeshi が 30 のとき）。延長の終わり・アガリやめの「原点」もこの値 */
export const RETURN_POINTS = 30000;

/** 返し点。ルールが「なし（素点のまま）」なら null */
export function returnPoints(s: GameState): number | null {
  return s.rules?.family === 'jp' && s.rules.values.kaeshi === 'none' ? null : RETURN_POINTS;
}

export type GameEndReason = 'last' | 'tobi' | 'yame' | 'extension';

/** 局が終わったあとに起きること */
export type NextStep =
  /** 次の局（連荘なら同じ局の番号で本場が 1 つ増える） */
  | { type: 'round'; roundIndex: number; dealer: Seat; honba: number }
  /** 対局の終わり。last＝予定の最後の局が終わった／tobi＝飛び／yame＝アガリやめ・テンパイやめ／extension＝延長の終わり（西入で返し点を超えた・西 4 局まで） */
  | { type: 'end'; reason: GameEndReason }
  /** オーラスでトップの親が、やめるか続けるかを選ぶ（ルールが「本人が選ぶ」のとき） */
  | { type: 'yame'; seat: Seat };

const jp = (s: GameState) => (s.rules?.family === 'jp' ? s.rules.values : null);

/** 親が続くか（連荘）。アガリ：親がアガった人に入っている。流局：ルールの renchan（テンパイなら／アガったときだけ）。途中流局：abortRenchan */
export function dealerStays(s: GameState): boolean {
  const r = s.result;
  const v = jp(s);
  if (!r) throw new Error('局が終わっていない');
  if (r.type === 'tsumo') return r.seat === s.dealer;
  if (r.type === 'ron') return r.wins.some((w) => w.seat === s.dealer);
  if (r.type === 'exhaust') return v?.renchan !== 'agari' && r.tenpai[s.dealer];
  // 途中流局・3 人同時ロンの流局
  return v?.abortRenchan !== 'pass';
}

/** 次の局の本場：親が続く・流局（途中流局も）なら 1 増える。子がアガったら 0。本場「なし」のルールならいつも 0 */
export function nextHonba(s: GameState): number {
  const v = jp(s);
  if (v?.honba === 'off') return 0;
  const r = s.result!;
  const won = r.type === 'tsumo' || r.type === 'ron';
  return dealerStays(s) || !won ? s.honba + 1 : 0;
}

/** 飛び：0 点未満（ルールが「0 点で終了」なら 0 点以下）の人がいる */
export function someoneBusted(s: GameState): boolean {
  const v = jp(s);
  if (v?.tobi !== 'on') return false;
  return s.scores.some((p) => (v.zero === 'end' ? p <= 0 : p < 0));
}

/** 予定の最後の局（オーラス）の番号。東風＝3（東 4 局）・半荘＝7（南 4 局） */
export function lastScheduledRound(s: GameState): number {
  return jp(s)?.length === 'east' ? 3 : 7;
}

/** 延長（西入・東風なら南入）の最後の局の番号（予定の最後のさらに 4 局あと） */
const lastExtensionRound = (s: GameState) => lastScheduledRound(s) + 4;

/** 親がトップか（ほかの全員より多い＝同点ならトップと見ない） */
const dealerIsTop = (s: GameState) => s.scores.every((p, i) => i === s.dealer || s.scores[s.dealer] > p);
const someoneReturned = (s: GameState) => s.scores.some((p) => p >= RETURN_POINTS);

/**
 * 局が終わった局面から、次に起きること。
 * 1. 飛び → 終わり
 * 2. オーラス（延長中は西入の終わり方が「返し点を超えたら終了」なら毎局、「西 4 局まで打つ」なら西 4 局）：
 *    - 親が続く：返し点以上のトップの親なら、ルールのアガリやめ・テンパイやめ（自動で終了／本人が選ぶ）。
 *      途中流局で続くときはやめられない（天鳳の条文：親が原点以上のトップなら和了止め/聴牌止め、他は連荘）
 *    - 親が流れる：延長が無い（西入なし・延長の最後の局）か、誰かが返し点以上なら終わり。そうでなければ延長へ
 * 3. それ以外 → 次の局
 */
export function nextStep(s: GameState): NextStep {
  if (s.phase !== 'ended' || !s.result) throw new Error('局が終わっていない');
  const v = jp(s);
  if (someoneBusted(s)) return { type: 'end', reason: 'tobi' };
  const stays = dealerStays(s);
  const honba = nextHonba(s);
  const next: NextStep = stays
    ? { type: 'round', roundIndex: s.roundIndex, dealer: s.dealer, honba }
    : { type: 'round', roundIndex: s.roundIndex + 1, dealer: ((s.dealer + 1) % 4) as Seat, honba };
  const last = lastScheduledRound(s);
  const inExtension = s.roundIndex > last;
  // 西入は返し点が要る（返し点「なし」のルールでは設定画面で押せない。値が来ても延長しない）
  const westOn = v?.west === 'on' && returnPoints(s) !== null;
  const sudden = v?.westEnd !== 'full';
  const finalHand = s.roundIndex === last || (inExtension && (sudden || s.roundIndex === lastExtensionRound(s)));
  if (!finalHand) return next;

  if (stays) {
    const r = s.result;
    const won = r.type === 'tsumo' || r.type === 'ron';
    const tenpaiStay = r.type === 'exhaust';
    const rule = won ? v?.agariyame : tenpaiStay ? v?.tenpaiyame : 'off';
    // 天鳳の条文「親が原点以上のトップなら和了止め/聴牌止め」：返し点以上（供託は数えない）で、ほかの全員より多い
    // 返し点「なし」のルールなら、トップならやめられる
    const kaeshi = returnPoints(s);
    if (rule && rule !== 'off' && dealerIsTop(s) && (kaeshi === null || s.scores[s.dealer] >= kaeshi)) {
      if (rule === 'auto') return { type: 'end', reason: 'yame' };
      if (s.yame === null) return { type: 'yame', seat: s.dealer };
      if (s.yame) return { type: 'end', reason: 'yame' };
    }
    // 延長中に誰かが返し点に届いても、親が続くなら続ける（オーラスと同じ）
    return next;
  }
  const canExtend = westOn && s.roundIndex < lastExtensionRound(s);
  if (!canExtend) return { type: 'end', reason: inExtension ? 'extension' : 'last' };
  if (someoneReturned(s)) return { type: 'end', reason: inExtension ? 'extension' : 'last' };
  return next;
}
