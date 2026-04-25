/* MOMO Lyrics — lrc.js
 * 責務: LRCパース/シリアライズ/現在行検出、0秒情報行の差し込み。
 * 対応要件: 要件2(0秒情報追加)/要件4(プレイモード基盤)/要件5(オフセット焼込保存)
 * v1.11:
 *   - オフセット符号反転: UIの globalOffsetMs は「正=遅延/負=先行」
 *     内部では effectiveTime = timeMs - globalOffsetMs として表示
 *     焼き込み保存時は timeMs から globalOffsetMs を減算
 *   - 0秒情報行(isInfoHeader)はオフセット対象外で0秒固定
 *   - 焼き込み結果が負値なら0に丸め
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.lrc = MOMO.lrc || {};

    /**
     * LRC文字列を LrcDocument にパース
     * @param {string} lrcText
     * @returns {{metadata:Object,lines:Array<{timeMs:number,text:string,assigned:boolean}>}}
     */
    MOMO.lrc.parse = function (lrcText) {
        const doc = { metadata: {}, lines: [] };
        const metaRe = /^\[([a-zA-Z]+):([^\]]*)\]$/;
        const timeRe = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
        const rawLines = (lrcText || '').split(/\r?\n/);

        for (const raw of rawLines) {
            const trimmed = raw.trim();
            if (!trimmed) continue;

            // メタデータ行判定（時刻タグ以外の [key:value]）
            const metaMatch = trimmed.match(metaRe);
            if (metaMatch && !/^\d+$/.test(metaMatch[1])) {
                doc.metadata[metaMatch[1].toLowerCase()] = metaMatch[2];
                continue;
            }

            // 時刻タグ抽出（1行に複数タグ可）
            const matches = [...trimmed.matchAll(timeRe)];
            if (matches.length === 0) continue;

            const text = trimmed.replace(timeRe, '').trim();
            for (const m of matches) {
                const mm = parseInt(m[1], 10);
                const ss = parseInt(m[2], 10);
                const frac = m[3];
                const fracMs = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac, 10) * 10;
                doc.lines.push({ timeMs: mm * 60000 + ss * 1000 + fracMs, text, assigned: true });
            }
        }

        doc.lines.sort((a, b) => a.timeMs - b.timeMs);
        return doc;
    };

    /**
     * LrcDocument を LRC文字列にシリアライズ
     * @param {Object} doc
     * @param {{bakeOffsetMs?: number}} [opts]
     */
    MOMO.lrc.serialize = function (doc, opts) {
        opts = opts || {};
        const out = [];
        const metaKeys = ['ti', 'ar', 'al', 'by', 'offset', 're', 've', 'au', 'length'];
        const meta = Object.assign({}, doc.metadata);

        if (typeof opts.bakeOffsetMs === 'number' && opts.bakeOffsetMs !== 0) {
            delete meta.offset;
        }

        for (const key of metaKeys) {
            if (meta[key] !== undefined) out.push('[' + key + ':' + meta[key] + ']');
        }

        const lines = doc.lines.slice().sort((a, b) => a.timeMs - b.timeMs);
        for (const line of lines) {
            if (!line.assigned) continue; // 未割当行はファイルに書かない
            let t = line.timeMs;
            // v1.11: infoHeader(0秒の曲名行) は常に0秒保持
            // その他は bakeOffsetMs を減算（符号反転）
            if (!line.isInfoHeader && typeof opts.bakeOffsetMs === 'number') {
                t -= opts.bakeOffsetMs;
            }
            if (t < 0) t = 0; // 負値は0に丸め
            const mm = Math.floor(t / 60000);
            const ss = Math.floor((t % 60000) / 1000);
            const cs = Math.floor((t % 1000) / 10);
            const tag = '[' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + '.' + String(cs).padStart(2, '0') + ']';
            out.push(tag + line.text);
        }

        return out.join('\n');
    };

    /**
     * 再生位置から現在行インデックスを検出（全体オフセット込み）
     */
    MOMO.lrc.findCurrentLineIndex = function (lines, currentMs, globalOffsetMs) {
        // v1.11: 符号反転 — UI上の globalOffsetMs が負値なら歌詞を遅らせる
        // v1.12: 未割当行(unassigned)は対象外。並びは「assigned時刻昇順 → 未割当」の前提。
        let result = -1;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].assigned) break; // 以降は全て未割当(ソート済み前提)
            const effectiveTime = lines[i].timeMs - globalOffsetMs;
            if (effectiveTime <= currentMs) result = i;
            else break;
        }
        return result;
    };

    /**
     * LRC文字列の先頭に [00:00.00]title - artist を挿入する
     * 既存メタデータ行の後、最初の時刻タグ行の前に差し込む
     */
    MOMO.lrc.prependInfo = function (lrc, title, artist) {
        const infoLine = '[00:00.00]' + (title || '') + (artist ? ' - ' + artist : '');
        const lines = (lrc || '').split(/\r?\n/);
        let insertIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            if (/^\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(lines[i])) {
                insertIdx = i;
                break;
            }
            insertIdx = i + 1;
        }
        lines.splice(insertIdx, 0, infoLine);
        return lines.join('\n');
    };

    /**
     * v1.11: LrcDocument の先頭に 0秒情報行(isInfoHeader=true, timeMs=0)を挿入する。
     * 既に先頭が同等の infoHeader なら何もしない。
     */
    MOMO.lrc.ensureInfoHeader = function (doc, title, artist) {
        if (!doc || !Array.isArray(doc.lines)) return doc;
        const text = (title || '') + (artist ? ' - ' + artist : '');
        // 既存の先頭が infoHeader ならテキストだけ更新
        if (doc.lines.length > 0 && doc.lines[0].isInfoHeader) {
            doc.lines[0].text = text;
            doc.lines[0].timeMs = 0;
            doc.lines[0].assigned = true;
            return doc;
        }
        doc.lines.unshift({ timeMs: 0, text: text, assigned: true, isInfoHeader: true });
        return doc;
    };
})();
