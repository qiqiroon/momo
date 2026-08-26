/**
 * MOMO Billiards — 画面・操作・進行
 * 仕様書 momo_billiards_spec.md 第2章（選択画面）／第4章（描画とショット）／
 *        第8章8.4節（持ち時間制）／第9章（対戦形式）／第10章（例外処理）
 *
 * この層は「入力までと、描くところ」を担当する。玉がどう動くかは engine.js、
 * 何が反則で誰が勝つかは rules.js が持つ。両者はここから呼ぶだけで、逆向きの依存は無い。
 */
(function () {
  'use strict';

  const APP_VER = '1.00';                 // 第1段階のリリース（11.8.1節）。デプロイのたびに +0.01
  const T = BilliardsTable, E = BilliardsEngine, RU = BilliardsRules;
  const I = BilliardsI18N, AU = BilliardsAudio, NET = BilliardsNet;
  const t = (k, p) => I.t(k, p);
  const $ = id => document.getElementById(id);

  // ───────── 段階の割り当て（11.2.3節）。未実装は表示するが選べない（11.6.1節） ─────────
  const STAGE = {
    rule: { 'G-01': 1, 'G-02': 1, 'G-03': 1, 'G-04': 1, 'G-06': 3, 'G-08': 3, 'G-09': 3, 'G-10': 3, 'G-11': 3 },
    shape: { 'A-01': 1, 'A-02': 3, 'A-04': 3, 'A-06': 3, 'A-07': 3, 'A-08': 3, 'A-09': 3, 'A-11': 3 },
    mode: { normal: 1, disturb: 3, abnormal: 3 },
    mod: { 'G-13': 3, 'G-14': 1, 'G-15': 3 },
    // 通信対戦・観戦は本来 第2/第3段階だが、制作指示により前倒しで搭載している
    format: { local: 1, ai: 1, practice: 1, online: 2, coop: 9 },
  };
  const SPECIAL = {
    rule: { 'G-06': 1, 'G-08': 1, 'G-09': 1, 'G-10': 1, 'G-11': 1 },
    shape: { 'A-02': 1, 'A-04': 1, 'A-06': 1, 'A-07': 1, 'A-08': 1, 'A-09': 1, 'A-11': 1 },
    mode: { disturb: 1, abnormal: 1 },
    mod: { 'G-13': 1, 'G-15': 1 },
    diff: { apocalypse: 1 },
  };
  const RULES_ALL = ['G-01', 'G-02', 'G-03', 'G-04', 'G-06', 'G-08', 'G-09', 'G-10', 'G-11'];
  const SHAPES_ALL = ['A-01', 'A-02', 'A-04', 'A-06', 'A-07', 'A-08', 'A-09', 'A-11'];
  const CUE_KEYS = ['doubleHit', 'miscue', 'throwEffect', 'cushionSpin', 'spinTransfer', 'wallSlide', 'cueWall'];

  // ───────── 状態 ─────────
  const S = {
    screen: 'title',
    cfg: {
      scope: 'standard',
      rule: 'G-01', shape: 'A-01', carom: false, tableChosen: true,
      mode: 'normal',
      mods: { 'G-13': false, 'G-14': true, 'G-15': false },
      diff: 'easy',
      cue: [false, false, false, false, false, false, false],   // 撞球の癖7項目（既定=簡単）
      players: 2, aiCount: 1, format: 'local',
      target: 10, tbase: 30, tbank: 5,
    },
    game: null,
    phase: 'idle',         // idle|place|aim|stance|rolling|wait|over
    aim: { dir: Math.PI, tipX: 0, tipY: 0, elev: 0, power: 0 },
    elevFan: null,
    aimPreview: null, aimDirty: true,
    drag: null,
    placePos: null,
    msg: '',
    replay: null, replayRun: null,
    // 時間（8.4節）
    clock: { baseLeft: 0, banks: [], running: false, last: 0 },
    // 通信
    net: { on: false, role: 'none', isHost: false, roomId: null, myIdx: -1, roster: [], names: [], pending: [] },
    aiCancel: null,
    confirmCb: null,
  };

  // ══════════════════════════════════════════════
  //  言語
  // ══════════════════════════════════════════════
  function applyLang() {
    const bl = I.brandLang();
    const sub = $('subtitle');
    sub.textContent = (bl === 'zh') ? '百变球台，一杆入魂' : 'Any Shape, Any Rule, One Cue';
    sub.classList.toggle('zh', bl === 'zh');
    document.documentElement.lang = (bl === 'zh') ? 'zh' : bl;

    const set = (id, k) => { const e = $(id); if (e) e.textContent = t(k); };
    set('title-lead', 'title.lead'); set('btn-title-play', 'title.play');
    set('crumb-setup', 'nav.setup'); set('crumb-lobby', 'lobby.title');
    set('lbl-rule', 'axis.rule'); set('lbl-table', 'axis.table'); set('lbl-mode', 'axis.mode');
    set('lbl-mod', 'axis.mod'); set('lbl-diff', 'axis.diff'); set('lbl-cue', 'cue.title');
    set('cue-note', 'cue.note'); set('lbl-format', 'opt.format');
    set('lbl-players', 'opt.players'); set('lbl-aicount', 'opt.aiCount'); set('lbl-target', 'opt.target');
    set('lbl-tbase', 'opt.time.base'); set('lbl-tbank', 'opt.time.bank');
    set('u-sec', 'opt.sec'); set('u-min', 'opt.min');
    set('btn-start', 'btn.start');
    set('btn-settings-1', 'btn.settings'); set('btn-settings-2', 'btn.settings');
    set('k-turn', 'hud.turn'); set('k-next', 'hud.next'); set('k-foul', 'hud.foul');
    set('k-base', 'hud.base'); set('k-bank', 'hud.time');
    set('btn-replay', 'btn.replay'); set('btn-deadlock', 'btn.deadlock'); set('btn-quit', 'btn.quit');
    set('btn-again', 'res.again'); set('btn-to-setup', 'res.toSetup'); set('res-title', 'res.title');
    set('audio-title', 'audio.title'); set('audio-desc', 'audio.desc');
    set('btn-audio-yes', 'audio.yes'); set('btn-audio-no', 'audio.no');
    set('set-title', 'set.title'); set('set-bgm', 'set.bgm'); set('set-sfx', 'set.sfx');
    set('set-mute1', 'set.mute'); set('set-mute2', 'set.mute'); set('btn-set-close', 'nav.close');
    set('dl-title', 'dl.title'); set('dl-ask', 'dl.ask');
    set('btn-dl-yes', 'btn.yes'); set('btn-dl-no', 'btn.no'); set('btn-note-close', 'nav.close');
    set('lbl-myname', 'lobby.name'); set('lbl-roomname', 'lobby.room'); set('lbl-pw', 'lobby.pw');
    set('lbl-private', 'lobby.private'); set('btn-create', 'lobby.create'); set('lbl-create', 'lobby.create');
    set('lbl-rooms', 'lobby.rooms'); set('btn-refresh', 'lobby.refresh');
    set('btn-lobby-back', 'nav.back'); set('btn-room-start', 'lobby.startGame'); set('btn-room-leave', 'nav.back');
    $('seg-scope').children[0].textContent = t('sw.standard');
    $('seg-scope').children[1].textContent = t('sw.special');
    $('seg-cue').children[0].textContent = t('cue.simple');
    $('seg-cue').children[1].textContent = t('cue.real');
    $('seg-cue').children[2].textContent = t('cue.custom');
    $('btn-aim').textContent = (S.phase === 'stance') ? t('btn.back2d') : t('btn.aim');
    $('lang-select').value = I.mode;
    buildSetup();
    renderHUD();
    renderRooms(S.net.lastRooms || []);
  }

  // ══════════════════════════════════════════════
  //  ゲーム選択画面（第2章）
  // ══════════════════════════════════════════════
  function chip(label, sel, dis, why, onClick) {
    const d = document.createElement('div');
    d.className = 'opt' + (sel ? ' sel' : '') + (dis ? ' dis' : '');
    d.textContent = label;
    if (why) { const s = document.createElement('span'); s.className = 'why'; s.textContent = why; d.appendChild(s); }
    if (!dis) d.onclick = () => { AU.sfx('select'); onClick(); };
    return d;
  }

  /**
   * 選択不可・自動無効化・段階による未実装をまとめて返す（2.4節・11.6.1節）。
   *
   * ルールと台形状は互いに成立可否を持つが、両方向へグレーを掛けると
   * どちらからも抜け出せない組合せ（例：ナインボール＋ポケットあり台から
   * キャロムへ移れない）が生まれる。そこで**グレーは台形状の側にだけ掛け**、
   * ルールを選び直した結果として台が成立しなくなったときは、
   * 2.5.3節のとおり台の選択を解除して選び直しを求める。自動で振り替えない。
   */
  function ruleBlock(id) {
    if (STAGE.rule[id] >= 3) return t('why.stage3');
    if (id === 'G-02' && S.cfg.players > 2) return t('why.twoOnly');
    return null;
  }
  function shapeBlock(shape, carom) {
    if (STAGE.shape[shape] >= 3) return t('why.stage3');
    const r = S.cfg.rule;
    if (carom && (r === 'G-01' || r === 'G-02' || r === 'G-03' || r === 'G-08' || r === 'G-10')) return t('why.pocketOnly');
    if (!carom && r === 'G-04') return t('why.caromOnly');
    return null;
  }
  function tableNeedsCarom(rule) { return rule === 'G-04'; }
  function modeBlock(m) {
    if (STAGE.mode[m] >= 3) return t('why.stage3');
    if (m === 'normal' && S.cfg.diff === 'apocalypse') return t('why.needGimmick');
    return null;
  }
  function modBlock(m) {
    if (STAGE.mod[m] >= 3) return t('why.stage3');
    if (m === 'G-13' && S.cfg.rule !== 'G-03' && S.cfg.rule !== 'G-04') return t('why.noScore');
    return null;
  }
  function diffBlock(d) {
    if (d === 'apocalypse' && S.cfg.mode === 'normal') return t('why.noGimmick');
    return null;
  }
  function formatBlock(f) {
    if (STAGE.format[f] >= 9) return t('why.stage2');
    if (f === 'practice' && S.cfg.players !== 1) return null;
    return null;
  }

  function visible(kind, id) {
    if (S.cfg.scope === 'special') return true;
    return !(SPECIAL[kind] && SPECIAL[kind][id]);
  }

  function buildSetup() {
    // ── ルール
    const or = $('opts-rule'); or.innerHTML = '';
    RULES_ALL.forEach(id => {
      if (!visible('rule', id)) return;
      const why = ruleBlock(id);
      or.appendChild(chip(t('rule.' + id), S.cfg.rule === id, !!why, why, () => { S.cfg.rule = id; onRuleChanged(); }));
    });
    // ── 台形状（8形状 × ポケット有無）
    const ot = $('opts-table'); ot.innerHTML = '';
    SHAPES_ALL.forEach(sh => {
      if (!visible('shape', sh)) return;
      [false, true].forEach(carom => {
        const why = shapeBlock(sh, carom);
        const label = t('shape.' + sh) + '（' + t(carom ? 'tbl.carom' : 'tbl.pocket') + '）';
        const sel = S.cfg.tableChosen && (S.cfg.shape === sh && S.cfg.carom === carom);
        ot.appendChild(chip(label, sel, !!why, why, () => {
          S.cfg.shape = sh; S.cfg.carom = carom; S.cfg.tableChosen = true; buildSetup();
        }));
      });
    });
    // ── モード
    const om = $('opts-mode'); om.innerHTML = '';
    ['normal', 'disturb', 'abnormal'].forEach(m => {
      if (!visible('mode', m)) return;
      const why = modeBlock(m);
      om.appendChild(chip(t('mode.' + m), S.cfg.mode === m, !!why, why, () => { S.cfg.mode = m; buildSetup(); }));
    });
    // ── 修飾子（複数選択可）
    const od = $('opts-mod'); od.innerHTML = '';
    ['G-13', 'G-14', 'G-15'].forEach(m => {
      if (!visible('mod', m)) return;
      const why = modBlock(m);
      od.appendChild(chip(t('mod.' + m), !!S.cfg.mods[m] && !why, !!why, why, () => { S.cfg.mods[m] = !S.cfg.mods[m]; buildSetup(); }));
    });
    // ── 難易度（呼び名は訳さない＝MOMO 共通）
    const of = $('opts-diff'); of.innerHTML = '';
    ['easy', 'hard', 'apocalypse'].forEach(d => {
      if (!visible('diff', d)) return;
      const why = diffBlock(d);
      of.appendChild(chip(I.DIFF_LABEL[d], S.cfg.diff === d, !!why, why, () => {
        S.cfg.diff = d;
        // 難易度は撞球の癖の既定値を与える（2.3.5節③）。以後の変更は妨げない
        setCuePreset(d === 'easy' ? 'simple' : 'real');
        buildSetup();
      }));
    });
    // ── 対戦形式
    const ofm = $('opts-format'); ofm.innerHTML = '';
    ['local', 'ai', 'practice', 'online', 'coop'].forEach(f => {
      const why = formatBlock(f);
      ofm.appendChild(chip(t('fmt.' + f), S.cfg.format === f, !!why, why, () => { S.cfg.format = f; syncPlayers(); buildSetup(); }));
    });

    // ── 上位スイッチ・撞球の癖の見た目
    [].forEach.call($('seg-scope').children, b => b.classList.toggle('sel', b.dataset.v === S.cfg.scope));
    $('scope-desc').textContent = t(S.cfg.scope === 'standard' ? 'sw.desc.standard' : 'sw.desc.special');
    const preset = cuePresetName();
    [].forEach.call($('seg-cue').children, b => b.classList.toggle('sel', b.dataset.v === preset));

    const ci = $('cue-items'); ci.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const lab = document.createElement('label'); lab.className = 'chk';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = S.cfg.cue[i];
      cb.onchange = () => { S.cfg.cue[i] = cb.checked; buildSetup(); };
      const sp = document.createElement('span'); sp.textContent = t('cue.i' + (i + 1));
      lab.appendChild(cb); lab.appendChild(sp); ci.appendChild(lab);
    }

    // ── 人数・AI人数・目標点・時間
    const selP = $('sel-players');
    const minP = (S.cfg.format === 'practice') ? 1 : (S.cfg.format === 'ai' ? 1 : 2);
    const maxP = (S.cfg.rule === 'G-02') ? 2 : 4;
    selP.innerHTML = '';
    for (let n = minP; n <= maxP; n++) {
      const o = document.createElement('option'); o.value = n; o.textContent = n; selP.appendChild(o);
    }
    if (S.cfg.players < minP) S.cfg.players = minP;
    if (S.cfg.players > maxP) S.cfg.players = maxP;
    selP.value = S.cfg.players;

    $('wrap-ai').style.display = (S.cfg.format === 'ai') ? '' : 'none';
    const selA = $('sel-aicount'); selA.innerHTML = '';
    for (let n = 1; n <= Math.max(1, maxP - 1); n++) {
      const o = document.createElement('option'); o.value = n; o.textContent = n; selA.appendChild(o);
    }
    if (S.cfg.aiCount > maxP - 1) S.cfg.aiCount = Math.max(1, maxP - 1);
    selA.value = S.cfg.aiCount;
    $('wrap-target').style.display = (S.cfg.rule === 'G-04') ? '' : 'none';
    $('in-target').value = S.cfg.target;
    $('wrap-time').style.display = S.cfg.mods['G-14'] ? '' : 'none';
    $('in-tbase').value = S.cfg.tbase; $('in-tbank').value = S.cfg.tbank;

    $('btn-start').textContent = (S.cfg.format === 'online') ? t('lobby.title') : t('btn.start');
    // 修飾子を除く4軸が選ばれ、選択不可の組合せを含まないとき開始できる（2.5.4節）
    $('btn-start').disabled = !S.cfg.tableChosen || !!ruleBlock(S.cfg.rule) || !!shapeBlock(S.cfg.shape, S.cfg.carom);
  }

  function onRuleChanged() {
    // ルール×台形状が成立しなくなったら、選択を解除して選び直しを求める（2.5.3節）。
    // 自動的に別の台へ振り替えることはしない。
    if (S.cfg.tableChosen && shapeBlock(S.cfg.shape, S.cfg.carom)) S.cfg.tableChosen = false;
    if (S.cfg.rule === 'G-02' && S.cfg.players > 2) S.cfg.players = 2;
    if (S.cfg.mods['G-13'] && modBlock('G-13')) S.cfg.mods['G-13'] = false;
    buildSetup();
  }
  function syncPlayers() {
    if (S.cfg.format === 'practice') S.cfg.players = 1;
    else if (S.cfg.players < 2) S.cfg.players = 2;
  }
  function cuePresetName() {
    const on = S.cfg.cue.filter(Boolean).length;
    if (on === 0) return 'simple';
    if (on === 7) return 'real';
    return 'custom';
  }
  function setCuePreset(p) {
    if (p === 'simple') S.cfg.cue = [false, false, false, false, false, false, false];
    else if (p === 'real') S.cfg.cue = [true, true, true, true, true, true, true];
  }
  function tuningFromCfg() {
    return {
      doubleHit: S.cfg.cue[0], miscue: S.cfg.cue[1], throwEffect: S.cfg.cue[2],
      cushionSpin: S.cfg.cue[3], spinTransfer: S.cfg.cue[4], wallSlide: S.cfg.cue[5],
    };
  }

  // ══════════════════════════════════════════════
  //  画面遷移
  // ══════════════════════════════════════════════
  function show(name) {
    S.screen = name;
    ['title', 'setup', 'lobby', 'room', 'play', 'result'].forEach(n => {
      $('scr-' + n).classList.toggle('on', n === name);
    });
    AU.setBgm(name === 'play' ? 'game' : 'lobby');
    if (name === 'play') resizeBoard();
  }

  // ══════════════════════════════════════════════
  //  ゲームの開始
  // ══════════════════════════════════════════════
  function playerList() {
    const list = [];
    if (S.cfg.format === 'practice') { list.push({ name: 'You', type: 'human' }); return list; }
    if (S.cfg.format === 'ai') {
      list.push({ name: 'You', type: 'human' });
      for (let i = 0; i < S.cfg.aiCount; i++) list.push({ name: 'AI' + (i + 1), type: 'ai' });
      return list;
    }
    for (let i = 0; i < S.cfg.players; i++) list.push({ name: 'P' + (i + 1), type: 'human' });
    return list;
  }

  function startGame(seed, players, remoteCfg) {
    const cfg = remoteCfg || S.cfg;
    if (remoteCfg) Object.assign(S.cfg, remoteCfg);   // 通信対戦はホストの設定を強制適用（9.5.3節）
    const g = RU.createGame({
      rule: cfg.rule,
      hasPockets: !cfg.carom,
      players: players || playerList(),
      seed: seed >>> 0,
      difficulty: cfg.diff,
      tuning: tuningFromCfg(),
      targets: null,
    });
    g.players.forEach(p => { p.target = (cfg.rule === 'G-04') ? cfg.target : p.target; });
    S.game = g;
    S.replay = null;
    S.clock.banks = g.players.map(() => cfg.tbase != null ? (cfg.tbank * 60) : 0);
    S.aim = { dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0 };
    S.msg = '';
    show('play');
    beginTurn();
  }

  function isMyTurn() {
    const g = S.game; if (!g || g.over) return false;
    if (S.net.on) {
      if (S.net.role === 'spectator') return false;
      return g.turn === S.net.myIdx;
    }
    return g.players[g.turn].type === 'human';
  }

  function beginTurn() {
    const g = S.game;
    if (!g || g.over) return;
    S.aim.power = 0; S.aim.tipX = 0; S.aim.tipY = 0; S.aim.elev = 0;
    S.aimDirty = true; S.pendingPlace = null;
    const cue = RU.cueBallOf(g, g.turn);
    if (cue) {
      // 既定の狙いは「フット側（+X）へ向かって」＝画面の奥。方向は毎ターン取り直す
      S.aim.dir = 0;
      computeElevFan(cue);
    }
    // 手玉の配置（4.5節）
    if (g.ballInHand && cue) {
      S.phase = 'place';
      S.placePos = { x: cue.x, y: cue.y };
    } else {
      S.phase = 'aim';
    }
    // 時間の計測は「操作が可能になった瞬間」から（8.4.3節）
    S.clock.baseLeft = S.cfg.mods['G-14'] ? S.cfg.tbase : 0;
    S.clock.running = S.cfg.mods['G-14'] && isMyTurn() && g.players[g.turn].type === 'human';
    S.clock.last = performance.now();

    if (g.players[g.turn].type === 'ai') {
      S.phase = 'wait';
      setMsg(t('ph.thinking'));
      let aiPlace = null;
      if (g.ballInHand) {
        aiPlace = BilliardsAI.pickBallInHand(g, g.turn);
        RU.place(cue, aiPlace.x, aiPlace.y);
        g.ballInHand = false;
      }
      if (S.aiCancel) S.aiCancel();
      S.aiCancel = BilliardsAI.think(g, g.turn, shot => {
        S.aiCancel = null;
        setTimeout(() => { if (S.game === g && !g.over) fireShot(shot, aiPlace, true); }, 420);
      });
    } else if (!isMyTurn()) {
      S.phase = 'wait';
      setMsg(S.net.role === 'spectator' ? t('lobby.watching') : t('ph.wait'));
    } else {
      setMsg(S.phase === 'place' ? t('ph.place') : t('ph.aim'));
      AU.sfx('turn');
    }
    renderHUD();
  }

  // ══════════════════════════════════════════════
  //  キュー構え可否（4.7節）
  // ══════════════════════════════════════════════
  const CUE_LEN = 1400;   // キューの長さ mm
  function computeElevFan(cue) {
    const fan = new Float32Array(360);
    if (!S.cfg.cue[6]) { S.elevFan = fan; return; }   // 判定OFFなら制限なし
    const table = S.game.table;
    const hNeed = table.cushionTop - cue.r;           // キューがクッションを越えるのに要する高さ
    for (let d = 0; d < 360; d++) {
      const a = d * Math.PI / 180 + Math.PI;          // キューは撞く向きの反対側へ伸びる
      const dx = Math.cos(a), dy = Math.sin(a);
      let L = Infinity;
      for (const s of table.rails) {
        const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((s.x1 - cue.x) * ey - (s.y1 - cue.y) * ex) / den;
        const uu = ((s.x1 - cue.x) * dy - (s.y1 - cue.y) * dx) / den;
        if (tt > 0 && uu >= 0 && uu <= 1 && tt < L) L = tt;
      }
      if (!isFinite(L) || L > CUE_LEN) { fan[d] = 0; continue; }
      if (L <= 1) { fan[d] = Math.PI / 2; continue; }
      fan[d] = Math.min(Math.PI / 2, Math.atan2(Math.max(0, hNeed), L));
    }
    S.elevFan = fan;
  }
  function minElevFor(dir) {
    if (!S.elevFan) return 0;
    let d = Math.round(dir * 180 / Math.PI) % 360; if (d < 0) d += 360;
    return S.elevFan[d];
  }

  // ══════════════════════════════════════════════
  //  ショット
  // ══════════════════════════════════════════════
  function fireShot(shot, place, local) {
    const g = S.game;
    if (!g || g.over) return;
    if (S.net.on && local && S.net.role !== 'spectator') {
      NET.send({ k: 'shot', n: g.shotNo, shot, place: place || null });
    }
    applyShot(shot, place, true);
  }

  function applyShot(shot, place, animate) {
    const g = S.game;
    const cue = RU.cueBallOf(g, g.turn);
    if (!cue) return;
    if (place) { RU.place(cue, place.x, place.y); g.ballInHand = false; g.ballInHandFull = false; }
    else if (g.ballInHand && S.placePos) { RU.place(cue, S.placePos.x, S.placePos.y); g.ballInHand = false; }

    g.history.push({ n: g.shotNo, shot: Object.assign({}, shot), place: place || null });
    // リプレイ用に直前の盤面と5値を保存（4.8節）。軌跡そのものは持たない
    S.replay = { balls: g.world.balls.map(b => Object.assign({}, b)), shot: Object.assign({}, shot), turn: g.turn };

    const pre = {
      cueId: cue.id,
      targetIds: (RU.legalTargets(g, g.turn) || []).map(b => b.id),
      doubleHit: RU.detectDoubleHit(g, cue, shot),
      miscue: S.cfg.cue[1] && E.isMiscue(shot),
    };
    S.clock.running = false;

    if (pre.miscue) {
      // ミスキューはファウルではない。ターンが終わるだけ（5.9.2節・7.2.3節）
      setMsg(t('ev.miscue'));
      AU.sfx('cue', 0.1);
      g.shotNo++;
      RU.nextTurn(g, { continueTurn: false });
      setTimeout(beginTurn, 900);
      return;
    }

    g.world.events = [];
    E.applyCue(cue, shot);
    AU.sfx('cue', Math.min(1, shot.power));
    S.pre = pre;
    S.phase = 'rolling';
    S.evCursor = 0;
    setMsg(t('ph.rolling'));
    if (!animate) {
      E.runShot(g.world, 20);
      finishShot();
    }
  }

  function finishShot() {
    const g = S.game;
    const res = RU.resolveShot(g, S.pre, g.world.events);

    // ブレイクの成立（7.2.7節）
    if (!g.broken && RU.HAS_RACK[g.rule]) {
      const ok = RU.breakValid(g.world.events, res.pocketed.length);
      g.broken = true;
      if (!ok) {
        setMsg(t('ev.breakFail'));
        res.continueTurn = false;
      }
    }

    let msg = '';
    if (res.fouls.length) msg = res.fouls.map(f => t('foul.' + f)).join(' / ');
    if (res.message) { msg = (msg ? msg + ' — ' : '') + t(res.message); g.lastMessageKey = res.message; }
    if (res.gained) msg = (msg ? msg + ' — ' : '') + '+' + res.gained;
    setMsg(msg);
    if (res.fouls.length) AU.sfx('foul');

    // 練習モードは勝敗判定を持たない（9.6.1節）。的球が尽きたら黙って組み直す
    if (S.cfg.format === 'practice' && (res.gameOver || g.over)) {
      setTimeout(() => startGame(newSeed(), null, null), 900);
      return;
    }

    // 端末どうしで盤面が食い違っていないかを毎ショット確かめる（9.5.5節の
    // 「デシンク検出と再同期」を採った）。ホストの盤面を正とし、
    // 合わなければホストから盤面そのものを配って揃え直す。
    if (S.net.on && S.net.isHost) NET.send({ k: 'chk', n: g.shotNo, h: boardHash() });

    if (res.gameOver || g.over) { endGame(); return; }

    // デッドロックの自動検出（10.8.2節）
    if (g.deadlockCount >= 12) { g.deadlockCount = 0; askDeadlock(true); return; }

    RU.nextTurn(g, res);
    renderHUD();
    setTimeout(beginTurn, 800);
  }

  function endGame() {
    const g = S.game;
    S.phase = 'over';
    S.clock.running = false;
    if (RU.WIN_KIND[g.rule] === 'points') RU.finishRanking(g);
    const meIdx = S.net.on ? S.net.myIdx : 0;
    const won = (g.winner >= 0) && (S.net.on ? g.winner === meIdx : g.players[g.winner].type === 'human');
    AU.sfx(won ? 'win' : 'lose');
    renderResult();
    show('result');
  }

  // ══════════════════════════════════════════════
  //  持ち時間制（8.4節）
  // ══════════════════════════════════════════════
  function tickClock(dtMs) {
    if (!S.clock.running || !S.cfg.mods['G-14']) return;
    const g = S.game; if (!g || g.over) return;
    const dt = dtMs / 1000;
    if (S.clock.baseLeft > 0) {
      S.clock.baseLeft -= dt;
      if (S.clock.baseLeft < 0) { S.clock.baseLeft = 0; }
    } else {
      S.clock.banks[g.turn] -= dt;
      if (S.clock.banks[g.turn] <= 0) {
        S.clock.banks[g.turn] = 0;
        S.clock.running = false;
        onTimeout(true);
      }
    }
  }
  function onTimeout(local) {
    const g = S.game;
    // タイムアウトはパスと同じ。ファウルではなく罰則も無い（8.4.4節）
    setMsg(t('ev.timeout'));
    if (S.net.on && local) NET.send({ k: 'timeout', n: g.shotNo });
    g.history.push({ n: g.shotNo, timeout: true });
    g.shotNo++;
    RU.nextTurn(g, { continueTurn: false });
    setTimeout(beginTurn, 700);
  }

  // ══════════════════════════════════════════════
  //  デッドロック（10.8節）
  // ══════════════════════════════════════════════
  function askDeadlock(auto) {
    const g = S.game;
    // 練習モードと1人プレイでは確認を出さず即座にやり直す（10.8.5節）
    if (g.players.length === 1) { redoRack(); return; }
    if (S.net.on) NET.send({ k: 'dl-open' });   // 全参加者に同じ確認を出す（10.8.4節）
    openDeadlockVote();
  }
  function openDeadlockVote() {
    S.dlVotes = {};
    openConfirm(t('dl.title'), t('dl.ask'), () => {
      if (!S.net.on) { redoRack(); return; }     // ローカル／AI：AIは常に賛成する（10.8.5節）
      castVote(true);
    }, () => {
      if (!S.net.on) { setMsg(t('dl.refused')); return; }
      castVote(false);
    });
  }
  function castVote(ok) {
    setMsg(ok ? t('dl.wait') : t('dl.refused'));
    if (S.net.isHost) tallyVote(S.net.myIdx, ok);
    else NET.send({ k: 'dl-vote', ok, idx: S.net.myIdx }, 'host');
  }
  /** 賛否の集計はホストが受け持つ。全員が賛成したときだけやり直す（10.8.4節） */
  function tallyVote(idx, ok) {
    if (!S.net.isHost || !S.game) return;
    S.dlVotes = S.dlVotes || {};
    S.dlVotes[idx] = ok;
    if (!ok) { NET.send({ k: 'dl-cancel' }); setMsg(t('dl.refused')); S.dlVotes = {}; return; }
    const n = S.game.players.length;
    for (let i = 0; i < n; i++) if (!S.dlVotes[i]) return;
    NET.send({ k: 'dl-redo' });
    S.dlVotes = {};
    redoRack();
  }
  function redoRack() {
    const g = S.game;
    g.redoCount++;
    // やり直しはシードを引き継ぐ（10.8.6節）。同じ配置から、入力だけをやり直す
    const players = g.players.map(p => ({ name: p.name, type: p.type }));
    startGame(g.seed, players, null);
  }

  // ══════════════════════════════════════════════
  //  描画
  // ══════════════════════════════════════════════
  const cv = $('board');
  const ctx = cv.getContext('2d');
  let view = { s: 1, cx: 0, cy: 0, w: 0, h: 0 };

  function resizeBoard() {
    const pane = $('board-pane');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = pane.clientWidth, h = pane.clientHeight;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = w; view.h = h;
    // 長軸を画面の縦方向へ（4.10.1節）。外接矩形を表示エリアいっぱいへ
    const outerW = T.PLAY_H + 200, outerH = T.PLAY_W + 200;
    view.s = Math.min(w / outerW, h / outerH);
    view.cx = w / 2; view.cy = h / 2;
  }
  window.addEventListener('resize', resizeBoard);

  // 台座標 → 画面座標（長軸=縦。フット側が上）
  function toScreen(tx, ty) { return { x: view.cx + ty * view.s, y: view.cy - tx * view.s }; }
  function toTable(sx, sy) { return { x: (view.cy - sy) / view.s, y: (sx - view.cx) / view.s }; }

  function drawBall2D(b, s, alpha) {
    const p = toScreen(b.x, b.y);
    const r = b.r * s;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    // 接地影（4.2.2節）。飛球中は影と玉が離れる
    const lift = b.z * s;
    ctx.beginPath(); ctx.ellipse(p.x + r * .18, p.y + r * .22, r * .95, r * .95, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    const bx = p.x - lift * .25, by = p.y - lift * .5;
    const g = ctx.createRadialGradient(bx - r * .38, by - r * .42, r * .08, bx, by, r * 1.06);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.20, shade(b.color, 1.28));
    g.addColorStop(.72, b.color); g.addColorStop(1, shade(b.color, .42));
    ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, r * .06); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    // ストライプ球の帯
    if (b.stripe) {
      ctx.save(); ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillRect(bx - r, by - r, r * 2, r * .42);
      ctx.fillRect(bx - r, by + r * .58, r * 2, r * .42);
      ctx.restore();
    }
    // 回転の可視化：クォータニオンで回した極を点として置く（4.2.2節）
    const pole = rotV(b, 0, 0, 1);
    if (pole.z > -0.2) {
      ctx.beginPath();
      ctx.arc(bx + pole.y * r * .62, by - pole.x * r * .62, Math.max(1.1, r * .17), 0, 7);
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();
    }
    // 番号は縮尺に依存しない固定サイズ（4.2.4節）
    if (b.num) {
      const fs = Math.max(8, Math.min(r * 1.0, 13));
      ctx.beginPath(); ctx.arc(bx, by, Math.max(5, r * .5), 0, 7);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '700 ' + fs + 'px "Noto Sans JP",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(b.num), bx, by + .5);
    }
    ctx.restore();
  }

  function rotV(b, x, y, z) {
    // q * v * q^-1
    const qw = b.qw, qx = b.qx, qy = b.qy, qz = b.qz;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function draw2D() {
    const g = S.game; if (!g) return;
    const table = g.table, s = view.s;
    ctx.clearRect(0, 0, view.w, view.h);

    // レール（枠）
    const a = toScreen(table.halfW, -table.halfH), b = toScreen(-table.halfW, table.halfH);
    const railPx = 26 * s + 8;
    ctx.fillStyle = '#4a2712';
    roundRect(a.x - railPx, a.y - railPx, (b.x - a.x) + railPx * 2, (b.y - a.y) + railPx * 2, 14 * s + 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    roundRect(a.x - railPx, a.y - railPx, (b.x - a.x) + railPx * 2, (b.y - a.y) + railPx * 2, 14 * s + 8);
    ctx.fill();
    // クロス
    const cg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    cg.addColorStop(0, '#14523c'); cg.addColorStop(.5, '#0f3d2e'); cg.addColorStop(1, '#0c3325');
    ctx.fillStyle = cg;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);

    // ポケット
    ctx.fillStyle = '#000';
    for (const p of table.pockets) {
      const q = toScreen(p.x, p.y);
      ctx.beginPath(); ctx.arc(q.x, q.y, p.r * s, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // スポット（フットスポット）
    const sp = toScreen(table.spot.x, table.spot.y);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.5, 4 * s * 1.5), 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill();

    // 撞けない方向の扇形（4.7.3節）
    if (S.cfg.cue[6] && (S.phase === 'aim' || S.phase === 'stance')) drawElevFan();

    // 玉
    const live = g.world.balls.filter(bb => bb.state === 'live');
    live.sort((x, y) => x.z - y.z);
    for (const bb of live) drawBall2D(bb, s);

    // 手玉の配置
    if (S.phase === 'place' && S.placePos) {
      const cue = RU.cueBallOf(g, g.turn);
      const q = toScreen(S.placePos.x, S.placePos.y);
      ctx.beginPath(); ctx.arc(q.x, q.y, cue.r * s, 0, 7);
      ctx.strokeStyle = placeOk(S.placePos) ? 'rgba(251,146,60,.95)' : 'rgba(220,38,38,.95)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    // エイムライン（4.6.1節）
    if ((S.phase === 'aim' || S.phase === 'stance') && isMyTurn()) drawAimLine();
    // 次に当てるべき玉を印す
    const tg = RU.legalTargets(g, g.turn);
    if (tg && tg.length && tg.length <= 3) {
      for (const b2 of tg) {
        const q = toScreen(b2.x, b2.y);
        ctx.beginPath(); ctx.arc(q.x, q.y, b2.r * s * 1.35, 0, 7);
        ctx.strokeStyle = 'rgba(251,146,60,.75)'; ctx.lineWidth = 1.6; ctx.stroke();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawElevFan() {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    if (!cue || !S.elevFan) return;
    const c = toScreen(cue.x, cue.y);
    const rad = 46;
    for (let d = 0; d < 360; d += 2) {
      const m = S.elevFan[d];
      if (m <= 0.01) continue;
      const col = (m >= Math.PI / 2 - 0.01) ? 'rgba(0,0,0,.42)' : 'rgba(0,0,0,' + (0.10 + m * 0.16) + ')';
      const a0 = d * Math.PI / 180, a1 = (d + 2) * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(c.x, c.y);
      // 台座標の角度 → 画面角度（画面右=+ty, 画面上=+tx）
      ctx.arc(c.x, c.y, rad, scrAngle(a0), scrAngle(a1));
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }
  }
  // 台の方向角 → 画面上の角度。x_screen = ty, y_screen = -tx
  function scrAngle(a) { return Math.atan2(-Math.cos(a), Math.sin(a)); }

  function drawAimLine() {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    if (!cue) return;
    const s = view.s, diff = S.cfg.diff;
    const c = toScreen(cue.x, cue.y);
    const dir = S.aim.dir;

    if (diff === 'apocalypse') {
      const L = 260;    // 方向のみを短く（4.6.1節）
      const e = toScreen(cue.x + Math.cos(dir) * L, cue.y + Math.sin(dir) * L);
      line(c, e, 'rgba(255,255,255,.75)', 2);
      return;
    }
    const prev = getAimPreview();
    if (!prev) return;
    const hitPt = toScreen(prev.cue.x, prev.cue.y);
    line(c, hitPt, 'rgba(255,255,255,.72)', 1.8);
    // ゴーストボール
    ctx.beginPath(); ctx.arc(hitPt.x, hitPt.y, cue.r * s, 0, 7);
    ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 1.2; ctx.stroke();
    if (diff === 'easy' && prev.obj) {
      const o0 = toScreen(prev.obj.from.x, prev.obj.from.y);
      const o1 = toScreen(prev.obj.to.x, prev.obj.to.y);
      line(o0, o1, 'rgba(251,146,60,.85)', 2);
    }
  }
  function line(p, q, col, w) {
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  }

  /**
   * エイムラインの中身。スロー効果がONなら物理で短く先読みし、
   * OFFなら幾何で解く（4.6.3節）。方向が変わるまで結果を使い回す。
   */
  function getAimPreview() {
    if (!S.aimDirty && S.aimPreview) return S.aimPreview;
    S.aimDirty = false;
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    if (!cue) return (S.aimPreview = null);
    const dir = S.aim.dir;
    const fc = E.firstContact(g.world, cue, dir, 6000);
    const cuePt = fc.point || { x: cue.x + Math.cos(dir) * 6000, y: cue.y + Math.sin(dir) * 6000 };
    let obj = null;
    if (fc.type === 'ball' && fc.ball) {
      if (S.cfg.cue[2]) {
        // スロー効果ON：短時間だけ物理を先回りさせる
        const w = E.cloneWorld(g.world);
        const c2 = w.balls.find(b => b.id === cue.id);
        const o2 = w.balls.find(b => b.id === fc.ball.id);
        E.applyCue(c2, { dir, power: Math.max(0.28, S.aim.power || 0.4), tipX: S.aim.tipX, tipY: S.aim.tipY, elev: S.aim.elev });
        const from = { x: o2.x, y: o2.y };
        let moved = null;
        E.runShot(w, 1.1, () => {
          if (!moved && (Math.abs(o2.vx) + Math.abs(o2.vy)) > 1) moved = true;
          return true;
        });
        obj = { from, to: { x: o2.x, y: o2.y } };
        if (Math.hypot(obj.to.x - from.x, obj.to.y - from.y) < 10) obj = null;
      } else {
        // スロー効果OFF：接触点の法線方向へ幾何学的な直線
        const nx = cuePt.x - fc.ball.x, ny = cuePt.y - fc.ball.y;
        const nl = Math.hypot(nx, ny) || 1;
        const L = 620;
        obj = { from: { x: fc.ball.x, y: fc.ball.y }, to: { x: fc.ball.x - nx / nl * L, y: fc.ball.y - ny / nl * L } };
      }
    }
    S.aimPreview = { cue: cuePt, obj, contact: fc };
    return S.aimPreview;
  }

  // ───────── 3D 低視点（4.2.3節） ─────────
  const CAM = { back: 620, height: 260, pitch: 0.20, fov: 780 };
  function draw3D() {
    const g = S.game; if (!g) return;
    const cue = RU.cueBallOf(g, g.turn); if (!cue) { draw2D(); return; }
    ctx.clearRect(0, 0, view.w, view.h);
    const dir = S.aim.dir;
    const fx = Math.cos(dir), fy = Math.sin(dir);
    const pull = S.aim.power;
    const cam = { x: cue.x - fx * CAM.back, y: cue.y - fy * CAM.back, z: CAM.height };
    const p = CAM.pitch;
    const f = { x: fx * Math.cos(p), y: fy * Math.cos(p), z: -Math.sin(p) };
    const r = { x: -f.y, y: f.x, z: 0 };
    const rl = Math.hypot(r.x, r.y) || 1; r.x /= rl; r.y /= rl;
    const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
    const scale = CAM.fov * Math.min(view.w, view.h) / 620;

    function proj(x, y, z) {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const Z = dx * f.x + dy * f.y + dz * f.z;
      if (Z < 40) return null;
      const X = dx * r.x + dy * r.y + dz * r.z;
      const Y = dx * u.x + dy * u.y + dz * u.z;
      return { x: view.cx + scale * X / Z, y: view.cy - scale * Y / Z + view.h * 0.10, z: Z };
    }

    // 背景（部屋）
    ctx.fillStyle = '#08110d'; ctx.fillRect(0, 0, view.w, view.h);

    // クロス面（近クリップつき）
    const table = g.table;
    const corners = [
      [table.halfW, -table.halfH], [table.halfW, table.halfH],
      [-table.halfW, table.halfH], [-table.halfW, -table.halfH],
    ].map(c => ({ x: c[0], y: c[1], z: 0 }));
    const poly = clipNear(corners, cam, f, 45).map(v => proj(v.x, v.y, v.z)).filter(Boolean);
    if (poly.length > 2) {
      ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath(); ctx.fillStyle = '#12482f'; ctx.fill();
    }
    // クッション（上端の線）
    ctx.strokeStyle = '#7a4322'; ctx.lineWidth = 5;
    for (const sgm of table.rails) {
      const a = proj(sgm.x1, sgm.y1, table.cushionTop), b2 = proj(sgm.x2, sgm.y2, table.cushionTop);
      if (a && b2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }
    }
    // ポケット
    ctx.fillStyle = '#000';
    for (const pk of table.pockets) {
      const q = proj(pk.x, pk.y, 0); if (!q) continue;
      const rr = scale * pk.r / q.z;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.45, 0, 0, 7); ctx.fill();
    }

    // 床面へのエイムライン（4.6.2節：方向1本だけ）
    const prev = getAimPreview();
    if (prev) {
      const a = proj(cue.x, cue.y, 1), b2 = proj(prev.cue.x, prev.cue.y, 1);
      if (a && b2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.stroke(); }
    }

    // 玉（遠いものから）
    const live = g.world.balls.filter(b => b.state === 'live')
      .map(b => ({ b, p: proj(b.x, b.y, b.z + b.r) })).filter(o => o.p)
      .sort((m, n) => n.p.z - m.p.z);
    for (const o of live) {
      const rr = scale * o.b.r / o.p.z;
      drawBall3D(o.b, o.p.x, o.p.y, rr);
    }

    // キュー
    const cp = proj(cue.x, cue.y, cue.r);
    if (cp) {
      const el = S.aim.elev;
      const back = 90 + pull * 340;
      const tipH = cue.r;
      const t1 = proj(cue.x - fx * back * Math.cos(el), cue.y - fy * back * Math.cos(el), tipH + back * Math.sin(el));
      const t2 = proj(cue.x - fx * (back + 1300) * Math.cos(el), cue.y - fy * (back + 1300) * Math.cos(el), tipH + (back + 1300) * Math.sin(el));
      if (t1 && t2) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#c9a06a'; ctx.lineWidth = Math.max(3, scale * 11 / t1.z);
        ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
        ctx.strokeStyle = '#f3f3f3'; ctx.lineWidth = Math.max(2, scale * 9 / t1.z);
        ctx.beginPath(); ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t1.x + (t2.x - t1.x) * .05, t1.y + (t2.y - t1.y) * .05); ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // 撞点パッド（手玉を拡大表示。盤面領域の中で指定する＝4.10.2節）
    drawTipPad();
    // パワーの引き代を示す帯
    drawPullHint();
  }

  function clipNear(pts, cam, f, minZ) {
    const zOf = v => (v.x - cam.x) * f.x + (v.y - cam.y) * f.y + (v.z - cam.z) * f.z;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const za = zOf(a), zb = zOf(b);
      if (za >= minZ) out.push(a);
      if ((za >= minZ) !== (zb >= minZ)) {
        const tt = (minZ - za) / (zb - za);
        out.push({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt, z: a.z + (b.z - a.z) * tt });
      }
    }
    return out;
  }

  function drawBall3D(b, x, y, r) {
    if (r < 0.4) return;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + r * .55, r * .95, r * .35, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    const g = ctx.createRadialGradient(x - r * .38, y - r * .42, r * .08, x, y, r * 1.06);
    g.addColorStop(0, '#fff'); g.addColorStop(.2, shade(b.color, 1.28));
    g.addColorStop(.72, b.color); g.addColorStop(1, shade(b.color, .42));
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = g; ctx.fill();
    if (b.num && r > 6) {
      ctx.beginPath(); ctx.arc(x, y, r * .48, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '700 ' + Math.max(7, r * .62) + 'px "Noto Sans JP",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(b.num), x, y + .5);
    }
    ctx.restore();
  }

  function tipPadRect() {
    const R = Math.min(88, Math.max(48, view.w * 0.16));
    return { cx: view.w - R - 18, cy: view.h - R - 18, r: R };
  }
  function drawTipPad() {
    const p = tipPadRect();
    ctx.save();
    const g = ctx.createRadialGradient(p.cx - p.r * .35, p.cy - p.r * .4, p.r * .1, p.cx, p.cy, p.r);
    g.addColorStop(0, '#fff'); g.addColorStop(.7, '#e6e6e6'); g.addColorStop(1, '#9a9a9a');
    ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.cx - p.r, p.cy); ctx.lineTo(p.cx + p.r, p.cy);
    ctx.moveTo(p.cx, p.cy - p.r); ctx.lineTo(p.cx, p.cy + p.r);
    ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; ctx.stroke();
    const tx = p.cx + S.aim.tipX * p.r * .5, ty = p.cy - S.aim.tipY * p.r * .5;
    ctx.beginPath(); ctx.arc(tx, ty, p.r * .17, 0, 7);
    ctx.fillStyle = '#c2410c'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  function drawPullHint() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, view.h - 62, view.w, 62);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '11px "Noto Sans JP",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t('ph.cue'), 12, view.h - 31);
    ctx.restore();
  }

  // ══════════════════════════════════════════════
  //  入力（4.4節・4.11節）
  // ══════════════════════════════════════════════
  function evPos(e) {
    const r = cv.getBoundingClientRect();
    const p = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function placeOk(pt) {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    const table = g.table;
    if (Math.abs(pt.x) > table.halfW - cue.r || Math.abs(pt.y) > table.halfH - cue.r) return false;
    for (const p of table.pockets) if (Math.hypot(pt.x - p.x, pt.y - p.y) < p.r + cue.r * .3) return false;
    for (const b of g.world.balls) {
      if (b === cue || b.state !== 'live') continue;
      if (Math.hypot(b.x - pt.x, b.y - pt.y) < b.r + cue.r + 0.5) return false;
    }
    return true;
  }

  cv.addEventListener('pointerdown', e => {
    if (!S.game || !isMyTurn()) return;
    cv.setPointerCapture(e.pointerId);
    const p = evPos(e);
    if (S.phase === 'place') {
      S.drag = { kind: 'place' };
      movePlace(p);
    } else if (S.phase === 'aim') {
      S.drag = { kind: 'aim' };
      moveAim(p);
    } else if (S.phase === 'stance') {
      const pad = tipPadRect();
      if (Math.hypot(p.x - pad.cx, p.y - pad.cy) < pad.r * 1.25) {
        S.drag = { kind: 'tip', x: p.x, y: p.y, t0: { x: S.aim.tipX, y: S.aim.tipY } };
      } else if (p.y < view.h * 0.42) {
        S.drag = { kind: 'fine', x: p.x, d0: S.aim.dir };
      } else {
        S.drag = { kind: 'pull', y: p.y, p0: 0 };
      }
    }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!S.drag) return;
    const p = evPos(e);
    if (S.drag.kind === 'place') movePlace(p);
    else if (S.drag.kind === 'aim') moveAim(p);
    else if (S.drag.kind === 'tip') {
      const pad = tipPadRect();
      // タッチは絶対位置ではなくドラッグ量で動かす（4.11.2節）
      S.aim.tipX = clamp(S.drag.t0.x + (p.x - S.drag.x) / (pad.r * .5), -1, 1);
      S.aim.tipY = clamp(S.drag.t0.y - (p.y - S.drag.y) / (pad.r * .5), -1, 1);
      S.aimDirty = true;
    } else if (S.drag.kind === 'fine') {
      S.aim.dir = S.drag.d0 + (p.x - S.drag.x) * 0.0016;
      S.aimDirty = true;
    } else if (S.drag.kind === 'pull') {
      S.aim.power = clamp((p.y - S.drag.y) / (view.h * 0.34), 0, 1.15);
    }
    e.preventDefault();
  });
  function endDrag(e) {
    if (!S.drag) return;
    const kind = S.drag.kind;
    S.drag = null;
    if (kind === 'pull') {
      if (S.aim.power > 0.05) shootNow();
      else S.aim.power = 0;
    }
    if (e) e.preventDefault();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function movePlace(p) {
    const tp = toTable(p.x, p.y - 26);   // 指が手玉を隠さないよう少しずらす（4.11.2節）
    const table = S.game.table;
    const cue = RU.cueBallOf(S.game, S.game.turn);
    tp.x = clamp(tp.x, -table.halfW + cue.r, table.halfW - cue.r);
    tp.y = clamp(tp.y, -table.halfH + cue.r, table.halfH - cue.r);
    S.placePos = tp;
    S.aimDirty = true;
  }
  function moveAim(p) {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    const tp = toTable(p.x, p.y);
    const d = Math.atan2(tp.y - cue.y, tp.x - cue.x);
    if (isFinite(d)) { S.aim.dir = d; S.aimDirty = true; }
  }

  function shootNow() {
    const g = S.game;
    const need = minElevFor(S.aim.dir);
    if (need >= Math.PI / 2 - 0.01) { setMsg(t('foul.V-09')); S.aim.power = 0; return; }
    const elev = Math.max(S.aim.elev, need);
    const shot = { dir: S.aim.dir, power: Math.min(1.15, S.aim.power), tipX: S.aim.tipX, tipY: S.aim.tipY, elev };
    const place = S.pendingPlace || ((g.ballInHand && S.placePos) ? { x: S.placePos.x, y: S.placePos.y } : null);
    S.pendingPlace = null;
    S.aim.power = 0;
    fireShot(shot, place, true);
  }

  // 仰角スライダー（4.4.3節）。構えられない範囲は選べない
  $('elev').addEventListener('input', () => {
    const need = minElevFor(S.aim.dir) * 180 / Math.PI;
    let v = +$('elev').value;
    if (v < need) { v = Math.ceil(need); $('elev').value = v; }
    S.aim.elev = v * Math.PI / 180;
    S.aimDirty = true;
  });

  $('btn-aim').addEventListener('click', () => {
    if (!isMyTurn()) return;
    if (S.phase === 'place') {
      if (!placeOk(S.placePos)) { setMsg(t('foul.V-09')); return; }
      S.game.ballInHand = false;
      const cue = RU.cueBallOf(S.game, S.game.turn);
      RU.place(cue, S.placePos.x, S.placePos.y);
      computeElevFan(cue);
      S.phase = 'aim'; setMsg(t('ph.aim'));
      // 置いた位置はショットの入力の一部。通信対戦では相手も同じ場所へ置かないと
      // 同じ盤面にならないので、撞くときまで覚えておいて5値と一緒に送る。
      S.pendingPlace = { x: S.placePos.x, y: S.placePos.y };
    } else if (S.phase === 'aim') {
      S.phase = 'stance'; setMsg(t('ph.cue'));
    } else if (S.phase === 'stance') {
      S.phase = 'aim'; S.aim.power = 0; setMsg(t('ph.aim'));
    }
    $('btn-aim').textContent = (S.phase === 'stance') ? t('btn.back2d') : t('btn.aim');
    AU.sfx('button');
  });

  // ══════════════════════════════════════════════
  //  主ループ
  // ══════════════════════════════════════════════
  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(100, now - lastT); lastT = now;
    if (S.screen === 'play' && S.game) {
      if (S.phase === 'rolling') {
        // 描画60Hzに対し1フレーム8ステップ＝物理は常に 1/480 秒（5.2.2節）
        for (let i = 0; i < 8; i++) {
          if (E.allStopped(S.game.world)) break;
          E.step(S.game.world);
        }
        drainEvents();
        if (E.allStopped(S.game.world)) { S.phase = 'idle'; finishShot(); }
      } else if (S.replayRun) {
        for (let i = 0; i < 8; i++) {
          if (E.allStopped(S.replayRun)) break;
          E.step(S.replayRun);
        }
        if (E.allStopped(S.replayRun)) S.replayRun = null;
      }
      tickClock(dt);
      if (S.replayRun) drawReplay();
      else if (S.phase === 'stance') draw3D();
      else draw2D();
      renderClock();
      $('k-elev').textContent = Math.round(S.aim.elev * 180 / Math.PI) + '°';
      $('k-power').textContent = Math.round(S.aim.power * 100) + '%';
      const gg = $('power-gauge');
      gg.classList.toggle('over', S.aim.power > 1);   // オーバーパワー警告（4.4.4節）
      gg.firstElementChild.style.width = Math.min(100, S.aim.power * 100) + '%';
    }
    requestAnimationFrame(loop);
  }

  function drainEvents() {
    const evs = S.game.world.events;
    for (let i = S.evCursor || 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'hit') AU.sfx('ball', Math.min(1, e.speed / 4000));
      else if (e.type === 'cushion') AU.sfx('cushion', Math.min(1, e.speed / 4000));
      else if (e.type === 'pocket') AU.sfx('pocket');
      else if (e.type === 'land') AU.sfx('jump');
    }
    S.evCursor = evs.length;
  }

  function drawReplay() {
    const save = S.game.world;
    S.game.world = S.replayRun;
    draw2D();
    S.game.world = save;
  }

  // ══════════════════════════════════════════════
  //  情報表示（4.9節）
  // ══════════════════════════════════════════════
  function setMsg(m) { S.msg = m || ''; $('msg-bar').textContent = S.msg; $('msg-bar').style.display = S.msg ? '' : 'none'; }

  function renderHUD() {
    const g = S.game; if (!g) return;
    $('v-turn').textContent = g.players[g.turn] ? g.players[g.turn].name : '–';
    const box = $('players-box'); box.innerHTML = '';
    g.players.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'pl-row' + (i === g.turn ? ' turn' : '');
      let right = String(p.score);
      if (g.rule === 'G-04') right = p.score + '/' + p.target;
      if (g.rule === 'G-02') right = p.group ? t('group.' + p.group).split('（')[0] : t('hud.open');
      d.innerHTML = '<span>' + escapeHtml(p.name) + '</span><span>' + escapeHtml(right) + '</span>';
      box.appendChild(d);
    });
    const tg = RU.legalTargets(g, g.turn);
    $('v-next').textContent = tg == null ? '–' : (tg.length ? tg.map(b => b.num || '●').join(' / ') : '–');
    $('v-foul').textContent = g.lastFouls && g.lastFouls.length ? g.lastFouls.map(f => t('foul.' + f)).join(', ') : t('hud.none');
    $('time-box').style.display = S.cfg.mods['G-14'] ? '' : 'none';
    $('v-config').textContent = [
      t('rule.' + g.rule),
      t('shape.' + S.cfg.shape) + '（' + t(S.cfg.carom ? 'tbl.carom' : 'tbl.pocket') + '）',
      t('mode.' + S.cfg.mode), I.DIFF_LABEL[S.cfg.diff], t('cue.' + cuePresetName()),
    ].join(' / ');
  }
  function renderClock() {
    if (!S.cfg.mods['G-14'] || !S.game) return;
    $('v-base').textContent = Math.ceil(S.clock.baseLeft) + 's';
    const b = S.clock.banks[S.game.turn] || 0;
    $('v-bank').textContent = Math.floor(b / 60) + ':' + String(Math.floor(b % 60)).padStart(2, '0');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderResult() {
    const g = S.game;
    const body = $('res-body'); body.innerHTML = '';
    const kind = RU.WIN_KIND[g.rule];
    let rows;
    if (kind === 'points') {
      rows = g.ranking.map((idx, i) => ({ p: g.players[idx], label: (i + 1) + ' ' + t('res.rank') }));
    } else {
      rows = g.players.map(p => ({ p, label: p.idx === g.winner ? t('res.win') : t('res.lose') }));
    }
    rows.forEach(r => {
      const d = document.createElement('div');
      d.className = 'pl-row' + (r.p.idx === g.winner ? ' turn' : '');
      d.innerHTML = '<span>' + escapeHtml(r.p.name) + '</span><span>' + escapeHtml(r.label + '　' + r.p.score + t('res.pts')) + '</span>';
      body.appendChild(d);
    });
    if (g.lastMessageKey) {
      const p = document.createElement('div'); p.className = 'hint'; p.style.marginTop = '10px';
      p.textContent = t(g.lastMessageKey); body.appendChild(p);
    }
  }

  // ══════════════════════════════════════════════
  //  通信対戦（9.5節）
  // ══════════════════════════════════════════════
  function openLobby() {
    show('lobby');
    $('lobby-status').textContent = t('lobby.connecting');
    NET.init({ version: APP_VER, onEvent: onNet });
    NET.refresh();
  }

  function onNet(kind, d) {
    if (kind === 'ws-open') { $('lobby-status').textContent = t('lobby.connected'); NET.refresh(); }
    else if (kind === 'ws-close') { $('lobby-status').textContent = t('lobby.connecting'); }
    else if (kind === 'rooms') { S.net.lastRooms = d.rooms; renderRooms(d.rooms); }
    else if (kind === 'ver-mismatch') { alertNote(t('lobby.title'), t('lobby.verMismatch', { a: d.theirs, b: d.mine })); }
    else if (kind === 'created') {
      S.net.on = true; S.net.isHost = true; S.net.role = 'host'; S.net.myIdx = 0;
      S.net.roster = (d.multi && d.multi.roster) || [];
      showRoom();
    } else if (kind === 'joined') {
      S.net.on = true; S.net.isHost = false;
      S.net.role = (d.multi && d.multi.role) || 'player';
      S.net.roster = (d.multi && d.multi.roster) || [];
      if (d.rules && d.rules.config) Object.assign(S.cfg, d.rules.config);
      showRoom();
      if (S.net.role === 'spectator') NET.send({ k: 'need' }, 'host');
    } else if (kind === 'participant') {
      if (d.roster) S.net.roster = d.roster;
      AU.sfx('join');
      showRoom();
      if (S.net.isHost) NET.send({ k: 'cfg', config: netConfig() });
    } else if (kind === 'participant-left') {
      if (d.roster) S.net.roster = d.roster;
      setMsg(t('lobby.left'));
      showRoom();
    } else if (kind === 'disconnected' || kind === 'kicked') {
      setMsg(t('lobby.disconnected'));
      S.net.on = false;
      show('lobby');
    } else if (kind === 'error') {
      alertNote(t('lobby.title'), d.msg || '');
    } else if (kind === 'msg') {
      onNetMsg(d.payload, d.from);
    }
  }

  function netConfig() {
    // ホストが選んだ設定を全参加者へ強制適用する（9.5.3節）。同期の成立条件でもある
    return JSON.parse(JSON.stringify(S.cfg));
  }

  function onNetMsg(p, from) {
    if (!p || !p.k) return;
    if (p.k === 'cfg') { Object.assign(S.cfg, p.config); showRoom(); buildSetup(); return; }
    if (p.k === 'need') {
      if (!S.net.isHost || !S.game) return;
      NET.send({ k: 'sync', seed: S.game.seed, config: netConfig(), names: S.game.players.map(x => ({ name: x.name, type: x.type })), log: S.game.history }, from || 'all');
      return;
    }
    if (p.k === 'start') {
      S.net.myIdx = indexOfMe(p.names);
      startGame(p.seed, p.names, p.config);
      return;
    }
    if (p.k === 'sync') {
      // 途中入室（観戦）：入力列を最初から再生して現在の局面へ追いつく（9.5.8節）
      setMsg(t('lobby.syncing'));
      S.net.myIdx = -1;
      startGame(p.seed, p.names, p.config);
      for (const rec of (p.log || [])) replayRecord(rec);
      renderHUD();
      beginTurn();
      return;
    }
    if (p.k === 'shot') {
      if (!S.game || S.game.shotNo !== p.n) { requestResync(); return; }
      applyShot(p.shot, p.place, true);
      return;
    }
    if (p.k === 'timeout') {
      if (!S.game || S.game.shotNo !== p.n) { requestResync(); return; }
      onTimeout(false);
      return;
    }
    if (p.k === 'dl-open') { openDeadlockVote(); return; }
    if (p.k === 'dl-vote') { tallyVote(p.idx, !!p.ok); return; }
    if (p.k === 'dl-cancel') { $('modal-dl').classList.remove('on'); setMsg(t('dl.refused')); return; }
    if (p.k === 'dl-redo') { $('modal-dl').classList.remove('on'); redoRack(); return; }
    if (p.k === 'chk') {
      if (S.net.isHost || !S.game) return;
      if (S.game.shotNo !== p.n) { requestResync(); return; }
      if (boardHash() !== p.h) NET.send({ k: 'reboard' }, 'host');
      return;
    }
    if (p.k === 'reboard') {
      if (!S.net.isHost || !S.game) return;
      NET.send({ k: 'board', board: boardSnapshot(), turn: S.game.turn, n: S.game.shotNo, scores: S.game.players.map(x => x.score), bih: S.game.ballInHand });
      return;
    }
    if (p.k === 'board') {
      // デシンクからの復帰（9.5.5節で実装時判断とされた「検出して再同期」を採る）
      if (!S.game) return;
      applyBoard(p);
      setMsg(t('lobby.syncing'));
      return;
    }
  }

  function boardSnapshot() {
    return S.game.world.balls.map(b => ({ i: b.id, x: +b.x.toFixed(3), y: +b.y.toFixed(3), s: b.state }));
  }
  function boardHash() {
    let h = 2166136261;
    for (const b of S.game.world.balls) {
      const str = b.id + ':' + b.state + ':' + Math.round(b.x * 10) + ',' + Math.round(b.y * 10);
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    }
    return h;
  }

  function replayRecord(rec) {
    if (rec.timeout) {
      S.game.shotNo++;
      RU.nextTurn(S.game, { continueTurn: false });
      return;
    }
    applyShot(rec.shot, rec.place, false);
  }

  function requestResync() {
    if (S.net.isHost) return;
    NET.send({ k: 'need' }, 'host');
  }
  function applyBoard(p) {
    const g = S.game;
    const byId = {}; g.world.balls.forEach(b => byId[b.id] = b);
    (p.board || []).forEach(o => {
      const b = byId[o.i]; if (!b) return;
      b.x = o.x; b.y = o.y; b.z = 0; b.state = o.s;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
      b.onTable = (o.s === 'live');
    });
    if (p.scores) p.scores.forEach((s, i) => { if (g.players[i]) g.players[i].score = s; });
    if (p.turn != null) g.turn = p.turn;
    if (p.n != null) g.shotNo = p.n;
    if (p.bih != null) g.ballInHand = !!p.bih;
    renderHUD();
  }

  function indexOfMe(names) {
    const st = NET.state();
    if (!st || !st.roster) return S.net.isHost ? 0 : 1;
    const players = st.roster.filter(r => r.role !== 'spectator');
    const i = players.findIndex(r => r.pid === st.pid);
    return i < 0 ? -1 : i;
  }

  function renderRooms(rooms) {
    const box = $('room-list'); if (!box) return;
    box.innerHTML = '';
    const list = (rooms || []).filter(r => !r.gameType || r.gameType === NET.GAME_TYPE);
    if (!list.length) { box.innerHTML = '<div class="hint">' + escapeHtml(t('lobby.empty')) + '</div>'; return; }
    list.forEach(r => {
      const d = document.createElement('div'); d.className = 'room';
      const ver = (r.rules && r.rules.ver) || '?';
      const info = document.createElement('div');
      info.innerHTML = '<div class="nm">' + escapeHtml(r.name || '') + '</div>' +
        '<div class="meta">' + escapeHtml((r.hostName || '') + ' / v' + ver) + '</div>';
      const btns = document.createElement('div'); btns.className = 'row';
      const bj = document.createElement('button'); bj.className = 'btn small primary'; bj.textContent = t('lobby.join');
      bj.onclick = () => joinAs(r, 'player');
      const bs = document.createElement('button'); bs.className = 'btn small'; bs.textContent = t('lobby.spectate');
      bs.onclick = () => joinAs(r, 'spectator');
      btns.appendChild(bj); btns.appendChild(bs);
      d.appendChild(info); d.appendChild(btns);
      box.appendChild(d);
    });
  }
  function joinAs(room, role) {
    const pw = room.hasPassword ? (prompt(t('lobby.pw')) || '') : ($('in-pw').value || '');
    NET.joinRoom(room.id, pw, $('in-name').value || 'Guest', role);
  }

  function showRoom() {
    show('room');
    const st = NET.state();
    $('room-status').textContent = S.net.role === 'spectator' ? t('lobby.watching') : t('lobby.waiting');
    const box = $('roster'); box.innerHTML = '';
    (S.net.roster || []).forEach(r => {
      const d = document.createElement('div'); d.className = 'pl-row';
      d.innerHTML = '<span>' + escapeHtml(r.name || '') + '</span><span>' + escapeHtml(r.role || '') + '</span>';
      box.appendChild(d);
    });
    $('room-config').textContent = [
      t('rule.' + S.cfg.rule),
      t('shape.' + S.cfg.shape) + '（' + t(S.cfg.carom ? 'tbl.carom' : 'tbl.pocket') + '）',
      I.DIFF_LABEL[S.cfg.diff], t('cue.' + cuePresetName()),
    ].join(' / ');
    $('btn-room-start').style.display = S.net.isHost ? '' : 'none';
  }

  // ══════════════════════════════════════════════
  //  モーダル・雑務
  // ══════════════════════════════════════════════
  function openConfirm(title, body, yes, no) {
    $('dl-title').textContent = title; $('dl-ask').textContent = body;
    $('modal-dl').classList.add('on');
    S.confirmCb = { yes, no };
  }
  $('btn-dl-yes').onclick = () => { $('modal-dl').classList.remove('on'); const c = S.confirmCb; S.confirmCb = null; if (c && c.yes) c.yes(); };
  $('btn-dl-no').onclick = () => { $('modal-dl').classList.remove('on'); const c = S.confirmCb; S.confirmCb = null; if (c && c.no) c.no(); };
  function alertNote(title, body) {
    $('note-title').textContent = title; $('note-body').textContent = body;
    $('modal-note').classList.add('on');
  }
  $('btn-note-close').onclick = () => $('modal-note').classList.remove('on');

  function openSettings() {
    $('vol-bgm').value = AU.getBgmVolume(); $('vol-sfx').value = AU.getSfxVolume();
    $('mute-bgm').checked = AU.getMuted('bgm'); $('mute-sfx').checked = AU.getMuted('sfx');
    $('modal-settings').classList.add('on');
  }
  $('btn-set-close').onclick = () => $('modal-settings').classList.remove('on');
  $('vol-bgm').oninput = e => AU.setBgmVolume(+e.target.value);
  $('vol-sfx').oninput = e => AU.setSfxVolume(+e.target.value);
  $('mute-bgm').onchange = e => AU.setMuted('bgm', e.target.checked);
  $('mute-sfx').onchange = e => AU.setMuted('sfx', e.target.checked);
  $('btn-settings-1').onclick = openSettings;
  $('btn-settings-2').onclick = openSettings;

  // ══════════════════════════════════════════════
  //  ボタン結線
  // ══════════════════════════════════════════════
  $('btn-title-play').onclick = () => { AU.sfx('button'); show('setup'); };
  $('crumb-title').onclick = e => { e.preventDefault(); show('title'); };
  $('crumb-setup2').onclick = e => { e.preventDefault(); show('setup'); };
  $('btn-lobby-back').onclick = () => { NET.leave(); S.net.on = false; show('setup'); };
  $('btn-room-leave').onclick = () => { NET.leave(); S.net.on = false; show('lobby'); };

  [].forEach.call($('seg-scope').children, b => {
    b.onclick = () => {
      S.cfg.scope = b.dataset.v;
      if (S.cfg.scope === 'standard') {
        // 特殊にのみ属する選択肢が選ばれている軸をデフォルトへ戻す（2.2.2節）
        if (SPECIAL.rule[S.cfg.rule]) S.cfg.rule = 'G-01';
        if (SPECIAL.shape[S.cfg.shape]) { S.cfg.shape = 'A-01'; S.cfg.carom = (S.cfg.rule === 'G-04'); S.cfg.tableChosen = true; }
        if (SPECIAL.mode[S.cfg.mode]) S.cfg.mode = 'normal';
        S.cfg.mods['G-13'] = false; S.cfg.mods['G-15'] = false;
        if (SPECIAL.diff[S.cfg.diff]) S.cfg.diff = 'easy';
      }
      buildSetup();
    };
  });
  [].forEach.call($('seg-cue').children, b => {
    b.onclick = () => { if (b.disabled) return; setCuePreset(b.dataset.v); buildSetup(); };
  });
  $('sel-players').onchange = e => { S.cfg.players = +e.target.value; buildSetup(); };
  $('sel-aicount').onchange = e => { S.cfg.aiCount = +e.target.value; buildSetup(); };
  $('in-target').onchange = e => { S.cfg.target = Math.max(1, +e.target.value || 10); };
  $('in-tbase').onchange = e => { S.cfg.tbase = Math.max(0, +e.target.value || 0); };
  $('in-tbank').onchange = e => { S.cfg.tbank = Math.max(0, +e.target.value || 0); };

  $('btn-start').onclick = () => {
    AU.sfx('button');
    if (S.cfg.format === 'online') { openLobby(); return; }
    S.net.on = false;
    startGame(newSeed(), null, null);
  };
  $('btn-create').onclick = () => {
    NET.createRoom({
      hostName: $('in-name').value || 'Host',
      roomName: $('in-room').value || 'Billiards',
      password: $('in-pw').value || '',
      isPublic: !$('in-private').checked,
      maxPlayers: S.cfg.players,
      config: netConfig(),
    });
  };
  $('btn-refresh').onclick = () => NET.refresh();
  $('btn-room-start').onclick = () => {
    const st = NET.state();
    const players = (st.roster || []).filter(r => r.role !== 'spectator')
      .map(r => ({ name: r.name || 'Player', type: 'human' }));
    while (players.length < 2) players.push({ name: 'Player' + (players.length + 1), type: 'human' });
    const seed = newSeed();
    NET.send({ k: 'start', seed, config: netConfig(), names: players });
    S.net.myIdx = indexOfMe(players);
    startGame(seed, players, null);
  };

  $('btn-quit').onclick = () => {
    if (S.net.on) { NET.leave(); S.net.on = false; }
    show('setup');
  };
  $('btn-deadlock').onclick = () => { if (isMyTurn()) askDeadlock(false); };
  $('btn-replay').onclick = () => {
    if (!S.replay) return;
    const w = E.createWorld(S.game.table, S.replay.balls.map(b => Object.assign({}, b)), S.game.tuning);
    const cue = w.balls.find(b => b.kind === 'cue' && (S.game.rule !== 'G-04' || b.owner === S.replay.turn));
    if (!cue) return;
    E.applyCue(cue, S.replay.shot);
    S.replayRun = w;
  };
  $('btn-again').onclick = () => { AU.sfx('button'); startGame(newSeed(), null, null); };
  $('btn-to-setup').onclick = () => { AU.sfx('button'); show('setup'); };

  $('lang-select').onchange = e => { I.setMode(e.target.value); applyLang(); };

  function newSeed() { return (Math.random() * 4294967296) >>> 0; }

  // ══════════════════════════════════════════════
  //  起動
  // ══════════════════════════════════════════════
  function boot() {
    I.init();
    $('version-tag').textContent = 'v' + APP_VER;
    applyLang();
    AU.bindVisibility();
    // 音は最初の操作で解禁する（起動直後の自動再生はブラウザが止めるため）。
    // 一度でも選んだことがあれば、その選択（音量・ミュート）をそのまま尊重して
    // 確認を挟まない。毎回たずねられるのは煩わしいだけで、選び直しは設定からできる。
    let asked = false;
    try { asked = localStorage.getItem('billiards_bgm_muted') !== null; } catch (e) {}
    const arm = () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      if (asked) AU.enableAuto();
      else $('modal-audio').classList.add('on');
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    $('btn-audio-yes').onclick = () => { $('modal-audio').classList.remove('on'); AU.enable(); };
    $('btn-audio-no').onclick = () => { $('modal-audio').classList.remove('on'); AU.enableMuted(); };

    // 盤面領域ではブラウザ既定のジェスチャを抑止する（4.11.2節）
    document.addEventListener('touchmove', e => {
      if (e.target === cv) e.preventDefault();
    }, { passive: false });

    resizeBoard();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // デバッグ用の窓口（?debug=1 のときだけ）
  if (location.search.indexOf('debug=1') >= 0) {
    window.BL = { S, E, RU, T, I, fire: fireShot, shootNow, beginTurn, startGame, finishShot, applyShot, draw2D, draw3D, minElevFor, computeElevFan };
  }
})();
