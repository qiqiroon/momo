/* MOMO Lyrics — play.js
 * 責務: プレイモード本体。履歴管理、LRCロード、音源同期再生、行タイミング調整、保存、差分表示。
 * 対応要件: 要件4(プレイ)/要件5(タイミング調整と保存)/要件7(書き戻し)
 * v2.02 (修正事項26090310):
 *   - 履歴は「取り込んだ順」= 末尾に足す。上限を超えたら古いもの(先頭)から落とす。
 *   - 「全体オフセット」の概念を全廃。行の時刻がそのまま実際に鳴る時刻。
 *     全体をずらしたい時は「この行以後全部反映」を ON にして現在行 ± を押す。
 *   - 各行に時間を常時表示（左:時間 / 中:タイトル印 / 右:歌詞。すべて左寄せ）。
 *   - 1行目のタイトル印は「アプリが 0秒タイトル行を足したことが確実な時」だけ既定 ON。
 *   - 「1行づつ再生」チェックで 1行再生 / 連続再生 を手動切替（± での自動切替は廃止）。
 *   - 保存ボタン: 変更なし=白枠黒地 / 変更あり=オレンジ。
 *   - プレイ画面にも「無効化」(空ファイルで上書き) を用意。
 *   - 現在行の検出を timeupdate 任せから画面更新ごと(requestAnimationFrame)に変更。
 *     実測: 検知の遅れ 平均135ms/最大282ms → 平均3.6ms/最大6.9ms
 */

