/* MOMO Lyrics — play.js
 * 責務: プレイモード本体。履歴管理、LRCロード、音源同期再生、オフセット調整、保存、差分表示。
 * 対応要件: 要件4(プレイ)/要件5(オフセット調整と保存)/要件7(書き戻し)
 * v1.11:
 *   - 歌詞ウィンドウ内だけでスクロール（scrollIntoView禁止、overflow時のみ手動スクロール）
 *   - オフセット符号反転(lrc.js参照、seek計算もマイナス)
 *   - 差分バナー表示（現在編集中と originalDoc の差分）
 *   - saveLyrics: confirm削除 + requestPermission + 保存後 audio 0復帰 + 同フォルダ保存試行
 *   - ±0.1s 前後行クランプ
 *   - openLrcFile: multiple:true で同時選択された音源を自動ロード
 *   - TAPした行のcurrentハイライトはresetCurrentIdxで再評価させる
 */

MOMO.play = (function () {
    'use strict';

    let lastCurrentIdx = -1;
    /**
     * v1.19: ユーザーが「選択している行」のインデックス (>=0 で有効)。
     *   行クリック・±操作で更新される。
     *   focusedIdx が有効な間は、findCurrentLineIndex の自動切替を抑制し、
     *   highlight/scroll をこの行に固定する。
     *   1行プレビュー終了でクリアされない（対象行のままユーザーの次の操作を待つ）。
     *   通常再生に戻すには、ユーザーが再生ボタンを押す or 別の行をクリックする。
     */
    let focusedIdx = -1;

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function deepCopyDoc(doc) {
        return {
            metadata: Object.assign({}, doc.metadata),
            lines: doc.lines.map(l => Object.assign({}, l))
        };
    }

    function renderHistoryList() {
        const list = document.getElementById('historyList');
        if (!list) return;
        const d = MOMO.i18n.get();
        const history = MOMO.state.history || [];
        if (history.length === 0) {
            list.innerHTML = '<div class="entry"><span id="history-empty-msg">' + escapeHtml(d.historyEmpty) + '</span></div>';
            return;
        }
        list.innerHTML = '';
        for (const entry of history) {
            const div = document.createElement('div');
            const selected = MOMO.state.currentEntry && MOMO.state.currentEntry.id === entry.id;
            div.className = 'history-item' + (selected ? ' selected' : '');
            div.innerHTML =
                '<div class="song-info">' +
                    '<span class="song-title">' + escapeHtml(entry.title) + '</span>' +
                    '<span class="song-meta">' + escapeHtml(entry.artist) + ' | ' + escapeHtml(entry.source) + '</span>' +
                '</div>';
            div.addEventListener('click', () => selectEntry(entry));
            list.appendChild(div);
        }
    }

    function hasUnsavedChanges() {
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) return false;
        const orig = MOMO.state.currentEntry.doc;
        const buf = MOMO.state.editBuffer;
        const origOffset = parseInt(orig.metadata.offset || '0', 10) || 0;
        if (origOffset !== MOMO.state.globalOffsetMs) return true;
        if (orig.lines.length !== buf.lines.length) return true;
        for (let i = 0; i < orig.lines.length; i++) {
            if (orig.lines[i].timeMs !== buf.lines[i].timeMs) return true;
            if (orig.lines[i].text !== buf.lines[i].text) return true;
            if (orig.lines[i].assigned !== buf.lines[i].assigned) return true;
        }
        return false;
    }

    function addToHistory(entry) {
        if (!MOMO.state.history) MOMO.state.history = [];
        const idx = MOMO.state.history.findIndex(e => e.id === entry.id);
        if (idx >= 0) MOMO.state.history[idx] = entry;
        else MOMO.state.history.unshift(entry);
        if (MOMO.state.history.length > 50) MOMO.state.history.pop();
        renderHistoryList();
    }

    function selectEntry(entry) {
        // 未保存変更の確認
        if (MOMO.state.editBuffer && hasUnsavedChanges()) {
            const d = MOMO.i18n.get();
            if (!window.confirm(d.discardChanges)) return;
        }
        MOMO.state.currentEntry = entry;
        MOMO.state.editBuffer = deepCopyDoc(entry.doc);
        // v1.13: 各行の originalTimeMs を記録（以後の TAP/±で変わらない原本値）
        MOMO.state.editBuffer.lines.forEach(l => { l.originalTimeMs = l.timeMs; });
        MOMO.state.globalOffsetMs = parseInt(entry.doc.metadata.offset || '0', 10) || 0;
        const offsetInput = document.getElementById('globalOffsetInput');
        if (offsetInput) offsetInput.value = MOMO.state.globalOffsetMs;

        document.getElementById('audio-controls').classList.remove('hidden');
        document.getElementById('lyrics-view').classList.remove('hidden');
        const rh = document.getElementById('lyrics-resize-handle');
        if (rh) rh.classList.remove('hidden');
        document.getElementById('adjust-controls').classList.remove('hidden');
        // タップUIは tap.js 側で制御（txt由来の場合のみ表示）
        if (entry.source !== 'txt') {
            document.getElementById('tap-controls').classList.add('hidden');
        }
        // v1.13: 曲名/アーティスト入力行は常に表示（ロードされているエントリがあるとき）
        const infoRow = document.getElementById('info-add-row');
        if (infoRow) infoRow.classList.remove('hidden');

        lastCurrentIdx = -1;
        const status = document.getElementById('save-status');
        if (status) status.textContent = '';

        // v1.14: 履歴ごとに紐付けられた音源があれば自動ロード
        if (entry.audioFile) {
            loadAudioFile(entry.audioFile, entry.audioHandle || null);
        }

        // v1.13: エントリ選択時も audio を 0 秒に戻す
        if (MOMO.state.audioEl) {
            try { MOMO.state.audioEl.currentTime = 0; } catch (e) {}
        }
        // 1行プレビューモードのタイマー類をリセット
        clearOneLinePreview();
        focusedIdx = -1; // v1.19: エントリ切替時はロック解除

        renderLyricsView();
        renderHistoryList();
        updateDiffBanner();
    }

    /**
     * v1.18: 各 lyrics-line に行ごとの差分・1行目はタイトル化チェックボックスを表示。
     */
    function renderLyricsView() {
        const view = document.getElementById('lyrics-view');
        if (!view) return;
        view.innerHTML = '';
        if (!MOMO.state.editBuffer) return;
        const origOffset = MOMO.state.currentEntry
            ? (parseInt(MOMO.state.currentEntry.doc.metadata.offset || '0', 10) || 0)
            : 0;
        const offsetDelta = MOMO.state.globalOffsetMs - origOffset;
        MOMO.state.editBuffer.lines.forEach((line, idx) => {
            const div = document.createElement('div');
            div.className = 'lyrics-line' + (line.assigned ? '' : ' unassigned');
            if (line.isInfoHeader) {
                div.classList.add('info-header');
                div.classList.add('title-fixed');
            }
            div.dataset.index = idx;

            // v1.18: 1行目だけにタイトル化チェックボックスを表示
            if (idx === 0) {
                const toggle = document.createElement('label');
                toggle.className = 'title-toggle';
                toggle.title = 'タイトル(0秒固定)';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !!line.isInfoHeader;
                cb.addEventListener('click', (ev) => ev.stopPropagation());
                cb.addEventListener('change', (ev) => {
                    ev.stopPropagation();
                    onTitleToggleChanged(ev.target.checked);
                });
                const icon = document.createElement('span');
                icon.className = 'title-icon';
                icon.textContent = '★';
                toggle.appendChild(cb);
                toggle.appendChild(icon);
                div.appendChild(toggle);
            }

            const textSpan = document.createElement('span');
            textSpan.className = 'lyrics-line-text';
            textSpan.textContent = line.text || '♪';
            div.appendChild(textSpan);

            // 行ごとの差分(タイトル行は除外)
            if (line.assigned && !line.isInfoHeader && typeof line.originalTimeMs === 'number') {
                const diff = (line.timeMs - line.originalTimeMs) + offsetDelta;
                if (diff !== 0) {
                    const diffSpan = document.createElement('span');
                    diffSpan.className = 'line-diff';
                    diffSpan.textContent = (diff > 0 ? '+' : '') + diff + 'ms';
                    div.appendChild(diffSpan);
                }
            }

            div.addEventListener('click', () => onLyricsLineClick(idx));
            view.appendChild(div);
        });
    }

    /**
     * v1.18: タイトルチェックボックス変更ハンドラ。
     *  ON  → 1行目を timeMs=0, isInfoHeader=true, assigned=true（タイトル固定）
     *         元値が timeMs!==0 でも 0 に変更（仕様通り）
     *  OFF → 1行目を isInfoHeader=false（通常行に戻す。timeMs は ON 時の0のまま、editBuffer内）
     *         ユーザーは行クリック+TAP/±で再調整可能
     */
    function onTitleToggleChanged(checked) {
        if (!MOMO.state.editBuffer || MOMO.state.editBuffer.lines.length === 0) return;
        const line = MOMO.state.editBuffer.lines[0];
        if (checked) {
            line.isInfoHeader = true;
            line.timeMs = 0;
            line.assigned = true;
            // originalTimeMs を 0 に揃える(差分表示で「+0ms」を出さないため)
            line.originalTimeMs = 0;
        } else {
            line.isInfoHeader = false;
            // timeMs/assigned はそのまま（ユーザーが必要なら ± で調整）
        }
        renderLyricsView();
        renderHistoryList();
        updateDiffBanner();
    }

    function seekToLine(idx) {
        const audio = MOMO.state.audioEl;
        if (!audio) return;
        const line = MOMO.state.editBuffer && MOMO.state.editBuffer.lines[idx];
        if (!line || !line.assigned) return;
        // v1.11: 符号反転
        const target = (line.timeMs - MOMO.state.globalOffsetMs) / 1000;
        audio.currentTime = Math.max(0, target);
    }

    /**
     * v1.13/v1.18/v1.19: 1行プレビュー状態管理。
     *   ポーズ中に行をクリックすると、その行先頭→次の assigned 行先頭 まで再生してポーズ。
     *   終了時は「対象行の先頭」へ戻す（次行に進まない）。
     *   v1.19: focusedIdx と連動してロック中はハイライトを固定。
     */
    let oneLineStopAt = -1;     // seconds (>=0 有効) — ここで pause する位置
    let oneLineStartAt = -1;    // seconds (>=0 有効) — 完了時に戻す位置（対象行の先頭）

    function clearOneLinePreview() {
        oneLineStopAt = -1;
        oneLineStartAt = -1;
    }

    /**
     * v1.19: 任意のインデックスの行を current ハイライトする。findCurrentLineIndex を経由しない。
     */
    function highlightIndex(idx) {
        const nodes = document.querySelectorAll('.lyrics-line');
        nodes.forEach((el, i) => el.classList.toggle('current', i === idx));
        lastCurrentIdx = idx;
        scrollCurrentLineIntoView();
    }

    /**
     * v1.19: 指定行の 1行プレビューを開始(ポーズ中なら再生開始、再生中なら停止点だけ仕込む)。
     */
    function startOneLinePreview(idx) {
        const audio = MOMO.state.audioEl;
        if (!audio) return;
        const lines = MOMO.state.editBuffer && MOMO.state.editBuffer.lines;
        if (!lines) return;
        const line = lines[idx];
        if (!line || !line.assigned || line.isInfoHeader) return;

        const startSec = Math.max(0, (line.timeMs - MOMO.state.globalOffsetMs) / 1000);
        // 次の assigned (非infoHeader) 行
        let nextMs = null;
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].assigned && !lines[i].isInfoHeader) {
                nextMs = lines[i].timeMs;
                break;
            }
        }
        oneLineStartAt = startSec;
        oneLineStopAt = nextMs !== null
            ? Math.max(0, (nextMs - MOMO.state.globalOffsetMs) / 1000)
            : -1; // 次行が無い場合はそのまま末尾まで再生

        audio.currentTime = startSec;
        if (audio.paused) {
            audio.play().catch(() => {});
        }
        focusedIdx = idx;
        highlightIndex(idx);
    }

    function onLyricsLineClick(idx) {
        const audio = MOMO.state.audioEl;
        if (!audio) return;
        const lines = MOMO.state.editBuffer && MOMO.state.editBuffer.lines;
        if (!lines) return;
        const line = lines[idx];
        if (!line || !line.assigned) return;
        if (line.isInfoHeader) return; // タイトル行は対象外

        // 行クリック時は必ず focus を更新
        focusedIdx = idx;

        // v1.20: 1行プレビュー中(oneLineStopAt>=0) または ポーズ中なら、
        //         クリック行で 1行プレビューを再開する(連続再生にしない)。
        //         ユーザーが明示的に再生ボタンを押した「通常再生」状態のときのみシークだけ行う。
        const inPreview = oneLineStopAt >= 0;
        if (audio.paused || inPreview) {
            startOneLinePreview(idx);
        } else {
            // 通常再生中のクリックはシーク扱い。focusedIdx は通常追従に戻す。
            const startSec = Math.max(0, (line.timeMs - MOMO.state.globalOffsetMs) / 1000);
            audio.currentTime = startSec;
            clearOneLinePreview();
            focusedIdx = -1;
        }
    }

    /**
     * v1.13: 歌詞ウィンドウ内スクロール。
     *  - overflow なし: 何もしない
     *  - current 行が既に完全に view 内にある: 何もしない(nearest)
     *  - 見えていない: 上から 1/3 位置に配置
     */
    function scrollCurrentLineIntoView() {
        const view = document.getElementById('lyrics-view');
        if (!view) return;
        const cur = view.querySelector('.lyrics-line.current');
        if (!cur) return;
        if (view.scrollHeight <= view.clientHeight) return;
        const viewRect = view.getBoundingClientRect();
        const curRect = cur.getBoundingClientRect();
        const curTopInView = curRect.top - viewRect.top + view.scrollTop;
        const curBottomInView = curTopInView + curRect.height;
        // すでに視界内なら据え置き
        if (curTopInView >= view.scrollTop && curBottomInView <= view.scrollTop + view.clientHeight) {
            return;
        }
        // 上から 1/3 位置に配置
        const target = curTopInView - (view.clientHeight * 0.33) + (curRect.height / 2);
        const maxScroll = view.scrollHeight - view.clientHeight;
        const clamped = Math.max(0, Math.min(target, maxScroll));
        view.scrollTo({ top: clamped, behavior: 'smooth' });
    }

    function updateCurrentLine() {
        const audio = MOMO.state.audioEl;
        if (!audio || !MOMO.state.editBuffer) return;

        // v1.18/v1.19: 1行プレビュー終了 → ポーズして対象行先頭へ戻す。focusedIdx は維持。
        if (oneLineStopAt >= 0 && audio.currentTime >= oneLineStopAt) {
            try { audio.pause(); } catch (e) {}
            if (oneLineStartAt >= 0) {
                audio.currentTime = oneLineStartAt;
            }
            clearOneLinePreview();
            // focusedIdx を保持(対象行のままユーザーの次操作を待つ)
            if (focusedIdx >= 0) highlightIndex(focusedIdx);
            return;
        }

        // v1.19: focusedIdx がロック中なら自動切替を抑制
        if (focusedIdx >= 0) {
            if (focusedIdx !== lastCurrentIdx) highlightIndex(focusedIdx);
            return;
        }

        const currentMs = audio.currentTime * 1000;
        const idx = MOMO.lrc.findCurrentLineIndex(
            MOMO.state.editBuffer.lines,
            currentMs,
            MOMO.state.globalOffsetMs
        );
        if (idx === lastCurrentIdx) return;
        lastCurrentIdx = idx;
        const nodes = document.querySelectorAll('.lyrics-line');
        nodes.forEach((el, i) => el.classList.toggle('current', i === idx));
        scrollCurrentLineIntoView();
    }

    /**
     * 現在行 ±100ms の調整。
     * v1.19:
     *   - 対象は focusedIdx（ユーザーが選択している行）。未設定なら lastCurrentIdx。
     *   - 前後 assigned 行の timeMs を越えないようにクランプ(infoHeader 除外)。
     *   - 並び替え後の新しい index で focusedIdx を更新（行ロック維持）。
     *   - 1行プレビュー再開: ポーズ中なら対象行先頭から次行先頭まで再生→対象行先頭で停止。
     *     再生中ならシーク+停止点更新で同じ範囲を再生継続。
     *   - ハイライト/スクロールは focusedIdx に固定。findCurrentLineIndex の自動切替は走らせない。
     */
    function adjustCurrentLine(deltaMs) {
        if (!MOMO.state.editBuffer) return;
        const lines = MOMO.state.editBuffer.lines;
        let idx = focusedIdx >= 0 ? focusedIdx : lastCurrentIdx;
        if (idx < 0 || idx >= lines.length) return;
        const line = lines[idx];
        if (!line || !line.assigned || line.isInfoHeader) return;

        // クランプ範囲 (assigned かつ infoHeader でない前後行)
        let prevBound = 0;
        for (let i = idx - 1; i >= 0; i--) {
            if (lines[i].assigned && !lines[i].isInfoHeader) { prevBound = lines[i].timeMs + 1; break; }
        }
        let nextBound = Number.POSITIVE_INFINITY;
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].assigned && !lines[i].isInfoHeader) { nextBound = lines[i].timeMs - 1; break; }
        }

        let candidate = line.timeMs + deltaMs;
        candidate = Math.max(prevBound, Math.min(nextBound, candidate));
        if (candidate < 0) candidate = 0;
        if (candidate === line.timeMs) return; // 境界で動けない

        line.timeMs = candidate;
        // ソート: infoHeader は先頭固定 / assigned は timeMs 昇順 / unassigned は末尾
        lines.sort((a, b) => {
            if (a.isInfoHeader && !b.isInfoHeader) return -1;
            if (!a.isInfoHeader && b.isInfoHeader) return 1;
            if (a.assigned && !b.assigned) return -1;
            if (!a.assigned && b.assigned) return 1;
            return a.timeMs - b.timeMs;
        });

        // ソート後の対象行 index
        const newIdx = lines.indexOf(line);
        focusedIdx = newIdx;

        renderLyricsView();
        // 1行プレビュー再開（ポーズ中も再生中も同じ）
        startOneLinePreview(newIdx);
        updateDiffBanner();
    }

    // v1.14: pickLyricsAndAudio は不要になったため削除（フォルダ方式に変更）

    async function chooseAudioFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'Audio', accept: { 'audio/*': ['.mp3', '.m4a', '.flac', '.wav', '.ogg'] } }]
            });
            const file = await handle.getFile();
            loadAudioFile(file, handle);
        } catch (e) {
            if (e.name !== 'AbortError') console.error(e);
        }
    }

    function loadAudioFile(file, handle) {
        if (!file) return;
        const url = URL.createObjectURL(file);
        MOMO.state.audioEl.src = url;
        MOMO.state.audioFileName = file.name;
        if (handle) MOMO.state.audioHandle = handle;
        const nameEl = document.getElementById('audio-file-name');
        if (nameEl) nameEl.textContent = file.name;
    }

    /**
     * v1.16: 選択ファイル群から .lrc/.txt と音源を分類し、baseName一致で音源を自動ペア。
     * @param {FileSystemFileHandle[]} handles  ユーザーが選んだファイル
     * @param {string[]} lyricsExt  ['.lrc'] または ['.txt']
     */
    function pickFromHandles(handles, lyricsExt) {
        const audioExts = ['.mp3', '.m4a', '.flac', '.wav', '.ogg'];
        const stripExt = (name, exts) => {
            const lower = name.toLowerCase();
            for (const e of exts) {
                if (lower.endsWith(e)) return name.slice(0, name.length - e.length);
            }
            return name;
        };
        let lyricsHandle = null, lyricsBase = null;
        const audioCandidates = [];
        for (const h of handles) {
            const lower = h.name.toLowerCase();
            if (!lyricsHandle && lyricsExt.some(e => lower.endsWith(e))) {
                lyricsHandle = h;
                lyricsBase = stripExt(h.name, lyricsExt).toLowerCase();
            } else if (audioExts.some(e => lower.endsWith(e))) {
                audioCandidates.push({ handle: h, base: stripExt(h.name, audioExts).toLowerCase() });
            }
        }
        // baseName 一致を優先して採用
        let audioHandle = null;
        if (lyricsBase) {
            const exact = audioCandidates.find(a => a.base === lyricsBase);
            audioHandle = exact ? exact.handle : (audioCandidates[0] ? audioCandidates[0].handle : null);
        } else {
            audioHandle = audioCandidates[0] ? audioCandidates[0].handle : null;
        }
        return { lyricsHandle, audioHandle };
    }

    /**
     * v1.16: 「.lrcファイルを開く」フロー。
     *  1. showOpenFilePicker(multiple:true) でファイル選択UIを表示
     *  2. ユーザーは .lrc を選択。Ctrl+クリックで同フォルダの音源も追加選択可能
     *  3. baseName 一致の音源を自動ペアリング
     */
    async function openLrcFile() {
        if (!window.showOpenFilePicker) {
            alert('Chrome/Edge を使用してください。');
            return;
        }
        let handles;
        try {
            handles = await window.showOpenFilePicker({
                multiple: true,
                types: [
                    { description: 'Lyrics', accept: { 'text/plain': ['.lrc'] } },
                    { description: 'Audio', accept: { 'audio/*': ['.mp3', '.m4a', '.flac', '.wav', '.ogg'] } }
                ]
            });
        } catch (e) {
            if (e.name !== 'AbortError') alert('ファイルを開けませんでした: ' + e.message);
            return;
        }
        try {
            const { lyricsHandle, audioHandle } = pickFromHandles(handles, ['.lrc']);
            if (!lyricsHandle) {
                alert('.lrc ファイルを選択してください。');
                return;
            }
            const file = await lyricsHandle.getFile();
            const text = await file.text();
            const doc = MOMO.lrc.parse(text);
            const baseName = file.name.replace(/\.lrc$/i, '');
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
                fileHandle: lyricsHandle,
                audioFile: audioFile,
                audioHandle: audioHandle,
                createdAt: Date.now()
            };
            addToHistory(entry);
            selectEntry(entry);
        } catch (e) {
            console.error(e);
            alert('読み込みエラー: ' + e.message);
        }
    }

    // 互換: 他モジュールから参照される可能性があるためエクスポート用
    function _pickFromHandles() { return pickFromHandles.apply(null, arguments); }

    /**
     * v1.14 互換用エクスポート(他モジュールから呼ばれる場合がある)
     */
    async function promptAudioIfMissing() {
        return { audioFile: null, audioHandle: null };
    }

    /**
     * v1.13: 曲名/アーティスト入力欄からの「追加」ボタン押下。
     *   editBuffer の先頭に isInfoHeader 行を追加（なければ新規、あれば差し替え）。
     *   currentEntry の title/artist もこの値に合わせて更新し、履歴表示にも反映。
     */
    function onAddInfoHeader() {
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) return;
        const titleInput = document.getElementById('info-title-input');
        const artistInput = document.getElementById('info-artist-input');
        const title = (titleInput && titleInput.value || '').trim();
        const artist = (artistInput && artistInput.value || '').trim();
        if (!title && !artist) return;

        MOMO.lrc.ensureInfoHeader(MOMO.state.editBuffer, title, artist);
        // 新規 infoHeader 行に originalTimeMs も付与（差分表示の対象外にするためisInfoHeader判定で十分）
        const head = MOMO.state.editBuffer.lines[0];
        if (head && head.isInfoHeader && typeof head.originalTimeMs !== 'number') {
            head.originalTimeMs = head.timeMs;
        }
        MOMO.state.currentEntry.title = title || MOMO.state.currentEntry.title;
        MOMO.state.currentEntry.artist = artist || MOMO.state.currentEntry.artist;
        renderLyricsView();
        renderHistoryList();
        updateDiffBanner();
    }

    /**
     * v1.11: 差分バナー更新（currentEntry.doc vs editBuffer）
     */
    function updateDiffBanner() {
        const banner = document.getElementById('diff-banner');
        if (!banner) return;
        const d = MOMO.i18n.get();
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) {
            banner.classList.add('hidden');
            return;
        }
        const orig = MOMO.state.currentEntry.doc;
        const buf = MOMO.state.editBuffer;
        const origOffset = parseInt(orig.metadata.offset || '0', 10) || 0;
        const offsetDiff = MOMO.state.globalOffsetMs - origOffset;

        // 変更行数を数える（同インデックス同士で比較、長さ違いも差分扱い）
        let changedLines = 0;
        const maxLen = Math.max(orig.lines.length, buf.lines.length);
        for (let i = 0; i < maxLen; i++) {
            const a = orig.lines[i];
            const b = buf.lines[i];
            if (!a || !b) { changedLines++; continue; }
            if (a.timeMs !== b.timeMs || a.text !== b.text || a.assigned !== b.assigned) changedLines++;
        }

        if (offsetDiff === 0 && changedLines === 0) {
            banner.classList.add('hidden');
            banner.textContent = '';
            return;
        }
        const parts = [d.diffTitle];
        if (offsetDiff !== 0) {
            parts.push(d.diffOffset.replace('{v}', (offsetDiff > 0 ? '+' : '') + offsetDiff));
        }
        if (changedLines > 0) {
            parts.push(d.diffLines.replace('{n}', changedLines));
        }
        banner.textContent = parts.join(' / ');
        banner.classList.remove('hidden');
    }

    /**
     * v1.11: 保存処理。
     * - confirm() を削除して User activation を維持する。
     * - fileHandle がある場合は queryPermission→requestPermission→createWritable の順で権限確保。
     * - fileHandle が null の場合は showSaveFilePicker で同フォルダ保存を試み、
     *   失敗したら最後の手段としてダウンロードにフォールバック。
     * - 保存後は audio.currentTime を 0 に戻し、差分バナーをクリア。
     */
    async function saveLyrics() {
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) return;
        const opts = {};
        if (!MOMO.state.saveAsOffsetTag) {
            opts.bakeOffsetMs = MOMO.state.globalOffsetMs;
            // 焼き込み保存時は offsetタグを削除
            delete MOMO.state.editBuffer.metadata.offset;
        } else {
            MOMO.state.editBuffer.metadata.offset = String(MOMO.state.globalOffsetMs);
        }
        const serialized = MOMO.lrc.serialize(MOMO.state.editBuffer, opts);

        const entry = MOMO.state.currentEntry;
        const d = MOMO.i18n.get();
        const status = document.getElementById('save-status');
        const fallbackDownload = () => {
            try {
                const blob = new Blob([serialized], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = (entry.artist + ' - ' + entry.title + '.lrc').replace(/[\\/:*?"<>|]/g, '_');
                a.click();
                return true;
            } catch (e) {
                if (status) status.textContent = d.saveFailed + ': ' + e.message;
                return false;
            }
        };

        let ok = false;
        try {
            let handle = entry.fileHandle;
            if (handle) {
                // 権限確認（User activationが必要なため、awaitの前に先行させる）
                if (handle.queryPermission) {
                    let perm = await handle.queryPermission({ mode: 'readwrite' });
                    if (perm !== 'granted' && handle.requestPermission) {
                        perm = await handle.requestPermission({ mode: 'readwrite' });
                    }
                    if (perm !== 'granted') throw new Error('permission denied');
                }
                const writable = await handle.createWritable();
                await writable.write(serialized);
                await writable.close();
                ok = true;
            } else if (window.showSaveFilePicker) {
                // 同フォルダに保存誘導（startInに関連ハンドルを渡す）
                const pickerOpts = {
                    suggestedName: ((entry.artist ? entry.artist + ' - ' : '') + entry.title + '.lrc').replace(/[\\/:*?"<>|]/g, '_'),
                    types: [{ description: 'LRC', accept: { 'text/plain': ['.lrc'] } }]
                };
                if (entry.txtHandle) pickerOpts.startIn = entry.txtHandle;
                else if (MOMO.state.audioHandle) pickerOpts.startIn = MOMO.state.audioHandle;
                try {
                    const newHandle = await window.showSaveFilePicker(pickerOpts);
                    const writable = await newHandle.createWritable();
                    await writable.write(serialized);
                    await writable.close();
                    entry.fileHandle = newHandle; // 以後は同一名上書き可能
                    ok = true;
                } catch (e) {
                    if (e.name === 'AbortError') return; // キャンセル
                    // showSaveFilePicker で失敗したらフォールバック
                    ok = fallbackDownload();
                }
            } else {
                ok = fallbackDownload();
            }
        } catch (e) {
            if (status) status.textContent = d.saveFailed + ': ' + e.message;
            return;
        }

        if (!ok) return;
        if (status) status.textContent = d.saved;

        // 保存後: originalDoc 更新、バッファ再構築、シークバー0復帰、差分クリア
        entry.doc = MOMO.lrc.parse(serialized);
        entry.rawLrc = serialized;
        MOMO.state.editBuffer = deepCopyDoc(entry.doc);
        MOMO.state.globalOffsetMs = parseInt(entry.doc.metadata.offset || '0', 10) || 0;
        const offsetInput = document.getElementById('globalOffsetInput');
        if (offsetInput) offsetInput.value = MOMO.state.globalOffsetMs;
        if (MOMO.state.audioEl) {
            try { MOMO.state.audioEl.currentTime = 0; } catch (e) { /* noop */ }
        }
        lastCurrentIdx = -1;
        renderLyricsView();
        updateDiffBanner();
        updateCurrentLine();
    }

    function resetCurrentIdx() {
        lastCurrentIdx = -1;
    }

    /**
     * v1.18: 歌詞ウィンドウのリサイズハンドル。
     *  - resize: vertical が一部環境で効かない問題への対応
     *  - ハンドルをドラッグして lyrics-view の高さを変更
     *  - min 100px, max window 80%
     */
    function initResizeHandle() {
        const handle = document.getElementById('lyrics-resize-handle');
        const view = document.getElementById('lyrics-view');
        if (!handle || !view) return;
        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        handle.addEventListener('pointerdown', (e) => {
            dragging = true;
            startY = e.clientY;
            startHeight = view.getBoundingClientRect().height;
            try { handle.setPointerCapture(e.pointerId); } catch (er) {}
            e.preventDefault();
        });
        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dy = e.clientY - startY;
            const minH = 100;
            const maxH = Math.floor(window.innerHeight * 0.85);
            const newH = Math.max(minH, Math.min(maxH, startHeight + dy));
            view.style.height = newH + 'px';
        });
        const stop = (e) => {
            dragging = false;
            try { handle.releasePointerCapture(e.pointerId); } catch (er) {}
        };
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    function init() {
        MOMO.state.audioEl = document.getElementById('audio-player');
        if (MOMO.state.audioEl) {
            MOMO.state.audioEl.addEventListener('timeupdate', updateCurrentLine);
            // v1.19: ユーザーが再生ボタン (audio標準UI) を押した時、1行プレビュー範囲外なら
            //         自然な再生に戻すため focusedIdx を解除する。
            //         ただし1行プレビュー進行中(oneLineStopAt>=0)はロック維持。
            MOMO.state.audioEl.addEventListener('play', () => {
                if (oneLineStopAt < 0) focusedIdx = -1;
            });
        }
        initResizeHandle();
        const bind = (id, ev, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(ev, fn);
        };
        // v1.17: ライブラリ方式に変更したため openLrcBtn/openTxtBtn は廃止
        bind('chooseAudioBtn', 'click', chooseAudioFile);
        bind('offsetMinusBtn', 'click', () => adjustCurrentLine(-100));
        bind('offsetPlusBtn', 'click', () => adjustCurrentLine(100));
        bind('globalOffsetInput', 'input', (e) => {
            MOMO.state.globalOffsetMs = parseInt(e.target.value, 10) || 0;
            lastCurrentIdx = -1;
            updateCurrentLine();
            updateDiffBanner();
        });
        bind('saveLyricsBtn', 'click', saveLyrics);
        // v1.13: 曲名/アーティスト追加ボタン
        bind('addInfoBtn', 'click', onAddInfoHeader);
        // 再生中にユーザーが pause したら 1行プレビューを解除
        if (MOMO.state.audioEl) {
            MOMO.state.audioEl.addEventListener('pause', () => {
                // ユーザー操作による手動 pause ならプレビュー停止点もクリア
                // (1行プレビュー自身が pause() するケースは既に clearOneLinePreview 済み)
                if (oneLineStopAt >= 0 && MOMO.state.audioEl.currentTime < oneLineStopAt - 0.05) {
                    clearOneLinePreview();
                }
            });
        }

        renderHistoryList();
    }

    return {
        init: init,
        addToHistory: addToHistory,
        selectEntry: selectEntry,
        renderHistoryList: renderHistoryList,
        renderLyricsView: renderLyricsView,
        adjustCurrentLine: adjustCurrentLine,
        resetCurrentIdx: resetCurrentIdx,
        updateDiffBanner: updateDiffBanner,
        scrollCurrentLineIntoView: scrollCurrentLineIntoView,
        loadAudioFile: loadAudioFile,
        clearOneLinePreview: clearOneLinePreview,
        promptAudioIfMissing: promptAudioIfMissing,
        pickFromHandles: pickFromHandles
    };
})();
