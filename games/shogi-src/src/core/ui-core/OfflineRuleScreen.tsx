import { useState } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import { CatIcon } from './CatIcon';
import { HeaderCommonRight } from './HeaderCommonRight';
import { ScreenBand } from './ScreenBand';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import {
  DEFAULT_TIME_CONTROL,
  type TimeControl,
  type TimeControlMode,
} from '../engine/time-control';

/**
 * オフライン対局のルール/持ち時間選択画面（v0.45 追加）。
 *
 * S00 メニューの「vs 人（オフライン）」から遷移する。
 * 対局開始時に game-store を reset() → setTimeControl() し、
 * 前回対局の残り状態（投了後の勝敗表示など）を持ち越さない。
 */

interface OfflineRuleScreenProps {
  variant?: 'a' | 'b';
}

const TIME_MODES: { value: TimeControlMode; label: string; desc: string }[] = [
  { value: 'no_limit', label: '時間フリー', desc: '制限なし（既定）' },
  { value: 'byoyomi', label: '秒読み', desc: '本時間 + 一手ごとに秒読み' },
  { value: 'sudden_death', label: '切れ負け', desc: '本時間のみ・切れたら負け' },
  { value: 'fischer', label: 'フィッシャー', desc: '本時間 + 一手ごとに加算' },
];

const MAIN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '0（秒読みのみ）' },
  { value: 5 * 60, label: '5分' },
  { value: 15 * 60, label: '15分' },
  { value: 30 * 60, label: '30分' },
  { value: 60 * 60, label: '1時間' },
];
const SEC_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: '5秒' },
  { value: 10, label: '10秒' },
  { value: 30, label: '30秒' },
  { value: 60, label: '60秒' },
];

function formatMain(sec: number): string {
  if (sec === 0) return '0（秒読みのみ）';
  if (sec >= 3600) return `${sec / 3600}時間`;
  return `${sec / 60}分`;
}

export function OfflineRuleScreen(_props: OfflineRuleScreenProps) {
  void _props;
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const [tc, setTc] = useState<TimeControl>(DEFAULT_TIME_CONTROL);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const onBack = () => setScreen('lobby');

  // v0.69: features/matchmaking の pendingRoomConfig からルールサマリを取る (B ビルドのみ)
  const conn = pluginGet<OnlineGameConnector>('gameConnector');
  const pendingRules = conn?.getPendingRules() ?? null;
  const ruleNameJa =
    pendingRules?.gameType === 'hasami' ? 'はさみ将棋'
    : pendingRules?.gameType === 'shogi-custom' ? 'カスタム'
    : '本将棋';

  // v0.69: S02 (rule-select) へ遷移して戻ってこられるようにする (return dest を 'offline-rule' に)
  const onEditRule = () => {
    useRouteStore.getState().setRuleSelectReturn('offline-rule');
    setScreen('rule-select');
  };

  const onStart = () => {
    // v0.69: pendingRoomConfig を activeRoomConfig に反映して S07 の getActiveRules() が
    // オフライン対局中も正しいルールを返せるようにする
    conn?.commitPendingToActive();
    const gs = useGameStore.getState();
    gs.setTimeControl(tc);
    gs.reset();
    setScreen('game');
  };

  const pickMode = (mode: TimeControlMode) => {
    setTc((cur) => ({
      mode,
      mainSeconds: mode === 'no_limit' ? 0 : cur.mainSeconds || 15 * 60,
      byoyomiSeconds: mode === 'byoyomi' ? cur.byoyomiSeconds ?? 30 : undefined,
      incrementSeconds: mode === 'fischer' ? cur.incrementSeconds ?? 10 : undefined,
    }));
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
            <button className="reset-btn" type="button" onClick={onBack}>
              メニューへ戻る
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        <ScreenBand code="S01" name="オフライン設定" />

        {/* v0.69: 対局ルール選択 (S04 と同じ形式)。今は本将棋のみ機能するが、
            将来のルール追加時のためにここで受け皿として設置 */}
        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>対局ルール</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700 }}>{ruleNameJa}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                変則条件:{' '}
                {pendingRules && (pendingRules.torusMode !== 'none' || pendingRules.quantum) ? (
                  <>
                    {pendingRules.torusMode === 'cylinder' && <span className="chip mod">トーラス（円筒）</span>}
                    {pendingRules.torusMode === 'full' && <span className="chip mod">トーラス（完全）</span>}
                    {pendingRules.quantum && <span className="chip mod">量子</span>}
                  </>
                ) : (
                  'なし'
                )}
              </div>
            </div>
            <button className="reset-btn" type="button" onClick={onEditRule}>
              ルールを選択
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>持ち時間モード</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TIME_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className="act"
                onClick={() => pickMode(m.value)}
                style={tc.mode === m.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>

          {tc.mode !== 'no_limit' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>本時間</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MAIN_OPTIONS.filter((o) => o.value > 0 || tc.mode === 'byoyomi').map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="act"
                    onClick={() => setTc({ ...tc, mainSeconds: o.value })}
                    style={tc.mainSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tc.mode === 'byoyomi' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>秒読み（1手ごとの時間）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SEC_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="act"
                    onClick={() => setTc({ ...tc, byoyomiSeconds: o.value })}
                    style={tc.byoyomiSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tc.mode === 'fischer' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>加算（1手ごとに追加）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SEC_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="act"
                    onClick={() => setTc({ ...tc, incrementSeconds: o.value })}
                    style={tc.incrementSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            現在の設定: {TIME_MODES.find((m) => m.value === tc.mode)?.desc}
            {tc.mode !== 'no_limit' && <> (本時間 {formatMain(tc.mainSeconds)})</>}
            {tc.mode === 'byoyomi' && <> + 秒読み {tc.byoyomiSeconds}秒</>}
            {tc.mode === 'fischer' && <> + 加算 {tc.incrementSeconds}秒</>}
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
