// 牌譜の保存先（段階4の 4）。
// - 端末：最後の対局を 1 つだけブラウザの保存領域に覚える（新しい対局で置き換わる）。消えることがある（掃除・iPhone の 7 日ルール）
// - ファイル：この端末にダウンロード
// - Google ドライブ：遊ぶ人自身のドライブの momo-works/mahjong/ に平置き（MOMO Karaoke・Noise と同じ GIS＋drive.file・同じクライアント）

import type { KifuSource } from './kifu';

const LAST_KEY = 'momo-mahjong.lastGame';

/** 最後の対局を覚える（失敗しても遊びは止めない） */
export function saveLastGame(src: KifuSource): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(src));
  } catch {
    // 容量・プライベートモードなどで書けないときは覚えない
  }
}

/** 覚えている最後の対局（無ければ null） */
export function loadLastGame(): KifuSource | null {
  try {
    const text = localStorage.getItem(LAST_KEY);
    if (!text) return null;
    const src = JSON.parse(text) as KifuSource;
    return Array.isArray(src?.events) && src.events.length > 0 ? src : null;
  } catch {
    return null;
  }
}

/** この端末にファイルとして保存（ダウンロード） */
export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Google ドライブ ----

const CLIENT_ID = '1053350886212-q87r5msugnqbb3saoq1fh3uj3t648hcg.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_PATH = ['momo-works', 'mahjong'];
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface GoogleOAuth {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: unknown) => void }): {
        requestAccessToken(o?: { prompt?: string }): void;
      };
    };
  };
}

let token: string | null = null;

function loadGis(): Promise<GoogleOAuth> {
  const w = window as unknown as { google?: GoogleOAuth };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google のログインを読み込めない')));
    el.onerror = () => reject(new Error('Google のログインを読み込めない'));
    document.head.appendChild(el);
  });
}

/** ログインと許可（初回は Google の画面が出る） */
async function signIn(): Promise<string> {
  if (token) return token;
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? 'ログインできない'));
        token = r.access_token;
        resolve(token);
      },
      error_callback: () => reject(new Error('ログインが取り消された')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (r.status === 401) token = null;
  if (!r.ok) throw new Error(`Google ドライブ ${r.status}`);
  return (await r.json()) as T;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function ensureFolder(): Promise<string> {
  let parent = 'root';
  for (const name of FOLDER_PATH) {
    const query = `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const found = await api<{ files: { id: string }[] }>(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)`);
    parent =
      found.files[0]?.id ??
      (
        await api<{ id: string }>(`${API}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
        })
      ).id;
  }
  return parent;
}

/** 同じ名前があれば _2・_3 … を付ける（上書きしない） */
async function uniqueName(folder: string, name: string): Promise<string> {
  const base = name.replace(/\.json$/, '');
  const query = `name contains '${q(base)}' and '${folder}' in parents and trashed=false`;
  const found = await api<{ files: { name: string }[] }>(`${API}/files?q=${encodeURIComponent(query)}&fields=files(name)`);
  const taken = new Set(found.files.map((f) => f.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}.json`)) return `${base}_${i}.json`;
}

/** Google ドライブの momo-works/mahjong/ に保存。保存したファイル名を返す */
export async function saveToDrive(name: string, text: string): Promise<string> {
  await signIn();
  const folder = await ensureFolder();
  const finalName = await uniqueName(folder, name);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: finalName, parents: [folder], mimeType: 'application/json' })], { type: 'application/json' }));
  form.append('file', new Blob([text], { type: 'application/json' }), finalName);
  await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
  return finalName;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

/** Google ドライブの momo-works/mahjong/ にある牌譜の一覧（新しい順）。drive.file なので、このアプリが保存したものだけが見える */
export async function listDriveKifu(): Promise<DriveFile[]> {
  await signIn();
  const folder = await ensureFolder();
  const query = `'${folder}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const found = await api<{ files: DriveFile[] }>(
    `${API}/files?q=${encodeURIComponent(query)}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime)`,
  );
  return found.files.filter((f) => f.name.endsWith('.json'));
}

/** Google ドライブのファイルの中身を読む */
export async function readDriveFile(id: string): Promise<string> {
  await signIn();
  const r = await fetch(`${API}/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) token = null;
  if (!r.ok) throw new Error(`Google ドライブ ${r.status}`);
  return r.text();
}
