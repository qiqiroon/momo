// MOMO Works 共通アクセス解析
//   仕様: L:\momo\works\docs\access analysis\momo-works-analytics-setup.md (v1.0)
//   - GoatCounter: 全ユーザー (中国含む) を軽量タグで計測
//   - GA4:         中国以外のユーザーのみ (タイムゾーン判定 + 2 秒タイムアウトの二段構え)
//
//   組み込み: 各 .html の </head> 直前に
//     <script src="/momo/lib/momo-analytics.js" defer></script>
//   と書くだけ。 GitHub Pages のリポ root が /momo/ なのでこの絶対パスで OK。
//
//   注: タグ自体は何度書いても害は無いが (GoatCounter は二重カウントしない)、
//        重複ロードはしないこと。

(function () {
  // 二重実行ガード
  if (window.__momoAnalyticsLoaded) return;
  window.__momoAnalyticsLoaded = true;

  // ===== 第 1 タグ: GoatCounter (全ユーザー、 中国含む) =====
  var gc = document.createElement('script');
  gc.setAttribute('data-goatcounter', 'https://momoworks.goatcounter.com/count');
  gc.async = true;
  gc.src = '//gc.zgo.at/count.js';
  document.head.appendChild(gc);

  // ===== 第 2 タグ: GA4 (中国以外のユーザーのみ) =====
  // 第 1 段: タイムゾーン判定で中国を除外
  var tz = '';
  try { tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || ''; } catch (e) {}
  var isLikelyChina =
    tz.indexOf('Shanghai')   !== -1 ||
    tz.indexOf('Urumqi')     !== -1 ||
    tz.indexOf('Chongqing')  !== -1 ||
    tz.indexOf('Harbin')     !== -1;
  if (isLikelyChina) return;

  // 第 2 段: 非同期読み込み + 2 秒タイムアウト (VPN 利用者等、 第 1 段をすり抜けたケース)
  var loaded = false;
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-0B36TB5S82';
  script.onload = function () {
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    function gtag () { dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', 'G-0B36TB5S82');
  };
  setTimeout(function () {
    if (!loaded && script.parentNode) {
      script.parentNode.removeChild(script);
    }
  }, 2000);
  document.head.appendChild(script);
})();
