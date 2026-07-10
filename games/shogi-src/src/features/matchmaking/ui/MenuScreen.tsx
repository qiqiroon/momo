import { useState } from 'react';
import { useI18nStore, type LocaleMode } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';

/**
 * 段階 2-4.1: トップメニュー（初期画面）
 *
 * 3択の入口:
 * - vs AI       : Phase 3 で実装予定（今は disabled + モーダル案内）
 * - vs 人（デバッグ）: 現行 GameScreen（ローカル対戦）へ。将来「感想戦モード」に統合予定
 * - 通信対戦     : 'net-lobby' へ（マッチメーキング）
 */
export function MenuScreen() {
  const mode = useI18nStore((s) => s.mode);
  const locale = useI18nStore((s) => s.locale);
  const setMode = useI18nStore((s) => s.setMode);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const [showAiNote, setShowAiNote] = useState(false);

  const hasMomoLang = typeof window !== 'undefined' && 'MomoLang' in window;
  const langOptions: { value: LocaleMode; label: string }[] = [];
  if (hasMomoLang) langOptions.push({ value: 'auto', label: 'Auto' });
  langOptions.push({ value: 'ja', label: '日本語' });
  langOptions.push({ value: 'en', label: 'EN' });
  langOptions.push({ value: 'zh', label: '中文' });
  langOptions.push({ value: 'cat', label: 'CAT' });

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  return (
    <div className="stage">
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
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
            <div className="lang-select">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
              </svg>
              <select
                id="lang-select"
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as LocaleMode;
                  setMode(m);
                  if (m !== 'auto') setLocale(m);
                }}
              >
                {langOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <ScreenBand code="S00" name="メニュー" />

        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MenuButton
            title="vs AI"
            desc="コンピュータ相手に対局（Phase 3 で実装予定）"
            disabled
            onClick={() => setShowAiNote(true)}
          />
          <MenuButton
            title="vs 人（オフライン）"
            desc="同じ端末で交互に指すデバッグ用モード（将来「感想戦モード」に統合予定）"
            onClick={() => setScreen('game')}
          />
          <MenuButton
            title="通信対戦"
            desc="ネット越しに別の人と対局"
            highlight
            onClick={() => setScreen('net-lobby')}
          />
        </div>

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
                vs AI モードは Phase 3 で実装予定です
              </div>
              <button className="reset-btn" type="button" onClick={() => setShowAiNote(false)}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MenuButtonProps {
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
}

function MenuButton({ title, desc, onClick, disabled, highlight }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 18px',
        background: highlight ? 'var(--bg-selected)' : 'var(--surface)',
        border: `1px solid ${highlight ? 'var(--orange)' : 'var(--border-strong)'}`,
        borderRadius: 10,
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        cursor: 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, color: highlight ? 'var(--orange-light)' : undefined }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{desc}</div>
    </button>
  );
}
