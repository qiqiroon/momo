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
 * 書き出しの結末 (親 §9.2.3 ③)。
 *
 * - `saved` … 書き出せたと見なせる。**ダウンロードもここに入る**＝引き渡した先が
 *   分からないので確かめようがないが、印は「保存済み」とし、**記憶は残す**のが決まり
 *   （確かめられなかった場合の安全網は「記憶を消さない」ことが受け持つ）。
 * - `cancelled` … **本人がやめた**。何も書いていないので、印は未保存のままにする。
 */
export type KifuSaveOutcome = 'saved' | 'cancelled';

/**
 * 棋譜を端末のファイルとして書き出す。
 *
 * 共有シートが使えるなら（iPhone）そちらを先に試す。ファイルアプリの好きな場所へ
 * 置けて、iCloud のバックアップにも乗るため。
 *
 * **★やめたときにダウンロードへ落としてはならない**（§9.2.3 ③）。
 * v1.40 は「取り消し」と「共有が使えない」を同じ扱いにしていたので、
 * **やめたはずの保存が実行されていた**。落とすのは共有そのものが動かない端末に限る。
 */
export async function writeKifuFile(file: KifuFile, fileName: string): Promise<KifuSaveOutcome> {
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
        // 共有先がファイル以外 (メール等) でも「保存済み」とする。本人が意図して
        // 渡した先であり、こちらから渡り先を見分ける手段も無い (§9.2.3 ③)。
        return 'saved';
      } catch (e) {
        // 取り消しは拒否として返ってくる。ここで止めるのが v1.40 との違い。
        if (isUserCancel(e)) return 'cancelled';
        // 取り消し以外＝共有そのものが動かなかった。下のダウンロードへ落とす。
      }
    }
  }
  downloadKifuFile(text, fileName);
  return 'saved';
}

/**
 * 共有シートを「やめた」ときの返り方。取り消しは `AbortError` として返る。
 * 名前で見るのは、端末ごとに実体の型が違うため（型そのものは当てにできない）。
 */
function isUserCancel(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
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
