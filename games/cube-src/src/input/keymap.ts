// キー割り当て（設計 04 §5.2）。変えられて、ブラウザに保存される（要求仕様 §8.3）
// 物理キーの位置（KeyboardEvent.code）で持つ。key を使うと配列や IME で壊れる
import type { Face } from '../core/types';
import type { MiddleSlice, Variant } from './screenMoves';

/** 割り当てを変えられる操作 */
export type KeyAction =
  | Face // 画面基準の面
  | MiddleSlice // 真ん中の層（N が奇数のとき）
  | 'x' | 'y' | 'z' // 全体の回転（見る向きだけ）
  | 'wide' // 先行打鍵：まとめて回す
  | 'home';

export const KEY_ACTIONS: readonly KeyAction[] = [
  'U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z', 'wide', 'home',
];

export type Keymap = Readonly<Record<KeyAction, string>>;

export const DEFAULT_KEYMAP: Keymap = {
  U: 'KeyU', D: 'KeyD', L: 'KeyL', R: 'KeyR', F: 'KeyF', B: 'KeyB',
  M: 'KeyM', E: 'KeyE', S: 'KeyS',
  x: 'KeyX', y: 'KeyY', z: 'KeyZ',
  wide: 'KeyW', home: 'Home',
};

export const KEYMAP_STORAGE_KEY = 'cube.keymap.v1';
const KEYMAP_VERSION = 1;

/**
 * 割り当てられないキー。数字は層の先行打鍵、修飾キーは逆・180° に使う。
 * Esc は面の選択を外す（M6.5）、Tab・Enter・Space はボタンの操作に要る
 */
export function isReservedCode(code: string): boolean {
  return /^(Digit\d|Numpad\d|Shift|Alt|Control|Meta|OS|CapsLock|Tab|Enter|NumpadEnter|Space|Escape|ContextMenu)/
    .test(code) || code === '' || code === 'Unidentified';
}

/** その物理キーに割り当てた操作 */
export function actionOf(keymap: Keymap, code: string): KeyAction | null {
  for (const a of KEY_ACTIONS) if (keymap[a] === code) return a;
  return null;
}

/**
 * action に code を割り当てる。code をほかの操作が使っていたら、その操作には action の元のキーを渡す（入れ替え）。
 * 入れ替えた相手を swapped で返す（画面で知らせる）
 */
export function assignKey(
  keymap: Keymap, action: KeyAction, code: string,
): { keymap: Keymap; swapped: KeyAction | null } {
  if (isReservedCode(code)) throw new RangeError(`reserved key: ${code}`);
  const other = actionOf(keymap, code);
  if (other === action) return { keymap, swapped: null };
  const next = { ...keymap, [action]: code };
  if (other) next[other] = keymap[action];
  return { keymap: next, swapped: other };
}

/** 読み込んだ値を確かめる。版が違う・壊れている・重なっている、なら既定に戻す */
export function parseKeymap(json: string | null): Keymap {
  if (!json) return DEFAULT_KEYMAP;
  try {
    const data = JSON.parse(json) as { version?: unknown; keys?: Record<string, unknown> };
    if (data.version !== KEYMAP_VERSION || typeof data.keys !== 'object' || !data.keys) return DEFAULT_KEYMAP;
    const out = { ...DEFAULT_KEYMAP };
    const used = new Set<string>();
    for (const a of KEY_ACTIONS) {
      const code = data.keys[a];
      if (typeof code !== 'string' || isReservedCode(code) || used.has(code)) return DEFAULT_KEYMAP;
      out[a] = code;
      used.add(code);
    }
    return out;
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function serializeKeymap(keymap: Keymap): string {
  return JSON.stringify({ version: KEYMAP_VERSION, keys: keymap });
}

/** ブラウザの保存場所。開けないとき（プライベートの窓など）は既定のまま動く */
export function loadKeymap(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Keymap {
  try {
    return parseKeymap(storage?.getItem(KEYMAP_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function saveKeymap(keymap: Keymap, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (sameKeymap(keymap, DEFAULT_KEYMAP)) storage?.removeItem(KEYMAP_STORAGE_KEY);
    else storage?.setItem(KEYMAP_STORAGE_KEY, serializeKeymap(keymap));
  } catch {
    // 保存できなくても、この画面の間は効く
  }
}

export function sameKeymap(a: Keymap, b: Keymap): boolean {
  return KEY_ACTIONS.every((k) => a[k] === b[k]);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ---- キーの刻印（画面に出す文字） ----

const NAMED: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlRo: 'ろ', IntlYen: '¥',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BS', Delete: 'Del',
  Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** 実際の配列での刻印（分かれば）。KeyboardLayoutMap や、押されたときの event.key で覚える */
const learned = new Map<string, string>();

export function learnKeyLabel(code: string, key: string): void {
  if (key.length === 1 && key !== ' ') learned.set(code, key.toUpperCase());
}

/** 対応するブラウザ（Chrome 系）では、配列どおりの刻印を先に読んでおく */
export async function loadLayoutLabels(): Promise<void> {
  const kb = (navigator as Navigator & {
    keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> };
  }).keyboard;
  if (!kb?.getLayoutMap) return;
  try {
    const map = await kb.getLayoutMap();
    map.forEach((key, code) => learnKeyLabel(code, key));
  } catch {
    // 使えなければ code から作る
  }
}

export function keyLabel(code: string): string {
  const l = learned.get(code);
  if (l) return l;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  return NAMED[code] ?? code;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** そのキーで同じ手を出す押し方（Shift で逆・Alt で半回転）。パネルと矢印の札が使う */
export function keyHint(code: string, variant: Variant): string {
  const k = keyLabel(code);
  if (variant === 'ccw') return `⇧${k}`;
  if (variant === 'double') return `${isMac ? '⌥' : 'Alt '}${k}`;
  return k;
}
