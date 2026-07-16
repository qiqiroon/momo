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
  // v0.77 追加 (合成音から素材ベースへ)
  select: 'sounds/se-select.mp3',
  check: 'sounds/se-check.mp3',
  button: 'sounds/se-button.mp3',
  pause: 'sounds/se-pause.mp3',
  chatRecv: 'sounds/se-chat-recv.mp3',
  furiPiece: 'sounds/se-furigoma-piece.mp3',
  fanfareWin: 'sounds/se-fanfare-win.mp3',
  fanfareWin2: 'sounds/se-fanfare-win-2.mp3',
  gameLose: 'sounds/se-game-lose.mp3',
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

/**
 * 登録済みの音源をその場で再生する。未ロードならこのタイミングで読み込む (少し遅れる)。
 * opts.at: AudioContext currentTime に対する相対秒 (デフォルト 0 = 即時)
 * opts.trimSec: 指定秒でフェードアウト+停止 (SE-select の 75ms 切りなど)
 */
export function playSample(name: string, opts?: { at?: number; trimSec?: number }): void {
  if (!ctx || !sfxGain) return;
  const buf = sampleBufs.get(name);
  const at = opts?.at ?? 0;
  const trimSec = opts?.trimSec;
  const doPlay = (b: AudioBuffer) => {
    if (!ctx || !sfxGain) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const startAt = ctx.currentTime + at;
    if (trimSec && trimSec > 0) {
      // trim: 途中で自然にフェードアウトして止める
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, startAt);
      const fadeStart = startAt + Math.max(0, trimSec - 0.02);
      g.gain.setValueAtTime(1.0, fadeStart);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + trimSec);
      src.connect(g).connect(sfxGain);
      src.start(startAt, 0, trimSec);
      src.stop(startAt + trimSec + 0.03);
    } else {
      src.connect(sfxGain);
      src.start(startAt);
    }
  };
  if (buf) { doPlay(buf); return; }
  // 未ロード → 非同期で読み込み終わったら再生
  loadSample(name).then((b) => { if (b) doPlay(b); });
}

/** すべての登録済み音源を事前ロード (音楽再生確認モーダルで「再生する」を選んだ直後などに呼ぶ) */
export function preloadAllSamples(): void {
  for (const name of Object.keys(SAMPLE_URLS)) {
    loadSample(name);
  }
}

// ─────────────────────────────────────────────
// v0.77: BGM 再生機構
// - lobby / game の 2 プール、それぞれ複数曲からランダム
// - ループ再生
// - プールを切り替えると前の曲は停止して新プールから 1 曲選ぶ
// - 同じプール中でも各画面遷移で「もう 1 曲」を選び直したくはないので、
//   現在のプールと同じなら何もしない
// ─────────────────────────────────────────────

export const BGM_POOLS: Record<'lobby' | 'game', string[]> = {
  lobby: ['sounds/bgm-lobby-1.mp3', 'sounds/bgm-lobby-2.mp3'],
  game: ['sounds/bgm-game-1.mp3', 'sounds/bgm-game-2.mp3', 'sounds/bgm-game-3.mp3'],
};

const bgmBufs = new Map<string, AudioBuffer>();
const bgmFetching = new Map<string, Promise<AudioBuffer | null>>();
let currentBgmSource: AudioBufferSourceNode | null = null;
let currentBgmPool: 'lobby' | 'game' | null = null;

async function loadBgm(url: string): Promise<AudioBuffer | null> {
  if (bgmBufs.has(url)) return bgmBufs.get(url)!;
  const inflight = bgmFetching.get(url);
  if (inflight) return inflight;
  ensureCtx();
  if (!ctx) return null;
  const p = (async (): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const buf = await ctx!.decodeAudioData(bytes);
      bgmBufs.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      bgmFetching.delete(url);
    }
  })();
  bgmFetching.set(url, p);
  return p;
}

/** 現在の BGM を停止 (次に playRandomBgm するまで無音) */
export function stopBgm(): void {
  if (currentBgmSource) {
    try { currentBgmSource.stop(); } catch { /* ignore */ }
    currentBgmSource = null;
  }
  currentBgmPool = null;
}

/**
 * 指定プールからランダムに 1 曲選んでループ再生する。
 * 既に同じプールが鳴っていれば何もしない (画面遷移で曲が切れないように)。
 */
export async function playRandomBgm(pool: 'lobby' | 'game'): Promise<void> {
  if (currentBgmPool === pool && currentBgmSource) return;
  ensureCtx();
  if (!ctx || !bgmGain) return;
  const urls = BGM_POOLS[pool];
  if (!urls || urls.length === 0) return;
  const url = urls[Math.floor(Math.random() * urls.length)];
  const buf = await loadBgm(url);
  if (!buf || !ctx || !bgmGain) return;
  // 途中で別プールに切り替わっていたら諦める
  if (currentBgmPool && currentBgmPool !== pool) return;
  stopBgm();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(bgmGain);
  src.start();
  currentBgmSource = src;
  currentBgmPool = pool;
}
