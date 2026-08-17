/**
 * 棋譜ファイルの書き出しと読み出し (親 §9.2.1)。
 *
 * **書き出し**は 3 通りある。**フォルダを指定できる環境（PC）はそのフォルダへ直接書き**、
 * できない環境では共有シート（iPhone・ファイルアプリの好きな場所へ置ける）か
 * ダウンロードに落ちる。どれを使うかは端末が決めるので、こちらは全部用意して
 * 使えるものを選ぶ。
 *
 * **読み出し**は書類ピッカーが選んだファイルの**複製**を受け取るだけ。
 * 置き場所は分からず、**元のファイルへ書き戻すこともできない**（親 §9.2.1）。
 * フォルダを指定した場合だけは中が見えるので、一覧はそちらから組み立てる。
 */

import { showSaveNotice } from '../../core/store/save-notice';
import { canUseFolder, usableFolder, writeIntoFolder } from './folder';
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
 * - `failed` … **やめていないのに書けなかった**（フォルダが消えた・容量が足りない等）。
 *   印は未保存のまま。**`cancelled` と分けるのは、画面で「やめました」と言わないため**
 *   ＝確かめられた場合だけ断定する（付録D-8 §8）。
 */
export type KifuSaveOutcome = 'saved' | 'cancelled' | 'failed';

/**
 * 同じ分に 2 局以上終わったときの連番 (親 §9.2.2)。
 * **フォルダを扱えない環境用**＝中が見えないので、この端末が出した名前を数えておく。
 * フォルダを扱える環境では、実際に在るファイルを見て決める（folder.ts）。
 */
const issuedNames = new Map<string, number>();

function withSeq(fileName: string, n: number): string {
  return n <= 1 ? fileName : fileName.replace(/\.json$/, `_${n}.json`);
}

function nextIssuedName(fileName: string): string {
  const used = (issuedNames.get(fileName) ?? 0) + 1;
  issuedNames.set(fileName, used);
  return withSeq(fileName, used);
}

/**
 * 棋譜を端末のファイルとして書き出す。`fileName` は連番を付けない素の名前。
 *
 * **フォルダを指定できる環境（PC）が最優先**＝そこへ直接書けば**読み返して
 * 突き合わせられる**ので、保存できたと確実に言える（§9.2.3 ③）。
 * **未指定なら 1 度だけ選んでもらい、以後は尋ねずにそのフォルダへ書く**（④）。
 *
 * **★フォルダを選ぶのをやめられたら、その回の保存もやめる**（v1.39 §9.2.3 ④）。
 * ダウンロードへ落としてはならない＝**やめたはずの保存が実行される**ことになる。
 * したがってフォルダを扱える環境では、共有シート・ダウンロードへ落ちることは無い。
 *
 * 扱えない環境では共有シート（iPhone）を先に試す。ファイルアプリの好きな場所へ
 * 置けて、iCloud のバックアップにも乗るため。
 *
 * **★共有をやめたときもダウンロードへ落としてはならない**（§9.2.3 ③）。
 * v1.40 は「取り消し」と「共有が使えない」を同じ扱いにしていたので、
 * **やめたはずの保存が実行されていた**。落とすのは共有そのものが動かない端末に限る。
 */
export async function writeKifuFile(file: KifuFile, fileName: string): Promise<KifuSaveOutcome> {
  const text = serializeKifu(file);

  if (canUseFolder()) {
    // 押された直後なので、未指定なら選んでもらってよい（§9.2.3 ④「1 度だけ」）。
    const dir = await usableFolder('choose');
    if (!dir) return 'cancelled';
    const written = await writeIntoFolder(dir, fileName, text);
    if (written.result === 'saved') {
      // **書いた場所まで言える唯一の経路**＝読み返して突き合わせたうえで名前も分かる。
      showSaveNotice({ fileName: written.name, folderName: dir.name, verified: true });
    }
    return written.result;
  }

  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  const name = nextIssuedName(fileName);
  if (typeof File !== 'undefined' && nav.share && nav.canShare) {
    const shareFile = new File([text], name, { type: 'application/json' });
    if (nav.canShare({ files: [shareFile] })) {
      try {
        await nav.share({ files: [shareFile], title: name });
        // 共有先がファイル以外 (メール等) でも「保存済み」とする。本人が意図して
        // 渡した先であり、こちらから渡り先を見分ける手段も無い (§9.2.3 ③)。
        // **どこへ置かれたかは分からない**ので、断定はしない (verified=false)。
        showSaveNotice({ fileName: name, folderName: null, verified: false });
        return 'saved';
      } catch (e) {
        // 取り消しは拒否として返ってくる。ここで止めるのが v1.40 との違い。
        if (isUserCancel(e)) return 'cancelled';
        // 取り消し以外＝共有そのものが動かなかった。下のダウンロードへ落とす。
      }
    }
  }
  downloadKifuFile(text, name);
  // ダウンロードは**渡した先すら分からない**ので断定しない (§9.2.3 ③)。
  showSaveNotice({ fileName: name, folderName: null, verified: false });
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
