// MOMO Darts - 3D空間 + 的描画モジュール（SPEC 4章 / 16章）
// なんちゃって 3D = CSS transform + SVG ハイブリッド
// 段階2-C: 3D空間 + 標準ダーツボード SVG + センサー連動 + 視界外方向矢印

import * as Sensor from './darts-sensor.js';

// ======================================================================
// 設定（実装時調整・段階6 で性能フォールバック含めて最終確定）
// ======================================================================
const HORIZ_FOV_DEG = 30;           // 画面横幅 = 30度の仮想視野（v1.07 で 60→30）
const TARGET_DIAMETER_RATIO = 0.9;  // 画面横幅 90% に占める基準サイズ
const FOV_HARD_LIMIT_DEG = HORIZ_FOV_DEG;  // ±FOV/2 の角度範囲内に的を配置
const SHIFT_RADIUS_RATIO = 0.25;    // 直径の 1/4 までシフト
const TILT_SCALE = 0.6;             // 視野中心からのオフセットによる板の傾き係数

// センサー軸マッピング（v1.08: 縦持ち専用の正しい対応に修正）
//   縦持ち時:  Yaw=gamma(Y軸回転)  Pitch=beta(X軸回転)  Roll=alpha(Z軸回転)
//   旧 v1.02-v1.07 は alpha と gamma が逆だった
const SIGN_YAW = +1;    // rel.gamma → yawDelta
const SIGN_PITCH = +1;  // rel.beta → pitchDelta
const SIGN_ROLL = +1;   // rel.alpha → roll (rotateZ)
const ROLL_SCALE = 0.5; // ロール感度

// ======================================================================
// 標準ダーツボード（SPEC 3.4：ボード外周 = 100 とする半径比）
// ======================================================================
const R_BORDER       = 112;
const R_NUMBERS      = 106;
const R_DOUBLE_OUT   = 100;
const R_DOUBLE_IN    = 95.3;
const R_TRIPLE_OUT   = 62.9;
const R_TRIPLE_IN    = 58.2;
const R_OUTER_BULL   = 9.4;
const R_INNER_BULL   = 3.7;

// 12時方向から時計回り
const SEGMENT_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// 標準配色（4色配色 = 黒/赤/緑/白[クリーム]、SPEC 4.5）
const COLOR_BLACK = '#1a1a1a';
const COLOR_CREAM = '#f0e6c8';
const COLOR_RED   = '#d4302a';
const COLOR_GREEN = '#1f7a3a';
const COLOR_BORDER = '#0a0a0a';
const COLOR_NUM_TEXT = '#fafafa';
const COLOR_WIRE = '#888';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 偶数index = 黒胴体, 奇数index = クリーム胴体（20が黒胴体）
const isBlackBody = (i) => i % 2 === 0;

// ======================================================================
// SVG ヘルパ
// ======================================================================
function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function sectorPath(a1Deg, a2Deg, rIn, rOut, fill) {
  const r1 = (a1Deg * Math.PI) / 180;
  const r2 = (a2Deg * Math.PI) / 180;
  const x1 = Math.cos(r1) * rIn,  y1 = Math.sin(r1) * rIn;
  const x2 = Math.cos(r1) * rOut, y2 = Math.sin(r1) * rOut;
  const x3 = Math.cos(r2) * rOut, y3 = Math.sin(r2) * rOut;
  const x4 = Math.cos(r2) * rIn,  y4 = Math.sin(r2) * rIn;
  const largeArc = (a2Deg - a1Deg) > 180 ? 1 : 0;
  return el('path', {
    d: `M ${x1} ${y1} L ${x2} ${y2} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x1} ${y1} Z`,
    fill,
  });
}

