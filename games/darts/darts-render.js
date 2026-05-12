// MOMO Darts - 3D空間 + 的描画モジュール（SPEC 4章 / 16章）
// なんちゃって 3D = CSS transform + SVG ハイブリッド
// 段階2-C: 3D空間 + 標準ダーツボード SVG + センサー連動 + 視界外方向矢印

import * as Sensor from './darts-sensor.js';
import * as Physics from './darts-physics.js';
import * as Rules from './darts-rules.js';

// ======================================================================
// 設定（実装時調整・段階6 で性能フォールバック含めて最終確定）
// ======================================================================
// v1.14: FOV は固定、ヨー/ピッチ感度は別倍率で調整
const HORIZ_FOV_DEG = 40;           // 仮想視野（固定）— 的の配置範囲計算にのみ使用
let YAW_PITCH_SCALE = 1.0;          // ヨー/ピッチ感度倍率（調整可: 0.5〜2.0）
const TARGET_DIAMETER_RATIO = 0.9;  // 画面横幅 90% に占める基準サイズ
const SHIFT_RADIUS_RATIO = 0.25;    // 直径の 1/4 までシフト
const TILT_SCALE = 0;               // v1.09: 疑似3D傾きをいったん無効化

// センサー軸マッピング（v1.08: 縦持ち専用の正しい対応に修正）
//   縦持ち時:  Yaw=gamma(Y軸回転)  Pitch=beta(X軸回転)  Roll=alpha(Z軸回転)
//   旧 v1.02-v1.07 は alpha と gamma が逆だった
const SIGN_YAW = -1;    // rel.gamma → yawDelta（v1.09 で反転）
const SIGN_PITCH = +1;  // rel.beta → pitchDelta
const SIGN_ROLL = +1;   // rel.alpha → roll (rotateZ)
let ROLL_SCALE = 0.7;   // ロール感度（調整可: 0.3〜1.5）

// ======================================================================
// 標準ダーツボード（SPEC 3.4 / 単一情報源は darts-rules.js）
// ======================================================================
const {
  R_BORDER, R_NUMBERS, R_DOUBLE_OUT, R_DOUBLE_IN,
  R_TRIPLE_OUT, R_TRIPLE_IN, R_OUTER_BULL, R_INNER_BULL,
  SEGMENT_NUMBERS,
} = Rules;

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

// v1.21: 飛行中ダーツの状態（null = 飛行なし）
let _flight = null;   // { trajectory, impact, startTime, onComplete }
// v1.21: 最新のスムージング済み角度（getCurrentAim 用、tick で更新）
let _lastYawDeg = 0, _lastPitchDeg = 0;

// v1.10: low-pass filter（センサー値の jitter / cross-axis ノイズ抑制）
let SMOOTH_FACTOR = 0.4;  // 0=止まる, 1=フィルタ無し（調整可: 0.1〜1.0）
let _smoothRel = { alpha: 0, beta: 0, gamma: 0 };

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
  // ハード制限（FOV の半分以内）
  const half = HORIZ_FOV_DEG / 2;
  _targetWorld = {
    yaw:   Math.max(-half, Math.min(half, yaw)),
    pitch: Math.max(-half, Math.min(half, pitch)),
  };
  // v1.21: ターン進行時に着弾マークをクリア（履歴は段階2-F 以降で実装）
  clearImpactMarks();
}

export function getTargetWorld() {
  return { ..._targetWorld };
}

// 中央リセット（of 的を画面中央に戻す）
export function recenterTarget() {
  _targetWorld = { yaw: 0, pitch: 0 };
}

// v1.14: ユーザー調整可能パラメータの setter/getter
export function setYawPitchScale(s) { YAW_PITCH_SCALE = Math.max(0.5, Math.min(2.0, s)); }
export function getYawPitchScale() { return YAW_PITCH_SCALE; }
export function setRollScale(s) { ROLL_SCALE = Math.max(0.3, Math.min(1.5, s)); }
export function getRollScale() { return ROLL_SCALE; }
export function setSmoothFactor(f) { SMOOTH_FACTOR = Math.max(0.1, Math.min(1.0, f)); }
export function getSmoothFactor() { return SMOOTH_FACTOR; }

