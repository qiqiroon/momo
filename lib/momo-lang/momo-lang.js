// MOMO Works 共通 言語ルーチン（案件⑦）
//   全アプリ共通の「言語の自動判定・モード管理・保存ルール」を1か所に集約する。
//   ここを直せば全アプリの言語切り替えロジックが直る（各アプリに同じコードを置かない）。
//
//   組み込み: 各 .html の <head> 内、アプリ本体スクリプトより前に1行
//     <script src="/momo/lib/momo-lang/momo-lang.js"></script>
//   （defer不可: 起動時の初期言語決定に同期的に使うため、本体スクリプトより先に実行させる）
//
//   v1.11: モード（autoを含む）と CAT 系統(にゃあ/meow/喵)をアプリ間で引き継ぐ。
//          アプリが「自分の対応言語セット」を宣言できる仕組みを追加（任意）。詳細は readme 参照。
//   v1.10: detect() を navigator.languages(希望言語の並び) 対応に。多言語設定の取りこぼしを防ぐ。（旧表記 v1.1）
//   v1.00: 初版。Links が最初の採用アプリ。（旧表記 v1.0）
//
//   設計:
//   - モードは全アプリ共通の共有キー `momoLang_mode` で管理する（auto/具体言語/cat を全部入れる）。
//     どのアプリで切り替えても他アプリが追従する＝アプリ間で同じ選択が引き継がれる。
//   - アプリは任意で `MomoLang.bind(appId, {supportedLangs, detectMap, fallback})` を呼んで
//     自分の対応言語セットを宣言できる。未宣言なら MOMO 標準 4 言語(ja/en/zh/cat)扱い。
//   - 共有モードが自分のセットに無ければ auto に倒す＝未対応値の安全弁。
//   - CAT 系統の基準言語は共有キー `momoCatBase` で引き継ぐ。
//     ・CAT を選んだ瞬間のモードが具体言語なら catBase に書く（他アプリも同じ系統に揃う）。
//     ・auto 由来や未設定なら catBase をクリア（他アプリでは各端末の auto-猫語になる）。
//   - 旧共有キー `momoLang` は karaoke 互換のため「明示言語(auto/cat以外)のみ」書き続ける。
//     karaoke はこのキーを直接読む旧コードのまま、後退しない。
//   - 旧 per-app キー(`momolang_mode_<appId>`)は引っ越し参照用としてのみ読む
//     （共有モードが空のときの一回限りの代替）。setMode は引き続きこのキーにも書く。

