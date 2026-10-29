/*
 * MOMO Cosmos — 起動と画面の切り替え
 * M1 後半：共通の画面の枠（タイトル画面・右上の歯車と言語・設定パネル・クレジット・4言語）
 */
(function () {
  'use strict';
  const C = window.COSMOS_CONFIG;
  const $ = id => document.getElementById(id);
  const L = window.CosmosI18n;
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 保存（第19章：例外で囲み、保存できなくても動く） ------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 保存できない環境 */ } }
  };

  async function boot() {
    document.querySelectorAll('.app-version').forEach(el => { el.textContent = C.version; });

    let sprites = {};
    try { sprites = await CosmosRender.loadSprites('assets/img/'); }
    catch (err) { console.warn('[cosmos] スプライトを読めません。色付きの円で表示します。', err); }

    const game = new CosmosGame(C, Matter);
    game.highScore = Number(store.get(C.storageKeys.highScore, 0)) || 0;
    const board = new CosmosRender.BoardRenderer($('board'), game, sprites, C);
    const stars = new CosmosRender.StarField($('bg'), C);

    // ---- 画面（オーバーレイ） ----
    // タイトル画面は全面（#home）、それ以外は盤面の中央に出す
    const overlays = ['pausePanel', 'gameOverPanel', 'bhPanel', 'confirmPanel'];
    function show(id) {
      document.body.classList.toggle('at-title', id === 'title');
      overlays.forEach(o => { $(o).hidden = o !== id; });
    }

    function refreshTitle() {
      $('titleHigh').textContent = game.highScore.toLocaleString();
    }

    let confirmAction = null, confirmKey = '';
    function confirm(key, action) {
      confirmKey = key;
      $('confirmMsg').textContent = L.t(key);
      confirmAction = action;
      show('confirmPanel');
    }
    $('confirmYes').onclick = () => { const a = confirmAction; confirmAction = null; a && a(); };
    $('confirmNo').onclick = () => { confirmAction = null; show('pausePanel'); };

    function startGame() { game.start(); show(null); updateHud(true); }
    function toTitle() { game.toTitle(); refreshTitle(); show('title'); updateHud(true); }
    function togglePause() {
      if (game.controllable) { game.pause(); show('pausePanel'); }
      else if (game.state === 'PAUSE' && $('confirmPanel').hidden) { game.resume(); show(null); }
    }

    $('startBtn').onclick = startGame;
    $('pauseBtn').onclick = togglePause;
    $('resumeBtn').onclick = togglePause;
    $('restartBtn').onclick = () => confirm('confirmRestart', startGame);
    $('titleBtn').onclick = () => confirm('confirmTitle', toTitle);
    $('retryBtn').onclick = startGame;
    $('goTitleBtn').onclick = toTitle;
    $('bhRetryBtn').onclick = startGame;
    $('bhTitleBtn').onclick = toTitle;

    game.on('highScore', v => store.set(C.storageKeys.highScore, v));
    let goMaxStage = 1;
    game.on('gameOver', e => {
      $('goScore').textContent = e.score.toLocaleString();
      $('goHigh').textContent = e.high.toLocaleString();
      goMaxStage = e.maxStage;
      $('goMax').textContent = L.stageName(e.maxStage, C);
      $('goRecord').hidden = !e.newRecord;
      show('gameOverPanel');
    });
    game.on('superDone', e => {
      $('bhScore').textContent = e.score.toLocaleString();
      $('bhHigh').textContent = e.high.toLocaleString();
      $('bhRecord').hidden = !e.newRecord;
      show('bhPanel');
    });

    // ページが隠れたら自動で一時停止（第3.1節）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.controllable) { game.pause(); show('pausePanel'); }
    });

    // ---- 設定パネル（第18.4節）。開いてもゲームは進め、落下操作だけ止める ----
    const SET = Object.assign({}, C.settingsDefault, store.get(C.storageKeys.settings, {}));
    const saveSet = () => store.set(C.storageKeys.settings, SET);
    const sound = new CosmosSound(() => SET);
    function syncSetUI() {
      for (const p of ['', 'm']) {
        const id = k => $(p ? p + k[0].toUpperCase() + k.slice(1) : k);
        id('seVol').value = SET.se; id('seV').textContent = SET.se + '%'; id('seMute').checked = SET.seMute;
        id('bgmVol').value = SET.bgm; id('bgmV').textContent = SET.bgm + '%'; id('bgmMute').checked = SET.bgmMute;
      }
      sound.applyGain();
      $('eventsChk').checked = SET.events;
      $('debugChk').checked = SET.debugPanel;
      if (DEBUG) $('debugPanel').hidden = !SET.debugPanel;
    }
    function bindVol(vol, mute, key, mkey) {
      $(vol).addEventListener('input', e => { SET[key] = +e.target.value; if (SET[key] > 0) SET[mkey] = false; saveSet(); syncSetUI(); });
      $(mute).addEventListener('change', e => { SET[mkey] = e.target.checked; saveSet(); syncSetUI(); });
    }
    bindVol('seVol', 'seMute', 'se', 'seMute');
    bindVol('bgmVol', 'bgmMute', 'bgm', 'bgmMute');
    bindVol('mSeVol', 'mSeMute', 'se', 'seMute');
    bindVol('mBgmVol', 'mBgmMute', 'bgm', 'bgmMute');
    $('eventsChk').addEventListener('change', e => { SET.events = e.target.checked; saveSet(); });
    $('debugChk').addEventListener('change', e => { SET.debugPanel = e.target.checked; saveSet(); syncSetUI(); });
    $('debugRow').hidden = !DEBUG;

    const modalOpen = () => ['setPanel', 'creditsPanel', 'musicModal'].some(id => $(id).classList.contains('show'));
    function openModal(id) { syncSetUI(); ['setPanel', 'creditsPanel'].forEach(m => $(m).classList.toggle('show', m === id)); }
    function closeModals() { $('setPanel').classList.remove('show'); $('creditsPanel').classList.remove('show'); }
    $('gearBtn').onclick = () => { $('setPanel').classList.contains('show') ? closeModals() : openModal('setPanel'); };
    $('pauseSetBtn').onclick = () => openModal('setPanel');
    $('setClose').onclick = closeModals;
    $('creditsBtn').onclick = () => openModal('creditsPanel');
    $('creditsClose').onclick = () => openModal('setPanel');
    ['setPanel', 'creditsPanel'].forEach(id => $(id).addEventListener('pointerdown', e => { if (e.target === $(id)) closeModals(); }));
    syncSetUI();

    // ---- 音の許可パネル（第16.3節）。回答は保存せず、ページを開くたびに最初の1回だけ聞く ----
    const LONG_MS = 60 * 60 * 1000;
    let audioAsked = false, pendingAct = null, hiddenAt = 0;
    function closeMusic(play) {
      SET.seMute = SET.bgmMute = !play;
      saveSet();
      sound.unlock();
      syncSetUI();
      audioAsked = true;
      $('musicModal').classList.remove('show');
      const a = pendingAct; pendingAct = null; if (a) a();
    }
    $('musicYes').onclick = () => closeMusic(true);
    $('musicNo').onclick = () => closeMusic(false);
    // 音を出す操作（START・もう一度・再開）の最初のクリックを止めてパネルを出す
    document.addEventListener('click', e => {
      if (audioAsked) return;
      const b = e.target.closest && e.target.closest('#startBtn, #retryBtn, #bhRetryBtn, #resumeBtn');
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      pendingAct = () => b.click();
      syncSetUI();
      $('musicModal').classList.add('show');
    }, true);
    // 場面ごとの BGM（ブラックホール期も通常の曲。2026-10-29 作者の回答）
    function bgmForState(st) {
      if (st === 'TITLE') return 'lobby';
      if (st === 'GAMEOVER' || st === 'BH_SUPER_DONE') return sound.folder; // そのまま流す
      return 'game-cosmos';
    }
    game.on('state', st => sound.setFolder(bgmForState(st)));
    sound.setFolder('lobby');

    // ページが隠れたら音を止める。1時間以上たって戻ったら、次の操作でもう一度聞く（第16.3節）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); sound.suspend(); return; }
      if (audioAsked && hiddenAt && Date.now() - hiddenAt >= LONG_MS) audioAsked = false;
      else if (audioAsked) sound.resume();
    });

    const input = new CosmosInput($('board'), game, board, C, {
      togglePause: () => { if (modalOpen()) closeModals(); else togglePause(); }
    });
    input.enabled = () => !modalOpen();

    // ---- 言語（第24章）。切り替えてもゲームは止めない ----
    function applyLang() {
      document.documentElement.lang = L.htmlLang();
      document.querySelectorAll('[data-t]').forEach(el => { el.textContent = L.t(el.dataset.t); });
      document.querySelectorAll('[data-tb]').forEach(el => { el.textContent = L.tBase(el.dataset.tb); });
      document.querySelectorAll('[data-t-aria]').forEach(el => { const v = L.t(el.dataset.tAria); el.setAttribute('aria-label', v); el.title = v; });
      document.querySelectorAll('.site-header .subtitle').forEach(el => el.classList.toggle('zh', L.baseLang() === 'zh'));
      if (confirmKey) $('confirmMsg').textContent = L.t(confirmKey);
      $('goMax').textContent = L.stageName(goMaxStage, C);
      $('langSelect').value = L.mode;
    }
    $('langSelect').addEventListener('change', e => L.setMode(e.target.value));
    L.onChange(applyLang);
    L.onChange(() => updateHud(true));
    applyLang();
    board.t = L.t;

    // ---- 情報ヘッダー ----
    let last = {};
    function updateHud(force) {
      const s = game.score, h = Math.max(game.highScore, s), n = game.nextStage, nn = game.nextNextStage;
      if (force || last.s !== s) $('hudScore').textContent = s.toLocaleString();
      if (force || last.h !== h) $('hudHigh').textContent = h.toLocaleString();
      if (force || last.n !== n) board.drawIcon($('nextIcon'), n);
      if (force || last.nn !== nn) board.drawIcon($('nextNextIcon'), nn);
      // 成長ゲージ（超巨大＝成長値 600 で満タン）
      const bh = game.bh, gw = bh ? Math.min(1, bh.growth / C.bh.superGrowth) : -1, tier = bh ? bh.tier : -1;
      if (force || last.gw !== gw) {
        $('bhGauge').hidden = !bh;
        if (bh) $('bhFill').style.width = (gw * 100).toFixed(1) + '%';
      }
      if (force || last.tier !== tier) { if (bh) $('bhTier').textContent = L.t('bhTier' + tier); }
      last = { s, h, n, nn, gw, tier };
    }

    // ---- 配置（盤面は 2:3 で、使える領域に収める） ----
    function layout() {
      const wrap = $('boardWrap');
      const aw = wrap.clientWidth, ah = wrap.clientHeight;
      let h = Math.min(ah, aw * 1.5);
      if (document.body.classList.contains('wide')) h = Math.min(h, innerHeight * 0.85);
      h = Math.floor(h);
      const w = Math.floor(h / 1.5);
      board.resize(w, h);
      $('boardFrame').style.width = w + 'px';
      $('boardFrame').style.height = h + 'px';
      stars.resize();
      updateHud(true);
    }
    function applyOrientation() {
      document.body.classList.toggle('wide', innerWidth / innerHeight >= 1);
    }
    applyOrientation();
    let raf = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { applyOrientation(); layout(); }); });
    layout();

    // ---- デバッグ（?debug=1、第9.4節） ----
    if (DEBUG) { setupDebug(game); syncSetUI(); }

    // ---- ループ ----
    let prev = performance.now(), fpsAcc = 0, fpsN = 0;
    function frame(now) {
      const dt = Math.min((now - prev) / 1000, 0.1); prev = now;
      input.update(dt);
      game.update(dt);
      stars.draw(now / 1000, reducedMotion);
      board.draw();
      updateHud(false);
      if (DEBUG) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { debugInfo(game, fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; } }
      requestAnimationFrame(frame);
    }
    refreshTitle();
    show('title');
    requestAnimationFrame(frame);
    window.cosmos = { game, board, C, settings: SET, sound }; // コンソールからの確認用
  }

  // ---- デバッグ用パネル ----
  function setupDebug(game) {
    const p = $('debugPanel');
    p.hidden = false;
    $('dbgHead').onclick = () => { const b = $('dbgBody'); b.hidden = !b.hidden; $('dbgHead').textContent = b.hidden ? 'DEBUG ▸' : 'DEBUG ▾（タップで折りたたみ）'; };
    const stageRow = $('dbgStages');
    for (let s = 1; s <= 12; s++) {
      const b = document.createElement('button');
      b.textContent = s; b.title = L.stageName(s, C);
      b.onclick = () => {
        game.forcedStage = game.forcedStage === s ? 0 : s;
        stageRow.querySelectorAll('button').forEach((x, i) => x.classList.toggle('on', i + 1 === game.forcedStage));
      };
      stageRow.appendChild(b);
    }
    const speedRow = $('dbgSpeeds');
    [0.25, 0.5, 1, 2, 4].forEach(v => {
      const b = document.createElement('button');
      b.textContent = '×' + v;
      b.classList.toggle('on', v === 1);
      b.onclick = () => { game.speed = v; speedRow.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      speedRow.appendChild(b);
    });
    $('dbgToBH').onclick = () => game.debugToBH();
    $('dbgGrow').onclick = () => game.debugGrow(100);
  }
  function debugInfo(game, fps) {
    const [lo, hi] = game.spawnRange();
    $('dbgInfo').textContent =
      'fps ' + fps.toFixed(0) + ' / bodies ' + game.bodies().length + ' / t ' + game.time.toFixed(0) + 's / drops ' + game.dropCount +
      ' / max ' + game.maxStage + ' / range ' + lo + '-' + hi + ' / over ' + game.overTime.toFixed(1) + 's' +
      ' / ' + game.state + (game.bh ? ' / growth ' + game.bh.growth.toFixed(0) + ' r ' + game.bh.r.toFixed(0) : '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