// 直近のログ（JSON 文字列、Claude に貼り付け可能な形式）
export function getLog() {
  const header = `# MOMO Darts sensor log (v1.14, 10Hz, ${_logBuffer.length} samples)\n` +
                 `# SIGN_YAW=${SIGN_YAW} SIGN_PITCH=${SIGN_PITCH} SIGN_ROLL=${SIGN_ROLL}\n` +
                 `# HORIZ_FOV_DEG=${HORIZ_FOV_DEG} YAW_PITCH_SCALE=${YAW_PITCH_SCALE} ROLL_SCALE=${ROLL_SCALE} SMOOTH_FACTOR=${SMOOTH_FACTOR}\n`;
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
  const pxPerDeg = (screenW / HORIZ_FOV_DEG) * YAW_PITCH_SCALE;
  const targetSizePx = screenW * TARGET_DIAMETER_RATIO;

  const rel = Sensor.getRelativeOrientation();
  let yawDelta = 0, pitchDelta = 0, roll = 0;
  if (rel) {
    // v1.10: 低域パスフィルタ（cross-axis ノイズと jitter を緩和）
    _smoothRel.alpha = _smoothRel.alpha * (1 - SMOOTH_FACTOR) + (rel.alpha || 0) * SMOOTH_FACTOR;
    _smoothRel.beta  = _smoothRel.beta  * (1 - SMOOTH_FACTOR) + (rel.beta  || 0) * SMOOTH_FACTOR;
    _smoothRel.gamma = _smoothRel.gamma * (1 - SMOOTH_FACTOR) + (rel.gamma || 0) * SMOOTH_FACTOR;

    // 縦持ち想定: gamma=Yaw, beta=Pitch, alpha=Roll
    yawDelta   = SIGN_YAW   * _smoothRel.gamma;
    pitchDelta = SIGN_PITCH * _smoothRel.beta;
    roll       = SIGN_ROLL  * _smoothRel.alpha * ROLL_SCALE;
  }
  // v1.21: app から照準角度を取れるよう保存
  _lastYawDeg = yawDelta;
  _lastPitchDeg = pitchDelta;

  // 視線方向から的までの角度差
  const dxDeg = _targetWorld.yaw   - yawDelta;
  const dyDeg = _targetWorld.pitch - pitchDelta;

  // 画面上の的中心位置（viewport 中央からの px オフセット）
  const x = dxDeg * pxPerDeg;
  const y = -dyDeg * pxPerDeg;  // CSS Y は下が正

  // 的（サイズだけ動的、シーン内でセンタリング固定）
  _boardEl.style.width  = `${targetSizePx}px`;
  _boardEl.style.height = `${targetSizePx}px`;

  // v1.10: 純粋 2D 描画（translate + rotateZ のみ）
  // 3D 合成パスを避けて pivot ズレを防ぐ。疑似 3D 傾きは v1.10+ で再導入予定
  _sceneEl.style.transform =
    `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${roll.toFixed(2)}deg)`;

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

  // v1.21: 飛行中のダーツを 3D 投影
  if (_flight) {
    const dartEl = document.getElementById('flying-dart');
    if (dartEl) {
      const elapsedS = (performance.now() - _flight.startTime) / 1000;
      if (elapsedS >= _flight.impact.t) {
        // 着弾
        if (_flight.impact.hit) showImpactMark(_flight.impact);
        endFlight();
      } else {
        const pos = interpolateTrajectory(_flight.trajectory, elapsedS);
        const proj = projectWorldToScreen(pos, yawDelta, pitchDelta,
                                          screenW, screenH, pxPerDeg);
        if (proj.behind) {
          dartEl.style.opacity = '0';
        } else {
          dartEl.style.opacity = '1';
          dartEl.style.left = `${proj.x.toFixed(1)}px`;
          dartEl.style.top  = `${proj.y.toFixed(1)}px`;
        }
      }
    }
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
  _smoothRel = { alpha: 0, beta: 0, gamma: 0 };  // v1.10

  if (_animFrameId) cancelAnimationFrame(_animFrameId);
  _animFrameId = requestAnimationFrame(tick);
}

export function stop() {
  if (_animFrameId) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }
  // v1.21: 飛行中なら捨てる（callback は呼ばない）
  _flight = null;
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.classList.remove('flying');
    dart.style.opacity = '0';
    dart.style.transition = '';
  }
  _viewEl = null;
  _sceneEl = null;
  _boardEl = null;
  _arrowEl = null;
  _debugCallback = null;
}

