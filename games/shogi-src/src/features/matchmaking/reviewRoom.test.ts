import { describe, it, expect } from 'vitest';
import { decodeRoomName, encodeRoomName, getBadgeLabels } from './roomNameCodec';

/**
 * 感想戦の部屋 (v1.50・画面機能 v0.40 §3 S04・付録D-12 §8)。
 *
 * ここで固定したいのは、**壊れても部屋を建てるまで気づけないこと**。
 *   - **用途は部屋名に載せて運ぶ**＝サーバーは部屋名を素通しするだけなので、
 *     記号が往復しなくなると**一覧で対局の部屋と見分けが付かなくなる**
 *   - **記号を足しても既存の部屋名の読み方は変わらない**（対局の部屋が化けない）
 *   - **知らない記号を受け取っても壊れない**＝データを落とさずそのまま出す
 */

describe('感想戦の部屋の印', () => {
  it('★感想戦として建てた部屋は、部屋名から感想戦だと読み戻せる', () => {
    const name = encodeRoomName({
      gameType: 'shogi',
      torus: false,
      quantum: true,
      review: true,
      userRoomName: '量子将棋の感想戦',
    });
    const parts = decodeRoomName(name);
    expect(parts.review).toBe(true);
    expect(parts.quantum).toBe(true);
    expect(parts.gameType).toBe('shogi');
    expect(parts.userRoomName).toBe('量子将棋の感想戦');
  });

  it('★対局の部屋は感想戦にならない（記号を足しても既存の読み方が変わらない）', () => {
    const name = encodeRoomName({
      gameType: 'hasami',
      torus: true,
      quantum: false,
      timeControl: { mode: 'byoyomi', mainSeconds: 900, byoyomiSeconds: 30 },
      userRoomName: 'ふつうの対局',
    });
    const parts = decodeRoomName(name);
    expect(parts.review).toBe(false);
    expect(parts.gameType).toBe('hasami');
    expect(parts.torus).toBe(true);
    expect(parts.timeControl?.mode).toBe('byoyomi');
  });

  it('感想戦の記号が無い古い部屋名も、そのまま対局の部屋として読める', () => {
    const parts = decodeRoomName('[本+環+TS15] 前からある部屋');
    expect(parts.review).toBe(false);
    expect(parts.unknownFlags).toEqual([]);
  });

  it('[...] の付かない生の部屋名でも落ちない（感想戦ではない）', () => {
    const parts = decodeRoomName('むかしの部屋');
    expect(parts.review).toBe(false);
    expect(parts.unrecognized).toBe(true);
    expect(parts.userRoomName).toBe('むかしの部屋');
  });

  it('★知らない記号は捨てずに残す（先の版が足した印で部屋が消えない）', () => {
    const parts = decodeRoomName('[本+感+謎] これから増える印');
    expect(parts.review).toBe(true);
    expect(parts.unknownFlags).toEqual(['謎']);
  });

  it('感想戦の呼び名は 3 言語ぶんある（日本語と中国語は同じ字を使う決まり）', () => {
    expect(getBadgeLabels('ja').review).toBe('感想戦');
    expect(getBadgeLabels('zh').review).toBe('感想戦');
    expect(getBadgeLabels('en').review).toBe('Review');
  });
});
