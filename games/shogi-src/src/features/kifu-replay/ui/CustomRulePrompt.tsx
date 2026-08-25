import { useRef, useState } from 'react';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { readMgfFile } from '../../../core/engine/mgf/rule-catalog';
import type { Mgf } from '../../../core/engine/mgf/types';
import { seButton } from '../../../core/audio/se-synth';
import type { CustomRuleRef } from '../replay';

interface CustomRulePromptProps {
  locale: LocaleCode;
  /** 棋譜が持つルールの参照（名前+版・§9.2.6）。取り戻したいルールを人に示すのに使う。 */
  ref: CustomRuleRef;
  /** 定義ファイルを読めた（検証済み）。この定義で再生に進む。 */
  onChoose: (mgf: Mgf) => void;
  /** ファイル選択をやめた（棋譜は開かない）。 */
  onCancel: () => void;
}

/**
 * カスタムルールの棋譜を開こうとしたが、**公式一覧にも手元にも定義が無い**ときに出す
 * パネル（§9.2.6 ②・段2）。**ルールの名前と版を見せて、定義ファイルを選んでもらう**。
 *
 * ★ファイル選択は**このパネルのボタンを押して開く**＝棋譜を開く操作から一続きに
 * 自動で開くと、携帯のブラウザで最初のクリックの効力が切れて開けないことがある
 * （[[reference_mobile_browser_surprises]]）。新しいクリックで開く。
 *
 * ★色の決まり（付録D-3 §4.1）＝**灰色は「押せない」だけ**・**緑は使わない**。主動作
 * （定義ファイルを選ぶ）だけオレンジ地、そのほかは白文字・白枠。
 *
 * 段2b で、選んだファイルが棋譜の参照と食い違ったときの 3 択（そのまま進める／選び直す／
 * 中止）をこのパネルに足す。
 */
export function CustomRulePrompt({ locale, ref, onChoose, onCancel }: CustomRulePromptProps) {
  const t = (key: string) => _t(key, locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPicked = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const mgf = await readMgfFile(chosen); // 壊れた JSON・欠けた MGF はここで弾く
      onChoose(mgf);
    } catch {
      // 定義として読めないものを選んでもパネルは壊さない。言葉で伝えて選び直させる。
      setError(t('s08.ruleFile.invalid'));
      setBusy(false);
    }
  };

  return (
    <div className="lib-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="lib-panel" style={{ maxWidth: 420, padding: 20 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: '1.05rem' }}>{t('s08.ruleFile.title')}</h2>
        <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>{t('s08.ruleFile.body')}</p>

        <div style={{ margin: '0 0 16px', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.06)' }}>
          <div>
            <span style={{ opacity: 0.7, marginRight: 6 }}>{t('s08.ruleFile.rule')}</span>
            <strong>{ref.name}</strong>
          </div>
          {ref.version && (
            <div style={{ marginTop: 4 }}>
              <span style={{ opacity: 0.7, marginRight: 6 }}>{t('s08.ruleFile.version')}</span>
              <span>{ref.version}</span>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" style={{ margin: '0 0 12px', padding: 10, borderRadius: 8, background: 'rgba(180,40,40,0.15)', color: 'var(--orange, #e07a3a)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="reset-btn"
            style={{ color: '#fff' }}
            onClick={() => { seButton(); onCancel(); }}
          >
            {t('s08.ruleFile.cancel')}
          </button>
          <button
            type="button"
            className="pick-btn"
            disabled={busy}
            onClick={() => { seButton(); inputRef.current?.click(); }}
          >
            {t('s08.ruleFile.choose')}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void onPicked(e.currentTarget)}
        />
      </div>
    </div>
  );
}
