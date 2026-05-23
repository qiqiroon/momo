// =============================================================================
// MOMO Karaoke v2 — メイクモード (make.js)
// =============================================================================
// Phase 4a (2026-05-23 v2.00): 仕様書 §4 メイクモード本実装の最小スコープ
//   - 取り込みパネル UI のイベントハンドラ (ファイル選択 / 自動フィル / 登録 / キャンセル)
//   - カラオケフォルダ接続 (ローカル限定、 File System Access API)
//   - 重複判定 α/β (同名・同ハッシュ検出)
//   - meta.json 作成 + mp3/lrc ファイル複製
//
// v2.01 (2026-05-23): v200改造.txt の 3〜5 を対応
//   - 音楽ファイル選択を multiple 対応 (mp3 と同名 .lrc を同時選択で自動振り分け)
//   - mp3 タグ自動フィルが動くよう jsmediatags を index.html で読込
//   - 重複時 3 択を prompt → ボタン式モーダル (#make-conflict-modal)
//
// v2.02 (2026-05-23): 仕様書 §4.3-§4.4 の自動セットルール正しく反映
//   - 音楽ファイル選択 = showDirectoryPicker でフォルダ参照 → 中の音楽ファイル一覧から選択
//     → 選択した mp3 と同フォルダの同名 .lrc を自動セット
//   - 歌詞ファイル選択 = 同様、 lrc 選択 → 同フォルダの同名 mp3 を自動セット (音楽欄が空時)
//   - iOS Safari (showDirectoryPicker 非対応) は multiple 選択にフォールバック (v2.01 動作)
//
// Phase 4b 以降の予定:
//   - voicecut100 / voicecut50 の OfflineAudioContext 生成 (v1.15 流用)
//   - Google Drive 上のカラオケフォルダ対応
//   - 上書き処理 (alpha 一致時の選択肢 '上書き') の本実装
// =============================================================================

(function(global){
'use strict';

const META = global.MomoMeta;
if (!META) { console.error('[make.js] MomoMeta not loaded'); return; }

// ─────────── State ───────────
const mkState = {
    karaokeFolderHandle: null,    // ローカル時の FileSystemDirectoryHandle
    karaokeFolderProvider: null,  // 'local' | 'drive' (Phase 4b)
    pendingMp3File: null,         // 音楽ファイル (File オブジェクト)
    pendingLrcFile: null,         // 歌詞ファイル (File オブジェクト)
};

// ─────────── DOM 参照 ───────────
function $(id) { return document.getElementById(id); }
let mp3NameEl, lrcNameEl, titleEl, artistEl, statusEl;
let btnPickMp3, btnPickLrc, btnRegister, btnCancel;
let folderStatusEl, btnConnectFolder;

function setStatus(msg, color) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = color || 'var(--text-muted)';
}

function updateFolderStatus() {
    if (!folderStatusEl) return;
    if (mkState.karaokeFolderHandle) {
        folderStatusEl.textContent = '✅ ' + mkState.karaokeFolderHandle.name + ' (ローカル)';
        folderStatusEl.style.color = 'var(--orange-light)';
        if (btnConnectFolder) btnConnectFolder.textContent = '変更';
    } else {
        folderStatusEl.textContent = '未接続';
        folderStatusEl.style.color = 'var(--text-muted)';
        if (btnConnectFolder) btnConnectFolder.textContent = '接続';
    }
}

function clearPanel() {
    mkState.pendingMp3File = null;
    mkState.pendingLrcFile = null;
    if (mp3NameEl) mp3NameEl.value = '';
    if (lrcNameEl) lrcNameEl.value = '';
    if (titleEl) titleEl.value = '';
    if (artistEl) artistEl.value = '';
    setStatus('');
}

// ─────────── カラオケフォルダ接続 ───────────
async function onConnectFolder() {
    if (!META.Local.isSupported()) {
        alert('このブラウザはローカルフォルダに対応していません (iOS Safari 等)。\nGoogle Drive 経由のカラオケフォルダ接続は Phase 4b で実装予定です。');
        return;
    }
    try {
        const handle = await META.Local.pickKaraokeFolder();
        mkState.karaokeFolderHandle = handle;
        mkState.karaokeFolderProvider = 'local';
        // 初回接続なら _app_settings.json をデフォルトで作成 (なければ)
        try {
            await META.Local.loadAppSettings(handle);  // 試しに読む
            // 読めた = 既存フォルダ。 何もしない
        } catch (e) {
            await META.Local.saveAppSettings(handle, META.defaultAppSettings());
        }
        updateFolderStatus();
        console.log('[make] カラオケフォルダ接続:', handle.name);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('[make] カラオケフォルダ接続失敗:', e);
        alert('カラオケフォルダ接続失敗: ' + e.message);
    }
}

// ─────────── ファイル選択 (input[type=file] で簡易対応) ───────────
// v2.01: multiple 対応 + mp3/lrc 自動振り分け (PC + iOS 両対応)
function pickFiles(accept, multiple, onPicked) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
        const files = input.files ? Array.from(input.files) : [];
        document.body.removeChild(input);
        if (files.length) onPicked(files);
    });
    input.addEventListener('cancel', () => {
        try { document.body.removeChild(input); } catch (e) {}
    });
    input.click();
}

