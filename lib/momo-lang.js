// MOMO Works 共通 言語ルーチン（案件⑦）
//   全アプリ共通の「言語の自動判定・モード管理・保存ルール」を1か所に集約する。
//   ここを直せば全アプリの言語切り替えロジックが直る（各アプリに同じコードを置かない）。
//
//   組み込み: 各 .html の <head> 内、アプリ本体スクリプトより前に1行
//     <script src="/momo/lib/momo-lang.js"></script>
//   （defer不可: 起動時の初期言語決定に同期的に使うため、本体スクリプトより先に実行させる）
//   各アプリは自分の翻訳辞書・applyLang・言語ドロップダウンはそのまま持ち、
//   言語の「判定 / モード取得 / 切替（保存ルール）」だけ本ルーチンを呼ぶ。
//
//   設計:
//   - 言語モード = auto/ja/en/zh/cat。アプリごとにローカル保存（key: momolang_mode_<appId>、既定=auto）。
//   - auto時はブラウザ/OS言語から ja/zh/en を判定（それ以外は en。CATは自動選択しない）。
//   - 明示言語(auto以外)を選んだ時だけ全MOMO共有キー momoLang に書く＝他アプリも追従。
//     ★autoは共有に書かない（autoを共有に書くと、未対応の旧アプリが 'ja' にリセットして共有値を壊すため）。
//   - 起動の読み元は「アプリごとのローカルモード」（未設定=auto）。共有momoLangは"書くだけ・起動の読み元にしない"。
//   - 全アプリ展開後（P3）は auto を既定化しモード選択を畳む想定（その時は本ファイルだけ直せばよい）。
(function () {
  if (window.MomoLang) return;
  var LANGS = ['ja', 'en', 'zh', 'cat'];          // 実際の表示言語（catを含む）
  var MODES = ['auto', 'ja', 'en', 'zh', 'cat'];   // ドロップダウンの選択肢（autoを含む）

  function detect() {
    try {
      var l = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
      if (l.indexOf('ja') === 0) return 'ja';
      if (l.indexOf('zh') === 0) return 'zh';
      if (l.indexOf('en') === 0) return 'en';
      return 'en';
    } catch (e) { return 'en'; }
  }

  function modeKey(appId) { return 'momolang_mode_' + (appId || 'app'); }

  function getMode(appId) {
    try { var m = localStorage.getItem(modeKey(appId)); if (m && MODES.indexOf(m) >= 0) return m; } catch (e) {}
    return 'auto';
  }

  // モードから実際の表示言語(ja/en/zh/cat)を解決
  function resolve(appId) {
    var m = getMode(appId);
    return m === 'auto' ? detect() : (LANGS.indexOf(m) >= 0 ? m : detect());
  }

  // モードを切り替え→ローカル保存。明示言語のみ共有momoLangへ書く。実際の表示言語を返す。
  function setMode(appId, mode) {
    if (MODES.indexOf(mode) < 0) mode = 'auto';
    try { localStorage.setItem(modeKey(appId), mode); } catch (e) {}
    if (mode !== 'auto') { try { localStorage.setItem('momoLang', mode); } catch (e) {} }
    return mode === 'auto' ? detect() : mode;
  }

  window.MomoLang = {
    LANGS: LANGS, MODES: MODES,
    detect: detect, getMode: getMode, resolve: resolve, setMode: setMode
  };
})();
