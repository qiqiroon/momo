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
 * これで「S01 で選ぶ / S02 で選ぶ」の二重管理を解消。
 */

interface OfflineRuleScreenProps {
  variant?: 'a' | 'b';
}

/** サマリ用: TimeControl を「時間フリー」「秒読み・15分+30秒」等の短い日本語に整形 */
function formatTimeSummaryJa(tc: TimeControl): string {
  const fmt = (s: number) => {
    if (s <= 0) return '0';
    if (s % 60 === 0) return `${s / 60}分`;
    return `${s}秒`;
  };
  const modeLabel =
    tc.mode === 'no_limit' ? '時間フリー'
    : tc.mode === 'byoyomi' ? '秒読み'
    : tc.mode === 'fischer' ? 'フィッシャー'
    : '切れ負け';
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
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const onBack = () => { seButton(); setScreen('lobby'); }; // v0.76: 家アイコンにも SE-button

  // v0.69: features/matchmaking の pendingRoomConfig からルール/時間サマリを取る (B ビルドのみ)
  const conn = pluginGet<OnlineGameConnector>('gameConnector');
  const pendingRules = conn?.getPendingRules() ?? null;
  const pendingTc = conn?.getPendingTimeControl() ?? DEFAULT_TIME_CONTROL;
  const ruleNameJa =
    pendingRules?.gameType === 'hasami' ? 'はさみ将棋'
    : pendingRules?.gameType === 'shogi-custom' ? 'カスタム'
    : '本将棋';
  const timeSummary = formatTimeSummaryJa(pendingTc);

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

        {/* v0.69: 対局ルール選択 (S04 と同じ形式)。今は本将棋のみ機能するが、
            将来のルール追加時のためにここで受け皿として設置。
            v0.82: 5 種のバリアント合成画像を背景に敷く (横幅=カード幅、上下トリミング、
            暗色オーバーレイで画像可視度を制御)
            v0.83: 画像可視度 50%→30%、レイアウト刷新
            (ボタン左寄せ「ルール変更」/ 右に「選択中のルール：...」を大きく /
            その下に選択肢紹介文。すべて白文字で画像上に載せる)
            v0.84: 対局ルールというオレンジタイトル復活 (視覚統一)、選択中のルールに
            持ち時間サマリを追加、説明文を 2 行目 (ボタン下から) 左寄せ・font 11px に */}
        <div style={{
          marginTop: 14,
          padding: 14,
          background: `linear-gradient(rgba(17,17,17,0.7), rgba(17,17,17,0.7)), url('${import.meta.env.BASE_URL}rule-card-bg.png') center/100% auto no-repeat #111111`,
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          <div className="panel-label"><span>対局ルール</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button
              className="reset-btn"
              type="button"
              onClick={onEditRule}
              style={{ color: '#fff', flexShrink: 0 }}
            >
              ルール変更
            </button>
            <div style={{ flex: 1, minWidth: 200, fontSize: 16, color: '#fff', fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
              選択中のルール：{ruleNameJa}
              {pendingRules?.torusMode === 'cylinder' && <>＋トーラス（円筒）</>}
              {pendingRules?.torusMode === 'full' && <>＋トーラス（完全）</>}
              {pendingRules?.quantum && <>＋量子</>}
              ・{timeSummary}
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
            本将棋・はさみ将棋・カスタム将棋・トーラス将棋・量子将棋などを選択できます
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button className="act taunt" type="button" onClick={onStart} style={{ minWidth: 180 }}>
            対局開始
          </button>
        </div>
      </div>
    </div>
  );
}
