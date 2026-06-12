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
// v2.09 (2026-05-24): メイクタブ登録/上書き処理の Drive 対応
//   - 問題: v2.08 でカラオケフォルダ Drive 接続 UI を作ったが、 登録ボタン押下時に
//     'karaokeFolderHandle' (Local 限定) でしか接続判定していなかったため、
//     Drive 接続済みでも「先にカラオケフォルダを接続してください」 エラー。
//   - 対策:
//     1) _isKaraokeConnected() で provider 別に接続判定
//     2) _ks* ラッパー関数群 (listSongs / createSongFolder / writeFile /
//        saveSongMeta / deleteFile / listFiles) を導入
//     3) onRegister / performOverwrite / _runVoicecutFlow 内の Local 呼び出しを
//        ラッパー経由に置き換え (provider 別自動分岐)
//   - 音楽ライブラリ Drive 対応 (mp3 選択を Drive 経由) は v2.10 で予定
//
// v2.08 (2026-05-24): カラオケフォルダの Drive 対応 (v200改造.txt 1)
//   - 「接続/変更」 ボタンを押すと「ローカル / Google Drive」 選択モーダル
//   - Drive 選択 → 既存 v1.39 の gdrive.connect() で OAuth →
//     ensureKaraokeRoot で `momo-works/karaoke` を navigate (なければ mkdir)
//   - ローカル選択 → 従来通り showDirectoryPicker
//   - 永続化: provider 種別 (local/drive) を localStorage に保存
//   - 既存 v1.39 の gdrive オブジェクトは index.html IIFE 末尾で window.gdrive に
//     expose されている (v2.08 で追加、 中身は無変更)
//   - 音楽ライブラリの Drive 対応 / メイクタブの Drive 連携完成は v2.09 以降
//
// v2.07 (2026-05-24): 重複時「上書き」 処理の本実装 (仕様書 §4.6)
//   - α 一致時の 3 択モーダル「上書き」 を選んだ場合の動作:
//     既存曲フォルダを再利用し、 mp3 / lrc / voicecut*.wav を新ファイルに差し替え。
//     internalId は維持、 createdAt は維持、 modifiedAt のみ更新。
//   - 既存テイク/MIX の扱いは 「ユーザーに毎回確認」 (Q2C 採用):
//     新規モーダル #make-overwrite-modal の 3 ボタン
//       「保持して上書き」 / 「削除して上書き」 / 「キャンセル」
//     既存テイク/MIX が無ければ確認スキップ (削除でも保持でも同じ)
//
// v2.06 (2026-05-23): voicecut カーブをさらに強化 (sqrt → 2 次関数) + デバッグログ
//   - ユーザー指摘: v2.05 でもまだ 50% の変化が小さい
//   - 対策: eff = 2*i - i^2 (= 1 - (1-i)^2) で intensity=0.5 → eff=0.75
//     v2.04 線形=0.5 / v2.05 sqrt=0.707 / v2.06 二次=0.75
//     ボーカル成分 (mid) は 0.25 倍 = -12dB 減衰
//   - 補足: 「カラオケモードで 50% トグル」 は Phase 5 未実装のため
//     v1.39 リアルタイム vocalCut (index.html line 2902) が動いている可能性。
//     その場合は本修正 (make.js の generate) は効かない。 確認用に
//     console.log で intensity → eff の対応を出力するよう追加。
//
// v2.05 (2026-05-23): voicecut 強度カーブ調整 (50% の実効カットを強める)
//   - ユーザー指摘: voicecut 50% がほとんどカットできていない
//   - 原因: v2.04 までは線形ブレンド (intensity=0.5 で side 0.5 + 元 0.5)
//     → ボーカル成分は理論上 50% しか減衰せず、 体感的にほぼ変わらない
//   - 対策: intensity → sqrt(intensity) の非線形変換
//     0%→0.000、 50%→0.707 (ボーカル 約 70% カット)、 100%→1.000
//   - 100% (完全カット) の動作は同じ (sqrt(1) = 1)、 0% も同じ (sqrt(0) = 0)
//
// v2.04 (2026-05-23): voicecut100/50 自動生成 + 段階 A/B/C 検証 (仕様書 §4.7)
//   - generateVoicecutWav() — v1.39 の generateVocalCutPcm + stereoPcmToWavBlob を
//     make.js 内に同等再実装 (既存ロジック保護のため index.html は触らず)
//   - 段階 A: 事前チェック (モノラル / 疑似モノラル) → 警告ダイアログ
//   - 段階 B: 効果チェック (voicecut100 vs 元音源 RMS 差 < 3dB → weak)
//   - 段階 C: その他失敗 (decode 不能、 メモリ不足等) → エラーダイアログ
//   - meta.json に voicecutAvailable / voicecutEffective を正しく記録
//
// v2.03 (2026-05-23): カラオケフォルダ + 音楽ライブラリの永続化 (IndexedDB) + 自動復元
//   - 仕様書 §3.4 L1 通り、 FileSystemDirectoryHandle を IndexedDB に保存
//   - 起動時に queryPermission → 'granted' なら自動接続
//   - 音楽ライブラリ概念を追加 (UI セクション + 永続化)、 ファイル選択時は
//     showDirectoryPicker を毎回呼ばず、 保存済みハンドルから直接列挙
//   - 「変更」 ボタンでフォルダ再選択
//   - サブフォルダ再帰探索 (深さ 1) で直下に無い場合もファイルを発見
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
    karaokeFolderHandle: null,     // ローカル時の FileSystemDirectoryHandle
    karaokeFolderProvider: null,   // 'local' | 'drive' (Phase 4b)
    musicLibraryHandle: null,      // v2.03: ローカル時の FileSystemDirectoryHandle
    musicLibraryProvider: null,    // 'local' | 'drive' (v2.14: drive 対応)
    musicLibraryDrivePath: null,   // v2.14: Drive 時の絶対パス (例: '/momo-works/music')
    pendingMp3File: null,
    pendingLrcFile: null,
};

// ─────────── DOM 参照 ───────────
function $(id) { return document.getElementById(id); }
let mp3NameEl, lrcNameEl, titleEl, artistEl, statusEl;
let btnPickMp3, btnPickLrc, btnRegister, btnCancel;
let folderStatusEl, btnConnectFolder;
let libraryStatusEl, btnConnectLibrary;  // v2.03

function setStatus(msg, color) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = color || 'var(--text-muted)';
}

function updateFolderStatus() {
    if (!folderStatusEl) return;
    if (mkState.karaokeFolderProvider === 'drive') {
        folderStatusEl.textContent = '☁ Google Drive (' + META.Drive.KARAOKE_ROOT_PATH + ')';
        folderStatusEl.style.color = 'var(--orange-light)';
        if (btnConnectFolder) btnConnectFolder.textContent = '変更';
    } else if (mkState.karaokeFolderHandle) {
        folderStatusEl.textContent = '📁 ' + mkState.karaokeFolderHandle.name + ' (ローカル)';
        folderStatusEl.style.color = 'var(--orange-light)';
        if (btnConnectFolder) btnConnectFolder.textContent = '変更';
    } else {
        folderStatusEl.textContent = '未接続';
        folderStatusEl.style.color = 'var(--text-muted)';
        if (btnConnectFolder) btnConnectFolder.textContent = '接続';
    }
}

