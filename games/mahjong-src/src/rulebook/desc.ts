// 役・番の説明の文（ルールブックの一覧と同じ文を使う＝2 か所に書かない）。アシストモードで役名に合わせたときに出す（段階5）
import type { Rules } from '../engine/rules';
import type { BaseLang } from '../i18n/strings';
import { cnFansOf, cnMembersOf } from './cnFan';
import { JP_YAKU, membersOf } from './jpYaku';
import { MCR_FAN_LIST, mcrMembersOf } from './mcrFan';

/** その役（番）の条件の文。ルールブックに無ければ null */
export function yakuDescOf(rules: Rules, id: string, lang: BaseLang): string | null {
  if (rules.family === 'jp') return JP_YAKU.find((e) => (membersOf(e) as string[]).includes(id))?.text[lang] ?? null;
  const scoring = rules.values.scoring;
  if (scoring === 'mcr') return MCR_FAN_LIST.find((e) => (mcrMembersOf(e) as string[]).includes(id))?.text[lang] ?? null;
  if (scoring === 'sichuan' || scoring === 'hk') return cnFansOf(scoring).find((e) => (cnMembersOf(e) as string[]).includes(id))?.text[lang] ?? null;
  return null;
}
