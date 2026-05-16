// MOMO Darts - 音響モジュール (v1.61 / 段階5-a + 5-b)
// SPEC 13章 / 14.2 / 14.5
//
// 設計:
//   - AudioContext はユーザー操作起点で初期化（SPEC 13.11、iOS Safari autoplay 対策）
//   - すべての音を1つのマスター GainNode 経由で再生（マスター音量・ミュート統合）
//   - 投擲音は pitch + volume で強弱変調（SPEC 13.5）
//   - ファイル未配置時は黙って失敗（SPEC 13.11 i/D-2/D-3 の方針に揃える）

const FILES = {
  throw:     'sounds/throw.mp3',
  hit:       'sounds/hit.mp3',
  bust:      'sounds/bust.mp3',
  ton80:     'sounds/ton80.mp3',
  nineDarts: 'sounds/nine-darts.mp3',
};

const VOLUME_LS_KEY = 'momoDartsVolume';

let _ctx = null;
let _masterGain = null;
const _buffers = new Map();
let _initStarted = false;
let _lastHitEnd = 0;  // 着弾音再生終了予定時刻（AudioContext currentTime）— SPEC 13.4 順序保護

// ---- 音量（localStorage 永続化、SPEC 14.5）----
export function getVolume() {
  const raw = localStorage.getItem(VOLUME_LS_KEY);
  if (raw === null) return 50;  // 既定 50%（SPEC 13.10 / 14.2）
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
}
export function setVolume(v) {
  v = Math.max(0, Math.min(100, v | 0));
  try { localStorage.setItem(VOLUME_LS_KEY, String(v)); } catch {}
  if (_masterGain) {
    // 線形値をそのまま gain に。0=完全ミュート
    _masterGain.gain.value = v / 100;
  }
}
export function isMuted() { return getVolume() === 0; }

// ---- 初期化（ゲーム開始ボタン押下時に呼ぶ。SPEC 13.11）----
export async function init() {
  if (_initStarted) return;
  _initStarted = true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  _ctx = new Ctx();
  _masterGain = _ctx.createGain();
  _masterGain.gain.value = getVolume() / 100;
  _masterGain.connect(_ctx.destination);
  // 全ファイル並行プリロード（失敗は個別に黙って許容）
  await Promise.allSettled(Object.entries(FILES).map(([k, p]) => _preload(k, p)));
}

// v1.63: ブラウザ/Service Worker キャッシュ対策。version-tag を付与して
// mp3 差替え時にも確実に新しいファイルが取得される
function _versionedUrl(path) {
  const v = document.getElementById('version-tag');
  return v ? `${path}?v=${encodeURIComponent(v.textContent || '')}` : path;
}
async function _preload(key, path) {
  try {
    const res = await fetch(_versionedUrl(path), { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.arrayBuffer();
    const buf = await _ctx.decodeAudioData(arr);
    _buffers.set(key, buf);
  } catch (e) {
    console.warn('[darts-sound] preload failed:', key, e.message || e);
  }
}

// ---- 内部: 再生コア ----
function _play(key, opts) {
  if (!_ctx || !_masterGain) return null;
  const buf = _buffers.get(key);
  if (!buf) return null;
  const src = _ctx.createBufferSource();
  src.buffer = buf;
  if (opts && typeof opts.playbackRate === 'number') {
    src.playbackRate.value = Math.max(0.25, Math.min(4.0, opts.playbackRate));
  }
  // 個別 gain（マスターと合成）— 音種ごとの相対音量差
  let outNode = _masterGain;
  if (opts && typeof opts.gain === 'number' && opts.gain !== 1) {
    const g = _ctx.createGain();
    g.gain.value = Math.max(0, opts.gain);
    src.connect(g);
    g.connect(_masterGain);
  } else {
    src.connect(_masterGain);
  }
  src.start();
  return src;
}

// ---- 公開関数 ----

// 投擲音: 強さ s (0..1) で pitch + volume を変調（SPEC 13.5）
//   強い投擲: 高音気味（rate up）+ 短減衰（ファイル既定）+ やや大音量
//   弱い投擲: 低音気味（rate down）+ ピッチ下降感
//   単一音源を変調で表現
export function playThrow(s) {
  if (typeof s !== 'number' || !Number.isFinite(s)) s = 0.5;
  s = Math.max(0, Math.min(1, s));
  // 投擲音再生中に新着弾音はまだ鳴っていない（順序 SPEC 13.4 投擲が先）
  const rate = 0.7 + s * 0.7;   // 0.7〜1.4
  const gain = 0.55 + s * 0.45; // 0.55〜1.00
  _play('throw', { playbackRate: rate, gain });
}

export function playHit() {
  const src = _play('hit', { gain: 1.0 });
  if (src && _ctx) {
    const dur = src.buffer ? src.buffer.duration / (src.playbackRate.value || 1) : 0.2;
    _lastHitEnd = _ctx.currentTime + dur;
  }
}

export function playBust() {
  _play('bust', { gain: 0.85 });
}

export function playTon80() {
  _play('ton80', { gain: 0.9 });
}

export function playNineDarts() {
  _play('nineDarts', { gain: 1.0 });
}

// 状態確認用
export function isReady() {
  return !!(_ctx && _masterGain);
}
export function getLoadedKeys() {
  return Array.from(_buffers.keys());
}
