/**
 * ★v2.05: 秒読みの読み上げ（人の声）。
 *
 * 2026-10-04 利用者の指示＝**読み上げるのは 30秒・20秒・10秒・5秒・4・3・2・1・時間切れ**。
 * 声は**言語ごと**に用意する＝Windows の音声合成で作った日本語 (Ayumi)・英語 (Zira)・
 * 中国語 (Yaoyao)（利用者が選んだ声・設定のクレジットに 1 行書く）。猫語は日本語の声。
 *
 * **だれに聞かせるか**（同じ指示）
 * - 残りの秒数は、指している人・相手・観戦者の**全員**に読み上げる
 * - **「時間切れ」は指している人の端末でだけ**読み上げる（相手・観戦者には言わない）
 *
 * **どの残り時間を数えるか**
 * - 秒読み方式＝**秒読みに入ってからの残り**（本時間の間は読まない）
 * - 切れ負け・加算方式＝**本時間の残り**
 * - 時間制限なし＝読まない
 * 区切りの秒数を**上から下へ越えたとき**に 1 回だけ言う。手番が替わる・秒読みが
 * 戻る（指して満タンに戻る）と数え直す。だから 30 秒の秒読みでは指すたびに
 * 「30秒」とは言わず、20秒から言う（始まった時点で 30 秒ちょうどで、越えていないため）。
 */

import type { ClockState, TimeControl } from '../engine/time-control';
import { SAMPLE_URLS, loadSample, playSample } from './audio-engine';

/** 読み上げる区切り（秒・大きい順）。 */
export const CALLOUT_SECONDS = [30, 20, 10, 5, 4, 3, 2, 1] as const;

export type VoiceLine = 'sec30' | 'sec20' | 'sec10' | 'sec5' | 'n4' | 'n3' | 'n2' | 'n1' | 'timeup';

const LINE_OF: Record<(typeof CALLOUT_SECONDS)[number], VoiceLine> = {
  30: 'sec30', 20: 'sec20', 10: 'sec10', 5: 'sec5', 4: 'n4', 3: 'n3', 2: 'n2', 1: 'n1',
};

/** 声を用意できている言語。ここに無い言語は日本語の声で鳴らす。 */
export const VOICE_LANGS = ['ja', 'en', 'zh'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

export const VOICE_LINES: readonly VoiceLine[] = ['sec30', 'sec20', 'sec10', 'sec5', 'n4', 'n3', 'n2', 'n1', 'timeup'];

/**
 * 声の置き場（MOMO 共通素材 `assets/voice/byoyomi/<言語>/`・assets/readme.md）。
 * 言語を足すときは、そのフォルダに同じ名前の 9 ファイルを置いて VOICE_LANGS に 1 つ足す。
 */
for (const lang of VOICE_LANGS) {
  for (const line of VOICE_LINES) {
    SAMPLE_URLS[`voice-${lang}-${line}`] = `../../assets/voice/byoyomi/${lang}/${line}.mp3`;
  }
}

/** 画面の言語 → 鳴らす声の言語（声の無い言語＝猫語などは日本語）。 */
export function voiceLangFor(locale: string): VoiceLang {
  return (VOICE_LANGS as readonly string[]).includes(locale) ? (locale as VoiceLang) : 'ja';
}

/** 効果音の登録名（audio-engine の SAMPLE_URLS と対）。 */
export function voiceSampleName(lang: VoiceLang, line: VoiceLine): string {
  return `voice-${lang}-${line}`;
}

/**
 * 読み上げの対象になる残り時間（ms）。読まない状態なら null。
 */
export function countdownMs(tc: TimeControl, clock: ClockState): number | null {
  if (tc.mode === 'no_limit') return null;
  if (tc.mode === 'byoyomi') return clock.inByoyomi ? clock.byoyomiMs : null;
  return clock.mainMs;
}

/**
 * 残りが prev → now と減ったときに言う声。区切りを越えていなければ null。
 * 一度に 2 つ以上越えた（画面が裏にあって刻みが飛んだ等）ときは**いちばん小さい区切りだけ**を言う
 * （古い数字を後から言うと、残りと食い違う）。prev が null（数え始め）なら何も言わない。
 */
export function calloutFor(prev: number | null, now: number | null): VoiceLine | null {
  if (prev === null || now === null) return null;
  if (now >= prev) return null;
  let hit: VoiceLine | null = null;
  for (const s of CALLOUT_SECONDS) {
    const t = s * 1000;
    if (prev > t && now <= t) hit = LINE_OF[s];
  }
  return hit;
}

/**
 * その言語の声を先に読み込んでおく（音響 §6「秒読み音は対局開始時にプリロード」）。
 * 読み込まずに鳴らすと、初めての声だけ読み込みのぶん遅れる（実測 0.3 秒前後）。
 */
export function preloadVoice(locale: string): void {
  const lang = voiceLangFor(locale);
  for (const line of VOICE_LINES) void loadSample(voiceSampleName(lang, line));
}

/** 声を鳴らす。秒読み音の設定・効果音の音量とミュートに従う（呼び出し側で設定を見る）。 */
export function playVoice(locale: string, line: VoiceLine): void {
  playSample(voiceSampleName(voiceLangFor(locale), line));
}
