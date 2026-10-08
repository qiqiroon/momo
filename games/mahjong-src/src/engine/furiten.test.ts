// フリテンの検査（段階2＝判定と表示まで）。配る牌を指定した局面を出来事の列で組む。
import { HIDDEN, type Envelope, type GameEvent, type Seat } from './events';
import { furitenOf } from './furiten';
import { GENERAL_RULES } from './rules';
import { apply, initialState, type GameState } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

/** 背番号を配る係。同じ種類は 4 枚目→3 枚目…の順に使う */
function dealer() {
  const used = new Map<number, number>();
  return (s: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
      for (const d of nums) {
        const kind = BASE[suit as 'm'] + Number(d) - 1;
        const n = used.get(kind) ?? 0;
        if (n >= 4) throw new Error(`5 枚目は無い（${kind}）`);
        used.set(kind, n + 1);
        out.push(kind * 4 + 3 - n);
      }
    }
    return out;
  };
}

class Table {
  s: GameState = initialState();
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    this.s = apply(this.s, { seq: this.s.nextSeq, to, ev });
    // 切られた牌には、ほかの 3 人とも見送る（返事そのものの検査は ron.test.ts）
    if (ev.type === 'discard') {
      for (const d of [1, 2, 3]) {
        const seat = ((ev.seat + d) % 4) as Seat;
        this.s = apply(this.s, { seq: this.s.nextSeq, to: 'all', ev: { type: 'pass', seat } });
      }
    }
  }
}

/** 席 0（親）が 123m456p789s1122z（1z・2z のシャンポン待ち）をもらい、draw をツモったところ */
function setup(draw: string) {
  const d = dealer();
  const t = new Table();
  t.push({ type: 'gameStart', rules: GENERAL_RULES });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  t.push({ type: 'deal', seat: 0, tiles: d('123m456p789s1z1z2z2z') }, [0]);
  ['2m2m2m3m3m3m4m4m4m6m6m6m7m', '2p2p2p3p3p3p4p4p4p6p6p6p7p', '2s2s2s3s3s3s4s4s4s6s6s6s7s'].forEach((h, i) =>
    t.push({ type: 'deal', seat: (i + 1) as Seat, tiles: d(h) }, [(i + 1) as Seat]),
  );
  t.push({ type: 'doraReveal', tile: d('8s')[0] });
  t.push({ type: 'draw', seat: 0, tile: d(draw)[0] }, [0]);
  return { t, d };
}

/** 席 1〜3 が 1 枚ずつツモ切りして、席 0 が draw をツモるところまで進める */
function around(t: Table, d: ReturnType<typeof dealer>, draw: string) {
  ['9p', '9m', '8m'].forEach((x, i) => {
    const seat = (i + 1) as Seat;
    const tile = d(x)[0];
    t.push({ type: 'draw', seat, tile }, [seat]);
    t.push({ type: 'discard', seat, tile, tsumogiri: true });
  });
  t.push({ type: 'draw', seat: 0, tile: d(draw)[0] }, [0]);
}

describe('フリテン（自分の捨て牌）', () => {
  it('待ち牌を自分で切っていればフリテン。元の牌の河の位置が分かる', () => {
    const { t } = setup('1z'); // ツモれば 1z の刻子でアガれるが、切る
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    const f = furitenOf(t.s, 0)!;
    expect(f.waits).toEqual([k('1z'), k('2z')]);
    expect(f.reasons).toEqual(['discard']);
    expect(f.causes).toEqual([0]);
  });

  it('待ちと関係ない牌を切っただけならフリテンでない', () => {
    const { t } = setup('3z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    expect(furitenOf(t.s, 0)!.reasons).toEqual([]);
  });

  it('自分の番でツモったあとは、ツモる前の 13 枚で見る（切るまで変わらない）', () => {
    const { t, d } = setup('1z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    around(t, d, '9s');
    expect(t.s.hands[0]).toHaveLength(14);
    expect(furitenOf(t.s, 0)!.reasons).toEqual(['discard']);
  });

  it('手を崩して待ちが無くなればフリテンの印も消える', () => {
    const { t, d } = setup('1z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    around(t, d, '5p');
    // 1z を切ると 1z・2z2z・5p が残る＝ノーテン。待ちが無いので、河の 1z はもうフリテンの元にならない
    const one = t.s.hands[0].find((x) => kindOf(x) === k('1z'))!;
    t.push({ type: 'discard', seat: 0, tile: one, tsumogiri: false });
    const f = furitenOf(t.s, 0)!;
    expect(f.waits).toEqual([]);
    expect(f.reasons).toEqual([]);
  });

  it('手牌が伏せてある（他人の）席は判定しない', () => {
    const { t } = setup('1z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    const hidden = { ...t.s, hands: t.s.hands.map((h, seat) => (seat === 0 ? h.map(() => HIDDEN) : h)) };
    expect(furitenOf(hidden, 0)).toBeNull();
  });

  it('フリテンが「なし」のルールでは判定しない', () => {
    const { t } = setup('1z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    if (GENERAL_RULES.family !== 'jp') throw new Error('日本式のはず');
    const rules = { family: 'jp' as const, values: { ...GENERAL_RULES.values, furiten: 'off' } };
    expect(furitenOf({ ...t.s, rules }, 0)).toBeNull();
  });
});

describe('見逃しのフリテン（置き場だけ。立てるのは段階3）', () => {
  it('同じ巡の見逃しは、次の自分の打牌で解ける。リーチ後の見逃しは解けない', () => {
    const { t } = setup('3z');
    t.s = { ...t.s, missedTurn: [true, false, false, false], missedRiichi: [true, false, false, false] };
    expect(furitenOf(t.s, 0)!.reasons).toEqual(['turn', 'riichi']);
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    expect(t.s.missedTurn[0]).toBe(false);
    expect(furitenOf(t.s, 0)!.reasons).toEqual(['riichi']);
  });

  it('局が始まると見逃しは消える', () => {
    const { t } = setup('3z');
    // 局が終わった（全員ノーテンの流局で親が流れた）ところで次の局を始める（段階4から、次の局は局の進め方どおりでないと止まる）
    t.s = {
      ...t.s,
      missedTurn: [true, true, true, true],
      missedRiichi: [true, true, true, true],
      phase: 'ended',
      result: { type: 'exhaust', tenpai: [false, false, false, false], payments: [0, 0, 0, 0] },
      settlement: [0, 0, 0, 0],
    };
    t.push({ type: 'roundStart', roundIndex: 1, dealer: 1, honba: 1 });
    expect(t.s.missedTurn).toEqual([false, false, false, false]);
    expect(t.s.missedRiichi).toEqual([false, false, false, false]);
  });
});
