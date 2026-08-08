/**
 * 言語セレクタ（第3分冊 2.3 / C-33）
 *
 * 扱う値は表示言語ではなく**言語モード**である（`auto` を含む）。
 * モードの保存とアプリ間の引き継ぎは共通ライブラリが担う（`momo-lang/init.ts`）。
 */

import { t } from '../../i18n/locale';
import type { LocaleMode } from '../../momo-lang/init';

export interface LocaleSelectProps {
  mode: LocaleMode;
  onChange(mode: LocaleMode): void;
}

const OPTIONS: readonly { mode: LocaleMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'ja', label: '日本語' },
  { mode: 'en', label: 'EN' },
  { mode: 'zh', label: '中文' },
  { mode: 'cat', label: 'CAT' },
];

export function LocaleSelect({ mode, onChange }: LocaleSelectProps): React.ReactElement {
  return (
    <select
      className="lang-select"
      aria-label={t('header.locale.label')}
      value={mode}
      onChange={(event) => onChange(event.target.value as LocaleMode)}
    >
      {OPTIONS.map((option) => (
        <option key={option.mode} value={option.mode}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
