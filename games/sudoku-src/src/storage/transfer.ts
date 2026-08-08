/**
 * エクスポート／インポート（第1分冊 3.7 / 4.12）
 *
 * ブラウザストレージの消失に備えた退避。チャンクキャッシュは対象外（再取得できるため）。
 * 取り込みは**全置換**とする（統計の重複計上を避けるため）。
 */

import { STORAGE_VERSION } from '../data/config';
import { err, guards, ok, type ExportBundle, type Result } from '../data/types';
import { APP_VERSION } from '../version';
import { KEYS, remove, write, writeMeta } from './localStore';
import { recentStore } from './recentStore';
import { sessionStore } from './sessionStore';
import { settingsStore } from './settingsStore';
import { statsStore } from './statsStore';

export function buildBundle(): Result<ExportBundle> {
  return ok({
    format: 'momo-sudoku-backup',
    storageVersion: STORAGE_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settingsStore.load(),
    stats: statsStore.load(),
    recent: recentStore.load(),
    session: sessionStore.load(),
  });
}

export function fileName(at: Date): string {
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  const stamp =
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `momo-sudoku-backup_${stamp}.json`;
}

/**
 * 保存と読み込みが**同じ場所を覚えるための合言葉**（C-187）
 *
 * ブラウザはこの名前ごとに「最後に使ったフォルダ」を覚える。
 * **保存と読み込みで同じ名前を使うから、2回目から同じ場所が開く。**
 * 段階7 までは、保存＝ダウンロード（場所を訊かない）・読み込み＝ファイル選択、と
 * 仕組みそのものが別だったため、同じ場所になりようがなかった。
 */
const PICKER_ID = 'momo-sudoku-backup';

/** 保存・読み込みの共通の絞り込み。拡張子を揃えておくと選ぶときに迷わない */
const PICKER_TYPES = [
  { description: 'MOMO Sudoku', accept: { 'application/json': ['.json'] as string[] } },
];

/** 保存先を選ばせる窓口があるか。**判定は API の有無のみ**とし、ブラウザ名で分けない */
interface FilePickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<{
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
  showOpenFilePicker?: (options: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
}

function picker(): FilePickerWindow {
  return typeof window === 'undefined' ? {} : (window as unknown as FilePickerWindow);
}

/**
 * 環境に応じて出力する（3.7.4 / C-187）。
 * 判定は User-Agent ではなく**API の存在**による。
 *
 * 順に、**保存先を選ばせる窓口 → 共有シート → ダウンロード**を試す。
 * 最初のものだけが場所を覚えるので、対応する環境（PC の Chrome / Edge）では
 * **読み込みと同じフォルダが開く**。対応しない環境では従来どおり訊かずに保存する。
 */
export async function exportBundle(): Promise<Result<void>> {
  const built = buildBundle();
  if (!built.ok) return built;

  const text = JSON.stringify(built.value, null, 2);
  const name = fileName(new Date());

  const saved = await saveViaPicker(text, name);
  if (saved === 'ok') return ok(undefined);
  // **取り消しは失敗ではない。** 利用者が閉じたのだから、代わりに勝手に保存してはいけない
  if (saved === 'cancelled') return ok(undefined);

  if (await shareFile(text, name)) return ok(undefined);
  if (downloadFile(text, name)) return ok(undefined);
  return err('STORAGE_UNAVAILABLE', 'エクスポートの出力経路が無い');
}

/**
 * 読み込むファイルを選ばせる（C-187）。
 * **保存と同じ合言葉を使う**ので、保存した場所が開く。
 * 窓口が無い環境では `null` を返し、呼び出し側が従来のファイル選択へ落とす。
 */
export async function pickImportFile(): Promise<File | null> {
  const show = picker().showOpenFilePicker;
  if (typeof show !== 'function') return null;
  try {
    const handles = await show({
      id: PICKER_ID,
      types: PICKER_TYPES,
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const handle = handles[0];
    return handle ? await handle.getFile() : null;
  } catch {
    // 取り消しもここへ来る。**従来経路へ落とさない**（落とすと選び直しが二度出る）
    return null;
  }
}

/** 保存先を選ばせて書く。窓口が無ければ `unsupported` */
async function saveViaPicker(text: string, name: string): Promise<'ok' | 'cancelled' | 'unsupported'> {
  const show = picker().showSaveFilePicker;
  if (typeof show !== 'function') return 'unsupported';
  try {
    const handle = await show({ id: PICKER_ID, suggestedName: name, types: PICKER_TYPES });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return 'ok';
  } catch {
    return 'cancelled';
  }
}

async function shareFile(text: string, name: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    // 細かいポインタを持つ環境（PC）はダウンロードを既定とする
    if (typeof matchMedia === 'function' && !matchMedia('(pointer: coarse)').matches) return false;

    const file = new File([text], name, { type: 'application/json' });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file] });
    return true;
  } catch {
    return false;
  }
}

function downloadFile(text: string, name: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * ファイルを読んで検証するだけで、**既存データには一切触れない**。
 * UI は上書き確認ダイアログの前にこれを使う（第3分冊 2.8）。
 */
export async function readBundle(file: File): Promise<Result<ExportBundle>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFileText(file)) as unknown;
  } catch {
    return err('DATA_INVALID', '取り込んだファイルを JSON として読めない');
  }
  return validate(raw);
}

/** 検証済みの内容で全置換する（3.7.5）。承諾を得たあとに呼ぶ */
export function applyBundle(bundle: ExportBundle): void {
  write(KEYS.settings, bundle.settings);
  write(KEYS.stats, bundle.stats);
  write(KEYS.recent, bundle.recent);
  if (bundle.session === null) remove(KEYS.session);
  else write(KEYS.session, bundle.session);
  writeMeta();
}

/** 検証のうえ全置換で取り込む（3.7.5） */
export async function importBundle(file: File): Promise<Result<ExportBundle>> {
  const checked = await readBundle(file);
  if (!checked.ok) return checked;
  applyBundle(checked.value);
  return ok(checked.value);
}

/**
 * ファイルの中身を文字列で読む。
 * `File.text()` は古い iOS Safari に無いため、無ければ FileReader へ落とす。
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読めない'));
    reader.readAsText(file);
  });
}

export function validate(raw: unknown): Result<ExportBundle> {
  if (!guards.isRecord(raw)) return err('DATA_INVALID', 'バックアップが object ではない');
  if (raw.format !== 'momo-sudoku-backup') {
    return err('DATA_INVALID', 'MOMO Sudoku のバックアップではない');
  }
  if (typeof raw.storageVersion !== 'string' || !sameMajor(raw.storageVersion, STORAGE_VERSION)) {
    return err('DATA_INVALID', `対応しない保存形式: ${String(raw.storageVersion)}`);
  }
  if (!guards.isRecord(raw.settings)) return err('DATA_INVALID', '設定が入っていない');
  if (!guards.isRecord(raw.stats)) return err('DATA_INVALID', '成績が入っていない');
  if (!guards.isRecord(raw.recent)) return err('DATA_INVALID', '既出が入っていない');
  if (raw.session !== null && !guards.isRecord(raw.session)) {
    return err('DATA_INVALID', '中断セッションの形が不正');
  }

  // 個々の中身の修復は、各ストアが読み出すときに行う（3.6.2）
  return ok(raw as unknown as ExportBundle);
}

function sameMajor(a: string, b: string): boolean {
  return a.split('.')[0] === b.split('.')[0];
}

export const transferService = {
  buildBundle,
  export: exportBundle,
  pickImportFile,
  read: readBundle,
  apply: applyBundle,
  import: importBundle,
  validate,
};