// v2.03 + v2.14: 音楽ライブラリの状態表示 (Local + Drive 対応)
function updateLibraryStatus() {
    if (!libraryStatusEl) return;
    if (mkState.musicLibraryProvider === 'drive' && mkState.musicLibraryDrivePath) {
        libraryStatusEl.textContent = '☁ Google Drive (' + mkState.musicLibraryDrivePath + ')';
        libraryStatusEl.style.color = 'var(--orange-light)';
        if (btnConnectLibrary) btnConnectLibrary.textContent = '変更';
    } else if (mkState.musicLibraryHandle) {
        libraryStatusEl.textContent = '📁 ' + mkState.musicLibraryHandle.name + ' (ローカル)';
        libraryStatusEl.style.color = 'var(--orange-light)';
        if (btnConnectLibrary) btnConnectLibrary.textContent = '変更';
    } else {
        libraryStatusEl.textContent = '未設定';
        libraryStatusEl.style.color = 'var(--text-muted)';
        if (btnConnectLibrary) btnConnectLibrary.textContent = '設定';
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

// ─────────── カラオケフォルダ接続 (v2.08: ローカル / Drive 選択) ───────────
async function onConnectFolder() {
    // v2.24: iOS Safari の OAuth ポップアップは user gesture から距離が離れると
    // ブロックされる。 ストレージモーダル表示中に Pyodide を裏で事前ロードしておき、
    // 「Drive 選択」 押下時には即座に OAuth を呼べる状態にする。
    if (window.gdrive && typeof window.gdrive.ensurePyodide === 'function') {
        window.gdrive.ensurePyodide().catch(e => console.warn('[make] preload Pyodide fail:', e));
    }
    // ローカル / Drive 選択モーダル
    const provider = await showProviderPicker('カラオケフォルダのストレージを選択');
    if (provider === 'cancel') return;

    if (provider === 'local') {
        await _connectKaraokeFolderLocal();
    } else if (provider === 'drive') {
        await _connectKaraokeFolderDrive();
    }
}

async function _connectKaraokeFolderLocal() {
    if (!META.Local.isSupported()) {
        alert('このブラウザはローカルフォルダに対応していません (iOS Safari 等)。\nGoogle Drive を選択してください。');
        return;
    }
    try {
        const handle = await META.Local.pickKaraokeFolder();
        mkState.karaokeFolderHandle = handle;
        mkState.karaokeFolderProvider = 'local';
        try { await META.saveHandle('karaokeFolder', handle); } catch (e) { console.warn('[make] saveHandle karaokeFolder fail:', e); }
        try { localStorage.setItem('momoKaraokeProvider', 'local'); } catch (e) {}
        try {
            await META.Local.loadAppSettings(handle);
        } catch (e) {
            await META.Local.saveAppSettings(handle, META.defaultAppSettings());
        }
        // v2.88 (段階1b): 接続時にカラオケフォルダID を発行/読込してキャッシュ (オフライン録音の目印用)
        try { if (window._ensureKaraokeFolderId) await window._ensureKaraokeFolderId(true); } catch (e) {}
        updateFolderStatus();
        console.log('[make] カラオケフォルダ接続 (ローカル):', handle.name);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('[make] カラオケフォルダ接続失敗:', e);
        alert('カラオケフォルダ接続失敗: ' + e.message);
    }
}

async function _connectKaraokeFolderDrive() {
    if (!META.Drive.isSupported()) {
        alert('Drive 連携が利用できません (gdrive オブジェクト未公開、 v1.39 IIFE 未実行)。');
        return;
    }
    try {
        setStatus('Drive 接続中…', 'var(--orange-light)');
        await META.Drive.connect();
        setStatus('カラオケルートフォルダ確認中…', 'var(--orange-light)');
        const rootPath = await META.Drive.ensureKaraokeRoot();
        mkState.karaokeFolderHandle = null;  // Drive ではハンドル不要
        mkState.karaokeFolderProvider = 'drive';
        try { localStorage.setItem('momoKaraokeProvider', 'drive'); } catch (e) {}
        // 初回接続なら _app_settings.json をデフォルトで作成
        try {
            await META.Drive.loadAppSettings();
        } catch (e) {
            await META.Drive.saveAppSettings(META.defaultAppSettings());
        }
        // v2.88 (段階1b): 接続時にカラオケフォルダID を発行/読込してキャッシュ (オフライン録音の目印用)
        try { if (window._ensureKaraokeFolderId) await window._ensureKaraokeFolderId(true); } catch (e) {}
        updateFolderStatus();
        setStatus('✅ Drive 接続完了 (' + rootPath + ')', 'var(--orange-light)');
        // v2.96 (ステップ4): ユーザーが Drive に接続した = 宛先が書ける状態になった、 を検知 →
        //   宛先一致の未保存テイクを曲を開かず直行保存 (受け身トリガー②)。
        try { if (window._resumePendingUploads) window._resumePendingUploads('drive-connect'); } catch (e) {}
        console.log('[make] カラオケフォルダ接続 (Drive):', rootPath);
    } catch (e) {
        console.error('[make] Drive 接続失敗:', e);
        alert('Drive 接続失敗: ' + (e.message || e));
        setStatus('❌ Drive 接続失敗', '#f87171');
    }
}

// v2.08: ローカル / Drive 選択モーダル
// returns Promise<'local' | 'drive' | 'cancel'>
function showProviderPicker(title) {
    return new Promise((resolve) => {
        const modal = $('make-provider-modal');
        const titleEl = $('make-provider-title');
        const btnLocal = $('make-provider-local');
        const btnDrive = $('make-provider-drive');
        const btnCancel = $('make-provider-cancel');
        if (!modal || !btnLocal || !btnDrive || !btnCancel) {
            // fallback: confirm
            const isDrive = confirm((title || 'ストレージ選択') + '\n\nOK = Google Drive、 キャンセル = ローカル');
            resolve(isDrive ? 'drive' : 'local');
            return;
        }
        if (titleEl) titleEl.textContent = title || 'ストレージを選択';
        modal.style.display = 'flex';
        const close = (result) => {
            modal.style.display = 'none';
            btnLocal.removeEventListener('click', onL);
            btnDrive.removeEventListener('click', onD);
            btnCancel.removeEventListener('click', onC);
            resolve(result);
        };
        const onL = () => close('local');
        const onD = () => close('drive');
        const onC = () => close('cancel');
        btnLocal.addEventListener('click', onL);
        btnDrive.addEventListener('click', onD);
        btnCancel.addEventListener('click', onC);
    });
}

// v2.03 + v2.14: 音楽ライブラリ接続/変更 (Local / Drive 二択)
async function onConnectLibrary() {
    // v2.24: iOS Safari の OAuth ブロック対策 — モーダル表示中に Pyodide 事前ロード
    if (window.gdrive && typeof window.gdrive.ensurePyodide === 'function') {
        window.gdrive.ensurePyodide().catch(e => console.warn('[make] preload Pyodide fail:', e));
    }
    const provider = await showProviderPicker('音楽ライブラリのストレージを選択');
    if (provider === 'cancel') return;
    if (provider === 'local') {
        await _connectMusicLibraryLocal();
    } else if (provider === 'drive') {
        await _connectMusicLibraryDrive();
    }
}

async function _connectMusicLibraryLocal() {
    if (typeof window.showDirectoryPicker !== 'function') {
        alert('このブラウザはフォルダ参照に対応していません (iOS Safari 等)。\nGoogle Drive を選択してください。');
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({
            id: 'momo-music-library',
            mode: 'read',
        });
        mkState.musicLibraryHandle = handle;
        mkState.musicLibraryDrivePath = null;
        mkState.musicLibraryProvider = 'local';
        try { await META.saveHandle('musicLibrary', handle); } catch (e) { console.warn('[make] saveHandle musicLibrary fail:', e); }
        try { localStorage.setItem('momoMusicLibraryProvider', 'local'); } catch (e) {}
        try { localStorage.removeItem('momoMusicLibraryDrivePath'); } catch (e) {}
        updateLibraryStatus();
        console.log('[make] 音楽ライブラリ設定 (ローカル):', handle.name);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('[make] 音楽ライブラリ設定失敗:', e);
        alert('音楽ライブラリ設定失敗: ' + e.message);
    }
}

async function _connectMusicLibraryDrive() {
    if (!META.Drive.isSupported()) {
        alert('Drive 連携が利用できません (gdrive オブジェクト未公開、 v1.39 IIFE 未実行)。');
        return;
    }
    try {
        setStatus('Drive 接続中…', 'var(--orange-light)');
        await META.Drive.connect();
        setStatus('Drive フォルダを選択してください', 'var(--orange-light)');
        // 起点: 既に Drive 接続済みでカラオケルートがある場合は親 (/momo-works) から、
        // それも無ければルート '/' から開始
        const start = mkState.musicLibraryDrivePath || '/momo-works';
        const picked = await showDriveFolderPicker(start);
        if (!picked) { setStatus(''); return; }
        mkState.musicLibraryHandle = null;
        mkState.musicLibraryDrivePath = picked;
        mkState.musicLibraryProvider = 'drive';
        try { localStorage.setItem('momoMusicLibraryProvider', 'drive'); } catch (e) {}
        try { localStorage.setItem('momoMusicLibraryDrivePath', picked); } catch (e) {}
        updateLibraryStatus();
        setStatus('✅ Drive 音楽ライブラリ設定 (' + picked + ')', 'var(--orange-light)');
        console.log('[make] 音楽ライブラリ設定 (Drive):', picked);
    } catch (e) {
        console.error('[make] Drive 音楽ライブラリ設定失敗:', e);
        alert('Drive 音楽ライブラリ設定失敗: ' + (e.message || e));
        setStatus('❌ Drive 音楽ライブラリ設定失敗', '#f87171');
    }
}

// v2.14: Drive フォルダ階層ピッカー
//   起点パス (startAbs) から開始。 サブフォルダ一覧をクリックで降りる / 「↑ 上の階層」 で
//   parent へ / 「このフォルダを使用」 で現在の絶対パスを返す。
//   戻り値: 選択された絶対パス文字列 or null (キャンセル)
function showDriveFolderPicker(startAbs) {
    return new Promise((resolve) => {
        const modal = $('make-drive-folder-picker');
        const breadEl = $('make-drive-folder-breadcrumb');
        const listEl = $('make-drive-folder-list');
        const btnUp = $('make-drive-folder-up');
        const btnUse = $('make-drive-folder-use');
        const btnCancel = $('make-drive-folder-cancel');
        if (!modal || !breadEl || !listEl || !btnUp || !btnUse || !btnCancel) {
            // fallback: prompt で直接絶対パスを入力
            const v = prompt('Drive フォルダの絶対パスを入力 (例: /momo-works/music)', startAbs || '/');
            resolve(v || null);
            return;
        }
        let cur = (typeof startAbs === 'string' && startAbs) ? startAbs : '/';

        const close = (result) => {
            modal.style.display = 'none';
            btnUp.removeEventListener('click', onUp);
            btnUse.removeEventListener('click', onUse);
            btnCancel.removeEventListener('click', onCancel);
            resolve(result);
        };
        const onUp = async () => {
            if (cur === '/' || !cur) return;
            const parts = cur.split('/').filter(Boolean);
            parts.pop();
            cur = parts.length ? '/' + parts.join('/') : '/';
            await render();
        };
        const onUse = () => close(cur);
        const onCancel = () => close(null);

        async function render() {
            breadEl.textContent = cur;
            listEl.innerHTML = '<div style="padding:8px; color:var(--text-muted); font-size:12px;">読み込み中…</div>';
            try {
                const folders = await META.Drive.listFoldersAbs(cur);
                listEl.innerHTML = '';
                if (folders.length === 0) {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'padding:8px; color:var(--text-muted); font-size:12px;';
                    empty.textContent = '(サブフォルダなし)';
                    listEl.appendChild(empty);
                    return;
                }
                for (const f of folders) {
                    const row = document.createElement('div');
                    row.style.cssText = 'padding:8px 10px; cursor:pointer; border-radius:6px; font-size:13px; color:var(--text); display:flex; align-items:center; gap:8px;';
                    row.innerHTML = '<span style="color:var(--orange-light);">📁</span><span>' + f.name + '</span>';
                    row.addEventListener('mouseenter', () => row.style.background = 'var(--surface-2, rgba(255,255,255,0.06))');
                    row.addEventListener('mouseleave', () => row.style.background = '');
                    row.addEventListener('click', async () => {
                        cur = f.absPath;
                        await render();
                    });
                    listEl.appendChild(row);
                }
            } catch (e) {
                console.error('[make] Drive フォルダ列挙失敗:', e);
                listEl.innerHTML = '<div style="padding:8px; color:#f87171; font-size:12px;">列挙失敗: ' + (e.message || e) + '</div>';
            }
        }

        btnUp.addEventListener('click', onUp);
        btnUse.addEventListener('click', onUse);
        btnCancel.addEventListener('click', onCancel);
        modal.style.display = 'flex';
        render();
    });
}

// v2.03: 起動時の自動復元 (v2.08: Drive provider 復元も対応)
async function tryRestoreHandles() {
    // v2.08: provider 種別を localStorage から取得
    const provider = (() => { try { return localStorage.getItem('momoKaraokeProvider'); } catch (e) { return null; } })();
    if (provider === 'drive') {
        // Drive 接続は初回ロード時の自動接続 (OAuth) を避けて、 status だけ「前回: Drive」 表示
        if (folderStatusEl) {
            folderStatusEl.textContent = '☁ 前回: Google Drive (再接続が必要)';
            folderStatusEl.style.color = 'var(--text-muted)';
        }
        mkState._pendingDriveKaraoke = true;
        // 注意: 自動接続しない。 ユーザーが「変更」 ボタンを押した時に再接続
    }
    // カラオケフォルダ (ローカル)
    try {
        const handle = await META.loadHandle('karaokeFolder');
        if (handle && typeof handle.queryPermission === 'function') {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted' && provider !== 'drive') {
                mkState.karaokeFolderHandle = handle;
                mkState.karaokeFolderProvider = 'local';
                // v2.88 (段階1b): 自動復元時もカラオケフォルダID を用意 (ローカルは常に到達可)
                try { if (window._ensureKaraokeFolderId) await window._ensureKaraokeFolderId(true); } catch (e) {}
                updateFolderStatus();
                console.log('[make] カラオケフォルダ自動復元:', handle.name);
            } else if (provider !== 'drive') {
                console.log('[make] カラオケフォルダ復元保留 (権限要再認証):', handle.name);
                // 状態だけ「前回: <名前>」 表示してユーザーに再接続を促す
                if (folderStatusEl) {
                    folderStatusEl.textContent = '前回: ' + handle.name + ' (再接続必要)';
                    folderStatusEl.style.color = 'var(--text-muted)';
                }
                mkState._pendingKaraokeHandle = handle;
            }
        }
    } catch (e) { console.warn('[make] カラオケフォルダ復元失敗:', e); }

    // 音楽ライブラリ (v2.14: provider 別に復元)
    const libProvider = (() => { try { return localStorage.getItem('momoMusicLibraryProvider'); } catch (e) { return null; } })();
    if (libProvider === 'drive') {
        // Drive: path だけ復元、 自動 OAuth はしない (ユーザーが「変更」 押下時に再接続)
        const path = (() => { try { return localStorage.getItem('momoMusicLibraryDrivePath'); } catch (e) { return null; } })();
        mkState.musicLibraryDrivePath = path;
        mkState.musicLibraryProvider = 'drive';  // フラグだけ立てる (実通信は使用時)
        if (libraryStatusEl) {
            libraryStatusEl.textContent = '☁ 前回: Google Drive (' + (path || '?') + ', 再接続必要)';
            libraryStatusEl.style.color = 'var(--text-muted)';
        }
        mkState._pendingDriveLibrary = true;
    } else {
        try {
            const handle = await META.loadHandle('musicLibrary');
            if (handle && typeof handle.queryPermission === 'function') {
                const perm = await handle.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    mkState.musicLibraryHandle = handle;
                    mkState.musicLibraryProvider = 'local';
                    updateLibraryStatus();
                    console.log('[make] 音楽ライブラリ自動復元:', handle.name);
                } else {
                    if (libraryStatusEl) {
                        libraryStatusEl.textContent = '前回: ' + handle.name + ' (再認証必要)';
                        libraryStatusEl.style.color = 'var(--text-muted)';
                    }
                    mkState._pendingLibraryHandle = handle;
                }
            }
        } catch (e) { console.warn('[make] 音楽ライブラリ復元失敗:', e); }
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

// v2.02 + v2.03 + v2.14: フォルダから ファイル一覧を取得 (Local 版、 サブフォルダ深さ 1 まで再帰)
// 返却 (Local/Drive 共通形式): [{ name, kind, relPath, parentKey, getFile, handle? }]
//   ・ parentKey: 同フォルダ判定用 (Local: parentHandle、 Drive: parent absPath)
//   ・ getFile(): async で File/Blob を返す (Drive はオンデマンドフェッチ)
async function collectMusicLibraryFiles(folderHandle, maxDepth) {
    const list = [];
    const depth = (typeof maxDepth === 'number') ? maxDepth : 1;  // デフォルト 1 階層
    async function walk(dir, prefix, curDepth) {
        try {
            for await (const entry of dir.values()) {
                if (entry.kind === 'file') {
                    if (isAudioFile(entry.name) || isLrcFile(entry.name)) {
                        const ent = entry;
                        list.push({
                            name: entry.name,
                            handle: entry,        // 後方互換 (一部既存呼出箇所が参照する可能性)
                            kind: isAudioFile(entry.name) ? 'audio' : 'lrc',
                            relPath: prefix + entry.name,
                            parentHandle: dir,    // 後方互換
                            parentKey: dir,       // v2.14: Drive と共通の同フォルダ判定キー
                            getFile: async () => await ent.getFile(),
                        });
                    }
                } else if (entry.kind === 'directory' && curDepth < depth) {
                    await walk(entry, prefix + entry.name + '/', curDepth + 1);
                }
            }
        } catch (e) {
            console.warn('[make] フォルダ列挙エラー (' + (prefix || dir.name) + '):', e);
        }
    }
    await walk(folderHandle, '', 0);
    console.log('[make] collectMusicLibraryFiles: ' + list.length + ' ファイル検出 (' + folderHandle.name + ')');
    list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'audio' ? -1 : 1;
        return (a.relPath || a.name).localeCompare(b.relPath || b.name, 'ja');
    });
    return list;
}

