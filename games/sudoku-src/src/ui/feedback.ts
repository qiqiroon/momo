/**
 * 効果音と触覚（第3分冊 11.7 / 15.10 / 設計書 4.14）
 *
 * 音と触覚は**視覚表現を補助するもの**であり、これらが無くても操作と判断が成立する。
 * 本モジュールは「契機 → 鳴らす・震わせる」の対応だけを持ち、
 * **音源の実現方式（合成音か音声ファイルか）は内側に隠す**（11.7.5 / U-18）。
 * 呼び出し側は方式を知らない。
 *
 * 打ち切りの判断もここで行う（11.7.1 / 11.7.4）。誤入力は「確定値の入力」と
 * 「誤りの検出」の2つの契機を連続して起こすが、呼び出し側は `fire` を2回呼ぶだけでよく、
 * **後の合図が前の合図を音・触覚とも打ち切って上書きする。**
 */

import { diagnostics } from '../data/diagnostics';
import type { Settings } from '../data/types';
import {
  HAPTIC_MS_MEDIUM,
  HAPTIC_MS_STRONG,
  HAPTIC_MS_WEAK,
  PREVIEW_CUE,
  SFX_BASE_PATH,
} from './config';

/** 11.7.1 の契機 */
export type FeedbackCue =
  | 'VALUE_COMMITTED' // 確定値の入力
  | 'MISTAKE_DETECTED' // 誤りの検出
  | 'FAILED' // 失敗の到達
  | 'COMPLETED' // 完成の到達
  | 'HINT_SHOWN'; // ヒントの提示

export interface FeedbackController {
  /** 契機に対応する音と触覚を発生させる。非対応環境でも例外を投げない */
  fire(cue: FeedbackCue): void;
  /**
   * 音源を先に読み込ませる（C-179）。
   *
   * **完成音は1局に1度しか鳴らないため、鳴らす瞬間が毎回「初めての読み込み」になる。**
   * 入力音は何度も鳴って温まっているのに、完成音だけ毎回まっさらな段取りを踏むので、
   * ここだけ遅れが乗る。**音を出してよいと分かった時点で、先に取りに行っておく。**
   */
  warm(): void;
  /** 音量調整時の確認再生（2.10）。音が切ってあるときは何もしない */
  preview(): void;
  /** 設定変更の反映 */
  applySettings(settings: Settings): void;
  /** タブ非可視への遷移時に再生中の音を打ち切る（11.7.4 / 15.8） */
  suspend(): void;
}

// ---------------------------------------------------------------- 音源（方式ごとの中身）

/** 音源。方式が変わってもこの窓口だけは変わらない（U-18 の決着に依らない） */
export interface SoundSource {
  play(cue: FeedbackCue, volume: number): void;
  /** 再生中の音を打ち切る */
  stop(): void;
  /**
   * 指定された契機の音を、鳴らす前に用意しておく（C-179）。
   * **その場で音を出す方式（合成音）には用が無い**ので、実装しなくてよい。
   */
  warm?(cues: readonly FeedbackCue[]): void;
}

/** 触覚の強さ（11.7.2）。契機ごとに長さの異なる単発振動である */
const HAPTIC_MS: Record<FeedbackCue, number> = {
  VALUE_COMMITTED: HAPTIC_MS_WEAK,
  HINT_SHOWN: HAPTIC_MS_WEAK,
  COMPLETED: HAPTIC_MS_MEDIUM,
  MISTAKE_DETECTED: HAPTIC_MS_STRONG,
  FAILED: HAPTIC_MS_STRONG,
};

/** 合成音の指定。**音の並び・間・包絡**だけで表す。契機ごとの分岐はここに集約する */
interface ToneSpec {
  /** 順に鳴らす音。周波数（Hz）と長さ（秒） */
  segments: readonly { freq: number; duration: number }[];
  /** 音と音のあいだの無音（秒）。0 なら続けて鳴る */
  gap: number;
  /** 波形。誤りだけ倍音の多い波形にして聞き分けられるようにする（11.7.3） */
  wave: OscillatorType;
  /** 契機ごとの相対音量。**誤りは他より明確に大きい**（11.7.3） */
  gain: number;
  /**
   * 鳴っているあいだ音量を保つか。
   * 真＝ブザー（最後まで鳴って切れる）、偽＝弾いた音（すぐ減衰する）。
   */
  sustain: boolean;
  /**
   * 断続（ビリビリ）。音量を毎秒 `rate` 回だけ落として震わせる。
   * `depth` は落とす深さで、1 なら完全に無音まで落ちる。
   * 指定が無ければ震えない。
   */
  am?: { rate: number; depth: number };
}

