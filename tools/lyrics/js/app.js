/* MOMO Lyrics — app.js
 * 責務: 起動・タブ切替・グローバル状態初期化・言語切替イベント。
 * 対応要件: 全要件の起点（特に要件2/要件5のトグル永続化と同期）。
 */

MOMO.app = (function () {
    'use strict';

    function switchTab(type) {
        const tabs = ['folder', 'search', 'play'];
        tabs.forEach(t => {
            const tabBtn = document.getElementById('tab-' + t);
            const section = document.getElementById(t + '-section');
            if (tabBtn) tabBtn.classList.toggle('active', t === type);
            if (section) section.classList.toggle('hidden', t !== type);
        });
    }

    function initState() {
        // state 初期値（i18n.js で curLang/catBase は初期化済み）
        MOMO.state.addInfoHeader = false;
        MOMO.state.history = [];
        MOMO.state.currentEntry = null;
        MOMO.state.editBuffer = null;
        MOMO.state.audioEl = null;
        MOMO.state.audioFileName = null;
        MOMO.state.undoStack = [];
        // v2.02: 1行づつ再生（既定 ON = 従来と同じ動き）。覚える。
        MOMO.state.oneLinePlay = true;
        // v2.02: この行以後全部反映（既定 OFF）。まとめて動かす操作なので覚えない。
        MOMO.state.applyToFollowing = false;

        // トグルの永続化設定を復元
        try {
            MOMO.state.addInfoHeader = localStorage.getItem('momoAddInfoHeader') === 'true';
            const one = localStorage.getItem('momoOneLinePlay');
            if (one !== null) MOMO.state.oneLinePlay = (one === 'true');
        } catch (e) { /* noop */ }
    }

    function initToggles() {
        // v1.13: プレイ画面のトグルは廃止（入力欄+追加ボタンに置換）
        const cbFolder = document.getElementById('toggle-add-info-folder');
        const cbSearch = document.getElementById('toggle-add-info-search');
        const cbOneLine = document.getElementById('toggle-one-line-play');
        const cbFollowing = document.getElementById('toggle-apply-following');

        if (cbFolder) cbFolder.checked = MOMO.state.addInfoHeader;
        if (cbSearch) cbSearch.checked = MOMO.state.addInfoHeader;
        if (cbOneLine) cbOneLine.checked = MOMO.state.oneLinePlay;
        if (cbFollowing) cbFollowing.checked = MOMO.state.applyToFollowing;

        const syncAddInfo = (e) => {
            const v = !!e.target.checked;
            MOMO.state.addInfoHeader = v;
            if (cbFolder && cbFolder !== e.target) cbFolder.checked = v;
            if (cbSearch && cbSearch !== e.target) cbSearch.checked = v;
            try { localStorage.setItem('momoAddInfoHeader', String(v)); } catch (er) {}
        };
        if (cbFolder) cbFolder.addEventListener('change', syncAddInfo);
        if (cbSearch) cbSearch.addEventListener('change', syncAddInfo);

        // v2.02: 1行づつ再生 ON=1行ずつ / OFF=連続再生。次回も覚える。
        if (cbOneLine) {
            cbOneLine.addEventListener('change', (e) => {
                MOMO.state.oneLinePlay = !!e.target.checked;
                try { localStorage.setItem('momoOneLinePlay', String(e.target.checked)); } catch (er) {}
                // 連続再生に切り替えたら、1行分の停止点をその場で外す
                // （行の固定は play.js 側がこのチェック状態を見て判断する）
                if (!MOMO.state.oneLinePlay && MOMO.play && MOMO.play.clearOneLinePreview) {
                    MOMO.play.clearOneLinePreview();
                }
            });
        }

        // v2.02: この行以後全部反映。覚えない（開くたびに OFF）。
        if (cbFollowing) {
            cbFollowing.addEventListener('change', (e) => {
                MOMO.state.applyToFollowing = !!e.target.checked;
            });
        }
    }

    function initLangSwitcher() {
        const sel = document.getElementById('lang-select');
        if (!sel) return;
        // 案件⑦: select は langMode (auto を含む) を表示
        sel.value = MOMO.state.langMode;
        sel.addEventListener('change', (e) => {
            MOMO.i18n.setLang(e.target.value);
        });
    }

    function init() {
        initState();
        initLangSwitcher();
        initToggles();

        // 言語の初期適用
        MOMO.i18n.apply();

        // 各モジュール初期化
        if (MOMO.folder && MOMO.folder.init) MOMO.folder.init();
        if (MOMO.search && MOMO.search.init) MOMO.search.init();
        if (MOMO.play && MOMO.play.init) MOMO.play.init();
        if (MOMO.tap && MOMO.tap.init) MOMO.tap.init();
        if (MOMO.library && MOMO.library.init) MOMO.library.init();
    }

    document.addEventListener('DOMContentLoaded', init);

    return { init: init, switchTab: switchTab };
})();
