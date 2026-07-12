import { useI18nStore, type LocaleMode } from '../store/i18n-store';

/**
 * 共通言語切替セレクトボックス（段階 v0.31 新設）。
 * MenuScreen / LobbyScreen / RuleSelectScreen / RoomScreen / GameScreen で
 * 右上に配置して 4 言語 + Auto + CAT の切替を提供する。
 *
 * @param includeCat true のとき CAT オプションを表示（features/cat-lang が
 *   有効な B ビルドのみ）。A ビルドの main-a.tsx から呼ばれる画面では
 *   false を指定して CAT を除く。
 */
export function LangSelect({ includeCat }: { includeCat: boolean }) {
  const mode = useI18nStore((s) => s.mode);
  const setMode = useI18nStore((s) => s.setMode);
  const setLocale = useI18nStore((s) => s.setLocale);

  const hasMomoLang = typeof window !== 'undefined' && 'MomoLang' in window;
  const options: { value: LocaleMode; label: string }[] = [];
  if (hasMomoLang) options.push({ value: 'auto', label: 'Auto' });
  options.push({ value: 'ja', label: '日本語' });
  options.push({ value: 'en', label: 'EN' });
  options.push({ value: 'zh', label: '中文' });
  if (includeCat) options.push({ value: 'cat', label: 'CAT' });

  return (
    <div className="lang-select">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
      </svg>
      <select
        value={mode}
        onChange={(e) => {
          const m = e.target.value as LocaleMode;
          setMode(m);
          if (m !== 'auto') setLocale(m);
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