MOMO.play = (function () {
    'use strict';

    const HISTORY_MAX = 50;

    let lastCurrentIdx = -1;
    /**
     * ユーザーが「選択している行」のインデックス (>=0 で有効)。
     * 「1行づつ再生」が ON の間だけ、この行に current を固定する。
     * OFF(連続再生)のときは固定せず、再生位置に素直に追従させる。
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

    function isOneLinePlay() {
        return !!MOMO.state.oneLinePlay;
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
        if (orig.lines.length !== buf.lines.length) return true;
        for (let i = 0; i < orig.lines.length; i++) {
            if (orig.lines[i].timeMs !== buf.lines[i].timeMs) return true;
            if (orig.lines[i].text !== buf.lines[i].text) return true;
            if (orig.lines[i].assigned !== buf.lines[i].assigned) return true;
        }
        return false;
    }

    /**
     * v2.02: 取り込んだ順に並べる = 末尾に足す。
     *   上限を超えたときに落とすのは「一番古いもの」= 先頭。
     *   (以前は先頭に差し込んで末尾を落としていたため、逆順で並んでいた)
     */
    function addToHistory(entry) {
        if (!MOMO.state.history) MOMO.state.history = [];
        const idx = MOMO.state.history.findIndex(e => e.id === entry.id);
        if (idx >= 0) MOMO.state.history[idx] = entry;
        else MOMO.state.history.push(entry);
        while (MOMO.state.history.length > HISTORY_MAX) MOMO.state.history.shift();
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
        // 各行の originalTimeMs を記録（以後の TAP/±で変わらない原本値）
        MOMO.state.editBuffer.lines.forEach(l => { l.originalTimeMs = l.timeMs; });

        document.getElementById('audio-controls').classList.remove('hidden');
        document.getElementById('lyrics-view').classList.remove('hidden');
        const rh = document.getElementById('lyrics-resize-handle');
        if (rh) rh.classList.remove('hidden');
        document.getElementById('adjust-controls').classList.remove('hidden');
        // タップUIは tap.js 側で制御（txt由来の場合のみ表示）
        if (entry.source !== 'txt') {
            document.getElementById('tap-controls').classList.add('hidden');
        }
        // 曲名/アーティスト入力行は常に表示（ロードされているエントリがあるとき）
        const infoRow = document.getElementById('info-add-row');
        if (infoRow) infoRow.classList.remove('hidden');

        lastCurrentIdx = -1;
        const status = document.getElementById('save-status');
        if (status) status.textContent = '';

        // 履歴ごとに紐付けられた音源があれば自動ロード
        if (entry.audioFile) {
            loadAudioFile(entry.audioFile, entry.audioHandle || null);
        }

        // エントリ選択時は audio を 0 秒に戻す
        if (MOMO.state.audioEl) {
            try { MOMO.state.audioEl.currentTime = 0; } catch (e) {}
        }
        clearOneLinePreview();
        focusedIdx = -1;

        renderLyricsView();
        renderHistoryList();
        updateDiffBanner();
        updateDisableBtn();
    }

    /**
     * v2.02: 1行 = [時間] [タイトル印] [歌詞] [差分] の横並び（すべて左寄せ）。
     *   時間とタイトル印は幅を固定しているので、全行で歌詞の左端が揃う。
     *   タイトル印の欄は 1行目以外でも場所だけ確保する（歌詞がずれないため）。
     */
    function renderLyricsView() {
        const view = document.getElementById('lyrics-view');
        if (!view) return;
        view.innerHTML = '';
        if (!MOMO.state.editBuffer) return;
        const d = MOMO.i18n.get();

        MOMO.state.editBuffer.lines.forEach((line, idx) => {
            const div = document.createElement('div');
            div.className = 'lyrics-line' + (line.assigned ? '' : ' unassigned');
            if (line.isInfoHeader) {
                div.classList.add('info-header');
                div.classList.add('title-fixed');
            }
            div.dataset.index = idx;

            // 左: 時間（常時表示）。未割当行は --:--.--
            const timeSpan = document.createElement('span');
            timeSpan.className = 'lyrics-line-time';
            timeSpan.textContent = line.assigned
                ? MOMO.lrc.formatTime(line.timeMs)
                : MOMO.lrc.formatTime(null);
            div.appendChild(timeSpan);

            // 中: タイトル化チェックボックス（1行目だけ中身を入れ、他行は場所だけ確保）
            const toggle = document.createElement('label');
            toggle.className = 'title-toggle';
            if (idx === 0) {
                toggle.title = d.titleToggleHint || 'Title (fixed at 0s)';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !!line.isInfoHeader;
                cb.addEventListener('click', (ev) => ev.stopPropagation());
                cb.addEventListener('change', (ev) => {
                    ev.stopPropagation();
                    onTitleToggleChanged(ev.target.checked);
                });
                toggle.appendChild(cb);
            } else {
                toggle.classList.add('placeholder');
            }
            div.appendChild(toggle);

            // 右: 歌詞
            const textSpan = document.createElement('span');
            textSpan.className = 'lyrics-line-text';
            textSpan.textContent = line.text || '♪';
            div.appendChild(textSpan);

            // 行ごとの差分(タイトル行は除外)
            if (line.assigned && !line.isInfoHeader && typeof line.originalTimeMs === 'number') {
                const diff = line.timeMs - line.originalTimeMs;
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

        // 再描画で current クラスが消えるので、ハイライトを貼り直す
        const keep = (isOneLinePlay() && focusedIdx >= 0) ? focusedIdx : lastCurrentIdx;
        if (keep >= 0) {
            const nodes = view.querySelectorAll('.lyrics-line');
            if (nodes[keep]) nodes[keep].classList.add('current');
        }
    }

    /**
     * タイトルチェックボックス変更ハンドラ。
     *  ON  → 1行目を timeMs=0, isInfoHeader=true, assigned=true（タイトル固定）
     *  OFF → 1行目を isInfoHeader=false（通常行に戻す）
     */
    function onTitleToggleChanged(checked) {
        if (!MOMO.state.editBuffer || MOMO.state.editBuffer.lines.length === 0) return;
        const line = MOMO.state.editBuffer.lines[0];
        if (checked) {
            line.isInfoHeader = true;
            line.timeMs = 0;
            line.assigned = true;
            line.originalTimeMs = 0;
        } else {
            line.isInfoHeader = false;
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
        audio.currentTime = Math.max(0, line.timeMs / 1000);
    }

    // 1行づつ再生の停止位置(秒)。>=0 で有効
    let oneLineStopAt = -1;
    let oneLineStartAt = -1;

    function clearOneLinePreview() {
        oneLineStopAt = -1;
        oneLineStartAt = -1;
    }

    function highlightIndex(idx) {
        const nodes = document.querySelectorAll('.lyrics-line');
        nodes.forEach((el, i) => el.classList.toggle('current', i === idx));
        lastCurrentIdx = idx;
        scrollCurrentLineIntoView();
    }

    /**
     * v2.02: 指定行の頭から再生する。
     *   「1行づつ再生」ON  → 次の行の頭で止めて、その行の頭に戻す（行を固定）
     *   「1行づつ再生」OFF → 頭出しして、そのまま連続再生（行の固定はしない）
     *   ± を押したときの「その行の頭から鳴らす」は、どちらの場合も行う。
     */
    function playFromLine(idx) {
        const audio = MOMO.state.audioEl;
        if (!audio) return;
        const lines = MOMO.state.editBuffer && MOMO.state.editBuffer.lines;
        if (!lines) return;
        const line = lines[idx];
        if (!line || !line.assigned || line.isInfoHeader) return;

        const startSec = Math.max(0, line.timeMs / 1000);

        if (isOneLinePlay()) {
            let nextMs = null;
            for (let i = idx + 1; i < lines.length; i++) {
                if (lines[i].assigned && !lines[i].isInfoHeader) { nextMs = lines[i].timeMs; break; }
            }
            oneLineStartAt = startSec;
            oneLineStopAt = nextMs !== null ? Math.max(0, nextMs / 1000) : -1;
            focusedIdx = idx;
        } else {
            clearOneLinePreview();
            focusedIdx = -1; // 連続再生では再生位置に素直に追従させる
        }

        audio.currentTime = startSec;
        if (audio.paused) audio.play().catch(() => {});
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
        playFromLine(idx);
    }

    /**
     * 歌詞ウィンドウ内スクロール。
     *  - overflow なし: 何もしない
     *  - current 行が既に完全に view 内にある: 何もしない
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
        if (curTopInView >= view.scrollTop && curBottomInView <= view.scrollTop + view.clientHeight) {
            return;
        }
        const target = curTopInView - (view.clientHeight * 0.33) + (curRect.height / 2);
        const maxScroll = view.scrollHeight - view.clientHeight;
        const clamped = Math.max(0, Math.min(target, maxScroll));
        view.scrollTo({ top: clamped, behavior: 'smooth' });
    }

    function updateCurrentLine() {
        const audio = MOMO.state.audioEl;
        if (!audio || !MOMO.state.editBuffer) return;

        // 1行づつ再生の終了 → ポーズして対象行の先頭へ戻す
        if (oneLineStopAt >= 0 && audio.currentTime >= oneLineStopAt) {
            try { audio.pause(); } catch (e) {}
            if (oneLineStartAt >= 0) {
                audio.currentTime = oneLineStartAt;
            }
            clearOneLinePreview();
            if (focusedIdx >= 0) highlightIndex(focusedIdx);
            return;
        }

        // 1行づつ再生の間だけ、選択行に固定する
        // （途中で連続再生に切り替えられたら、その場から再生位置に追従し直す）
        if (focusedIdx >= 0 && isOneLinePlay()) {
            if (focusedIdx !== lastCurrentIdx) highlightIndex(focusedIdx);
            return;
        }

        const currentMs = audio.currentTime * 1000;
        const idx = MOMO.lrc.findCurrentLineIndex(MOMO.state.editBuffer.lines, currentMs);
        if (idx === lastCurrentIdx) return;
        lastCurrentIdx = idx;
        const nodes = document.querySelectorAll('.lyrics-line');
        nodes.forEach((el, i) => el.classList.toggle('current', i === idx));
        scrollCurrentLineIntoView();
    }

    /**
     * v2.02: 画面の更新ごとに現在行を見に行く。
     *   音源の timeupdate は 1秒に約4回(実測 約266ms間隔)しか来ないため、
     *   それだけに頼ると歌詞の切り替わりが平均135ms・最大282ms 遅れる。
     */
    let rafId = 0;
    function startTicker() {
        if (rafId) return;
        const tick = () => {
            rafId = requestAnimationFrame(tick);
            updateCurrentLine();
        };
        rafId = requestAnimationFrame(tick);
    }
    function stopTicker() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    /**
     * 現在行 ±100ms の調整。
     *   対象は「いま current になっている行」。
     *   「この行以後全部反映」ON → その行から後ろの割当済み行すべてを同じ量だけ動かす。
     *   ± のあとは、その行の先頭から鳴らす（1行づつ再生の ON/OFF に従う）。
     */
    function adjustCurrentLine(deltaMs) {
        if (!MOMO.state.editBuffer) return;
        const lines = MOMO.state.editBuffer.lines;
        // ± の対象は「いま current になっている行」。
        // 1行づつ再生の間は選択行に固定されているので focusedIdx、それ以外は再生位置の行。
        let idx = (isOneLinePlay() && focusedIdx >= 0) ? focusedIdx : lastCurrentIdx;
        if (idx < 0 || idx >= lines.length) return;
        const line = lines[idx];
        if (!line || !line.assigned || line.isInfoHeader) return;

        const applyFollowing = !!MOMO.state.applyToFollowing;

        // 直前の割当済み行(タイトル行を除く)は越えられない
        let prevBound = 0;
        for (let i = idx - 1; i >= 0; i--) {
            if (lines[i].assigned && !lines[i].isInfoHeader) { prevBound = lines[i].timeMs + 1; break; }
        }

        let candidate = line.timeMs + deltaMs;
        if (!applyFollowing) {
            // 単独で動かすときだけ、直後の割当済み行も越えられない
            let nextBound = Number.POSITIVE_INFINITY;
            for (let i = idx + 1; i < lines.length; i++) {
                if (lines[i].assigned && !lines[i].isInfoHeader) { nextBound = lines[i].timeMs - 1; break; }
            }
            candidate = Math.min(nextBound, candidate);
        }
        candidate = Math.max(prevBound, candidate);
        if (candidate < 0) candidate = 0;
        if (candidate === line.timeMs) return; // 境界で動けない

        const effectiveDelta = candidate - line.timeMs;

        if (applyFollowing) {
            // この行と、これより後ろの割当済み行(タイトル行を除く)をまとめて動かす
            for (let i = idx; i < lines.length; i++) {
                const l = lines[i];
                if (!l.assigned || l.isInfoHeader) continue;
                l.timeMs = Math.max(0, l.timeMs + effectiveDelta);
            }
        } else {
            line.timeMs = candidate;
        }

        // ソート: infoHeader は先頭固定 / assigned は timeMs 昇順 / unassigned は末尾
        lines.sort((a, b) => {
            if (a.isInfoHeader && !b.isInfoHeader) return -1;
            if (!a.isInfoHeader && b.isInfoHeader) return 1;
            if (a.assigned && !b.assigned) return -1;
            if (!a.assigned && b.assigned) return 1;
            return a.timeMs - b.timeMs;
        });

        const newIdx = lines.indexOf(line);
        focusedIdx = newIdx;
        lastCurrentIdx = newIdx;

        renderLyricsView();
        playFromLine(newIdx);
        updateDiffBanner();
    }

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
     * 選択ファイル群から .lrc/.txt と音源を分類し、baseName一致で音源を自動ペア。
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
     * 「.lrcファイルを開く」フロー。
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

    /**
     * 互換用エクスポート(他モジュールから呼ばれる場合がある)
     */
    async function promptAudioIfMissing() {
        return { audioFile: null, audioHandle: null };
    }

    /**
     * 曲名/アーティスト入力欄からの「追加」ボタン押下。
     */
    function onAddInfoHeader() {
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) return;
        const titleInput = document.getElementById('info-title-input');
        const artistInput = document.getElementById('info-artist-input');
        const title = (titleInput && titleInput.value || '').trim();
        const artist = (artistInput && artistInput.value || '').trim();
        if (!title && !artist) return;

        MOMO.lrc.ensureInfoHeader(MOMO.state.editBuffer, title, artist);
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
     * v2.02: 未保存の変更の表示。
     *   エントリが載っている間は「変更なし」も含めて常に出す（出たり消えたりで
     *   下のボタンの位置がずれないようにするため）。
     *   合わせて保存ボタンの色も切り替える（変更なし=白枠黒地 / 変更あり=オレンジ）。
     */
    function updateDiffBanner() {
        const banner = document.getElementById('diff-banner');
        const saveBtn = document.getElementById('saveLyricsBtn');
        if (!banner) return;
        const d = MOMO.i18n.get();

        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) {
            banner.classList.add('hidden');
            banner.textContent = '';
            if (saveBtn) saveBtn.classList.remove('dirty');
            return;
        }
        banner.classList.remove('hidden');

        const orig = MOMO.state.currentEntry.doc;
        const buf = MOMO.state.editBuffer;

        // 変更行数を数える（同インデックス同士で比較、長さ違いも差分扱い）
        let changedLines = 0;
        const maxLen = Math.max(orig.lines.length, buf.lines.length);
        for (let i = 0; i < maxLen; i++) {
            const a = orig.lines[i];
            const b = buf.lines[i];
            if (!a || !b) { changedLines++; continue; }
            if (a.timeMs !== b.timeMs || a.text !== b.text || a.assigned !== b.assigned) changedLines++;
        }

        if (changedLines === 0) {
            banner.textContent = d.diffNone;
            banner.classList.add('clean');
            if (saveBtn) saveBtn.classList.remove('dirty');
            return;
        }
        banner.classList.remove('clean');
        banner.textContent = d.diffTitle + ' / ' + d.diffLines.replace('{n}', changedLines);
        if (saveBtn) saveBtn.classList.add('dirty');
    }

    /**
     * 保存処理。
     * - confirm() を使わず User activation を維持する。
     * - fileHandle がある場合は queryPermission→requestPermission→createWritable の順。
     * - fileHandle が null の場合は showSaveFilePicker、失敗したらダウンロード。
     */
    async function saveLyrics() {
        if (!MOMO.state.currentEntry || !MOMO.state.editBuffer) return;
        // v2.02: offset の焼き込みは無くなった（行の時刻がそのまま書かれる）
        const serialized = MOMO.lrc.serialize(MOMO.state.editBuffer);

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
                    entry.fileHandle = newHandle;
                    ok = true;
                } catch (e) {
                    if (e.name === 'AbortError') return; // キャンセル
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

        // 保存後: 原本更新、バッファ再構築、シークバー0復帰、差分クリア
        const savedDoc = MOMO.lrc.parse(serialized);
        // タイトル行の印は保存で失われないよう引き継ぐ
        if (MOMO.state.editBuffer.lines[0] && MOMO.state.editBuffer.lines[0].isInfoHeader
            && savedDoc.lines[0] && savedDoc.lines[0].timeMs === 0) {
            savedDoc.lines[0].isInfoHeader = true;
        }
        entry.doc = savedDoc;
        entry.rawLrc = serialized;
        MOMO.state.editBuffer = deepCopyDoc(entry.doc);
        MOMO.state.editBuffer.lines.forEach(l => { l.originalTimeMs = l.timeMs; });
        if (MOMO.state.audioEl) {
            try { MOMO.state.audioEl.currentTime = 0; } catch (e) { /* noop */ }
        }
        lastCurrentIdx = -1;
        focusedIdx = -1;
        clearOneLinePreview();
        renderLyricsView();
        updateDiffBanner();
        updateCurrentLine();
        updateDisableBtn();
    }

    /**
     * v2.02: プレイ画面からの「無効化」。
     *   フォルダ一括処理の無効化と同じ動作（歌詞ファイルを空で上書きする）。
     *   実体のファイルが無いもの（個別検索の結果など）は押せない。
     */
    function updateDisableBtn() {
        const btn = document.getElementById('disableLyricsBtn');
        if (!btn) return;
        const d = MOMO.i18n.get();
        const entry = MOMO.state.currentEntry;
        btn.textContent = d.disableBtn;
        btn.disabled = !(entry && entry.fileHandle);
        btn.title = btn.disabled ? (d.disableUnavailable || '') : '';
    }

    async function disableLyrics() {
        const entry = MOMO.state.currentEntry;
        if (!entry || !entry.fileHandle) return;
        const d = MOMO.i18n.get();
        const status = document.getElementById('save-status');
        const name = (entry.fileHandle.name || (entry.title + '.lrc'));
        if (!window.confirm(d.confirmDisable.replace('{name}', name))) return;
        try {
            const handle = entry.fileHandle;
            if (handle.queryPermission) {
                let perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted' && handle.requestPermission) {
                    perm = await handle.requestPermission({ mode: 'readwrite' });
                }
                if (perm !== 'granted') throw new Error('permission denied');
            }
            const writable = await handle.createWritable();
            await writable.write('');
            await writable.close();
            const btn = document.getElementById('disableLyricsBtn');
            if (btn) { btn.disabled = true; btn.textContent = d.disabled; }
            if (status) status.textContent = d.disabled;
        } catch (e) {
            if (status) status.textContent = d.saveFailed + ': ' + e.message;
        }
    }

    function resetCurrentIdx() {
        lastCurrentIdx = -1;
    }

    /**
     * 歌詞ウィンドウのリサイズハンドル。
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
            const audio = MOMO.state.audioEl;
            // v2.02: 現在行の判定は画面更新ごと。timeupdate は「裏に回って画面更新が
            //        止まったとき」の保険として残す（二重に呼んでも結果は同じ）。
            audio.addEventListener('timeupdate', updateCurrentLine);
            audio.addEventListener('seeked', updateCurrentLine);
            audio.addEventListener('play', () => {
                // 1行づつ再生の最中でなければ、行の固定を解除して再生位置に追従させる
                if (oneLineStopAt < 0) focusedIdx = -1;
                startTicker();
            });
            audio.addEventListener('pause', () => {
                stopTicker();
                // ユーザー操作による手動 pause なら 1行づつ再生の停止点もクリア
                if (oneLineStopAt >= 0 && audio.currentTime < oneLineStopAt - 0.05) {
                    clearOneLinePreview();
                }
            });
            audio.addEventListener('ended', stopTicker);
        }
        initResizeHandle();
        const bind = (id, ev, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(ev, fn);
        };
        bind('chooseAudioBtn', 'click', chooseAudioFile);
        bind('offsetMinusBtn', 'click', () => adjustCurrentLine(-100));
        bind('offsetPlusBtn', 'click', () => adjustCurrentLine(100));
        bind('saveLyricsBtn', 'click', saveLyrics);
        bind('disableLyricsBtn', 'click', disableLyrics);
        bind('addInfoBtn', 'click', onAddInfoHeader);

        renderHistoryList();
        updateDisableBtn();
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
        updateDisableBtn: updateDisableBtn,
        scrollCurrentLineIntoView: scrollCurrentLineIntoView,
        loadAudioFile: loadAudioFile,
        clearOneLinePreview: clearOneLinePreview,
        openLrcFile: openLrcFile,
        seekToLine: seekToLine,
        promptAudioIfMissing: promptAudioIfMissing,
        pickFromHandles: pickFromHandles
    };
})();
