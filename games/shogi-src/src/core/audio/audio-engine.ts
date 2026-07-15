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

// ─────────────────────────────────────────────
// v0.75: 音源ファイル (MP3) の読み込み・再生
// 合成音ではなく本物の駒音などを鳴らすため、fetch → decodeAudioData で
// AudioBuffer にキャッシュしておき、playSample() でその場再生する。
// ─────────────────────────────────────────────

const sampleBufs = new Map<string, AudioBuffer>();
const sampleFetching = new Map<string, Promise<AudioBuffer | null>>();

/** 音源ファイルの URL 一覧。追加は自由。 */
export const SAMPLE_URLS: Record<string, string> = {
  move: 'sounds/se-move.mp3',
  capture: 'sounds/se-capture.mp3',
};

/**
 * 名前で登録された音源をロードしてキャッシュする。既に読み込み済みなら即座に返す。
 * base ('/momo/games/shogi/' 等) は import.meta.env.BASE_URL から取れるが、
 * 相対パス指定にしてブラウザ解決に任せる (相対 URL は index.html の位置から解決される)。
 */
export async function loadSample(name: string): Promise<AudioBuffer | null> {
  if (sampleBufs.has(name)) return sampleBufs.get(name)!;
  const inflight = sampleFetching.get(name);
  if (inflight) return inflight;
  ensureCtx();
  if (!ctx) return null;
  const url = SAMPLE_URLS[name];
  if (!url) return null;
  const p = (async (): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const buf = await ctx!.decodeAudioData(bytes);
      sampleBufs.set(name, buf);
      return buf;
    } catch {
      return null;
    } finally {
      sampleFetching.delete(name);
    }
  })();
  sampleFetching.set(name, p);
  return p;
}

/** 登録済みの音源をその場で再生する。未ロードならこのタイミングで読み込む (少し遅れる)。 */
export function playSample(name: string): void {
  if (!ctx || !sfxGain) return;
  const buf = sampleBufs.get(name);
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(sfxGain);
    src.start();
    return;
  }
  // 未ロード → 非同期で読み込み終わったら再生
  loadSample(name).then((b) => {
    if (!b || !ctx || !sfxGain) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(sfxGain);
    src.start();
  });
}

/** すべての登録済み音源を事前ロード (音楽再生確認モーダルで「再生する」を選んだ直後などに呼ぶ) */
export function preloadAllSamples(): void {
  for (const name of Object.keys(SAMPLE_URLS)) {
    loadSample(name);
  }
}
