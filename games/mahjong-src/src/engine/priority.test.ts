// 同じ牌に何人かが宣言したときの優先順位の検査（段階3の 4）。
// ロン＞ポン・カン＞チー。ロンが 2 人・3 人ならルールの値（ダブロン・頭ハネ・流局・3 人とも）。
// オンラインでは誰の返事が先に届くか決まらないので、返事の組み合わせ全部 × 届く順番 6 通りを全部試し、
// 「順番によって結果が変わらない」ことと「決まりどおりの人が勝つ」ことを確かめる。
import type { Envelope, GameEvent, Seat } from './events';
import { act, legalActions, type Action } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, type GameState } from './state';
import type { TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

/** 背番号を配る係（同じ種類は 4 枚目から使う）。fill は使っていない種類から数合わせの牌を出す */
function dealer() {
  const used = new Map<number, number>();
  const take = (s: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
      for (const d of nums) {
        const kind = BASE[suit as 'm'] + Number(d) - 1;
        const n = used.get(kind) ?? 0;
        if (n >= 4) throw new Error(`5 枚目は無い（${d}${suit}）`);
        used.set(kind, n + 1);
        out.push(kind * 4 + 3 - n);
      }
    }
    return out;
  };
  return take;
}

const rulesWith = (values: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...values } } : GENERAL_RULES;

/** 4 人に配って、席 0（親）が 3p をツモって切ったところ（返事を待っている） */
function setup(hands: [string, string, string, string], rules: Rules): GameState {
  const d = dealer();
  let s = initialState();
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => {
    s = apply(s, { seq: s.nextSeq, to, ev });
  };
  push({ type: 'gameStart', rules });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
  push({ type: 'doraReveal', tile: d('7z')[0] });
  const tile = d('3p')[0];
  push({ type: 'draw', seat: 0, tile }, [0]);
  push({ type: 'discard', seat: 0, tile, tsumogiri: true });
  return { ...s, wall: [] };
}

const DEALER = '1m1m1m9m9m9m1s1s1s9s9s9s1z';
// 席 1（下家）：2p4p のカンチャン＝3p でチーもロン（タンヤオ）もできる
const S1_CHI_RON = '2p4p3m4m5m6m7m8m3s4s5s7s7s';
// 席 1：チーだけ（2p4p はあるが手は仕上がっていない）
const S1_CHI = '2p4p1z2z3z4z5z6z7z2z3z4z5z';
// 席 2：3p を 2 枚＝ポン／3 枚＝ポンとカン
const S2_PON = '3p3p1z2z3z4z5z6z7z5z6z7z4z';
const S2_KAN = '3p3p3p2z3z4z5z6z7z5z6z7z4z';
// 席 3：4p5p の両面＝3p でロン（タンヤオ）
const S3_RON = '4p5p2m3m4m5m6m7m3s4s5s6s6s';

type Choice = 'pass' | 'ron' | 'chi' | 'pon' | 'kan';

/** 席ごとに選べる返事（実際に legalActions に出ているものだけ） */
function choicesOf(s: GameState, seat: Seat): Action[] {
  return legalActions(s, seat);
}
const choiceName = (a: Action): Choice => (a.type === 'kan' ? 'kan' : (a.type as Choice));

/** 決まりどおりならどうなるか（届く順番に関係なく決まる） */
function expected(choice: Record<number, Choice>, rules: Rules): string {
  const rons = ([1, 2, 3] as const).filter((s) => choice[s] === 'ron');
  const v = rules.family === 'jp' ? rules.values : null;
  if (rons.length === 3) return v?.triple === 'ryukyoku' ? 'tripleRon' : v?.triple === 'atama' ? 'ron:1' : 'ron:1,2,3';
  if (rons.length === 2) return v?.double === 'atama' ? `ron:${rons[0]}` : `ron:${rons.join(',')}`;
  if (rons.length === 1) return `ron:${rons[0]}`;
  const pk = ([1, 2, 3] as const).find((s) => choice[s] === 'pon' || choice[s] === 'kan');
  if (pk) return `${choice[pk]}:${pk}`;
  if (choice[1] === 'chi') return 'chi:1';
  return 'next:1';
}