function isAudioFile(name) {
    return /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name);
}
function isLrcFile(name) {
    return /\.lrc$/i.test(name);
}
function baseName(name) {
    return name.replace(/\.[^.]+$/, '');
}

// v2.02: フォルダから ファイル一覧を取得し、 audio / lrc を分類
async function collectMusicLibraryFiles(folderHandle) {
    const list = [];
    for await (const entry of folderHandle.values()) {
        if (entry.kind === 'file' && (isAudioFile(entry.name) || isLrcFile(entry.name))) {
            list.push({ name: entry.name, handle: entry, kind: isAudioFile(entry.name) ? 'audio' : 'lrc' });
        }
    }
    // ソート: kind 別 + 名前
    list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'audio' ? -1 : 1;
        return a.name.localeCompare(b.name, 'ja');
    });
    return list;
}

// v2.02: 仕様書 §4.3 通り — 音楽ファイル選択 = フォルダ参照 → 中の audio から選択 → 同名 .lrc 自動セット
async function onPickMp3() {
    // PC (showDirectoryPicker 対応) → フォルダ参照 + ファイル選択モーダル
    if (typeof window.showDirectoryPicker === 'function') {
        let folderHandle;
        try {
            folderHandle = await window.showDirectoryPicker({
                id: 'momo-music-library',
                mode: 'read',
                startIn: 'music',
            });
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('[make] フォルダ参照失敗:', e);
            return;
        }
        try {
            const allFiles = await collectMusicLibraryFiles(folderHandle);
            const audioFiles = allFiles.filter(f => f.kind === 'audio');
            if (audioFiles.length === 0) {
                alert('選択したフォルダに音楽ファイル (mp3/wav/m4a/aac/flac/ogg) が見つかりません');
                return;
            }
            const picked = await showFilePickerModal(audioFiles, '音楽ファイルを選択', folderHandle.name);
            if (!picked) return;
            // 選択した mp3 を読み込む
            mkState.pendingMp3File = await picked.handle.getFile();
            if (mp3NameEl) mp3NameEl.value = picked.name;
            // 仕様書 §4.3 step 3: 同フォルダの同名 .lrc を自動セット (歌詞欄が空ならセット)
            const base = baseName(picked.name);
            const lrcMatch = allFiles.find(f => f.kind === 'lrc' && baseName(f.name) === base);
            if (lrcMatch && !mkState.pendingLrcFile) {
                mkState.pendingLrcFile = await lrcMatch.handle.getFile();
                if (lrcNameEl) lrcNameEl.value = lrcMatch.name;
            }
            await autofillFromFiles();
        } catch (e) {
            console.error('[make] ファイル選択失敗:', e);
            alert('ファイル選択失敗: ' + e.message);
        }
        return;
    }

    // iOS Safari fallback — multiple 選択 + 自動振り分け (v2.01 互換)
    pickFiles('audio/*,.lrc', /* multiple */ true, async (files) => {
        const audio = files.find(f => isAudioFile(f.name));
        let lrc = files.find(f => isLrcFile(f.name));
        if (audio) {
            mkState.pendingMp3File = audio;
            if (mp3NameEl) mp3NameEl.value = audio.name;
            if (!lrc && files.length > 1) {
                const base = baseName(audio.name);
                lrc = files.find(f => isLrcFile(f.name) && baseName(f.name) === base);
            }
        }
        if (lrc) {
            mkState.pendingLrcFile = lrc;
            if (lrcNameEl) lrcNameEl.value = lrc.name;
        }
        await autofillFromFiles();
    });
}