/**
 * ブザーの音の高さと震え（U-18 の決着・2026-08-07 に実際に聴いて決めた値）
 *
 * **誤りと失敗は同じ音色**で、鳴らし方だけが違う。クイズ番組の不正解の音を狙っている。
 * 断続を毎秒83回にすると、震えとして聞き取れる限界の手前で、いちばんギザギザに響く。
 */
const BUZZ_HZ = 166;
const BUZZ_AM = { rate: 83, depth: 1 } as const;

/**
 * 契機ごとの合成音（11.7.1）
 *
 * **誤りと失敗はクイズ番組の不正解のようなブザー、入力とヒントは短く澄んだ音、
 * 完成は上向きの和音**とする。目と耳の両方で誤りに気づけるようにするためである（11.7.3）。
 * 誤りと失敗は**同じ音色**で、失敗のほうが「ぶぶぶぶーっ」と繰り返す点だけが違う。
 */
const TONES: Record<FeedbackCue, ToneSpec> = {
  VALUE_COMMITTED: {
    segments: [{ freq: 880, duration: 0.05 }],
    gap: 0,
    wave: 'triangle',
    gain: 0.35,
    sustain: false,
  },
  HINT_SHOWN: {
    segments: [
      { freq: 660, duration: 0.06 },
      { freq: 990, duration: 0.06 },
    ],
    gap: 0,
    wave: 'sine',
    gain: 0.3,
    sustain: false,
  },
  COMPLETED: {
    segments: [523, 659, 784, 1047].map((freq) => ({ freq, duration: 0.12 })),
    gap: 0,
    wave: 'triangle',
    gain: 0.4,
    sustain: false,
  },
  // 「ぶーっ」＝短いブザー1発。**166Hz を毎秒83回で断続させる**（U-18 の決着）
  MISTAKE_DETECTED: {
    segments: [{ freq: BUZZ_HZ, duration: 0.26 }],
    gap: 0,
    wave: 'sawtooth',
    gain: 0.8,
    sustain: true,
    am: BUZZ_AM,
  },
  // 「ぶぶぶぶーっ」＝同じ音色で、短いのを3つ刻んでから長く伸ばす
  FAILED: {
    segments: [
      { freq: BUZZ_HZ, duration: 0.08 },
      { freq: BUZZ_HZ, duration: 0.08 },
      { freq: BUZZ_HZ, duration: 0.08 },
      { freq: BUZZ_HZ, duration: 0.5 },
    ],
    gap: 0.06,
    wave: 'sawtooth',
    gain: 0.8,
    sustain: true,
    am: BUZZ_AM,
  },
};

/**
 * 合成音（Web Audio API）
 *
 * **音声ファイルを持たない＝配信容量が増えない。** 音量も長さもその場で作る。
 * 音の文脈（AudioContext）は最初の再生まで作らない。ブラウザは利用者の操作なしに
 * 音を鳴らすことを許さないため、起動直後に作ると停止状態のまま残る（11.7.4）。
 */
