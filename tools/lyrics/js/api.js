/* MOMO Lyrics — api.js
 * 責務: LRCLIB API を利用した歌詞取得（3段階検索ロジック）。
 * 対応: 既存 fetchLyrics をそのまま移行（仕様書「既存維持」対象）。
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.api = MOMO.api || {};

    /**
     * LRCLIBの3段階検索: (1)get厳密, (2)search artist+title, (3)search title
     * @returns {Promise<string|null>} syncedLyrics文字列 or null
     */
    MOMO.api.fetchLyrics = async function (title, artist) {
        const queries = [
            'https://lrclib.net/api/get?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist),
            'https://lrclib.net/api/search?q=' + encodeURIComponent((artist + ' ' + title).trim()),
            'https://lrclib.net/api/search?q=' + encodeURIComponent(title)
        ];

        // 厳密 get
        try {
            const res = await fetch(queries[0]);
            if (res.ok) {
                const data = await res.json();
                if (data.syncedLyrics) return data.syncedLyrics;
            }
        } catch (e) { /* noop */ }

        // search API フォールバック
        for (let i = 1; i < queries.length; i++) {
            try {
                const res = await fetch(queries[i]);
                if (res.ok) {
                    const data = await res.json();
                    const found = data.find(s => s.syncedLyrics);
                    if (found) return found.syncedLyrics;
                }
            } catch (e) { continue; }
        }
        return null;
    };
})();
