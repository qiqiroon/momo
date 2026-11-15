// MOMO Works 共通：評価の星（説明欄の中に「このアプリを評価する」・ゲームの終わりに「評価する」（最初の1回と、評価していなければ5回に1回））
//   設計: works/docs/guidelines/momo-works-star-rating-proposal-v0_03.md（2026-11-08）
//
//   ページの作り（momo-about.js の後に読む）:
//     <script type="application/json" id="momo-rating-data">{"app":"games/hanoi","avg":4.3,"count":12}</script>
//       … 公開のたびに道具で最新の平均と件数を書き込む（件数0なら avg:0,count:0）
//     <script src="/momo/lib/momo-rating.js"></script>
//
//   ゲームの終わり（勝敗が付いた後など）で:  if (window.MomoRating) MomoRating.prompt()
//     … 窓口につながると分かっている端末で、まだ評価していないときだけ小さく出す。
//       最初にゲームが終わったときに出し、そのあとも評価していなければ、ゲームが終わる5回に1回また出す（2026-11-15 利用者）
//
//   決まり（設計 §5）
//     - 星と件数は、件数1以上なら説明欄の見出しの行にいつも出す（つながらない人にも）
//     - ページの load の後に裏で窓口へ尋ね、5秒以内に返事があった端末にだけ評価の欄を出す。待つ間は何も出さない
//     - つながらなかったことを1日覚え、その間は尋ねない
//     - 自分の評価は端末に覚えて「あなたの評価：★4」と出す。付け直しは上書き
//     - 作り手の端末（URL の末尾に #momo-rating-owner を付けて一度開く）には欄を出さない。#momo-rating-owner=off で戻す
//     - お礼や見返りの言葉は付けない（Google の決まり）
//
//   調べる道具（2026-11-15 追加）
//     - 窓口への問い合わせ・促しを出した／出さなかった理由を、端末に最新30件まで記録する（いつも）
//     - ほかのアプリと同じく、URL に ?debug=1 を付けて開いたときだけデバッグモード（その1回だけ。覚えない）。
//       画面の上に記録と今の状態を出し、「つながらなかったので1日は尋ねない」の待ちを省いて毎回尋ねる
//       （billiards・darts・cosmos は自分の ?debug=1 の道具も同時に出る）
(function () {
  if (window.MomoRating) return;

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbw06bAPyYI_T9_zAOJq1_virSTkFNwI7Eck0Z7i8Tq9ROxFiAth7uLK-KaW2EkvYAyP9Q/exec';
  var TIMEOUT_MS = 5000;
  var FAIL_KEEP_MS = 24 * 60 * 60 * 1000;
  var K_DEVICE = 'momoRatingDevice';
  var K_FAIL = 'momoRatingFailAt';
  var K_OWNER = 'momoRatingOwner';
  var K_MINE = 'momoRating:';       // + app → {"star":4,"name":"","comment":"","at":…}
  var K_PROMPTED = 'momoRatingPrompted:'; // + app → "1"（一度出した）
  var K_ENDS = 'momoRatingEnds:';         // + app → 前に出してから終わったゲームの数
  var REPROMPT_EVERY = 5;                 // 評価していない人に、ゲームが終わる何回に1回また出すか
  var K_LOG = 'momoRatingLog';            // [{t, m}] 最新30件
  var LOG_MAX = 30;

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

  // ---- 調べる道具：記録とデバッグの窓 ----
  function isDebug() { return /[?&]debug=1(&|$)/.test(location.search); }
  function pad(n) { return ('0' + n).slice(-2); }
  function hm(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function logs() { try { var a = JSON.parse(get(K_LOG) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function log(m) {
    var a = logs();
    a.push({ t: Date.now(), m: (C && C.app ? '[' + C.app + '] ' : '') + m });
    if (a.length > LOG_MAX) a = a.slice(a.length - LOG_MAX);
    set(K_LOG, JSON.stringify(a));
    renderDebug();
  }

  var dbgHidden = false;
  function stateLines() {
    var failAt = Number(get(K_FAIL) || 0);
    var left = failAt ? FAIL_KEEP_MS - (Date.now() - failAt) : 0;
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var m = C ? mine() : null;
    return [
      'アプリ：' + (C ? C.app : '（設定 momo-rating-data が無い）'),
      '開き方：' + (standalone ? 'ホーム画面のアプリ' : 'ブラウザ') + '／回線：' + (navigator.onLine === false ? 'オフライン' : 'オンライン'),
      '窓口：' + (reachable ? 'つながった' : 'つながっていない') +
        (failAt ? '／前につながらなかった ' + hm(failAt) + (left > 0 ? '（あと' + Math.ceil(left / 60000) + '分は尋ねない）' : '（もう尋ねる）') : ''),
      '作り手の印：' + (isOwner() ? 'あり（促しは出ない）' : 'なし'),
      '自分の評価：' + (m ? '★' + m.star + '（促しは出ない）' : 'なし'),
      '促し：' + (C && get(K_PROMPTED + C.app) ? '一度出した／その後の終わり ' + (Number(get(K_ENDS + C.app)) || 0) + '回（' + REPROMPT_EVERY + '回目で出す）' : 'まだ出していない（次の終わりで出す）'),
      '端末：' + navigator.userAgent,
    ];
  }

  function renderDebug() {
    if (!isDebug() || dbgHidden || !document.body) return;
    var box = document.getElementById('momo-rating-debug');
    if (!box) {
      box = document.createElement('div');
      box.id = 'momo-rating-debug';
      box.style.cssText = 'position:fixed;left:6px;right:6px;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:2147483001;max-height:55vh;overflow:auto;' +
        'padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.88);color:#cfe;border:1px solid #4a6;font:11px/1.45 ui-monospace,Menlo,monospace;' +
        'white-space:pre-wrap;word-break:break-all;-webkit-text-size-adjust:100%;';
      box.addEventListener('click', function (e) {
        var a = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (a === 'check') { reachable = false; check(true); }
        else if (a === 'prompt') { showToast(); log('試しに促しを出した（数えには入れない）'); }
        else if (a === 'clear') { del(K_LOG); renderDebug(); }
        else if (a === 'hide') { dbgHidden = true; box.parentNode && box.parentNode.removeChild(box); }
      });
      document.body.appendChild(box);
    }
    var btn = function (act, label) {
      return '<button type="button" data-act="' + act + '" style="font:inherit;margin:4px 4px 0 0;padding:3px 8px;border-radius:5px;border:1px solid #4a6;background:#132;color:#cfe;">' + label + '</button>';
    };
    var L = logs().slice().reverse();
    box.innerHTML =
      '<b style="color:#8f8">評価の部品・デバッグ</b>\n' + esc(stateLines().join('\n')) + '\n' +
      btn('check', '今すぐ問い合わせ直す') + btn('prompt', '促しを試しに出す') + btn('clear', '記録を消す') +
      btn('hide', '閉じる') +
      '\n<b style="color:#8f8">記録（新しい順）</b>\n' +
      (L.length ? esc(L.map(function (x) { return hm(x.t) + '  ' + x.m; }).join('\n')) : '（まだ無い）');
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

  // 窓口に尋ねる。どこで・なぜ失敗したかを記録に残す（force はデバッグの「問い合わせ直す」）
  function check(force) {
    var failAt = Number(get(K_FAIL) || 0);
    if (!force && isDebug() && failAt && Date.now() - failAt < FAIL_KEEP_MS) log('デバッグモードなので、1日の待ちを省いて尋ねる');
    else if (!force && failAt && Date.now() - failAt < FAIL_KEEP_MS) {
      log('問い合わせを省いた：' + hm(failAt) + ' につながらなかったので、あと' +
        Math.ceil((FAIL_KEEP_MS - (Date.now() - failAt)) / 60000) + '分は尋ねない');
      return;
    }
    var t0 = Date.now(), stage = '返事の頭を待つ間', timedOut = false;
    log('窓口へ問い合わせ開始' + (force ? '（手動）' : '') + (navigator.onLine === false ? '（端末はオフライン）' : ''));
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var opt = { method: 'GET', cache: 'no-store' };
    if (ctl) opt.signal = ctl.signal;
    fetch(ENDPOINT, opt).then(function (r) {
      stage = '中身を読む間（HTTP ' + r.status + '、頭まで ' + (Date.now() - t0) + 'ms）';
      return r.text();
    }).then(function (txt) {
      clearTimeout(timer);
      var j;
      try { j = JSON.parse(txt); } catch (e) { throw { why: '返事が JSON でない（' + stage + '、先頭：' + txt.slice(0, 80).replace(/\s+/g, ' ') + '）' }; }
      if (!j || !j.ok) throw { why: '返事に ok が無い（' + txt.slice(0, 80) + '）' };
      del(K_FAIL);
      reachable = true;
      apply(j.ratings);
      decorate();
      log('つながった：' + (Date.now() - t0) + 'ms' + (timedOut ? '（' + TIMEOUT_MS / 1000 + '秒を過ぎてから）' : ''));
    }).catch(function (e) {
      clearTimeout(timer);
      var why = e && e.why ? e.why
        : timedOut ? TIMEOUT_MS / 1000 + '秒以内に返事が来なかった（' + stage + 'で打ち切り）'
        : '通信の失敗（' + stage + '）：' + (e && (e.name || '') + ' ' + (e.message || e));
      set(K_FAIL, String(Date.now()));
      log('つながらなかった：' + why + '（' + (Date.now() - t0) + 'ms）。このあと1日は尋ねない');
    });
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
      }).catch(function (e) {
        log('評価を送れなかった：' + (e && (e.name || '') + ' ' + (e.message || e)));
        done(false);
      });
  }

  // ---- ゲームの終わりに1回だけ ----
  function prompt() {
    if (!C) return;
    var no = !reachable ? '窓口につながっていない' : isOwner() ? '作り手の印がある' : mine() ? '評価済み'
      : document.querySelector('.momo-rating-toast') ? 'すでに出ている' : '';
    if (no) { log('ゲームの終わり：促しを出さない（' + no + '）'); return; }
    if (get(K_PROMPTED + C.app)) {
      var ends = (Number(get(K_ENDS + C.app)) || 0) + 1;
      if (ends < REPROMPT_EVERY) {
        set(K_ENDS + C.app, String(ends));
        log('ゲームの終わり：促しを出さない（前に出してから ' + ends + '回目。' + REPROMPT_EVERY + '回目で出す）');
        return;
      }
    }
    set(K_PROMPTED + C.app, '1');
    set(K_ENDS + C.app, '0');
    log('ゲームの終わり：促しを出した');
    showToast();
  }

  function showToast() {
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
    renderDebug();
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
