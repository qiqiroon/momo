/**
 * 設定の読み書き（第1分冊 3.6 / 4.6）
 *
 * 読み出しに失敗した項目は既定値へ落とす。**他のキーは巻き添えにしない**（3.6.2）。
 */

import {
  HAPTIC_ENABLED_DEFAULT,
  LOUPE_CORNER_DEFAULT,
  LOUPE_OPEN_DEFAULT,
  LOUPE_SPAN_DEFAULT,
  PALETTE_SCALE_DEFAULT,
  RECENT_BUFFER_SIZE,
  SOUND_ENABLED_DEFAULT,
  SOUND_VOLUME_DEFAULT,
} from '../data/config';
import {
  guards,
  isLoupeCorner,
  type BoardSize,
  type Difficulty,
  type LocaleCode,
  type Result,
  type Settings,
} from '../data/types';
import { KEYS, readValidated, remove, write, writeMeta } from './localStore';

const LOCALES: readonly LocaleCode[] = ['ja', 'en', 'zh', 'cat'];

/** Undo/Redo リングバッファ上限の既定値（C-14。第2分冊で確定） */
const UNDO_LIMIT_DEFAULT = 100;

export function defaults(): Settings {
  return {
    locale: 'ja',
    lastSize: null,
    lastDifficulty: null,
    zoomPreference: null,
    recentBufferSize: RECENT_BUFFER_SIZE,
    undoLimit: UNDO_LIMIT_DEFAULT,
    soundEnabled: SOUND_ENABLED_DEFAULT,
    soundVolume: SOUND_VOLUME_DEFAULT,
    hapticEnabled: HAPTIC_ENABLED_DEFAULT,
    loupeCorner: LOUPE_CORNER_DEFAULT,
    loupeOpen: LOUPE_OPEN_DEFAULT,
    loupeSpan: LOUPE_SPAN_DEFAULT,
    paletteScale: PALETTE_SCALE_DEFAULT,
  };
}

export function load(): Settings {
  return readValidated(KEYS.settings, validate, defaults());
}

export function save(settings: Settings): Result<void> {
  const written = write(KEYS.settings, settings);
  if (written.ok) writeMeta();
  return written;
}

export function reset(): void {
  remove(KEYS.settings);
}

/**
 * 値の形を確かめる。
 * 全体が object でなければ null（＝丸ごと既定値へ）。
 * 個々の項目が壊れている場合は、その項目だけ既定値で補う。
 */
function validate(raw: unknown): Settings | null {
  if (!guards.isRecord(raw)) return null;
  const d = defaults();

  return {
    locale: isLocale(raw.locale) ? raw.locale : d.locale,
    lastSize: guards.isBoardSize(raw.lastSize) ? (raw.lastSize as BoardSize) : null,
    lastDifficulty: guards.isDifficulty(raw.lastDifficulty) ? (raw.lastDifficulty as Difficulty) : null,
    zoomPreference:
      guards.isFiniteNumber(raw.zoomPreference) && raw.zoomPreference > 0 ? raw.zoomPreference : null,
    recentBufferSize: positiveOr(raw.recentBufferSize, d.recentBufferSize),
    undoLimit: positiveOr(raw.undoLimit, d.undoLimit),
    soundEnabled: typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : d.soundEnabled,
    soundVolume: volumeOr(raw.soundVolume, d.soundVolume),
    hapticEnabled: typeof raw.hapticEnabled === 'boolean' ? raw.hapticEnabled : d.hapticEnabled,
    loupeCorner: isLoupeCorner(raw.loupeCorner) ? raw.loupeCorner : d.loupeCorner,
    loupeOpen: typeof raw.loupeOpen === 'boolean' ? raw.loupeOpen : d.loupeOpen,
    loupeSpan: positiveNumberOr(raw.loupeSpan, d.loupeSpan),
    paletteScale: positiveNumberOr(raw.paletteScale, d.paletteScale),
  };
}

function isLocale(v: unknown): v is LocaleCode {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** 小数を許す正の値。ルーペの幅（0.33 など）や倍率に用いる */
function positiveNumberOr(v: unknown, fallback: number): number {
  return guards.isFiniteNumber(v) && v > 0 ? v : fallback;
}

function positiveOr(v: unknown, fallback: number): number {
  return guards.isFiniteNumber(v) && v > 0 ? Math.floor(v) : fallback;
}

function volumeOr(v: unknown, fallback: number): number {
  return guards.isFiniteNumber(v) && v >= 0 && v <= 1 ? v : fallback;
}

export const settingsStore = { load, save, reset, defaults };
