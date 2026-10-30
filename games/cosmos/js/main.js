/*
 * MOMO Cosmos — 起動と画面の切り替え
 * M1 後半：共通の画面の枠（タイトル画面・右上の歯車と言語・設定パネル・クレジット・4言語）
 * M3：エンディング（最終吸収・静寂・ビッグバン・エンドロール。演出は ending.js）
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
    game.clearCount = Number(store.get(C.storageKeys.clearCount, 0)) || 0;
    const board = new CosmosRender.BoardRenderer($('board'), game, sprites, C);
    const stars = new CosmosRender.StarField($('bg'), C);
    const ending = new CosmosEnding($('fx'), game, board, $('board'), sprites, C);

    // ---- 画面（オーバーレイ） ----
    // タイトル画面は全面（#home）、それ以外は盤面の中央に出す
    const overlays = ['pausePanel', 'gameOverPanel', 'confirmPanel'];
    function show(id) {
      document.body.classList.toggle('at-title', id === 'title');
      overlays.forEach(o => { $(o).hidden = o !== id; });
    }

    function refreshTitle() {
      $('titleHigh').textContent = game.highScore.toLocaleString();
      $('titleClear').hidden = !game.clearCount;     // クリアの印（第13.3節）
      $('titleClearN').textContent = game.clearCount;
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
      if (game.controllable) { game.pause(); show('pausePanel'); sound.se('pause'); }
      else if (game.state === 'PAUSE' && $('confirmPanel').hidden) { game.resume(); show(null); }
    }

    $('startBtn').onclick = startGame;
    $('pauseBtn').onclick = togglePause;
    $('resumeBtn').onclick = togglePause;
    $('restartBtn').onclick = () => confirm('confirmRestart', startGame);
    $('titleBtn').onclick = () => confirm('confirmTitle', toTitle);
    $('retryBtn').onclick = startGame;
    $('goTitleBtn').onclick = toTitle;

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

    // ---- エンディング（第12章・第13章） ----
    const fmtTime = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s2 = String(sec % 60).padStart(2, '0');
      return h ? h + ':' + String(m).padStart(2, '0') + ':' + s2 : m + ':' + s2; };
    game.on('clear', e => {
      store.set(C.storageKeys.clearCount, e.count);
      $('endScore').textContent = e.score.toLocaleString();
      $('endTime').textContent = fmtTime(e.playTime);
      $('endClears').textContent = e.count;
      $('endRecord').hidden = !e.newRecord;
    });
    game.on('state', st => {
      const B = document.body;
      if (st === 'FINAL_ABSORB') {
        // 情報ヘッダーと一時停止ボタンを Canvas に描き写してから隠す。盤面の箱も ending.js が描く
        ending.reset();
        ending.capture([$('hud'), $('pauseBar')]);
        board.bare = true;
        B.classList.add('ui-gone');
      } else if (st === 'BIGBANG') {
        closeModals();
        B.classList.add('bare');
      } else if (st === 'ENDROLL') {
        B.classList.add('rolling');
        $('endroll').classList.remove('results');
        $('rollEnd').hidden = true;
        $('rollHint').hidden = !game.rollSkippable;
        recipeAt = -1; recipeEnded = false;
      } else if (st === 'TITLE' || st === 'PLAY') {
        B.classList.remove('ui-gone', 'bare', 'rolling');
        ending.reset();
      }
    });
    // つなぎの文が出たら、初回のクリアでも飛ばせる（レシピは見なくてもよい。2026-10-30 作者の指示）
    game.on('rollDone', () => { $('rollHint').hidden = false; });
    // エンドロールのタップ・キー：
    //   流れている間 … スキップ（2回目のクリアから）
    //   止まったあと … 結果を出す（曲はそのまま流れ続ける）→ もう一度でタイトルへ
    function tapRoll() {
      if (game.state !== 'ENDROLL') return;
      if (!game.rollDone) game.skipRoll();
      else if ($('rollEnd').hidden) { $('endroll').classList.add('results'); $('rollEnd').hidden = false; $('rollHint').hidden = true; }
      else toTitle();
    }
    $('endroll').addEventListener('click', tapRoll);
    document.addEventListener('keydown', e => {
      if (game.state !== 'ENDROLL' || e.repeat || /^(Shift|Control|Alt|Meta)$/.test(e.key)) return;
      e.preventDefault(); tapRoll();
    });
    // クレジットを下から上へ一定の速さで流す。「Thank you for playing」は画面の上部まで来たらそこに残し、
    // つなぎの文はその下まで来たら止める。レシピはつなぎの文の下に出す
    function scrollRoll() {
      const E = C.ending, el = $('rollText'), th = $('rollThanks'), lead = $('rollLead'), H = innerHeight;
      const thanksY = H * E.thanksStopAt, leadY = thanksY + th.offsetHeight + H * E.leadGap;
      const dist = H - leadY + lead.offsetTop;
      if (!game.rollDone) game.rollSec = dist / E.rollPxPerSec;
      const y = H - Math.min(dist, game.endT * E.rollPxPerSec);
      el.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
      const over = thanksY - (y + th.offsetTop);
      th.style.transform = over > 0 ? 'translateY(' + over.toFixed(1) + 'px)' : '';
      $('rollRecipe').style.top = (leadY + lead.offsetHeight + H * 0.06).toFixed(0) + 'px';
      showRecipe();
    }
    // 曲の時刻（秒）・長さ・何周目か。周は sound.js が曲の終わりで数える（画面が止まっていても数え漏れない）。
    // 音を出せない環境では、曲が鳴り始めてからの時刻（ビッグバンの途中から）と仮の長さで数える
    function songClock() {
      const cur = sound.cur, el = cur && cur.folder === 'ending-cosmos' && cur.el;
      if (el && isFinite(el.duration) && el.duration > 0) return { t: el.currentTime, d: el.duration, loop: sound.loops + 1 };
      const E = C.ending, d = E.songSecFallback, tt = E.bigbangSec - E.musicAt + game.endT;
      return { t: tt % d, d, loop: Math.floor(tt / d) + 1 };
    }
    // レシピ：曲の2周目の終わり近くに1回だけ、ブロックを1つずつ（interval 秒ごとに）浮かび上がらせる。
    // 最後の締めの言葉は、出たらそのまま残す（2026-10-30 作者の指示）
    let recipeAt = -1, recipeEnded = false;
    function showRecipe() {
      const E = C.ending, blocks = $('rollRecipe').children, n = blocks.length;
      let idx = recipeEnded ? n - 1 : -1;
      if (game.rollDone && !recipeEnded) {
        const { t, d, loop } = songClock(), start = d - n * E.recipeIntervalSec;
        if (loop === E.recipeLoop && t >= start) idx = Math.min(n - 1, Math.floor((t - start) / E.recipeIntervalSec));
        if (idx === n - 1) recipeEnded = true;
      }
      if (idx === recipeAt) return;
      recipeAt = idx;
      for (let i = 0; i < n; i++) blocks[i].classList.toggle('show', i === idx);
    }
    // つなぎの文とレシピのブロックを作る（英語だけ）。料理名＋材料／PHASE 1〜5／締め の7つ
    function buildRecipe() {
      const rows = L.en('recipe') || [], lead = $('rollLead'), box = $('rollRecipe');
      lead.textContent = ''; box.textContent = '';
      let blk = null, prev = '';
      rows.forEach(([k, text]) => {
        const p = document.createElement('p');
        p.className = 'rc-' + k;
        p.textContent = text;
        if (k === 'p' && !blk) { lead.appendChild(p); return; }
        if (k === 't' || (k === 'h' && /^PHASE/.test(text)) || (k === 'e' && prev !== 'e')) {
          blk = document.createElement('div'); blk.className = 'rc-block'; box.appendChild(blk);
        }
        blk.appendChild(p); prev = k;
      });
    }
    buildRecipe();
    // 出演者（Cast）：天体の絵・名前・役名。ブラックホールだけ役名を付ける（作者の回答 Q2=A）
    (function buildCast() {
      const names = ['', 'The Moon', 'Mercury', 'Mars', 'Venus', 'Earth', 'Neptune', 'Uranus', 'Saturn', 'Jupiter', 'The Sun', 'Supernova', 'Neutron Star', 'Black Hole'];
      const box = $('rollCast');
      for (let s = 1; s < names.length; s++) {
        const img = document.createElement('img');
        img.src = 'assets/img/' + C.stages[s].spriteKey + '.webp'; img.alt = '';
        const n = document.createElement('span'); n.className = 'cast-name'; n.textContent = names[s];
        const r = document.createElement('span'); r.className = 'cast-role'; r.textContent = s === 13 ? 'as The Devourer' : 'as itself';
        box.append(img, n, r);
      }
    })();
    // エンドロールの丸文字は、出てから切り替わらないよう先に読み込んでおく（英字の分だけ）
    if (document.fonts) ['400', '700', '800'].forEach(w => document.fonts.load(w + ' 16px "M PLUS Rounded 1c"', 'A').catch(() => {}));

    // ページが隠れたら自動で一時停止（第3.1節）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.controllable) { game.pause(); show('pausePanel'); }
    });

    // ---- 設定パネル（第18.4節）。開いてもゲームは進め、落下操作だけ止める ----
    const SET = Object.assign({}, C.settingsDefault, store.get(C.storageKeys.settings, {}));
    const saveSet = () => store.set(C.storageKeys.settings, SET);
    const sound = new CosmosSound(() => SET, C.se);
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
      const b = e.target.closest && e.target.closest('#startBtn, #retryBtn, #resumeBtn');
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      pendingAct = () => b.click();
      syncSetUI();
      $('musicModal').classList.add('show');
    }, true);
    // 場面ごとの BGM（ブラックホール期も通常の曲。2026-10-29 作者の回答）
    // 最終吸収で徐々に小さくし、静寂とビッグバンの前半は無音。エンディングの曲は画面が真っ白になったところから鳴らす
    // （2026-10-30 作者の指示。その前はエンドロールの始まりからだった）
    function bgmForState(st) {
      if (st === 'TITLE') return 'lobby';
      if (st === 'GAMEOVER' || st === 'FINAL_ABSORB') return sound.folder; // そのまま流す
      if (st === 'ENDROLL') return 'ending-cosmos';
      if (st === 'SILENCE' || st === 'BIGBANG') return null;   // BIGBANG の途中で endingMusic が鳴らし始める
      return 'game-cosmos';
    }
    game.on('state', st => {
      if (st === 'TITLE' || st === 'PLAY') sound.scene(1, 0);
      if (st === 'FINAL_ABSORB') sound.scene(0, C.ending.bgmFadeSec);
      sound.setFolder(bgmForState(st));
    });
    game.on('endingMusic', () => { sound.scene(1, 0); sound.setFolder('ending-cosmos'); });

    // ---- 効果音（第16章。2026-10-30 作者が試聴して決めた） ----
    const SE = C.se;
    game.on('impact', e => { if (e.v >= SE.landMinSpeed) sound.se('land', { vol: Math.min(1, e.v / SE.landFullSpeed) }); });
    game.on('drop', () => sound.se('drop'));
    game.on('merge', e => sound.se('merge', { rate: Math.pow(2, (7 - e.stage) / 9) }));   // 小さい天体ほど高く、大きいほど低く
    game.on('bhAppear', () => sound.se('bhBirth'));
    game.on('bhTier', () => sound.se('bhTier'));
    game.on('absorb', () => sound.se('absorb'));
    game.on('warning', on => { if (on) sound.se('warn'); });
    game.on('bigbangFlash', () => { sound.se('bigbang'); sound.rumble(); });   // 白い点と線のあとの爆発
    // ボタンの音（一時停止ボタンは一時停止の音。デバッグ用パネルは鳴らさない）
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button');
      if (!b || b.id === 'pauseBtn' || b.closest('#debugPanel')) return;
      sound.se('button');
    });
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
      ending.resize();
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
      ending.draw(game.running ? dt * game.speed : 0);
      if (game.state === 'ENDROLL') scrollRoll();
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
    $('dbgToEnd').onclick = () => game.debugToEnding();
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
