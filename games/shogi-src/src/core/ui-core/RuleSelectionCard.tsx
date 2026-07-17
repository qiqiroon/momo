import { useI18nStore } from '../store/i18n-store';
import { t as _t } from '../i18n';
import type { TimeControl } from '../engine/time-control';

/**
 * v0.86: 対局ルール選択サブカード (S01 オフライン設定 / S04 通信対戦ロビー 部屋作成で共用)。
 *
 * 5 種のバリアント合成画像を背景に敷き、暗色オーバーレイで画像可視度 30% 相当に。
 * オレンジタイトル (lc-title 相当) + ルール変更ボタン (左) + 選択中ルール/持ち時間 (右) +
 * 選択肢紹介文 (下) のレイアウト。
 *
 * v0.86 で S01 内から共通コンポーネントに抽出し、S04 の「部屋を作る」パネル内にも
 * サブカードとして配置できるようにした。
 */
export interface RuleSelectionCardProps {
  gameType: 'shogi' | 'hasami' | 'shogi-custom';
  torusMode: 'none' | 'cylinder' | 'full';
  quantum: boolean;
  timeControl: TimeControl;
  onEditRule: () => void;
}

/** TimeControl を i18n 対応の短い文字列に整形 */
function formatTimeSummary(tc: TimeControl, tr: (k: string) => string): string {
  const min = tr('time.min');
  const sec = tr('time.sec');
  const fmt = (s: number) => {
    if (s <= 0) return '0';
    if (s % 60 === 0) return `${s / 60}${min}`;
    return `${s}${sec}`;
  };
  const modeLabel =
    tc.mode === 'no_limit' ? tr('s04.timeFree')
    : tc.mode === 'byoyomi' ? tr('s04.timeByoyomi')
    : tc.mode === 'fischer' ? tr('s04.timeIncrement')
    : tr('s04.timeBoth');
  if (tc.mode === 'no_limit') return modeLabel;
  const parts = [modeLabel, fmt(tc.mainSeconds)];
  if (tc.mode === 'byoyomi' && tc.byoyomiSeconds !== undefined) parts.push(`+${fmt(tc.byoyomiSeconds)}`);
  if (tc.mode === 'fischer' && tc.incrementSeconds !== undefined) parts.push(`+${fmt(tc.incrementSeconds)}`);
  return parts.join('・');
}

export function RuleSelectionCard({ gameType, torusMode, quantum, timeControl, onEditRule }: RuleSelectionCardProps) {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);

  const ruleNameKey =
    gameType === 'hasami' ? 's02.ruleHasami.name'
    : gameType === 'shogi-custom' ? 's02.ruleCustom.name'
    : 's02.ruleHongi.name';
  const timeSummary = formatTimeSummary(timeControl, t);

  return (
    <div style={{
      padding: 14,
      background: `linear-gradient(rgba(17,17,17,0.7), rgba(17,17,17,0.7)), url('${import.meta.env.BASE_URL}rule-card-bg.png') center/100% auto no-repeat #111111`,
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--orange)', margin: '0 0 12px', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
        {t('s04.lblRule')}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <button
          className="reset-btn"
          type="button"
          onClick={onEditRule}
          style={{ color: '#fff', flexShrink: 0, marginTop: 2 }}
        >
          {t('s01.editRule')}
        </button>
        <div style={{ flex: 1, minWidth: 200, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {t('s01.selectedRule')}：{t(ruleNameKey)}
            {torusMode === 'cylinder' && <>＋{t('s04.summaryTorusCyl')}</>}
            {torusMode === 'full' && <>＋{t('s04.summaryTorusFull')}</>}
            {quantum && <>＋{t('s04.summaryQuantum')}</>}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            {t('s04.lblTime')}：{timeSummary}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
        {t('s01.description')}
      </div>
    </div>
  );
}
