import { useI18nStore } from '../store/i18n-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import { CatIcon } from './CatIcon';
import { HeaderCommonRight } from './HeaderCommonRight';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { seButton } from '../audio/se-synth';
import { DEFAULT_TIME_CONTROL, type TimeControl } from '../engine/time-control';

/**
 * オフライン対局のルール/持ち時間選択画面（v0.45 追加）。
 *
 * S00 メニューの「vs 人（オフライン）」から遷移する。
 * 対局開始時に game-store を reset() → setTimeControl() し、
 * 前回対局の残り状態（投了後の勝敗表示など）を持ち越さない。
 *
 * v0.84: 持ち時間モードパネルは S01 から撤去。ルール選択画面 (S02) で
 * 選ばれた pendingRoomConfig.timeControl をそのまま引き継ぐ。
 * v0.85: 全ハードコード日本語を i18n 化、オレンジタイトルを .lc-title 相当
 * (15px オレンジ) に、持ち時間サマリを 2 行目「持ち時間：xxx」形式に。
 */

interface OfflineRuleScreenProps {
  variant?: 'a' | 'b';
}

/** サマリ用: TimeControl を i18n 対応の短い文字列に整形 */
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

export function OfflineRuleScreen(_props: OfflineRuleScreenProps) {
  void _props;
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? _t('app.sub', 'zh') : _t('app.sub', 'en');

  const onBack = () => { seButton(); setScreen('lobby'); }; // v0.76: 家アイコンにも SE-button

  // v0.69: features/matchmaking の pendingRoomConfig からルール/時間サマリを取る (B ビルドのみ)
  const conn = pluginGet<OnlineGameConnector>('gameConnector');
  const pendingRules = conn?.getPendingRules() ?? null;
  const pendingTc = conn?.getPendingTimeControl() ?? DEFAULT_TIME_CONTROL;
  const ruleNameKey =
    pendingRules?.gameType === 'hasami' ? 's02.ruleHasami.name'
    : pendingRules?.gameType === 'shogi-custom' ? 's02.ruleCustom.name'
    : 's02.ruleHongi.name';
  const timeSummary = formatTimeSummary(pendingTc, t);

  // v0.69: S02 (rule-select) へ遷移して戻ってこられるようにする (return dest を 'offline-rule' に)
  const onEditRule = () => {
    useRouteStore.getState().setRuleSelectReturn('offline-rule');
    setScreen('rule-select');
  };

  const onStart = () => {
    seButton(); // v0.74
    // v0.69: pendingRoomConfig を activeRoomConfig に反映して S07 の getActiveRules() が
    // オフライン対局中も正しいルールを返せるようにする
    conn?.commitPendingToActive();
    const gs = useGameStore.getState();
    // v0.84: 持ち時間も pendingRoomConfig から引き継ぐ (S01 の local state は廃止)
    gs.setTimeControl(pendingTc);
    gs.reset();
    setScreen('game');
  };

  return (
    <div className="stage">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <header className="match-header">
          <CatIcon />
          <div className="title-block">
            <h1>
              <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
              <span className="ver">{t('app.ver')}</span>
            </h1>
            <div className={`subtitle${subLocale === 'zh' ? ' zh' : ''}`}>{subtitle}</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            {/* v0.71: ScreenBand 撤去に伴い「メニュー」の呼称が消えたので、家アイコン
                + 「モード選択」に統一 (メニュー画面 = モード選択画面と分かるように) */}
            <button className="reset-btn" type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('s00.modeSelect')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        {/* v0.82-v0.85: 5 種のバリアント合成画像を背景に敷いた対局ルールカード。
            v0.85: オレンジタイトルは .lc-title 相当の 15px に (視覚統一)、
            持ち時間サマリを 2 行目に「持ち時間：xxx」形式で追加、全ラベル i18n 化 */}
        <div style={{
          marginTop: 14,
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
                {pendingRules?.torusMode === 'cylinder' && <>＋{t('s04.summaryTorusCyl')}</>}
                {pendingRules?.torusMode === 'full' && <>＋{t('s04.summaryTorusFull')}</>}
                {pendingRules?.quantum && <>＋{t('s04.summaryQuantum')}</>}
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

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button className="act taunt" type="button" onClick={onStart} style={{ minWidth: 180 }}>
            {t('s01.startGame')}
          </button>
        </div>
      </div>
    </div>
  );
}