// ======================================================================
// ダーツボード SVG 生成
// ======================================================================
function buildDartboardSVG() {
  const vbSize = (R_BORDER + 4) * 2;
  const svg = el('svg', {
    viewBox: `-${R_BORDER + 4} -${R_BORDER + 4} ${vbSize} ${vbSize}`,
  });
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';

  // 外周（数字を載せる黒帯 + 黒縁取り）
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R_BORDER, fill: COLOR_BORDER }));

  // 20 セグメント本体（インナーシングル + トリプル + アウターシングル + ダブル）
  for (let i = 0; i < 20; i++) {
    const center = -90 + i * 18;
    const a1 = center - 9;
    const a2 = center + 9;
    const bb = isBlackBody(i);
    const bodyColor   = bb ? COLOR_BLACK : COLOR_CREAM;
    // 標準配色: 黒胴体は ダブル=赤 / トリプル=緑、クリーム胴体は逆
    const tripleColor = bb ? COLOR_GREEN : COLOR_RED;
    const doubleColor = bb ? COLOR_RED   : COLOR_GREEN;

    svg.appendChild(sectorPath(a1, a2, R_OUTER_BULL, R_TRIPLE_IN, bodyColor));   // インナーシングル
    svg.appendChild(sectorPath(a1, a2, R_TRIPLE_IN, R_TRIPLE_OUT, tripleColor)); // トリプル
    svg.appendChild(sectorPath(a1, a2, R_TRIPLE_OUT, R_DOUBLE_IN, bodyColor));   // アウターシングル
    svg.appendChild(sectorPath(a1, a2, R_DOUBLE_IN, R_DOUBLE_OUT, doubleColor)); // ダブル
  }

  // セグメント境界の細線（金属ワイヤ風）
  for (let i = 0; i < 20; i++) {
    const a = ((-90 + i * 18 - 9) * Math.PI) / 180;
    const x1 = Math.cos(a) * R_OUTER_BULL;
    const y1 = Math.sin(a) * R_OUTER_BULL;
    const x2 = Math.cos(a) * R_DOUBLE_OUT;
    const y2 = Math.sin(a) * R_DOUBLE_OUT;
    svg.appendChild(el('line', {
      x1, y1, x2, y2,
      stroke: COLOR_WIRE, 'stroke-width': 0.35,
    }));
  }

  // アウターブル(25, 緑) → インナーブル(50, 赤)
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R_OUTER_BULL, fill: COLOR_GREEN, stroke: COLOR_WIRE, 'stroke-width': 0.35 }));
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R_INNER_BULL, fill: COLOR_RED }));

  // 数字（黒帯の上、白文字）
  for (let i = 0; i < 20; i++) {
    const center = -90 + i * 18;
    const rad = (center * Math.PI) / 180;
    const tx = Math.cos(rad) * R_NUMBERS;
    const ty = Math.sin(rad) * R_NUMBERS;
    const t = el('text', {
      x: tx, y: ty,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: COLOR_NUM_TEXT,
      'font-family': "'Fredoka One', 'Noto Sans JP', sans-serif",
      'font-size': 11,
    });
    t.textContent = String(SEGMENT_NUMBERS[i]);
    svg.appendChild(t);
  }

  return svg;
}

// ======================================================================
// モジュール状態
// ======================================================================
let _viewEl = null;
let _sceneEl = null;   // 壁 + 的を含むシーン（センサーで一体 transform）
let _boardEl = null;
let _arrowEl = null;
let _debugCallback = null;
let _animFrameId = null;
let _targetWorld = { yaw: 0, pitch: 0 };  // ワールド座標での的中心角度（度）

// ======================================================================
// ログバッファ（直近 N 秒の入力↔反応サンプルを保持）
// ======================================================================
const LOG_INTERVAL_MS = 100;   // 10 Hz でサンプリング
const LOG_DURATION_MS = 5000;  // 直近 5 秒
const LOG_BUFFER_SIZE = LOG_DURATION_MS / LOG_INTERVAL_MS;
let _logBuffer = [];
let _lastLogTime = 0;
let _startTime = 0;

// ======================================================================
// 的の配置（SPEC 4.4：FOV ハード制限 + 毎ターン直径 1/4 ランダムシフト）
// ======================================================================
export function placeTargetForTurn() {
  const targetAngularDiameter = HORIZ_FOV_DEG * TARGET_DIAMETER_RATIO;
  const maxShift = targetAngularDiameter * SHIFT_RADIUS_RATIO;  // 直径の 1/4 まで
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * maxShift;
  const yaw = Math.cos(angle) * r;
  const pitch = Math.sin(angle) * r;
  // ハード制限（実用上は常に内側だがガード）
  const half = FOV_HARD_LIMIT_DEG / 2;
  _targetWorld = {
    yaw:   Math.max(-half, Math.min(half, yaw)),
    pitch: Math.max(-half, Math.min(half, pitch)),
  };
}

export function getTargetWorld() {
  return { ..._targetWorld };
}

// 中央リセット（of 的を画面中央に戻す）
export function recenterTarget() {
  _targetWorld = { yaw: 0, pitch: 0 };
}

// 直近のログ（JSON 文字列、Claude に貼り付け可能な形式）
export function getLog() {
  const header = `# MOMO Darts sensor log (v1.05, 10Hz, ${_logBuffer.length} samples)\n` +
                 `# SIGN_YAW=${SIGN_YAW} SIGN_PITCH=${SIGN_PITCH} SIGN_ROLL=${SIGN_ROLL} ROLL_SCALE=${ROLL_SCALE}\n` +
                 `# HORIZ_FOV_DEG=${HORIZ_FOV_DEG} TILT_SCALE=${TILT_SCALE}\n`;
  return header + JSON.stringify(_logBuffer);
}

function round1(v) {
  if (v === null || v === undefined) return null;
  return Math.round(v * 10) / 10;
}

