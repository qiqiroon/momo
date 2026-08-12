/**
 * v1.22: S10 設定画面が持つ「端末ごとの設定」の保存場所。
 *
 * spec 付録D-10 v2.3 §8 が定める永続化のうち、音量 (audio-engine 側) 以外をここで扱う。
 * どれも通信では送らない = その端末の好みであり、対局のルールではない。
 *
 * キー名は既存の `shogi.audio.*` に揃えた `shogi.settings.*` を使う。
 * (付録は `momoShogi.settings.*` と書いているが、音量キーが既に `shogi.audio.*` で
 *  保存済みのため、そちらに合わせないと利用者の保存値が失われる。)
 */
/** game-store の QuantumDisplay と同じ値域。循環 import を避けるためここで持つ。 */
type QuantumDisplay = 'cycle' | 'stack';

const KEY_HINT = 'shogi.settings.game.hintAlwaysOn';
const KEY_QTDISP = 'shogi.settings.game.quantumDisplay';
const KEY_BYOMU = 'shogi.settings.sound.byomu';

/** 既定値 (spec 付録D-10 §9)。移動先ヒントは ON、未確定駒の見せ方は巡回、秒読み音は ON。 */
export const SETTINGS_DEFAULTS = {
  hintAlwaysOn: true,
  myQuantumDisplay: 'cycle' as QuantumDisplay,
  byomuSound: true,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // localStorage が使えない環境 (SSR/シークレット) では既定値で動く
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** 移動先ヒント (行き先マスのオレンジ) を出すか。既定 ON。 */
export function loadHintAlwaysOn(): boolean {
  const v = read(KEY_HINT);
  return v === null ? SETTINGS_DEFAULTS.hintAlwaysOn : v === 'true';
}

export function saveHintAlwaysOn(on: boolean): void {
  write(KEY_HINT, String(on));
}

/**
 * 各自の画面の未確定駒の見せ方。
 * 部屋の値が重ねのときは無視されるが、値そのものは残す (部屋が巡回に戻れば再び効く)。
 */
export function loadMyQuantumDisplay(): QuantumDisplay {
  return read(KEY_QTDISP) === 'stack' ? 'stack' : SETTINGS_DEFAULTS.myQuantumDisplay;
}

export function saveMyQuantumDisplay(mode: QuantumDisplay): void {
  write(KEY_QTDISP, mode);
}

/**
 * 秒読み音を鳴らすか (spec 付録D-10 §5.1 音セクション)。既定 ON。
 *
 * **注意**: 秒読みの音そのものは未実装 (音響仕様 v0.6 §2.2.1 は定めているが、
 * アプリにまだ音が無い)。したがって当面この設定は何も鳴らさない。
 * それでも項目を置くのは、モックにある項目を画面へ足す方針 (ユーザー判断 2026-08-12) と、
 * 未実装のものにふたをせずそのまま置く方針による。音を作るときにここへ結線する。
 */
export function loadByomuSound(): boolean {
  const v = read(KEY_BYOMU);
  return v === null ? SETTINGS_DEFAULTS.byomuSound : v === 'true';
}

export function saveByomuSound(on: boolean): void {
  write(KEY_BYOMU, String(on));
}

/** 全設定を既定に戻す (spec 付録D-10 §6 リセットゾーン)。音量は呼び出し側で戻す。 */
export function clearUiSettings(): void {
  try {
    localStorage.removeItem(KEY_HINT);
    localStorage.removeItem(KEY_QTDISP);
    localStorage.removeItem(KEY_BYOMU);
  } catch {
    /* ignore */
  }
}
