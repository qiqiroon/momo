import { useEffect } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { useAiStore } from '../../../core/store/ai-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { useMatchmakingStore } from '../store';
import { ensureMatchmakingInit } from '../bootstrap';
import { seButton } from '../../../core/audio/se-synth';
import { get as pluginGet } from '../../../core/plugin/registry';

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
 *   - 機 AI 対戦 (primary・Phase 3-1 で開通。設定画面 S03 ができるまではオフライン
 *     対局のルール選択画面を流用し、人が先手・AI が後手で始まる)
 *   - 同 vs 人 (オフライン) — impl 追加 (モックには無いが残す)
 *   - 観 ネット観戦 (★v1.55 で開通＝観戦ロビー S13 へ。それまでは見た目のみだった)
 *   - 作 カスタムルール作成 (未実装・見た目のみ)
 *   - 棋 棋譜再生 (S08 へ遷移・v1.41 で開通)
 * - フッター (アプリ紹介 + MOMO Works 内リンク)
 */
export function MenuScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const connection = useMatchmakingStore((s) => s.connection);

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
            // ★v1.55 (親 §6.8・画面機能 v0.49 §3 S01): 観戦ロビー (S13) へ入る。
            // **v1.54 までの「押しても何も起きない (準備中)」は撤回**＝観戦は本機能。
            // **入り口はここだけ**＝ネット対戦の一覧 (S04) から観戦へは入らない
            // (部屋は用途で入り口を切り分ける・親 §9.4.4)。
            if (connected) setScreen('spectate-lobby');
          }}
        />
        <ModeRow
          glyph="機"
          primary
          name={t('s00.mAi')}
          desc={t('s00.mAiD')}
          onClick={() => {
            // Phase 3-2: 対AI設定画面 (S03) へ入る。先後・AI の選択はそこで行う。
            // ルールと持ち時間は S03 のルールカードの「変更」から S02 へ行って決める
            // (付録 D-5 §3 の変更導線)。オフライン対人と同じ入り方。
            useAiStore.getState().startVsAi({ aiSide: 'player2' });
            useRouteStore.getState().setRuleSelectReturn('ai-setup');
            setScreen('ai-setup');
          }}
        />
        <ModeRow
          glyph="同"
          name={t('s00.mOffline')}
          desc={t('s00.mOfflineD')}
          onClick={() => {
            useAiStore.getState().stopVsAi();
            setScreen('offline-rule');
          }}
        />
        <ModeRow
          glyph="棋"
          name={t('s00.mKifu')}
          desc={t('s00.mKifuD')}
          onClick={() => {
            // 棋譜再生 (S08)。**新しい対局ではない**ので棋譜の確認は挟まない
            // (親 §9.2.3 ②)。記憶が空でも画面は開く＝そこが読み込みの入口で、
            // 書類ピッカーをやめたときの行き先でもある (画面機能 §3 S08)。
            // 棋譜の機能を積んでいないビルドでは口が無く、押しても何も起きない。
            pluginGet<(from: 'lobby' | 'game') => void>('kifu:open')?.('lobby');
          }}
        />
        <ModeRow
          glyph="感"
          name={t('s00.mReview')}
          desc={t('s00.mReviewD')}
          onClick={() => {
            // ★v1.54: 感想戦ロビー (S12) へ入る（親 v1.48 §9.4.1）。
            // **ここでは振り返る 1 局を決めない**＝ひとりで始める／部屋を作る／
            // 部屋に入るを選ぶだけ。棋譜は S11 へ入るときに決まり、**無ければ
            // 初期配置で入って中で読み込む**。
            // 新しい対局ではないので棋譜の確認は挟まない（§9.2.3 ②・§9.4.3）。
            setScreen('review-lobby');
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
      onClick={() => { seButton(); onClick(); }}
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
