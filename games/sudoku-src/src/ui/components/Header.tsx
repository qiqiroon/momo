/**
 * 共通ヘッダー（第3分冊 2.3 / C-32・C-33）
 *
 * 全ビューで同一の高さ・同一の内容とし、ビュー切替で再構築しない。
 * **戻る操作は置かない**（C-41）。離脱は操作パネルの「中断して戻る」に一本化する。
 *
 * 見た目は MOMO Works の app-card-design 規約に従う（version-tag は 0.28em）。
 */

import { useRef } from 'react';
import type { LocaleCode, Settings } from '../../data/types';
import { t, tBase } from '../../i18n/locale';
import type { LocaleMode } from '../../momo-lang/init';
import { APP_VERSION } from '../../version';
import { LocaleSelect } from './LocaleSelect';
import { SettingsPanel } from './SettingsPanel';

export interface HeaderProps {
  locale: LocaleCode;
  mode: LocaleMode;
  onChangeMode(mode: LocaleMode): void;
  settings: Settings;
  onChangeSettings(patch: Partial<Settings>): void;
  settingsOpen: boolean;
  onToggleSettings(): void;
  onCloseSettings(): void;
  /** 音量の変更操作を終えたときの確認再生（2.10）。設定パネルへ素通しする */
  onPreviewSound(): void;
  /** 数字ボタンの大きさを決めている最中か（C-190） */
  onSizePreview?(active: boolean): void;
  /**
   * 遊んでいるあいだの状態表示（⑪）。タイトルの横に置く。
   *
   * **幅が足りなければ自動で次の行へ落ちる**（`.header-main` の折り返し）。
   * 以前は盤面と一緒にスクロールして画面の外へ出ていたが、ここは常に画面の上端にある。
   */
  status?: React.ReactNode;
}

