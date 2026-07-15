import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { useMatchmakingStore } from '../store';
import { ensureMatchmakingInit } from '../bootstrap';

/**
 * S00 トップメニュー (v0.55 でモック momo_shogi_S01_mock_v5 に追随)。
 *
 * モックとの構成:
 * - ヘッダ (共通・v0.54 で標準化済)
 * - サーバー接続状態バー (「接続中...」「接続済み」)
 * - ScreenBand「S00 · メニュー」(画面名なので維持)
 * - モック由来の見出し h2「モード選択」+ 説明文
 * - モードリスト (縦 1 列):
 *   - 対 ネット対戦 (primary・要通信)
 *   - 機 AI 対戦 (primary・Phase 3 で実装予定)
 *   - 同 vs 人 (オフライン) — impl 追加 (モックには無いが残す)
 *   - 観 ネット観戦 (未実装・見た目のみ)
 *   - 作 カスタムルール作成 (未実装・見た目のみ)
 *   - 棋 棋譜再生 (未実装・見た目のみ)
 * - フッター (アプリ紹介 + MOMO Works 内リンク)
 */
export function MenuScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const connection = useMatchmakingStore((s) => s.connection);
  const [showAiNote, setShowAiNote] = useState(false);

  // v0.55: S00 メニュー段階でシグナリング接続を先行して確立。
  // これで接続状態バーが即座に「接続中→接続済み」を反映し、
  // ネット対戦ボタンの非活性判定 (未接続時) も意味を持つ。
  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const connected = connection === 'connected' || connection === 'in_room' || connection === 'game_connected';
  const statusLabel = connected ? t('s00.connected') : t('s00.connecting');

  return (
    <div className="stage" style={{ maxWidth: 600 }}>
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
          <HeaderCommonRight />
        </div>
      </header>

      <div className={`status-bar ${connected ? 'connected' : 'connecting'}`}>
        <span className="st-dot" />
        <span>{statusLabel}</span>
      </div>

      <div className="screen-head">
        <h2>{t('s00.modeSelect')}</h2>
      </div>

      <div className="mode-list">
        {/* v0.56 で並び順を「ネット対戦 → ネット観戦 → AI 対戦 → vs 人 (オフライン対戦) →
            棋譜再生 → カスタムルール作成」に変更 */}
        <ModeRow
          glyph="対"
          primary
          disabled={!connected}
          name={t('s00.mPvp')}
          desc={t('s00.mPvpD')}
          reason={!connected ? t('s00.pvpReason') : undefined}
          onClick={() => connected && setScreen('net-lobby')}
        />
        <ModeRow
          glyph="観"
          disabled={!connected}
          name={t('s00.mWatch')}
          desc={t('s00.mWatchD')}
          reason={!connected ? t('s00.watchReason') : undefined}
          onClick={() => {
            /* v0.70: 接続時はまだ実装なし (Phase 6.8 予定)。未接続は disabled で押せない */
          }}
        />
        <ModeRow
          glyph="機"
          primary
          disabled
          name={t('s00.mAi')}
          desc={t('s00.mAiD')}
          onClick={() => setShowAiNote(true)}
        />
        <ModeRow
          glyph="同"
          name={t('s00.mOffline')}
          desc={t('s00.mOfflineD')}
          onClick={() => setScreen('offline-rule')}
        />
        <ModeRow
          glyph="棋"
          name={t('s00.mKifu')}
          desc={t('s00.mKifuD')}
          onClick={() => {
            /* 未実装・見た目のみ (Phase 9 予定) */
          }}
        />
        <ModeRow
          glyph="作"
          name={t('s00.mBuild')}
          desc={t('s00.mBuildD')}
          onClick={() => {
            /* 未実装・見た目のみ (Phase 8 予定) */
          }}
        />
      </div>

      <footer className="site-footer">
        <h2>{t('s00.footAbout')}</h2>
        <p>{t('s00.footDesc')}</p>
        <div className="foot-links">
          <a href="../../">{t('s00.footTop')}</a>
          <a href="../../games/">{t('s00.footGames')}</a>
          <a href="../../tools/">{t('s00.footTools')}</a>
        </div>
      </footer>

      {showAiNote && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowAiNote(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 10,
              padding: 20,
              maxWidth: 360,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 12 }}>
              {t('s00.aiNotYet')}
            </div>
            <button className="reset-btn" type="button" onClick={() => setShowAiNote(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ModeRowProps {
  glyph: string;
  name: string;
  desc: string;
  reason?: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ModeRow({ glyph, name, desc, reason, primary, disabled, onClick }: ModeRowProps) {
  return (
    <button
      type="button"
      className={`mode-row${primary ? ' primary' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="mode-glyph">
        <span>{glyph}</span>
      </div>
      <div className="mode-body">
        <div className="mode-name">{name}</div>
        <div className="mode-desc">{desc}</div>
        {reason && <div className="mode-reason">{reason}</div>}
      </div>
      <div className="mode-arrow" aria-hidden="true">
        {/* v0.70: モックの矢印サイズに合わせる (14→18px、stroke 2.4→2) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  );
}
