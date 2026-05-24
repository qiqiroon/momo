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
// v2.13 (2026-05-24): Drive 実装を **絶対パス方式** に全面書き換え。
//   v2.12 までは cd() で cwd を移動してファイル名のみ渡す方式だったが、
//   momo_gdrive.py の navigate() は相対 cd ではなく絶対パスで current_path を
//   上書きするため、 連続 cd では cwd が思った場所に来ない (= 'Drive ルート直下に
//   karaoke が作られる' 不具合の真因)。 本版では cd を使わず、 全ファイル操作を
//   '/momo-works/karaoke/...' の絶対パスで実行する。
//   併せて momo_gdrive.py を v1.06 に更新 (_upload の PATCH に parents 同梱バグ
//   修正、 既存ファイル上書き時の 403 を解消)。
const Drive = {
    KARAOKE_ROOT_ABS: '/momo-works/karaoke',
    _rootId: null,  // ensureKaraokeRoot で取得 (listSongs などで再利用)

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
    // v2.15: 既存接続再利用 (トークン有効ならスキップ)。
    //   v1.39 の gdrive.connect は毎回 OAuth プロンプトを開く実装のため、
    //   音楽ライブラリ取り込み等で再呼び出しすると不要な OAuth が走る。
    //   momo_gdrive.py の is_token_valid() でトークンが生きていれば skip する。
    async connect() {
        const g = this._g();
        if (g.momo) {
            try {
                if (typeof g.momo.is_token_valid === 'function' && g.momo.is_token_valid()) {
                    return true;
                }
            } catch (e) { /* fallthrough: 再認証へ */ }
        }
        const ok = await g.connect();
        if (!ok) throw new Error('Drive connect failed');
        return true;
    },

    // パス組立てユーティリティ
    _songPath(songFolderName) {
        if (!songFolderName) return this.KARAOKE_ROOT_ABS;
        if (songFolderName.startsWith('/')) return songFolderName;
        return this.KARAOKE_ROOT_ABS + '/' + songFolderName;
    },
    _filePath(songFolderName, fileName) {
        return this._songPath(songFolderName) + '/' + fileName;
    },

    // Uint8Array → Python bytes 明示変換
    //   Pyodide に Uint8Array を直接渡すと PyProxy のままになり
    //   'can't contact pyodide.ffi.JsProxy to bytes' エラーになるため、
    //   pyodide.toPy() で明示的に Python bytes に変換する。
    _toPyBytes(uint8Array) {
        const g = this._g();
        const pyodide = g.pyodide;
        if (!pyodide || typeof pyodide.toPy !== 'function') {
            return uint8Array;  // fallback
        }
        return pyodide.toPy(uint8Array);
    },

    async _writeAbs(absPath, bytesOrBlob) {
        const g = this._g();
        let ua;
        if (bytesOrBlob instanceof Blob) {
            ua = new Uint8Array(await bytesOrBlob.arrayBuffer());
        } else if (bytesOrBlob instanceof Uint8Array) {
            ua = bytesOrBlob;
        } else if (bytesOrBlob instanceof ArrayBuffer) {
            ua = new Uint8Array(bytesOrBlob);
        } else {
            ua = new TextEncoder().encode(String(bytesOrBlob));
        }
        const pyBytes = this._toPyBytes(ua);
        console.log('[Drive] write:', absPath, 'bytes:', ua.byteLength);
        try {
            await g.momo.write_bytes(absPath, pyBytes);
        } finally {
            if (pyBytes && typeof pyBytes.destroy === 'function') {
                try { pyBytes.destroy(); } catch (e) {}
            }
        }
    },

    async _readTextAbs(absPath) {
        const g = this._g();
        const text = await g.momo.read_text(absPath);
        return (text && typeof text.toString === 'function') ? text.toString() : String(text);
    },

    // ensureKaraokeRoot: '/momo-works/karaoke' を 1 回の mkdir() で再帰作成し、
    //   その folder_id をキャッシュ。 mkdir() 内部で resolve_path が階層を辿るので、
    //   絶対パス '/momo-works/karaoke' を渡すだけで両階層が作られる。
    async ensureKaraokeRoot() {
        const g = this._g();
        if (!g.momo) await this.connect();
        try {
            console.log('[Drive] mkdir abs:', this.KARAOKE_ROOT_ABS);
            const rootId = await g.momo.mkdir(this.KARAOKE_ROOT_ABS);
            this._rootId = rootId;
            console.log('[Drive] karaoke root id:', rootId);
            return this.KARAOKE_ROOT_ABS;
        } catch (e) {
            throw new Error('ensureKaraokeRoot failed: ' + (e.message || e));
        }
    },

    // _app_settings.json (カラオケフォルダ直下)
    async loadAppSettings() {
        try {
            const t = await this._readTextAbs(this.KARAOKE_ROOT_ABS + '/_app_settings.json');
            return mergeAppSettings(JSON.parse(t));
        } catch (e) {
            return defaultAppSettings();
        }
    },
    async saveAppSettings(settings) {
        const text = JSON.stringify(settings, null, 2);
        const bytes = new TextEncoder().encode(text);
        await this._writeAbs(this.KARAOKE_ROOT_ABS + '/_app_settings.json', bytes);
    },

    // meta.json (各曲フォルダ直下)
    async loadSongMeta(songFolderName) {
        try {
            const t = await this._readTextAbs(this._filePath(songFolderName, 'meta.json'));
            return mergeSongMeta(JSON.parse(t));
        } catch (e) {
            return null;
        }
    },
    async saveSongMeta(songFolderName, meta) {
        meta.modifiedAt = new Date().toISOString();
        const text = JSON.stringify(meta, null, 2);
        const bytes = new TextEncoder().encode(text);
        await this._writeAbs(this._filePath(songFolderName, 'meta.json'), bytes);
    },

    // 曲一覧 (カラオケルート直下のサブフォルダ + 各 meta.json)
    // v2.17: 真因切り分け用の詳細ログを追加 (重複判定で既存曲 0 件問題のデバッグ)。
    //   さらに _list_children → list_dir(use_cache=false) で 2 系統取得して比較する。
    //   drive.file スコープによる挙動差を可視化するため。
    async listSongs() {
        const g = this._g();
        let rootId = this._rootId;
        if (!rootId) {
            rootId = await g.momo.mkdir(this.KARAOKE_ROOT_ABS);
            this._rootId = rootId;
        }
        console.log('[Drive] listSongs: rootId =', rootId, 'abs =', this.KARAOKE_ROOT_ABS);

        // 1 系統目: _list_children (cache 不使用、 素 fetch)
        const itemsProxy = await g.momo._list_children(rootId);
        const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
        if (itemsProxy.destroy) itemsProxy.destroy();
        console.log('[Drive] listSongs: _list_children →', items.length, '件:',
            items.map(i => i.name + (i.isFolder ? '/' : '')).join(', ') || '(空)');

        // 2 系統目: list_dir(abs, use_cache=False) を試す (絶対パス → 内部で resolve_path → _list_children)
        try {
            const altProxy = await g.momo.list_dir(this.KARAOKE_ROOT_ABS, false);
            const alt = altProxy.toJs({ dict_converter: Object.fromEntries });
            if (altProxy.destroy) altProxy.destroy();
            console.log('[Drive] listSongs: list_dir(abs,false) →', alt.length, '件:',
                alt.map(i => i.name + (i.isFolder ? '/' : '')).join(', ') || '(空)');
        } catch (e) {
            console.warn('[Drive] listSongs: list_dir alt fail:', e);
        }

        const songs = [];
        for (const it of items) {
            if (it.isFolder) {
                const meta = await this.loadSongMeta(it.name);
                if (meta) {
                    songs.push({ internalId: it.name, meta });
                } else {
                    console.log('[Drive] listSongs: meta.json 読込失敗 or 空:', it.name);
                }
            }
        }
        console.log('[Drive] listSongs: 有効な song フォルダ =', songs.length);
        return songs;
    },

    // 曲フォルダ作成 (重複時 _001 サフィックス)
    async createSongFolder(baseInternalId) {
        const g = this._g();
        let id = baseInternalId;
        let suffix = 0;
        while (true) {
            const absPath = this._songPath(id);
            const exists = await g.momo.exists(absPath);
            if (!exists) {
                console.log('[Drive] mkdir song folder:', absPath);
                await g.momo.mkdir(absPath);
                return { internalId: id };
            }
            suffix++;
            id = `${baseInternalId}_${String(suffix).padStart(3, '0')}`;
            if (suffix > 999) throw new Error('too many duplicates');
        }
    },

    // 任意ファイルの読み書き (絶対パス直接)
    async readFile(songFolderName, fileName) {
        const g = this._g();
        const bytes = await g.momo.read_bytes(this._filePath(songFolderName, fileName));
        let buf;
        if (bytes && typeof bytes.toJs === 'function') {
            buf = bytes.toJs();
            if (bytes.destroy) bytes.destroy();
        } else {
            buf = bytes;
        }
        return new Blob([buf]);
    },
    async writeFile(songFolderName, fileName, blob) {
        await this._writeAbs(this._filePath(songFolderName, fileName), blob);
    },
    async deleteFile(songFolderName, fileName) {
        const g = this._g();
        await g.momo.delete(this._filePath(songFolderName, fileName));
    },
    async listFiles(songFolderName) {
        const g = this._g();
        try {
            // song フォルダの ID を取得 (既存なら mkdir は resolve_path で即返却)
            const folderId = await g.momo.mkdir(this._songPath(songFolderName));
            const itemsProxy = await g.momo._list_children(folderId);
            const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
            if (itemsProxy.destroy) itemsProxy.destroy();
            return items.filter(it => !it.isFolder).map(it => it.name);
        } catch (e) {
            console.warn('[Drive] listFiles failed for ' + songFolderName + ':', e);
            return [];
        }
    },

    // ===== v2.14: 音楽ライブラリ (任意 Drive フォルダ) 対応 =====

    // 指定絶対パス配下のサブフォルダ一覧 (階層ピッカー用)
    // 戻り値: [{name, absPath}]、 並びは名前昇順 (ja)
    async listFoldersAbs(absPath) {
        const g = this._g();
        if (!g.momo) await this.connect();
        const path = absPath || '/';
        // ルート '/' は mkdir せず root 直接利用
        let folderId;
        if (path === '/') {
            folderId = 'root';
        } else {
            // mkdir は既存なら resolve_path で ID 返却するため副作用なし。
            // 仮に音楽ライブラリの選択中に存在しないパスを指定された場合のみ新規作成される
            // が、 ユーザー操作 (リストクリック) でしか呼ばないので副作用ほぼなし。
            folderId = await g.momo.mkdir(path);
        }
        const itemsProxy = await g.momo._list_children(folderId);
        const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
        if (itemsProxy.destroy) itemsProxy.destroy();
        const folders = items
            .filter(it => it.isFolder)
            .map(it => ({
                name: it.name,
                absPath: (path === '/' ? '' : path) + '/' + it.name,
            }));
        folders.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        return folders;
    },

    // 絶対パスのファイルを Blob として取得 (音楽ライブラリ取り込み時に呼ぶ)
    async readBlobAbs(absPath) {
        const g = this._g();
        if (!g.momo) await this.connect();
        const bytes = await g.momo.read_bytes(absPath);
        let buf;
        if (bytes && typeof bytes.toJs === 'function') {
            buf = bytes.toJs();
            if (bytes.destroy) bytes.destroy();
        } else {
            buf = bytes;
        }
        return new Blob([buf]);
    },

    // 音楽ライブラリ (rootAbsPath 配下) を再帰列挙して audio/lrc を返す
    //   make.js の collectMusicLibraryFiles (Local 版) と同形式の戻り値:
    //     [{name, kind: 'audio'|'lrc', relPath, parentKey, getFile}]
    //   ・ parentKey は parent フォルダの絶対パス (Local の parentHandle 相当、 同フォルダ判定用)
    //   ・ getFile() は async で Blob/File を返す (Drive はオンデマンドで read_bytes)
    //   ・ maxDepth=1 (デフォルト) でサブフォルダ 1 階層まで再帰
    async collectMusicLibrary(rootAbsPath, maxDepth, isAudioFn, isLrcFn) {
        const g = this._g();
        if (!g.momo) await this.connect();
        const depth = (typeof maxDepth === 'number') ? maxDepth : 1;
        const self = this;
        const out = [];
        async function walk(absPath, prefix, curDepth) {
            let folderId;
            try {
                if (absPath === '/') folderId = 'root';
                else folderId = await g.momo.mkdir(absPath);  // 既存なら resolve_path のみ
            } catch (e) {
                console.warn('[Drive] collectMusicLibrary walk fail at ' + absPath + ':', e);
                return;
            }
            const itemsProxy = await g.momo._list_children(folderId);
            const items = itemsProxy.toJs({ dict_converter: Object.fromEntries });
            if (itemsProxy.destroy) itemsProxy.destroy();
            for (const it of items) {
                const childAbs = (absPath === '/' ? '' : absPath) + '/' + it.name;
                if (!it.isFolder) {
                    const isAud = isAudioFn ? isAudioFn(it.name) : false;
                    const isLrc = isLrcFn ? isLrcFn(it.name) : false;
                    if (isAud || isLrc) {
                        const fileAbs = childAbs;
                        const itName = it.name;
                        out.push({
                            name: itName,
                            kind: isAud ? 'audio' : 'lrc',
                            relPath: prefix + itName,
                            parentKey: absPath,
                            // v2.16: Blob ではなく File を返す。 onRegister の pendingMp3File.name で
                            //   ファイル名が取れるようにするため (Blob だと name が undefined →
                            //   sanitizeFileName で 'untitled' になっていた)
                            getFile: async () => {
                                const blob = await self.readBlobAbs(fileAbs);
                                return new File([blob], itName, { type: blob.type });
                            },
                        });
                    }
                } else if (curDepth < depth) {
                    await walk(childAbs, prefix + it.name + '/', curDepth + 1);
                }
            }
        }
        await walk(rootAbsPath, '', 0);
        out.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'audio' ? -1 : 1;
            return (a.relPath || a.name).localeCompare(b.relPath || b.name, 'ja');
        });
        console.log('[Drive] collectMusicLibrary: ' + out.length + ' ファイル検出 (' + rootAbsPath + ')');
        return out;
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