// v2.14: 音楽ライブラリの provider 別ファイル列挙
//   Local: 既存 collectMusicLibraryFiles を呼ぶ
//   Drive: META.Drive.collectMusicLibrary を呼ぶ (同形式の戻り値)
async function getMusicLibraryFiles() {
    if (mkState.musicLibraryProvider === 'drive') {
        if (!mkState.musicLibraryDrivePath) throw new Error('Drive 音楽ライブラリパス未設定');
        // 必要なら Drive 再接続 (起動時自動 OAuth を避けるため遅延)
        await META.Drive.connect();
        return await META.Drive.collectMusicLibrary(
            mkState.musicLibraryDrivePath, 1, isAudioFile, isLrcFile
        );
    }
    if (!mkState.musicLibraryHandle) throw new Error('音楽ライブラリ未設定');
    return await collectMusicLibraryFiles(mkState.musicLibraryHandle);
}

// v2.14: 音楽ライブラリの「接続済み」 判定 (権限要求含む)
async function ensureMusicLibraryReady() {
    if (mkState.musicLibraryProvider === 'drive') {
        if (!mkState.musicLibraryDrivePath) return false;
        try { await META.Drive.connect(); return true; }
        catch (e) { console.warn('[make] Drive 再接続失敗:', e); return false; }
    }
    if (mkState.musicLibraryHandle) {
        return await META.ensureHandlePermission(mkState.musicLibraryHandle, 'read');
    }
    return false;
}

