/**
 * 保存先フォルダ (親 v1.39 §9.2.3 ④)。
 *
 * PC のブラウザは、ユーザーが選んだ**端末のフォルダそのもの**を扱える。ここを押さえると
 * **書いた直後に読み返して突き合わせられる**＝「保存できた」と確実に言える唯一の経路になる
 * (共有シートは取り消しが分かるだけ・ダウンロードは渡した先すら分からない・§9.2.3 ③)。
 *
 * **★これはアプリ内の書庫ではない** (§9.2.1)。棋譜は 1 局 1 ファイルで端末に置かれ、
 * 一覧はそのフォルダを読んで組み立てるだけ。索引は持たない。
 *
 * **★使えるかどうかをブラウザの名乗りで判定しない** (§9.2.3 ④)。名乗りは偽装できるし、
 * 対応する環境が増えたときに取り残される。**その仕組みが実際にあるかを直接見る**。
 *
 * **★「使える」と「フォルダを受け取れた」は別**。選ぶのをやめられたときは指定なしとして扱い、
 * **その回の保存もやめた扱いにする** (v1.39・ダウンロードへ落とさない＝やめたのに保存される
 * ことになるため)。
 *
 * **★仕組みが在ることと、それが答えることも別** (2026-08-26 実機のご報告・ユーザー判断)。
 * **アプリ内蔵ブラウザは「フォルダを選べます」と名乗り、実際に呼ぶと窓が出ないまま、
 * 成功も失敗も返してこない**。待つ側は「やめた」も「失敗した」も区別できず、**利用者に
 * 何も言わないまま永久に待つ**。したがって**返事が返ってこないこと自体を 1 つの結末として
 * 扱う** ([[reference_absence_is_a_message]])＝名乗りで環境を見分けるのではなく、
 * **返ってこなかったという事実**で判断し、共有シート・ダウンロードへ落とす。
 */

/**
 * フォルダを扱う口。**標準の型定義にまだ入っていない**ので、使うぶんだけここに書く。
 * (書いた型は「こう呼ぶ」という宣言にすぎず、実際にあるかは `canUseFolder()` で見る)
 */
interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
export interface FsDirHandle {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  values(): AsyncIterableIterator<FsFileHandle | FsDirHandle>;
  queryPermission?(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'readwrite' }): Promise<PermissionState>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: {
    mode?: 'read' | 'readwrite';
    id?: string;
    startIn?: string;
  }) => Promise<FsDirHandle>;
};

/** フォルダを扱えるか。**名乗りではなく、その仕組みがあるかを直接見る** (§9.2.3 ④)。 */
export function canUseFolder(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/**
 * フォルダを用意しようとした結末。**3 つに分ける**＝呼び出し側の振る舞いが 3 通り違う。
 *
 * - `ready` … 使えるフォルダを受け取れた。
 * - `none` … **人がやめた／許可が下りない**。**その回の保存もやめる**
 *   (ダウンロードへ落とさない＝やめたのに保存されることになる・§9.2.3 ④)。
 * - `unresponsive` … **窓が出ず、返事も返ってこない**。**人はやめていない**ので、
 *   保存そのものは続け、共有シート・ダウンロードへ落とす。
 */
export type FolderResult =
  | { kind: 'ready'; dir: FsDirHandle }
  | { kind: 'none' }
  | { kind: 'unresponsive' };

/**
 * 返事を待つ上限。**窓が出ていれば人が選んでいる途中なので、この上限は使わない**
 * （下の `openWithLimit` を参照）。したがって短くてよい＝**窓が出るなら即座に出る**。
 */
const NO_ANSWER_MS = 5000;

/**
 * **この画面を開いている間だけ覚える**＝一度「返事が返ってこない環境」と分かったら、
 * 保存のたびに待ち直さない。**次に開いたときは何も引きずらない**ので、環境が直れば
 * そのまま使える。
 */
let noAnswerHere = false;

/**
 * フォルダを選ぶ窓を開き、**返事が返ってこないなら見切る**。
 *
 * ★**時間だけでは見切らない**＝PC では人が何十秒も選んでいることがあり、時間だけで
 * 打ち切ると**窓が開いたままダウンロードもされる**（二重に保存される）。**窓が出れば
 * 画面はいったん裏へ回る**ので、**裏へ回ったかどうかという実際の出来事**を見て、
 * 回っていない＝**窓が出ていない**ときだけ見切る。
 *
 * ★見切った後に窓の返事が届いても**受け取らない**（もう下へ落ちているため）。
 */
function openWithLimit(open: () => Promise<FsDirHandle>): Promise<FolderResult> {
  return new Promise((resolve) => {
    let settled = false;
    /** 画面が一度でも裏へ回ったか＝窓は出ている。 */
    let wentBackground = false;
    const noteBackground = () => {
      wentBackground = true;
    };
    const finish = (r: FolderResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('blur', noteBackground);
      clearTimeout(timer);
      resolve(r);
    };
    window.addEventListener('blur', noteBackground);
    const timer = setTimeout(() => {
      if (wentBackground) return; // 窓は出ている＝人が選んでいる途中。待ち続ける
      finish({ kind: 'unresponsive' });
    }, NO_ANSWER_MS);
    open().then(
      (dir) => finish({ kind: 'ready', dir }),
      () => finish({ kind: 'none' }), // やめた・拒まれた
    );
  });
}

// ---------------------------------------------------------------------------
// フォルダの控え。**棋譜そのものはここに置かない** (置き場は端末のフォルダ側)。
// 文字にできない相手なので、文字列しか持てない置き場ではなく箱型の置き場を使う。
// ---------------------------------------------------------------------------

const DB_NAME = 'shogi-kifu';
const STORE = 'handles';
const KEY = 'folder';

/**
 * この画面を開いている間の控え。
 * **箱型の置き場が使えない環境（シークレット等）でも、その回だけは覚えていられる**
 * ＝保存のたびにフォルダを選び直させない。読み書きも 1 回で済む。
 */
let cached: FsDirHandle | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      // 置き場が使えない環境 (シークレット等)。フォルダを覚えられないだけで、
      // 保存そのものは毎回選び直せば行える。
      resolve(null);
    }
  });
}

