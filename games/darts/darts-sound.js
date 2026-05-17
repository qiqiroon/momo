// MOMO Darts - 音響モジュール (v1.61 / 段階5-a + 5-b)
// SPEC 13章 / 14.2 / 14.5
//
// 設計:
//   - AudioContext はユーザー操作起点で初期化（SPEC 13.11、iOS Safari autoplay 対策）
//   - すべての音を1つのマスター GainNode 経由で再生（マスター音量・ミュート統合）
//   - 投擲音は pitch + volume で強弱変調（SPEC 13.5）
//   - ファイル未配置時は黙って失敗（SPEC 13.11 i/D-2/D-3 の方針に揃える）

// v1.65: hit は v1.64 で Web Audio API 合成に切替したため mp3 不要
// v1.66 (5-c): miss を追加（効果音ラボ boyon1.mp3、SPEC 13.6 的外音「ボヨン」）
// v1.73 (5-c): turn を追加（効果音ラボ decision34.mp3、SPEC 13.8 ターン切替音）
// v1.75 (5-c): win/lose 追加（効果音ラボ levelup1/curse-melody1）、ton80 を jean1 に差替え
// v1.76 (5-d): 「ton80 より短いトン素材が見つからない」を受けて全体を 1 段繰り上げ:
//              win=cheer1 / ton80=levelup1(旧win) / ton=jean1(旧ton80)。SPEC 13.3 P2 トン新規発火
// v1.77 (5-d): chat を追加（効果音ラボ decision52.mp3「ポン」、SPEC 13.8 チャット受信音）
const FILES = {
  throw:     'sounds/throw.mp3',
  miss:      'sounds/miss.mp3',
  turn:      'sounds/turn.mp3',
  chat:      'sounds/chat.mp3',
  bust:      'sounds/bust.mp3',
  ton:       'sounds/ton.mp3',
  ton80:     'sounds/ton80.mp3',
  nineDarts: 'sounds/nine-darts.mp3',
  win:       'sounds/win.mp3',
  lose:      'sounds/lose.mp3',
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

// v1.64: hit 音をフリー素材から合成音に切替（ユーザー要望、フリー素材3種すべて不採用）
//   - ノイズ短バースト（30ms, bandpass 2kHz Q=2）= 板に当たる「コツ」のアタック
//   - sine の thud（180Hz → 60Hz の slide, 80ms 指数減衰）= 「ン」の余韻
//   - mp3 のロード不要、即時生成・低レイテンシ
//   - 旧 fetch ベース hit ({arrow-pierce / hyoushigi / blow3}.mp3) は退避保存だけ残置
export function playHit() {
  if (!_ctx || !_masterGain) return;
  const now = _ctx.currentTime;

  // === 1. ノイズバースト（短いアタック） ===
  const noiseDuration = 0.030;
  const noiseBuf = _ctx.createBuffer(1, Math.ceil(_ctx.sampleRate * noiseDuration), _ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    // 後半に向けて減衰するホワイトノイズ
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  }
  const noise = _ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseFilter = _ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2000;
  noiseFilter.Q.value = 2;
  const noiseGain = _ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(_masterGain);
  noise.start(now);

  // === 2. 低音 thud（板の余韻） ===
  const thud = _ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(180, now);
  thud.frequency.exponentialRampToValueAtTime(60, now + 0.08);
  const thudGain = _ctx.createGain();
  thudGain.gain.setValueAtTime(0.45, now);
  thudGain.gain.exponentialRampToValueAtTime(0.01, now + 0.10);
  thud.connect(thudGain);
  thudGain.connect(_masterGain);
  thud.start(now);
  thud.stop(now + 0.12);

  _lastHitEnd = now + 0.12;
}

// v1.66 (5-c): 的外音（SPEC 13.6 床/壁/視界外）
//   命中の hit と対になる。命中音と被らない程度の音量
export function playMiss() {
  _play('miss', { gain: 0.75 });
}

// v1.69/v1.70 (5-c): 振動音（SPEC 13.7、ユーザー要望「リアルな乾いた速いカサカサ音」）
//   - SPEC は「びよーん」コミカル系だが、ユーザー要望でリアル路線
//   - ホワイトノイズ → バンドパス（中心 1.5kHz, Q=1.2）で低めの乾いた音域
//   - 15Hz の AM 変調で速いビビり感
//   - 全体 0.3 秒（短く）、線形減衰
//   - v1.70: 強さに応じて発火。最適範囲上限 (0.56) 以下は無音、超過量に比例して音量増加
//   - strength: 投擲強さ 0..1
export function playVibrate(strength) {
  if (!_ctx || !_masterGain) return;
  if (typeof strength !== 'number' || !Number.isFinite(strength)) return;
  // 最適範囲上限 = 0.56（強さバー 44%〜56%、SPEC 5.2）。これ以下は鳴らさない
  const VIBRATE_THRESHOLD = 0.56;
  if (strength <= VIBRATE_THRESHOLD) return;
  const intensity = Math.min(1, (strength - VIBRATE_THRESHOLD) / (1 - VIBRATE_THRESHOLD));

  const now = _ctx.currentTime;
  const duration = 0.3;       // 振動全体の長さ（短く）
  const sr = _ctx.sampleRate;
  const len = Math.ceil(sr * duration);

  // === ホワイトノイズ + AM 変調（15Hz）をバッファに焼き込む ===
  const buf = _ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const amHz = 15;            // 高速ビビり
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // AM: 0..1 の正弦（15Hz）。深さ 0.6 → 振幅は 0.4..1.0 で揺れる
    const am = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * amHz * t));
    // 全体エンベロープ: 最初 30ms で立ち上がり、その後線形減衰
    const env = (t < 0.03) ? (t / 0.03) : Math.max(0, 1 - (t - 0.03) / (duration - 0.03));
    data[i] = (Math.random() * 2 - 1) * am * env;
  }

  const src = _ctx.createBufferSource();
  src.buffer = buf;
  const bp = _ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;  // 低めの帯域
  bp.Q.value = 1.2;
  const g = _ctx.createGain();
  // 小さい音、さらに強さ超過量に比例
  g.gain.value = 0.20 * intensity;
  src.connect(bp);
  bp.connect(g);
  g.connect(_masterGain);
  src.start(now);
}