export function createSynthSource(): SoundSource {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  /** 鳴らしている音の源と、その音量つまみ。打ち切りのために持つ */
  let playing: { osc: OscillatorNode; gain: GainNode | null }[] = [];

  const ensure = (): boolean => {
    if (context !== null) return true;
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (Ctor === undefined) return false;
    context = new Ctor();
    master = context.createGain();
    master.connect(context.destination);
    return true;
  };

  const stop = (): void => {
    for (const node of playing) {
      try {
        if (node.gain !== null) {
          node.gain.gain.cancelScheduledValues(0);
          node.gain.gain.value = 0;
        }
        node.osc.stop();
      } catch {
        // 既に止まっている場合は何もしない
      }
    }
    playing = [];
  };

  return {
    play(cue, volume) {
      if (!ensure() || context === null || master === null) return;
      // 一度停止していた場合は鳴らす直前に起こす（iOS で頻繁に起きる）
      if (context.state === 'suspended') void context.resume();

      stop();
      const spec = TONES[cue];
      const level = volume * spec.gain;
      let at = context.currentTime;

      for (const segment of spec.segments) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = spec.wave;
        osc.frequency.value = segment.freq;

        // 立ち上がりと切れ際は必ず作る。矩形に切ると「プツッ」という雑音が乗る
        const edge = 0.008;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(level, at + edge);
        if (spec.sustain) {
          // ブザーは最後まで鳴って切れる
          gain.gain.setValueAtTime(level, at + Math.max(edge, segment.duration - edge));
          gain.gain.linearRampToValueAtTime(0, at + segment.duration);
        } else {
          gain.gain.exponentialRampToValueAtTime(0.0001, at + segment.duration);
        }

        osc.connect(gain);

        /**
         * 断続（ビリビリ）。**音量つまみそのものを、別の矩形波で揺らして作る。**
         * 中心を `1 − 深さ/2`、振れ幅を `深さ/2` にすると、深さ1で 0〜1 を往復する
         * ＝毎回きっちり無音まで落ちる。
         */
        if (spec.am !== undefined) {
          const chopper = context.createGain();
          chopper.gain.value = 1 - spec.am.depth / 2;

          const lfo = context.createOscillator();
          lfo.type = 'square';
          lfo.frequency.value = spec.am.rate;

          const amount = context.createGain();
          amount.gain.value = spec.am.depth / 2;
          lfo.connect(amount);
          amount.connect(chopper.gain);
          lfo.start(at);
          lfo.stop(at + segment.duration);
          // 震えを作る側は音量つまみを持たない。止めるのは発振を止めるだけでよい
          playing.push({ osc: lfo, gain: null });

          gain.connect(chopper);
          chopper.connect(master);
        } else {
          gain.connect(master);
        }

        osc.start(at);
        osc.stop(at + segment.duration);
        playing.push({ osc, gain });
        at += segment.duration + spec.gap;
      }
    },
    stop,
  };
}

/**
 * 音声ファイルの再生（U-18 の決着＝**こちらを採用**）
 *
 * 契機ごとに短い音声ファイルを1本ずつ持ち、`Audio` で鳴らす。
 * **合成音と違って配信容量を使う**代わりに、作り込んだ音をそのまま使える。
 * 差し替えは `base` の下にファイルを置くだけで済む。
 *
 * 形式は **MP3**（案内書 §6「記録する前に必ず軽くする」）。無圧縮の 67.3KB を 13.9KB にした。
 * MP3 は先頭に無音が入る（実測 17.5〜50ms）が、いちばん頻繁に鳴る入力音でも
 * 人が遅れとして感じ始める手前である。
 */
export function createSampleSource(base: string): SoundSource {
  const cache = new Map<FeedbackCue, HTMLAudioElement>();
  let current: HTMLAudioElement | null = null;

  const stop = (): void => {
    if (current === null) return;
    current.pause();
    current.currentTime = 0;
    current = null;
  };

  /** 契機ぶんの音を1つ用意する。**既にあるものは作り直さない** */
  const obtain = (cue: FeedbackCue): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null;
    let audio = cache.get(cue);
    if (audio === undefined) {
      audio = new Audio(`${base}${cue.toLowerCase()}.mp3`);
      // 先に丸ごと取りに行かせる。既定では鳴らす直前まで取りに行かない環境がある
      audio.preload = 'auto';
      cache.set(cue, audio);
    }
    return audio;
  };

  return {
    warm(cues) {
      for (const cue of cues) {
        const audio = obtain(cue);
        if (audio === null) continue;
        // **用意が終わった時点も残す**（C-179）。完成までに間に合っていたかが読める
        audio.addEventListener(
          'canplaythrough',
          () => diagnostics.recordEvent('音の用意ができた', cue),
          { once: true },
        );
        // 読み込みの開始を明示する。`preload` を無視する環境への保険でもある
        try {
          audio.load();
        } catch {
          // 読み込めない環境では何もしないだけとし、分岐による機能差は設けない
        }
      }
      diagnostics.recordEvent('音の先読みを始めた', `${cues.length}件`);
    },
    play(cue, volume) {
      if (typeof Audio === 'undefined') return;
      stop();
      const audio = obtain(cue);
      if (audio === null) return;
      // **鳴らす要求と、実際に鳴り始めた時刻を残す**（C-179）。遅れは引き算で読む
      diagnostics.recordEvent('音の要求', `${cue} 読込状態${audio.readyState}`);
      audio.addEventListener('playing', () => diagnostics.recordEvent('音が鳴り始めた', cue), {
        once: true,
      });
      audio.volume = Math.min(1, Math.max(0, volume));
      audio.currentTime = 0;
      try {
        // **`play()` が約束を返さない環境がある**（古い Safari。検査環境も同じ）。
        // 返り値をそのまま鎖につなぐと、そこで落ちて音以外の処理まで止まる
        const started: unknown = audio.play();
        if (started instanceof Promise) {
          // 利用者の操作より前に呼ばれた場合は鳴らさないだけとする（11.7.4）
          started.catch(() => {});
        }
      } catch {
        // 再生できない環境では何もしないだけとし、分岐による機能差は設けない
      }
      current = audio;
    },
    stop,
  };
}

