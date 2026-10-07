import type { Envelope } from './events';
import { Watcher, checkState } from './invariants';
import { startRound } from './round';
import { GENERAL_RULES } from './rules';
import { playOne, runSelfplay } from '../selfplay/run';

/** 見張り役に正しい列を流し、1つだけ差し替えて流す（既定は最後の出来事）。差し替えた時点までに出た理由を返す */
function feedWithLast(tamper: (env: Envelope, all: Envelope[]) => Envelope, at = -1): string[] {
  const w = new Watcher();
  w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
  const envs = startRound(w.full, 'tamper', 0, 0);
  const target = at < 0 ? envs.length + at : at;
  const reasons: string[] = [];
  envs.forEach((env, i) => reasons.push(...w.push(i === target ? tamper(env, envs) : env)));
  return reasons;
}

describe('見張り役', () => {
  it('正しい列では何も言わない', () => {
    expect(feedWithLast((e) => e)).toEqual([]);
  });

  it('同じ牌を2人に配ると気づく（最後の1枚に、席0の最初の1枚）', () => {
    const reasons = feedWithLast((e, all) => {
      const first = all.find((x) => x.ev.type === 'deal' && x.ev.seat === 0 && x.ev.tiles.length === 1)!;
      return e.ev.type === 'deal' && first.ev.type === 'deal' ? { ...e, ev: { ...e.ev, tiles: first.ev.tiles } } : e;
    });
    expect(reasons.join()).toMatch(/同じ牌が2か所/);
  });

  it('途中で配る枚数がずれると気づく（最初の4枚を3枚に）', () => {
    // 出来事の並び：局の始まり・山の種・配牌16回 → 3 番目が最初の配牌
    const reasons = feedWithLast((e) => (e.ev.type === 'deal' ? { ...e, ev: { ...e.ev, tiles: e.ev.tiles.slice(1) } } : e), 2);
    // 手牌と山の残りが一緒にずれるので「数」は合ってしまう。並びの決まりで捕まえる
    // （最後の1枚を配らない壊し方は並びも崩れない＝段階1の「最初のツモの時点で全員13枚」で捕まえる）
    expect(reasons.join()).toMatch(/山の先頭から順に取られていない/);
  });

  it('局面を作る側の数え違い（山の残りだけずれる）に気づく', () => {
    const w = new Watcher();
    w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
    for (const env of startRound(w.full, 'count', 0, 0)) w.push(env);
    const broken = { ...w.full, wallLeft: w.full.wallLeft - 1 };
    expect(checkState(broken, w.views).join()).toMatch(/牌の数が合わない/);
  });

  it('配牌を全員に見せてしまうと気づく', () => {
    const reasons = feedWithLast((e) => ({ ...e, to: 'all' }));
    expect(reasons.join()).toMatch(/手牌が見えている/);
  });

  it('使わない牌（花牌）を配ると気づく', () => {
    const reasons = feedWithLast((e) =>
      e.ev.type === 'deal' ? { ...e, ev: { ...e.ev, tiles: [...e.ev.tiles.slice(1), 140] } } : e,
    );
    expect(reasons.join()).toMatch(/使わない牌/);
  });
});

describe('自動対局の台', () => {
  it('50局回して失敗0件・回した数と出来事の数が合う（1局＝始まり1＋局の始まり1＋山の種1＋配牌16回）', () => {
    const r = runSelfplay(50, 'test');
    expect(r.games).toBe(50);
    expect(r.events).toBe(50 * 19);
    expect(r.failures).toEqual([]);
  });

  it('同じ種なら同じ結果（失敗した局を種で再現できる）', () => {
    expect(playOne('again')).toEqual(playOne('again'));
  });
});
