import { LangSelect } from './LangSelect';

/**
 * ヘッダー右端の共通ツール (v0.54 追加)。
 * 全画面 (S00/S01/S02/S04/S06/S07) の右上に統一配置する:
 *   - 歯車ボタン (設定・現状は無反応)
 *   - 言語切替 (LangSelect)
 *
 * 各画面はこれをヘッダ内の header-tools 最後尾に配置する。画面固有の
 * ボタン (メニューへ戻る / 退室 / リセット など) はこれの左に置く。
 */
export function HeaderCommonRight({ includeCat = true }: { includeCat?: boolean }) {
  return (
    <>
      <button className="gear-btn" type="button" title="設定" aria-label="設定">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <LangSelect includeCat={includeCat} />
    </>
  );
}