/** 局面の結果を、expected と同じ書き方にする */
function outcome(s: GameState): string {
  const r = s.result;
  if (r?.type === 'tripleRon') return 'tripleRon';
  if (r?.type === 'ron') return `ron:${r.wins.map((w) => w.seat).join(',')}`;
  const caller = ([1, 2, 3] as const).find((x) => s.melds[x].length > 0);
  if (caller !== undefined) {
    const m = s.melds[caller][0];
    return `${m.type === 'minkan' ? 'kan' : m.type}:${caller}`;
  }
  return `next:${s.turn}`;
}

const ORDERS: Seat[][] = [
  [1, 2, 3],
  [1, 3, 2],
  [2, 1, 3],
  [2, 3, 1],
  [3, 1, 2],
  [3, 2, 1],
];

/** 返事の組み合わせ全部 × 届く順番 6 通り。試した数を返す */
function tryAll(hands: [string, string, string, string], rules: Rules): { tried: number; kinds: Set<string> } {
  const start = setup(hands, rules);
  const options = ([1, 2, 3] as Seat[]).map((seat) => choicesOf(start, seat));
  let tried = 0;
  const kinds = new Set<string>();
  for (const a1 of options[0]) {
    for (const a2 of options[1]) {
      for (const a3 of options[2]) {
        const picks: Record<number, Action> = { 1: a1, 2: a2, 3: a3 };
        const choice: Record<number, Choice> = { 1: choiceName(a1), 2: choiceName(a2), 3: choiceName(a3) };
        const want = expected(choice, rules);
        kinds.add(want);
        for (const order of ORDERS) {
          let s = start;
          for (const seat of order) for (const e of act(s, seat, picks[seat])) s = apply(s, e);
          expect(`${JSON.stringify(choice)} 順番 ${order.join('')} → ${outcome(s)}`).toBe(`${JSON.stringify(choice)} 順番 ${order.join('')} → ${want}`);
          // 負けた鳴きは何も残さない（手牌も面子もそのまま）
          const winners = want.includes(':') ? want.split(':')[1].split(',').map(Number) : [];
          for (const seat of [1, 2, 3] as Seat[]) {
            if (!winners.includes(seat)) {
              expect(s.melds[seat]).toEqual([]);
              expect(s.hands[seat].length).toBe(13);
            }
          }
          tried++;
        }
      }
    }
  }
  return { tried, kinds };
}

describe('同じ牌に何人かが宣言したとき（届く順番を全部試す）', () => {
  it('チー・ポン・ロン：ロン＞ポン＞チー。ロン 2 人はダブロン（一般ルール）', () => {
    const { tried, kinds } = tryAll([DEALER, S1_CHI_RON, S2_PON, S3_RON], GENERAL_RULES);
    // 席 1＝見送る・チー・ロン、席 2＝見送る・ポン、席 3＝見送る・ロン ＝ 3×2×2 通り × 順番 6
    expect(tried).toBe(3 * 2 * 2 * 6);
    expect([...kinds].sort()).toEqual(['chi:1', 'next:1', 'pon:2', 'ron:1', 'ron:1,3', 'ron:3'].sort());
  });

  it('頭ハネのルールなら、切った人の下家に近い 1 人だけ', () => {
    const { kinds } = tryAll([DEALER, S1_CHI_RON, S2_PON, S3_RON], rulesWith({ double: 'atama' }));
    expect(kinds.has('ron:1,3')).toBe(false);
    expect(kinds.has('ron:1')).toBe(true);
  });

  it('カンとチー：カン（大明槓）がチーより先。ロンはカンより先', () => {
    const { tried, kinds } = tryAll([DEALER, S1_CHI, S2_KAN, S3_RON], GENERAL_RULES);
    // 席 1＝見送る・チー、席 2＝見送る・ポン・カン、席 3＝見送る・ロン
    expect(tried).toBe(2 * 3 * 2 * 6);
    expect(kinds).toEqual(new Set(['next:1', 'chi:1', 'pon:2', 'kan:2', 'ron:3']));
  });
});