// v1.71〜v1.74 (5-c): ターン切替音（SPEC 13.8、自分のターン開始時のみ）
//   - 効果音ラボ button/decision34.mp3「ポン。柔らかい音」
//   - v1.71/v1.72 合成路線、v1.73 stupid4.mp3 すべて不採用を経て確定
//   - mp3 は idle 時音量に揃えるため gain 0.85
export function playTurnStart() {
  _play('turn', { gain: 0.85 });
}

// v1.77 (5-d): チャット受信音（SPEC 13.8、相手のチャット表示時のみ、自分送信時は鳴らさない）
//   - 効果音ラボ button/decision52.mp3「ポン」soft pop
export function playChatReceive() {
  _play('chat', { gain: 0.75 });
}

export function playBust() {
  _play('bust', { gain: 0.85 });
}

export function playTon80() {
  _play('ton80', { gain: 0.9 });
}

// v1.76 (5-d): トン軽ジングル（SPEC 13.3 P2、ターン合計 100点超 / 180未満）
//   ton80 より軽め
export function playTon() {
  _play('ton', { gain: 0.8 });
}

export function playNineDarts() {
  _play('nineDarts', { gain: 1.0 });
}

// v1.75 (5-c): 勝利/敗北ジングル（SPEC 13.9）
//   勝利=派手（levelup1）/ 敗北=控えめ（curse-melody1）。素材の特性で派手/控えめを表現
export function playWinJingle() {
  _play('win', { gain: 1.0 });
}
export function playLoseJingle() {
  _play('lose', { gain: 0.85 });
}

// v1.75 (5-c): 音の長さ（秒）。順次再生のタイミング計算用
//   未ロード時は 0 を返す（呼び出し側でフォールバック値）
export function getDuration(key) {
  const buf = _buffers.get(key);
  return buf ? buf.duration : 0;
}

// 状態確認用
export function isReady() {
  return !!(_ctx && _masterGain);
}
export function getLoadedKeys() {
  return Array.from(_buffers.keys());
}
