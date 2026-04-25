/* MOMO Lyrics — i18n.js
 * 責務: 多言語辞書(I18N)・現在言語(curLang)管理・applyLang()のDOM反映。
 *       4言語対応: ja / en / zh / cat (CATは動的猫語生成)
 * 対応: 多言語仕様 i18n-spec-v1.0.md / cat-lang-spec.txt (要件: 全要件の表示切替)
 */

(function () {
    'use strict';

    window.MOMO = window.MOMO || {};
    MOMO.state = MOMO.state || {};
    MOMO.i18n = MOMO.i18n || {};

    const I18N = {
        ja: {
            breadcrumb: "MOMO Lyrics",
            headerSub: "LRCLIB APIを利用した同期歌詞(.lrc)の取得・保存ツール",
            tabFolder: "フォルダ一括処理",
            tabSearch: "個別検索保存",
            tabPlay: "プレイ",
            folderLabel: "フォルダ一括処理",
            folderDesc: "選択したフォルダ内の音楽ファイル(MP3/M4A/FLAC)を解析し、歌詞を自動保存します。",
            startBtn: "フォルダを選択して開始",
            searchLabel: "個別検索・保存",
            playLabel: "プレイモード",
            logInitMsg: "待機中... フォルダを選択してください。",
            searchInitMsg: "キーワードを入力して検索してください。",
            searchPlaceholder: "曲名 アーティスト名",
            searchBtn: "検索",
            footerBack: "← MOMO Works に戻る",
            startMsg: "処理を開始しました。",
            fileCount: "対象ファイル: {n} 件",
            waiting: "5秒待機中...",
            finishMsg: "すべての処理が終了しました。",
            searching: "検索中...",
            noResults: "歌詞が見つかりませんでした。",
            saveBtn: "保存",
            previewBtn: "プレビュー",
            previewOpenBtn: "プレビュー▼",
            previewCloseBtn: "プレビュー▲",
            anal: "解析: ",
            found: "保存: ",
            fail: "未検出",
            skipExisting: "スキップ: 既存 ",
            addInfoLabel: "曲名・アーティスト情報を0秒に追加",
            registerLibrary: "音楽フォルダを登録",
            openLibrary: "ライブラリを開く",
            changeLibrary: "変更",
            openHint: "※音楽ライブラリのルートフォルダを登録すると、フォルダツリーから歌詞(.lrc/.txt)を選んで開けます。同名の音源は自動的に読み込まれます。",
            libEmpty: "(空)",
            libPermDenied: "ライブラリへのアクセスが拒否されました。",
            chooseAudio: "音源ファイルを選択",
            historyEmpty: "ダウンロード済み歌詞はここに表示されます",
            labelGlobalOffset: "全体オフセット(ms):",
            labelCurrentLine: "現在行:",
            labelSaveAsOffsetTag: "offsetタグとして保存(互換性のあるプレイヤー用)",
            saveBtn2: "保存",
            saved: "保存しました",
            saveFailed: "保存失敗",
            confirmOverwrite: "「{name}」を上書きします。よろしいですか?",
            discardChanges: "未保存の変更があります。破棄して切り替えますか?",
            tapBtn: "TAP",
            undoTap: "Undo",
            tapProgress: "{cur} / {total} 行",
            diffTitle: "未保存の変更",
            diffOffset: "全体オフセット: {v}ms",
            diffLines: "タイミング変更行: {n} 行",
            diffNone: "変更なし",
            infoTitlePh: "曲名",
            infoArtistPh: "アーティスト",
            addInfoBtn: "追加",
            searchPlaceholderV13: "曲名 / アーティスト",
            disableBtn: "無効化",
            confirmDisable: "「{name}」を空ファイルで上書き（無効化）します。よろしいですか?",
            disabled: "無効化しました"
        },
        en: {
            breadcrumb: "MOMO Lyrics",
            headerSub: "Fetch and save .lrc lyrics via LRCLIB API",
            tabFolder: "Batch Processing",
            tabSearch: "Manual Search",
            tabPlay: "Play",
            folderLabel: "Folder Batch Processing",
            folderDesc: "Analyze audio files in the selected folder and auto-save lyrics.",
            startBtn: "Select Folder & Start",
            searchLabel: "Manual Lyrics Search",
            playLabel: "Play Mode",
            logInitMsg: "Waiting... Please select a folder.",
            searchInitMsg: "Enter a keyword to search.",
            searchPlaceholder: "Title, Artist",
            searchBtn: "Search",
            footerBack: "← Back to MOMO Works",
            startMsg: "Process started.",
            fileCount: "Files found: {n}",
            waiting: "Waiting 5s...",
            finishMsg: "All completed.",
            searching: "Searching...",
            noResults: "Not found.",
            saveBtn: "Save",
            previewBtn: "Preview",
            previewOpenBtn: "Preview ▼",
            previewCloseBtn: "Preview ▲",
            anal: "Analyzing: ",
            found: "Saved: ",
            fail: "Not Found",
            skipExisting: "Skipped: Exists ",
            addInfoLabel: "Add title/artist info at 0s",
            registerLibrary: "Register music folder",
            openLibrary: "Open library",
            changeLibrary: "Change",
            openHint: "Register your music library root folder. You can then pick lyrics (.lrc/.txt) from the folder tree, and matching audio files are loaded automatically.",
            libEmpty: "(empty)",
            libPermDenied: "Access to the library was denied.",
            chooseAudio: "Choose audio file",
            historyEmpty: "Downloaded lyrics will appear here",
            labelGlobalOffset: "Global offset (ms):",
            labelCurrentLine: "Current line:",
            labelSaveAsOffsetTag: "Save as offset tag (for compatible players)",
            saveBtn2: "Save",
            saved: "Saved",
            saveFailed: "Save failed",
            confirmOverwrite: "Overwrite \"{name}\"?",
            discardChanges: "You have unsaved changes. Discard and switch?",
            tapBtn: "TAP",
            undoTap: "Undo",
            tapProgress: "{cur} / {total} lines",
            diffTitle: "Unsaved changes",
            diffOffset: "Global offset: {v}ms",
            diffLines: "Retimed lines: {n}",
            diffNone: "No changes",
            infoTitlePh: "Title",
            infoArtistPh: "Artist",
            addInfoBtn: "Add",
            searchPlaceholderV13: "Title / Artist",
            disableBtn: "Disable",
            confirmDisable: "Overwrite \"{name}\" with an empty file (disable)?",
            disabled: "Disabled"
        },
        zh: {
            breadcrumb: "MOMO Lyrics",
            headerSub: "利用 LRCLIB API 获取并保存 .lrc 歌词",
            tabFolder: "文件夹批量处理",
            tabSearch: "手动搜索保存",
            tabPlay: "播放",
            folderLabel: "文件夹批量处理",
            folderDesc: "解析所选文件夹中的音频文件并自动保存歌词。",
            startBtn: "选择文件夹并开始",
            searchLabel: "手动搜索・保存",
            playLabel: "播放模式",
            logInitMsg: "等待中... 请选择文件夹。",
            searchInitMsg: "请输入关键词进行搜索。",
            searchPlaceholder: "歌名、歌手名",
            searchBtn: "搜索",
            footerBack: "← 返回 MOMO Works",
            startMsg: "已开始处理。",
            fileCount: "目标文件: {n} 件",
            waiting: "等待5秒...",
            finishMsg: "处理完成。",
            searching: "正在搜索...",
            noResults: "未找到歌词。",
            saveBtn: "保存",
            previewBtn: "预览",
            previewOpenBtn: "预览▼",
            previewCloseBtn: "预览▲",
            anal: "解析: ",
            found: "保存: ",
            fail: "未找到",
            skipExisting: "跳过: 已存在 ",
            addInfoLabel: "在0秒位置添加歌名・歌手信息",
            registerLibrary: "注册音乐文件夹",
            openLibrary: "打开音乐库",
            changeLibrary: "更改",
            openHint: "注册音乐库根文件夹后，可从文件夹树中选择歌词(.lrc/.txt)文件。同名音频文件会自动加载。",
            libEmpty: "(空)",
            libPermDenied: "音乐库访问被拒绝。",
            chooseAudio: "选择音频文件",
            historyEmpty: "下载的歌词将显示在这里",
            labelGlobalOffset: "全体偏移量(ms):",
            labelCurrentLine: "当前行:",
            labelSaveAsOffsetTag: "保存为 offset 标签(用于兼容播放器)",
            saveBtn2: "保存",
            saved: "已保存",
            saveFailed: "保存失败",
            confirmOverwrite: "覆盖「{name}」吗?",
            discardChanges: "有未保存的更改。放弃并切换吗?",
            tapBtn: "TAP",
            undoTap: "撤销",
            tapProgress: "{cur} / {total} 行",
            diffTitle: "未保存的更改",
            diffOffset: "全体偏移量: {v}ms",
            diffLines: "时间更改行: {n} 行",
            diffNone: "无更改",
            infoTitlePh: "歌名",
            infoArtistPh: "歌手",
            addInfoBtn: "添加",
            searchPlaceholderV13: "歌名 / 歌手",
            disableBtn: "禁用",
            confirmDisable: "用空文件覆盖「{name}」(禁用)吗?",
            disabled: "已禁用"
        }
    };

    // CAT(猫語)モード: 動的生成で辞書を持たない (cat-lang-spec.txt 3-1参照)
    // エラー系/待機系/その他の3種に分類し、ベース言語(catBase)により語彙を切替
    const ERROR_KEYS = new Set([
        'fail', 'noResults', 'saveFailed'
    ]);
    const CALM_KEYS = new Set([
        'waiting', 'searching', 'logInitMsg', 'searchInitMsg', 'historyEmpty', 'startMsg', 'anal'
    ]);

    function catSpeak(key, base) {
        let vocab;
        if (base === 'en') {
            if (ERROR_KEYS.has(key)) vocab = ['HISS!', 'SPIT!', 'FSSST!'];
            else if (CALM_KEYS.has(key)) vocab = ['purrrr...', 'mrrr...', 'prrr...'];
            else vocab = ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'];
        } else if (base === 'zh') {
            if (ERROR_KEYS.has(key)) vocab = ['喵!', '咪!', '喵喵!'];
            else if (CALM_KEYS.has(key)) vocab = ['咕噜咕噜…', '咪…', '呼噜…'];
            else vocab = ['喵', '喵喵', '咪', '喵!'];
        } else {
            if (ERROR_KEYS.has(key)) vocab = ['シャー!', 'フーッ!', 'シャシャシャ!'];
            else if (CALM_KEYS.has(key)) vocab = ['ごろごろ…', 'にゃ…', 'ぐるぐる…'];
            else vocab = ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ!'];
        }
        return vocab[Math.floor(Math.random() * vocab.length)];
    }

    // 現在言語（初期値は localStorage から復元）
    MOMO.state.curLang = (() => {
        try {
            const v = localStorage.getItem('momoLang');
            return ['ja', 'en', 'zh', 'cat'].includes(v) ? v : 'ja';
        } catch (e) { return 'ja'; }
    })();

    // CATモード選択前の言語を記憶（語彙切替のベースに使用）
    MOMO.state.catBase = (() => {
        try {
            const b = localStorage.getItem('momoCatBase');
            return ['ja', 'en', 'zh'].includes(b) ? b : 'ja';
        } catch (e) { return 'ja'; }
    })();

    // 現在辞書の取得: CATモードでは各アクセス時に動的生成、他言語は静的
    function get() {
        const lang = MOMO.state.curLang;
        if (lang === 'cat') {
            // 動的 Proxy：プロパティアクセスのたびに catSpeak() を呼ぶ
            // プレースホルダ({n}/{name}等)は含まないため置換もそのまま動作する
            const base = MOMO.state.catBase;
            return new Proxy({}, {
                get(target, prop) {
                    if (typeof prop !== 'string') return undefined;
                    return catSpeak(prop, base);
                }
            });
        }
        return I18N[lang] || I18N.ja;
    }

    // 言語適用（各DOM要素のテキストを更新）
    function apply() {
        const d = get();
        const setText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('breadcrumb-current', d.breadcrumb);
        setText('header-sub', d.headerSub);
        setText('tab-folder', d.tabFolder);
        setText('tab-search', d.tabSearch);
        setText('tab-play', d.tabPlay);
        setText('folder-label', d.folderLabel);
        setText('folder-desc', d.folderDesc);
        setText('startBtn', d.startBtn);
        setText('search-label', d.searchLabel);
        setText('play-label', d.playLabel);
        setText('log-init-msg', d.logInitMsg);
        setText('search-init-msg', d.searchInitMsg);
        const q = document.getElementById('query');
        if (q) q.placeholder = d.searchPlaceholder;
        setText('searchBtn', d.searchBtn);
        setText('footer-back', d.footerBack);
        setText('label-add-info-folder', d.addInfoLabel);
        setText('label-add-info-search', d.addInfoLabel);
        // v1.13: プレイ画面トグルは削除済み(label-add-info-play は存在しない)
        // 新UI要素
        const titleInput = document.getElementById('info-title-input');
        const artistInput = document.getElementById('info-artist-input');
        if (titleInput) titleInput.placeholder = d.infoTitlePh || 'Title';
        if (artistInput) artistInput.placeholder = d.infoArtistPh || 'Artist';
        setText('addInfoBtn', d.addInfoBtn || 'Add');
        const qInput = document.getElementById('query');
        if (qInput && d.searchPlaceholderV13) qInput.placeholder = d.searchPlaceholderV13;
        // v1.17: ライブラリ登録ボタン群
        setText('registerLibraryBtn', d.registerLibrary);
        setText('openLibraryBtn', d.openLibrary);
        setText('changeLibraryBtn', d.changeLibrary);
        setText('open-hint', d.openHint);
        setText('chooseAudioBtn', d.chooseAudio);
        setText('history-empty-msg', d.historyEmpty);
        setText('label-global-offset', d.labelGlobalOffset);
        setText('label-current-line', d.labelCurrentLine);
        setText('label-save-as-offset-tag', d.labelSaveAsOffsetTag);
        setText('saveLyricsBtn', d.saveBtn2);
        setText('tapBtn', d.tapBtn);
        setText('undoTapBtn', d.undoTap);

        // select の value を現在言語に合わせる
        const sel = document.getElementById('lang-select');
        if (sel) sel.value = MOMO.state.curLang;

        // html lang 属性を更新（アクセシビリティ）
        document.documentElement.lang =
            MOMO.state.curLang === 'zh' ? 'zh-Hans' :
            MOMO.state.curLang === 'cat' ? (MOMO.state.catBase === 'zh' ? 'zh-Hans' : MOMO.state.catBase) :
            MOMO.state.curLang;

        // 動的描画が必要なビューを再描画
        if (MOMO.play && typeof MOMO.play.renderHistoryList === 'function') {
            MOMO.play.renderHistoryList();
        }
        if (MOMO.tap && typeof MOMO.tap.updateTapProgress === 'function') {
            MOMO.tap.updateTapProgress();
        }
        if (MOMO.play && typeof MOMO.play.updateDiffBanner === 'function') {
            MOMO.play.updateDiffBanner();
        }
    }

    // 言語切替ハンドラ（<select> からも app.js からも使う想定）
    function setLang(lang) {
        if (!['ja', 'en', 'zh', 'cat'].includes(lang)) return;
        // CAT 選択時は直前言語を catBase に保存
        if (lang === 'cat' && MOMO.state.curLang !== 'cat') {
            MOMO.state.catBase = MOMO.state.curLang;
            try { localStorage.setItem('momoCatBase', MOMO.state.catBase); } catch (e) {}
        }
        MOMO.state.curLang = lang;
        try { localStorage.setItem('momoLang', lang); } catch (e) {}
        apply();
    }

    MOMO.i18n.I18N = I18N;
    MOMO.i18n.get = get;
    MOMO.i18n.apply = apply;
    MOMO.i18n.setLang = setLang;
})();
