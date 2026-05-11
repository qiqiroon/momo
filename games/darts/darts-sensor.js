// MOMO Darts - センサーモジュール
// SPEC 4.3 (キャリブレーション) / 14.4 (許可フロー) / 18.7 (5秒タイムアウト) に基づく実装。
// DeviceOrientationEvent を扱い、許可状態の永続化と 0リセット (キャリブ) を提供する。

const STORAGE_KEY_PERMISSION = 'momoDartsSensorPermitted';
const SENSOR_DETECT_TIMEOUT_MS = 5000;

let _calibration = null;        // { alpha, beta, gamma } or null
let _currentOrientation = null; // 最新のセンサー値
let _listenerAttached = false;
let _onChange = null;

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
  _calibration = {
    alpha: _currentOrientation.alpha || 0,
    beta: _currentOrientation.beta || 0,
    gamma: _currentOrientation.gamma || 0,
  };
  return true;
}

export function clearCalibration() {
  _calibration = null;
}

export function getCalibration() {
  return _calibration;
}

export function getCurrentOrientation() {
  return _currentOrientation;
}

// 角度を (-180, 180] に正規化（alpha が 0/360 境界を跨ぐ際のラップ対策）
function _normalizeAngle(a) {
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
}

// キャリブ基準で相対方向を取得（ラップ補正済）
export function getRelativeOrientation() {
  if (!_currentOrientation || !_calibration) return null;
  return {
    alpha: _normalizeAngle((_currentOrientation.alpha || 0) - _calibration.alpha),
    beta:  _normalizeAngle((_currentOrientation.beta  || 0) - _calibration.beta),
    gamma: _normalizeAngle((_currentOrientation.gamma || 0) - _calibration.gamma),
  };
}