function readStored(): Promise<FsDirHandle | null> {
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    void openDb().then((db) => {
      if (!db) {
        resolve(null);
        return;
      }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => {
          cached = (req.result as FsDirHandle | undefined) ?? null;
          resolve(cached);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

function writeStored(dir: FsDirHandle | null): Promise<void> {
  cached = dir;
  return new Promise((resolve) => {
    void openDb().then((db) => {
      if (!db) {
        resolve();
        return;
      }
      try {
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const req = dir ? store.put(dir, KEY) : store.delete(KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

/**
 * 覚えているフォルダを忘れる。**フォルダの中のファイルには一切触らない**
 * （忘れるのはこちらの控えだけ）。いまは検査から使う。
 */
export async function forgetFolder(): Promise<void> {
  await writeStored(null);
  noAnswerHere = false;
}

/**
 * 覚えているフォルダ (**許可の確認はしない**)。
 * 名前を出すだけなら許可は要らないので、保存先の表示はこちらを使う。
 */
export async function rememberedFolder(): Promise<FsDirHandle | null> {
  if (!canUseFolder()) return null;
  return readStored();
}

/**
 * 読み書きの許可を確かめる。**足りなければ、頼んでよいときだけ頼む**。
 *
 * 許可はページを読み直すと「もう一度尋ねる」状態に戻る。頼めるのは
 * **ユーザーが押した直後**だけなので、勝手に開く場面では頼まない (`ask` を false)。
 */
async function ensurePermission(dir: FsDirHandle, ask: boolean): Promise<boolean> {
  try {
    const state = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (state === 'granted') return true;
    if (!ask || state === 'denied') return false;
    return (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * どこまで尋ねてよいか。**尋ねてよい範囲は押された場所で変わる**ので呼び出し側が決める。
 *
 * - `silent` … 何も尋ねない（すでに使える状態のときだけ返る）
 * - `permission` … **許可だけ**頼む（フォルダは選ばせない）。一覧を出すときに使う
 * - `choose` … 未指定なら**選んでもらう**。**保存のときだけ**使う（§9.2.3 ④「1 度だけ」）
 */
export type FolderAsk = 'silent' | 'permission' | 'choose';

/**
 * すぐ使えるフォルダを返す。**やめられたら null**＝呼び出し側はその回の保存をやめる
 * （§9.2.3 ④・ダウンロードへ落とさない）。
 *
 * **一覧を出すだけの場面でフォルダを選ばせない**＝押していないのに選ぶ画面が出ると、
 * 書類ピッカーを勝手に開かない決まり（画面機能 §3 S08）と同じ驚きになる。
 */
export async function usableFolder(ask: FolderAsk): Promise<FolderResult> {
  if (!canUseFolder()) return { kind: 'none' };
  const stored = await readStored();
  if (stored) {
    if (await ensurePermission(stored, ask !== 'silent')) return { kind: 'ready', dir: stored };
    // 許可が下りない＝フォルダごと消された等で実体を失っている。
    // 保存の場面だけは選び直してもらう（黙って「やめました」と言わないため）。
  }
  return ask === 'choose' ? chooseFolder() : { kind: 'none' };
}

/**
 * フォルダを選んでもらい、次からの既定として覚える。
 *
 * **やめられたときは覚えているものを消さない**＝「別のフォルダを選ぶ」を押して
 * 気が変わっただけで、いま使えているフォルダまで失うのは行き過ぎなので。
 */
export async function chooseFolder(): Promise<FolderResult> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return { kind: 'none' };
  // 一度「返事が返ってこない」と分かった環境では、待ち直さない。
  if (noAnswerHere) return { kind: 'unresponsive' };
  const got = await openWithLimit(() =>
    picker({ mode: 'readwrite', id: 'momo-shogi-kifu', startIn: 'documents' }),
  );
  if (got.kind === 'ready') await writeStored(got.dir);
  if (got.kind === 'unresponsive') noAnswerHere = true;
  return got;
}

// ---------------------------------------------------------------------------
// 書き出しと読み出し
// ---------------------------------------------------------------------------

/** 同じ名前が既にあるとき、規約どおり末尾に連番を足す (親 §9.2.2)。 */
function withSeq(fileName: string, n: number): string {
  if (n <= 1) return fileName;
  return fileName.replace(/\.json$/, `_${n}.json`);
}

/**
 * まだ誰も使っていない名前を探す。
 *
 * **既にあるファイルへ書いてはいけない**＝棋譜は 1 局 1 ファイルで、同じ分に終わった
 * 別の対局と名前がぶつかりうる。フォルダを扱える環境では**中が見える**ので、
 * ぶつかったら連番を送る (見えない環境の「この端末が出した名前を数える」やり方より確実)。
 */
async function freeName(dir: FsDirHandle, fileName: string): Promise<string> {
  for (let n = 1; n <= 99; n += 1) {
    const name = withSeq(fileName, n);
    try {
      await dir.getFileHandle(name);
    } catch {
      return name; // 無い＝使ってよい
    }
  }
  return withSeq(fileName, 99);
}

/**
 * 書き出しの結末 (io.ts と同じ言葉を使う) と、**実際に書いた名前**。
 *
 * 名前を返すのは、**保存できたことを知らせるときに出す**ため (親 §9.2.3 ③)。
 * 連番を送った場合は送ったあとの名前でないと、次に探すときの手がかりにならない。
 */
export interface FolderWriteResult {
  result: 'saved' | 'failed';
  /** 実際に書いた名前（連番を送ったならそれも含む）。書けなかったときは試みた名前。 */
  name: string;
}

/**
 * フォルダへ書き出し、**書いた直後に読み返して突き合わせる** (§9.2.3 ③)。
 *
 * 突き合わせるのは「書けたつもり」を潰すため＝**確かめられた場合だけ断定する**
 * (付録D-8 §8)。1 文字でも違えば保存できたとは言わない。
 */
export async function writeIntoFolder(
  dir: FsDirHandle,
  fileName: string,
  text: string,
): Promise<FolderWriteResult> {
  let name = fileName;
  try {
    name = await freeName(dir, fileName);
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
    const back = await (await handle.getFile()).text();
    return { result: back === text ? 'saved' : 'failed', name };
  } catch {
    return { result: 'failed', name };
  }
}

/**
 * フォルダの中身を読んで、棋譜になりうるファイルの中身を返す
 * （画面機能 §3 S08 の「一覧の中身」）。
 *
 * **索引は持たない**ので毎回読む (§9.2.1)。**棋譜かどうかの判定はここではしない**
 * ＝ここは端末のファイルを触るだけの層で、棋譜の読み方は一段上が持つ。
 */
export async function readFolderTexts(dir: FsDirHandle): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      try {
        out.push(await (await entry.getFile()).text());
      } catch {
        // 読めないファイルは飛ばす。一覧に出ないだけで、ファイルには手を触れない。
      }
    }
  } catch {
    // 途中で読めなくなったら、そこまでのぶんを返す。
  }
  return out;
}
