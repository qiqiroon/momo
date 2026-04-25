/* MOMO Lyrics — tap.js
 * 責務: .txt を読み込み、TAPボタン/スペースキーで各行にタイムスタンプを付与する。
 * 対応要件: 要件6(txt→タップでタイミング付与)
 * v1.11:
 *   - TXT 読込時に同時選択された音源を自動ロード(multiple:true)
 *   - addInfoHeader ON の場合、0秒情報行(isInfoHeader=true, assigned=true)を先頭固定で追加
 *   - TAP 押下後、その行を current 化して歌詞ウィンドウ内のみスクロール
 *   - TAP でも timeMs クランプ(前assigned行より後、次未割当の前)
 *   - 保存先として TXT の親ディレクトリを startIn に使うため entry.txtHandle を保持
 */

MOMO.tap = (function () {
    'use strict';

    /**
     * v1.16: showOpenFilePicker でファイル選択UIから .txt を選ぶ。
     * Ctrl+クリックで同時に音源も選択可能。baseName 一致の音源を自動ペア。
     */
    async function startTxtMode() {
        if (!window.showOpenFilePicker) {
            alert('Chrome/Edge を使用してください。');
            return;
        }
        let handles;
        try {
            handles = await window.showOpenFilePicker({
                multiple: true,
                types: [
                    { description: 'Text', accept: { 'text/plain': ['.txt'] } },
                    { description: 'Audio', accept: { 'audio/*': ['.mp3', '.m4a', '.flac', '.wav', '.ogg'] } }
                ]
            });
        } catch (e) {
            if (e.name !== 'AbortError') alert('ファイルを開けませんでした: ' + e.message);
            return;
        }
        try {
            const picked = MOMO.play.pickFromHandles(handles, ['.txt']);
            const txtHandle = picked.lyricsHandle;
            const audioHandle = picked.audioHandle;
            if (!txtHandle) {
                alert('.txt ファイルを選択してください。');
                return;
            }
            const txtFile = await txtHandle.getFile();
            let audioFile = null;
            if (audioHandle) {
                try { audioFile = await audioHandle.getFile(); } catch (e) { audioFile = null; }
            }

            const text = await txtFile.text();
            const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            const baseName = txtFile.name.replace(/\.txt$/i, '');

            // 0秒情報追加 ON なら、先頭に isInfoHeader=true の固定行を置く（TAP対象外）
            const lines = [];
            if (MOMO.state.addInfoHeader) {
                lines.push({ timeMs: 0, text: baseName, assigned: true, isInfoHeader: true });
            }
            for (const t of rawLines) {
                lines.push({ timeMs: 0, text: t, assigned: false });
            }

            const doc = { metadata: {}, lines: lines };
            const entry = {
                id: 'txt_' + Date.now(),
                source: 'txt',
                title: baseName,
                artist: '',
                rawLrc: '',
                doc: doc,
                fileHandle: null,
                txtHandle: txtHandle,
                // v1.14: 履歴ごとに音源を保有
                audioFile: audioFile,
                audioHandle: audioHandle,
                createdAt: Date.now()
            };

            MOMO.play.addToHistory(entry);
            MOMO.play.selectEntry(entry); // v1.14: selectEntry内で audioFile を自動ロード

            // タップUIを表示
            document.getElementById('tap-controls').classList.remove('hidden');
            MOMO.state.undoStack = [];
            updateTapProgress();
        } catch (e) {
            if (e.name !== 'AbortError') console.error(e);
        }
    }

    function updateTapProgress() {
        const buf = MOMO.state.editBuffer;
        const lines = (buf && buf.lines) || [];
        // isInfoHeader は TAP 対象外として総数からも除外する
        const tappable = lines.filter(l => !l.isInfoHeader);
        const total = tappable.length;
        const assigned = tappable.filter(l => l.assigned).length;
        const d = MOMO.i18n.get();
        const el = document.getElementById('tap-progress');
        if (el) {
            const fmt = d.tapProgress || '{cur} / {total}';
            el.textContent = fmt.replace('{cur}', assigned).replace('{total}', total);
        }
        if (total > 0 && assigned === total) {
            document.getElementById('tap-controls').classList.add('hidden');
        }
    }

    function onTap() {
        const audio = MOMO.state.audioEl;
        if (!audio || !MOMO.state.editBuffer) return;
        const lines = MOMO.state.editBuffer.lines;
        // TAP対象は infoHeader を除く未割当行の先頭
        const nextIdx = lines.findIndex(l => !l.assigned && !l.isInfoHeader);
        if (nextIdx < 0) return;

        // 前assigned行との境界でクランプ
        // v1.11: 符号反転に合わせ、tap時の値は音源時刻そのまま(現在時刻)を採用。
        // ただし前のassigned行のtimeMsより必ず後になるようクランプ。
        let prevBound = 0;
        for (let i = nextIdx - 1; i >= 0; i--) {
            if (lines[i].assigned) { prevBound = lines[i].timeMs + 1; break; }
        }
        const target = Math.max(prevBound, Math.round(audio.currentTime * 1000));

        const prevState = {
            idx: nextIdx,
            timeMs: lines[nextIdx].timeMs,
            assigned: lines[nextIdx].assigned,
            text: lines[nextIdx].text
        };
        lines[nextIdx].timeMs = target;
        lines[nextIdx].assigned = true;
        // v1.13: 原本値を確定値として記録（差分表示のベース、今後のTAP/±で不変）
        lines[nextIdx].originalTimeMs = target;
        MOMO.state.undoStack = [prevState];

        // 未割当を末尾寄せにしつつ、割当済みは timeMs 昇順
        lines.sort((a, b) => {
            if (a.assigned && !b.assigned) return -1;
            if (!a.assigned && b.assigned) return 1;
            return a.timeMs - b.timeMs;
        });

        MOMO.play.renderLyricsView();
        // TAP行を current にハイライト（位置 = 新しいインデックス）
        const newIdx = lines.findIndex(l => l.assigned && l.text === prevState.text && l.timeMs === target);
        if (newIdx >= 0) {
            const nodes = document.querySelectorAll('.lyrics-line');
            nodes.forEach((el, i) => el.classList.toggle('current', i === newIdx));
            MOMO.play.scrollCurrentLineIntoView();
        }
        // lastCurrentIdx は play.js 側で updateCurrentLine が差分検知するため一旦リセット
        MOMO.play.resetCurrentIdx();
        updateTapProgress();
        if (MOMO.play.updateDiffBanner) MOMO.play.updateDiffBanner();
    }

    function onUndo() {
        if (!MOMO.state.undoStack || MOMO.state.undoStack.length === 0) return;
        const prev = MOMO.state.undoStack.pop();
        const lines = MOMO.state.editBuffer.lines;
        let targetIdx = -1;
        let maxTime = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].assigned && !lines[i].isInfoHeader && lines[i].text === prev.text && lines[i].timeMs > maxTime) {
                maxTime = lines[i].timeMs;
                targetIdx = i;
            }
        }
        if (targetIdx < 0) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].assigned && !lines[i].isInfoHeader && lines[i].timeMs > maxTime) {
                    maxTime = lines[i].timeMs;
                    targetIdx = i;
                }
            }
        }
        if (targetIdx < 0) return;

        lines[targetIdx].timeMs = 0;
        lines[targetIdx].assigned = false;
        lines.sort((a, b) => {
            if (a.assigned && !b.assigned) return -1;
            if (!a.assigned && b.assigned) return 1;
            return a.timeMs - b.timeMs;
        });

        MOMO.play.renderLyricsView();
        MOMO.play.resetCurrentIdx();

        const tappable = lines.filter(l => !l.isInfoHeader);
        const total = tappable.length;
        const assigned = tappable.filter(l => l.assigned).length;
        if (total > 0 && assigned < total) {
            const controls = document.getElementById('tap-controls');
            if (controls) controls.classList.remove('hidden');
        }
        updateTapProgress();
        if (MOMO.play.updateDiffBanner) MOMO.play.updateDiffBanner();
    }

    function init() {
        const tapBtn = document.getElementById('tapBtn');
        if (tapBtn) {
            // v1.12: 押下した瞬間にタイミングを記録（離した瞬間ではなく）
            // pointerdown は押下時に発火。click(=mouseup相当) は使わない。
            tapBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                onTap();
            });
        }
        const undoBtn = document.getElementById('undoTapBtn');
        if (undoBtn) undoBtn.addEventListener('click', onUndo);

        document.addEventListener('keydown', (e) => {
            const tapControls = document.getElementById('tap-controls');
            if (!tapControls || tapControls.classList.contains('hidden')) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            // v1.12: keydown(押下時) に発火。長押し repeat は無視。
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                onTap();
            }
        });
    }

    return {
        init: init,
        startTxtMode: startTxtMode,
        updateTapProgress: updateTapProgress,
        onTap: onTap,
        onUndo: onUndo
    };
})();
