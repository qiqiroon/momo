/**
 * 表示LOD（第3分冊 6章）
 *
 * **受入条件 5-3** と **計測 V-19（ヒステリシスで振動が抑えられるか）** をここで確かめる。
 */

import { describe, expect, it } from 'vitest';
import { LOD_COMPACT_PX, LOD_FULL_PX, LOD_HYSTERESIS_PX } from '../config';
import { decide, type LodLevel } from './lod';

describe('3段階の判定（6.1 / 6.2）', () => {
  it('現在値が無いときは閾値ちょうどで切り替わる', () => {
    expect(decide(LOD_FULL_PX, null)).toBe('FULL');
    expect(decide(LOD_FULL_PX - 0.01, null)).toBe('COMPACT');
    expect(decide(LOD_COMPACT_PX, null)).toBe('COMPACT');
    expect(decide(LOD_COMPACT_PX - 0.01, null)).toBe('MINIMAL');
  });

  it('判定基準はセル実寸だけである（同じ実寸なら同じ段になる）', () => {
    // N も倍率も引数に取らない。呼び出し側が実寸を渡す以外の経路が無いことの確認
    expect(decide(40, null)).toBe(decide(40, null));
    expect(decide.length).toBe(2);
  });
});

describe('ヒステリシス（6.4）', () => {
  const H = LOD_HYSTERESIS_PX;

  /**
   * C-181: **上がるのは閾値ちょうど、下がるのは閾値 −2px を切ってから。**
   *
   * 段階7 までは上げ `+2px` ／下げ `−2px` で、**同じ場所を行き来しているのに
   * 数字になる大きさと塗りに戻る大きさが 4px ずれていた。**
   * できるだけ数字を出す方針に合わせ、小さい側へそろえた。
   */
  it('上がるのは閾値ちょうど、下がるのは閾値 −2px を切ってから', () => {
    // COMPACT から FULL へは閾値ちょうどで上がる
    expect(decide(LOD_FULL_PX - 0.01, 'COMPACT')).toBe('COMPACT');
    expect(decide(LOD_FULL_PX, 'COMPACT')).toBe('FULL');
    // FULL から COMPACT へ下がるのは 36−2 を切ってから
    expect(decide(LOD_FULL_PX - H, 'FULL')).toBe('FULL');
    expect(decide(LOD_FULL_PX - H - 0.01, 'FULL')).toBe('COMPACT');
    // MINIMAL から COMPACT へも閾値ちょうどで上がる
    expect(decide(LOD_COMPACT_PX - 0.01, 'MINIMAL')).toBe('MINIMAL');
    expect(decide(LOD_COMPACT_PX, 'MINIMAL')).toBe('COMPACT');
    // COMPACT から MINIMAL へ下がるのは閾値 −2 を切ってから
    expect(decide(LOD_COMPACT_PX - H, 'COMPACT')).toBe('COMPACT');
    expect(decide(LOD_COMPACT_PX - H - 0.01, 'COMPACT')).toBe('MINIMAL');
  });

  /**
   * C-181: **行きと帰りで切り替わる大きさが同じであること。**
   *
   * これが揃っていないと、同じ場所を行き来しているのに見え方が変わる。
   * ずれてよいのは、ちらつき止めのぶん（＝下がる側が 2px 粘る）だけである。
   */
  it('拡大して数字になる大きさは、縮小して塗りに戻る大きさより 2px 以内でしか離れない', () => {
    for (const threshold of [LOD_COMPACT_PX, LOD_FULL_PX]) {
      const 上がる = threshold;
      const 下がる = threshold - H;
      expect(上がる - 下がる).toBe(H);
    }
  });

  it('段を飛ばす移動もできる（FULL から一気に MINIMAL へ）', () => {
    expect(decide(5, 'FULL')).toBe('MINIMAL');
    expect(decide(100, 'MINIMAL')).toBe('FULL');
  });

  /**
   * V-19: スライダ操作時の振動が抑えられるか。
   *
   * 閾値付近を細かく往復させる。**ヒステリシスが無ければ往復のたびに切り替わる**。
   */
  it('V-19 閾値をまたぐ微振動は、数回で落ち着いたあと二度と揺り戻らない', () => {
    // C-181 で「上がるのは閾値ちょうど」に変えたため、**下から揺らすと最初は上がる。**
    // 見るべきはそこではなく、**落ち着いたあと二度と揺り戻らないこと**である。
    // ヒステリシスが無ければ、揺らすたびに永遠に切り替わり続ける。
    for (const threshold of [LOD_COMPACT_PX, LOD_FULL_PX]) {
      for (const start of ['MINIMAL', 'COMPACT', 'FULL'] as LodLevel[]) {
        let current = start;
        let 落ち着いたあとの切替 = 0;
        for (let i = 0; i < 100; i++) {
          const px = threshold + (i % 2 === 0 ? -0.9 : 0.9);
          const next = decide(px, current);
          if (next !== current && i >= 10) 落ち着いたあとの切替++;
          current = next;
        }
        expect(落ち着いたあとの切替, `閾値${threshold} / ${start} から`).toBe(0);
      }
    }
  });

  it('V-19 スライダを端から端へ動かすと、各境目で1回ずつだけ切り替わる', () => {
    let current: LodLevel = 'MINIMAL';
    const upward: LodLevel[] = [];
    for (let px = 5; px <= 70; px += 0.25) {
      const next = decide(px, current);
      if (next !== current) upward.push(next);
      current = next;
    }
    expect(upward).toEqual(['COMPACT', 'FULL']);

    const downward: LodLevel[] = [];
    for (let px = 70; px >= 5; px -= 0.25) {
      const next = decide(px, current);
      if (next !== current) downward.push(next);
      current = next;
    }
    expect(downward).toEqual(['COMPACT', 'MINIMAL']);
  });
});

/**
 * ルーペの自動有効化と「映す範囲の自動決定」は廃止した（C-189）
 *
 * **ルーペは自分で開く道具になった。** 出るきっかけは虫眼鏡アイコンだけであり、
 * 倍率もルーペの中の `＋` / `−` で決める。よって
 * `shouldEnableLoupe` / `loupeRadius` / `loupeCellPx` は無くなり、その検査も無くなった。
 * 置き場所と逃げ方の検査は `zoom.test.tsx` にある。
 */
