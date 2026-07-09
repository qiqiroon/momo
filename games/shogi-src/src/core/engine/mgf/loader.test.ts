import { describe, it, expect } from 'vitest';
import { hondou } from './loader';

describe('MGF loader (hondou.json)', () => {
  it('has metadata game_id honshogi', () => {
    expect(hondou.metadata.game_id).toBe('honshogi');
    expect(hondou.metadata.game_name).toBe('本将棋');
  });

  it('has 9x9 board with shogi coordinate', () => {
    expect(hondou.board.width).toBe(9);
    expect(hondou.board.height).toBe(9);
    expect(hondou.board.coordinate).toBe('shogi');
  });

  it('has 14 piece definitions (8 base + 6 promoted)', () => {
    expect(hondou.pieces).toHaveLength(14);
    const ids = hondou.pieces.map((p) => p.id);
    expect(ids).toContain('fu');
    expect(ids).toContain('kyo');
    expect(ids).toContain('kei');
    expect(ids).toContain('gin');
    expect(ids).toContain('kin');
    expect(ids).toContain('kaku');
    expect(ids).toContain('hi');
    expect(ids).toContain('ou');
    expect(ids).toContain('to');
    expect(ids).toContain('narikyo');
    expect(ids).toContain('narikei');
    expect(ids).toContain('narigin');
    expect(ids).toContain('uma');
    expect(ids).toContain('ryu');
  });

  it('ou is royal, cannot promote', () => {
    const ou = hondou.pieces.find((p) => p.id === 'ou');
    expect(ou?.is_royal).toBe(true);
    expect(ou?.can_promote).toBe(false);
  });

  it('kin cannot promote', () => {
    const kin = hondou.pieces.find((p) => p.id === 'kin');
    expect(kin?.can_promote).toBe(false);
  });

  it('fu promotes to to', () => {
    const fu = hondou.pieces.find((p) => p.id === 'fu');
    expect(fu?.can_promote).toBe(true);
    expect(fu?.promoted_id).toBe('to');
    expect(fu?.must_promote_at).toBe(1);
  });
});