// ======================================================================
// 段階2-E: 物理飛行 + 着弾マーク
// ======================================================================

// 軌跡を時刻 t で線形補間
function interpolateTrajectory(traj, t) {
  if (!traj || traj.length === 0) return { x: 0, y: 0, z: 0 };
  if (t <= traj[0].t) return { ...traj[0] };
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].t >= t) {
      const a = traj[i - 1], b = traj[i];
      const dt = b.t - a.t || 1e-6;
      const f = (t - a.t) / dt;
      return {
        x: a.x + f * (b.x - a.x),
        y: a.y + f * (b.y - a.y),
        z: a.z + f * (b.z - a.z),
      };
    }
  }
  return { ...traj[traj.length - 1] };
}

// ワールド座標 (m) → 画面座標 (px)。プレイヤーは原点、Z+ 前方
function projectWorldToScreen(pos, devYawDeg, devPitchDeg, screenW, screenH, pxPerDeg) {
  if (pos.z <= 0.05) return { x: 0, y: 0, behind: true };
  const yawDeg   = Math.atan2(pos.x, pos.z) * 180 / Math.PI;
  const pitchDeg = Math.atan2(pos.y, Math.hypot(pos.x, pos.z)) * 180 / Math.PI;
  const dxDeg = yawDeg   - devYawDeg;
  const dyDeg = pitchDeg - devPitchDeg;
  return {
    x: dxDeg * pxPerDeg + screenW / 2,
    y: -dyDeg * pxPerDeg + screenH / 2,
    behind: false,
  };
}

// world 座標の着弾 → board-local SVG 座標
function worldImpactToBoardSVG(impact) {
  const rel = Physics.impactRelativeToTarget(impact, _targetWorld);
  const unitsPerDeg = ((R_BORDER + 4) * 2) / (HORIZ_FOV_DEG * TARGET_DIAMETER_RATIO);
  return {
    x: rel.dxDeg * unitsPerDeg,
    y: -rel.dyDeg * unitsPerDeg,   // SVG Y は下が正
  };
}

// 着弾マーク（SVG circle）を的に追加
function showImpactMark(impact) {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  const sv = worldImpactToBoardSVG(impact);
  const dot = el('circle', {
    cx: sv.x, cy: sv.y, r: 2.8,
    fill: '#ef4444',
    stroke: '#ffffff', 'stroke-width': 0.6,
  });
  dot.classList.add('impact-mark');
  svg.appendChild(dot);
}

export function clearImpactMarks() {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (svg) svg.querySelectorAll('.impact-mark').forEach((e) => e.remove());
}

// 現在のスムージング済み照準角度（app から照準を渡したいとき用）
export function getCurrentAim() {
  return { yawDeg: _lastYawDeg, pitchDeg: _lastPitchDeg };
}

// 飛行開始（simResult = Physics.simulateThrow の戻り値）
export function fireFlight(simResult, onComplete) {
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.style.transition = 'none';
    // tick の初回投影でちらつかないよう、最初は透明で表示
    dart.style.opacity = '0';
    dart.classList.add('flying');
  }
  _flight = {
    trajectory: simResult.trajectory,
    impact: simResult.impact,
    startTime: performance.now(),
    onComplete,
  };
}

function endFlight() {
  if (!_flight) return;
  const f = _flight;
  _flight = null;
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.style.transition = 'opacity 240ms ease-out';
    dart.style.opacity = '0';
    setTimeout(() => {
      dart.classList.remove('flying');
      dart.style.transition = '';
    }, 260);
  }
  // 着弾の board-local SVG 座標も渡す（hit=true のみ意味がある）
  const boardImpact = f.impact.hit ? worldImpactToBoardSVG(f.impact) : null;
  if (f.onComplete) f.onComplete({ world: f.impact, board: boardImpact });
}