/** アプリアイコン（猫＋数独盤）。全言語共通（2.3） */
function AppIcon(): React.ReactElement {
  return (
    <svg className="header-cat" viewBox="-46 -50 100 110" aria-hidden="true" focusable="false">
      <g transform="rotate(-12,-12,8.3)">
        <path d="M-21.6,-14.94 L-14.549,-35.916 Q-12,-43.5 -9.451,-35.916 L-2.4,-14.94 Z" fill="#c2410c" />
      </g>
      <g transform="rotate(12,12,8.3)">
        <path d="M2.4,-14.94 L9.451,-35.916 Q12,-43.5 14.549,-35.916 L21.6,-14.94 Z" fill="#c2410c" />
      </g>
      <ellipse cx="0" cy="1.3" rx="34" ry="26" fill="#c2410c" />
      <line x1="-14" y1="1.00" x2="-33.68" y2="-2.28" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="-14" y1="6.0" x2="-33.44" y2="6.0" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="-14" y1="10.59" x2="-29.58" y2="14.26" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="-33.68" y1="-2.28" x2="-38" y2="-3" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="-33.44" y1="6.0" x2="-40" y2="6" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="-29.58" y1="14.26" x2="-37" y2="16" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="1.00" x2="33.68" y2="-2.28" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="6.0" x2="33.44" y2="6.0" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="10.59" x2="29.58" y2="14.26" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="33.68" y1="-2.28" x2="38" y2="-3" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="33.44" y1="6.0" x2="40" y2="6" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="29.58" y1="14.26" x2="37" y2="16" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="-12" cy="-3.7" rx="4.2" ry="5.6" fill="#1a0800" />
      <ellipse cx="12" cy="-3.7" rx="4.2" ry="5.6" fill="#1a0800" />
      <ellipse cx="-12" cy="-3.7" rx="2.4" ry="3.5" fill="#000" />
      <ellipse cx="12" cy="-3.7" rx="2.4" ry="3.5" fill="#000" />
      <circle cx="-10.5" cy="-5.2" r="1.0" fill="#c2410c" />
      <circle cx="13.5" cy="-5.2" r="1.0" fill="#c2410c" />
      <path
        d="M0,6.3 C-0.8,4.8 -3.5,4.8 -3.5,7.3 C-3.5,9.3 0,11.3 0,11.3 C0,11.3 3.5,9.3 3.5,7.3 C3.5,4.8 0.8,4.8 0,6.3 Z"
        fill="#000"
      />
      <line x1="0" y1="11.3" x2="0" y2="13.3" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M0,13.3 Q-5,17.3 -8,15.3" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M0,13.3 Q5,17.3 8,15.3" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      <g>
        <rect x="2" y="-2" width="48" height="48" rx="5" fill="#f4ecd8" stroke="#1a1a1a" strokeWidth="2.4" />
        <line x1="18" y1="-2" x2="18" y2="46" stroke="#1a1a1a" strokeWidth="2" />
        <line x1="34" y1="-2" x2="34" y2="46" stroke="#1a1a1a" strokeWidth="2" />
        <line x1="2" y1="14" x2="50" y2="14" stroke="#1a1a1a" strokeWidth="2" />
        <line x1="2" y1="30" x2="50" y2="30" stroke="#1a1a1a" strokeWidth="2" />
        <g transform="translate(6.25,0.75) scale(0.75)">
          <path d="M1.5,1 L8.5,1 L4.2,13" fill="none" stroke="#1a1a1a" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g transform="translate(38.25,0.75) scale(0.75)">
          <path d="M6.9,13 L6.9,1 L1.2,9.6 L9,9.6" fill="none" stroke="#1a1a1a" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g transform="translate(38.25,16.75) scale(0.75)">
          <path
            d="M2.1,11.8 Q3.3,13 5,13 Q8.4,13 8.4,7 Q8.4,1 5,1 Q1.6,1 1.6,4.3 Q1.6,7.3 5,7.3 Q7.6,7.3 8.3,5.4"
            fill="none"
            stroke="#1a1a1a"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(22.25,32.75) scale(0.75)">
          <path
            d="M1.6,4.2 Q1.6,1 5,1 Q8.4,1 8.4,4.2 Q8.4,6.6 5,9 L1.6,13 L8.6,13"
            fill="none"
            stroke="#1a1a1a"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}

export function Header({
  locale,
  mode,
  onChangeMode,
  settings,
  onChangeSettings,
  settingsOpen,
  onToggleSettings,
  onCloseSettings,
  onPreviewSound,
  onSizePreview,
  status,
}: HeaderProps): React.ReactElement {
  const gearRef = useRef<HTMLButtonElement>(null);

  return (
    <header className="app-header">
      <div className="header-top">
        <AppIcon />
        <div className="header-main">
          <div className="header-text">
            <div className="header-title">
              <span className="momo">MOMO</span>
              <span className="sudoku">Sudoku</span>
              <span className="version-tag">{APP_VERSION}</span>
            </div>
            {/* 猫語でも消さず、**猫語を選ぶ前の言語のまま**出す（⑰）。
                訳してしまうと語呂合わせの意味が消えるため、ここだけ猫語を通さない */}
            <div className={`header-sub${locale === 'zh' ? ' zh' : ''}`} data-testid="header-sub">
              {tBase('header.title.subtitle')}
            </div>
          </div>
          {status !== undefined && <div className="header-status">{status}</div>}
        </div>

        <div className="header-right">
          <button
            type="button"
            className="icon-btn"
            ref={gearRef}
            aria-label={t('header.settings.open')}
            aria-expanded={settingsOpen}
            onClick={onToggleSettings}
          >
            {/* MOMO Hanafuda と同じ意匠（⑮）。`icon-settings` を verbatim で写している */}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6 3.6 3.6 0 0 1-3.6 3.6z"
              />
            </svg>
          </button>
          <LocaleSelect mode={mode} onChange={onChangeMode} />
          {settingsOpen && (
            <SettingsPanel
              settings={settings}
              onChange={onChangeSettings}
              onPreviewSound={onPreviewSound}
              onSizePreview={onSizePreview}
              onClose={onCloseSettings}
              anchor={gearRef}
            />
          )}
        </div>
      </div>
    </header>
  );
}
