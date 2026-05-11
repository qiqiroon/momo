// MOMO Darts - センサーモジュール
// SPEC 4.3 (キャリブレーション) / 14.4 (許可フロー) / 18.7 (5秒タイムアウト) に基づく実装。
// DeviceOrientationEvent を扱い、許可状態の永続化と 0リセット (キャリブ) を提供する。

const STORAGE_KEY_PERMISSION = 'momoDartsSensorPermitted';
const SENSOR_DETECT_TIMEOUT_MS = 5000;

let _calibration = null;        // { alpha, beta, gamma } or null（互換用）
let _calMatrixInv = null;       // v1.11: キャリブ姿勢の rotation matrix の逆（転置）
let _currentOrientation = null; // 最新のセンサー値
let _listenerAttached = false;
let _onChange = null;

// ======================================================================
// v1.11: 回転行列ベースの相対姿勢計算（Euler 角 cross-axis 問題を解消）
// ======================================================================
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// DeviceOrientationEvent の (α, β, γ) → rotation matrix
// W3C 仕様: R = Rz(α) · Rx(β) · Ry(γ)
function _eulerToMatrix(aDeg, bDeg, gDeg) {
  const a = aDeg * D2R, b = bDeg * D2R, g = gDeg * D2R;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca*cg - sa*sb*sg, -sa*cb, ca*sg + sa*sb*cg],
    [sa*cg + ca*sb*sg,  ca*cb, sa*sg - ca*sb*cg],
    [          -cb*sg,     sb,            cb*cg]
  ];
}

function _matTranspose(M) {
  return [[M[0][0], M[1][0], M[2][0]],
          [M[0][1], M[1][1], M[2][1]],
          [M[0][2], M[1][2], M[2][2]]];
}

function _matMul(A, B) {
  const R = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        R[i][j] += A[i][k] * B[k][j];
  return R;
}

// 相対回転行列を Rz(roll) · Rx(pitch) · Ry(yaw) として分解
function _matrixToYawPitchRoll(M) {
  const sb = Math.max(-1, Math.min(1, M[2][1]));
  const pitch = Math.asin(sb);
  let yaw, roll;
  if (Math.abs(Math.cos(pitch)) > 1e-4) {
    yaw  = Math.atan2(-M[2][0], M[2][2]);
    roll = Math.atan2(-M[0][1], M[1][1]);
  } else {
    yaw  = 0;
    roll = Math.atan2(M[1][0], M[0][0]);
  }
  return { yaw: yaw * R2D, pitch: pitch * R2D, roll: roll * R2D };
}

function _handleOrientation(e) {
  _currentOrientation = {
    alpha: e.alpha,
    beta: e.beta,
    gamma: e.gamma,
    absolute: e.absolute,
  };
  if (_onChange) _onChange(_currentOrientation);
}

// ===== 環境判定 =====

export function isDeviceOrientationAvailable() {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

export function needsExplicitPermission() {
  return (
    isDeviceOrientationAvailable() &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  );
}

export function detectBrowserKind() {
  const ua = navigator.userAgent;
  // iOS は CriOS / FxiOS を除外して Safari を判定
  if (/iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) {
    return 'ios-safari';
  }
  if (/Android/.test(ua) && /Chrome/.test(ua)) {
    return 'android-chrome';
  }
  if (/iPad|iPhone|iPod/.test(ua)) {
    return 'ios-other';
  }
  if (/Android/.test(ua)) {
    return 'android-other';
  }
  return 'other';
}

// ===== 許可状態の永続化 =====

export function getStoredPermission() {
  try {
    return localStorage.getItem(STORAGE_KEY_PERMISSION) === 'granted';
  } catch {
    return false;
  }
}

export function setStoredPermission(granted) {
  try {
    if (granted) localStorage.setItem(STORAGE_KEY_PERMISSION, 'granted');
    else localStorage.removeItem(STORAGE_KEY_PERMISSION);
  } catch {
    // localStorage 失敗は無視（SPEC 18.7）
  }
}

// ===== 許可要求 =====
// 戻り値: 'granted' | 'denied' | 'unavailable'

export async function requestPermission() {
  if (!isDeviceOrientationAvailable()) return 'unavailable';
  if (needsExplicitPermission()) {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result === 'granted') {
        setStoredPermission(true);
        return 'granted';
      }
      return 'denied';
    } catch {
      return 'denied';
    }
  }
  // Android Chrome 等は明示許可不要
  setStoredPermission(true);
  return 'granted';
}

// ===== センサー値リスナー =====

export function startListening(onChange) {
  _onChange = onChange || null;
  if (!_listenerAttached) {
    window.addEventListener('deviceorientation', _handleOrientation);
    _listenerAttached = true;
  }
}

export function stopListening() {
  if (_listenerAttached) {
    window.removeEventListener('deviceorientation', _handleOrientation);
    _listenerAttached = false;
  }
  _onChange = null;
}

// ===== センサーが実際に動作しているか判定（5秒タイムアウト、SPEC 18.7） =====
// 戻り値: Promise<boolean> — true なら動作確認済、false ならタイムアウト（非搭載扱い）

export function detectSensorActive(timeoutMs = SENSOR_DETECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let detected = false;
    const onEvent = (e) => {
      if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
        detected = true;
        cleanup();
        resolve(true);
      }
    };
    const cleanup = () => {
      window.removeEventListener('deviceorientation', onEvent);
    };
    window.addEventListener('deviceorientation', onEvent);
    setTimeout(() => {
      if (!detected) {
        cleanup();
        resolve(false);
      }
    }, timeoutMs);
  });
}

// ===== キャリブレーション (0リセット、SPEC 4.3) =====

export function setCalibration() {
  if (!_currentOrientation) return false;
  const a = _currentOrientation.alpha || 0;
  const b = _currentOrientation.beta  || 0;
  const g = _currentOrientation.gamma || 0;
  _calibration = { alpha: a, beta: b, gamma: g };
  // v1.11: キャリブ姿勢の rotation matrix の逆（rotation matrix は直交なので転置 = 逆）
  _calMatrixInv = _matTranspose(_eulerToMatrix(a, b, g));
  return true;
}

export function clearCalibration() {
  _calibration = null;
  _calMatrixInv = null;
}

export function getCalibration() {
  return _calibration;
}

export function getCurrentOrientation() {
  return _currentOrientation;
}

// v1.11: 相対姿勢を rotation matrix で計算
// R_rel = R_cal⁻¹ · R_curr を Rz(roll)·Rx(pitch)·Ry(yaw) として分解
// 戻り値は darts-render.js が期待する形式: alpha=roll, beta=pitch, gamma=yaw
export function getRelativeOrientation() {
  if (!_currentOrientation || !_calMatrixInv) return null;
  const a = _currentOrientation.alpha || 0;
  const b = _currentOrientation.beta  || 0;
  const g = _currentOrientation.gamma || 0;
  const Mcurr = _eulerToMatrix(a, b, g);
  const Mrel = _matMul(_calMatrixInv, Mcurr);
  const ypr = _matrixToYawPitchRoll(Mrel);
  return {
    alpha: ypr.roll,   // darts-render 側の "roll" 用
    beta:  ypr.pitch,  // "pitch" 用
    gamma: ypr.yaw,    // "yaw" 用
  };
}
