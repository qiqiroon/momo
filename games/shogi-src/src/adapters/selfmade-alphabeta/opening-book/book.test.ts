/**
 * ★v1.84 §7.3.7: 定石の表の引き方。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import { formatMove } from '../../../core/engine/kifu/format';
import { searchBestMove } from '../search';
import { BOOK_LINES } from './lines';
import { parseLine } from './notation';
import { bookApplies, moveKey, nearHashes, probeBook, standardBook } from './book';
import { positionHash } from '../../../core/engine/position/hash';

const FEATURES = { tt: true, killers: true, checkExtension: true, mateSearch: true, kingSafety: true, openingBook: true };
const opts = (random: () => number) => ({
  movetimeMs: 60_000,
  maxDepth: 4,
  maxNodes: 3000,
  jitter: 0,
  rules: { quantum: false },
  features: FEATURES,
  random,
});

describe('定石の表 (★v1.84 §7.3.7)', () => {
  const book = standardBook(hondou);

  it('どの手順も、手順の各局面で表がその手順の手を持っている', () => {
    for (const line of BOOK_LINES) {
      const { moves, positions } = parseLine(hondou, initPosition(hondou), line.moves);
      moves.forEach((mv, i) => {
        const probe = probeBook(hondou, book, positions[i]);
        const keys = probe.exact.map((c) => c.entry.key);
        expect(keys, `${line.name} ${i + 1} 手目`).toContain(moveKey(positions[i], mv));
      });
    }
  });

  it('初期局面では読まずに表の手を指す (▲7六歩・▲2六歩・▲5六歩のどれか)', () => {
    const init = initPosition(hondou);
    const seen = new Set<string>();
    for (const r of [0.01, 0.3, 0.6, 0.99]) {
      const res = searchBestMove(hondou, init, opts(() => r));
      expect(res.book).toBe('exact');
      expect(res.nodes).toBe(0);
      seen.add(formatMove(hondou, init, res.move!));
    }
    for (const s of seen) expect(['▲7六歩', '▲2六歩', '▲5六歩']).toContain(s);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('定石の項目が切りなら表を引かない', () => {
    const res = searchBestMove(hondou, initPosition(hondou), { ...opts(() => 0.5), features: { ...FEATURES, openingBook: false } });
    expect(res.book).toBeUndefined();
    expect(res.nodes).toBeGreaterThan(0);
  });

  it('量子・トーラス・本将棋でない定義では引かない', () => {
    const init = initPosition(hondou);
    expect(bookApplies(hondou, init, false)).toBe(true);
    expect(bookApplies(hondou, init, true)).toBe(false);
    expect(bookApplies(hondou, { ...init, topology: { wrapX: true, wrapY: false } }, false)).toBe(false);
    expect(bookApplies({ ...hondou, metadata: { ...hondou.metadata, game_id: 'hasami' } }, init, false)).toBe(false);
  });

  it('手順前後で同じ形に戻れば表を使う (何手目かは見ない)', () => {
    // 矢倉の手順は 76歩 84歩 68銀 34歩 66歩。68銀 と 66歩 を入れ替えても同じ局面になる。
    const swapped = parseLine(hondou, initPosition(hondou), '76歩 84歩 66歩 34歩 68銀');
    const last = swapped.positions[swapped.positions.length - 1];
    expect(probeBook(hondou, book, last).exact.length).toBeGreaterThan(0);
  });

  it('近い形: 端歩が 1 マス違う局面は、そのままでは引けず近い形として引ける', () => {
    // 矢倉の 10 手目までに、先手の 9 筋の歩を 1 マス突いた形 (手順には無い)。
    const base = parseLine(hondou, initPosition(hondou), '76歩 84歩 68銀 34歩 66歩 62銀 56歩 54歩 48銀 42銀').positions[10];
    const board = base.board.map((row) => row.slice());
    board[5][0] = board[6][0]; // 9 七 → 9 六
    board[6][0] = null;
    const shifted = { ...base, board };
    const probe = probeBook(hondou, book, shifted);
    expect(probe.exact).toHaveLength(0);
    expect(probe.near.length).toBeGreaterThan(0);
    expect(nearHashes(shifted)).toContain(positionHash(base));
  });

  it('近い形の手は短く読んで確かめてから指す (確かめた印 near が付く)', () => {
    const base = parseLine(hondou, initPosition(hondou), '76歩 84歩 68銀 34歩 66歩 62銀 56歩 54歩 48銀 42銀').positions[10];
    const board = base.board.map((row) => row.slice());
    board[5][0] = board[6][0];
    board[6][0] = null;
    const res = searchBestMove(hondou, { ...base, board }, opts(() => 0.5));
    // 確かめに通れば near、通らなければ表を使わずに読んだ手 (印なし)。どちらでも nodes は 0 でない。
    expect(res.book === 'near' || res.book === undefined).toBe(true);
    expect(res.nodes).toBeGreaterThan(0);
  });
});
