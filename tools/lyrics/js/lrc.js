/* MOMO Lyrics — lrc.js
 * 責務: LRCパース/シリアライズ/現在行検出、0秒情報行の差し込み、時間の表示整形。
 * 対応要件: 要件2(0秒情報追加)/要件4(プレイモード基盤)
 * v2.02:
 *   - 「全体オフセット」という概念を廃止。
 *     行の時刻(timeMs)がそのまま実際に鳴る時刻であり、画面表示・頭出し・保存の
 *     すべてが同じ1つの値を見る（換算をしない）。
 *     読み込んだ .lrc に offset タグがあっても無視して捨てる（保存時にも書かない）。
 *     全体をずらしたいときは「現在行 ±」の「この行以後全部反映」で行う。
 *   - formatTime(): 各行に常時表示する時間の整形 (mm:ss.xx)
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.lrc = MOMO.lrc || {};

    /**
     * LRC文字列を LrcDocument にパース
     * v2.02: offset タグは読み捨てる（このアプリは offset を扱わない）
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

        // v2.02: offset という概念を持たない。あっても捨てる。
        delete doc.metadata.offset;

        doc.lines.sort((a, b) => a.timeMs - b.timeMs);
        return doc;
    };

    /**
     * LrcDocument を LRC文字列にシリアライズ
     * v2.02: offset タグは書かない。行の時刻をそのまま書く。
     * @param {Object} doc
     */
    MOMO.lrc.serialize = function (doc) {
        const out = [];
        // v2.02: 'offset' を並びから除外（このアプリは offset を書き出さない）
        const metaKeys = ['ti', 'ar', 'al', 'by', 're', 've', 'au', 'length'];
        const meta = Object.assign({}, doc.metadata);

        for (const key of metaKeys) {
            if (meta[key] !== undefined) out.push('[' + key + ':' + meta[key] + ']');
        }

        const lines = doc.lines.slice().sort((a, b) => a.timeMs - b.timeMs);
        for (const line of lines) {
            if (!line.assigned) continue; // 未割当行はファイルに書かない
            let t = line.timeMs;
            if (t < 0) t = 0; // 負値は0に丸め
            out.push(MOMO.lrc.formatTag(t) + line.text);
        }

        return out.join('\n');
    };

    /**
     * ミリ秒 → LRC の時刻タグ [mm:ss.xx]
     */
    MOMO.lrc.formatTag = function (ms) {
        return '[' + MOMO.lrc.formatTime(ms) + ']';
    };

    /**
     * v2.02: ミリ秒 → 画面に常時表示する時間 mm:ss.xx
     *   assigned でない行のために null/undefined も受ける（その場合は --:--.--）
     */
    MOMO.lrc.formatTime = function (ms) {
        if (typeof ms !== 'number' || !isFinite(ms)) return '--:--.--';
        let t = ms < 0 ? 0 : ms;
        const mm = Math.floor(t / 60000);
        const ss = Math.floor((t % 60000) / 1000);
        const cs = Math.floor((t % 1000) / 10);
        return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    };

    /**
     * 再生位置から現在行インデックスを検出
     * v2.02: オフセット換算をしない（行の時刻＝実際に鳴る時刻）
     */
    MOMO.lrc.findCurrentLineIndex = function (lines, currentMs) {
        // 未割当行(unassigned)は対象外。並びは「assigned時刻昇順 → 未割当」の前提。
        let result = -1;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].assigned) break; // 以降は全て未割当(ソート済み前提)
            if (lines[i].timeMs <= currentMs) result = i;
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
     * LrcDocument の先頭に 0秒情報行(isInfoHeader=true, timeMs=0)を挿入する。
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

    /**
     * v2.02: このアプリ自身が 0秒のタイトル行を足したことが「確実にわかる」ときだけ、
     *        パース後の先頭行に isInfoHeader の印を付ける。
     *        （ファイルから読んだだけの .lrc には付けない＝判断できないので OFF のまま）
     * @param {Object} doc      parse() の結果
     * @param {boolean} added   実際に prependInfo で足したか
     */
    MOMO.lrc.markAddedInfoHeader = function (doc, added) {
        if (!added || !doc || !doc.lines || doc.lines.length === 0) return doc;
        const head = doc.lines[0];
        // 足した行は必ず 0秒。0秒でなければ別物なので印を付けない（確実な時だけ ON）
        if (head.timeMs === 0) head.isInfoHeader = true;
        return doc;
    };
})();
