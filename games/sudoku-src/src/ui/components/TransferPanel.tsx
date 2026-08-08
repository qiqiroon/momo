/**
 * データの保存・読み込み（第3分冊 2.8 / C-36 / C-187）
 *
 * 読み込みは**検証してから上書き確認ダイアログ**を出す（D-04）。承諾までは既存データを変えない。
 *
 * **保存と同じ窓口でファイルを選ばせる**（C-187）。そうすると保存した場所が開く。
 * 窓口を持たない環境では、隠してある従来のファイル選択へ落とす。
 */

import { useRef } from 'react';
import { t } from '../../i18n/locale';
import { transferService } from '../../storage/transfer';

export interface TransferPanelProps {
  onExport(): void;
  /** 検証を通ったファイルを渡す。上書き確認は呼び出し側が出す */
  onPickFile(file: File): void;
}

export function TransferPanel({ onExport, onPickFile }: TransferPanelProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  const onImport = async (): Promise<void> => {
    // 窓口があればそちら。**保存と同じ合言葉なので同じフォルダが開く**
    if (typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function') {
      const file = await transferService.pickImportFile();
      if (file) onPickFile(file);
      return;
    }
    inputRef.current?.click();
  };

  return (
    <section className="panel-block transfer-block">
      <button type="button" className="btn" onClick={onExport}>
        {t('title.transfer.export')}
      </button>
      <button type="button" className="btn" onClick={() => void onImport()}>
        {t('title.transfer.import')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        aria-label={t('title.transfer.import')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 同じファイルを続けて選べるように値を空へ戻す
          event.target.value = '';
          if (file) onPickFile(file);
        }}
      />
    </section>
  );
}
