import { useState } from 'react';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { seButton } from '../../../core/audio/se-synth';
import type { KifuFile } from '../types';
import type { KifuMemoryState } from '../storage';
import { kifuLabels, type SortKey } from './labels';

interface KifuListModalProps {
  locale: LocaleCode;
  /** 記憶している 1 局（空なら null）。**一覧の先頭に固定**する。 */
  remembered: KifuFile | null;
  rememberedState: KifuMemoryState;
  /** この画面で読み込んだぶん。画面を離れると空に戻る（端末のファイルは残る）。 */
  loaded: KifuFile[];
  onPick: (file: KifuFile) => void;
  /** 「棋譜を読み込む」。**確認を通してから**書類ピッカーを開くこと。 */
  onRequestLoad: () => void;
  onSave: (file: KifuFile) => void;
  saving: boolean;
  onClose: () => void;
}

/**
 * 棋譜一覧（S08・付録D-8 v1.3 §7・画面機能 v0.31 §3 S08）。
 *
 * **1 ペイン**（上の帯＋一覧）。v1.2 までの「フォルダ列＋一覧」の 2 ペインは撤回されている
 * ＝アプリの中に棋譜の書庫を持たないので、フォルダ列に対応する実体が無い（親 §9.2.1）。
 * **モックはまだ 2 ペインのままなので参照しない**（文書とモックが食い違ったら文書が正しい）。
 *
 * **フォルダ指定あり／なしを 1 画面で扱う**のが決まりだが、フォルダの指定そのものは
 * 未実装（親 §9.2.3 ④）なので、現状は常に「指定なし」の姿になる。行の形・並べ替え・
 * 読み込みの操作は両者で同じにする決まりなので、**画面を 2 種類作らない**。
 *
 * **★書類ピッカーは押されるまで開かない**（画面機能 §3 S08）。勝手に開くと、
 * 受け皿の棋譜が隠れ、やめたときの行き先も失われる。
 */
export function KifuListModal({
  locale,
  remembered,
  rememberedState,
  loaded,
  onPick,
  onRequestLoad,
  onSave,
  saving,
  onClose,
}: KifuListModalProps) {
  const t = (key: string) => _t(key, locale);
  const [sort, setSort] = useState<SortKey>('date');
  const labels = kifuLabels(locale);

  const rows = [...loaded].sort(labels.comparator(sort));
  const empty = !remembered && rows.length === 0;

  return (
    <div
      className="lib-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lib-panel">
        <div className="lib-head">
          <span className="t">{t('s08.listTitle')}</span>
          <span className="sp" />
          <button type="button" className="lib-close" onClick={() => { seButton(); onClose(); }}>
            ✕
          </button>
        </div>

        {/* 上の帯。フォルダ指定なしの姿＝入口は「棋譜を読み込む」だけ。
            空のときは唯一の入口になるので中央に大きく置く（付録D-8 §7）。 */}
        <div className={`lib-bar${empty ? ' only-load' : ''}`}>
          {!empty && <span className="sp" />}
          <button
            type="button"
            className="pick-btn"
            onClick={() => {
              seButton();
              // **開く前に確認する**（親 §9.2.3 ②）。読み込みは破棄の契機なので、
              // 未保存の棋譜があれば「保存する／破棄する／やめる」を尋ねる。
              onRequestLoad();
            }}
          >
            {t('s08.load')}
          </button>
        </div>

        {/* 並べ替え。件数が少ないうちは実効が薄いが、**画面を 2 種類作らない**ため
            フォルダ指定なしでも同じ列を出す（付録D-8 §7）。 */}
        {rows.length > 1 && (
          <div className="lib-sort">
            {(['date', 'opponent', 'rule', 'result'] as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                className={sort === k ? 'on' : ''}
                onClick={() => setSort(k)}
              >
                {t(`s08.sort${k.charAt(0).toUpperCase()}${k.slice(1)}`)}
              </button>
            ))}
          </div>
        )}

        <div className="lib-list">
          {empty && <div className="lib-empty">{t('s08.empty')}</div>}

          {/* 記憶している 1 局は先頭に固定し、区切り線で下と分ける（付録D-8 §7）。 */}
          {remembered && (
            <>
              <KifuRow
                file={remembered}
                locale={locale}
                unsaved={rememberedState === 'unsaved'}
                onPick={() => onPick(remembered)}
                onSave={() => onSave(remembered)}
                saving={saving}
              />
              {rows.length > 0 && <div className="lib-sep" />}
            </>
          )}

          {rows.map((f, i) => (
            <KifuRow
              key={`${f.meta.savedAt}-${i}`}
              file={f}
              locale={locale}
              unsaved={false}
              onPick={() => onPick(f)}
            />
          ))}
        </div>

        <div className="lib-foot">{t('s08.formats')}</div>
      </div>
    </div>
  );
}

/**
 * 一覧の 1 行。**中身は棋譜ファイル先頭の素性から組み立てる**（親 §9.2.2）。
 * ファイル名からは読み戻さない＝名前はユーザーが自由に変えられるので正本ではない。
 */
function KifuRow({
  file,
  locale,
  unsaved,
  onPick,
  onSave,
  saving,
}: {
  file: KifuFile;
  locale: LocaleCode;
  unsaved: boolean;
  onPick: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  const t = (key: string) => _t(key, locale);
  const labels = kifuLabels(locale);
  return (
    <div className="kcard" onClick={onPick} role="button">
      {/* 未保存の印。保存済み・読み込んだものには付けない（付録D-8 §7）。 */}
      {unsaved && <span className="dot" />}
      <span className="col">
        <span className="r1">
          <span className="rn">{labels.ruleName(file)}</span>
          {labels.modifiers(file).map((m) => (
            <span key={m} className="mod-badge">
              {m}
            </span>
          ))}
          {unsaved && <span className="mod-badge">{t('s08.unsaved')}</span>}
        </span>
        <span className="r2">
          <span>{labels.players(file)}</span>
          <span>{labels.date(file)}</span>
          <span>{labels.result(file)}</span>
        </span>
      </span>
      {/* **保存済みでもボタンは残す**＝もう一度書き出せる（親 §9.2.3 ①）。 */}
      {onSave && (
        <button
          type="button"
          className="save-btn"
          disabled={saving}
          onClick={(e) => {
            e.stopPropagation();
            seButton();
            onSave();
          }}
        >
          {t('s08.save')}
        </button>
      )}
    </div>
  );
}
