/**
 * 「保存できました」の知らせ（親 v1.40 §9.2.3 ③・付録D-8 §8）。
 *
 * **保存は成功しても画面上では何も起こらない**。押した本人には、**押したのに何も
 * 起きなかったのと区別が付かない**ので、同じ操作を繰り返したり、保存できたか
 * 分からないまま画面を離れたりする。**自動で消える表示では目を離していれば見逃す**
 * ＝見逃した側から見れば何も出なかったのと同じになる。
 *
 * したがって**本人が閉じるまで残す**。中身は**書いたファイル名と書いた場所**。
 *
 * 逆に**やめた・書けなかったの知らせは自動で消えてよい**（何も起きていないことは
 * 画面から読み取れる）。ここへは載せない。
 *
 * 置き場が core なのは、**保存の入口が 3 つある**ため（終局パネル・棋譜再生画面・
 * 棋譜を捨てる前の確認）。**同じことを 3 か所で別々に作らない**。
 */

import { create } from 'zustand';

export interface SaveNotice {
  /** 実際に書いたファイル名（連番を送ったならそれも含む）。 */
  fileName: string;
  /** 書いた場所。フォルダを指定していないときは null（分からないので出さない）。 */
  folderName: string | null;
  /**
   * 書けたことを**確かめられたか**。フォルダへ書いた場合は読み返して突き合わせて
   * いるので真。ダウンロード・共有シートは渡した先が分からないので偽＝
   * **確かめられた場合だけ断定する**（付録D-8 §8）。
   */
  verified: boolean;
}

interface SaveNoticeState {
  notice: SaveNotice | null;
}

export const useSaveNoticeStore = create<SaveNoticeState>(() => ({ notice: null }));

export function showSaveNotice(notice: SaveNotice): void {
  useSaveNoticeStore.setState({ notice });
}

export function dismissSaveNotice(): void {
  useSaveNoticeStore.setState({ notice: null });
}
