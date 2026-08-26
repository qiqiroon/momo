import type { Mgf } from './types';

/**
 * 変則条件（モディファイア）を、そのルールで使ってよいか（親 v1.65 §3.2.1）。
 *
 * **可否を持っているのはルール定義だけ**である。§3.2.1 は「**このゲームがどのモディファイアを
 * 許容するか**を宣言するのは MGF」と定め、**対局開始時に設定が宣言に反していたら弾く**ことまで
 * 定めている。
 *
 * ★**画面に一覧を書かない**＝v1.91 まで、ルール選択の画面が「本将棋は量子可・はさみは不可」と
 * **同じことを画面側の表に写して**持っていた。写しは**ルールが増えるたびに書き足す形**なので、
 * **カスタムだけは中身を見ずに「可」と決め打ち**になっており、**「量子とは併用しない」と宣言した
 * カスタムルールでも量子で始められた**。ここを 1 か所にして、**事実（定義の宣言）から引く**。
 * → [[reference_label_is_not_identity]] / [[reference_guard_where_forgetting_is_cheap]]
 *
 * ★**宣言が無ければすべて許す**（§3.2.1「省略時の既定は『すべて許容』だが、破綻するゲームは
 * 明示的に不許可を宣言すること」）。**書き忘れは「使える」側に転ぶ**＝規定がそう決めている。
 */

/** 対局設定側の盤のつなぎ方（`core` から上の層の型を参照しないよう、ここで受ける形にする）。 */
export type ModifierTorusMode = 'none' | 'cylinder' | 'full';

/** その盤のつなぎ方を許容するか。 */
export function torusAllowed(mgf: Mgf, mode: ModifierTorusMode): boolean {
  if (mode === 'none') return true;
  const torus = mgf.compatible_modifiers?.torus;
  if (!torus) return true;
  return mode === 'cylinder' ? torus.cylinder !== false : torus.full_torus !== false;
}

/** 量子を許容するか。 */
export function quantumAllowed(mgf: Mgf): boolean {
  return mgf.compatible_modifiers?.quantum?.enabled !== false;
}

/** 設定が宣言に反している点。無ければ null。 */
export type ModifierConflict = 'quantum' | 'torus';

/**
 * 対局設定がルール定義の宣言に反していないか（§3.2.1・§3.13）。
 *
 * **反していたら、その事実を返す**＝黙って条件を落として始めない。落とすと、部屋の札や
 * 画面には選んだはずの条件が出たまま、**別の対局が始まる**（[[reference_absence_is_a_message]]）。
 */
export function modifierConflict(
  mgf: Mgf,
  settings: { quantum?: boolean; torusMode?: ModifierTorusMode },
): ModifierConflict | null {
  if (settings.quantum && !quantumAllowed(mgf)) return 'quantum';
  if (!torusAllowed(mgf, settings.torusMode ?? 'none')) return 'torus';
  return null;
}