// ======================================================================
// rAF ループ：センサー値 → シーン(壁+的) の transform 更新 + 矢印切替
// ======================================================================
function tick() {
  if (!_sceneEl || !_boardEl || !_viewEl) {
    _animFrameId = null;
    return;
  }

  const screenW = _viewEl.clientWidth || window.innerWidth;
  const screenH = _viewEl.clientHeight || window.innerHeight;
  const pxPerDeg = screenW / HORIZ_FOV_DEG;
  const targetSizePx = screenW * TARGET_DIAMETER_RATIO;

  const rel = Sensor.getRelativeOrientation();
  let yawDelta = 0, pitchDelta = 0, roll = 0;
  if (rel) {
    // 縦持ち想定: gamma=Yaw, beta=Pitch, alpha=Roll
    yawDelta   = SIGN_YAW   * (rel.gamma || 0);
    pitchDelta = SIGN_PITCH * (rel.beta  || 0);
    roll       = SIGN_ROLL  * (rel.alpha || 0) * ROLL_SCALE;
  }

  // 視線方向から的までの角度差
  const dxDeg = _targetWorld.yaw   - yawDelta;
  const dyDeg = _targetWorld.pitch - pitchDelta;

  // 画面上の的中心位置（viewport 中央からの px オフセット）
  const x = dxDeg * pxPerDeg;
  const y = -dyDeg * pxPerDeg;  // CSS Y は下が正

  // 中心からのオフセット分だけシーン(壁+的)が傾いて見える（なんちゃって 3D）
  const tiltX = -dyDeg * TILT_SCALE;
  const tiltY =  dxDeg * TILT_SCALE;

  // 的（サイズだけ動的、シーン内でセンタリング固定）
  _boardEl.style.width  = `${targetSizePx}px`;
  _boardEl.style.height = `${targetSizePx}px`;

  // シーン全体（壁+的）の transform — 壁と的が一体で動く
  _sceneEl.style.transform =
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0px) ` +
    `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) rotateZ(${roll.toFixed(2)}deg)`;

  // ログサンプル記録（10Hz）
  const now = performance.now();
  if (now - _lastLogTime >= LOG_INTERVAL_MS) {
    const raw = Sensor.getCurrentOrientation();
    _logBuffer.push({
      t: Math.round(now - _startTime),
      raw: raw ? { a: round1(raw.alpha), b: round1(raw.beta), g: round1(raw.gamma) } : null,
      rel: rel ? { a: round1(rel.alpha), b: round1(rel.beta), g: round1(rel.gamma) } : null,
      view: { yaw: round1(yawDelta), pitch: round1(pitchDelta), roll: round1(roll) },
      tgt: { yaw: round1(_targetWorld.yaw), pitch: round1(_targetWorld.pitch) },
      scr: { x: Math.round(x), y: Math.round(y) },
    });
    if (_logBuffer.length > LOG_BUFFER_SIZE) _logBuffer.shift();
    _lastLogTime = now;
  }

  // 視界外方向矢印（SPEC 4.2 視界外時の方向矢印）
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const halfTarget = targetSizePx / 2;
  const out = (Math.abs(x) > halfW + halfTarget) || (Math.abs(y) > halfH + halfTarget);
  if (out) {
    _arrowEl.style.display = 'flex';
    // 横方向: x の符号で左右端配置
    if (x < 0) {
      _arrowEl.style.left = '12px';
      _arrowEl.style.right = 'auto';
      _arrowEl.classList.add('flip-h');
    } else {
      _arrowEl.style.right = '12px';
      _arrowEl.style.left = 'auto';
      _arrowEl.classList.remove('flip-h');
    }
    // 縦位置: y の符号で上下に少しずらす（簡易版）
    const yFrac = Math.max(-0.4, Math.min(0.4, y / screenH));
    _arrowEl.style.top = `${50 + yFrac * 80}%`;
  } else {
    _arrowEl.style.display = 'none';
  }

  if (_debugCallback) {
    _debugCallback({ yawDelta, pitchDelta, roll, x, y, target: _targetWorld });
  }

  _animFrameId = requestAnimationFrame(tick);
}

// ======================================================================
// 起動・停止
// ======================================================================
export function start({ viewEl, sceneEl, boardEl, arrowEl, debugCallback }) {
  _viewEl = viewEl;
  _sceneEl = sceneEl;
  _boardEl = boardEl;
  _arrowEl = arrowEl;
  _debugCallback = debugCallback || null;

  // ダーツボード SVG を組み立て
  _boardEl.innerHTML = '';
  _boardEl.appendChild(buildDartboardSVG());

  // ログバッファをリセット
  _logBuffer = [];
  _lastLogTime = 0;
  _startTime = performance.now();

  if (_animFrameId) cancelAnimationFrame(_animFrameId);
  _animFrameId = requestAnimationFrame(tick);
}

export function stop() {
  if (_animFrameId) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }
  _viewEl = null;
  _sceneEl = null;
  _boardEl = null;
  _arrowEl = null;
  _debugCallback = null;
}
