/**
 * MOMO Shogi の効果音を Web Audio API で「その場合成」する (音源ファイル不使用)。
 *
 * 各 SE は短命なオシレーター + ノイズを組み合わせ、簡素な ADSR エンベロープを
 * かけて sfxGain に流す。音源ファイルを持たないので、ライセンス問題ゼロ・
 * ダウンロード無し・ネットワーク不要。合成音の質は限定的だが、ゲーム進行の
 * 情報伝達 (仕様書 §1 の設計方針) には十分。
 *
 * 全 SE は「AudioContext + sfxGain が用意されている」ことを前提とする。
 * ctx 未初期化 (最初のユーザー操作前) は無音で終了する。
 */
import { getSfxSink, playSample } from './audio-engine';

function envGain(ctx: AudioContext, attackMs: number, decayMs: number, peak = 1.0): GainNode {
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + attackMs / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (attackMs + decayMs) / 1000);
  return g;
}

/** 白色ノイズバッファ (打撃系のアタック成分に混ぜる) */
function noiseBuffer(ctx: AudioContext, durMs: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * durMs / 1000);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** SE-move: 駒を打つ。v0.75 で Taira Komori shogi4.mp3 に置換 (CC-BY 4.0)。 */
export function seMove(): void {
  playSample('move');
}

/** SE-capture: 駒を取る。v0.75 で Taira Komori shogi3.mp3 に置換 (CC-BY 4.0)。 */
export function seCapture(): void {
  playSample('capture');
}

/** SE-select: 駒選択。軽いピッ (高めのシンプルなビープ)。 */
export function seSelect(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 880;
  const env = envGain(ctx, 3, 60, 0.3);
  osc.connect(env).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.09);
}

/** SE-check: 王手。少し尖った上昇音で注意喚起。 */
export function seCheck(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(660, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.12);
  const env = envGain(ctx, 5, 220, 0.35);
  osc.connect(env).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.24);
}

/** SE-button: UI 決定音 (ダイアログ Yes / 準備完了など)。柔らかいポン。 */
export function seButton(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.06);
  const env = envGain(ctx, 3, 100, 0.35);
  osc.connect(env).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.12);
}

/** 汎用: 音符を鳴らす小ヘルパー (ファンファーレ/勝敗音用) */
function playNote(ctx: AudioContext, dest: AudioNode, freq: number, startOffsetSec: number, durMs: number, peak = 0.3, wave: OscillatorType = 'triangle'): void {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  const t0 = ctx.currentTime + startOffsetSec;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

/** SE-fanfare-win: 勝利ファンファーレ (短い上昇アルペジオ)。 */
export function seFanfareWin(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5-E5-G5-C6
  notes.forEach((f, i) => playNote(ctx, dest, f, i * 0.08, 200, 0.35, 'triangle'));
}

/** SE-game-lose: 負け音 (短い下降フレーズ)。 */
export function seGameLose(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const notes = [523.25, 440.0, 349.23]; // C5-A4-F4
  notes.forEach((f, i) => playNote(ctx, dest, f, i * 0.14, 260, 0.28, 'sine'));
}

/** SE-chat-recv: チャット送受信の通知音。控えめなポップ。 */
export function seChatRecv(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.05);
  const env = envGain(ctx, 3, 70, 0.22);
  osc.connect(env).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
}

/** SE-pause: 一時停止 (時間が止まる印象の短い下降 2 音)。 */
export function sePause(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const notes = [523.25, 392.0]; // C5-G4
  notes.forEach((f, i) => playNote(ctx, dest, f, i * 0.09, 150, 0.28, 'sine'));
}

/** SE-resume: 再開 (pause の逆で短い上昇 2 音)。 */
export function seResume(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  const notes = [392.0, 523.25]; // G4-C5
  notes.forEach((f, i) => playNote(ctx, dest, f, i * 0.08, 150, 0.28, 'sine'));
}

/** SE-furigoma: 振り駒 (小さな駒がぶつかり合うようなノイズ連打)。 */
export function seFurigoma(): void {
  const sink = getSfxSink();
  if (!sink) return;
  const { ctx, gain: dest } = sink;
  // 5 個の粒を短い間隔でランダムに散らす
  for (let i = 0; i < 6; i++) {
    const t0 = ctx.currentTime + i * 0.06 + Math.random() * 0.02;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 40);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 800;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    src.connect(bp).connect(g).connect(dest);
    src.start(t0);
  }
}
