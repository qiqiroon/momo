/**
 * ルール定義（MGF）の**中身から作る目印**（段B②・親 §6.5.2）。
 *
 * ★なぜ名前だけでは足りないか
 * ネット対戦のルール照合は、これまで**種類の名札とカスタムルールの表示名**を並べた
 * 見取り図で突き合わせていた。ところが**名前は正体ではない**＝同じ名前で中身の違う
 * 定義は、名前だけを見ている限り黙って「一致」として通る。ここは**盤の大きさ・駒の顔ぶれ・
 * 中身そのもの**から目印を作り、**運ぶ途中で欠けたり化けたりした定義**をその場で表に出す。
 *
 * ★読めるものを前に置く理由
 * 見取り図は「食い違ったときにどの項目が違うのかをそのまま読める」形にしてある
 * （`ruleDigest` と `positionHash` と同じ方針）ので、**目・版・盤の大きさ・駒数までは
 * 素の文字**で並べ、最後にだけ中身を丸めた短い印を足す。全部を丸めてしまうと、
 * 食い違ったときに「違う」ことしか分からない。
 */

import type { Mgf } from './types';

/**
 * 中身を**並び順に左右されない文字列**へ均す。
 *
 * ★項目の並び順で目印が変わってはいけない＝定義は運ぶ途中で 1 度書き出して読み直される
 * ので、書き出す側の都合で並びが変わることがある。**同じ中身なら同じ印**にするために、
 * 名前順に並べ替えてから文字にする。
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** 均した文字列を短い印へ丸める（FNV-1a・32bit）。**秘密を守る用途ではない**＝取り違えを見つけるだけ。 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 定義 1 つ分の目印。**同じ中身なら必ず同じ・違えば必ず違う**（取り違えを見つける精度で）。
 */
export function mgfFingerprint(mgf: Mgf): string {
  const m = mgf.metadata;
  return [
    m.game_id,
    m.version ?? '-',
    `${mgf.board.width}x${mgf.board.height}`,
    `${mgf.pieces.length}p`,
    shortHash(canonical(mgf)),
  ].join('/');
}
