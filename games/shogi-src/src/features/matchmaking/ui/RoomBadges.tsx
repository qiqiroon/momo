import { getBadgeLabels, type RoomLabelParts } from '../roomNameCodec';

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

  const badges: { text: string; color: 'game' | 'mod' | 'custom' | 'unknown' }[] = [];
  badges.push({ text: labels.gameType[parts.gameType], color: 'game' });
  if (parts.torus) badges.push({ text: labels.torus, color: 'mod' });
  if (parts.quantum) badges.push({ text: labels.quantum, color: 'mod' });
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

function colorForBorder(c: 'game' | 'mod' | 'custom' | 'unknown'): string {
  switch (c) {
    case 'game':
      return 'var(--orange)';
    case 'mod':
      return 'var(--border-strong)';
    case 'custom':
      return 'var(--border-strong)';
    case 'unknown':
      return '#b3401a';
  }
}

function colorForText(c: 'game' | 'mod' | 'custom' | 'unknown'): string {
  switch (c) {
    case 'game':
      return 'var(--orange-light)';
    case 'mod':
      return 'var(--text)';
    case 'custom':
      return 'var(--text-muted)';
    case 'unknown':
      return '#e8836a';
  }
}

function colorForBg(c: 'game' | 'mod' | 'custom' | 'unknown'): string {
  switch (c) {
    case 'game':
      return 'var(--bg-selected)';
    case 'mod':
      return 'var(--surface2)';
    case 'custom':
      return 'var(--surface2)';
    case 'unknown':
      return 'rgba(179, 64, 26, 0.15)';
  }
}
