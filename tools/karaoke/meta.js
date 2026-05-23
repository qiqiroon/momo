// =============================================================================
// MOMO Karaoke v2 — データレイヤ (meta.js)
// =============================================================================
// Phase 3 (2026-05-23): meta.json / _app_settings.json / カラオケフォルダ概念
// 仕様書: L:/momo/tools/karaoke/momo_karaoke_v2_spec.md §3.5〜§3.7 / §9
//
// 設計方針:
// - Phase 2 (ストレージ抽象化) はスキップ → ローカル/Drive 二択を直接呼ぶ
// - 既存 v1.39 の録音/再生ロジックは触らない、 本ファイルは独立した data layer
// - 公開 API: window.MomoMeta.{...}
// - Phase 4 以降 (メイクモード本実装) で本ファイルの関数を UI 側から呼ぶ
// =============================================================================

(function(global){
'use strict';

// ───────────────────────────────────────────────────────────────────────────
// 1. 内部曲フォルダ ID 生成 (仕様書 §3.6: アプリ管理、 ユーザー非可視)
//    形式: song_<yyyymmddHHMMSS>_<short-hash>
//    例:   song_20260523T101530_a3f7
//    重複時はサフィックス _001, _002 を呼び出し側で付与
// ───────────────────────────────────────────────────────────────────────────
function generateSongFolderId(title, artist) {
    const ts = new Date().toISOString().replace(/[-:.Z]/g, '').slice(0, 15);
    let h = 0;
    const src = (title || '') + '|' + (artist || '') + '|' + Math.random();
    for (let i = 0; i < src.length; i++) {
        h = ((h << 5) - h) + src.charCodeAt(i);
        h |= 0;
    }
    const hex = (h >>> 0).toString(16).padStart(8, '0').slice(0, 4);
    return `song_${ts}_${hex}`;
}

// 仕様書 §3.6: ファイルシステム不正文字 (/ \ : * ? " < > |) の置換 + 長すぎ制御
function sanitizeFileName(name, maxLen) {
    if (!name) return 'untitled';
    let s = String(name).replace(/[\/\\:\*\?"<>\|]/g, '_').trim();
    if (!s) s = 'untitled';
    const limit = maxLen || 100;
    if (s.length > limit) s = s.slice(0, limit);
    return s;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. ハッシュ計算 (mp3Hash 用、 仕様書 §3.7)
// ───────────────────────────────────────────────────────────────────────────
async function sha256Hex(arrayBuffer) {
    const hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Prefixed(arrayBuffer) {
    return 'sha256:' + (await sha256Hex(arrayBuffer));
}

// ───────────────────────────────────────────────────────────────────────────
// 3. デフォルト値とマージ (仕様書 §9.1, §9.2)
// ───────────────────────────────────────────────────────────────────────────
function defaultAppSettings() {
    return {
        schemaVersion: 1,
        masterVolume: 1.0,
        masterPitch: 1.0,
        bpm: 120,
        syncOn: false,
        trimDb: -40,
        micGain: 1.0,
        language: 'ja',
        lastSelectedSongInternalId: null,
        lastTabId: 'karaoke',
    };
}
function defaultSongMeta(title, artist) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        title: title || '',
        artist: artist || '',
        mp3Hash: null,
        voicecutAvailable: false,
        voicecutEffective: null,
        createdAt: now,
        modifiedAt: now,
        takes: [],
        mixes: [],
    };
}
function mergeAppSettings(loaded) {
    return Object.assign(defaultAppSettings(), loaded || {});
}
function mergeSongMeta(loaded) {
    return Object.assign(defaultSongMeta(), loaded || {});
}

// ───────────────────────────────────────────────────────────────────────────
// 4. 重複判定 (仕様書 §4.6 メイクモード、 §7.3 import マージ)
//    α: title + artist 一致 / β: mp3Hash 一致
// ───────────────────────────────────────────────────────────────────────────
function isDuplicateAlpha(metaA, metaB) {
    if (!metaA || !metaB) return false;
    const ta = (metaA.title || '').trim();
    const tb = (metaB.title || '').trim();
    const aa = (metaA.artist || '').trim();
    const ab = (metaB.artist || '').trim();
    return ta === tb && aa === ab && (ta || aa);
}
function isDuplicateBeta(metaA, metaB) {
    if (!metaA || !metaB) return false;
    return !!metaA.mp3Hash && !!metaB.mp3Hash && metaA.mp3Hash === metaB.mp3Hash;
}

// ───────────────────────────────────────────────────────────────────────────
// 5. テイク/MIX 番号管理 (仕様書 §6.12: 単調増加、 欠番補充しない)
// ───────────────────────────────────────────────────────────────────────────
function nextTakeId(meta) {
    if (!meta || !meta.takes || meta.takes.length === 0) return 1;
    return Math.max(...meta.takes.map(t => t.id || 0)) + 1;
}
function nextMixId(meta) {
    if (!meta || !meta.mixes || meta.mixes.length === 0) return 1;
    return Math.max(...meta.mixes.map(m => m.id || 0)) + 1;
}

// ───────────────────────────────────────────────────────────────────────────
// 6. ローカルフォルダ実装 (File System Access API)
// ───────────────────────────────────────────────────────────────────────────
const Local = {
    isSupported() {
        return typeof window.showDirectoryPicker === 'function';
    },

    async pickKaraokeFolder() {
        if (!this.isSupported()) throw new Error('File System Access API not supported');
        return await window.showDirectoryPicker({
            id: 'momo-karaoke-folder',
            mode: 'readwrite',
            startIn: 'documents',
        });
    },

    async loadAppSettings(karaokeFolderHandle) {
        try {
            const fh = await karaokeFolderHandle.getFileHandle('_app_settings.json');
            const file = await fh.getFile();
            const text = await file.text();
            return mergeAppSettings(JSON.parse(text));
        } catch (e) {
            return defaultAppSettings();
        }
    },

    async saveAppSettings(karaokeFolderHandle, settings) {
        const fh = await karaokeFolderHandle.getFileHandle('_app_settings.json', { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(settings, null, 2));
        await w.close();
    },

    async loadSongMeta(songFolderHandle) {
        try {
            const fh = await songFolderHandle.getFileHandle('meta.json');
            const file = await fh.getFile();
            const text = await file.text();
            return mergeSongMeta(JSON.parse(text));
        } catch (e) {
            return null;
        }
    },

    async saveSongMeta(songFolderHandle, meta) {
        meta.modifiedAt = new Date().toISOString();
        const fh = await songFolderHandle.getFileHandle('meta.json', { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(meta, null, 2));
        await w.close();
    },

    async listSongs(karaokeFolderHandle) {
        const songs = [];
        for await (const entry of karaokeFolderHandle.values()) {
            if (entry.kind === 'directory') {
                const meta = await this.loadSongMeta(entry);
                if (meta) {
                    songs.push({ internalId: entry.name, handle: entry, meta });
                }
            }
        }
        return songs;
    },

    // 重複しない内部曲フォルダ ID を作って、 そのフォルダを生成して返す
    async createSongFolder(karaokeFolderHandle, baseInternalId) {
        let id = baseInternalId;
        let suffix = 0;
        while (true) {
            try {
                await karaokeFolderHandle.getDirectoryHandle(id);
                // 既存あり → サフィックス付与
                suffix++;
                id = `${baseInternalId}_${String(suffix).padStart(3, '0')}`;
                if (suffix > 999) throw new Error('too many duplicates');
            } catch (e) {
                // NotFoundError = OK、 ここで作成
                return {
                    internalId: id,
                    handle: await karaokeFolderHandle.getDirectoryHandle(id, { create: true }),
                };
            }
        }
    },

    // 任意ファイルの読み書き (mp3 / lrc / wav)
    async readFile(folderHandle, fileName) {
        const fh = await folderHandle.getFileHandle(fileName);
        return await fh.getFile();
    },
    async writeFile(folderHandle, fileName, blob) {
        const fh = await folderHandle.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
    },
    async deleteFile(folderHandle, fileName) {
        await folderHandle.removeEntry(fileName);
    },
    async listFiles(folderHandle) {
        const files = [];
        for await (const entry of folderHandle.values()) {
            if (entry.kind === 'file') files.push(entry.name);
        }
        return files;
    },
};

// ───────────────────────────────────────────────────────────────────────────
// 7. Google Drive 実装 stub (Phase 4 で本実装、 Phase 3 では interface のみ)
//    既存の Pyodide + momo_gdrive.py 経由で呼び出す想定
// ───────────────────────────────────────────────────────────────────────────
const DriveStub = {
    KARAOKE_ROOT_PATH: 'momo-works/karaoke',

    async ensureKaraokeRoot(/* gdrive */) {
        throw new Error('Drive support: pending Phase 4');
    },
    async loadAppSettings(/* gdrive */) {
        return defaultAppSettings();
    },
    async saveAppSettings(/* gdrive, settings */) { /* TODO */ },
    async loadSongMeta(/* gdrive, songFolderId */) { return null; },
    async saveSongMeta(/* gdrive, songFolderId, meta */) { /* TODO */ },
    async listSongs(/* gdrive */) { return []; },
    async createSongFolder(/* gdrive, baseInternalId */) {
        throw new Error('Drive support: pending Phase 4');
    },
};

// ───────────────────────────────────────────────────────────────────────────
// 8. lrc ヘッダ解析 (仕様書 §4.3-§4.4、 [ti:] [ar:] 自動フィル用)
// ───────────────────────────────────────────────────────────────────────────
function parseLrcHeader(lrcText) {
    if (!lrcText) return { title: null, artist: null };
    const lines = lrcText.split(/\r?\n/).slice(0, 20);  // 先頭 20 行だけ見れば十分
    let title = null, artist = null;
    for (const line of lines) {
        const ti = line.match(/^\s*\[ti:(.+?)\]/i);
        if (ti) title = ti[1].trim();
        const ar = line.match(/^\s*\[ar:(.+?)\]/i);
        if (ar) artist = ar[1].trim();
        if (title && artist) break;
    }
    return { title, artist };
}

// ───────────────────────────────────────────────────────────────────────────
// 8a. IndexedDB ヘルパー (v2.03)
//     FileSystemDirectoryHandle は localStorage に格納できないため IndexedDB を使う。
//     仕様書 §3.4 L1: カラオケフォルダのプロバイダ種別 + フォルダハンドル参照を保持。
// ───────────────────────────────────────────────────────────────────────────
const IDB_NAME = 'momoKaraokeV2';
const IDB_VERSION = 1;
const IDB_STORE = 'handles';

function _openIdb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveHandle(key, handle) {
    const db = await _openIdb();
    return new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, key);
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => { db.close(); rej(tx.error); };
    });
}

async function loadHandle(key) {
    const db = await _openIdb();
    return new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => { db.close(); res(req.result || null); };
        req.onerror = () => { db.close(); rej(req.error); };
    });
}

async function deleteHandle(key) {
    const db = await _openIdb();
    return new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => { db.close(); rej(tx.error); };
    });
}

