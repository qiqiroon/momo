// 局の名前（卓の見出しと牌譜の再生の局の選択で同じ言い方にする）。
// 日本式＝「東1局」。中国式＝「第2圏 3局」（1 圏＝局の番号 4 つ。最初にアガった人が次の親のルールは局の数で数える＝段階9 手順6）
import type { GameState } from '../engine/state';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export function roundName(v: GameState, t: T): string {
  const ri = Math.max(0, v.roundIndex);
  if (v.rules?.family === 'cn') return t('roundCn', { q: Math.floor(ri / 4) + 1, n: (ri % 4) + 1 });
  return t('round', { wind: t(`roundWind${Math.floor(ri / 4) % 3}` as MessageKey), n: (ri % 4) + 1 });
}

/** 対局の長さの札（日本式＝半荘戦・東風戦／中国式＝4圏・1圏） */
export function lengthName(v: GameState, t: T): string | null {
  if (v.rules?.family === 'cn') return t('lengthCn', { q: Number(v.rules.values.length) });
  const len = v.rules?.family === 'jp' ? v.rules.values.length : undefined;
  return len === 'half' ? t('lengthHalf') : len === 'east' ? t('lengthEast') : null;
}
