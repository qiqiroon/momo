import { useRef, useState } from 'react';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { readMgfFile } from '../../../core/engine/mgf/rule-catalog';
import type { Mgf } from '../../../core/engine/mgf/types';
import { seButton } from '../../../core/audio/se-synth';
import { customRuleMatches, type CustomRuleRef } from '../replay';

interface CustomRulePromptProps {
  locale: LocaleCode;
  /**
   * 棋譜が持つルールの参照（名前+版・§9.2.6）。取り戻したいルールを人に示すのに使う。
   *
   * ★**`ref` という名前では受け取らない**＝React が部品の受け渡しで予約している名前と
   * ぶつかる（[[reference_transport_reserves_names]]）。荷物は別の名前で包んで渡す。
   */
  kifuRef: CustomRuleRef;
  /**
   * 定義ファイルを読めた（検証済み）。この定義で再生に進む。
   *
   * ★段2c: `mismatched` は**棋譜と食い違ったまま「そのまま進める」を選んだ**ことを表す
   * （§9.2.6 ③④）。**受け取った側は、この 1 局を違反を無視して並べる**。
   * **一致していたら偽**＝そのときは従来どおり、指せない手が出たら止まる。
   */
  onChoose: (mgf: Mgf, mismatched: boolean) => void;
  /** ファイル選択をやめた（棋譜は開かない）。 */
  onCancel: () => void;
}

/** 名前と版を 1 組で見せる小さな囲み。棋譜側と選んだ定義側で同じ形にする。 */
function RuleFacts({
  t,
  label,
  name,
  version,
}: {
  t: (key: string) => string;
  label?: string;
  name: string;
  version?: string;
}) {
  return (
    <div className="rulefile-facts">
      {label && <div className="rulefile-facts-label">{label}</div>}
      <div>
        <span className="rulefile-key">{t('s08.ruleFile.rule')}</span>
        <strong>{name}</strong>
      </div>
      <div style={{ marginTop: 4 }}>
        <span className="rulefile-key">{t('s08.ruleFile.version')}</span>
        <span>{version || t('s08.ruleFile.noVersion')}</span>
      </div>
    </div>
  );
}

/**
 * カスタムルールの棋譜を開くとき、**定義を取り戻すためのパネル**（§9.2.6 ②③・段2）。
 *
 * **2 段構え**にしてある：
 * 1. **定義が無い**＝ルールの名前と版を見せて、定義ファイルを選んでもらう（段2a）。
 * 2. **選んだ定義が棋譜と食い違う**＝両方の名前と版を並べて見せ、**3 択**を出す
 *    （そのまま進める／別のファイルを選ぶ／中止・段2b）。
 *
 * ★ファイル選択は**このパネルのボタンを押して開く**＝棋譜を開く操作から一続きに
 * 自動で開くと、携帯のブラウザで最初のクリックの効力が切れて開けないことがある
 * （[[reference_mobile_browser_surprises]]）。**「別のファイルを選ぶ」も新しいクリック**
 * なので、そのまま選択を開いてよい。
 *
 * ★色の決まり（付録D-3 §4.1）＝**灰色は「押せない」だけ**・**緑は使わない**。オレンジ地は
 * **1 画面に 1 つ**＝「その場を進めるために勧める手立て」に付ける。食い違いの画面では
 * **「別のファイルを選ぶ」が勧める手立て**（食い違いを解消できるのはこれだけ）なので、
 * 「そのまま進める」は白文字・白枠にしてある。
 *
 * ★段2c: **「そのまま進める」を選んだことは、そのまま呼び出し元へ伝える**（§9.2.6 ④）＝
 * 受け取った側は**このルールで指せない手も記録どおりに並べる**。パネルの側で並べ方を
 * 決めないのは、**並べ直しを持っているのは画面**だからで、ここは「人が何を選んだか」
 * だけを伝える。
 */
export function CustomRulePrompt({ locale, kifuRef, onChoose, onCancel }: CustomRulePromptProps) {
  const t = (key: string) => _t(key, locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 読めたが**棋譜と食い違った**定義。null 以外の間は 3 択を出している（§9.2.6 ③）。 */
  const [mismatch, setMismatch] = useState<Mgf | null>(null);

  const openPicker = () => {
    seButton();
    setError(null);
    setMismatch(null);
    inputRef.current?.click();
  };

  const onPicked = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const mgf = await readMgfFile(chosen); // 壊れた JSON・欠けた MGF はここで弾く
      // ★段2b: **読めただけでは進めない**。棋譜の参照と突き合わせ、食い違えば 3 択へ。
      if (customRuleMatches(kifuRef, mgf)) {
        onChoose(mgf, false);
        return;
      }
      setMismatch(mgf);
      setBusy(false);
    } catch {
      // 定義として読めないものを選んでもパネルは壊さない。言葉で伝えて選び直させる。
      setError(t('s08.ruleFile.invalid'));
      setBusy(false);
    }
  };

  return (
    <div className="lib-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="lib-panel rulefile-panel">
        <h2 className="rulefile-title">
          {t(mismatch ? 's08.ruleFile.mismatchTitle' : 's08.ruleFile.title')}
        </h2>
        <p className="rulefile-body">
          {t(mismatch ? 's08.ruleFile.mismatchBody' : 's08.ruleFile.body')}
        </p>

        <RuleFacts
          t={t}
          label={mismatch ? t('s08.ruleFile.kifuSide') : undefined}
          name={kifuRef.name}
          version={kifuRef.version}
        />
        {mismatch && (
          <RuleFacts
            t={t}
            label={t('s08.ruleFile.fileSide')}
            name={mismatch.metadata.game_name}
            version={mismatch.metadata.version}
          />
        )}

        {error && (
          <div role="alert" className="rulefile-error">
            {error}
          </div>
        )}

        <div className="rulefile-actions">
          <button type="button" className="reset-btn rulefile-plain" onClick={() => { seButton(); onCancel(); }}>
            {t(mismatch ? 's08.ruleFile.abort' : 's08.ruleFile.cancel')}
          </button>
          {mismatch && (
            <button
              type="button"
              className="reset-btn rulefile-plain"
              onClick={() => { seButton(); onChoose(mismatch, true); }}
            >
              {t('s08.ruleFile.proceed')}
            </button>
          )}
          <button type="button" className="pick-btn" disabled={busy} onClick={openPicker}>
            {t(mismatch ? 's08.ruleFile.rechoose' : 's08.ruleFile.choose')}
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
