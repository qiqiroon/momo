/* MOMO 1024 — 画面と操作（最小版：数字表示のみ・ズームなし・動きなし）。仕様書 v0.02 */
(function () {
  'use strict';
  var C = window.M1024Core;
  var $ = function (id) { return document.getElementById(id); };

  // §9.2 札の色 [札, 文字]
  var COLORS = [
    ['#E8E6E1', '#3A3A38'], ['#BFDBFE', '#1E3A5F'], ['#7DD3FC', '#0C3B57'], ['#5EEAD4', '#0B3D36'],
    ['#86EFAC', '#14532D'], ['#FDE047', '#4A3B00'], ['#FDBA74', '#5A2A00'], ['#F87171', '#4C0D0D'],
    ['#F472B6', '#4A0B2C'], ['#C084FC', '#2E1065'], ['#FBBF24', '#3B2300'], ['#EA580C', '#FFFFFF'],
    ['#BE123C', '#FFFFFF'], ['#7E22CE', '#FFFFFF'], ['#1E3A8A', '#FFFFFF']
  ];
  function colorOf(n) { return COLORS[n] || ['#111827', '#FFFFFF']; }
  // ── 言葉（ja / en / zh / cat）。共通の言語ライブラリ momo-lang（v1.11）に合わせる ──
  var I18N = {
    ja: {
      sizeLabel: '盤面の大きさ', spawnLabel: '出る数字：', diffLabel: '難易度',
      EASY: '小さい数字が出やすい。次の札が3個見える', NORMAL: '標準。次の札が1個見える', HARD: '大きい数字も出やすい。次の札は見えない',
      howtoTitle: '遊び方',
      howto1: '上下左右に払う（PC は矢印キー）と、盤面の札が全部その向きへ滑ります。',
      howto2: '同じ数字がぶつかると合体して倍になります。1回の動きで、1枚が合体するのは1回までです。',
      howto3: '動くたびに、空いているマスに新しい札が1枚出ます。GOAL の数字を作ればクリア。空きがなくなり、どの向きにも動かせなくなったらゲームオーバーです。',
      pauseAria: '一時停止', moves: '手数', zoomOutAria: '縮小', zoomInAria: '拡大', zoomFit: '全体',
      hint1: '払う・矢印キーで滑らせる', hint2: '指2本でズーム',
      rMax: '一番大きい札', rSize: '盤面', rDiff: '難易度', rTime: '時間',
      again: 'もう一度', toTitle: 'タイトルへ', viewBoard: '盤面を見る', backResult: '結果に戻る',
      confirmMsg: 'いまのゲームは消えます。よろしいですか。', yes: 'はい', no: 'いいえ',
      range: '{a}〜{b}', goalIn: '（GOAL {g}）',
      howto4: '3D では、奥・手前のボタン（キーは Q・E）で奥行きの向きにも滑ります。キューブの外をドラッグすると全体が回ります。',
      setTitle: '設定', setSe: '効果音', setMute: 'ミュート', setVersion: 'バージョン', setClose: '閉じる',
      soundTitle: '音を再生しますか？', soundBody: '効果音を再生してもよろしいですか？（あとで歯車の設定から変えられます）',
      soundNo: '再生しない', soundYes: '再生する',
      back: '奥', front: '手前', tip3d: 'キューブの外をドラッグすると全体が回ります',
      alphaLabel: '透明度',
      clearSub: 'GOAL {g} を作った！', overSub: 'もう動かせる向きがありません'
    },
    en: {
      sizeLabel: 'BOARD SIZE', spawnLabel: 'Spawns: ', diffLabel: 'DIFFICULTY',
      EASY: 'Small numbers appear more often. You can see the next 3 tiles.', NORMAL: 'Standard. You can see the next tile.', HARD: 'Big numbers appear more often too. The next tile is hidden.',
      howtoTitle: 'How to play',
      howto1: 'Swipe up, down, left or right (arrow keys on a PC) and every tile on the board slides that way.',
      howto2: 'When two equal numbers collide, they merge and double. Each tile can merge only once per move.',
      howto3: 'After every move, a new tile appears in an empty cell. Make the GOAL number to clear. When the board is full and nothing can move, the game is over.',
      pauseAria: 'Pause', moves: 'MOVES', zoomOutAria: 'Zoom out', zoomInAria: 'Zoom in', zoomFit: 'Fit',
      hint1: 'Swipe or use arrow keys to slide', hint2: 'Pinch with two fingers to zoom',
      rMax: 'Best tile', rSize: 'Board', rDiff: 'Difficulty', rTime: 'Time',
      again: 'Play again', toTitle: 'Title', viewBoard: 'View board', backResult: 'Back to results',
      confirmMsg: 'The current game will be lost. Continue?', yes: 'Yes', no: 'No',
      range: '{a}–{b}', goalIn: ' (GOAL {g})',
      howto4: 'In 3D, the Back and Front buttons (keys Q and E) slide the tiles in depth too. Drag outside the cube to rotate the whole board.',
      setTitle: 'Settings', setSe: 'Sound effects', setMute: 'Mute', setVersion: 'Version', setClose: 'Close',
      soundTitle: 'Play sound?', soundBody: 'Is it OK to play sound effects? (You can change this later from the gear settings.)',
      soundNo: "Don't play", soundYes: 'Play',
      back: 'Back', front: 'Front', tip3d: 'Drag outside the cube to rotate the whole board',
      alphaLabel: 'Opacity',
      clearSub: 'You made GOAL {g}!', overSub: 'No more moves left'
    },
    zh: {
      sizeLabel: '盘面大小', spawnLabel: '出现数字：', diffLabel: '难度',
      EASY: '容易出现小数字。可以看到接下来的3个方块', NORMAL: '标准。可以看到下一个方块', HARD: '大数字也容易出现。看不到下一个方块',
      howtoTitle: '玩法',
      howto1: '向上下左右滑动（电脑用方向键），盘面上所有方块都会朝那个方向移动。',
      howto2: '相同数字相撞时会合并并翻倍。每次移动中，每个方块最多合并一次。',
      howto3: '每次移动后，空格中会出现一个新方块。做出 GOAL 数字即过关。盘面填满且任何方向都无法移动时，游戏结束。',
      pauseAria: '暂停', moves: '步数', zoomOutAria: '缩小', zoomInAria: '放大', zoomFit: '全局',
      hint1: '滑动或方向键移动', hint2: '双指缩放',
      rMax: '最大方块', rSize: '盘面', rDiff: '难度', rTime: '时间',
      again: '再玩一次', toTitle: '返回标题', viewBoard: '查看盘面', backResult: '返回结果',
      confirmMsg: '当前游戏将被清除。确定吗？', yes: '是', no: '否',
      range: '{a}～{b}', goalIn: '（GOAL {g}）',
      howto4: '3D 模式下，用“向里”“向外”按钮（Q、E 键）也能沿纵深方向滑动。拖动立方体外侧可旋转整体。',
      setTitle: '设置', setSe: '音效', setMute: '静音', setVersion: '版本', setClose: '关闭',
      soundTitle: '要播放声音吗？', soundBody: '可以播放音效吗？（之后可以在齿轮设置中更改）',
      soundNo: '不播放', soundYes: '播放',
      back: '向里', front: '向外', tip3d: '拖动立方体外侧可旋转整体',
      alphaLabel: '透明度',
      clearSub: '做出了 GOAL {g}！', overSub: '已经无法移动了'
    }
  };
  // 猫語にしない言葉（確かめの文言・数字の書き方。仕様書 §13.2）
  var CAT_KEEP = { confirmMsg: 1, yes: 1, no: 1, range: 1, goalIn: 1, pauseAria: 1, zoomOutAria: 1, zoomInAria: 1,
    soundTitle: 1, soundBody: 1, soundNo: 1, soundYes: 1, setTitle: 1 };
  var SUBTITLE = { ja: 'Pick a Board, Chase One Number', en: 'Pick a Board, Chase One Number', zh: '任选盘面，只追一数' };
  var LANG_APP_ID = '1024';
  var LANGS = ['ja', 'en', 'zh', 'cat'];
  if (window.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: LANGS });
  function detectLang() {
    try {
      var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
      for (var i = 0; i < list.length; i++) {
        var l = (list[i] || '').toLowerCase();
        if (l.indexOf('ja') === 0) return 'ja'; if (l.indexOf('zh') === 0) return 'zh'; if (l.indexOf('en') === 0) return 'en';
      }
      return 'en';
    } catch (e) { return 'ja'; }
  }
  var langMode = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
  var lang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID) : (LANGS.indexOf(langMode) >= 0 ? langMode : detectLang());
  var fallbackCatBase = 'ja';
  function catBase() {
    var b = window.MomoLang ? MomoLang.getCatBase(LANG_APP_ID) : fallbackCatBase;
    return I18N[b] ? b : 'ja';
  }
  function meow(key) {
    var b = catBase(), v = b === 'en' ? ['meow', 'MEOW', 'mrrrow', 'mew', 'purr…'] : b === 'zh' ? ['喵', '喵喵', '喵！', '喵呜…', '呼噜…'] : ['にゃ', 'にゃー', 'にゃ！', 'みゃ', 'ごろごろ…'];
    var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;   // 同じ言葉は同じ鳴き声
    return v[h % v.length];
  }
  function t(key, params) {
    var s;
    if (lang === 'cat' && !CAT_KEEP[key]) s = meow(key);
    else s = (I18N[lang === 'cat' ? catBase() : lang] || I18N.ja)[key];
    if (s == null) s = I18N.ja[key] != null ? I18N.ja[key] : key;
    if (params) s = s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
    return s;
  }
  function applyLang() {
    var sub = $('subtitle'), sl = lang === 'cat' ? 'en' : lang;   // 猫語のときのサブタイトルは英語（仕様書 §13.2）
    sub.textContent = SUBTITLE[sl] || SUBTITLE.en; sub.classList.toggle('zh', sl === 'zh');
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.dataset.i18n); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    var base = lang === 'cat' ? catBase() : lang;
    document.documentElement.lang = base === 'zh' ? 'zh-Hans' : base;
    $('lang-select').value = langMode;
    refreshTitle();
    $('board-tip').textContent = game && game.dim === 3 ? t('tip3d') : '';
    if (game && (mode === 'CLEAR' || mode === 'GAME_OVER')) fillResult();
    if (window.MomoAbout) MomoAbout.apply(lang);   // 説明欄（lib/momo-about.js）
  }
  function onLangChange(m) {
    if (!window.MomoLang && m === 'cat' && lang !== 'cat') fallbackCatBase = lang;
    langMode = m;
    lang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, m) : (m === 'auto' ? detectLang() : m);
    applyLang();
  }

  // ── 覚えておく設定（読めなくても動く） ──
  function load(key, def) { try { var v = localStorage.getItem('m1024.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem('m1024.' + key, JSON.stringify(v)); } catch (e) {} }

  function clampInt(v, lo, hi, def) { v = Math.round(+v); return v >= lo && v <= hi ? v : def; }
  var sel = {
    mode: load('mode', 2) === 3 ? 3 : 2,
    size2: clampInt(load('size2', load('size', 4)), C.MIN_SIZE, C.MAX_SIZE, 4),
    size3: clampInt(load('size3', 3), C.MIN_SIZE_3D, C.MAX_SIZE_3D, 3),
    difficulty: C.DIFFICULTIES.indexOf(load('difficulty', 'NORMAL')) >= 0 ? load('difficulty', 'NORMAL') : 'NORMAL'
  };
  function curSize() { return sel.mode === 3 ? sel.size3 : sel.size2; }
  function sizeLabel(N, dim) { return dim === 3 ? N + '×' + N + '×' + N : N + '×' + N; }
  var game = null;          // ゲームの記録
  var timer = { running: false, since: 0 };
  var mode = 'TITLE';       // TITLE / PLAYING / PAUSED / CLEAR / GAME_OVER
  var cam = null;           // 3D の視点（§17.5）
  var endFx = null;         // クリア・ゲームオーバーの演出（§17.1）
  function snd(name, opt) { if (window.M1024Sound) M1024Sound.play(name, opt); }

  // ── タイトル画面 ──
  function buildSizes() {
    var box = $('size-buttons'); box.innerHTML = '';
    var lo = sel.mode === 3 ? C.MIN_SIZE_3D : C.MIN_SIZE, hi = sel.mode === 3 ? C.MAX_SIZE_3D : C.MAX_SIZE;
    for (var N = lo; N <= hi; N++) {
      var b = document.createElement('button');
      b.className = 'size-btn'; b.textContent = N; b.dataset.size = N;
      b.addEventListener('click', function (e) {
        var v = +e.currentTarget.dataset.size;
        if (sel.mode === 3) { sel.size3 = v; save('size3', v); } else { sel.size2 = v; save('size2', v); }
        refreshTitle();
      });
      box.appendChild(b);
    }
  }
  function buildTitle() {
    buildSizes();
    Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) {
      b.addEventListener('click', function () { sel.mode = +b.dataset.mode; save('mode', sel.mode); buildSizes(); refreshTitle(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.diff-btn'), function (b) {
      b.addEventListener('click', function () { sel.difficulty = b.dataset.diff; save('difficulty', sel.difficulty); refreshTitle(); });
    });
    $('start-btn').addEventListener('click', startGame);
    refreshTitle();
  }
  function refreshTitle() {
    var N = curSize(), dim = sel.mode;
    $('screen-title').classList.toggle('is3d', dim === 3);
    Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) { b.classList.toggle('selected', +b.dataset.mode === dim); });
    Array.prototype.forEach.call(document.querySelectorAll('.size-btn'), function (b) { b.classList.toggle('selected', +b.dataset.size === N); });
    Array.prototype.forEach.call(document.querySelectorAll('.diff-btn'), function (b) { b.classList.toggle('selected', b.dataset.diff === sel.difficulty); });
    $('size-name').textContent = sizeLabel(N, dim);
    $('size-goal').textContent = fmt(Math.pow(2, C.goalNFor(N, dim)));
    $('size-spawn').textContent = t('range', { a: 1, b: Math.pow(2, C.maxSpawnN(N, dim)) });
    $('diff-desc').textContent = t(sel.difficulty);
    // 小さな盤面の絵
    var cv = $('size-preview'), x = cv.getContext('2d'), s = cv.width;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, s, s); x.fillStyle = '#1f2937'; x.fillRect(0, 0, s, s);
    if (dim === 3) {
      M1024Three.draw(x, s, s, M1024Three.makeCam(), { N: N, tiles: [], colorOf: colorOf, label: function () { return { text: '', font: '' }; } });
      return;
    }
    var gap = N > 10 ? 1 : 2, cell = (s - gap * (N + 1)) / N;
    x.fillStyle = '#3b4a5e';
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) x.fillRect(gap + c * (cell + gap), gap + r * (cell + gap), cell, cell);
  }
  function fmt(v) { return v.toLocaleString('en-US'); }

  // ── 画面の切り替え ──
  function show(screen) {
    $('screen-title').classList.toggle('active', screen === 'title');
    $('screen-game').classList.toggle('active', screen === 'game');
    document.body.classList.toggle('in-game', screen === 'game');
  }
  function overlay(id, on) { $(id).hidden = !on; }

  // ── ゲーム ──
  function startGame() {
    var seed = new URLSearchParams(location.search).get('seed');
    var ng = C.newGame({ size: curSize(), dim: sel.mode, difficulty: sel.difficulty, seed: seed != null ? +seed : undefined });
    game = ng.state;
    var tg = new URLSearchParams(location.search).get('goaln');   // 確かめ用：?goaln=4 で GOAL を 16 にする
    if (tg) game.goalN = +tg;
    overlay('overlay-result', false); overlay('overlay-pause', false); $('back-result').hidden = true;
    document.body.classList.remove('paused');
    endFx = null; stopConfetti();
    show('game');
    mode = 'PLAYING';
    timerStart();
    $('depth-btns').hidden = true;   // 3D は3軸の矢印（gizmo）で6つの向きを押す
    $('gizmo').hidden = game.dim !== 3; $('dpad').hidden = game.dim === 3; $('alpha-ctl').hidden = game.dim !== 3;
    $('board-tip').textContent = game.dim === 3 ? t('tip3d') : '';
    cam = game.dim === 3 ? M1024Three.makeCam() : null;
    // 全体表示で真ん中に置いてから、この大きさで最後に使ったズーム率にする（§8.1）
    view = { z: 1, zMax: 1, bx: 0, by: 0 }; tier = null;
    layout();
    var zs = game.dim === 3 ? 1 : +load('zoom.' + game.size, 1);
    if (zs > 1) setZoom(zs, W / 2, H / 2);
    startAnim(null, ng.events); renderHud();
  }

  function timerStart() { timer.running = true; timer.since = performance.now(); }
  function timerStop() { if (timer.running && game) game.playMs += performance.now() - timer.since; timer.running = false; }

  // ── 操作の記録（不具合の調査用）。最新 300 件。window.m1024Log で読める ──
  var LOG = window.m1024Log = [];
  function board(s) {
    if (!s) return null;
    function row(r) { return r.map(function (t) { return t ? Math.pow(2, t.n) : 0; }).join(','); }
    return s.dim === 3 ? s.grid.map(function (pl) { return pl.map(row).join(' / '); }) : s.grid.map(row);
  }
  function logIt(o) {
    o.t = new Date().toISOString().slice(11, 23); o.mode = mode;
    LOG.push(o); if (LOG.length > 300) LOG.shift();
  }

  // sv：画面の向き（揺れの向き）。ボタン・払う操作から来たときだけ
  function doMove(dir, src, sv) {
    if (mode !== 'PLAYING') { logIt({ src: src, dir: dir, note: '遊んでいない状態なので無視' }); return; }
    if (!dir) { logIt({ src: src, note: '向きが決まらないので無視' }); return; }
    var r = C.move(game, dir);
    logIt({ src: src, dir: dir, moved: r.moved, before: board(game), after: r.moved ? board(r.state) : null });
    if (!r.moved) { shake(dir, sv); snd('bump'); return; }
    var prev = game.grid;
    game = r.state;
    // 音（§17.3）：滑る → 合体 → 出現
    snd('slide', { count: r.events.slides.length });
    if (r.events.merges.length) {
      var mx = 0; r.events.merges.forEach(function (m) { if (m.n > mx) mx = m.n; });
      setTimeout(function () { snd('merge', { n: mx }); }, SLIDE_MS * 0.8);
    }
    if (r.events.spawns.length) setTimeout(function () { snd('spawn'); }, SLIDE_MS + 30);
    startAnim(prev, r.events); renderHud();
    if (game.status === 'CLEAR' || game.status === 'GAME_OVER') finish();
  }

  // §17.1 クリアとゲームオーバーで、演出・音・待ち時間・結果の札を分ける
  var FX_CLEAR_MS = 1600, FX_OVER_MS = 700;
  function finish() {
    timerStop();
    mode = game.status;
    var clear = mode === 'CLEAR';
    $('result-title').textContent = clear ? 'CLEAR!' : 'GAME OVER';
    $('result-panel').classList.toggle('is-clear', clear);
    $('result-panel').classList.toggle('is-over', !clear);
    fillResult();
    endFx = { clear: clear, t0: performance.now() + (clear ? SLIDE_MS : 0) };
    setTimeout(function () {
      if (!game || mode !== (clear ? 'CLEAR' : 'GAME_OVER')) return;
      snd(clear ? 'clear' : 'over');
      if (clear) startConfetti(); else shake(null, [1, 0], 10);
    }, clear ? SLIDE_MS + POP_MS : SLIDE_MS + POP_MS);
    loop();
    var me = game;
    setTimeout(function () { if (game === me) overlay('overlay-result', true); }, clear ? FX_CLEAR_MS : FX_OVER_MS);
    if (window.MomoRating) setTimeout(function () { MomoRating.prompt(); }, (clear ? FX_CLEAR_MS : FX_OVER_MS) + 1300);   // 評価の声かけ（1端末1回）
  }
  function fillResult() {
    $('result-sub').textContent = mode === 'CLEAR' ? t('clearSub', { g: fmt(Math.pow(2, game.goalN)) }) : t('overSub');
    $('r-score').textContent = fmt(game.score);
    $('r-max').textContent = fmt(Math.pow(2, game.maxN));
    $('r-size').textContent = sizeLabel(game.size, game.dim) + t('goalIn', { g: fmt(Math.pow(2, game.goalN)) });
    $('r-diff').textContent = game.difficulty;
    var sec = Math.floor(game.playMs / 1000);
    $('r-time').textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
    $('r-moves').textContent = fmt(game.moves);
  }
  // 演出の進み：クリアは札が光って膨らむ、ゲームオーバーは盤面が暗く色が抜ける
  function fxNow() {
    if (!endFx) return { glow: 0, pulse: 1, dim: 0 };
    var el = performance.now() - endFx.t0;
    if (endFx.clear) {
      var q = Math.max(0, Math.min(1, el / 900));
      return { glow: el < 0 ? 0 : Math.max(0.35, Math.sin(Math.min(1, el / 500) * Math.PI / 2)), pulse: 1 + 0.28 * Math.sin(q * Math.PI), dim: 0 };
    }
    return { glow: 0, pulse: 1, dim: Math.max(0, Math.min(1, el / 600)) * 0.8 };
  }

  // ── 紙吹雪（クリアだけ） ──
  var confettiRun = null;
  function startConfetti() {
    var c = $('fx'), x = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth, h = window.innerHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var COLS = ['#FBBF24', '#FDE68A', '#FB923C', '#FFFFFF', '#F472B6', '#7DD3FC', '#86EFAC'];
    var ps = [], rc = $('board').getBoundingClientRect(), ox = rc.left + rc.width / 2, oy = rc.top + rc.height / 2;
    for (var i = 0; i < 170; i++) {
      var burst = i < 90, a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      ps.push({
        x: burst ? ox : Math.random() * w, y: burst ? oy : -20 - Math.random() * h * 0.5,
        vx: burst ? Math.cos(a) * sp : (Math.random() - 0.5) * 2, vy: burst ? Math.sin(a) * sp - 5 : 2 + Math.random() * 3,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, s: 5 + Math.random() * 6, col: COLS[i % COLS.length]
      });
    }
    var t0 = performance.now(), me = {};
    confettiRun = me;
    (function step(now) {
      if (confettiRun !== me) return;
      var el = now - t0;
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      x.globalAlpha = el > 2600 ? Math.max(0, 1 - (el - 2600) / 700) : 1;
      ps.forEach(function (p) {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.col; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
      });
      if (el < 3300) requestAnimationFrame(step); else stopConfetti();
    })(t0);
  }
  function stopConfetti() {
    confettiRun = null;
    var c = $('fx'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  function pause() {
    if (mode !== 'PLAYING') return;
    timerStop(); mode = 'PAUSED'; overlay('overlay-pause', true); document.body.classList.add('paused');
  }
  function resume() {
    if (mode !== 'PAUSED') return;
    overlay('overlay-pause', false); document.body.classList.remove('paused'); mode = 'PLAYING'; timerStart();
  }

  var confirmThen = null;
  function confirmDiscard(fn) { confirmThen = fn; overlay('overlay-confirm', true); }
  function toTitle() {
    overlay('overlay-pause', false); overlay('overlay-result', false); $('back-result').hidden = true;
    document.body.classList.remove('paused');
    endFx = null; stopConfetti();
    timerStop(); mode = 'TITLE'; game = null; show('title'); refreshTitle();
  }

  function renderHud() {
    $('hud-goal').textContent = fmt(Math.pow(2, game.goalN));
    $('hud-score').textContent = fmt(game.score);
    $('hud-moves').textContent = fmt(game.moves);
    $('hud-diff').textContent = game.difficulty + ' / NEXT';
    var box = $('hud-next'); box.innerHTML = '';
    var next = C.visibleNext(game);
    if (!next.length) { box.textContent = '—'; return; }
    next.forEach(function (n) {
      var d = document.createElement('div'), col = colorOf(n);
      d.className = 'next-tile'; d.style.background = col[0]; d.style.color = col[1];
      d.textContent = Math.pow(2, n);
      box.appendChild(d);
    });
  }

  // ── 盤面の描画（canvas）と、ズーム・見える範囲（§8） ──
  // 盤面の座標は「全体表示（z=1）のときの CSS px」で持ち、画面の位置 = 原点 + 盤面の座標 × z
  var cv = $('board'), ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1;           // canvas の大きさ（CSS px）
  var unit = { cell: 0, gap: 0, B: 0 }; // z=1 のときのマス・すき間・盤面の一辺
  var view = { z: 1, zMax: 1, bx: 0, by: 0 };  // ズーム率と、盤面の左上の画面位置
  var geo = { cell: 0, gap: 0, pad: 0, bx: 0, by: 0 };
  var tier = null;                      // 表示の段階：0＝数字 1＝2ⁿ 2＝n
  var shakeAnim = null, flash = null;

  function zoomKey() { return 'zoom.' + game.size; }

  function layout() {
    if (!game) return;
    var wrap = $('board-wrap');
    W = Math.max(120, wrap.clientWidth); H = Math.max(120, wrap.clientHeight);
    DPR = window.devicePixelRatio || 1;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    var N = game.size, B = Math.floor(Math.min(W, H));
    var gap = Math.max(2, Math.round(B / N * 0.08));
    unit = { gap: gap, cell: (B - gap * (N + 1)) / N, B: B };
    view.zMax = Math.max(1, 80 / unit.cell);   // マスが 80px になるまで
    view.z = Math.min(view.z, view.zMax);
    clampView(); updateGeo();
  }

  // 画面の点 (px,py) を動かさないまま、ズーム率を z にする
  function setZoom(z, px, py) {
    z = Math.max(1, Math.min(view.zMax, z));
    var wx = (px - view.bx) / view.z, wy = (py - view.by) / view.z;
    view.z = z; view.bx = px - wx * z; view.by = py - wy * z;
    clampView(); updateGeo();
  }
  function panBy(dx, dy) { view.bx += dx; view.by += dy; clampView(); updateGeo(); }
  // 盤面が画面より小さい向きは真ん中に置き、大きい向きは端が内側に入らないようにする
  function clampView() {
    var B = unit.B * view.z;
    view.bx = B <= W ? (W - B) / 2 : Math.min(0, Math.max(W - B, view.bx));
    view.by = B <= H ? (H - B) / 2 : Math.min(0, Math.max(H - B, view.by));
  }
  function updateGeo() {
    var z = view.z;
    geo = { cell: unit.cell * z, gap: unit.gap * z, pad: unit.gap * z, bx: view.bx, by: view.by };
    // §8.2 表示の段階。境目を 4px 越えたときだけ変える（ちらつき防止）
    var c = geo.cell;
    if (tier === null) tier = c >= 44 ? 0 : c >= 28 ? 1 : 2;
    else {
      if (tier === 2 && c >= 32) tier = 1;
      if (tier === 1 && c >= 48) tier = 0;
      if (tier === 0 && c < 40) tier = 1;
      if (tier === 1 && c < 24) tier = 2;
    }
    if (game) save(zoomKey(), z);
  }
  var Z3 = [0.55, 3];
  function zoom3(z) { cam.zoom = Math.max(Z3[0], Math.min(Z3[1], z)); requestRender(); }
  function zoomBy(f, px, py) {
    if (game && game.dim === 3) { zoom3(cam.zoom * f); return; }
    setZoom(view.z * f, px == null ? W / 2 : px, py == null ? H / 2 : py);
    requestRender();
  }
  function fitAll() { if (game && game.dim === 3) { M1024Three.home(cam); requestRender(); return; } view.z = 1; clampView(); updateGeo(); requestRender(); }

  // ── 動き（§11）。滑る → 合体した札が膨らむ・新しい札が現れる ──
  // 「動きを減らす」設定（prefers-reduced-motion）でも、札の動きは同じ速さで出す。
  // 動きがないと、どの札が動いたか・新しく出たかが分からないため（2026-11-14 利用者の指摘）
  var SLOW = +new URLSearchParams(location.search).get('slow') || 1;   // 確かめ用：?slow=10 で 10 倍ゆっくり
  var SLIDE_MS = 90 * SLOW;    // 滑る
  var POP_MS = 140 * SLOW;     // 合体の膨らみ・新しい札の現れ
  var FLASH_MS = 700;          // 見える範囲の外に出た札を、小さな全体図で光らせる時間
  var anim = null, looping = false;

  function startAnim(prevGrid, ev) {
    var slideMs = prevGrid ? SLIDE_MS : 0;
    var merged = {}, spawned = {}, moving = {}, outside = [];
    (ev.merges || []).forEach(function (m) { merged[m.id] = true; });
    (ev.spawns || []).forEach(function (s) {
      if (!s) return;
      spawned[s.id] = true;
      if (s.at.length === 2 && !cellVisible(s.at[0], s.at[1])) outside.push(s.at);
    });
    (ev.slides || []).forEach(function (s) { moving[s.id] = s; });
    anim = { t0: performance.now(), prev: prevGrid, slideMs: slideMs, merged: merged, spawned: spawned, moving: moving };
    if (outside.length && prevGrid) flash = { cells: outside, t0: performance.now() };
    loop();
  }
  function requestRender() { if (!looping) { looping = true; requestAnimationFrame(function () { looping = false; loop(); }); } }
  // 動き・揺れ・光りが残っている間だけ描き続ける
  function loop() {
    if (looping) return;
    looping = true;
    (function step() {
      render();
      var now = performance.now();
      if (anim && now - anim.t0 >= anim.slideMs + POP_MS) { anim = null; render(); }
      if (flash && now - flash.t0 >= FLASH_MS) { flash = null; render(); }
      var fxOn = endFx && now - endFx.t0 < 1400;
      if (anim || shakeAnim || flash || fxOn) requestAnimationFrame(step); else looping = false;
    })();
  }
  function easeOut(q) { return 1 - Math.pow(1 - q, 3); }
  function easeOutBack(q) { var c = 1.7; return 1 + (c + 1) * Math.pow(q - 1, 3) + c * Math.pow(q - 1, 2); }

  function cellXY(r, c) { return [geo.bx + geo.pad + c * (geo.cell + geo.gap), geo.by + geo.pad + r * (geo.cell + geo.gap)]; }
  function cellVisible(r, c) {
    var p = cellXY(r, c);
    return p[0] + geo.cell > 0 && p[0] < W && p[1] + geo.cell > 0 && p[1] < H;
  }

  function render() {
    if (!game) return;
    if (game.dim === 3) { render3D(); return; }
    var N = game.size, g = geo, fx = fxNow();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var ox = 0, oy = 0;
    if (shakeAnim) { var k = shakeAnim.k; ox = shakeAnim.dx * k; oy = shakeAnim.dy * k; }
    ctx.save(); ctx.translate(ox, oy);
    var B = unit.B * view.z;
    ctx.fillStyle = '#1f2937';
    roundRect(g.bx, g.by, B, B, Math.min(12, g.cell * 0.3)); ctx.fill();
    var rad = Math.min(8 * view.z, g.cell * 0.14), r, c, t, p;
    // 見えているマスだけ描く
    var c0 = Math.max(0, Math.floor((-g.bx - g.cell) / (g.cell + g.gap))), c1 = Math.min(N - 1, Math.ceil((W - g.bx) / (g.cell + g.gap)));
    var r0 = Math.max(0, Math.floor((-g.by - g.cell) / (g.cell + g.gap))), r1 = Math.min(N - 1, Math.ceil((H - g.by) / (g.cell + g.gap)));
    ctx.fillStyle = '#2b3646';
    for (r = r0; r <= r1; r++) for (c = c0; c <= c1; c++) { p = cellXY(r, c); roundRect(p[0], p[1], g.cell, g.cell, rad); ctx.fill(); }

    var el = anim ? performance.now() - anim.t0 : Infinity;
    if (anim && anim.prev && el < anim.slideMs) {
      // 滑っている途中：動く前の札を、元の場所から行き先へ動かして描く。止まっている札を先に、動く札を上に
      var q = easeOut(el / anim.slideMs), movers = [];
      for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
        t = anim.prev[r][c]; if (!t) continue;
        var mv = anim.moving[t.id];
        if (!mv) { if (r >= r0 && r <= r1 && c >= c0 && c <= c1) { p = cellXY(r, c); drawTile(p[0], p[1], t.n, 1, rad); } continue; }
        movers.push([t, mv]);
      }
      movers.forEach(function (m) {
        var a = cellXY(m[1].from[0], m[1].from[1]), b = cellXY(m[1].to[0], m[1].to[1]);
        drawTile(a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, m[0].n, 1, rad);
      });
    } else {
      // 滑り終わったあと：合体した札は一度膨らんで戻り、新しい札は小さい姿から現れる
      var k2 = anim ? Math.max(0, Math.min(1, (el - anim.slideMs) / POP_MS)) : 1;
      for (r = r0; r <= r1; r++) for (c = c0; c <= c1; c++) {
        t = game.grid[r][c]; if (!t) continue;
        var s = 1;
        if (anim && anim.merged[t.id]) s = 1 + 0.18 * Math.sin(Math.PI * k2);
        else if (anim && anim.spawned[t.id]) s = k2 <= 0 ? 0 : easeOutBack(k2);
        if (s <= 0.01) continue;
        p = cellXY(r, c);
        if (fx.glow && t.n >= game.goalN) { s *= fx.pulse; drawGlow(p[0] + g.cell / 2, p[1] + g.cell / 2, g.cell * s, fx.glow); }
        drawTile(p[0], p[1], t.n, s, rad);
      }
    }
    if (fx.dim) {   // ゲームオーバー：色を抜いて暗くする
      ctx.save();
      ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,' + fx.dim + ')';
      roundRect(g.bx, g.by, B, B, Math.min(12, g.cell * 0.3)); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,' + 0.5 * fx.dim + ')';
      roundRect(g.bx, g.by, B, B, Math.min(12, g.cell * 0.3)); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    drawMinimap();
  }
  function drawGlow(cx, cy, size, k) {
    var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.1);
    gr.addColorStop(0, 'rgba(253,230,138,' + 0.75 * k + ')'); gr.addColorStop(1, 'rgba(253,230,138,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, size * 1.1, 0, Math.PI * 2); ctx.fill();
  }

  // ── 3D の描画（§17.5）。描き方は m1024-3d.js ──
  function render3D() {
    var N = game.size, fx = fxNow(), now = performance.now(), tiles = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#1b2638'); bg.addColorStop(1, '#090c13');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var el = anim ? now - anim.t0 : Infinity, all = C.allPos(N, 3);
    if (anim && anim.prev && el < anim.slideMs) {
      var q = easeOut(el / anim.slideMs);
      all.forEach(function (p) {
        var t = C.get(anim.prev, p); if (!t) return;
        var mv = anim.moving[t.id];
        var pos = mv ? [0, 1, 2].map(function (i) { return mv.from[i] + (mv.to[i] - mv.from[i]) * q; }) : p;
        tiles.push({ pos: pos, n: t.n, s: 1, home: mv ? mv.to : p, goal: t.n >= game.goalN, glow: t.n >= game.goalN ? 0.35 : 0 });
      });
    } else {
      var k2 = anim ? Math.max(0, Math.min(1, (el - anim.slideMs) / POP_MS)) : 1;
      all.forEach(function (p) {
        var t = C.get(game.grid, p); if (!t) return;
        var s = 1, goal = t.n >= game.goalN;
        if (anim && anim.merged[t.id]) s = 1 + 0.18 * Math.sin(Math.PI * k2);
        else if (anim && anim.spawned[t.id]) s = k2 <= 0 ? 0 : easeOutBack(k2);
        if (goal && fx.glow) s *= fx.pulse;
        tiles.push({ pos: p, n: t.n, s: s, home: p, goal: goal, glow: goal ? Math.max(0.35, fx.glow) : 0 });
      });
    }
    var sh = shakeAnim ? [shakeAnim.dx * shakeAnim.k, shakeAnim.dy * shakeAnim.k] : null;
    M1024Three.draw(ctx, W, H, cam, { N: N, tiles: tiles, colorOf: colorOf, label: label3, dim: fx.dim, shake: sh, alpha: ALPHA_3D });
    drawGizmo();
  }
  // 3D の札の透け具合（1＝不透明）。2026-11-14 利用者の希望で試す。?alpha=0.5 のように変えて見られる
  // スライダーで変えられる（ゲーム画面の盤面の左上。3D のときだけ）。端末に覚える。最初は 0.5
  var ALPHA_3D = Math.max(0.1, Math.min(1, +load('alpha3d', 0.5) || 0.5));
  function showAlpha() { $('alpha-range').value = ALPHA_3D; $('alpha-v').textContent = ALPHA_3D.toFixed(2); }
  $('alpha-range').addEventListener('input', function (e) {
    ALPHA_3D = +e.target.value; save('alpha3d', ALPHA_3D); showAlpha(); requestRender();
  });
  $('alpha-range').addEventListener('change', function (e) { e.target.blur(); });   // 矢印キーが札の操作に戻るように
  showAlpha();
  // 3D の向きの矢印（3軸の座標の形）。回すたびに描き直す
  var gz = $('gizmo'), gzHot = null;
  function drawGizmo() {
    if (gz.hidden || !cam) return;
    var w = gz.clientWidth || 132, h = gz.clientHeight || 112, d = window.devicePixelRatio || 1;
    if (gz.width !== Math.round(w * d)) { gz.width = Math.round(w * d); gz.height = Math.round(h * d); }
    var x = gz.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0);
    M1024Three.drawGizmo(x, w, h, cam, gzHot);
  }
  gz.addEventListener('click', function (e) {
    if (!game || game.dim !== 3) return;
    var rc = gz.getBoundingClientRect(), a = M1024Three.gizmoHit(rc.width, rc.height, cam, e.clientX - rc.left, e.clientY - rc.top);
    if (!a) return;
    gzHot = a.dir; setTimeout(function () { if (gzHot === a.dir) { gzHot = null; drawGizmo(); } }, 160);
    doMove(a.dir, 'gizmo:' + a.dir, [a.x, a.y]);
    drawGizmo();
  });
  // 3D の札の文字：入る大きさなら数字、小さければ n
  function label3(n, size) {
    var FONT = "px 'Fredoka One', sans-serif", lab = String(Math.pow(2, n));
    var f = lab.length <= 2 ? 0.55 : lab.length === 3 ? 0.44 : lab.length === 4 ? 0.34 : 0.28;
    if (size * f >= 9) return { text: lab, font: Math.round(size * f) + FONT };
    return { text: String(n), font: Math.max(7, Math.round(size * 0.55)) + FONT };
  }

  // §8.2 札の文字：数字／2ⁿ／n
  function drawTile(x, y, n, s, rad) {
    var cell = geo.cell;
    ctx.save();
    if (s !== 1) { ctx.translate(x + cell / 2, y + cell / 2); ctx.scale(s, s); ctx.translate(-cell / 2, -cell / 2); x = 0; y = 0; }
    var col = colorOf(n);
    ctx.fillStyle = col[0]; roundRect(x, y, cell, cell, rad); ctx.fill();
    if (n >= game.goalN) { // §9.1 ゴールの札は金の縁
      ctx.strokeStyle = '#FDE68A'; ctx.lineWidth = Math.max(1.5, cell * 0.06);
      roundRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth, rad); ctx.stroke();
    }
    ctx.fillStyle = col[1];
    ctx.textBaseline = 'middle';
    var cx = x + cell / 2, cy = y + cell / 2 + cell * 0.03, FONT = "px 'Fredoka One', sans-serif";
    if (tier === 0) {
      var label = String(Math.pow(2, n));
      var f = label.length <= 2 ? 0.5 : label.length === 3 ? 0.4 : label.length === 4 ? 0.32 : 0.26;
      ctx.font = Math.max(7, cell * f) + FONT; ctx.textAlign = 'center';
      ctx.fillText(label, cx, cy);
    } else if (tier === 1) {
      // 「2」と上付きの n。2 と n を合わせた幅で真ん中に置く
      var base = Math.max(7, cell * 0.44), sup = Math.max(6, base * 0.6), ns = String(n);
      ctx.font = base + FONT; var w2 = ctx.measureText('2').width;
      ctx.font = sup + FONT; var wn = ctx.measureText(ns).width;
      var left = cx - (w2 + wn + base * 0.04) / 2;
      ctx.textAlign = 'left';
      ctx.font = base + FONT; ctx.fillText('2', left, cy + base * 0.06);
      ctx.font = sup + FONT; ctx.fillText(ns, left + w2 + base * 0.04, cy - base * 0.3);
    } else {
      var lab = String(n);
      ctx.font = Math.max(6, cell * (lab.length === 1 ? 0.6 : 0.5)) + FONT; ctx.textAlign = 'center';
      ctx.fillText(lab, cx, cy);
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ── §8.4 小さな全体図（拡大中だけ。右上） ──
  function minimapRect() {
    if (view.z <= 1.001 || !game || game.dim === 3) return null;
    var m = Math.round(Math.min(120, Math.max(72, Math.min(W, H) * 0.28)));
    return { x: W - m - 8, y: 8, s: m };
  }
  function drawMinimap() {
    var mm = minimapRect(); if (!mm) return;
    var N = game.size, cs = mm.s / N;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(mm.x - 3, mm.y - 3, mm.s + 6, mm.s + 6);
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var t = game.grid[r][c];
      ctx.fillStyle = t ? colorOf(t.n)[0] : '#2b3646';
      ctx.fillRect(mm.x + c * cs + 0.5, mm.y + r * cs + 0.5, Math.max(1, cs - 1), Math.max(1, cs - 1));
    }
    ctx.globalAlpha = 1;
    // いま見えている範囲の枠
    var B = unit.B * view.z, fx = Math.max(0, -view.bx / B), fy = Math.max(0, -view.by / B);
    var fw = Math.min(1, W / B), fh = Math.min(1, H / B);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(mm.x + fx * mm.s, mm.y + fy * mm.s, Math.min(fw, 1 - fx) * mm.s, Math.min(fh, 1 - fy) * mm.s);
    // 見える範囲の外に出た新しい札を光らせる
    if (flash) {
      var a = 1 - (performance.now() - flash.t0) / FLASH_MS;
      ctx.strokeStyle = 'rgba(253,230,138,' + Math.max(0, a) + ')'; ctx.lineWidth = 2.5;
      flash.cells.forEach(function (p) { ctx.strokeRect(mm.x + p[1] * cs - 2, mm.y + p[0] * cs - 2, cs + 4, cs + 4); });
    }
    ctx.restore();
  }
  // 全体図のタップした場所が真ん中に来るように動かす
  function minimapHit(clientX, clientY) {
    var mm = minimapRect(); if (!mm) return false;
    var rc = cv.getBoundingClientRect(), x = clientX - rc.left, y = clientY - rc.top;
    if (x < mm.x - 3 || x > mm.x + mm.s + 3 || y < mm.y - 3 || y > mm.y + mm.s + 3) return false;
    var B = unit.B * view.z;
    view.bx = W / 2 - (x - mm.x) / mm.s * B; view.by = H / 2 - (y - mm.y) / mm.s * B;
    clampView(); updateGeo(); requestRender();
    return true;
  }

  // §7.4 動かない向きは、その向きに少し揺れて戻る（150ms）
  function shake(dir, sv, amp) {
    amp = amp || 6;
    var v = sv ? [sv[0] / (Math.hypot(sv[0], sv[1]) || 1), sv[1] / (Math.hypot(sv[0], sv[1]) || 1)]
      : ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] || [0, -0.6]);
    var t0 = performance.now();
    var me = { dx: v[0] * amp, dy: v[1] * amp, k: 0 };
    shakeAnim = me;   // 揺れの途中で次の揺れが来たら、新しい方だけを続ける
    (function step(now) {
      if (shakeAnim !== me) return;
      var p = Math.min(1, (now - t0) / 150);
      me.k = Math.sin(p * Math.PI);
      if (!looping) render();
      if (p < 1) requestAnimationFrame(step); else { shakeAnim = null; if (!looping) render(); }
    })(t0);
  }

  // ── 操作（§7） ──
  var KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' };
  function canView() { return game && (mode === 'PLAYING' || mode === 'CLEAR' || mode === 'GAME_OVER'); }
  document.addEventListener('keydown', function (e) {
    if ($('overlay-settings').hidden === false || $('overlay-sound').hidden === false) return;
    if (e.target && e.target.tagName === 'INPUT') return;   // スライダーを動かしている間は札を動かさない
    if (mode === 'PLAYING' && KEYS[e.key]) { e.preventDefault(); screenMove(KEYS[e.key], 'key:' + e.key); return; }
    if (mode === 'PLAYING' && game.dim === 3 && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
      e.preventDefault(); depthMove(e.key.toLowerCase() === 'q' ? 'back' : 'front', 'key:' + e.key); return;
    }
    if (canView()) {
      if (e.key === '+' || e.key === '=' || e.key === ';') { zoomBy(1.25); return; }
      if (e.key === '-' || e.key === '_') { zoomBy(0.8); return; }
      if (e.key === 'f' || e.key === 'F') { fitAll(); return; }
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (mode === 'PLAYING') pause(); else if (mode === 'PAUSED') resume(); }
  });

  // ホイール：拡大中は見える範囲を動かす。Ctrl＋ホイール（トラックパッドのつまみ）はズーム
  cv.addEventListener('wheel', function (e) {
    if (!canView()) return;
    e.preventDefault();
    var rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
    if (game.dim === 3) { zoom3(cam.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); return; }
    if (e.ctrlKey) { setZoom(view.z * Math.exp(-e.deltaY * 0.01), px, py); }
    else if (e.shiftKey) panBy(-(e.deltaY || e.deltaX), 0);
    else panBy(-e.deltaX, -e.deltaY);
    requestRender();
  }, { passive: false });

  // 払う判定：離したときに 30px 以上、かつ大きい方が小さい方の 1.5 倍以上。
  // 指2本：つまむ・広げるでズーム、動かすと見える範囲が動く。指2本目が触れたら払う操作は取り消し
  var gest = null, pinch = null;
  var pts = {};   // 触れている指（touch）の位置
  function dirFrom(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 30) return null;
    if (ax >= ay * 1.5) return dx > 0 ? 'right' : 'left';
    if (ay >= ax * 1.5) return dy > 0 ? 'down' : 'up';
    return null;
  }
  function pinchStart() {
    var ids = Object.keys(pts); if (ids.length < 2) return;
    var a = pts[ids[0]], b = pts[ids[1]], rc = cv.getBoundingClientRect();
    pinch = { ids: [ids[0], ids[1]], d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: game.dim === 3 ? cam.zoom : view.z,
      mx: (a.x + b.x) / 2 - rc.left, my: (a.y + b.y) / 2 - rc.top };
    pinch.wx = (pinch.mx - view.bx) / view.z; pinch.wy = (pinch.my - view.by) / view.z;
  }
  var area = $('screen-game'), downs = {};
  area.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, #gizmo, #alpha-ctl')) return;
    if (canView() && minimapHit(e.clientX, e.clientY)) return;
    // 前の操作の「離した」を拾えていなかったら、前の操作は捨てて取り直す。
    // マウス・ペンは1本しかないので、「2本目」は指（touch）のときだけ
    if (gest && (e.pointerType !== 'touch' || downs[e.pointerId] || !Object.keys(downs).length)) {
      logIt({ src: e.pointerType, note: '前の操作が終わっていなかったので取り直した' });
      gest = null; downs = {}; pts = {}; pinch = null;
    }
    downs[e.pointerId] = true;
    if (e.pointerType === 'touch') pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    // 指が画面の外へ出ても「離した」が届くようにする
    try { area.setPointerCapture(e.pointerId); } catch (err) {}
    if (gest) {   // 2本目の指が触れた
      gest.cancel = true;
      if (canView() && Object.keys(pts).length >= 2 && !pinch) pinchStart();
      return;
    }
    gest = { id: e.pointerId, x: e.clientX, y: e.clientY, cancel: false };
    // 3D：キューブの外をつかんだら、滑らせずに全体を回す（§17.5）
    if (game && game.dim === 3 && canView()) {
      var rc = cv.getBoundingClientRect(), lx = e.clientX - rc.left, ly = e.clientY - rc.top;
      if (!M1024Three.inside(M1024Three.outline(cam, W, H, game.size), lx, ly)) { gest.rotate = true; gest.lx = e.clientX; gest.ly = e.clientY; }
    }
  });
  area.addEventListener('pointermove', function (e) {
    if (gest && gest.rotate && !gest.cancel && e.pointerId === gest.id) {
      M1024Three.rotateBy(cam, e.clientX - gest.lx, e.clientY - gest.ly);
      gest.lx = e.clientX; gest.ly = e.clientY; requestRender();
    }
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (!pinch || !pts[pinch.ids[0]] || !pts[pinch.ids[1]]) return;
    var a = pts[pinch.ids[0]], b = pts[pinch.ids[1]], rc = cv.getBoundingClientRect();
    var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    var mx = (a.x + b.x) / 2 - rc.left, my = (a.y + b.y) / 2 - rc.top;
    // つまんだ点が指の真ん中に付いてくるように：ズームと移動を同時に
    if (game.dim === 3) { zoom3(pinch.z0 * d / pinch.d0); return; }
    view.z = Math.max(1, Math.min(view.zMax, pinch.z0 * d / pinch.d0));
    view.bx = mx - pinch.wx * view.z; view.by = my - pinch.wy * view.z;
    clampView(); updateGeo(); requestRender();
  });
  window.addEventListener('blur', function () { gest = null; downs = {}; pts = {}; pinch = null; });
  function release(e, judge) {
    if (!downs[e.pointerId]) return;
    delete downs[e.pointerId]; delete pts[e.pointerId];
    if (pinch && pinch.ids.indexOf(String(e.pointerId)) >= 0) pinch = null;
    if (gest && e.pointerId === gest.id) {
      var dx = Math.round(e.clientX - gest.x), dy = Math.round(e.clientY - gest.y);
      var src = e.pointerType + ' dx=' + dx + ' dy=' + dy;
      var dir = null;
      if (judge && !gest.cancel && !gest.rotate) dir = game && game.dim === 3 ? (Math.hypot(dx, dy) >= 30 ? M1024Three.dirFor(cam, dx, dy) : null) : dirFrom(dx, dy);
      if (gest.rotate) logIt({ src: src, note: '全体を回した' });
      else if (dir) doMove(dir, src, [dx, dy]);
      else logIt({ src: src, note: !judge ? '取り消された（pointercancel）' : gest.cancel ? '指2本目が触れたので無視' : '向きが決まらないので無視' });
    }
    if (!Object.keys(downs).length) { gest = null; pinch = null; }   // 指を全部離したら次の操作へ
  }
  area.addEventListener('pointerup', function (e) { release(e, true); });
  area.addEventListener('pointercancel', function (e) { release(e, false); });

  var SCREEN_V = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  // 画面の向きで滑らせる（2D はそのまま。3D は画面の向きにいちばん近い盤面の向き）
  function screenMove(d, src) {
    var v = SCREEN_V[d];
    doMove(game.dim === 3 ? M1024Three.dirFor(cam, v[0], v[1]) : d, src, v);
  }
  function depthMove(which, src) { doMove(M1024Three.depthDirs(cam)[which], src, null); }
  Array.prototype.forEach.call(document.querySelectorAll('.arrow-btn'), function (b) {
    b.addEventListener('click', function () {
      if (!game) return;
      if (b.dataset.dir) screenMove(b.dataset.dir, 'btn:' + b.dataset.dir);
      else if (b.dataset.depth && game.dim === 3) depthMove(b.dataset.depth, 'btn:' + b.dataset.depth);
    });
  });

  // 音の設定。端末に覚える。「再生しない」はこの間だけ鳴らさない（保存しない）
  var SND = load('sound', null) || {};
  SND = { vol: clampInt(SND.vol, 0, 100, 70), mute: !!SND.mute };
  var quiet = false, audioAsked = false, hiddenAt = 0, pendingBtn = null;
  var LONG_MS = 60 * 60 * 1000;   // 1時間以上離れたら、もう一度聞く（他のゲームと同じ）
  function applySound() {
    if (window.M1024Sound) { M1024Sound.setVolume(SND.vol / 100); M1024Sound.setMute(SND.mute || quiet); }
    [['se-vol', 'se-mute', 'se-v'], ['m-se-vol', 'm-se-mute', 'm-se-v']].forEach(function (ids) {
      $(ids[0]).value = SND.vol; $(ids[1]).checked = SND.mute || quiet; $(ids[2]).textContent = SND.vol;
    });
  }
  ['se-vol', 'm-se-vol'].forEach(function (id) {
    $(id).addEventListener('input', function (e) { SND.vol = +e.target.value; save('sound', SND); applySound(); });
    $(id).addEventListener('change', function () { snd('spawn'); });   // 音量を変えたら試しに鳴らす
  });
  ['se-mute', 'm-se-mute'].forEach(function (id) {
    $(id).addEventListener('change', function (e) { SND.mute = e.target.checked; quiet = false; save('sound', SND); applySound(); });
  });
  $('gear-btn').addEventListener('click', function () {
    $('set-version').textContent = $('version-tag').textContent;
    if (window.M1024Sound && audioAsked) M1024Sound.unlock();
    applySound(); overlay('overlay-settings', true);
  });
  $('set-close').addEventListener('click', function () { overlay('overlay-settings', false); });
  $('overlay-settings').addEventListener('pointerdown', function (e) { if (e.target === e.currentTarget) overlay('overlay-settings', false); });
  function soundAnswer(play) {
    quiet = !play; audioAsked = true;
    if (window.M1024Sound) M1024Sound.unlock();
    applySound(); overlay('overlay-sound', false);
    var b = pendingBtn; pendingBtn = null; if (b) b.click();
  }
  $('sound-yes').addEventListener('click', function () { soundAnswer(true); });
  $('sound-no').addEventListener('click', function () { soundAnswer(false); });
  // 音を出す操作（START・もう一度・RESUME）の最初の押下を止めて、確かめを出す
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#start-btn, #again-btn, #resume-btn');
    if (!b) return;
    if (audioAsked) { if (window.M1024Sound) M1024Sound.unlock(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    pendingBtn = b; applySound(); overlay('overlay-sound', true);
  }, true);
  applySound();

  $('zoom-out').addEventListener('click', function () { zoomBy(0.8); });
  $('zoom-in').addEventListener('click', function () { zoomBy(1.25); });
  $('zoom-fit').addEventListener('click', fitAll);

  // ── ボタン ──
  $('pause-btn').addEventListener('click', pause);
  $('resume-btn').addEventListener('click', resume);
  $('restart-btn').addEventListener('click', function () { confirmDiscard(startGame); });
  $('title-btn').addEventListener('click', function () { confirmDiscard(toTitle); });
  $('confirm-yes').addEventListener('click', function () { overlay('overlay-confirm', false); var f = confirmThen; confirmThen = null; if (f) f(); });
  $('confirm-no').addEventListener('click', function () { overlay('overlay-confirm', false); confirmThen = null; });
  $('again-btn').addEventListener('click', startGame);
  $('totitle-btn').addEventListener('click', toTitle);
  $('view-btn').addEventListener('click', function () { overlay('overlay-result', false); $('back-result').hidden = false; });
  $('back-result').addEventListener('click', function () { $('back-result').hidden = true; overlay('overlay-result', true); });

  // ページが隠れたら止めて音も止める。1時間以上たって戻ったら、次の操作でもう一度聞く（§17.4）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); pause(); if (window.M1024Sound) M1024Sound.suspend(); return; }
    if (audioAsked && hiddenAt && Date.now() - hiddenAt >= LONG_MS) audioAsked = false;
    else if (audioAsked && window.M1024Sound) M1024Sound.resume();
  });
  window.addEventListener('resize', function () { layout(); render(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { M1024Three.clearLabels(); render(); });

  $('lang-select').addEventListener('change', function (e) { onLangChange(e.target.value); });
  buildTitle();
  applyLang();
})();
