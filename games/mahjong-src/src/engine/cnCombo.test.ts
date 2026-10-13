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
  }, 60000);
});

describe('途中流局（中国式・Q7=A＝九種九牌・四風連打・四開槓）', () => {
  it('★「あり」なら自動対局で九種九牌と四開槓が起き、失敗 0 で次の局へ進む（国標・四川＋血戦到底）', async () => {
    const { runSelfplay, runGames } = await import('../selfplay/run');
    const r = runSelfplay(600, 'cn-tochu', cn('mcr', { tochu: 'on' }));
    expect(r.failures).toEqual([]);
    expect(Object.keys(r.paths.aborts).sort(), JSON.stringify(r.paths.aborts)).toEqual(expect.arrayContaining(['kyushu', 'sukan']));
    const g = runGames(3, 'cn-tochu-g', cn('sichuan', { tochu: 'on', honors: 'on' }));
    expect(g.failures).toEqual([]);
  }, 60000);

  it('「なし」なら途中流局は起きない', async () => {
    const { runSelfplay } = await import('../selfplay/run');
    const r = runSelfplay(300, 'cn-tochu', cn('mcr', {}));
    expect(r.endings.abort).toBe(0);
  }, 60000);

  it('途中流局の種類：中国式の「あり」は九種九牌（本人が選ぶ）・四風連打・四開槓。四家立直は無い', async () => {
    const { abortRules } = await import('./state');
    expect(abortRules(cn('mcr', { tochu: 'on' }))).toEqual({ kyushu: true, kyushuMust: false, sufon: true, sukan: true, suricchi: false });
    expect(abortRules(cn('mcr', {}))).toEqual({ kyushu: false, kyushuMust: false, sufon: false, sukan: false, suricchi: false });
  });
});

describe('換三張（中国式・Q8=A＝同じ色 3 枚・向きはサイコロ・字牌は字牌どうし）', () => {
  it('★「あり」なら自動対局で交換が起き、失敗 0（四川・国標〔字牌・花牌あり〕）', async () => {
    const { runSelfplay } = await import('../selfplay/run');
    for (const r of [cn('sichuan', { huan3: 'on' }), cn('mcr', { huan3: 'on' }), cn('hk', { huan3: 'on', queyimen: 'on' })]) {
      const res = runSelfplay(40, 'cn-huan3', r);
      expect(res.failures).toEqual([]);
      expect(res.games).toBe(40);
    }
  }, 60000);
});

describe('換三張の出来事（1 局を開いて確かめる）', () => {
  it('4 人が同じ色 3 枚を出し、サイコロの向きで出した人の 3 枚をそのまま受け取る。ほかの人には伏せて見える。そのあと缺一門', async () => {
    const { playOne } = await import('../selfplay/run');
    const { benchCpu } = await import('../cpu/bench');
    const { huan3From } = await import('./state');
    const { mask } = await import('./events');
    const r = playOne('huan3-open', cn('sichuan', { huan3: 'on' }), benchCpu, false);
    const evs = r.log.map((e) => e.ev);
    const passes = evs.filter((e) => e.type === 'huan3Pass');
    const swap = evs.find((e) => e.type === 'huan3Swap');
    const takes = evs.filter((e) => e.type === 'huan3Take');
    expect(passes.length).toBe(4);
    expect(takes.length).toBe(4);
    if (!swap || swap.type !== 'huan3Swap') throw new Error('向きが決まっていない');
    for (const p of passes) {
      if (p.type !== 'huan3Pass') continue;
      // 3 枚とも同じ色
      expect(new Set(p.tiles.map((t) => Math.floor(Math.floor(t / 4) / 9))).size).toBe(1);
    }
    for (const t of takes) {
      if (t.type !== 'huan3Take') continue;
      const from = passes.find((p) => p.type === 'huan3Pass' && p.seat === huan3From(t.seat, swap.dir));
      expect(from && from.type === 'huan3Pass' ? [...from.tiles] : null).toEqual([...t.tiles]);
    }
    // ほかの人の出した牌・受け取った牌は伏せて見える
    const env = r.log.find((e) => e.ev.type === 'huan3Pass' && e.ev.seat === 0)!;
    const seen = mask(env, 1).ev;
    expect(seen.type === 'huan3Pass' && seen.tiles.every((t) => t === -1)).toBe(true);
    // 交換のあとで缺一門（伏せる）
    const lastTake = r.log.map((e) => e.ev.type).lastIndexOf('huan3Take');
    const firstQue = r.log.findIndex((e) => e.ev.type === 'queHold');
    expect(firstQue).toBeGreaterThan(lastTake);
  });
});
