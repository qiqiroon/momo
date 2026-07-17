/**
 * 駒の強さテーブル (仕様書 D1 §4.4 準拠)。
 *
 * 持ち駒台や UI 上で「強い駒を上・弱い駒を下」に並べる際の順位付けに使う。
 * 数値の絶対値は他コードで参照しないこと (順序比較のみに使う)。
 *
 * 成駒: 捕獲時は基本駒に戻る (`と`→`歩` 等) ため、通常は基本駒側だけが持ち駒台に現れる。
 * ただし駒種ごとに独自エントリを持たせて、将来の変則ルール (成りの持続等) にも対応できる。
 *
 * 量子将棋: 候補集合を持つ駒については `pieceStrengthOf({ kind, candidates })` の
 * `candidates` に候補駒種の配列を渡すと、候補中の最強駒の強さで順位付け (spec D1 §4.4
 * 「未確定駒の強さは候補中の最強の駒」)。現在 PieceInstance に candidates フィールドは
 * 無いので、この関数は将来量子実装時のフックとして残してある。
 */

export const PIECE_STRENGTH: Record<string, number> = {
  ou: 100, gyoku: 100,
  hi: 80,  ryu: 80,      // 飛車 / 龍 (成飛)
  kaku: 70, uma: 70,     // 角 / 馬 (成角)
  kin: 50,
  gin: 40, narigin: 40,  // 銀 / 成銀
  kei: 30, narikei: 30,  // 桂 / 成桂
  kyo: 20, narikyo: 20,  // 香 / 成香
  fu: 10,  to: 10,       // 歩 / と
};

/** 単一 kind の強さを返す (未知 kind は 0 = 最下位)。 */
export function strengthOf(kind: string): number {
  return PIECE_STRENGTH[kind] ?? 0;
}

/**
 * 駒 (と候補集合 optional) の強さを返す。量子未確定駒に候補集合を渡すと、
 * 候補中の最強駒の強さを返す (spec D1 §4.4)。
 */
export function pieceStrengthOf(input: { kind: string; candidates?: string[] }): number {
  if (input.candidates && input.candidates.length > 0) {
    let max = 0;
    for (const c of input.candidates) {
      const s = strengthOf(c);
      if (s > max) max = s;
    }
    return max;
  }
  return strengthOf(input.kind);
}