// v2.14: 音楽ライブラリの表示名 (UI 表示用)
function musicLibraryDisplayName() {
    if (mkState.musicLibraryProvider === 'drive') return mkState.musicLibraryDrivePath || '(Drive)';
    if (mkState.musicLibraryHandle) return mkState.musicLibraryHandle.name;
    return '(未設定)';
}

// v2.03 + v2.14: 音楽ライブラリから直接ファイル一覧 → ユーザー選択 → 同フォルダ同名 .lrc 自動セット
// 仕様書 §4.3 通り。 ライブラリ未設定なら設定を促す。 サブフォルダ深さ 1 まで再帰探索。
// v2.14: Local/Drive 共通インターフェース化 (picked.getFile() / picked.parentKey)
async function onPickMp3() {
    // Drive 設定済み or PC で showDirectoryPicker 利用可なら ライブラリ経由
    const canUseLibrary =
        (mkState.musicLibraryProvider === 'drive') ||
        (typeof window.showDirectoryPicker === 'function');
    if (canUseLibrary) {
        // 音楽ライブラリが未設定 or 保留中 → 設定/再認証
        if (!mkState.musicLibraryProvider) {
            if (mkState._pendingLibraryHandle) {
                const ok = await META.ensureHandlePermission(mkState._pendingLibraryHandle, 'read');
                if (ok) {
                    mkState.musicLibraryHandle = mkState._pendingLibraryHandle;
                    mkState.musicLibraryProvider = 'local';
                    mkState._pendingLibraryHandle = null;
                    updateLibraryStatus();
                }
            }
            if (!mkState.musicLibraryProvider) {
                const ok = confirm('音楽ライブラリが未設定です。 mp3 が入っているフォルダを設定しますか?');
                if (!ok) return;
                await onConnectLibrary();
                if (!mkState.musicLibraryProvider) return;
            }
        }
        // 接続/権限確認
        const ready = await ensureMusicLibraryReady();
        if (!ready) { alert('音楽ライブラリにアクセスできません (権限/接続を確認)'); return; }
        try {
            const allFiles = await getMusicLibraryFiles();
            const audioFiles = allFiles.filter(f => f.kind === 'audio');
            if (audioFiles.length === 0) {
                const change = confirm('音楽ライブラリ「' + musicLibraryDisplayName() + '」 に音楽ファイルが見つかりません。\n別のフォルダに変更しますか?');
                if (change) await onConnectLibrary();
                return;
            }
            const picked = await showFilePickerModal(audioFiles, '音楽ファイルを選択', musicLibraryDisplayName());
            if (!picked) return;
            mkState.pendingMp3File = await picked.getFile();
            if (mp3NameEl) mp3NameEl.value = picked.name;
            // 仕様書 §4.3 step 3: 同フォルダ (= parentKey 同一) の同名 .lrc を自動セット
            const base = baseName(picked.name);
            const lrcMatch = allFiles.find(f =>
                f.kind === 'lrc' &&
                baseName(f.name) === base &&
                f.parentKey === picked.parentKey
            );
            if (lrcMatch && !mkState.pendingLrcFile) {
                mkState.pendingLrcFile = await lrcMatch.getFile();
                if (lrcNameEl) lrcNameEl.value = lrcMatch.name;
                console.log('[make] 同名 .lrc 自動セット:', lrcMatch.name);
            }
            await autofillFromFiles();
        } catch (e) {
            console.error('[make] ファイル選択失敗:', e);
            alert('ファイル選択失敗: ' + (e.message || e));
        }
        return;
    }
    // iOS Safari fallback (Drive 未設定 + showDirectoryPicker 非対応)
    pickFiles('audio/*,.lrc', true, async (files) => {
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

// v2.03 + v2.14: 歌詞ファイル選択 (音楽ライブラリ経由、 Local/Drive 共通)
async function onPickLrc() {
    const canUseLibrary =
        (mkState.musicLibraryProvider === 'drive') ||
        (typeof window.showDirectoryPicker === 'function');
    if (canUseLibrary) {
        if (!mkState.musicLibraryProvider) {
            if (mkState._pendingLibraryHandle) {
                const ok = await META.ensureHandlePermission(mkState._pendingLibraryHandle, 'read');
                if (ok) {
                    mkState.musicLibraryHandle = mkState._pendingLibraryHandle;
                    mkState.musicLibraryProvider = 'local';
                    mkState._pendingLibraryHandle = null;
                    updateLibraryStatus();
                }
            }
            if (!mkState.musicLibraryProvider) {
                const ok = confirm('音楽ライブラリが未設定です。 .lrc が入っているフォルダを設定しますか?');
                if (!ok) return;
                await onConnectLibrary();
                if (!mkState.musicLibraryProvider) return;
            }
        }
        const ready = await ensureMusicLibraryReady();
        if (!ready) { alert('音楽ライブラリにアクセスできません (権限/接続を確認)'); return; }
        try {
            const allFiles = await getMusicLibraryFiles();
            const lrcFiles = allFiles.filter(f => f.kind === 'lrc');
            if (lrcFiles.length === 0) {
                const change = confirm('音楽ライブラリ「' + musicLibraryDisplayName() + '」 に .lrc が見つかりません。\n別のフォルダに変更しますか?');
                if (change) await onConnectLibrary();
                return;
            }
            const picked = await showFilePickerModal(lrcFiles, '歌詞ファイルを選択', musicLibraryDisplayName());
            if (!picked) return;
            mkState.pendingLrcFile = await picked.getFile();
            if (lrcNameEl) lrcNameEl.value = picked.name;
            // 仕様書 §4.4 step 3
            if (!mkState.pendingMp3File) {
                const base = baseName(picked.name);
                const audioMatch = allFiles.find(f =>
                    f.kind === 'audio' &&
                    baseName(f.name) === base &&
                    f.parentKey === picked.parentKey
                );
                if (audioMatch) {
                    mkState.pendingMp3File = await audioMatch.getFile();
                    if (mp3NameEl) mp3NameEl.value = audioMatch.name;
                    console.log('[make] 同名音楽ファイル自動セット:', audioMatch.name);
                }
            }
            await autofillFromFiles();
        } catch (e) {
            console.error('[make] ファイル選択失敗:', e);
            alert('ファイル選択失敗: ' + (e.message || e));
        }
        return;
    }
    // iOS Safari fallback (Drive 未設定 + showDirectoryPicker 非対応)
    pickFiles('.lrc,text/plain', false, async (files) => {
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

// ─────────── v2.09: カラオケフォルダ provider 抽象 (Local/Drive 切替) ───────────
function _isKaraokeConnected() {
    if (mkState.karaokeFolderProvider === 'drive') return true;  // Drive は cwd で管理
    if (mkState.karaokeFolderProvider === 'local' && mkState.karaokeFolderHandle) return true;
    return false;
}
async function _ksListSongs() {
    if (mkState.karaokeFolderProvider === 'drive') return await META.Drive.listSongs();
    return await META.Local.listSongs(mkState.karaokeFolderHandle);
}
// returns { internalId, folderRef }
//   Local: folderRef = FileSystemDirectoryHandle
//   Drive: folderRef = internalId 文字列 (内部で path として使う)
async function _ksCreateSongFolder(baseId) {
    if (mkState.karaokeFolderProvider === 'drive') {
        const { internalId } = await META.Drive.createSongFolder(baseId);
        return { internalId, folderRef: internalId };
    }
    const { internalId, handle } = await META.Local.createSongFolder(mkState.karaokeFolderHandle, baseId);
    return { internalId, folderRef: handle };
}
async function _ksWriteFile(folderRef, name, blob) {
    if (mkState.karaokeFolderProvider === 'drive') return await META.Drive.writeFile(folderRef, name, blob);
    return await META.Local.writeFile(folderRef, name, blob);
}
async function _ksSaveSongMeta(folderRef, meta) {
    if (mkState.karaokeFolderProvider === 'drive') return await META.Drive.saveSongMeta(folderRef, meta);
    return await META.Local.saveSongMeta(folderRef, meta);
}
async function _ksDeleteFile(folderRef, name) {
    if (mkState.karaokeFolderProvider === 'drive') return await META.Drive.deleteFile(folderRef, name);
    return await META.Local.deleteFile(folderRef, name);
}
async function _ksListFiles(folderRef) {
    if (mkState.karaokeFolderProvider === 'drive') return await META.Drive.listFiles(folderRef);
    return await META.Local.listFiles(folderRef);
}

// ─────────── v2.04: voicecut 自動生成 (仕様書 §4.7) ───────────
// 戻り値:
//   { available:true,  wavBlob, sampleRate, effectiveDb }  通常
//   { available:false, reason:'mono' | 'pseudo-mono', diffDb? }  段階 A 該当
// 既存 v1.39 の generateVocalCutPcm + stereoPcmToWavBlob と同じロジックを再実装
// (既存コード触らず、 make.js 内で完結させるため)
async function generateVoicecutWav(arrayBuffer, intensity) {
    const ACtor = window.AudioContext || window.webkitAudioContext;
    if (!ACtor) throw new Error('AudioContext 非対応');
    const tmpCtx = new ACtor();
    let decoded;
    try {
        decoded = await new Promise((res, rej) => {
            try {
                const p = tmpCtx.decodeAudioData(arrayBuffer.slice(0), res, rej);
                if (p && typeof p.then === 'function') p.then(res, rej);
            } catch (e) { rej(e); }
        });
    } finally {
        try { tmpCtx.close(); } catch (e) {}
    }

    const sr = decoded.sampleRate;
    const numCh = decoded.numberOfChannels;
    const len = decoded.length;
    const L = decoded.getChannelData(0);
    const R = numCh >= 2 ? decoded.getChannelData(1) : decoded.getChannelData(0);

    // 段階 A: モノラル
    if (numCh === 1) {
        return { available: false, reason: 'mono' };
    }
    // 段階 A: 疑似モノラル判定 (L/R 差分 RMS が -60dB 以下)
    let sumDiffSq = 0, sumSq = 0;
    for (let i = 0; i < len; i++) {
        const d = L[i] - R[i];
        sumDiffSq += d * d;
        sumSq += (L[i] * L[i] + R[i] * R[i]) * 0.5;
    }
    const diffRms = Math.sqrt(sumDiffSq / len);
    const overallRms = Math.sqrt(sumSq / len);
    const diffDb = 20 * Math.log10((diffRms + 1e-12) / (overallRms + 1e-12));
    if (diffDb < -60) {
        return { available: false, reason: 'pseudo-mono', diffDb };
    }

    // ボイスカット PCM 生成 (Mid/Side ベース)
    // v2.06: intensity → 2*i - i^2 (= 1 - (1-i)^2) の 2 次関数カーブで 50% を強化
    //   intensity=0 → eff=0 (元音源)
    //   intensity=0.5 → eff=0.750 (ボーカル -12dB、 v2.05 sqrt=0.707 より強い)
    //   intensity=1 → eff=1 (完全カット、 動作変わらず)
    const i = Math.max(0, Math.min(1, intensity));
    const eff = 2 * i - i * i;
    const inv = 1.0 - eff;
    console.log('[make] voicecut gen: intensity=' + i.toFixed(2) + ' → eff=' + eff.toFixed(3) + ' (v2.06 curve)');
    const outL = new Float32Array(len);
    const outR = new Float32Array(len);
    let outSumSq = 0, inSumSq = 0;
    for (let i = 0; i < len; i++) {
        const sL = L[i];
        const sR = R[i];
        const side = (sL - sR) * 0.5;
        outL[i] = sL * inv + side * eff * 2.0;
        outR[i] = sR * inv - side * eff * 2.0;
        outSumSq += (outL[i] * outL[i] + outR[i] * outR[i]) * 0.5;
        inSumSq += (sL * sL + sR * sR) * 0.5;
    }
    const outRms = Math.sqrt(outSumSq / len);
    const inRms = Math.sqrt(inSumSq / len);
    // 段階 B 用: 元音源との RMS 差 (dB)
    const effectiveDb = 20 * Math.log10((inRms + 1e-12) / (outRms + 1e-12));

    // WAV エンコード (16bit ステレオ PCM)
    const wavBlob = _encodeStereoToWav(outL, outR, sr);
    return { available: true, wavBlob, sampleRate: sr, effectiveDb };
}

function _encodeStereoToWav(left, right, sampleRate) {
    const len = left.length;
    const buf = new ArrayBuffer(44 + len * 4);
    const view = new DataView(buf);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + len * 4, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, len * 4, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
        const sL = Math.max(-1, Math.min(1, left[i]));
        const sR = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(off,   sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true); off += 2;
        view.setInt16(off, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true); off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
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
    if (!_isKaraokeConnected()) {
        alert('先にカラオケフォルダを接続してください');
        return;
    }

    btnRegister.disabled = true;
    const oldLabel = btnRegister.textContent;
    btnRegister.textContent = '処理中…';
    setStatus('ハッシュ計算中…', 'var(--orange-light)');

    try {
        // 1. mp3 ハッシュ計算 + ArrayBuffer を voicecut 用にも使い回す
        let mp3Hash = null;
        let mp3Buffer = null;  // voicecut 生成用 (Phase 5 で使うため取り回し)
        if (mkState.pendingMp3File) {
            mp3Buffer = await mkState.pendingMp3File.arrayBuffer();
            mp3Hash = await META.sha256Prefixed(mp3Buffer);
        }

        // 2. 重複判定 — 既存曲の列挙 (v2.09: provider 別)
        setStatus('既存曲を確認中…', 'var(--orange-light)');
        const existing = await _ksListSongs();
        const candidateMeta = META.defaultSongMeta(title, artist);
        candidateMeta.mp3Hash = mp3Hash;

        // v2.16: 重複判定の動作を可視化 (Drive 上で重複検出されない問題のデバッグ用)
        console.log('[make] 既存曲列挙: ' + existing.length + ' 件');
        for (const s of existing) {
            const hashShort = s.meta.mp3Hash ? s.meta.mp3Hash.slice(0, 22) + '…' : '(none)';
            console.log('  • ' + s.internalId + ' "' + (s.meta.title || '') + '" - "' + (s.meta.artist || '') + '" hash=' + hashShort);
        }
        const candHashShort = mp3Hash ? mp3Hash.slice(0, 22) + '…' : '(none)';
        console.log('[make] 候補: "' + title + '" - "' + artist + '" hash=' + candHashShort);

        const alphaHit = existing.find(s => META.isDuplicateAlpha(s.meta, candidateMeta));
        const betaHit = mp3Hash ? existing.find(s => META.isDuplicateBeta(s.meta, candidateMeta)) : null;
        console.log('[make] 判定結果: alphaHit=' + (alphaHit ? alphaHit.internalId : 'なし') + ', betaHit=' + (betaHit ? betaHit.internalId : 'なし'));

        // 仕様 §4.6 重複判定マトリクス
        if (alphaHit && betaHit && alphaHit.internalId === betaHit.internalId) {
            // α・β 両方一致: 既登録
            setStatus('既に登録済みです', 'var(--text-muted)');  // v2.19: 「既存曲を確認中…」 残り解消
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
                // v2.07: 上書き処理 本実装
                const keepOrDelete = await showOverwriteConfirm(alphaHit);
                if (keepOrDelete === 'cancel') {
                    setStatus('キャンセルしました', 'var(--text-muted)');
                    return;
                }
                // 上書きフローへ (新規フォルダ作成しない、 既存フォルダ再利用)
                await performOverwrite(alphaHit, candidateMeta, mp3Buffer, mp3Hash, keepOrDelete);
                return;  // 通常フローをスキップ
            }
            // 'version' → 別バージョンとして登録 (通常フロー続行)
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
        // v2.09: provider 別 (Local: handle / Drive: internalId 文字列)
        const { internalId, folderRef: songFolder } = await _ksCreateSongFolder(baseId);

        // 4. ファイル複製
        setStatus('ファイル複製中…', 'var(--orange-light)');
        if (mkState.pendingMp3File) {
            const safeName = META.sanitizeFileName(mkState.pendingMp3File.name);
            await _ksWriteFile(songFolder, safeName, mkState.pendingMp3File);
        }
        if (mkState.pendingLrcFile) {
            const safeName = META.sanitizeFileName(mkState.pendingLrcFile.name);
            await _ksWriteFile(songFolder, safeName, mkState.pendingLrcFile);
        }

        // 5. voicecut 自動生成 (v2.04、 仕様書 §4.7 段階 A/B/C)
        candidateMeta.voicecutAvailable = false;
        candidateMeta.voicecutEffective = null;
        let voicecutSummary = '';

        if (mp3Buffer) {
            setStatus('ボイスカット生成中… (100%)', 'var(--orange-light)');
            try {
                const r100 = await generateVoicecutWav(mp3Buffer, 1.0);

                if (!r100.available) {
                    // 段階 A: モノラル / 疑似モノラル
                    const reasonText = r100.reason === 'mono'
                        ? 'モノラル音源です'
                        : '左右チャンネル差が小さい (疑似モノラル、 ' + (r100.diffDb || 0).toFixed(1) + 'dB)';
                    const ok = confirm(
                        'この曲はボイスカットできません:\n  ' + reasonText + '\n\n' +
                        'ボイスカットなしで取り込みますか?'
                    );
                    if (!ok) {
                        setStatus('キャンセルしました', 'var(--text-muted)');
                        return;
                    }
                    // voicecutAvailable=false で続行 (仕様書 §4.7 段階 A)
                    candidateMeta.voicecutAvailable = false;
                    voicecutSummary = 'ボイスカット: 未生成 (' + reasonText + ')';
                } else {
                    // 50% 版生成
                    setStatus('ボイスカット生成中… (50%)', 'var(--orange-light)');
                    const r50 = await generateVoicecutWav(mp3Buffer, 0.5);

                    // 保存
                    setStatus('voicecut wav 保存中…', 'var(--orange-light)');
                    await _ksWriteFile(songFolder, 'voicecut100.wav', r100.wavBlob);
                    if (r50.available) {
                        await _ksWriteFile(songFolder, 'voicecut50.wav', r50.wavBlob);
                    }
                    candidateMeta.voicecutAvailable = true;

                    // 段階 B: 効果チェック (RMS 差 3dB 未満 → weak)
                    if (Math.abs(r100.effectiveDb) < 3) {
                        candidateMeta.voicecutEffective = 'weak';
                        voicecutSummary = 'ボイスカット: 効果が弱い (' + r100.effectiveDb.toFixed(1) + 'dB)';
                    } else {
                        candidateMeta.voicecutEffective = 'good';
                        voicecutSummary = 'ボイスカット: 良好 (差分 ' + r100.effectiveDb.toFixed(1) + 'dB)';
                    }
                }
            } catch (e) {
                // 段階 C: decode 不能、 メモリ不足等
                console.error('[make] voicecut 生成失敗:', e);
                const retry = confirm(
                    'ボイスカット生成に失敗しました:\n  ' + (e.message || '不明エラー') + '\n\n' +
                    'voicecut なしで取り込みますか?\n(キャンセルで全体を中止)'
                );
                if (!retry) {
                    setStatus('❌ voicecut 失敗で中止', '#f87171');
                    return;
                }
                candidateMeta.voicecutAvailable = false;
                voicecutSummary = 'ボイスカット生成失敗: ' + (e.message || '不明エラー');
            }
        }

        // 6. meta.json 保存
        setStatus('meta.json 保存中…', 'var(--orange-light)');
        await _ksSaveSongMeta(songFolder, candidateMeta);

        setStatus('✅ 登録完了: ' + internalId, 'var(--orange-light)');
        alert(
            '登録完了!\n' +
            '曲: ' + title + ' - ' + artist + '\n' +
            'フォルダ: ' + internalId + '\n' +
            (voicecutSummary || '')
        );

        // weak の場合は別途情報表示
        if (candidateMeta.voicecutEffective === 'weak') {
            alert('ボイスカット効果が弱い可能性があります (取り込みは完了しました)');
        }
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

// ─────────── v2.07: 上書きフロー (既存フォルダ再利用) ───────────
// keepOrDelete: 'keep' (テイク/MIX 保持) | 'delete' (テイク/MIX も削除)
async function performOverwrite(existing, candidateMeta, mp3Buffer, mp3Hash, keepOrDelete) {
    // v2.09: provider 別 folderRef (Local: handle / Drive: internalId 文字列)
    const internalId = existing.internalId;
    const folderRef = (mkState.karaokeFolderProvider === 'drive') ? internalId : existing.handle;
    const oldMeta = existing.meta;
    const title = candidateMeta.title;
    const artist = candidateMeta.artist;

    btnRegister.disabled = true;
    const oldLabel = btnRegister.textContent;
    btnRegister.textContent = '上書き中…';
    setStatus('既存ファイル削除中…', 'var(--orange-light)');

    try {
        // 1. 既存ファイルの削除 (mp3/lrc/voicecut*.wav は常に、 take/mix は keepOrDelete に応じて)
        const oldFiles = await _ksListFiles(folderRef);
        for (const name of oldFiles) {
            const isTakeOrMix = /^take\d+\.wav$/i.test(name) || /^mix\d+\.wav$/i.test(name);
            const isAudio = /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name);
            const isLrc = /\.lrc$/i.test(name);
            const isVoicecut = /^voicecut\d+\.wav$/i.test(name);
            const isMeta = name === 'meta.json';

            let shouldDelete = false;
            if (isMeta) shouldDelete = false;
            else if (isTakeOrMix) shouldDelete = (keepOrDelete === 'delete');
            else if (isVoicecut || isLrc) shouldDelete = true;
            else if (isAudio && !isTakeOrMix) shouldDelete = true;
            else shouldDelete = false;

            if (shouldDelete) {
                try { await _ksDeleteFile(folderRef, name); console.log('[make] 削除:', name); }
                catch (e) { console.warn('[make] 削除失敗:', name, e); }
            }
        }

        // 2. 新規 mp3/lrc 書き込み
        setStatus('ファイル複製中…', 'var(--orange-light)');
        if (mkState.pendingMp3File) {
            const safeName = META.sanitizeFileName(mkState.pendingMp3File.name);
            await _ksWriteFile(folderRef, safeName, mkState.pendingMp3File);
        }
        if (mkState.pendingLrcFile) {
            const safeName = META.sanitizeFileName(mkState.pendingLrcFile.name);
            await _ksWriteFile(folderRef, safeName, mkState.pendingLrcFile);
        }

        // 3. voicecut 生成 + 保存 + 段階 A/B/C 判定 (共通関数)
        const vc = await _runVoicecutFlow(folderRef, candidateMeta, mp3Buffer);
        if (vc === 'cancel') {
            setStatus('キャンセルしました', 'var(--text-muted)');
            alert('上書き処理が中断されました。\n既存ファイルは削除済みです — 必要なら再度登録してください。');
            return;
        }

        // 4. meta.json 更新 (既存メタを継承、 一部上書き)
        setStatus('meta.json 保存中…', 'var(--orange-light)');
        const updatedMeta = Object.assign({}, oldMeta, {
            title,
            artist,
            mp3Hash,
            voicecutAvailable: candidateMeta.voicecutAvailable,
            voicecutEffective: candidateMeta.voicecutEffective,
            modifiedAt: new Date().toISOString(),
            takes: (keepOrDelete === 'keep') ? (oldMeta.takes || []) : [],
            mixes: (keepOrDelete === 'keep') ? (oldMeta.mixes || []) : [],
        });
        await _ksSaveSongMeta(folderRef, updatedMeta);

        setStatus('✅ 上書き完了: ' + internalId, 'var(--orange-light)');
        const takeMixSummary = (keepOrDelete === 'keep')
            ? 'テイク/MIX を保持しました (テイク ' + (oldMeta.takes || []).length + ' 個 / MIX ' + (oldMeta.mixes || []).length + ' 個)'
            : 'テイク/MIX も削除しました';
        alert(
            '上書き完了!\n' +
            '曲: ' + title + ' - ' + artist + '\n' +
            'フォルダ: ' + internalId + '\n' +
            takeMixSummary + '\n' +
            (vc.summary || '')
        );
        clearPanel();
    } catch (e) {
        console.error('[make] 上書き失敗:', e);
        setStatus('❌ 上書き失敗: ' + e.message, '#f87171');
        alert('上書き失敗: ' + e.message);
    } finally {
        btnRegister.disabled = false;
        btnRegister.textContent = oldLabel || '登録';
    }
}

// v2.07: voicecut 生成 + 保存 + 段階 A/B/C 判定 (登録・上書き共通)
// 戻り値: { summary: '...' } または 'cancel'
// candidateMeta の voicecutAvailable / voicecutEffective を書き換える
async function _runVoicecutFlow(folder, candidateMeta, mp3Buffer) {
    candidateMeta.voicecutAvailable = false;
    candidateMeta.voicecutEffective = null;
    let summary = '';

    if (!mp3Buffer) return { summary: '' };

    setStatus('ボイスカット生成中… (100%)', 'var(--orange-light)');
    try {
        const r100 = await generateVoicecutWav(mp3Buffer, 1.0);
        if (!r100.available) {
            const reasonText = r100.reason === 'mono'
                ? 'モノラル音源です'
                : '左右チャンネル差が小さい (疑似モノラル、 ' + (r100.diffDb || 0).toFixed(1) + 'dB)';
            const ok = confirm('この曲はボイスカットできません:\n  ' + reasonText + '\n\nボイスカットなしで取り込みますか?');
            if (!ok) return 'cancel';
            candidateMeta.voicecutAvailable = false;
            summary = 'ボイスカット: 未生成 (' + reasonText + ')';
        } else {
            setStatus('ボイスカット生成中… (50%)', 'var(--orange-light)');
            const r50 = await generateVoicecutWav(mp3Buffer, 0.5);
            setStatus('voicecut wav 保存中…', 'var(--orange-light)');
            await _ksWriteFile(folder, 'voicecut100.wav', r100.wavBlob);
            if (r50.available) {
                await _ksWriteFile(folder, 'voicecut50.wav', r50.wavBlob);
            }
            candidateMeta.voicecutAvailable = true;
            if (Math.abs(r100.effectiveDb) < 3) {
                candidateMeta.voicecutEffective = 'weak';
                summary = 'ボイスカット: 効果が弱い (' + r100.effectiveDb.toFixed(1) + 'dB)';
            } else {
                candidateMeta.voicecutEffective = 'good';
                summary = 'ボイスカット: 良好 (差分 ' + r100.effectiveDb.toFixed(1) + 'dB)';
            }
        }
    } catch (e) {
        console.error('[make] voicecut 生成失敗:', e);
        const retry = confirm('ボイスカット生成に失敗しました:\n  ' + (e.message || '不明エラー') + '\n\nvoicecut なしで取り込みますか?\n(キャンセルで全体を中止)');
        if (!retry) return 'cancel';
        candidateMeta.voicecutAvailable = false;
        summary = 'ボイスカット生成失敗: ' + (e.message || '不明エラー');
    }
    return { summary };
}

// v2.07: 上書き時のテイク/MIX 削除確認モーダル
//   既存テイク/MIX が無ければ 'delete' を即返却 (どちらでも結果同じ)
//   戻り値: 'keep' | 'delete' | 'cancel'
function showOverwriteConfirm(existing) {
    const takeCount = (existing.meta.takes || []).length;
    const mixCount = (existing.meta.mixes || []).length;
    if (takeCount === 0 && mixCount === 0) {
        return Promise.resolve('delete');  // 保持するものがないので「削除」 扱いで進める
    }
    return new Promise((resolve) => {
        const modal = $('make-overwrite-modal');
        const msgEl = $('make-overwrite-message');
        const btnKeep = $('make-overwrite-keep');
        const btnDelete = $('make-overwrite-delete');
        const btnCancel = $('make-overwrite-cancel');
        if (!modal || !btnKeep || !btnDelete || !btnCancel) {
            const r = confirm('テイク ' + takeCount + ' 個 + MIX ' + mixCount + ' 個があります。\nOK で保持して上書き、 キャンセルで中止');
            resolve(r ? 'keep' : 'cancel');
            return;
        }
        msgEl.textContent = '上書き対象の既存曲には テイク ' + takeCount + ' 個、 MIX ' + mixCount + ' 個が登録されています。 どうしますか?';
        modal.style.display = 'flex';
        const close = (result) => {
            modal.style.display = 'none';
            btnKeep.removeEventListener('click', onK);
            btnDelete.removeEventListener('click', onD);
            btnCancel.removeEventListener('click', onC);
            resolve(result);
        };
        const onK = () => close('keep');
        const onD = () => close('delete');
        const onC = () => close('cancel');
        btnKeep.addEventListener('click', onK);
        btnDelete.addEventListener('click', onD);
        btnCancel.addEventListener('click', onC);
    });
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
    libraryStatusEl = $('make-library-status');
    btnConnectLibrary = $('make-library-btn');

    if (btnPickMp3) btnPickMp3.addEventListener('click', onPickMp3);
    if (btnPickLrc) btnPickLrc.addEventListener('click', onPickLrc);
    if (btnRegister) btnRegister.addEventListener('click', onRegister);
    if (btnCancel) btnCancel.addEventListener('click', onCancel);
    if (btnConnectFolder) btnConnectFolder.addEventListener('click', onConnectFolder);
    if (btnConnectLibrary) btnConnectLibrary.addEventListener('click', onConnectLibrary);

    updateFolderStatus();
    updateLibraryStatus();

    // v2.03: 起動時の IndexedDB からハンドル自動復元
    tryRestoreHandles().catch(e => console.warn('[make] 自動復元エラー:', e));
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