// v2.02: 仕様書 §4.4 通り — 歌詞ファイル選択 = フォルダ参照 → 中の lrc から選択 → 同名 mp3 自動セット (音楽欄が空時)
async function onPickLrc() {
    // PC (showDirectoryPicker 対応)
    if (typeof window.showDirectoryPicker === 'function') {
        let folderHandle;
        try {
            folderHandle = await window.showDirectoryPicker({
                id: 'momo-music-library',
                mode: 'read',
                startIn: 'music',
            });
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('[make] フォルダ参照失敗:', e);
            return;
        }
        try {
            const allFiles = await collectMusicLibraryFiles(folderHandle);
            const lrcFiles = allFiles.filter(f => f.kind === 'lrc');
            if (lrcFiles.length === 0) {
                alert('選択したフォルダに歌詞ファイル (.lrc) が見つかりません');
                return;
            }
            const picked = await showFilePickerModal(lrcFiles, '歌詞ファイルを選択', folderHandle.name);
            if (!picked) return;
            mkState.pendingLrcFile = await picked.handle.getFile();
            if (lrcNameEl) lrcNameEl.value = picked.name;
            // 仕様書 §4.4 step 3: 音楽ファイル欄が空の場合のみ、 同フォルダの同名 mp3 を自動セット
            if (!mkState.pendingMp3File) {
                const base = baseName(picked.name);
                const audioMatch = allFiles.find(f => f.kind === 'audio' && baseName(f.name) === base);
                if (audioMatch) {
                    mkState.pendingMp3File = await audioMatch.handle.getFile();
                    if (mp3NameEl) mp3NameEl.value = audioMatch.name;
                }
            }
            await autofillFromFiles();
        } catch (e) {
            console.error('[make] ファイル選択失敗:', e);
            alert('ファイル選択失敗: ' + e.message);
        }
        return;
    }

    // iOS Safari fallback — 単一 lrc 選択
    pickFiles('.lrc,text/plain', /* multiple */ false, async (files) => {
        const file = files[0];
        if (!file) return;
        mkState.pendingLrcFile = file;
        if (lrcNameEl) lrcNameEl.value = file.name;
        await autofillFromFiles();
    });
}

// v2.02: フォルダ内ファイル選択モーダル
//   files: [{ name, handle, kind }]
//   returns Promise<picked | null>
function showFilePickerModal(files, title, folderName) {
    return new Promise((resolve) => {
        const modal = $('make-file-picker-modal');
        const titleEl2 = $('make-file-picker-title');
        const folderEl = $('make-file-picker-folder');
        const listEl = $('make-file-picker-list');
        const btnCancel = $('make-file-picker-cancel');
        if (!modal || !listEl || !btnCancel) {
            console.warn('[make] file picker modal elements missing — using alert fallback');
            resolve(null);
            return;
        }
        if (titleEl2) titleEl2.textContent = title;
        if (folderEl) folderEl.textContent = '📁 ' + (folderName || '(無名フォルダ)');
        listEl.innerHTML = '';
        const close = (result) => {
            modal.style.display = 'none';
            btnCancel.removeEventListener('click', onCancelClick);
            resolve(result);
        };
        const onCancelClick = () => close(null);
        btnCancel.addEventListener('click', onCancelClick);
        // ファイル一覧描画
        files.forEach(f => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 10px; cursor:pointer; color:var(--text); font-size:13px; border-bottom:1px solid var(--border); border-radius:4px;';
            const icon = f.kind === 'audio' ? '♪ ' : '📄 ';
            item.textContent = icon + f.name;
            item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-selected)'; item.style.color = 'var(--orange-light)'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.color = 'var(--text)'; });
            item.addEventListener('click', () => close(f));
            listEl.appendChild(item);
        });
        modal.style.display = 'flex';
    });
}

