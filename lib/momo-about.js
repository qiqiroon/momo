// MOMO Works 共通：折りたたみの説明欄（「MOMO 〇〇 について ▸」）
//   決まり: works/docs/guidelines/momo-works-naming-seo-v1_0.md §4（2026-11-07）
//
//   ページの作り:
//     <footer class="momo-about" id="momo-about"> … 日本語の中身（最初から HTML に書く＝検索に読ませる） … </footer>
//     <script type="application/json" id="momo-about-data">{"ja":{…},"en":{…},"zh":{…}}</script>
//     <script src="/momo/lib/momo-about.js"></script>   … <head> の中（アプリ本体より前）
//
//   言語の切り替え: アプリの言語を切り替える処理の最後で  if (window.MomoAbout) MomoAbout.apply(lang)
//     lang を省くとページの言語（<html lang>）を使う
//     lang は 'ja' | 'en' | 'zh' | 'cat'（cat のときは猫語の前の言語＝momoCatBase で出す）
//   文字は app ごとの文言データ（momo-about-data）だけを使う。この部品の中には説明文を持たない。
(function () {
  if (window.MomoAbout) return;

  var LINKS = {
    ja: ['MOMO Works トップ', 'ゲーム一覧', 'ツール一覧'],
    en: ['MOMO Works Home', 'Games', 'Tools'],
    zh: ['MOMO Works 首页', '游戏列表', '工具列表'],
  };
  var BASE = '/momo/';

  var css =
    // 幅・余白は :where で弱くする＝アプリ側の .site-footer などの決まりが勝つ（アプリの枠に幅を合わせる）
    ':where(.momo-about){display:block;width:100%;max-width:640px;margin:0 auto;padding:14px 12px 22px;box-sizing:border-box;text-align:left;}' +
    '.momo-about{color:var(--text-muted,#9a9a9a);font-size:12px;line-height:1.9;}' +
    '.momo-about details{margin:0;}' +
    '.momo-about summary{cursor:pointer;list-style:none;display:inline-block;color:var(--text-muted,#9a9a9a);font-size:12px;}' +
    '.momo-about summary::-webkit-details-marker{display:none;}' +
    '.momo-about summary::after{content:" \\25B8";}' +
    '.momo-about details[open] summary::after{content:" \\25BE";}' +
    '.momo-about summary:hover{color:var(--text,#e5e5e5);}' +
    '.momo-about .momo-about-body{padding-top:8px;}' +
    '.momo-about p{margin:0 0 10px;font-size:12px;line-height:1.9;color:var(--text-muted,#9a9a9a);}' +
    '.momo-about .momo-about-links{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;}' +
    '.momo-about .momo-about-links a{color:var(--text-muted,#9a9a9a);text-decoration:underline;}' +
    '.momo-about .momo-about-copy{margin-left:auto;}';

  function injectCss() {
    if (document.getElementById('momo-about-css')) return;
    var s = document.createElement('style');
    s.id = 'momo-about-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function data() {
    var el = document.getElementById('momo-about-data');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function baseLang(lang) {
    if (lang === 'cat') {
      var b = null;
      try { b = localStorage.getItem('momoCatBase'); } catch (e) {}
      lang = b || 'en';
    }
    return lang === 'ja' || lang === 'zh' ? lang : 'en';
  }

  // 中身（日本語の静的 HTML と同じ形）を作る
  function html(d, lang) {
    var t = d[lang] || d.ja;
    var l = LINKS[lang];
    var paras = t.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    return (
      '<details><summary>' + esc(t.title) + '</summary><div class="momo-about-body">' + paras +
      '<div class="momo-about-links"><a href="' + BASE + '">' + esc(l[0]) + '</a><a href="' + BASE + 'games/">' +
      esc(l[1]) + '</a><a href="' + BASE + 'tools/">' + esc(l[2]) + '</a><span class="momo-about-copy">© MOMO Works</span></div>' +
      '</div></details>'
    );
  }

  // lang を省くと、ページの言語（<html lang>）を使う。アプリの言語の処理の「最後」で呼ぶこと
  function pageLang() {
    var l = (document.documentElement.getAttribute('lang') || 'ja').toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh';
    if (l === 'cat') return 'cat';
    return l.slice(0, 2);
  }

  function apply(lang) {
    injectCss();
    if (!lang) lang = pageLang();
    var d = data();
    if (!d) return;
    var L = baseLang(lang);
    var hosts = document.querySelectorAll('.momo-about');
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      if (h.getAttribute('data-lang') === L && h.firstElementChild) continue;
      var open = !!(h.querySelector('details') && h.querySelector('details').open);
      h.innerHTML = html(d, L);
      if (open) h.querySelector('details').open = true;
      h.setAttribute('data-lang', L);
    }
  }

  window.MomoAbout = { apply: apply, injectCss: injectCss };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss);
  else injectCss();
})();