(function () {
  var VERSION = '1.11';
  if (window.MomoLang && window.MomoLang.VERSION === VERSION) return;

  // ── 既定（MOMO 標準）
  var DEFAULT_LANGS = ['ja', 'en', 'zh', 'cat'];
  // detectMap: [[ブラウザ言語の prefix(小文字), 採用する言語コード], ...]
  var DEFAULT_DETECT = [['ja', 'ja'], ['zh', 'zh'], ['en', 'en']];
  var DEFAULT_FALLBACK = 'en';

  var KEY_MODE_SHARED     = 'momoLang_mode';    // 新: モード共有
  var KEY_CATBASE_SHARED  = 'momoCatBase';      // 新: CAT 系統の基準言語共有
  var KEY_LEGACY_MOMOLANG = 'momoLang';         // 旧: karaoke 互換（明示言語のみ書く）

  function modeKeyPerApp(appId) { return 'momolang_mode_' + (appId || 'app'); }

  // ── アプリ宣言レジストリ（任意。未宣言なら既定 4 言語扱い）
  var registry = {};

  function getOpts(appId) {
    return (appId && registry[appId]) || {
      supportedLangs: DEFAULT_LANGS,
      detectMap: DEFAULT_DETECT,
      fallback: DEFAULT_FALLBACK
    };
  }

  function bind(appId, opts) {
    if (!appId) return;
    opts = opts || {};
    var langs = (opts.supportedLangs && opts.supportedLangs.length)
                ? opts.supportedLangs.slice()
                : DEFAULT_LANGS.slice();
    var dmap;
    if (opts.detectMap && opts.detectMap.length) {
      dmap = opts.detectMap.slice();
    } else {
      // 既定 detectMap を、宣言セットに含まれる言語だけに絞る
      dmap = DEFAULT_DETECT.filter(function (p) { return langs.indexOf(p[1]) >= 0; });
    }
    var fallback = opts.fallback || DEFAULT_FALLBACK;
    if (langs.length > 0 && langs.indexOf(fallback) < 0) {
      var nonCat = langs.filter(function (l) { return l !== 'cat'; });
      fallback = nonCat.length ? nonCat[0] : langs[0];
    }
    registry[appId] = {
      supportedLangs: langs,
      detectMap: dmap,
      fallback: fallback
    };
  }

  // ── 自動判定（navigator.languages 希望順に走査、アプリのセットに含まれる最初の言語を採用）
  function detect(appId) {
    var opts = getOpts(appId);
    try {
      var list = (navigator.languages && navigator.languages.length)
                 ? navigator.languages
                 : [navigator.language || navigator.userLanguage || 'en'];
      for (var i = 0; i < list.length; i++) {
        var l = (list[i] || '').toLowerCase();
        for (var j = 0; j < opts.detectMap.length; j++) {
          var prefix = (opts.detectMap[j][0] || '').toLowerCase();
          var code = opts.detectMap[j][1];
          if (prefix && l.indexOf(prefix) === 0 && opts.supportedLangs.indexOf(code) >= 0) {
            return code;
          }
        }
      }
    } catch (e) {}
    return opts.fallback;
  }

  // ── モード取得（auto/具体言語/cat のいずれかを返す。アプリのセットで検証）
  //   共有 momoLang_mode を優先。空または無効値なら旧 per-app キーへ引っ越し参照。両方無ければ auto。
  function getMode(appId) {
    var opts = getOpts(appId);
    var validModes = ['auto'].concat(opts.supportedLangs);
    var m;
    try { m = localStorage.getItem(KEY_MODE_SHARED); } catch (e) {}
    if (m && validModes.indexOf(m) >= 0) return m;
    try { m = localStorage.getItem(modeKeyPerApp(appId)); } catch (e) {}
    if (m && validModes.indexOf(m) >= 0) return m;
    return 'auto';
  }

  // ── CAT 表示時の基準言語（にゃあ/meow/喵 を決める）
  //   共有 momoCatBase をアプリの「CAT 以外のセット」で検証して採用。
  //   空または未対応なら自動判定にフォールバック（＝AUTO-猫語）。
  function getCatBase(appId) {
    var opts = getOpts(appId);
    var nonCat = opts.supportedLangs.filter(function (l) { return l !== 'cat'; });
    var cb;
    try { cb = localStorage.getItem(KEY_CATBASE_SHARED); } catch (e) {}
    if (cb && nonCat.indexOf(cb) >= 0) return cb;
    return detect(appId);
  }

  // ── 実際の表示言語を解決（具体コード ja/en/zh/cat/... を返す）
  //   CAT 非対応のアプリで mode=cat が来た場合は catBase の言語に倒す。
  function resolve(appId) {
    var opts = getOpts(appId);
    var mode = getMode(appId);
    if (mode === 'auto') return detect(appId);
    if (mode === 'cat') {
      if (opts.supportedLangs.indexOf('cat') >= 0) return 'cat';
      return getCatBase(appId);
    }
    return mode;
  }

  // ── モード設定（保存ルール一式）。返す値は表示言語（resolve と同等）。
  function setMode(appId, mode) {
    var opts = getOpts(appId);
    var validModes = ['auto'].concat(opts.supportedLangs);
    if (validModes.indexOf(mode) < 0) mode = 'auto';

    // CAT 切替時の catBase 反映：
    //   直前モードが具体言語 → catBase に書く（他アプリで同じ系統を再現）。
    //   直前モードが auto or 空 → catBase をクリア（他アプリでは各端末の auto-猫語）。
    //   直前モードが cat（連打）→ catBase はそのまま保持。
    if (mode === 'cat') {
      var prev;
      try { prev = localStorage.getItem(KEY_MODE_SHARED); } catch (e) {}
      if (!prev) {
        try { prev = localStorage.getItem(modeKeyPerApp(appId)); } catch (e) {}
      }
      if (prev && prev !== 'auto' && prev !== 'cat') {
        try { localStorage.setItem(KEY_CATBASE_SHARED, prev); } catch (e) {}
      } else if (prev !== 'cat') {
        try { localStorage.removeItem(KEY_CATBASE_SHARED); } catch (e) {}
      }
    }

    try { localStorage.setItem(KEY_MODE_SHARED, mode); } catch (e) {}
    try { localStorage.setItem(modeKeyPerApp(appId), mode); } catch (e) {}
    if (mode !== 'auto' && mode !== 'cat') {
      try { localStorage.setItem(KEY_LEGACY_MOMOLANG, mode); } catch (e) {}
    }

    return resolve(appId);
  }

  window.MomoLang = {
    VERSION: VERSION,
    LANGS: DEFAULT_LANGS,                       // 既定セット（互換目的で公開）
    MODES: ['auto'].concat(DEFAULT_LANGS),      // 既定モード（互換目的で公開）
    bind: bind,
    detect: detect,
    getMode: getMode,
    getCatBase: getCatBase,
    resolve: resolve,
    setMode: setMode
  };
})();
