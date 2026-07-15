/**
 * MOMO Shogi 音響基盤 (音響仕様 v0.5 §6)。
 *
 * - AudioContext を 1 つだけ生成し、BGM 用 / SFX 用の GainNode を通す
 * - 音量 (0〜100) は localStorage に保存
 * - suspend/resume: バックグラウンド時 (visibilitychange hidden) は AudioContext を
 *   suspend し、visible 復帰時に resume
 * - 起動時と長期停止 (1 時間以上) 復帰時に「音楽再生確認モーダル」で
 *   ユーザーに再生同意を取る (Darts 準拠・ブラウザ autoplay policy 対策)
 *
 * SE 合成コードは se-synth.ts、モーダルは MusicPrompt.tsx、
 * visibility ハンドラは visibility.ts に分離。
 */

const KEY_BGM = 'shogi.audio.bgm';
const KEY_SFX = 'shogi.audio.sfx';

const DEFAULT_BGM = 30;
const DEFAULT_SFX = 60;

let ctx: AudioContext | null = null;
let bgmGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let bgmVol = DEFAULT_BGM;
let sfxVol = DEFAULT_SFX;
let loaded = false;

function loadPersisted(): void {
  if (loaded) return;
  loaded = true;
  try {
    const b = localStorage.getItem(KEY_BGM);
    const s = localStorage.getItem(KEY_SFX);
    if (b !== null) bgmVol = Math.max(0, Math.min(100, Number(b) | 0));
    if (s !== null) sfxVol = Math.max(0, Math.min(100, Number(s) | 0));
  } catch {
    // localStorage 使えない環境 (SSR/シークレット) は無視
  }
}

function ensureCtx(): void {
  if (ctx) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  bgmGain = ctx.createGain();
  sfxGain = ctx.createGain();
  bgmGain.gain.value = bgmVol / 100;
  sfxGain.gain.value = sfxVol / 100;
  bgmGain.connect(ctx.destination);
  sfxGain.connect(ctx.destination);
}

export function getBgmVolume(): number {
  loadPersisted();
  return bgmVol;
}
export function getSfxVolume(): number {
  loadPersisted();
  return sfxVol;
}

export function setBgmVolume(v: number): void {
  loadPersisted();
  bgmVol = Math.max(0, Math.min(100, v | 0));
  try { localStorage.setItem(KEY_BGM, String(bgmVol)); } catch { /* ignore */ }
  if (bgmGain) bgmGain.gain.value = bgmVol / 100;
}
export function setSfxVolume(v: number): void {
  loadPersisted();
  sfxVol = Math.max(0, Math.min(100, v | 0));
  try { localStorage.setItem(KEY_SFX, String(sfxVol)); } catch { /* ignore */ }
  if (sfxGain) sfxGain.gain.value = sfxVol / 100;
}

/** ユーザー操作を契機に呼ぶ。以後 SFX/BGM が発音可能に。 */
export async function resumeAudio(): Promise<void> {
  loadPersisted();
  ensureCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
}

/** ページ非表示や長期停止時に呼ぶ。次回 resumeAudio で復帰。 */
export async function suspendAudio(): Promise<void> {
  if (!ctx) return;
  if (ctx.state === 'running') {
    try { await ctx.suspend(); } catch { /* ignore */ }
  }
}

export function isAudioRunning(): boolean {
  return !!ctx && ctx.state === 'running';
}

/** SE 合成側から利用: SFX GainNode に接続して発音する。ctx 未初期化なら null。 */
export function getSfxSink(): { ctx: AudioContext; gain: GainNode } | null {
  if (!ctx || !sfxGain) return null;
  return { ctx, gain: sfxGain };
}
/** BGM 再生側から利用: BGM GainNode に接続する。 */
export function getBgmSink(): { ctx: AudioContext; gain: GainNode } | null {
  if (!ctx || !bgmGain) return null;
  return { ctx, gain: bgmGain };
}
