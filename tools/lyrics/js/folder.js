/* MOMO Lyrics — folder.js
 * 責務: フォルダ一括処理（タグ読取→LRCLIB問合せ→書き込み）。
 * 対応要件: 要件1(既存LRCスキップ)/要件2(0秒情報追加)/要件4(履歴追加)/要件7(書き戻し)
 * v1.13:
 *   - 処理結果をリスト表示(個別検索と同形式)
 *   - 各結果にプレビューボタン(▼/▲切替)と無効化ボタン(確認後ファイルを空で上書き)
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.folder = MOMO.folder || {};

    function addLog(msg, type) {
        const log = document.getElementById('log');
        const entry = document.createElement('div');
        entry.className = 'entry ' + (type || '');
        entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    /**
     * 結果アイテム1件を描画して folderResults に追加。
     * v1.13: プレビュー(▼/▲) + 無効化 ボタン付き。
     */
    function renderResultItem(container, info) {
        const d = MOMO.i18n.get();
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML =
            '<div class="row">' +
                '<div class="song-info">' +
                    '<span class="song-title">' + escapeHtml(info.title) + '</span>' +
                    '<span class="song-meta">' + escapeHtml(info.artist) + ' | ' + escapeHtml(info.fileName) + '</span>' +
                '</div>' +
                '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                    '<button class="momo-btn btn-preview" style="padding:8px 16px; font-size:12px;">' + escapeHtml(d.previewOpenBtn || d.previewBtn) + '</button>' +
                    '<button class="momo-btn btn-disable" style="padding:8px 16px; font-size:12px;">' + escapeHtml(d.disableBtn || 'Disable') + '</button>' +
                '</div>' +
            '</div>';

        const previewPanel = document.createElement('pre');
        previewPanel.className = 'preview-panel hidden';
        previewPanel.textContent = info.lyrics;
        item.appendChild(previewPanel);

        const previewBtn = item.querySelector('.btn-preview');
        previewBtn.addEventListener('click', () => {
            const opened = !previewPanel.classList.toggle('hidden');
            const dd = MOMO.i18n.get();
            previewBtn.textContent = opened
                ? (dd.previewCloseBtn || dd.previewBtn)
                : (dd.previewOpenBtn || dd.previewBtn);
        });

        const disableBtn = item.querySelector('.btn-disable');
        disableBtn.addEventListener('click', async () => {
            const dd = MOMO.i18n.get();
            const msg = (dd.confirmDisable || 'Disable {name}?').replace('{name}', info.fileName);
            if (!window.confirm(msg)) return;
            try {
                if (info.fileHandle) {
                    // 権限確保
                    if (info.fileHandle.queryPermission) {
                        let perm = await info.fileHandle.queryPermission({ mode: 'readwrite' });
                        if (perm !== 'granted' && info.fileHandle.requestPermission) {
                            perm = await info.fileHandle.requestPermission({ mode: 'readwrite' });
                        }
                        if (perm !== 'granted') throw new Error('permission denied');
                    }
                    const writable = await info.fileHandle.createWritable();
                    await writable.write('');
                    await writable.close();
                }
                previewPanel.textContent = '';
                item.classList.add('disabled');
                disableBtn.disabled = true;
                const dd2 = MOMO.i18n.get();
                disableBtn.textContent = dd2.disabled || 'Disabled';
            } catch (e) {
                alert((dd.saveFailed || 'Save failed') + ': ' + e.message);
            }
        });

        container.appendChild(item);
    }

    function resetResults() {
        const results = document.getElementById('folderResults');
        if (!results) return;
        results.innerHTML = '';
        results.classList.add('hidden');
    }

    function showResults() {
        const results = document.getElementById('folderResults');
        if (results) results.classList.remove('hidden');
    }

    async function onStart() {
        if (!window.showDirectoryPicker) {
            alert('ChromeまたはEdgeを使用してください。');
            return;
        }
        const d = MOMO.i18n.get();
        const startBtn = document.getElementById('startBtn');
        const status = document.getElementById('status-msg');
        const results = document.getElementById('folderResults');
        try {
            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            startBtn.disabled = true;
            document.getElementById('log').innerHTML = '';
            resetResults();
            addLog(d.startMsg);

            // 対象音源ファイル収集
            const files = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.match(/\.(mp3|m4a|flac)$/i)) {
                    files.push(entry);
                }
            }

            // 要件1: 既存 .lrc を baseName で収集
            const existingLrcBaseNames = new Set();
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.lrc')) {
                    existingLrcBaseNames.add(entry.name.replace(/\.lrc$/i, ''));
                }
            }

            addLog(d.fileCount.replace('{n}', files.length));

            for (let i = 0; i < files.length; i++) {
                status.textContent = (i + 1) + ' / ' + files.length;

                const entry = files[i];
                const baseName = entry.name.replace(/\.[^/.]+$/, '');

                if (existingLrcBaseNames.has(baseName)) {
                    addLog('  → ' + d.skipExisting + baseName + '.lrc', 'wait');
                    continue;
                }

                const file = await entry.getFile();
                const tags = await new Promise(res => {
                    window.jsmediatags.read(file, {
                        onSuccess: t => res(t.tags),
                        onError: () => res({})
                    });
                });

                const t = tags.title || baseName;
                const a = tags.artist || '';
                addLog(d.anal + t + ' / ' + a);

                const lyrics = await MOMO.api.fetchLyrics(t, a);
                if (lyrics) {
                    let lyricsToWrite = lyrics;
                    if (MOMO.state.addInfoHeader) {
                        lyricsToWrite = MOMO.lrc.prependInfo(lyricsToWrite, t, a);
                    }

                    const lrcHandle = await dirHandle.getFileHandle(baseName + '.lrc', { create: true });
                    const writable = await lrcHandle.createWritable();
                    await writable.write(lyricsToWrite);
                    await writable.close();
                    addLog('  → ' + d.found + baseName + '.lrc', 'success');

                    // v1.13: 結果リストへ追加
                    showResults();
                    renderResultItem(results, {
                        title: t,
                        artist: a,
                        fileName: baseName + '.lrc',
                        lyrics: lyricsToWrite,
                        fileHandle: lrcHandle
                    });

                    // 要件4: セッション履歴 (v1.14: 音源ファイルも紐付け)
                    try {
                        const doc = MOMO.lrc.parse(lyricsToWrite);
                        if (MOMO.play && MOMO.play.addToHistory) {
                            MOMO.play.addToHistory({
                                id: 'folder_' + Date.now() + '_' + i,
                                source: 'folder',
                                title: t,
                                artist: a,
                                rawLrc: lyricsToWrite,
                                doc: doc,
                                fileHandle: lrcHandle,
                                audioFile: file,        // v1.14: 同曲の音源(File)
                                audioHandle: entry,     // v1.14: 同曲の音源ハンドル
                                createdAt: Date.now()
                            });
                        }
                    } catch (e) { /* noop */ }
                } else {
                    addLog('  → ' + d.fail, 'error');
                }

                if (i < files.length - 1) {
                    addLog(d.waiting, 'wait');
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            addLog(d.finishMsg);
            status.textContent = 'DONE';
        } catch (e) {
            if (e.name !== 'AbortError') addLog('Error: ' + e.message, 'error');
        } finally {
            startBtn.disabled = false;
        }
    }

    function init() {
        const btn = document.getElementById('startBtn');
        if (btn) btn.addEventListener('click', onStart);
    }

    MOMO.folder.init = init;
})();
