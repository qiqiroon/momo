// 牌譜ファイルの検査（段階4の 4）。ファイル名・記録内容・読み直し・再生の手の区切り。
import { benchCpu } from '../cpu/bench';
import { playOne } from '../selfplay/run';
import { GENERAL_RULES } from '../engine/rules';
import { replaySteps } from '../ui/Replay';
import { apply, initialState } from '../engine/state';
import { buildKifu, kifuFileName, parseKifu, type KifuSource } from './kifu';

const NAMES = [
  { name: 'あなた', kind: 'human' as const },
  { name: 'CPU 1', kind: 'cpu' as const },
  { name: 'CPU 2', kind: 'cpu' as const },
  { name: 'CPU 3', kind: 'cpu' as const },
];

/** 半荘を 1 回、終わりまで自動で打った出来事の列 */
const game = playOne('kifu-test', GENERAL_RULES, benchCpu, true);
const source = (events = game.log): KifuSource => ({ seed: 'kifu-test', startedAt: '2026-10-08T21:30:45+09:00', players: NAMES, set: 'general', events });

describe('ファイル名', () => {
  it('m_ と始めた日時（年月日-時分秒）とルール名', () => {
    expect(kifuFileName({ startedAt: '2026-10-08T21:30:45+09:00', rules: { family: 'jp', set: 'general', custom: false, values: {} } })).toBe('m_20261008-213045_general.json');
    expect(kifuFileName({ startedAt: '2026-01-02T03:04:05-05:00', rules: { family: 'jp', set: 'general', custom: true, values: {} } })).toBe('m_20260102-030405_custom.json');
  });
});

describe('記録内容', () => {
  it('終わった対局：日時・ホスト・プレイヤー・ルール・結果・局ごとの要約・出来事の列が入る', () => {
    expect(game.failure).toBeNull();
    const k = buildKifu(source(), 'v0.01', new Date('2026-10-08T13:00:00Z'));
    expect(k.format).toBe('momo-mahjong-kifu');
    expect(k.version).toBe(1);
    expect(k.status).toBe('finished');
    expect(k.endedAt).not.toBeNull();
    expect(k.host).toEqual({ name: 'あなた', seat: 0 });
    expect(k.players.map((p) => [p.seat, p.name, p.kind, p.wind])).toEqual([
      [0, 'あなた', 'human', 0],
      [1, 'CPU 1', 'cpu', 1],
      [2, 'CPU 2', 'cpu', 2],
      [3, 'CPU 3', 'cpu', 3],
    ]);
    expect(k.rules.set).toBe('general');
    expect(k.rules.values.length).toBe('half');
    expect(k.result?.rows).toHaveLength(4);
    expect(k.hands).toHaveLength(game.log.filter((e) => e.ev.type === 'roundStart').length);
    expect(k.hands.every((h) => h.result !== null && h.scores.length === 4)).toBe(true);
    expect(k.events).toEqual(game.log);
  });

  it('途中の対局：状態は途中・終わった日時と結果は空', () => {
    const half = game.log.slice(0, Math.floor(game.log.length / 2));
    const k = buildKifu(source(half), 'v0.01');
    expect(k.status).toBe('in-progress');
    expect(k.endedAt).toBeNull();
    expect(k.result).toBeNull();
  });
});

describe('読み直し', () => {
  it('保存した文字をそのまま読める。出来事の列が同じ', () => {
    const k = buildKifu(source(), 'v0.01');
    expect(parseKifu(JSON.stringify(k)).events).toEqual(game.log);
  });

  it('形式が違う・版が違う・出来事が当てはめられない牌譜は読まない', () => {
    const k = buildKifu(source(), 'v0.01');
    expect(() => parseKifu('{')).toThrow();
    expect(() => parseKifu(JSON.stringify({ ...k, format: 'other' }))).toThrow(/形式/);
    expect(() => parseKifu(JSON.stringify({ ...k, version: 99 }))).toThrow(/版/);
    // 通し番号を 1 つ抜く
    const broken = { ...k, events: k.events.filter((_, i) => i !== 10) };
    expect(() => parseKifu(JSON.stringify(broken))).toThrow();
  });
});

describe('再生の手の区切り', () => {
  it('局の頭は局の数だけ・手の位置は前へ進むだけ・最後は列の最後', () => {
    const { steps, handStarts } = replaySteps(game.log);
    expect(handStarts).toHaveLength(game.log.filter((e) => e.ev.type === 'roundStart').length);
    expect(steps.every((x, i) => i === 0 || x > steps[i - 1])).toBe(true);
    expect(steps[steps.length - 1]).toBe(game.log.length - 1);
    // 局の頭の局面は、配り終えて全員 13 枚・まだ誰もツモっていない
    let s = initialState();
    const at = new Set(handStarts.map((h) => steps[h]));
    game.log.forEach((e, i) => {
      s = apply(s, e);
      if (at.has(i)) expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    });
    // 返事の「見送る」の途中で止まらない（手の位置のすぐ次が見送るにならない＝返事を全部含めたところで止まる）
    expect(steps.some((i) => game.log[i + 1]?.ev.type === 'pass')).toBe(false);
  });
});