// 権限確認: 既に granted なら何もせず、 prompt ならユーザー操作で requestPermission
async function ensureHandlePermission(handle, mode) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const opts = { mode: mode || 'read' };
    const cur = await handle.queryPermission(opts);
    if (cur === 'granted') return true;
    if (cur === 'prompt') {
        const req = await handle.requestPermission(opts);
        return req === 'granted';
    }
    return false;  // 'denied' or unknown
}

// ───────────────────────────────────────────────────────────────────────────
// 9. 公開 API
// ───────────────────────────────────────────────────────────────────────────
global.MomoMeta = {
    // utility
    generateSongFolderId,
    sanitizeFileName,
    sha256Hex,
    sha256Prefixed,
    defaultAppSettings,
    defaultSongMeta,
    mergeAppSettings,
    mergeSongMeta,
    isDuplicateAlpha,
    isDuplicateBeta,
    nextTakeId,
    nextMixId,
    parseLrcHeader,

    // storage providers (Phase 2 抽象化はスキップ、 if 分岐で直接呼ぶ)
    Local,
    Drive: DriveStub,

    // v2.03: IndexedDB によるハンドル永続化 + 権限確認
    saveHandle,
    loadHandle,
    deleteHandle,
    ensureHandlePermission,

    // Phase 3 識別用
    SCHEMA_VERSION: 1,
    PHASE: 3,
};

console.log('[meta.js] MomoMeta data layer loaded (Phase 3, schemaVersion=1)');

})(window);
