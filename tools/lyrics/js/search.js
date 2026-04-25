/* MOMO Lyrics — search.js
 * 責務: 単体検索（LRCLIB /api/search）結果の表示・プレビュー展開・保存。
 * 対応要件: 要件2(0秒情報追加)/要件3(プレビュー)/要件4(履歴追加)
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.search = MOMO.search || {};

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    async function onSearch() {
        const query = document.getElementById('query').value.trim();
        const resultsList = document.getElementById('resultsList');
        const d = MOMO.i18n.get();
        if (!query) return;

        const btn = document.getElementById('searchBtn');
        btn.disabled = true;
        resultsList.innerHTML = '<div class="entry wait">' + d.searching + '</div>';

        // v1.13: 部分一致強化。「曲名 / アーティスト」を区切り、track_name/artist_name で併用検索。
        let title = query, artist = '';
        const m = query.split(/\s*\/\s*/);
        if (m.length >= 2) {
            title = m[0].trim();
            artist = m.slice(1).join('/').trim();
        }

        try {
            const urls = [];
            if (title && artist) {
                urls.push('https://lrclib.net/api/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist));
            }
            urls.push('https://lrclib.net/api/search?q=' + encodeURIComponent(query));
            // 両APIを順に呼び、重複排除
            const seen = new Set();
            const merged = [];
            for (const url of urls) {
                try {
                    const r = await fetch(url);
                    if (!r.ok) continue;
                    const arr = await r.json();
                    for (const s of arr) {
                        if (!s || !s.id || seen.has(s.id)) continue;
                        seen.add(s.id);
                        merged.push(s);
                    }
                } catch (e) { /* noop */ }
            }
            const data = merged;
            const synced = data.filter(s => s.syncedLyrics);

            resultsList.innerHTML = '';
            if (synced.length === 0) {
                resultsList.innerHTML = '<div class="entry error">' + d.noResults + '</div>';
            } else {
                synced.forEach(song => {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.innerHTML =
                        '<div class="row">' +
                            '<div class="song-info">' +
                                '<span class="song-title">' + escapeHtml(song.trackName) + '</span>' +
                                '<span class="song-meta">' + escapeHtml(song.artistName) + ' | Album: ' + escapeHtml(song.albumName || 'Unknown') + '</span>' +
                            '</div>' +
                            '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                                '<button class="momo-btn btn-preview" style="padding:8px 16px; font-size:12px;">' + escapeHtml(d.previewOpenBtn || d.previewBtn) + '</button>' +
                                '<button class="momo-btn btn-save" style="padding:8px 16px; font-size:12px;">' + escapeHtml(d.saveBtn) + '</button>' +
                            '</div>' +
                        '</div>';

                    // 要件3: プレビューパネル（初期は非表示）
                    const previewPanel = document.createElement('pre');
                    previewPanel.className = 'preview-panel hidden';
                    previewPanel.textContent = song.syncedLyrics;
                    item.appendChild(previewPanel);

                    const previewBtn = item.querySelector('.btn-preview');
                    previewBtn.addEventListener('click', () => {
                        const opened = !previewPanel.classList.toggle('hidden');
                        // v1.11: 開閉状態に応じてラベルを切替(4言語対応)
                        const dd = MOMO.i18n.get();
                        previewBtn.textContent = opened
                            ? (dd.previewCloseBtn || dd.previewBtn)
                            : (dd.previewOpenBtn || dd.previewBtn);
                    });

                    item.querySelector('.btn-save').addEventListener('click', () => {
                        // 要件2: 0秒情報追加
                        let lyricsToSave = song.syncedLyrics;
                        if (MOMO.state.addInfoHeader) {
                            lyricsToSave = MOMO.lrc.prependInfo(lyricsToSave, song.trackName, song.artistName);
                        }
                        const blob = new Blob([lyricsToSave], { type: 'text/plain' });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = (song.artistName + ' - ' + song.trackName + '.lrc').replace(/[\\/:*?"<>|]/g, '_');
                        a.click();

                        // 要件4: 履歴に追加
                        try {
                            const doc = MOMO.lrc.parse(lyricsToSave);
                            if (MOMO.play && MOMO.play.addToHistory) {
                                MOMO.play.addToHistory({
                                    id: 'search_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                                    source: 'search',
                                    title: song.trackName,
                                    artist: song.artistName,
                                    rawLrc: lyricsToSave,
                                    doc: doc,
                                    fileHandle: null,
                                    createdAt: Date.now()
                                });
                            }
                        } catch (e) { /* noop */ }
                    });

                    resultsList.appendChild(item);
                });
            }
        } catch (e) {
            resultsList.innerHTML = '<div class="entry error">Error: ' + escapeHtml(e.message) + '</div>';
        } finally {
            btn.disabled = false;
        }
    }

    function init() {
        const btn = document.getElementById('searchBtn');
        if (btn) btn.addEventListener('click', onSearch);
        const q = document.getElementById('query');
        if (q) {
            q.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') btn.click();
            });
        }
    }

    MOMO.search.init = init;
})();
