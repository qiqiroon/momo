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
// 7. Google Drive 実装 (v2.08〜)
//    既存 v1.39 の window.gdrive (index.html IIFE 末尾で expose) を経由して
//    momo_gdrive.py の API を呼ぶ。 既存の Drive 接続ロジックは破壊せず再利用。
//    momo_gdrive.py API: connect / navigate / cd / mkdir / exists / read_text /
//      read_bytes / read_json / write_bytes / delete / copy / move / _list_children
// ───────────────────────────────────────────────────────────────────────────
const Drive = {
    KARAOKE_ROOT_PATH: 'momo-works/karaoke',

    // 既存 v1.39 の gdrive オブジェクト参照を取得 (expose されていれば)
    _g() {
        if (typeof window === 'undefined' || !window.gdrive) {
            throw new Error('Drive not available: window.gdrive missing (v1.39 IIFE must run first)');
        }
        return window.gdrive;
    },

    isSupported() {
        return typeof window !== 'undefined' && !!window.gdrive;
    },

    // Drive に接続 (Pyodide ロード + OAuth)
    async connect() {
        const g = this._g();
        const ok = await g.connect();
        if (!ok) throw new Error('Drive connect failed');
        return true;
    },

    // ensureKaraokeRoot: `momo-works/karaoke` フォルダを navigate (存在しなければ mkdir)
    // momo_gdrive.py の navigate は存在しないパスでエラーになる可能性あり、 mkdir でフォルダ作成
    async ensureKaraokeRoot() {
        const g = this._g();
        if (!g.momo) await this.connect();
        try {
            // mkdir は冪等 (既存なら同じ ID を返す想定、 momo_gdrive.py 仕様による)
            await g.momo.mkdir(this.KARAOKE_ROOT_PATH);
            await g.momo.cd(this.KARAOKE_ROOT_PATH);
            return this.KARAOKE_ROOT_PATH;
        } catch (e) {
            throw new Error('ensureKaraokeRoot failed: ' + (e.message || e));
        }
    },

    // v2.11: Uint8Array → Python bytes 明示変換ヘルパ
    //   Pyodide で JS Uint8Array を直接渡すと PyProxy のままになり
    //   'can't contact pyodide.ffi.JsProxy to bytes' エラーになるため、
    //   pyodide.toPy() で明示的に Python bytes に変換する。
    _toPyBytes(uint8Array) {
        const g = this._g();
        const pyodide = g.pyodide;
        if (!pyodide || typeof pyodide.toPy !== 'function') {
            // fallback: そのまま渡す (古い Pyodide で動く可能性)
            return uint8Array;
        }
        return pyodide.toPy(uint8Array);
    },

    // v2.11: writeFile の汎用ヘルパ (cd ベース、 親フォルダに移動してから書き込み)
    //   理由: write_bytes に 'a/b.txt' のような相対パスを渡すと
    //   momo_gdrive.py の resolve_path が壊れて FileNotFoundError になる
    async _writeFileInFolder(folderName, fileName, blob) {
        const g = this._g();
        const ab = await blob.arrayBuffer();
        const ua = new Uint8Array(ab);
        const pyBytes = this._toPyBytes(ua);
        if (folderName) {
            await g.momo.cd(folderName);
        }
        try {
            await g.momo.write_bytes(fileName, pyBytes);
        } finally {
            if (folderName) {
                try { await g.momo.cd('..'); } catch (e) { console.warn('[Drive] cd .. fail:', e); }
            }
            if (pyBytes && typeof pyBytes.destroy === 'function') {
                try { pyBytes.destroy(); } catch (e) {}
            }
        }
    },

    async _readTextInFolder(folderName, fileName) {
        const g = this._g();
        if (folderName) {
            await g.momo.cd(folderName);
        }
        try {
            const text = await g.momo.read_text(fileName);
            return (text && typeof text.toString === 'function') ? text.toString() : String(text);
        } finally {
            if (folderName) {
                try { await g.momo.cd('..'); } catch (e) { console.warn('[Drive] cd .. fail:', e); }
            }
        }
    },

    // _app_settings.json 読み込み (カラオケフォルダ直下、 cwd = momo-works/karaoke 想定)
    async loadAppSettings() {
        try {
            const t = await this._readTextInFolder(null, '_app_settings.json');
            return mergeAppSettings(JSON.parse(t));
        } catch (e) {
            return defaultAppSettings();
        }
    },

    async saveAppSettings(settings) {
        const text = JSON.stringify(settings, null, 2);
        const bytes = new TextEncoder().encode(text);
        await this._writeFileInFolder(null, '_app_settings.json', new Blob([bytes]));
    },

    async loadSongMeta(songFolderName) {
        try {
            const t = await this._readTextInFolder(songFolderName, 'meta.json');
            return mergeSongMeta(JSON.parse(t));
        } catch (e) {
            return null;
        }
    },

    async saveSongMeta(songFolderName, meta) {
        meta.modifiedAt = new Date().toISOString();
        const text = JSON.stringify(meta, null, 2);
        const bytes = new TextEncoder().encode(text);
        await this._writeFileInFolder(songFolderName, 'meta.json', new Blob([bytes]));
    },

    // 曲一覧 (カラオケフォルダ直下のサブフォルダ + 各 meta.json)
    // v2.10: フィールド名修正 (cwd_id → current_id) + PyProxy → JS 変換
    async listSongs() {
        const g = this._g();
        let info = null;
        if (g.momo.info) {
            try {
                // momo_gdrive.py の info() は def info(self) -> dict (同期 method)
                const ret = g.momo.info();
                // Python dict は PyProxy で返る → toJs で JS オブジェクトへ
                if (ret && typeof ret.toJs === 'function') {
                    info = ret.toJs({ dict_converter: Object.fromEntries });
                    if (typeof ret.destroy === 'function') ret.destroy();
                } else if (ret && typeof ret.then === 'function') {
                    // 念のため Promise の場合
                    const awaited = await ret;
                    info = (awaited && typeof awaited.toJs === 'function')
                        ? awaited.toJs({ dict_converter: Object.fromEntries })
                        : awaited;
                } else {
                    info = ret;
                }
            } catch (e) {
                console.warn('[Drive] info() failed:', e);
            }
        }
        // フィールド名は momo_gdrive.py 仕様で current_id (v2.09 で誤って cwd_id を見ていた)
        const folderId = info && (info.current_id || info.cwd_id);
        if (!folderId) {
            throw new Error('listSongs: current folder id missing (info=' + JSON.stringify(info) + ')');
        }
        const itemsProxy = await g.momo._list_children(folderId);
        const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
        if (itemsProxy.destroy) itemsProxy.destroy();
        const songs = [];
        for (const it of items) {
            if (it.isFolder) {
                const meta = await this.loadSongMeta(it.name);
                if (meta) songs.push({ internalId: it.name, meta });
            }
        }
        return songs;
    },

    // 曲フォルダ作成 (重複時 _001 サフィックス)
    async createSongFolder(baseInternalId) {
        const g = this._g();
        let id = baseInternalId;
        let suffix = 0;
        while (true) {
            const exists = await g.momo.exists(id);
            if (!exists) {
                await g.momo.mkdir(id);
                return { internalId: id };
            }
            suffix++;
            id = `${baseInternalId}_${String(suffix).padStart(3, '0')}`;
            if (suffix > 999) throw new Error('too many duplicates');
        }
    },

    // 任意ファイルの読み書き (song フォルダ内、 cd ベース)
    async readFile(songFolderName, fileName) {
        const g = this._g();
        await g.momo.cd(songFolderName);
        try {
            const bytes = await g.momo.read_bytes(fileName);
            let buf;
            if (bytes && typeof bytes.toJs === 'function') {
                buf = bytes.toJs();
                if (bytes.destroy) bytes.destroy();
            } else {
                buf = bytes;
            }
            return new Blob([buf]);
        } finally {
            try { await g.momo.cd('..'); } catch (e) {}
        }
    },
    async writeFile(songFolderName, fileName, blob) {
        await this._writeFileInFolder(songFolderName, fileName, blob);
    },
    async deleteFile(songFolderName, fileName) {
        const g = this._g();
        await g.momo.cd(songFolderName);
        try {
            await g.momo.delete(fileName);
        } finally {
            try { await g.momo.cd('..'); } catch (e) {}
        }
    },
    async listFiles(songFolderName) {
        const g = this._g();
        // v2.10: cd で対象フォルダに移動 → info で current_id 取得 → _list_children → cd で戻る
        // 簡素化のため: 親フォルダ ID を最初に保存 → 子フォルダへ navigate → 終わったら戻す
        // momo_gdrive.py には ls(path) 系の直接 API が無いので往復が必要
        try {
            // 現 cwd を保存
            const beforeProxy = g.momo.info();
            const before = beforeProxy && beforeProxy.toJs
                ? beforeProxy.toJs({ dict_converter: Object.fromEntries })
                : beforeProxy;
            if (beforeProxy && beforeProxy.destroy) beforeProxy.destroy();
            const beforeId = before && (before.current_id || before.cwd_id);
            const beforePath = before && before.current_path;

            // 対象フォルダへ cd
            await g.momo.cd(songFolderName);

            // info で current_id 取得
            const targetProxy = g.momo.info();
            const target = targetProxy && targetProxy.toJs
                ? targetProxy.toJs({ dict_converter: Object.fromEntries })
                : targetProxy;
            if (targetProxy && targetProxy.destroy) targetProxy.destroy();
            const targetId = target && (target.current_id || target.cwd_id);

            // _list_children で 子要素取得
            const itemsProxy = await g.momo._list_children(targetId);
            const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
            if (itemsProxy.destroy) itemsProxy.destroy();

            // 元の cwd に戻す
            if (beforePath) {
                try { await g.momo.cd('..'); } catch (e) { console.warn('[Drive] cd .. fail:', e); }
            }

            return items.filter(it => !it.isFolder).map(it => it.name);
        } catch (e) {
            console.warn('[Drive] listFiles failed for ' + songFolderName + ':', e);
            return [];
        }
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
    Drive,  // v2.08: stub から本実装に置き換え

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
