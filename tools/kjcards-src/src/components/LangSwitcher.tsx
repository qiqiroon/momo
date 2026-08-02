import { useI18n, type LangMode } from '../i18n/store';
import { useT } from '../i18n/store';

const MODES: LangMode[] = ['auto', 'ja', 'en', 'zh', 'cat'];

export function LangSwitcher() {
  const t = useT();
  const mode = useI18n((s) => s.mode);
  const setMode = useI18n((s) => s.setMode);
  return (
    <select
      className="kj-lang"
      value={mode}
      onChange={(e) => setMode(e.target.value as LangMode)}
      aria-label="language"
    >
      {MODES.map((m) => (
        <option key={m} value={m}>
          {t(`lang.${m}`)}
        </option>
      ))}
    </select>
  );
}
