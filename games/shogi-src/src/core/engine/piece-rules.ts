/**
 * 駒定義の読み方をまとめた場所 (親 v1.65 §3.6.1〜§3.6.3・第 9 段 9-1)。
 *
 * ★なぜ 1 か所に集めるか
 * 「成りといえば裏返る成り」「取った駒は持ち駒になる」といった**決め打ちが、
 * 判断する側それぞれに埋まっていた**のがこの直しの発端である。同じ決め方を
 * 各所に書き直すと、**足すルールごとに書き忘れた場所で黙って壊れる**ので、
 * **ルール定義をどう読むかはここだけに書き**、使う側はここを呼ぶ。
 */

import type { Mgf, MgfMustPromoteReason, MgfPieceDef, MgfPromotionType } from './mgf/types';

/** その駒の成りの型 (§3.6.2)。省略時は `flip` (裏返る成り＝将棋)。 */
export function promotionTypeOf(def: MgfPieceDef): MgfPromotionType {
  return def.promotion_type ?? 'flip';
}

/** 強制成りの理由 (§3.6.3)。省略時は `no_legal_move` (行き所がなくなるから)。 */
export function mustPromoteReasonOf(def: MgfPieceDef): MgfMustPromoteReason {
  return def.must_promote_reason ?? 'no_legal_move';
}

/**
 * その駒はそもそも成れるか (型ごとに「成れる」の条件が違う・§3.6.2)。
 *
 * - 裏返る成り … 成った姿の駒が定義されていること
 * - 入れ替わる昇格 … 昇格先の候補が 1 つ以上あること
 * - 場所で動きが変わる … **本版では名前だけ置く** (移動定義を場所で差し替える
 *   仕組みが未規定なので、成りとしては起こさない・§3.6.2)
 */
export function canPromoteKind(def: MgfPieceDef): boolean {
  if (!def.can_promote) return false;
  switch (promotionTypeOf(def)) {
    case 'flip':
      return !!def.promoted_id;
    case 'replace':
      return (def.promotion_choices?.length ?? 0) > 0;
    case 'zone_move':
      return false;
  }
}

/**
 * 入れ替わる昇格で選べる駒 (§3.6.2)。裏返る成りでは空。
 * **1 個だけ書けば選択は起きない** (呼ぶ側は先頭を使えばよい)。
 */
export function promotionChoicesOf(def: MgfPieceDef): string[] {
  if (promotionTypeOf(def) !== 'replace') return [];
  return def.promotion_choices ?? [];
}

/**
 * 「必ず成る」がこの盤で効いているか (§3.6.3)。
 *
 * **上下がつながった盤で外れるのは「行き所がなくなるから」の側だけ**である。
 * ルールとしてそう決まっている側 (チェスのポーン) は、つながっていても外れない。
 * ここを分けないと、**上下がつながった盤でポーンが最奥段を昇格せずに素通りする**。
 */
export function forcedPromotionApplies(def: MgfPieceDef, wrapY: boolean): boolean {
  if (!def.must_promote_at || def.must_promote_at === 0) return false;
  if (!wrapY) return true;
  return mustPromoteReasonOf(def) === 'by_rule';
}

/** 成った姿の駒種から元の駒種へ戻す。成り駒でなければそのまま返す。 */
export function unpromotedKindOf(mgf: Mgf, kind: string): string {
  const base = mgf.pieces.find((p) => p.promoted_id === kind);
  return base ? base.id : kind;
}

/**
 * 取られた駒が**駒台へ入るか** (親 §3.6 `is_hand_piece`・§5.5.8)。
 *
 * ★2 つ気をつけること
 * 1. **戻したあとの駒種で見る**。将棋の成り駒 (と金など) は「持ち駒にならない」と
 *    書かれているが、取られたときは**元の駒に戻ってから駒台へ**入る。いまの姿で
 *    見ると、と金を取った瞬間に盤からも駒台からも消える。
 * 2. **正体が決まっていない駒は、持ち駒になりうる候補が 1 つでもあれば入れる**
 *    (打てるかを見る側と同じ読み方＝多めに拾う側へ倒す)。名札 1 つで決めると、
 *    **名札を正体として使う**ことになる。
 */
export function capturedGoesToHand(mgf: Mgf, kinds: string[]): boolean {
  return kinds.some((k) => {
    const def = mgf.pieces.find((p) => p.id === unpromotedKindOf(mgf, k));
    return !!def?.is_hand_piece;
  });
}

/**
 * 駒に書く文字 (§3.6.1)。**ルール定義が正本**であり、実装は表を持たない。
 *
 * 1 語だけ書かれていれば全言語で同じ字を出す。言語ごとの表が書かれていれば
 * その言語の字を、無ければ日本語 → 定義の並び順で最初に見つかった字を使う
 * (**何も出ないことだけは避ける**)。
 */
export function pieceNameOf(mgf: Mgf, kind: string, locale: string): string {
  const def = mgf.pieces.find((p) => p.id === kind);
  if (!def) return kind;
  const name = def.name;
  if (typeof name === 'string') return name;
  if (!name) return kind;
  const hit = name[locale] ?? name.ja;
  if (hit) return hit;
  for (const v of Object.values(name)) if (v) return v;
  return kind;
}

/** 駒の文字の色 (§3.6.1)。省略時は undefined＝既定の墨色 (テーマ任せ)。 */
export function glyphColorOf(mgf: Mgf, kind: string, owner: 'player1' | 'player2'): string | undefined {
  const def = mgf.pieces.find((p) => p.id === kind);
  return def?.display?.glyph_color?.[owner];
}

/**
 * 初期配置 (SFEN/FEN) の 1 文字 → 駒種の対応を**ルール定義の表示文字から作る**。
 *
 * ★なぜ定義から作るか
 * 以前は将棋の文字表 (p→歩・l→香…) が配置を読む側 (position/init) に決め打ちされていた。
 * ところがチェスの FEN 文字 (k/q/r/b/n/p) は将棋と対応が違う (**n は桂ではなくナイト**) ので、
 * 決め打ちのままでは読めない。**表示文字 (§3.6.1) がそのまま SFEN/FEN の略記**
 * (将棋 P/L/N/S/G/B/R/K・チェス K/Q/R/B/N/P・いずれもその競技の棋譜で使う正式な字) なので、
 * そこから対応を作れば 9-1 と同じ「決め打ちを定義側へ寄せる」直しになる。
 *
 * **1 文字でない表示名 (成り駒の "+P" など) は基底の配置文字ではない**ので載せない
 * (成り駒は '+' 接頭辞＋基底文字で書かれる)。
 */
export function placementLetterMap(mgf: Mgf): Record<string, string> {
  const map: Record<string, string> = {};
  for (const def of mgf.pieces) {
    const name = def.name;
    let letter: string | undefined;
    if (typeof name === 'string') letter = name;
    else if (name) letter = name.en ?? Object.values(name).find((v): v is string => !!v);
    if (letter && /^[A-Za-z]$/.test(letter)) {
      map[letter.toLowerCase()] = def.id;
    }
  }
  return map;
}
