// 設定（設計 05 §5）。localStorage['cube.settings.v1'] に保存し、読むときに範囲を確かめて、おかしな値は既定に戻す
// 05 §5 から外したもの：鏡の彩度・暗さ（本物の平面鏡に変えたため。HANDOVER §5.1 Q8・Q9）、
// キーの基準（画面基準だけ。パネルのキー表示まで向きに合わせて作り直す必要があるため後回し）
import type { ArrowLabelMode } from '../input/arrowActions';
import type { ViewGrid } from '../input/viewController';
import type { StorageLike } from './records';

export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  /** 層を 90° 回す時間（ms） */
  quarterMs: number;
  viewGrid: ViewGrid;
  /** 全体を手で回して離したあと、勢いで少し回り続ける */
  viewInertia: boolean;
  arrowLabels: ArrowLabelMode;
  /** 鏡 3 枚を出す（消すとキューブが大きく写り、描くのも軽くなる） */
  mirrors: boolean;
  quality: Quality;
}

export const SETTINGS_KEY = 'cube.settings.v1';

/** 回る速さの選択肢（ms）。70 が既定（利用者の指定。HANDOVER §0.1） */
export const QUARTER_MS_CHOICES = [40, 70, 150, 300] as const;
const GRIDS: readonly ViewGrid[] = [0, 15, 45, 90];
const LABELS: readonly ArrowLabelMode[] = ['auto', 'all', 'none'];
const QUALITIES: readonly Quality[] = ['auto', 'high', 'low'];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  quarterMs: 70,
  // 離すと 24 通りの向きにそろえる（2026-11-02 作者。前は「なし」）
  viewGrid: 90,
  viewInertia: false,
  arrowLabels: 'auto',
  mirrors: true,
  quality: 'auto',
};

/** 何が入っていても、使える設定に直す */
export function sanitizeSettings(x: unknown): Settings {
  const r = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  const pick = <T>(v: unknown, choices: readonly T[], def: T): T => (choices.includes(v as T) ? (v as T) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const d = DEFAULT_SETTINGS;
  return {
    quarterMs: pick(r.quarterMs, QUARTER_MS_CHOICES as readonly number[], d.quarterMs),
    viewGrid: pick(r.viewGrid, GRIDS, d.viewGrid),
    viewInertia: bool(r.viewInertia, d.viewInertia),
    arrowLabels: pick(r.arrowLabels, LABELS, d.arrowLabels),
    mirrors: bool(r.mirrors, d.mirrors),
    quality: pick(r.quality, QUALITIES, d.quality),
  };
}

export function loadSettings(storage: StorageLike | null): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: StorageLike | null, s: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても、この回の設定は効いている
  }
}

/**
 * 「動きを減らす」の端末では、回転を短くする（05 §7。0 にはしない）。
 * ただし速さを自分で選んだ（既定から変えた）ときは、その選択を優先する（慣性も、オンにしたら本人の選択として切らない）
 */
export const REDUCED_QUARTER_MS = 60;
export function effectiveQuarterMs(s: Settings, reducedMotion: boolean): number {
  return reducedMotion && s.quarterMs === DEFAULT_SETTINGS.quarterMs ? REDUCED_QUARTER_MS : s.quarterMs;
}
