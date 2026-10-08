// 牌譜ファイル（段階4の 4）。形式の正本は作業側の docs/MOMO_Mahjong_牌譜ファイル_案_v0.01.md。
// 1 ファイル＝1 対局の JSON。出来事の列（伏せない全部）を持ち、再生は対局と同じ apply で当てはめ直して作る。
// ここは画面（DOM・React）にも保存先（ブラウザ・Drive）にも触らない。

import type { Envelope, Seat } from '../engine/events';
import { finalResult, type FinalRow } from '../engine/final';
import type { Rules } from '../engine/rules';
import { apply, initialState, type GameState } from '../engine/state';

export const KIFU_FORMAT = 'momo-mahjong-kifu';
export const KIFU_VERSION = 1;

export interface KifuPlayer {
  seat: Seat;
  name: string;
  kind: 'human' | 'cpu';
  /** 起家から見た席（0＝東 1＝南 2＝西 3＝北） */
  wind: number;
}

/** 局ごとの要約 */
export interface KifuHand {
  roundIndex: number;
  honba: number;
  /** 終わり方：tsumo・ron・exhaust・abort・tripleRon（途中なら null） */
  result: string | null;
  /** アガった人（席・役・点） */
  wins: { seat: Seat; yaku: string[]; points: number }[];
  /** 点の動き（席ごと） */
  settlement: number[] | null;
  /** 終わったあとの持ち点 */
  scores: number[];
}

export interface Kifu {
  format: typeof KIFU_FORMAT;
  version: number;
  app: { name: string; version: string };
  startedAt: string;
  endedAt: string | null;
  savedAt: string;
  status: 'finished' | 'in-progress';
  mode: 'solo' | 'online';
  host: { name: string; seat: Seat };
  players: KifuPlayer[];
  rules: { family: Rules['family']; set: string; custom: boolean; values: Record<string, string> };
  seed: string;
  result: { endReason: string; rows: FinalRow[] } | null;
  hands: KifuHand[];
  events: Envelope[];
}

/** 端末に覚えておく元（出来事の列と、列からは分からないこと） */
export interface KifuSource {
  seed: string;
  startedAt: string;
  /** 席ごとの名前と人か CPU か（一人用は保存したときの表示の言葉で入れる） */
  players: { name: string; kind: 'human' | 'cpu' }[];
  /** ルールセットの英字名（いまは一般ルールだけ＝general） */
  set: string;
  events: Envelope[];
}

/** 日時を「時差つき」の文字にする（例 2026-10-08T21:30:45+09:00） */
export function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ファイル名：m_YYYYMMDD-HHMMSS_<ルール>.json（日時は対局を始めた時刻） */
export function kifuFileName(k: Pick<Kifu, 'startedAt' | 'rules'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(k.startedAt);
  const stamp = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}` : 'unknown';
  const rule = (k.rules.custom ? 'custom' : k.rules.set).replace(/[^a-z0-9-]/gi, '') || 'custom';
  return `m_${stamp}_${rule}.json`;
}

/** 出来事の列を頭から当てはめて、局ごとの要約と最後の局面を作る */
function summarize(events: readonly Envelope[]): { hands: KifuHand[]; last: GameState } {
  let s = initialState();
  const hands: KifuHand[] = [];
  for (const e of events) {
    const before = s;
    s = apply(s, e);
    if (e.ev.type === 'roundStart') hands.push({ roundIndex: s.roundIndex, honba: s.honba, result: null, wins: [], settlement: null, scores: s.scores.slice() });
    if (before.phase !== 'ended' && s.phase === 'ended' && s.result && hands.length > 0) {
      const h = hands[hands.length - 1];
      const r = s.result;
      h.result = r.type;
      h.wins =
        r.type === 'tsumo'
          ? [{ seat: r.seat, yaku: r.score.yaku.map((y) => y.id), points: r.score.total }]
          : r.type === 'ron'
            ? r.wins.map((w) => ({ seat: w.seat, yaku: w.score.yaku.map((y) => y.id), points: w.score.total }))
            : [];
      h.settlement = s.settlement ? s.settlement.slice() : null;
      h.scores = s.scores.slice();
    }
  }
  return { hands, last: s };
}

/** 牌譜を作る（保存するとき） */
export function buildKifu(src: KifuSource, appVersion: string, now: Date = new Date()): Kifu {
  const { hands, last } = summarize(src.events);
  const rules = last.rules;
  if (!rules) throw new Error('対局が始まっていない');
  const over = last.phase === 'gameover';
  const endEv = over ? src.events.find((e) => e.ev.type === 'gameEnd') : undefined;
  return {
    format: KIFU_FORMAT,
    version: KIFU_VERSION,
    app: { name: 'MOMO Mahjong', version: appVersion },
    startedAt: src.startedAt,
    endedAt: over ? isoLocal(now) : null,
    savedAt: isoLocal(now),
    status: over ? 'finished' : 'in-progress',
    mode: 'solo',
    host: { name: src.players[0]?.name ?? '', seat: 0 },
    players: src.players.map((p, i) => ({ seat: i as Seat, name: p.name, kind: p.kind, wind: i })),
    rules: { family: rules.family, set: src.set, custom: false, values: { ...rules.values } },
    seed: src.seed,
    result: over && endEv?.ev.type === 'gameEnd' && rules.family === 'jp' ? { endReason: endEv.ev.reason, rows: finalResult(last) } : null,
    hands,
    events: src.events.slice(),
  };
}

/**
 * 牌譜ファイルの文字を読む。形式が違う・出来事の列が局面に当てはめられないなら例外（「この牌譜は読めません」）。
 * 読めたら出来事の列を返す（再生はこの列を当てはめ直す）
 */
export function parseKifu(text: string): Kifu {
  let k: Kifu;
  try {
    k = JSON.parse(text) as Kifu;
  } catch {
    throw new Error('JSON として読めない');
  }
  if (!k || k.format !== KIFU_FORMAT) throw new Error('牌譜ファイルの形式でない');
  if (k.version !== KIFU_VERSION) throw new Error(`知らない版の牌譜（${String(k.version)}）`);
  if (!Array.isArray(k.events) || k.events.length === 0) throw new Error('出来事の列が無い');
  // 当てはめられるか（通し番号・あり得ない出来事は apply が止める）
  let s = initialState();
  for (const e of k.events) s = apply(s, e);
  if (!s.rules) throw new Error('対局が始まっていない');
  return k;
}
