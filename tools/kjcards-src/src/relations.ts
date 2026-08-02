// ── 関係パレット（概要設計書 v0.02 §4.4）
//   平易語(厳密語) を3グループ×3〜4＝計10種。UIでは3グループに区切って全て一覧表示し（隠さない）、
//   加えて自由記述欄を置く（発想の一覧性を保つ）。

import type { RelationFamily } from './types';

export interface RelationPreset {
  /** 保存・受け渡しに使うラベル文字列（平易(厳密) 形式） */
  label: string;
  family: RelationFamily;
  /** 意味（UIのツールチップ／一覧の説明） */
  meaning: string;
}

/** UIのグループ見出し（family → 見出し語）。i18n キーは lang 側で解決 */
export const RELATION_FAMILIES: RelationFamily[] = ['つづく', 'ぶつかる', '支える'];

export const RELATION_PRESETS: RelationPreset[] = [
  { label: 'だから(順接)', family: 'つづく', meaning: '順当に続く・原因と結果' },
  { label: 'それに(添加)', family: 'つづく', meaning: '同じ向きに足す' },
  { label: 'つまり(換言)', family: 'つづく', meaning: '言い換え・要約' },
  { label: 'まず→つぎに(順序)', family: 'つづく', meaning: '順番・段取り・時系列' },
  { label: 'でも(逆接)', family: 'ぶつかる', meaning: '逆・反対' },
  { label: 'くらべて(対比)', family: 'ぶつかる', meaning: '2つを並べて見比べる' },
  { label: 'または(選択)', family: 'ぶつかる', meaning: 'どちらか（OR）' },
  { label: 'なぜなら(理由)', family: '支える', meaning: '後ろが前の理由' },
  { label: 'たとえば(例示)', family: '支える', meaning: '後ろが前の具体例' },
  { label: 'くわしく(詳細)', family: '支える', meaning: 'さらに細かく説明' },
];

export function presetsByFamily(family: RelationFamily): RelationPreset[] {
  return RELATION_PRESETS.filter((p) => p.family === family);
}