// ─────────── 自動フィル (mp3 タグ + lrc ヘッダ) ───────────
async function autofillFromFiles() {
    // lrc ヘッダ [ti:] [ar:] 解析 — 空欄のみ補完 (仕様 §4.5)
    if (mkState.pendingLrcFile) {
        try {
            const text = await mkState.pendingLrcFile.text();
            const { title, artist } = META.parseLrcHeader(text);
            if (title && titleEl && !titleEl.value) titleEl.value = title;
            if (artist && artistEl && !artistEl.value) artistEl.value = artist;
        } catch (e) { console.warn('[make] lrc parse fail:', e); }
    }
    // mp3 タグ (jsmediatags) — 空欄のみ補完
    if (mkState.pendingMp3File && typeof window.jsmediatags !== 'undefined') {
        await new Promise((resolve) => {
            try {
                window.jsmediatags.read(mkState.pendingMp3File, {
                    onSuccess: (tag) => {
                        const tags = (tag && tag.tags) || {};
                        if (tags.title && titleEl && !titleEl.value) titleEl.value = tags.title;
                        if (tags.artist && artistEl && !artistEl.value) artistEl.value = tags.artist;
                        resolve();
                    },
                    onError: () => resolve(),
                });
            } catch (e) {
                console.warn('[make] mp3 tag fail:', e);
                resolve();
            }
        });
    }
}

// ─────────── 登録 ───────────
async function onRegister() {
    const title = ((titleEl && titleEl.value) || '').trim();
    const artist = ((artistEl && artistEl.value) || '').trim();

    // バリデーション (仕様 §4.6)
    if (!title || !artist) {
        alert('曲名とアーティスト名は必須です');
        return;
    }
    if (!mkState.pendingMp3File && !mkState.pendingLrcFile) {
        alert('音楽ファイルまたは歌詞ファイルのいずれか少なくとも 1 つは必須です');
        return;
    }
    if (!mkState.karaokeFolderHandle) {
        alert('先にカラオケフォルダを接続してください');
        return;
    }

    btnRegister.disabled = true;
    const oldLabel = btnRegister.textContent;
    btnRegister.textContent = '処理中…';
    setStatus('ハッシュ計算中…', 'var(--orange-light)');

    try {
        // 1. mp3 ハッシュ計算
        let mp3Hash = null;
        if (mkState.pendingMp3File) {
            const buf = await mkState.pendingMp3File.arrayBuffer();
            mp3Hash = await META.sha256Prefixed(buf);
        }

        // 2. 重複判定 — 既存曲の列挙
        setStatus('既存曲を確認中…', 'var(--orange-light)');
        const existing = await META.Local.listSongs(mkState.karaokeFolderHandle);
        const candidateMeta = META.defaultSongMeta(title, artist);
        candidateMeta.mp3Hash = mp3Hash;

        const alphaHit = existing.find(s => META.isDuplicateAlpha(s.meta, candidateMeta));
        const betaHit = mp3Hash ? existing.find(s => META.isDuplicateBeta(s.meta, candidateMeta)) : null;

        // 仕様 §4.6 重複判定マトリクス
        if (alphaHit && betaHit && alphaHit.internalId === betaHit.internalId) {
            // α・β 両方一致: 既登録
            alert('既に登録済みです:\n' + title + ' - ' + artist);
            return;
        }
        if (alphaHit) {
            // v2.01: prompt → ボタン式モーダル
            const choice = await showConflictModal(
                '同名の曲が既に登録されています (別 BGM の可能性):\n' +
                '  ' + (alphaHit.meta.title || '(無題)') + ' - ' + (alphaHit.meta.artist || '(無記名)') + '\n' +
                'どうしますか?'
            );
            if (choice === 'cancel') {
                setStatus('キャンセルしました', 'var(--text-muted)');
                return;
            }
            if (choice === 'overwrite') {
                // 上書きは Phase 4b で本実装。 現状は別バージョン扱いで続行
                console.log('[make] 上書き選択 → 別バージョン扱いで続行 (Phase 4b で本実装予定)');
            }
            // 'version' or 'overwrite' → 別バージョンとして登録
        } else if (betaHit) {
            const ok = confirm(
                '同じ音源で別名の登録があります:\n  ' +
                betaHit.meta.title + ' - ' + betaHit.meta.artist +
                '\n\n別名で新規登録しますか?'
            );
            if (!ok) {
                setStatus('キャンセルしました', 'var(--text-muted)');
                return;
            }
        }

        // 3. 曲フォルダ作成 (重複時 _001, _002 サフィックス自動)
        setStatus('曲フォルダ作成中…', 'var(--orange-light)');
        const baseId = META.generateSongFolderId(title, artist);
        const { internalId, handle: songFolder } = await META.Local.createSongFolder(mkState.karaokeFolderHandle, baseId);

        // 4. ファイル複製
        setStatus('ファイル複製中…', 'var(--orange-light)');
        if (mkState.pendingMp3File) {
            const safeName = META.sanitizeFileName(mkState.pendingMp3File.name);
            await META.Local.writeFile(songFolder, safeName, mkState.pendingMp3File);
        }
        if (mkState.pendingLrcFile) {
            const safeName = META.sanitizeFileName(mkState.pendingLrcFile.name);
            await META.Local.writeFile(songFolder, safeName, mkState.pendingLrcFile);
        }

        // 5. voicecut 生成 (Phase 4b で実装)
        candidateMeta.voicecutAvailable = false;
        candidateMeta.voicecutEffective = null;

        // 6. meta.json 保存
        setStatus('meta.json 保存中…', 'var(--orange-light)');
        await META.Local.saveSongMeta(songFolder, candidateMeta);

        setStatus('✅ 登録完了: ' + internalId, 'var(--orange-light)');
        alert(
            '登録完了!\n' +
            '曲: ' + title + ' - ' + artist + '\n' +
            'フォルダ: ' + internalId + '\n' +
            'voicecut 生成は Phase 4b で実装予定 (今は voicecutAvailable=false)'
        );
        clearPanel();

    } catch (e) {
        console.error('[make] 登録失敗:', e);
        setStatus('❌ ' + e.message, '#f87171');
        alert('登録失敗: ' + e.message);
    } finally {
        btnRegister.disabled = false;
        btnRegister.textContent = oldLabel || '登録';
    }
}

