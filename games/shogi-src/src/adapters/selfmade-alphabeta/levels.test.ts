/**
 * 強さの段の写像 (親 §7.5.3・§7.5.4)。
 *
 * ここで固定したいのは「段を上げると強くなる向き」と「持ち時間を食い破らない」こと。
 * 具体的な数値そのものは実測で変わりうるので、**大小関係**を検査する。
 */

import { describe, it, expect } from 'vitest';
import { LEVEL_TABLE, resolveLevel } from './levels';

describe('強さの段 (自作探索)', () => {
  it('段を上げるほど長く・深く読み、最善から外れなくなる', () => {
    const easy = LEVEL_TABLE.Easy;
    const hard = LEVEL_TABLE.Hard;
    const apoc = LEVEL_TABLE.Apocalypse;

    expect(easy.movetimeMs).toBeLessThan(hard.movetimeMs);
    expect(hard.movetimeMs).toBeLessThan(apoc.movetimeMs);
    expect(easy.maxDepth).toBeLessThan(hard.maxDepth);
    expect(hard.maxDepth).toBeLessThan(apoc.maxDepth);
    // 同点崩しの幅は逆向き (大きいほど最善から外れる)
    expect(easy.jitter).toBeGreaterThan(hard.jitter);
    expect(apoc.jitter).toBe(0);
  });

  it('スマホでは各段とも軽くなるが、段の順序は保たれる (親 §7.4)', () => {
    for (const level of ['Easy', 'Hard', 'Apocalypse'] as const) {
      expect(LEVEL_TABLE[level].mobileMovetimeMs).toBeLessThanOrEqual(LEVEL_TABLE[level].movetimeMs);
    }
    expect(LEVEL_TABLE.Easy.mobileMovetimeMs).toBeLessThan(LEVEL_TABLE.Apocalypse.mobileMovetimeMs);
  });

  it('段を指定しなければ Hard として扱う', () => {
    expect(resolveLevel({}).maxDepth).toBe(LEVEL_TABLE.Hard.maxDepth);
  });

  it('★持ち時間の予算より長くは考えない (小さい方を採る)', () => {
    // Apocalypse は 5 秒欲しいが、予算が 400ms しかない場面。
    const r = resolveLevel({ level: 'Apocalypse', movetimeMs: 400 });
    expect(r.movetimeMs).toBe(400);
    // 逆に予算のほうが大きければ、段が求めるぶんで止める (延々と考え込まない)。
    const r2 = resolveLevel({ level: 'Easy', movetimeMs: 60_000 });
    expect(r2.movetimeMs).toBe(LEVEL_TABLE.Easy.movetimeMs);
  });

  it('スマホの指定があれば軽いほうの時間を使う', () => {
    expect(resolveLevel({ level: 'Hard', mobile: true }).movetimeMs)
      .toBe(LEVEL_TABLE.Hard.mobileMovetimeMs);
    expect(resolveLevel({ level: 'Hard' }).movetimeMs).toBe(LEVEL_TABLE.Hard.movetimeMs);
  });

  it('深さの指定があれば厳しい側に倒す', () => {
    expect(resolveLevel({ level: 'Apocalypse', depth: 3 }).maxDepth).toBe(3);
  });
});
