/**
 * 表示LOD（第3分冊 6章 / 15.2）
 *
 * **セル実寸（CSS px）を唯一の判定基準とする**（C-47）。
 * ズーム倍率そのものも N も基準にしない。同じ倍率でも N によって見え方が変わり、
 * 同じ N でもズームによって可読性が変わるためである（6.1）。
 *
 * 閾値の境目でズームを微調整すると LOD が振動する。これを避けるため、
 * **切替に幅（ヒステリシス）を持たせる**（6.4）。現在値を引数に取る純粋関数とする。
 */

import { LOD_COMPACT_PX, LOD_FULL_PX, LOD_HYSTERESIS_PX } from '../config';

export type LodLevel = 'FULL' | 'COMPACT' | 'MINIMAL';

/**
 * セル実寸から表示LODを決定する。
 * `current` を与えるとヒステリシス（6.4）を適用する。
 *
 * **閾値は「上がる大きさ」そのものとし、下がるのは閾値 `−2px` を切ってからとする**（C-181）。
 * 段階7 までは上げ `+2px` ／下げ `−2px` だったため、**拡大していって数字になる大きさが、
 * 縮小していって塗りに戻る大きさより 4px 大きかった。** 同じ場所を行き来しているのに
 * 見え方が揃わない。**できるだけ数字を出す**という方針に合わせ、小さい側へそろえた。
 * ヒステリシスの幅そのものは残す。無くすと境目でズームを微調整したときに表示が振動する。
 *
 * 「いま居る段から出るときだけ閾値をずらす」という一般の規則で表し、段ごとの分岐は書かない。
 */
export function decide(cellPx: number, current: LodLevel | null): LodLevel {
  const h = current === null ? 0 : LOD_HYSTERESIS_PX;
  // FULL に居るあいだだけ下がりにくい。上がるのは閾値ちょうどである
  const fullThreshold = current === 'FULL' ? LOD_FULL_PX - h : LOD_FULL_PX;
  // COMPACT 以上に居るあいだだけ下がりにくい。上がるのは閾値ちょうどである
  const compactThreshold = current === 'MINIMAL' ? LOD_COMPACT_PX : LOD_COMPACT_PX - h;

  if (cellPx >= fullThreshold) return 'FULL';
  if (cellPx >= compactThreshold) return 'COMPACT';
  return 'MINIMAL';
}

/**
 * ルーペの自動有効化は廃止した（C-189）
 *
 * 段階7 まではセル実寸が 24px を下回ると勝手に出ていたが、**自分で開く道具**に改めたため
 * 判定そのものが要らなくなった。出るきっかけは虫眼鏡アイコンだけである。
 */

/**
 * ルーペが映す範囲は利用者が決める（C-189）
 *
 * C-186 では「候補メモが 8px を下回らない範囲でいちばん広く」を自動で求めていたが、
 * **ルーペの中に `＋` / `−` を置いて自分で決める**ことにしたため、その規則は役目を終えた。
 * 刻みは `ui/config.ts` の `LOUPE_SPANS` にある。
 */

export const lodModule = { decide };
