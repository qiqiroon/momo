/* MOMO Lyrics — library.js
 * 責務: 音楽ライブラリ(ルートフォルダ)の登録・永続化・遅延展開ツリーUI・歌詞選択。
 * 対応: 変更4.txt〜変更5.txt系列のユーザ要望(.lrcを選ぶだけで同名音源も自動ロード)
 * v1.17:
 *   - showDirectoryPicker でルートフォルダを取得し IndexedDB に永続化
 *   - 起動時に1回だけ requestPermission(read) で承認
 *   - フォルダツリーは展開時に直下のみスキャン(遅延)、軽量に動作
 *   - .lrc/.txt クリックで「そのファイル + 同フォルダ内の同名音源」を取得して履歴/プレイへ
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.library = MOMO.library || {};

    const DB_NAME = 'momo_lyrics';
    const DB_VERSION = 1;
    const STORE = 'handles';
    const KEY_LIBRARY = 'libraryRoot';
    const AUDIO_EXTS = ['.mp3', '.m4a', '.flac', '.wav', '.ogg'];

    // ───────────────────── IndexedDB ラッパー ─────────────────────

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbGet(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbPut(key, value) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function idbDelete(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ───────────────────── 状態 ─────────────────────

    let rootHandle = null; // 登録済みのルートディレクトリハンドル

    // ───────────────────── 権限まわり ─────────────────────

    async function ensurePermission(handle, mode) {
        if (!handle.queryPermission) return true; // フォールバック
        let perm = await handle.queryPermission({ mode: mode || 'read' });
        if (perm === 'granted') return true;
        // ユーザー操作直後でなければ拒否される可能性あり
        perm = await handle.requestPermission({ mode: mode || 'read' });
        return perm === 'granted';
    }

    // ───────────────────── ルート登録/解除 ─────────────────────

    async function registerLibrary() {
        if (!window.showDirectoryPicker) {
            alert('Chrome/Edge を使用してください。');
            return;
        }
        let handle;
        try {
            handle = await window.showDirectoryPicker({ mode: 'read' });
        } catch (e) {
            if (e.name !== 'AbortError') alert('フォルダを開けませんでした: ' + e.message);
            return;
        }
        rootHandle = handle;
        try { await idbPut(KEY_LIBRARY, handle); } catch (e) { console.warn('IDB put failed', e); }
        await renderRoot();
    }

    async function changeLibrary() {
        // 現在のルートを破棄して登録し直す
        rootHandle = null;
        try { await idbDelete(KEY_LIBRARY); } catch (e) { /* noop */ }
        const tree = document.getElementById('library-tree');
        if (tree) { tree.innerHTML = ''; tree.classList.add('hidden'); }
        updateControlsVisibility();
        // すぐに登録ピッカーを起動
        await registerLibrary();
    }

    // ───────────────────── スキャン ─────────────────────

    async function scanDirShallow(dirHandle) {
        const folders = [];
        const lrcFiles = [];
        const txtFiles = [];
        const audioBaseSet = new Set();
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                folders.push({ handle: entry, name: entry.name });
            } else {
                const lower = entry.name.toLowerCase();
                if (lower.endsWith('.lrc')) {
                    lrcFiles.push({ handle: entry, name: entry.name, base: entry.name.replace(/\.lrc$/i, '').toLowerCase() });
                } else if (lower.endsWith('.txt')) {
                    txtFiles.push({ handle: entry, name: entry.name, base: entry.name.replace(/\.txt$/i, '').toLowerCase() });
                } else if (AUDIO_EXTS.some(e => lower.endsWith(e))) {
                    audioBaseSet.add(entry.name.replace(/\.[^/.]+$/, '').toLowerCase());
                }
            }
        }
        folders.sort((a, b) => a.name.localeCompare(b.name));
        lrcFiles.sort((a, b) => a.name.localeCompare(b.name));
        txtFiles.sort((a, b) => a.name.localeCompare(b.name));
        return { folders, lrcFiles, txtFiles, audioBaseSet };
    }

    /**
     * 同フォルダから baseName 一致の音源ハンドルを取得（必要時のみ）
     */
    async function findAudioInDir(dirHandle, baseName) {
        const target = baseName.toLowerCase();
        for await (const entry of dirHandle.values()) {
            if (entry.kind !== 'file') continue;
            const lower = entry.name.toLowerCase();
            if (AUDIO_EXTS.some(e => lower.endsWith(e))) {
                const aBase = entry.name.replace(/\.[^/.]+$/, '').toLowerCase();
                if (aBase === target) return entry;
            }
        }
        return null;
    }

    // ───────────────────── 描画 ─────────────────────

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    /**
     * フォルダ要素 <li class="lib-folder">name</li><ul class="children hidden"></ul>
     * クリックで遅延スキャン+展開/折りたたみ
     */
    function buildFolderNode(dirHandle, name) {
        const li = document.createElement('li');
        li.className = 'lib-folder';
        li.textContent = name;
        li.dataset.scanned = '0';
        const children = document.createElement('ul');
        children.className = 'lib-children hidden';
        li.appendChild(children);
        li.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            // 折りたたみ
            if (li.classList.contains('expanded')) {
                li.classList.remove('expanded');
                children.classList.add('hidden');
                return;
            }
            // 初回展開ならスキャン
            if (li.dataset.scanned !== '1') {
                li.classList.add('loading');
                try {
                    const { folders, lrcFiles, txtFiles, audioBaseSet } = await scanDirShallow(dirHandle);
                    populateChildren(children, dirHandle, folders, lrcFiles, txtFiles, audioBaseSet);
                    li.dataset.scanned = '1';
                } catch (e) {
                    console.error(e);
                    children.innerHTML = '<li class="lib-empty">' + escapeHtml('読み込みエラー: ' + e.message) + '</li>';
                } finally {
                    li.classList.remove('loading');
                }
            }
            li.classList.add('expanded');
            children.classList.remove('hidden');
        });
        return li;
    }

    function populateChildren(container, dirHandle, folders, lrcFiles, txtFiles, audioBaseSet) {
        container.innerHTML = '';
        if (folders.length === 0 && lrcFiles.length === 0 && txtFiles.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'lib-empty';
            const d = MOMO.i18n.get();
            empty.textContent = d.libEmpty || '(empty)';
            container.appendChild(empty);
            return;
        }
        for (const f of folders) {
            container.appendChild(buildFolderNode(f.handle, f.name));
        }
        for (const lrc of lrcFiles) {
            const li = document.createElement('li');
            li.className = 'lib-file lrc' + (audioBaseSet.has(lrc.base) ? ' has-audio' : '');
            li.textContent = lrc.name;
            li.addEventListener('click', (ev) => {
                ev.stopPropagation();
                onLrcClicked(dirHandle, lrc.handle);
            });
            container.appendChild(li);
        }
        for (const txt of txtFiles) {
            const li = document.createElement('li');
            li.className = 'lib-file txt' + (audioBaseSet.has(txt.base) ? ' has-audio' : '');
            li.textContent = txt.name;
            li.addEventListener('click', (ev) => {
                ev.stopPropagation();
                onTxtClicked(dirHandle, txt.handle);
            });
            container.appendChild(li);
        }
    }

    async function renderRoot() {
        const tree = document.getElementById('library-tree');
        if (!tree || !rootHandle) return;
        tree.innerHTML = '';
        tree.classList.remove('hidden');
        const ul = document.createElement('ul');
        tree.appendChild(ul);
        try {
            const { folders, lrcFiles, txtFiles, audioBaseSet } = await scanDirShallow(rootHandle);
            populateChildren(ul, rootHandle, folders, lrcFiles, txtFiles, audioBaseSet);
        } catch (e) {
            console.error(e);
            tree.innerHTML = '<div class="lib-empty">読み込みエラー: ' + escapeHtml(e.message) + '</div>';
        }
        // ライブラリ名表示
        const nameEl = document.getElementById('library-name');
        if (nameEl) nameEl.textContent = rootHandle.name || '';
        updateControlsVisibility();
    }

    // ───────────────────── ファイルクリック → 履歴登録 ─────────────────────

    async function onLrcClicked(parentDirHandle, fileHandle) {
        try {
            const file = await fileHandle.getFile();
            const text = await file.text();
            const doc = MOMO.lrc.parse(text);
            const baseName = file.name.replace(/\.lrc$/i, '');
            const audioHandle = await findAudioInDir(parentDirHandle, baseName);
            let audioFile = null;
            if (audioHandle) {
                try { audioFile = await audioHandle.getFile(); } catch (e) { audioFile = null; }
            }
            const entry = {
                id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                source: 'file',
                title: doc.metadata.ti || baseName,
                artist: doc.metadata.ar || '',
                rawLrc: text,
                doc: doc,
                fileHandle: fileHandle,
                audioFile: audioFile,
                audioHandle: audioHandle,
                createdAt: Date.now()
            };
            MOMO.play.addToHistory(entry);
            MOMO.play.selectEntry(entry);
        } catch (e) {
            console.error(e);
            alert('読み込みエラー: ' + e.message);
        }
    }

    async function onTxtClicked(parentDirHandle, fileHandle) {
        try {
            const file = await fileHandle.getFile();
            const text = await file.text();
            const baseName = file.name.replace(/\.txt$/i, '');
            const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            const audioHandle = await findAudioInDir(parentDirHandle, baseName);
            let audioFile = null;
            if (audioHandle) {
                try { audioFile = await audioHandle.getFile(); } catch (e) { audioFile = null; }
            }

            const lines = [];
            if (MOMO.state.addInfoHeader) {
                lines.push({ timeMs: 0, text: baseName, assigned: true, isInfoHeader: true });
            }
            for (const t of rawLines) {
                lines.push({ timeMs: 0, text: t, assigned: false });
            }
            const doc = { metadata: {}, lines: lines };
            const entry = {
                id: 'txt_' + Date.now(),
                source: 'txt',
                title: baseName,
                artist: '',
                rawLrc: '',
                doc: doc,
                fileHandle: null,
                txtHandle: fileHandle,
                audioFile: audioFile,
                audioHandle: audioHandle,
                createdAt: Date.now()
            };
            MOMO.play.addToHistory(entry);
            MOMO.play.selectEntry(entry);

            // タップUIを表示
            document.getElementById('tap-controls').classList.remove('hidden');
            MOMO.state.undoStack = [];
            if (MOMO.tap && MOMO.tap.updateTapProgress) MOMO.tap.updateTapProgress();
        } catch (e) {
            console.error(e);
            alert('読み込みエラー: ' + e.message);
        }
    }

    // ───────────────────── ボタン状態 ─────────────────────

    function updateControlsVisibility() {
        const reg = document.getElementById('library-register-row');
        const loaded = document.getElementById('library-loaded-row');
        if (rootHandle) {
            if (reg) reg.classList.add('hidden');
            if (loaded) loaded.classList.remove('hidden');
        } else {
            if (reg) reg.classList.remove('hidden');
            if (loaded) loaded.classList.add('hidden');
        }
    }

    // ───────────────────── 起動シーケンス ─────────────────────

    async function tryRestoreLibrary() {
        try {
            const handle = await idbGet(KEY_LIBRARY);
            if (handle) {
                rootHandle = handle;
                updateControlsVisibility();
                // 権限は次のユーザー操作（openLibraryBtn）で要求
                const nameEl = document.getElementById('library-name');
                if (nameEl) nameEl.textContent = handle.name || '';
            } else {
                updateControlsVisibility();
            }
        } catch (e) {
            console.warn('IDB get failed', e);
            updateControlsVisibility();
        }
    }

    async function openLibrary() {
        if (!rootHandle) {
            // ハンドルがなければ登録から
            return registerLibrary();
        }
        const ok = await ensurePermission(rootHandle, 'read');
        if (!ok) {
            const d = MOMO.i18n.get();
            alert(d.libPermDenied || 'Library permission denied');
            return;
        }
        await renderRoot();
    }

    // ───────────────────── 公開 ─────────────────────

    function init() {
        const reg = document.getElementById('registerLibraryBtn');
        const open = document.getElementById('openLibraryBtn');
        const change = document.getElementById('changeLibraryBtn');
        if (reg) reg.addEventListener('click', registerLibrary);
        if (open) open.addEventListener('click', openLibrary);
        if (change) change.addEventListener('click', changeLibrary);
        // 起動時に IndexedDB から復元（権限承認は openLibrary 押下時）
        tryRestoreLibrary();
    }

    MOMO.library = {
        init: init,
        registerLibrary: registerLibrary,
        openLibrary: openLibrary,
        changeLibrary: changeLibrary,
        renderRoot: renderRoot
    };
})();
