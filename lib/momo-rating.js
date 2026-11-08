// MOMO Works 共通：評価の星（説明欄の中に「このアプリを評価する」・ゲームの終わりに1回だけ「評価する」）
//   設計: works/docs/guidelines/momo-works-star-rating-proposal-v0_03.md（2026-11-08）
//
//   ページの作り（momo-about.js の後に読む）:
//     <script type="application/json" id="momo-rating-data">{"app":"games/hanoi","avg":4.3,"count":12}</script>
//       … 公開のたびに道具で最新の平均と件数を書き込む（件数0なら avg:0,count:0）
//     <script src="/momo/lib/momo-rating.js"></script>
//
//   ゲームの終わり（勝敗が付いた後など）で:  if (window.MomoRating) MomoRating.prompt()
//     … 窓口につながると分かっている端末で、まだ評価していない・まだ出していないときだけ、1回だけ小さく出す
//
//   決まり（設計 §5）
//     - 星と件数は、件数1以上なら説明欄の見出しの行にいつも出す（つながらない人にも）
//     - ページの load の後に裏で窓口へ尋ね、5秒以内に返事があった端末にだけ評価の欄を出す。待つ間は何も出さない
//     - つながらなかったことを1日覚え、その間は尋ねない
//     - 自分の評価は端末に覚えて「あなたの評価：★4」と出す。付け直しは上書き
//     - 作り手の端末（URL の末尾に #momo-rating-owner を付けて一度開く）には欄を出さない。#momo-rating-owner=off で戻す
//     - お礼や見返りの言葉は付けない（Google の決まり）
(function () {
  if (window.MomoRating) return;

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbw06bAPyYI_T9_zAOJq1_virSTkFNwI7Eck0Z7i8Tq9ROxFiAth7uLK-KaW2EkvYAyP9Q/exec';
  var TIMEOUT_MS = 5000;
  var FAIL_KEEP_MS = 24 * 60 * 60 * 1000;
  var K_DEVICE = 'momoRatingDevice';
  var K_FAIL = 'momoRatingFailAt';
  var K_OWNER = 'momoRatingOwner';
  var K_MINE = 'momoRating:';       // + app → {"star":4,"name":"","comment":"","at":…}
  var K_PROMPTED = 'momoRatingPrompted:'; // + app → "1"

  var T = {
    ja: {
      count: function (n) { return '（' + n + '件）'; },
      head: 'このアプリを評価する',
      mine: function (s) { return 'あなたの評価：★' + s + '（付け直せます）'; },
      name: '名前（任意）', comment: 'ひとこと（任意・100字まで）', send: '送る',
      sending: '送っています…', sent: '送りました。', failed: 'いまは送れません。時間をおいてお試しください。',
      pick: '星を選んでください。', prompt: function (w) { return w + ' を評価する'; }, close: '閉じる', star: function (s) { return '★' + s; },
    },
    en: {
      count: function (n) { return ' (' + n + ')'; },
      head: 'Rate this app',
      mine: function (s) { return 'Your rating: ★' + s + ' (you can change it)'; },
      name: 'Name (optional)', comment: 'Comment (optional, up to 100 characters)', send: 'Send',
      sending: 'Sending…', sent: 'Sent.', failed: 'Cannot send right now. Please try again later.',
      pick: 'Please choose a star rating.', prompt: function (w) { return 'Rate ' + w; }, close: 'Close', star: function (s) { return s + ' star' + (s > 1 ? 's' : ''); },
    },
    zh: {
      count: function (n) { return '（' + n + '条）'; },
      head: '为此应用评分',
      mine: function (s) { return '你的评分：★' + s + '（可以修改）'; },
      name: '名字（可选）', comment: '一句话（可选，最多100字）', send: '发送',
      sending: '发送中…', sent: '已发送。', failed: '现在无法发送，请稍后再试。',
      pick: '请选择星级。', prompt: function (w) { return '为 ' + w + ' 评分'; }, close: '关闭', star: function (s) { return s + '星'; },
    },
  };

  var css =
    '.momo-rating-sum{margin-left:6px;color:#fbbf24;}' +
    '.momo-rating{margin:4px 0 12px;padding:10px 12px;border:1px solid var(--border,#2a2a2a);border-radius:8px;}' +
    '.momo-rating-head{color:var(--text,#e5e5e5);font-size:12px;margin-bottom:4px;}' +
    '.momo-rating-mine{font-size:12px;color:var(--text,#e5e5e5);margin-bottom:4px;}' +
    '.momo-rating-stars{display:flex;gap:2px;margin:2px 0 6px;}' +
    '.momo-rating-stars button{background:none;border:0;padding:0 2px;font-size:22px;line-height:1;cursor:pointer;color:#555;}' +
    '.momo-rating-stars button.on{color:#fbbf24;}' +
    '.momo-rating input,.momo-rating textarea{display:block;width:100%;box-sizing:border-box;margin:0 0 6px;padding:5px 7px;font:inherit;font-size:12px;' +
    'color:var(--text,#e5e5e5);background:var(--surface,#111);border:1px solid var(--border,#2a2a2a);border-radius:5px;}' +
    '.momo-rating textarea{resize:vertical;min-height:44px;}' +
    '.momo-rating-send{font:inherit;font-size:12px;padding:4px 14px;border-radius:5px;border:1px solid var(--border-strong,#444);' +
    'background:var(--surface2,#1a1a1a);color:var(--text,#e5e5e5);cursor:pointer;}' +
    '.momo-rating-msg{font-size:12px;margin-left:8px;color:var(--text,#e5e5e5);}' +
    '.momo-rating-toast{position:fixed;left:0;right:0;margin:0 auto;width:max-content;bottom:16px;z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 8px;' +
    'max-width:calc(100vw - 32px);box-sizing:border-box;padding:8px 10px 8px 14px;border-radius:10px;font-size:13px;' +
    'background:var(--surface2,#1a1a1a);color:var(--text,#e5e5e5);border:1px solid var(--border-strong,#444);box-shadow:0 6px 20px rgba(0,0,0,.45);}' +
    '.momo-rating-toast .momo-rating-stars{margin:0;}' +
    '.momo-rating-toast .momo-rating-x{background:none;border:0;color:var(--text,#e5e5e5);font-size:16px;cursor:pointer;padding:0 4px;}';

  // ---- 端末の記録（使えないブラウザでも止まらない） ----
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function cfg() {
    var el = document.getElementById('momo-rating-data');
    if (!el) return null;
    try { var d = JSON.parse(el.textContent); return d && d.app ? d : null; } catch (e) { return null; }
  }

  var C = null;               // {app, avg, count}
  var reachable = false;      // 窓口に5秒以内につながった
  var appName = '';

  function lang() {
    var h = document.getElementById('momo-about');
    var l = (h && h.getAttribute('data-lang')) || (document.documentElement.getAttribute('lang') || 'ja').slice(0, 2);
    return T[l] ? l : 'en';
  }

  function device() {
    var d = get(K_DEVICE);
    if (d && /^[A-Za-z0-9-]{8,64}$/.test(d)) return d;
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    d = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    set(K_DEVICE, d);
    return d;
  }

  function mine() {
    try { return JSON.parse(get(K_MINE + C.app) || 'null'); } catch (e) { return null; }
  }

  function isOwner() { return get(K_OWNER) === '1'; }

  function ownerFromHash() {
    var h = location.hash;
    if (h === '#momo-rating-owner') set(K_OWNER, '1');
    else if (h === '#momo-rating-owner=off') del(K_OWNER);
  }

  function injectCss() {
    if (document.getElementById('momo-rating-css')) return;
    var s = document.createElement('style');
    s.id = 'momo-rating-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- 説明欄の中に足す（MomoAbout.apply が中身を作り直すたびに足し直す） ----
  function decorate() {
    if (!C) return;
    var t = T[lang()];
    var hosts = document.querySelectorAll('.momo-about');
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      var sum = h.querySelector('summary');
      if (!sum) continue;
      if (!appName) appName = sum.textContent.replace(/\s*(について|关于)\s*/g, '').replace(/^About\s+/, '').replace(/★.*$/, '').trim();
      var s = sum.querySelector('.momo-rating-sum');
      if (C.count > 0) {
        if (!s) { s = document.createElement('span'); s.className = 'momo-rating-sum'; sum.appendChild(s); }
        s.textContent = '★' + (Math.round(C.avg * 10) / 10).toFixed(1) + t.count(C.count);
      } else if (s) s.parentNode.removeChild(s);

      var body = h.querySelector('.momo-about-body');
      var box = h.querySelector('.momo-rating');
      if (!reachable || isOwner() || !body) { if (box) box.parentNode.removeChild(box); continue; }
      if (box && box.getAttribute('data-lang') === lang()) continue;
      if (box) box.parentNode.removeChild(box);
      box = form(t);
      var links = body.querySelector('.momo-about-links');
      body.insertBefore(box, links || null);
    }
  }

  function starsEl(t, chosen, onPick) {
    var w = document.createElement('div');
    w.className = 'momo-rating-stars';
    for (var s = 1; s <= 5; s++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = '★';
      b.setAttribute('aria-label', t.star(s));
      b.setAttribute('data-star', s);
      w.appendChild(b);
    }
    function paint(n) {
      var bs = w.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].className = i < n ? 'on' : '';
    }
    paint(chosen || 0);
    w.addEventListener('click', function (e) {
      var n = Number(e.target && e.target.getAttribute && e.target.getAttribute('data-star'));
      if (!n) return;
      paint(n);
      onPick(n);
    });
    return w;
  }

  function form(t) {
    var m = mine();
    var chosen = m ? m.star : 0;
    var box = document.createElement('div');
    box.className = 'momo-rating';
    box.setAttribute('data-lang', lang());
    box.innerHTML =
      '<div class="momo-rating-head">' + esc(t.head) + '</div>' +
      (m ? '<div class="momo-rating-mine">' + esc(t.mine(m.star)) + '</div>' : '');
    box.appendChild(starsEl(t, chosen, function (n) { chosen = n; }));
    var name = document.createElement('input');
    name.maxLength = 30; name.placeholder = t.name; name.value = m ? m.name || '' : '';
    var com = document.createElement('textarea');
    com.maxLength = 100; com.placeholder = t.comment; com.value = m ? m.comment || '' : '';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'momo-rating-send'; btn.textContent = t.send;
    var msg = document.createElement('span');
    msg.className = 'momo-rating-msg';
    box.appendChild(name); box.appendChild(com); box.appendChild(btn); box.appendChild(msg);
    btn.addEventListener('click', function () {
      if (!chosen) { msg.textContent = t.pick; return; }
      btn.disabled = true; msg.textContent = t.sending;
      send(chosen, name.value, com.value, function (ok) {
        btn.disabled = false;
        msg.textContent = ok ? t.sent : t.failed;
        if (ok) refreshMine(box, t);
      });
    });
    return box;
  }

  function refreshMine(box, t) {
    var m = mine();
    if (!m) return;
    var el = box.querySelector('.momo-rating-mine');
    if (!el) {
      el = document.createElement('div'); el.className = 'momo-rating-mine';
      box.insertBefore(el, box.querySelector('.momo-rating-stars'));
    }
    el.textContent = t.mine(m.star);
  }

  // ---- 窓口とのやりとり ----
  function fetchWithTimeout(url, opt) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    if (ctl) opt.signal = ctl.signal;
    return fetch(url, opt).then(function (r) { clearTimeout(timer); return r.json(); },
      function (e) { clearTimeout(timer); throw e; });
  }

  function apply(ratings) {
    var r = ratings && ratings[C.app];
    C.avg = r ? r.avg : 0;
    C.count = r ? r.count : 0;
  }

  function check() {
    var failAt = Number(get(K_FAIL) || 0);
    if (failAt && Date.now() - failAt < FAIL_KEEP_MS) return;
    fetchWithTimeout(ENDPOINT, { method: 'GET', cache: 'no-store' }).then(function (j) {
      if (!j || !j.ok) throw new Error('bad');
      del(K_FAIL);
      reachable = true;
      apply(j.ratings);
      decorate();
    }).catch(function () { set(K_FAIL, String(Date.now())); });
  }

  function send(star, name, comment, done) {
    var body = JSON.stringify({ app: C.app, star: star, device: device(), name: String(name || '').trim(), comment: String(comment || '').trim(), lang: lang() });
    fetchWithTimeout(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (j) {
        if (!j || !j.ok) throw new Error(j && j.error);
        set(K_MINE + C.app, JSON.stringify({ star: star, name: String(name || '').trim(), comment: String(comment || '').trim(), at: Date.now() }));
        set(K_PROMPTED + C.app, '1');
        done(true);
        return fetchWithTimeout(ENDPOINT, { method: 'GET', cache: 'no-store' }).then(function (g) {
          if (g && g.ok) { apply(g.ratings); decorate(); }
        });
      }).catch(function () { done(false); });
  }

  // ---- ゲームの終わりに1回だけ ----
  function prompt() {
    if (!C || !reachable || isOwner()) return;
    if (mine() || get(K_PROMPTED + C.app)) return;
    if (document.querySelector('.momo-rating-toast')) return;
    set(K_PROMPTED + C.app, '1');
    var t = T[lang()];
    var bar = document.createElement('div');
    bar.className = 'momo-rating-toast';
    bar.setAttribute('role', 'dialog');
    var label = document.createElement('span');
    var who = appName || 'MOMO';
    label.textContent = t.prompt(who);
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'momo-rating-x'; x.textContent = '×'; x.setAttribute('aria-label', t.close);
    x.addEventListener('click', function () { bar.parentNode && bar.parentNode.removeChild(bar); });
    var stars = starsEl(t, 0, function (n) {
      label.textContent = t.sending;
      stars.style.pointerEvents = 'none';
      send(n, '', '', function (ok) {
        label.textContent = ok ? t.sent : t.failed;
        setTimeout(function () { bar.parentNode && bar.parentNode.removeChild(bar); }, 2500);
      });
    });
    bar.appendChild(label); bar.appendChild(stars); bar.appendChild(x);
    document.body.appendChild(bar);
  }

  function init() {
    C = cfg();
    if (!C) return;
    C.avg = Number(C.avg) || 0; C.count = Number(C.count) || 0;
    ownerFromHash();
    injectCss();
    // 説明欄が言語の切り替えで作り直されたら、足し直す
    if (window.MomoAbout && !window.MomoAbout.__rating) {
      var orig = window.MomoAbout.apply;
      window.MomoAbout.apply = function () { var r = orig.apply(this, arguments); decorate(); return r; };
      window.MomoAbout.__rating = true;
    }
    decorate();
    // 表示・操作を待たせない：load の後に尋ねる
    if (document.readyState === 'complete') setTimeout(check, 0);
    else window.addEventListener('load', function () { setTimeout(check, 0); });
  }

  window.MomoRating = { prompt: prompt };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
