import { getBadgeLabels, type RoomLabelParts } from '../roomNameCodec';
import { formatTimeSummary } from './RuleSelectScreen';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';

/**
 * 部屋メタ情報のバッジ列。
 * decode 結果をロケール別に翻訳して表示する。
 */
interface RoomBadgesProps {
  parts: RoomLabelParts;
  locale: string;
  size?: 'sm' | 'md';
}

export function RoomBadges({ parts, locale, size = 'sm' }: RoomBadgesProps) {
  const labels = getBadgeLabels(locale);
  const fontSize = size === 'md' ? 11 : 9;
  const padding = size === 'md' ? '2px 8px' : '1px 6px';

  const badges: { text: string; color: 'game' | 'mod' | 'time' | 'custom' | 'unknown' }[] = [];
  badges.push({ text: labels.gameType[parts.gameType], color: 'game' });
  if (parts.torus) badges.push({ text: labels.torus, color: 'mod' });
  if (parts.quantum) badges.push({ text: labels.quantum, color: 'mod' });
  // v0.87: 持ち時間バッジ (T フラグで復元された場合のみ表示)
  if (parts.timeControl) {
    const tr = (k: string) => _t(k, locale as LocaleCode);
    badges.push({ text: formatTimeSummary(parts.timeControl, tr), color: 'time' });
  }
  if (parts.customRuleName) badges.push({ text: parts.customRuleName, color: 'custom' });
  for (const uf of parts.unknownFlags) badges.push({ text: uf, color: 'unknown' });

  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {badges.map((b, i) => (
        <span
          key={i}
          style={{
            fontSize,
            padding,
            borderRadius: 10,
            border: `1px solid ${colorForBorder(b.color)}`,
            color: colorForText(b.color),
            background: colorForBg(b.color),
            whiteSpace: 'nowrap',
          }}
        >
          {b.text}
        </span>
      ))}
    </span>
  );
}

// v0.87: 'time' 色 (持ち時間バッジ用) を追加。mod と同系だが少し blue-ish で区別
type BadgeColor = 'game' | 'mod' | 'time' | 'custom' | 'unknown';

function colorForBorder(c: BadgeColor): string {
  switch (c) {
    case 'game':
      return 'var(--orange)';
    case 'mod':
      return 'var(--border-strong)';
    case 'time':
      return '#4a6a8a';
    case 'custom':
      return 'var(--border-strong)';
    case 'unknown':
      return '#b3401a';
  }
}

function colorForText(c: BadgeColor): string {
  switch (c) {
    case 'game':
      return 'var(--orange-light)';
    case 'mod':
      return 'var(--text)';
    case 'time':
      return '#a8c8e8';
    case 'custom':
      return 'var(--text-muted)';
    case 'unknown':
      return '#e8836a';
  }
}

function colorForBg(c: BadgeColor): string {
  switch (c) {
    case 'game':
      return 'var(--bg-selected)';
    case 'mod':
      return 'var(--surface2)';
    case 'time':
      return 'rgba(74, 106, 138, 0.15)';
    case 'custom':
      return 'var(--surface2)';
    case 'unknown':
      return 'rgba(179, 64, 26, 0.15)';
  }
}
