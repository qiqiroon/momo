import type { Envelope } from './events';
import { Watcher, checkState } from './invariants';
import { act, advance, startRound } from './round';
import { GENERAL_RULES } from './rules';
import { playOne, runSelfplay } from '../selfplay/run';
import { tsumogiriCpu } from '../cpu/tsumogiri';

/** 見張り役に正しい列を流し、1つだけ差し替えて流す（既定は最後の配牌）。差し替えた時点までに出た理由を返す */
function feedWithLast(tamper: (env: Envelope, all: Envelope[]) => Envelope, at = -1): string[] {
  const w = new Watcher();
  w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
  const envs = startRound(w.full, 'tamper', 0, 0);
  const lastDeal = envs.map((e) => e.ev.type).lastIndexOf('deal');
  const target = at < 0 ? lastDeal : at;
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
    // （最後の1枚を配らない壊し方は並びも崩れない＝下の「最初のツモの時点で全員13枚」で捕まえる）
    expect(reasons.join()).toMatch(/山の先頭から順に取られていない/);
  });

  it('最後の1枚を配り忘れると、最初のツモの時点で気づく（並びの決まりでは気づけない形）', () => {
    const w = new Watcher();
    w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
    const envs = startRound(w.full, 'forget', 0, 0);
    // 最後の配牌（席3 の 1 枚）を抜き、通し番号を詰める（そのあとのドラ表示は番号を 1 つ前へ）
    const last = envs.map((e) => e.ev.type).lastIndexOf('deal');
    const kept = [...envs.slice(0, last), ...envs.slice(last + 1).map((e) => ({ ...e, seq: e.seq - 1 }))];
    const dealReasons = kept.flatMap((e) => w.push(e));
    expect(dealReasons).toEqual([]); // 配っている途中では気づけない
    // 席3 の 1 枚が山に残ったまま＝親は本来の 14 枚目でなく、その牌をツモる
    const reasons = advance(w.full).flatMap((e) => w.push(e));
    expect(reasons.join()).toMatch(/手牌の枚数が違う（席 3：12 枚/);
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

  it('ドラ表示牌を王牌の決まった場所以外からめくると気づく', () => {
    const reasons = feedWithLast((e, all) => {
      if (e.ev.type !== 'doraReveal') return e;
      const other = all.find((x) => x.ev.type === 'deal')!;
      return other.ev.type === 'deal' ? { ...e, ev: { ...e.ev, tile: other.ev.tiles[0] } } : e;
    }, 18); // 局の始まり・山の種・配牌16回のあと＝18 番目
    expect(reasons.join()).toMatch(/ドラ表示牌が王牌の決まった場所の牌でない/);
  });

  it('ドラ表示牌をめくり忘れると、最初のツモの時点で気づく', () => {
    const w = new Watcher();
    w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
    const envs = startRound(w.full, 'nodora', 0, 0).filter((e) => e.ev.type !== 'doraReveal');
    for (const e of envs) w.push(e);
    expect(advance(w.full).flatMap((e) => w.push(e)).join()).toMatch(/ドラ表示牌がめくられていない/);
  });

  it('使わない牌（花牌）を配ると気づく', () => {
    const reasons = feedWithLast((e) =>
      e.ev.type === 'deal' ? { ...e, ev: { ...e.ev, tiles: [...e.ev.tiles.slice(1), 140] } } : e,
    );
    expect(reasons.join()).toMatch(/使わない牌/);
  });
});

/** 配り終えて、親がツモるまで進めた見張り役 */
function dealtWatcher(seed: string): Watcher {
  const w = new Watcher();
  w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
  for (const env of startRound(w.full, seed, 0, 0)) w.push(env);
  for (const env of advance(w.full)) w.push(env);
  return w;
}

describe('見張り役（ツモと打牌）', () => {
  it('山の順番を飛ばしてツモると気づく', () => {
    const w = dealtWatcher('skip');
    w.push(act(w.full, 0, { type: 'discard', tile: w.full.hands[0][0] })[0]);
    for (const seat of [1, 2, 3] as const) w.push(act(w.full, seat, { type: 'pass' })[0]);
    const right = advance(w.full)[0];
    if (right.ev.type !== 'draw') throw new Error('ツモのはず');
    const skipped = { ...right, ev: { ...right.ev, tile: w.full.wall![w.full.wall!.length - w.full.wallLeft + 1] } };
    expect(w.push(skipped).join()).toMatch(/山の先頭から順に取られていない/);
  });

  it('ツモを全員に見せてしまうと気づく', () => {
    const w = new Watcher();
    w.push({ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
    for (const env of startRound(w.full, 'show', 0, 0)) w.push(env);
    const draw = advance(w.full)[0];
    expect(w.push({ ...draw, to: 'all' }).join()).toMatch(/手牌が見えている|ツモ牌の見え方/);
  });

  it('持っていない牌を切ると気づく', () => {
    const w = dealtWatcher('notmine');
    const other = w.full.hands[1][0];
    expect(w.push({ seq: w.full.nextSeq, to: 'all', ev: { type: 'discard', seat: 0, tile: other, tsumogiri: false } }).join()).toMatch(
      /持っていない牌/,
    );
  });

  it('番でない人が切ると気づく', () => {
    const w = dealtWatcher('turn');
    const t = w.full.hands[1][0];
    expect(w.push({ seq: w.full.nextSeq, to: 'all', ev: { type: 'discard', seat: 1, tile: t, tsumogiri: false } }).join()).toMatch(/番でない/);
  });

  it('アガリの形でないのにツモアガリすると気づく（進行役を通さず出来事を直接作る）', () => {
    const w = dealtWatcher('fake');
    expect(w.push({ seq: w.full.nextSeq, to: 'all', ev: { type: 'tsumo', seat: 0, hand: w.full.hands[0].slice(), winTile: w.full.drawn[0]!, ura: [] } }).join()).toMatch(
      /アガリの形でない/,
    );
  });

  it('山が残っているのに流局すると気づく', () => {
    const w = dealtWatcher('early');
    w.push(act(w.full, 0, { type: 'discard', tile: w.full.hands[0][0] })[0]);
    expect(w.push({ seq: w.full.nextSeq, to: 'all', ev: { type: 'exhaust' } }).join()).toMatch(/山が残っている/);
  });
});

describe('自動対局の台', () => {
  it('ツモ切りだけの 1 局は必ず流局まで行き、出来事は 375 件（始まり3＋配牌16回＋ドラ表示1＋ツモ70＋打牌70＋見送り210＋流局1＋宣言4）', () => {
    // 136 枚−配牌 52−王牌 14＝ツモは 70 回
    const r = playOne('count', GENERAL_RULES, tsumogiriCpu);
    expect(r.failure).toBeNull();
    expect(r.ending).toBe('exhaust');
    expect(r.events).toBe(375);
  });

  it('100局回して失敗0件・ツモアガリと流局の両方の道を通る', () => {
    const r = runSelfplay(100, 'test');
    expect(r.games).toBe(100);
    expect(r.failures).toEqual([]);
    expect(r.endings.unfinished).toBe(0);
    expect(r.endings.tsumo).toBeGreaterThan(0); // アガリの道が走ったことを見る
    expect(r.endings.exhaust).toBeGreaterThan(0);
  }, 30_000); // 重い検査（オンラインの卓）と並んで走ると 5 秒を超えることがある（結果は種で決まる）

  it('同じ種なら同じ結果（失敗した局を種で再現できる）', () => {
    expect(playOne('again')).toEqual(playOne('again'));
  });
});