/**
 * 契機ごとに音源を使い分ける（U-18 の決着）
 *
 * 全部を1つの方式に揃える必要はない。**どの契機をどちらで鳴らすかの表を1つ持つ**だけで、
 * 呼び出し側からは1つの音源に見える。花札も同じく素材と合成音を混ぜている。
 */
export function createMixedSource(
  synthCues: readonly FeedbackCue[],
  synth: SoundSource,
  samples: SoundSource,
): SoundSource {
  const useSynth = new Set(synthCues);
  return {
    play(cue, volume) {
      // 打ち切りは方式をまたいで効かせる。片方だけ止めると2つ重なって鳴る
      synth.stop();
      samples.stop();
      (useSynth.has(cue) ? synth : samples).play(cue, volume);
    },
    stop() {
      synth.stop();
      samples.stop();
    },
    warm(cues) {
      // **合成音で鳴らす契機は渡さない。** その場で作るので、用意しておく意味が無い
      const forSamples = cues.filter((cue) => !useSynth.has(cue));
      synth.warm?.(cues.filter((cue) => useSynth.has(cue)));
      samples.warm?.(forSamples);
    },
  };
}

// ---------------------------------------------------------------- 取りまとめ

/** 触覚が使える環境か。使えなければ**何もしないだけ**とし、機能差は設けない（11.7.2） */
function vibrate(ms: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // 新しい振動は直前の振動を打ち切る（Vibration API の規定そのもの・11.7.4）
  navigator.vibrate(ms);
}

/**
 * タブが見えているか（15.8）
 *
 * **状態として持たない。** 持つと「見えるようになった」を知らせる窓口が要り、
 * 15.10 の契約に無いものを増やすことになる。発火のたびに見れば足りる。
 */
function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * 合成音で鳴らす契機（U-18 の決着・2026-08-07）
 *
 * **ブザーの2つだけ合成音**とする。実際に聴き比べて決めた。
 * 単純な波形の断続なので音声ファイルにしても得るものが無く、**53KB を配信せずに済む。**
 * 残りの3つは、作り込んだ音のほうが良かったので音声ファイルを使う。
 * 花札も同じく素材と合成音を混ぜている。
 */
const SYNTH_CUES: readonly FeedbackCue[] = ['MISTAKE_DETECTED', 'FAILED'];

/** 既定の音源（U-18 の決着）。ここを書き換えれば方式を変えられる */
export function defaultSource(): SoundSource {
  return createMixedSource(SYNTH_CUES, createSynthSource(), createSampleSource(SFX_BASE_PATH));
}

/** 用意しておく契機。**すべて挙げる**（契機が増えたらここも増える） */
const ALL_CUES: readonly FeedbackCue[] = [
  'VALUE_COMMITTED',
  'MISTAKE_DETECTED',
  'FAILED',
  'COMPLETED',
  'HINT_SHOWN',
];

export function create(source: SoundSource = defaultSource()): FeedbackController {
  let soundEnabled = true;
  let soundVolume = 1;
  let hapticEnabled = true;
  let warmed = false;

  const fire = (cue: FeedbackCue): void => {
    // タブが見えていないあいだは音も触覚も出さない（11.7.4）
    if (!visible()) return;
    if (soundEnabled) source.play(cue, soundVolume);
    if (hapticEnabled) vibrate(HAPTIC_MS[cue]);
  };

  /** **一度きり**。読み込みは1回で足り、繰り返すだけ無駄である */
  const warm = (): void => {
    if (warmed) return;
    warmed = true;
    source.warm?.(ALL_CUES);
  };

  return {
    fire,
    warm,
    preview() {
      if (!soundEnabled) return;
      source.play(PREVIEW_CUE, soundVolume);
    },
    applySettings(settings) {
      soundEnabled = settings.soundEnabled;
      soundVolume = settings.soundVolume;
      hapticEnabled = settings.hapticEnabled;
      if (!soundEnabled) source.stop();
    },
    suspend() {
      source.stop();
      vibrate(0);
    },
  };
}