function onCancel() {
    if (mp3NameEl?.value || lrcNameEl?.value || titleEl?.value || artistEl?.value) {
        if (!confirm('入力をクリアしますか?')) return;
    }
    clearPanel();
}

// ─────────── v2.01: 重複時の 3 択モーダル ───────────
// returns Promise<'version' | 'overwrite' | 'cancel'>
function showConflictModal(message) {
    return new Promise((resolve) => {
        const modal = $('make-conflict-modal');
        const msgEl = $('make-conflict-message');
        const btnVersion = $('make-conflict-version');
        const btnOverwrite = $('make-conflict-overwrite');
        const btnCancel = $('make-conflict-cancel');
        if (!modal || !msgEl || !btnVersion || !btnOverwrite || !btnCancel) {
            // モーダル要素が無ければ confirm にフォールバック
            const ok = confirm(message + '\n\nOK で別バージョンとして登録、 キャンセルで中止します');
            resolve(ok ? 'version' : 'cancel');
            return;
        }
        msgEl.textContent = message;
        modal.style.display = 'flex';
        const close = (result) => {
            modal.style.display = 'none';
            btnVersion.removeEventListener('click', onV);
            btnOverwrite.removeEventListener('click', onO);
            btnCancel.removeEventListener('click', onC);
            resolve(result);
        };
        const onV = () => close('version');
        const onO = () => close('overwrite');
        const onC = () => close('cancel');
        btnVersion.addEventListener('click', onV);
        btnOverwrite.addEventListener('click', onO);
        btnCancel.addEventListener('click', onC);
    });
}

// ─────────── DOM バインド ───────────
function bindDom() {
    mp3NameEl = $('make-mp3-name');
    lrcNameEl = $('make-lrc-name');
    titleEl = $('make-title');
    artistEl = $('make-artist');
    statusEl = $('make-status');
    btnPickMp3 = $('make-pick-mp3');
    btnPickLrc = $('make-pick-lrc');
    btnRegister = $('make-register');
    btnCancel = $('make-cancel');
    folderStatusEl = $('make-folder-status');
    btnConnectFolder = $('make-folder-btn');

    if (btnPickMp3) btnPickMp3.addEventListener('click', onPickMp3);
    if (btnPickLrc) btnPickLrc.addEventListener('click', onPickLrc);
    if (btnRegister) btnRegister.addEventListener('click', onRegister);
    if (btnCancel) btnCancel.addEventListener('click', onCancel);
    if (btnConnectFolder) btnConnectFolder.addEventListener('click', onConnectFolder);

    updateFolderStatus();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDom);
} else {
    bindDom();
}

// ─────────── 公開 API ───────────
global.MomoMake = {
    state: mkState,
    PHASE: 4,
    refreshFolderStatus: updateFolderStatus,
};

console.log('[make.js] MomoMake module loaded (Phase 4a)');

})(window);
