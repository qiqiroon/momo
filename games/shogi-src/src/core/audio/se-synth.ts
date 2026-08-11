/**
 * MOMO Shogi の効果音。v0.75 で SE-move / SE-capture を素材ベース化し、
 * v0.77 で残り 9 種も全て素材ベースに置換 (SE-threat のみ未実装のため保留)。
 * SAMPLE_URLS の中身は audio-engine.ts 側で定義。
 */
import { getSfxSink, playSample } from './audio-engine';

/** SE-move: 駒を打つ。v0.75 で Taira Komori shogi4.mp3 に置換 (CC-BY 4.0)。 */
export function seMove(): void {
  playSample('move');
}

/** SE-capture: 駒を取る。v0.75 で Taira Komori shogi3.mp3 に置換 (CC-BY 4.0)。 */
export function seCapture(): void {
  playSample('capture');
}

/** SE-select: 駒選択。v0.77 で Freesound LloydEvans09 「light_wood」を 75ms トリムで再生 (CC-BY)。 */
export function seSelect(): void {
  playSample('select', { trimSec: 0.075 });
}

/** SE-check: 王手。v0.77 で Freesound dland「hint」に置換 (CC0)。 */
export function seCheck(): void {
  playSample('check');
}

/** SE-button: UI 決定音。v0.77 で Taira Komori「press_enter1」に置換 (CC-BY)。 */
export function seButton(): void {
  playSample('button');
}

/**
 * SE-fanfare-win: v0.77 で 2 素材の合成に置換。
 * (1) Freesound LittleRobotSoundFactory「Achievement Orchestral (uplifting)」CC-BY
 * (2) MOMO Darts win.mp3 を 0.8 秒遅れて重ねる (ユーザー指定 V-A)
 */
export function seFanfareWin(): void {
  playSample('fanfareWin');
  playSample('fanfareWin2', { at: 0.8 });
}

/** SE-game-lose: v0.77 で TK temple_bell1 単独に置換 (CC-BY)。 */
export function seGameLose(): void {
  playSample('gameLose');
}

/** SE-chat-recv: v0.77 で Freesound deathbyfairydust「pop.wav」に置換 (CC-BY)。 */
export function seChatRecv(): void {
  playSample('chatRecv');
}

/** SE-pause: v0.77 で Freesound BaggoNotes「Button_Click1」に置換 (CC0)。 */
export function sePause(): void {
  playSample('pause');
}

/** SE-resume: v0.77 で SE-pause を 120ms 間隔で 2 度鳴らす方式に (ユーザー指定 D-3)。 */
export function seResume(): void {
  playSample('pause');
  playSample('pause', { at: 0.12 });
}

/**
 * SE-furigoma: v0.77 で素材ベースに置換 (ユーザー指定 M-2)。
 * Freesound SilverDubloons「Scrabble piece on wood」CC0 を 5 発 +
 * TK shogi4 (SE-move) を 2 発、0.4s の中にランダム配置。押すたびに異なる。
 */
export function seFurigoma(): void {
  const spanSec = 0.4;
  const times: { key: string; t: number }[] = [];
  for (let i = 0; i < 5; i++) times.push({ key: 'furiPiece', t: Math.random() * spanSec });
  for (let i = 0; i < 2; i++) times.push({ key: 'move', t: Math.random() * spanSec });
  // 先頭は 0 に固定
  times.sort((a, b) => a.t - b.t);
  if (times.length) times[0].t = 0;
  for (const h of times) playSample(h.key, { at: h.t });
}

// ─────────────────────────────────────────────
// Phase 5-13 (v1.12): 異常状態通知音 4 種 (音響仕様 §2.7)
//
// 音源テーマが仕様側で未確定 (§2.7.6) なので、素材ファイルを足さずに
// その場で合成する。あとで素材が決まったら playSample 版に差し替える前提。
//
// §2.7.3 の性格要件:
//   halt      … 急な停止を告げる中立的な「保留通知音」。エラー音にしない
//   vote-open … 注意喚起の小さなチャイム
//   continue  … 柔らかい解除音 (時計再開に自然に繋がる)
//   nogame    … 終局音より控えめで中立。「勝ちでも負けでもない終わり」
//
// 4 音とも正弦波を主体にした柔らかい音色で揃え、「異常通知グループ」として
// ひとまとまりに聞こえるようにしている (§2.7.6 の一括デザイン方針)。
// ─────────────────────────────────────────────

/**
 * 正弦波を 1 音鳴らす小道具。
 * freq → freqTo へなめらかに動かしつつ、山なりの音量変化で鳴らして切る。
 * 音声が未初期化 (ユーザー操作前) なら何もしない。
 */
function tone(opts: {
  freq: number;
  freqTo?: number;
  at?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
}): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const t0 = ctx.currentTime + (opts.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + opts.dur);
  }
  const g = ctx.createGain();
  // 立ち上がりを 12ms 取ってプツッというクリック音を避ける。
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

/**
 * SE-anomaly-halt: 観測が止まったことを告げる音。
 * 低めの 2 音を短く続けて「止まりました」を伝える。下降させることで
 * 進行が止まった感じを出しつつ、警告音にならないよう音量は控えめ。
 */
export function seAnomalyHalt(): void {
  tone({ freq: 523.25, freqTo: 493.88, dur: 0.16, gain: 0.16 });
  tone({ freq: 392.0, freqTo: 369.99, at: 0.14, dur: 0.34, gain: 0.14 });
}

/** SE-anomaly-vote-open: 投票が開いたことを知らせる小さなチャイム (halt の 300ms 後に重なる)。 */
export function seAnomalyVoteOpen(): void {
  tone({ freq: 987.77, dur: 0.22, gain: 0.09, type: 'triangle' });
  tone({ freq: 1318.51, at: 0.06, dur: 0.30, gain: 0.06, type: 'triangle' });
}

/** SE-anomaly-continue: 両者が継続で合意して時計が動き出すときの解除音 (上昇)。 */
export function seAnomalyContinue(): void {
  tone({ freq: 440.0, freqTo: 587.33, dur: 0.20, gain: 0.13 });
  tone({ freq: 880.0, at: 0.10, dur: 0.24, gain: 0.05, type: 'triangle' });
}

/**
 * SE-anomaly-nogame: 対局不成立の音。勝敗音は鳴らさない決まりなのでこれ単独で終局を表す。
 * 低い音をゆっくり減衰させ、終局音より控えめで中立な余韻にする。
 */
export function seAnomalyNogame(): void {
  tone({ freq: 329.63, freqTo: 261.63, dur: 0.9, gain: 0.13 });
  tone({ freq: 164.81, at: 0.05, dur: 1.1, gain: 0.09 });
}
