// =============================================================================
// MOMO Karaoke v2 — メイクモード (make.js)
// =============================================================================
// Phase 4a (2026-05-23): 仕様書 §4 メイクモード本実装の最小スコープ
//   - 取り込みパネル UI のイベントハンドラ (ファイル選択 / 自動フィル / 登録 / キャンセル)
//   - カラオケフォルダ接続 (ローカル限定、 File System Access API)
//   - 重複判定 α/β (同名・同ハッシュ検出)
//   - meta.json 作成 + mp3/lrc ファイル複製
//
// Phase 4b 以降の予定:
//   - voicecut100 / voicecut50 の OfflineAudioContext 生成 (v1.15 流用)
//   - Google Drive 上のカラオケフォルダ対応
//   - 上書き処理 (alpha 一致時の選択肢 '上書き')
//   - mp3 タグから空欄補完 (jsmediatags) を完全に
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
function pickFile(accept, onPicked) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        document.body.removeChild(input);
        if (file) onPicked(file);
    });
    input.addEventListener('cancel', () => {
        document.body.removeChild(input);
    });
    input.click();
}

async function onPickMp3() {
    pickFile('audio/*', async (file) => {
        mkState.pendingMp3File = file;
        if (mp3NameEl) mp3NameEl.value = file.name;
        await autofillFromFiles();
    });
}

async function onPickLrc() {
    pickFile('.lrc,text/plain', async (file) => {
        mkState.pendingLrcFile = file;
        if (lrcNameEl) lrcNameEl.value = file.name;
        await autofillFromFiles();
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
            const choice = prompt(
                '同名の曲が既に登録されています (別 BGM の可能性):\n  ' +
                alphaHit.meta.title + ' - ' + alphaHit.meta.artist +
                '\n\n1: 別バージョンとして登録\n2: 上書き (Phase 4b で実装、 今は別バージョン扱い)\n3: キャンセル\n\n番号を入力 (1/2/3):', '3'
            );
            if (choice === '3' || choice === null) {
                setStatus('キャンセルしました', 'var(--text-muted)');
                return;
            }
            // 1 or 2 → 別バージョンとして登録
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
