// 中国式の個別設定（2026-10-13 第16 手順2）：セットにない組み合わせで壊れる・点が狂う所の検査。
// 1 つの直しごとに、セットの値の 1 項目だけを変えた形で確かめる。
import { describe, expect, it } from 'vitest';
import { rulesOfCnSet } from './ruleSets';
import type { Rules } from './rules';
import { sichuanScore } from './sichuan';
import { baoOn, chajiaoOn, cnDrawSettles, cnMaxPoints, cnMeldOf, initialState, type OpenMeld } from './state';
import type { TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18 } as const;
/** 「123m」などを種類ごとの枚数（長さ 34）に */
function counts(s: string): number[] {
  const c = Array(34).fill(0);
  for (const [, nums, suit] of s.matchAll(/(\d+)([mps])/g)) for (const d of nums) c[BASE[suit as 'm'] + Number(d) - 1]++;
  return c;
}
/** 種類の並び → 背番号（同じ種類は 0,1,2… 枚目） */
const tilesOf = (...kinds: number[]): TileId[] => kinds.map((k, i) => k * 4 + (kinds.slice(0, i).filter((x) => x === k).length % 4));

/** セットの値の一部を変えたルール */
function cn(set: 'sichuan' | 'mcr' | 'hk', change: Record<string, string>): Rules {
  const r = rulesOfCnSet(set);
  if (r.family !== 'cn') throw new Error('中国式でない');
  return { family: 'cn', values: { ...r.values, ...change } };
}

describe('チーあり＋四川の番', () => {
  const rules = cn('sichuan', { chi: 'on' });
  // 鳴いた牌が並びの先頭（2m を鳴いて 1m3m を出した）でも、面子は 1m からのチー
  const chi: OpenMeld = { type: 'chi', tiles: tilesOf(1, 0, 2), called: tilesOf(1)[0], from: 3 };

  it('チーの面子は一番小さい牌と印で渡す', () => {
    expect(cnMeldOf(chi)).toEqual({ kind: 0, size: 3, chi: true });
  });

  it('チーがあれば、手の中が刻子だけでも碰碰胡は付かない（清一色だけ）', () => {
    const s = sichuanScore({ concealed: counts('444555666m99m'), melds: [cnMeldOf(chi)], haidi: false }, rules);
    expect(s?.fans).toEqual([{ id: 'qingyise', fan: 2 }]);
  });

  it('チーの 1m と手の中の 1m 3 枚で根（同じ牌 4 枚）になる', () => {
    const s = sichuanScore({ concealed: counts('111m555p666p99p'), melds: [cnMeldOf(chi)], haidi: false }, rules);
    expect(s?.fans).toEqual([{ id: 'gen', fan: 1 }]);
  });
});

describe('流局のテンパイの判定は、どの数え方でもふつうのアガリと同じ判定（四川の番だけを見ていた）', () => {
  const at = (rules: Rules) => ({ ...initialState(), rules });
  /** 「1112345678999m」などを背番号に */
  const hand = (str: string) => {
    const c = counts(str);
    return tilesOf(...c.flatMap((n, k) => Array(n).fill(k)));
  };

  it('香港の番：九蓮寶燈の九面待ちはテンパイ（例牌＝上限 10 番の 512 点）', () => {
    expect(cnMaxPoints(at(cn('hk', {})), 0, hand('1112345678999m'))).toBe(512);
  });

  it('香港の番：3 番に届かない待ちしかなければノーテン', () => {
    expect(cnMaxPoints(at(cn('hk', {})), 0, hand('123m456p789s234s5p'))).toBeNull();
  });

  it('国標の番：8 点に届く待ちがあればテンパイ', () => {
    expect(cnMaxPoints(at(cn('mcr', {})), 0, hand('1112345678999m'))).not.toBeNull();
  });

  it('四川の番は今までどおり（1m・9m 待ちは清一色＋根で上限の 3 番＝8 点。ツモは基本点＋1）', () => {
    expect(cnMaxPoints(at(cn('sichuan', { queyimen: 'off' })), 0, hand('1112345678999m'))).toBe(8);
    expect(cnMaxPoints(at(cn('sichuan', { queyimen: 'off', chajiaoPts: 'tsumo' })), 0, hand('1112345678999m'))).toBe(9);
  });
});

describe('押せない項目に残った値は効かない（ルール設定 v0.06 §6）', () => {
  it('查叫は四川の番のときだけ（Q4=A）', () => {
    expect(chajiaoOn(cn('sichuan', {}))).toBe(true);
    expect(chajiaoOn(cn('sichuan', { scoring: 'mcr' }))).toBe(false);
    expect(cnDrawSettles(cn('mcr', { chajiao: 'on' }))).toBe(false);
  });

  it('包牌は払い方が香港式のときだけ', () => {
    expect(baoOn(cn('hk', {}))).toBe(true);
    expect(baoOn(cn('hk', { pay: 'sichuan' }))).toBe(false);
  });
});

describe('国標式の払い＋血戦到底（抜けて続く）', () => {
  it('★自動対局：アガって抜けた人は払わない（見張り役が払いの額を検算する）', async () => {
    const { runGames } = await import('../selfplay/run');
    const r = runGames(4, 'mcr-leave', cn('mcr', { afterWin: 'leave' }));
    expect(r.games).toBe(4);
    expect(r.failures).toEqual([]);
  });
});
