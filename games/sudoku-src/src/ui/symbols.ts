/**
 * 表示記号（第3分冊 15.7）
 *
 * **全サイズで 1..N の算用数字を用いる**（設計書 2.1）。
 * 16 進や英字への切り替えは行わない。サイズごとの表記差を作らないためである。
 */

/** 内部値 → 表示文字列 */
export function toDisplay(value: number): string {
  return String(value);
}

/** 表示上の桁数。文字寸法の選択に用いる（4.3） */
export function digits(value: number): 1 | 2 {
  return value < 10 ? 1 : 2;
}

export const symbolModule = { toDisplay, digits };
