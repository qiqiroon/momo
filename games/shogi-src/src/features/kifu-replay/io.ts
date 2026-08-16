/**
 * 棋譜ファイルの書き出しと読み出し (親 §9.2.1)。
 *
 * **書き出し**は 2 通りある。iPhone は共有シート (ファイルアプリの好きな場所へ置ける)、
 * PC はダウンロード。どちらを使うかは端末が決めるので、こちらは両方用意して
 * 使えるほうを選ぶ。
 *
 * **読み出し**は書類ピッカーが選んだファイルの**複製**を受け取るだけ。
 * 置き場所は分からず、**元のファイルへ書き戻すこともできない**（親 §9.2.1）。
 */

import { KIFU_FORMAT, type KifuFile } from './types';

/** 棋譜ファイルを人が読める形の JSON にする（素性が先頭に来る順で書く）。 */
export function serializeKifu(file: KifuFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * 読み込んだ中身が棋譜ファイルかどうかを確かめて返す。
 * 違うものを選んでしまったときに画面が壊れないよう、**読み込む前にここで弾く**。
 */
export function parseKifu(text: string): KifuFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('kifu:not-json');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('kifu:not-kifu');
  const f = parsed as Partial<KifuFile>;
  if (f.format !== KIFU_FORMAT) throw new Error('kifu:not-kifu');
  if (typeof f.version !== 'number') throw new Error('kifu:not-kifu');
  if (!f.meta || typeof f.meta !== 'object') throw new Error('kifu:not-kifu');
  if (!Array.isArray(f.moves)) throw new Error('kifu:not-kifu');
  return f as KifuFile;
}

/** 選ばれたファイルを読んで棋譜として解釈する。 */
export async function readKifuFile(file: Blob): Promise<KifuFile> {
  return parseKifu(await file.text());
}

/**
 * 棋譜を端末のファイルとして書き出す。
 *
 * 共有シートが使えるなら（iPhone）そちらを先に試す。ファイルアプリの好きな場所へ
 * 置けて、iCloud のバックアップにも乗るため。使えない・断られた場合はダウンロード。
 */
export async function writeKifuFile(file: KifuFile, fileName: string): Promise<void> {
  const text = serializeKifu(file);
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (typeof File !== 'undefined' && nav.share && nav.canShare) {
    const shareFile = new File([text], fileName, { type: 'application/json' });
    if (nav.canShare({ files: [shareFile] })) {
      try {
        await nav.share({ files: [shareFile], title: fileName });
        return;
      } catch {
        // 共有をやめた・使えなかった。下のダウンロードへ落とす。
        // ここで「失敗した」と伝えないのは、やめたのは操作した本人だから。
      }
    }
  }
  downloadKifuFile(text, fileName);
}

function downloadKifuFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐ消すと保存が始まる前に無効になる端末があるので、1 拍おいてから片づける。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
