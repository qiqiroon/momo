/**
 * 棋譜の記憶 (親 §9.2.3)。
 *
 * ブラウザが持つ棋譜は**常に 1 局分だけ**で、**空 / 未保存 / 保存済み**の 3 状態を取る。
 * **これは正本ではない**（正本は書き出したファイルの側）。保存し忘れを防ぐための控え。
 *
 * iOS の Safari は 7 日間開かないサイトのこの領域を消すが、消えても困らない
 * （困らないようにするのが「正本をファイル側に置く」§9.2.1 の狙い）。
 *
 * **★消えるのは §9.2.3 ② の破棄の契機だけ**＝新しい対局の開始と棋譜の読み込み。
 * 盤が作り直されたことを合図にしてはならない。再生も盤を作り直すので、
 * **受け皿を再生しようとすると当の受け皿が消える**（v1.40 の欠陥）。
 *
 * **★保存しても消さない**。印が「保存済み」に変わるだけで、もう一度保存でき再生もできる。
 * 書き出しの成否を確かめられない経路（ダウンロード）が残るので、これが安全網になる。
 *
 * **★中身と印は別々に持たない**（§9.2.3 ①）。二重管理は必ず食い違うので 1 つの記録にする。
 */

import type { KifuFile } from './types';
import { KIFU_FORMAT } from './types';

const KEY_LAST = 'shogi.kifu.last';

/** 記憶の 3 状態 (§9.2.3 ①)。 */
export type KifuMemoryState = 'empty' | 'unsaved' | 'saved';

export interface KifuMemory {
  file: KifuFile;
  /** ファイルとして存在すると見なせるか。真なら「保存済み」。 */
  saved: boolean;
}

/** 記憶に置く。`saved` を省くと「未保存」＝まだ書き出せていない扱い。 */
export function rememberKifu(file: KifuFile, saved = false): void {
  try {
    localStorage.setItem(KEY_LAST, JSON.stringify({ saved, file }));
  } catch {
    // 置き場が使えない環境 (シークレット・容量超過) では記憶を持たないだけ。
    // 書き出しは手動でできるので、対局そのものには影響しない。
  }
}

/** 記憶の中身と印を返す。空なら null。 */
export function loadKifuMemory(): KifuMemory | null {
  try {
    const raw = localStorage.getItem(KEY_LAST);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    // v1.40 は棋譜だけを裸で置いていた。印が無いので「未保存」として拾う。
    if ((parsed as KifuFile).format === KIFU_FORMAT) {
      return { file: parsed as KifuFile, saved: false };
    }

    const m = parsed as Partial<KifuMemory>;
    if (!m.file || (m.file as KifuFile).format !== KIFU_FORMAT) return null;
    return { file: m.file as KifuFile, saved: m.saved === true };
  } catch {
    return null;
  }
}

/** いまの状態。画面はこれを見て「保存しますか」を出すかどうかを決める (§9.2.3 ②)。 */
export function kifuMemoryState(): KifuMemoryState {
  const m = loadKifuMemory();
  if (!m) return 'empty';
  return m.saved ? 'saved' : 'unsaved';
}

/** 記憶している棋譜そのもの (印は見ない)。 */
export function loadLastKifu(): KifuFile | null {
  return loadKifuMemory()?.file ?? null;
}

/**
 * 「保存済み」の印を付ける。**中身は消さない**（§9.2.3 ①）。
 * 記憶が空のときは何もしない（印だけが宙に浮く状態を作らない）。
 */
export function markKifuSaved(): void {
  const m = loadKifuMemory();
  if (!m) return;
  rememberKifu(m.file, true);
}

/**
 * 記憶を捨てる。**呼んでよいのは §9.2.3 ② の破棄の契機だけ**
 * ＝新しい対局の開始（S02 / S03 / S05 へ入るとき・「もう一度対局」・リセット）と
 * 棋譜ファイルの読み込み。未保存なら、**呼ぶ前に画面側で確認を取ること**。
 */
export function discardKifu(): void {
  try {
    localStorage.removeItem(KEY_LAST);
  } catch {
    // 消せなくても、次の破棄の契機か終局で置き換わる。
  }
}
