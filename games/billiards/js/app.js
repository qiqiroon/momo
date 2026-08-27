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

  const APP_VER = '1.05';                 // デプロイのたびに 0.01 繰り上げる（11.8.2節）
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

  // ?debug=1 のときだけ、1フレームの内訳（物理・描画）を画面に出す。
  // 「処理落ちしている気がする」を推測で語らないための物差し
  const DEBUG = location.search.indexOf('debug=1') >= 0;

  const KEY_NAME = 'billiards_name', KEY_ROOM = 'billiards_room';
  const KEY_SPEED = 'billiards_anim_speed';

  /*
   * 玉が転がる速さ（見た目だけ）。
   * 物理の刻みは 1/480 秒のまま動かさない。変えるのは「1コマで何刻みぶん進めるか」だけ。
   * したがって同じ入力からは同じ結果が出る＝決定論は崩れない（通信対戦・リプレイも無事）。
   * キューの動き・画面の切り替わり・AIの考える間には効かせない。
   */
  function animSpeed() {
    if (S.animSpeed == null) {
      let v = 1;
      try { v = parseFloat(localStorage.getItem(KEY_SPEED)) || 1; } catch (e) {}
      S.animSpeed = Math.min(2, Math.max(0.5, v));
    }
    return S.animSpeed;
  }
  function setAnimSpeed(v) {
    S.animSpeed = Math.min(2, Math.max(0.5, v));
    try { localStorage.setItem(KEY_SPEED, String(S.animSpeed)); } catch (e) {}
    const el = $('speed-val'); if (el) el.textContent = S.animSpeed.toFixed(1) + '×';
  }
  const DEFAULT_NAME = 'MOMO太郎';

  // ───────── 状態 ─────────
  const S = {
    screen: 'home',
    cfg: {
      scope: 'standard',
      rule: 'G-01', shape: 'A-01', carom: false, tableChosen: true,
      mode: 'normal',
      mods: { 'G-13': false, 'G-14': true, 'G-15': false },
      diff: 'easy',
      cue: [false, false, false, false, false, false, false],   // 撞球の癖7項目（既定=簡単）
      players: 2, aiCount: 1, format: 'local',
      target: 10, tbase: 30, tbank: 5,
      coop: false, teams: [], shotLimit: 30,
    },
    game: null,
    phase: 'idle',         // idle|place|aim|stance|rolling|wait|over
    aim: { dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0 },
    elevFan: null, elevAdjusting: false,
    aimPreview: null, aimDirty: true,
    drag: null,
    placePos: null, pendingPlace: null,
    msg: '',
    replay: null, replayRun: null,
    clock: { baseLeft: 0, banks: [], running: false },
    net: { on: false, role: 'none', isHost: false, myPid: null, myIdx: -1, roster: [], lastRooms: [], wsOpen: false, wasClosed: false, ready: {}, sentCfg: null },
    aiCancel: null, confirmCb: null, dlVotes: {},
    chk: {},               // 受け取った盤面照合（ショット番号 → 指紋）。追いついてから比べる
    won: false,
    wakeLock: null,
  };

  // ══════════════════════════════════════════════
  //  言語
  // ══════════════════════════════════════════════
  function applyLang() {
    const bl = I.brandLang();
    const subText = (bl === 'zh') ? '百变球台，一杆入魂' : 'Any Shape, Any Rule, One Cue';
    ['subtitle', 'subtitle-2', 'subtitle-3', 'subtitle-4', 'subtitle-5', 'subtitle-6'].forEach(id => {
      const e = $(id); if (!e) return;
      e.textContent = subText; e.classList.toggle('zh', bl === 'zh');
    });
    document.documentElement.lang = (bl === 'zh') ? 'zh' : bl;

    const set = (id, k) => { const e = $(id); if (e) e.textContent = t(k); };
    set('lbl-rule', 'axis.rule'); set('lbl-table', 'axis.table'); set('lbl-mode', 'axis.mode');
    set('lbl-diff', 'axis.diff'); set('lbl-cue', 'cue.title'); set('cue-note', 'cue.note');
    set('lbl-format', 'opt.format'); set('lbl-players', 'opt.players');
    set('lbl-aicount', 'opt.aiCount'); set('lbl-target', 'opt.target');
    set('lbl-time', 'time.title'); set('lbl-time-en', 'time.enable');
    set('time-off-note', 'time.off'); set('lbl-mod-extra', 'time.other');
    set('lbl-tbase', 'opt.time.base'); set('lbl-tbank', 'opt.time.bank');
    set('u-sec', 'opt.sec'); set('u-min', 'opt.min');
    set('lbl-coop', 'coop.title'); set('lbl-limit', 'coop.limit'); set('u-shots', 'coop.shots');
    set('btn-start', 'btn.start');
    set('k-turn', 'hud.turn'); set('k-next', 'hud.next'); set('k-foul', 'hud.foul');
    set('k-base', 'hud.base'); set('k-bank', 'hud.time'); set('k-elevlabel', 'hint.elev');
    set('btn-replay', 'btn.replay'); set('btn-deadlock', 'btn.deadlock'); set('btn-quit', 'btn.quit');
    set('btn-again', 'res.again'); set('btn-to-setup-t', 'res.toMenu'); set('res-title', 'res.title');
    set('audio-title', 'audio.title'); set('audio-desc', 'audio.desc');
    set('btn-audio-yes', 'audio.yes'); set('btn-audio-no', 'audio.no');
    set('set-title', 'set.title'); set('set-bgm', 'set.bgm'); set('set-sfx', 'set.sfx');
    set('set-mute1', 'set.mute'); set('set-mute2', 'set.mute'); set('btn-set-close', 'nav.close');
    set('set-speed', 'set.speed'); set('speed-note', 'set.speedNote');
    set('dl-title', 'dl.title'); set('dl-ask', 'dl.ask');
    set('btn-dl-yes', 'btn.yes'); set('btn-dl-no', 'btn.no'); set('btn-note-close', 'nav.close');
    set('lbl-myname', 'lobby.name'); set('lbl-roomname', 'lobby.room'); set('lbl-pw', 'lobby.pw2');
    set('lbl-private', 'lobby.private'); set('btn-create', 'lobby.create'); set('lbl-create', 'lobby.create');
    set('lbl-rooms', 'lobby.rooms'); set('btn-refresh', 'lobby.refresh');
    set('btn-lobby-back', 'nav.back'); set('btn-room-leave', 'nav.back');
    set('btn-setup-back', 'nav.back'); set('setup-title', 'setup.title');
    set('foot-about', 'foot.about'); set('foot-desc', 'foot.desc');
    set('foot-top', 'foot.top'); set('foot-games', 'foot.games'); set('foot-tools', 'foot.tools');
    $('btn-gear').title = t('set.open');
    $('seg-scope').children[0].textContent = t('sw.standard');
    $('seg-scope').children[1].textContent = t('sw.special');
    $('seg-cue').children[0].textContent = t('cue.simple');
    $('seg-cue').children[1].textContent = t('cue.real');
    $('seg-cue').children[2].textContent = t('cue.custom');
    $('lang-select').value = I.mode;
    refreshServerStatus();
    buildHome();
    buildSetup();
    if (S.screen === 'room') showRoom();
    renderHUD();
    renderRooms(S.net.lastRooms);
  }

  // ══════════════════════════════════════════════
  //  トップ（タイトル＋ゲーム選択）
  // ══════════════════════════════════════════════
  function chip(label, sel, dis, why, onClick, desc) {
    const d = document.createElement('div');
    d.className = 'opt' + (sel ? ' sel' : '') + (dis ? ' dis' : '') + (desc ? ' wide' : '');
    d.textContent = label;
    // 遊び方の説明。名前だけでは何をするゲームか分からない
    if (desc) { const s = document.createElement('span'); s.className = 'desc'; s.textContent = desc; d.appendChild(s); }
    if (why) { const s = document.createElement('span'); s.className = 'why'; s.textContent = why; d.appendChild(s); }
    if (!dis) d.onclick = () => { AU.sfx('select'); onClick(); };
    return d;
  }

  /**
   * 選択不可・自動無効化・段階による未実装をまとめて返す（2.4節・11.6.1節）。
   * グレーは台形状の側にだけ掛け、ルールを選び直して台が成立しなくなったときは
   * 台の選択を解除して選び直しを求める（2.5.3節）。両方向へ掛けると行き止まりができる。
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
  function diffBlock(d) { return (d === 'apocalypse' && S.cfg.mode === 'normal') ? t('why.noGimmick') : null; }
  function formatBlock(f) { return (STAGE.format[f] >= 9) ? t('why.stage2') : null; }
  function visible(kind, id) {
    if (S.cfg.scope === 'special') return true;
    return !(SPECIAL[kind] && SPECIAL[kind][id]);
  }

  /**
   * 設定の中身（#setup-block）を指定の入れ物へ移す。
   * 同じ画面を2つ作らないための仕掛け＝設定画面と部屋で必ず同じものが出る。
   * @param {boolean} readonly ゲストは見えるだけで触れない
   */
  function mountSetup(hostId, readonly) {
    const blk = $('setup-block'), host = $(hostId);
    if (!blk || !host) return;
    if (blk.parentNode !== host) host.appendChild(blk);
    blk.classList.toggle('readonly', !!readonly);
    buildSetup();
  }

  /** 最上位画面＝遊び方を選ぶだけ */
  function buildHome() {
    const box = $('opts-format'); if (!box) return;
    box.innerHTML = '';
    // 協力プレイはここに並べない。遊び方ではなく「勝ち負けを見る相手を
    // 個人からチームへ差し替える」スイッチなので、人数のところに置いてある
    ['local', 'ai', 'practice', 'online'].forEach(f => {
      const why = formatBlock(f);
      const b = document.createElement('button');
      b.className = 'fmt-btn';
      b.disabled = !!why;
      b.innerHTML = '<span>' + escapeHtml(t('fmt.' + f)) + '</span>' +
        '<span class="sub">' + escapeHtml(why || t('fmt.desc.' + f)) + '</span>';
      b.onclick = () => {
        AU.sfx('select');
        S.cfg.format = f;
        syncPlayers();
        if (f === 'online') { openLobby(); return; }
        S.net.on = false;
        show('setup');
      };
      box.appendChild(b);
    });
  }

  function buildSetup() {
    const or = $('opts-rule'); if (!or) return;
    or.innerHTML = '';
    RULES_ALL.forEach(id => {
      if (!visible('rule', id)) return;
      const why = ruleBlock(id);
      or.appendChild(chip(t('rule.' + id), S.cfg.rule === id, !!why, why,
        () => { S.cfg.rule = id; onRuleChanged(); }, t('rule.how.' + id)));
    });
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
    const om = $('opts-mode'); om.innerHTML = '';
    ['normal', 'disturb', 'abnormal'].forEach(m => {
      if (!visible('mode', m)) return;
      const why = modeBlock(m);
      om.appendChild(chip(t('mode.' + m), S.cfg.mode === m, !!why, why, () => { S.cfg.mode = m; buildSetup(); }));
    });
    const of = $('opts-diff'); of.innerHTML = '';
    ['easy', 'hard', 'apocalypse'].forEach(d => {
      if (!visible('diff', d)) return;
      const why = diffBlock(d);
      of.appendChild(chip(I.DIFF_LABEL[d], S.cfg.diff === d, !!why, why, () => {
        S.cfg.diff = d;
        setCuePreset(d === 'easy' ? 'simple' : 'real');   // 難易度は撞球の癖の既定値を与える（2.3.5節③）
        buildSetup();
      }));
    });
    // 持ち時間設定。ON のときだけ2つの値を出す
    $('sw-time').checked = !!S.cfg.mods['G-14'];
    $('time-fields').style.display = S.cfg.mods['G-14'] ? '' : 'none';
    $('time-off-note').style.display = S.cfg.mods['G-14'] ? 'none' : '';
    $('in-tbase').value = S.cfg.tbase; $('in-tbank').value = S.cfg.tbank;
    // 「そのほかの追加ルール」は特殊のときだけ現れる（標準では上位スイッチが隠す）
    const extras = ['G-13', 'G-15'].filter(m => visible('mod', m));
    $('mod-extra').style.display = extras.length ? '' : 'none';
    const od = $('opts-mod'); od.innerHTML = '';
    extras.forEach(m => {
      const why = modBlock(m);
      od.appendChild(chip(t('mod.' + m), !!S.cfg.mods[m] && !why, !!why, why, () => { S.cfg.mods[m] = !S.cfg.mods[m]; buildSetup(); }));
    });

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
    $('sel-players').parentNode.style.display = (S.cfg.format === 'ai') ? 'none' : '';
    const selA = $('sel-aicount'); selA.innerHTML = '';
    for (let n = 1; n <= Math.max(1, maxP - 1); n++) {
      const o = document.createElement('option'); o.value = n; o.textContent = n; selA.appendChild(o);
    }
    if (S.cfg.aiCount > maxP - 1) S.cfg.aiCount = Math.max(1, maxP - 1);
    selA.value = S.cfg.aiCount;
    $('wrap-target').style.display = (S.cfg.rule === 'G-04') ? '' : 'none';
    $('in-target').value = S.cfg.target;

    // 協力プレイ。2人以上いないとチームの意味がない（9.2.3節）
    const seats = seatNames().length;
    if (seats < 2 && S.cfg.coop) S.cfg.coop = false;
    $('coop-block').style.display = seats >= 2 ? '' : 'none';
    $('sw-coop').checked = !!S.cfg.coop;
    buildTeams();
    const solo = S.cfg.coop && soloTeam();
    $('wrap-limit').style.display = solo ? '' : 'none';
    $('in-limit').value = S.cfg.shotLimit;
    $('coop-note').textContent = !S.cfg.coop ? t('coop.off')
      : solo ? t('coop.solo') : t('coop.on');

    const bad = !S.cfg.tableChosen || !!ruleBlock(S.cfg.rule) || !!shapeBlock(S.cfg.shape, S.cfg.carom);
    $('btn-start').disabled = bad;
    $('setup-format-note').textContent = t('setup.forFormat', { f: t('fmt.' + S.cfg.format) });
    if ($('btn-ready')) $('btn-ready').disabled = bad;

    // ホストが部屋の中で設定を変えたら、その場でゲストへ配る。
    // 変わっていないのに送らない＝同じ設定を撞くたびに流さない
    if (S.screen === 'room' && S.net.on && S.net.isHost) {
      const now = JSON.stringify(S.cfg);
      if (now !== S.net.sentCfg) {
        S.net.sentCfg = now;
        NET.send({ k: 'cfg', config: netConfig() });
        clearReady();                         // 条件が変わったら合意はやり直し
      }
    }
  }

  // ══════════════════════════════════════════════
  //  協力プレイのチーム分け（9.7節）
  // ══════════════════════════════════════════════
  const TEAM_MAX = 4;

  /** いま席に着くことになる人の名前。設定画面と部屋とで出どころが違う */
  function seatNames() {
    // 部屋では席順そのものから引く。名簿を各自で数え直すと並びがずれる
    if (S.screen === 'room' && S.net.on) return seatList().map(s => s.name);
    if (S.cfg.format === 'ai') {
      const out = [t('seat.you')];
      for (let i = 0; i < S.cfg.aiCount; i++) out.push('AI' + (i + 1));
      return out;
    }
    const out = [];
    for (let i = 0; i < S.cfg.players; i++) out.push('P' + (i + 1));
    return out;
  }

  /**
   * 席の数に合わせてチームの割り当てを整える。
   * 既定は交互（A B A B）。ビリヤードのダブルスは相手と交互に撞くので、
   * 席の順にそのまま回せば自然に相手チームと入れ替わる。
   */
  function syncTeams(n) {
    const a = S.cfg.teams || (S.cfg.teams = []);
    for (let i = 0; i < n; i++) if (a[i] == null || a[i] >= TEAM_MAX) a[i] = i % 2;
    a.length = n;
    return a;
  }

  /** チームが1つしかない＝相手がいない。規定打数で決着をつける（9.7.3節） */
  function soloTeam() {
    const a = S.cfg.teams || [];
    return a.length > 0 && a.every(v => v === a[0]);
  }

  function buildTeams() {
    const box = $('team-rows'); if (!box) return;
    box.innerHTML = '';
    const names = seatNames();
    const teams = syncTeams(names.length);
    if (!S.cfg.coop) return;
    names.forEach((nm, i) => {
      const row = document.createElement('div'); row.className = 'team-row';
      const seat = document.createElement('span'); seat.className = 'seat'; seat.textContent = (i + 1) + '.';
      const who = document.createElement('span'); who.className = 'who'; who.textContent = nm;
      const pick = document.createElement('div'); pick.className = 'team-pick';
      for (let tm = 0; tm < TEAM_MAX; tm++) {
        const b = document.createElement('button');
        b.dataset.t = tm; b.textContent = 'ABCD'[tm];
        b.classList.toggle('sel', teams[i] === tm);
        b.onclick = () => { S.cfg.teams[i] = tm; AU.sfx('select'); buildSetup(); };
        pick.appendChild(b);
      }
      row.appendChild(seat); row.appendChild(who); row.appendChild(pick);
      box.appendChild(row);
    });
  }

  function onRuleChanged() {
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
    return on === 0 ? 'simple' : (on === 7 ? 'real' : 'custom');
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
    if (name !== 'play') closeResult();       // 盤面から離れたら結果も畳む
    ['home', 'setup', 'lobby', 'room', 'play'].forEach(n => {
      $('scr-' + n).classList.toggle('on', n === name);
    });
    // 設定の中身は1つしか無い。設定画面と部屋の間を行き来させる
    if (name === 'setup') mountSetup('setup-host', false);
    else if (name === 'room') mountSetup('setup-host-room', !S.net.isHost);
    AU.setBgm(name === 'play' ? 'game' : 'lobby');
    if (name === 'play') { requestWakeLock(); resizeBoard(); }
    else releaseWakeLock();
    window.scrollTo(0, 0);
  }

  // 対戦中は画面を消させない（携帯で撞いている途中に暗転しないように）
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || S.wakeLock) return;
    navigator.wakeLock.request('screen').then(l => {
      S.wakeLock = l;
      l.addEventListener('release', () => { S.wakeLock = null; });
    }).catch(() => {});
  }
  function releaseWakeLock() {
    if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.screen === 'play') requestWakeLock();
  });

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
    if (remoteCfg) Object.assign(S.cfg, remoteCfg);   // 通信対戦はホストの設定を強制適用（9.5.3節）
    const cfg = S.cfg;
    const g = RU.createGame({
      rule: cfg.rule, hasPockets: !cfg.carom,
      players: players || playerList(),
      seed: seed >>> 0, difficulty: cfg.diff,
      tuning: tuningFromCfg(), targets: null,
      coop: !!cfg.coop, teams: (cfg.teams || []).slice(), shotLimit: cfg.shotLimit,
    });
    g.players.forEach(p => { if (cfg.rule === 'G-04') p.target = cfg.target; });
    S.game = g;
    S.chk = {};                             // 前の局の照合は持ち越さない
    S.replay = null; S.replayRun = null;
    S.clock.banks = g.players.map(() => cfg.tbank * 60);
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
    S.aimDirty = true; S.pendingPlace = null; S.drag = null;
    $('elev').value = 0;
    const cue = RU.cueBallOf(g, g.turn);
    if (cue) { S.aim.dir = 0; computeElevFan(cue); }

    if (g.ballInHand && cue) {
      S.phase = 'place';
      // ブレイクの初期位置はヘッドストリングの少し手前。そこから自由に動かせる
      S.placePos = g.ballInHandFull ? { x: cue.x, y: cue.y } : { x: g.table.headSpot.x - 160, y: 0 };
      if (!placeOk(S.placePos)) S.placePos = { x: g.table.headSpot.x - 160, y: 0 };
    } else {
      S.phase = 'aim';
    }
    S.clock.baseLeft = S.cfg.mods['G-14'] ? S.cfg.tbase : 0;
    S.clock.lastBeep = 0;
    S.clock.running = S.cfg.mods['G-14'] && isMyTurn() && g.players[g.turn].type === 'human';

    if (g.players[g.turn].type === 'ai') {
      S.phase = 'wait';
      setMsg(t('ph.thinking'));
      let aiPlace = null;
      if (g.ballInHand) {
        aiPlace = BilliardsAI.pickBallInHand(g, g.turn);
        if (!g.ballInHandFull) aiPlace = clampToKitchen(aiPlace);
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
      setMsg(S.phase === 'place' ? (g.ballInHandFull ? t('ph.freeArea') : t('ph.placeArea')) : t('ph.aim'));
      AU.sfx('turn');
    }
    renderHUD();
  }

  /**
   * ブレイクはヘッドストリングより手前に置く（現実のビリヤードの規則）。
   * 規則が見ているのは玉の中心であって、玉の縁ではない。
   * 半径ぶん内側へ狭めると、既定の置き場所（ヘッドスポット）自体が違反になって
   * 「置けないのに理由が分からない」状態になる。
   */
  function kitchenLimit() { return S.game.table.headSpot.x; }
  function clampToKitchen(p) { return { x: Math.min(p.x, kitchenLimit()), y: p.y }; }

  // ══════════════════════════════════════════════
  //  キュー構え可否（4.7節）
  // ══════════════════════════════════════════════
  const CUE_LEN = 1400;
  function computeElevFan(cue) {
    const fan = new Float32Array(360);
    // 壁までの距離も一緒に覚える。角度の絵に「何に当たっているのか」を描くため
    const dist = new Float32Array(360).fill(Infinity);
    S.elevDist = dist;
    if (!S.cfg.cue[6]) { S.elevFan = fan; return; }
    const table = S.game.table;
    const hNeed = table.cushionTop - cue.r;
    for (let d = 0; d < 360; d++) {
      const a = d * Math.PI / 180 + Math.PI;      // キューは撞く向きの反対側へ伸びる
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
      dist[d] = L;
      if (L <= 1) { fan[d] = Math.PI / 2; continue; }
      fan[d] = Math.min(Math.PI / 2, Math.atan2(Math.max(0, hNeed), L));
    }
    S.elevFan = fan;
  }
  function dirIndex(dir) {
    let d = Math.round(dir * 180 / Math.PI) % 360; if (d < 0) d += 360;
    return d;
  }
  function minElevFor(dir) {
    if (!S.elevFan) return 0;
    return S.elevFan[dirIndex(dir)];
  }
  /** いま向いている方向で、キューの尻がぶつかる壁までの距離。無ければ Infinity */
  function wallDistFor(dir) {
    if (!S.elevDist) return Infinity;
    return S.elevDist[dirIndex(dir)];
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

    g.history.push({ n: g.shotNo, shot: Object.assign({}, shot), place: place || null });
    S.replay = { balls: g.world.balls.map(b => Object.assign({}, b)), shot: Object.assign({}, shot), turn: g.turn };

    const pre = {
      cueId: cue.id,
      targetIds: (RU.legalTargets(g, g.turn) || []).map(b => b.id),
      doubleHit: RU.detectDoubleHit(g, cue, shot),
      miscue: S.cfg.cue[1] && E.isMiscue(shot),
    };
    S.clock.running = false;

    if (pre.miscue) {
      setMsg(t('ev.miscue'));                 // ミスキューはファウルではない（5.9.2節）
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
    if (!animate) { E.runShot(g.world, 20); finishShot(); }
  }

  function finishShot() {
    const g = S.game;
    const res = RU.resolveShot(g, S.pre, g.world.events);

    if (!g.broken && RU.HAS_RACK[g.rule]) {
      const ok = RU.breakValid(g.world.events, res.pocketed.length);
      g.broken = true;
      if (!ok) { setMsg(t('ev.breakFail')); res.continueTurn = false; }
    }

    let msg = '';
    if (res.fouls.length) msg = res.fouls.map(f => t('foul.' + f)).join(' / ');
    if (res.message) { msg = (msg ? msg + ' — ' : '') + t(res.message); g.lastMessageKey = res.message; }
    if (res.gained) msg = (msg ? msg + ' — ' : '') + '+' + res.gained;
    setMsg(msg);
    if (res.fouls.length) {
      AU.sfx('foul');
      // ファウルは盤の真ん中に大きく出す。これが見えないと
      // 「玉が落ちたのに手番が移った」理由が分からない
      flash(t('hud.foul') + '　' + res.fouls.map(f => t('foul.' + f)).join(' / '), 'foul');
    }

    if (S.cfg.format === 'practice' && (res.gameOver || g.over)) {
      setTimeout(() => startGame(newSeed(), null, null), 900);   // 練習は勝敗を持たない（9.6.1節）
      return;
    }
    // 端末どうしで盤面が食い違っていないかを毎ショット確かめる（9.5.5節）
    if (S.net.on && S.net.isHost) NET.send({ k: 'chk', n: g.shotNo, h: boardHash() });
    else if (S.net.on) compareBoardCheck();   // 先に届いていた照合と、いま比べる

    if (res.gameOver || g.over) { endGame(); return; }
    if (g.deadlockCount >= 12) { g.deadlockCount = 0; askDeadlock(true); return; }

    RU.nextTurn(g, res);
    renderHUD();
    setTimeout(beginTurn, 800);
  }

  function endGame() {
    const g = S.game;
    S.phase = 'over'; S.clock.running = false;
    if (RU.WIN_KIND[g.rule] === 'points') RU.finishRanking(g);
    // 勝ったかどうかはチームで見る。協力プレイでなければ 1人＝1チームなので同じ答えになる
    const meIdx = S.net.on ? S.net.myIdx : 0;
    const myTeam = (meIdx >= 0 && g.players[meIdx]) ? RU.teamOf(g, meIdx) : -1;
    const won = (g.winTeam >= 0) && (S.net.on ? g.winTeam === myTeam
      : RU.teamMembers(g, g.winTeam).some(p => p.type === 'human'));
    S.won = won;
    AU.sfx(won ? 'win' : 'lose');
    renderResult();
    openResult();                           // 盤面は消さない。上に重ねて出す
  }

  // ══════════════════════════════════════════════
  //  結果のポップアップ（盤面に重ねる・つまんで動かせる）
  // ══════════════════════════════════════════════
  function openResult() {
    const pop = $('result-pop'); if (!pop) return;
    pop.classList.add('on');
    placeResultCentered();
  }
  function closeResult() {
    const pop = $('result-pop'); if (pop) pop.classList.remove('on');
  }
  function resultOpen() { const p = $('result-pop'); return !!p && p.classList.contains('on'); }
  function placeResultCentered() {
    const pop = $('result-pop'), pane = $('board-pane');
    if (!pop || !pane) return;
    const pw = pane.clientWidth, ph = pane.clientHeight;
    pop.style.left = Math.max(4, (pw - pop.offsetWidth) / 2) + 'px';
    pop.style.top = Math.max(4, (ph - pop.offsetHeight) / 2) + 'px';
  }
  /** つまんで動かす。盤面の外へ出してしまうと戻せなくなるので枠内に留める */
  (function enableResultDrag() {
    const bar = $('rp-bar'), pop = $('result-pop'), pane = $('board-pane');
    if (!bar || !pop || !pane) return;
    let d = null;
    bar.addEventListener('pointerdown', e => {
      d = { x: e.clientX, y: e.clientY, l: pop.offsetLeft, t: pop.offsetTop };
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); e.stopPropagation();
    });
    bar.addEventListener('pointermove', e => {
      if (!d) return;
      const maxL = Math.max(0, pane.clientWidth - pop.offsetWidth);
      const maxT = Math.max(0, pane.clientHeight - pop.offsetHeight);
      pop.style.left = clamp(d.l + (e.clientX - d.x), 0, maxL) + 'px';
      pop.style.top = clamp(d.t + (e.clientY - d.y), 0, maxT) + 'px';
      e.preventDefault(); e.stopPropagation();
    });
    const end = e => { d = null; if (e) e.stopPropagation(); };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  })();

  // ══════════════════════════════════════════════
  //  持ち時間制（8.4節）
  // ══════════════════════════════════════════════
  function tickClock(dtMs) {
    if (!S.clock.running || !S.cfg.mods['G-14']) return;
    const g = S.game; if (!g || g.over) return;
    const dt = dtMs / 1000;
    if (S.clock.baseLeft > 0) {
      S.clock.baseLeft = Math.max(0, S.clock.baseLeft - dt);
    } else {
      S.clock.banks[g.turn] -= dt;
      if (S.clock.banks[g.turn] <= 0) {
        S.clock.banks[g.turn] = 0; S.clock.running = false;
        onTimeout(true);
      }
    }
    // 残り5秒からは1秒ごとに鳴らす。数字だけだと気づけない
    const whole = Math.ceil(clockRemain());
    if (whole >= 1 && whole <= 5 && whole !== S.clock.lastBeep) {
      S.clock.lastBeep = whole;
      if (isMyTurn()) AU.sfx('tick');
    } else if (whole > 5) {
      S.clock.lastBeep = 0;
    }
  }
  /** いま減っているほうの残り秒。基本制限時間を使い切ったら持ち時間へ移る */
  function clockRemain() {
    const g = S.game; if (!g) return Infinity;
    if (S.clock.baseLeft > 0) return S.clock.baseLeft;
    return S.clock.banks[g.turn] || 0;
  }
  function onTimeout(local) {
    const g = S.game;
    AU.sfx('timeup');
    flash(t('ev.timeout'), 'warn');
    setMsg(t('ev.timeout'));                  // タイムアウトはパスと同じ（8.4.4節）
    if (S.net.on && local) NET.send({ k: 'timeout', n: g.shotNo });
    g.history.push({ n: g.shotNo, timeout: true });
    g.shotNo++;
    RU.nextTurn(g, { continueTurn: false });
    setTimeout(beginTurn, 700);
  }

  // ══════════════════════════════════════════════
  //  デッドロック（10.8節）
  // ══════════════════════════════════════════════
  function askDeadlock() {
    const g = S.game;
    if (g.players.length === 1) { redoRack(); return; }   // 1人なら確認せず即やり直す（10.8.5節）
    if (S.net.on) NET.send({ k: 'dl-open' });
    openDeadlockVote();
  }
  function openDeadlockVote() {
    S.dlVotes = {};
    openConfirm(t('dl.title'), t('dl.ask'),
      () => { if (!S.net.on) { redoRack(); return; } castVote(true); },
      () => { if (!S.net.on) { setMsg(t('dl.refused')); return; } castVote(false); });
  }
  function castVote(ok) {
    setMsg(ok ? t('dl.wait') : t('dl.refused'));
    if (S.net.isHost) tallyVote(S.net.myIdx, ok);
    else NET.send({ k: 'dl-vote', ok, idx: S.net.myIdx }, 'host');
  }
  function tallyVote(idx, ok) {
    if (!S.net.isHost || !S.game) return;
    S.dlVotes = S.dlVotes || {};
    S.dlVotes[idx] = ok;
    if (!ok) { NET.send({ k: 'dl-cancel' }); setMsg(t('dl.refused')); S.dlVotes = {}; return; }
    for (let i = 0; i < S.game.players.length; i++) if (!S.dlVotes[i]) return;
    NET.send({ k: 'dl-redo' });
    S.dlVotes = {};
    redoRack();
  }
  function redoRack() {
    const g = S.game;
    g.redoCount++;
    const players = g.players.map(p => ({ name: p.name, type: p.type }));
    startGame(g.seed, players, null);       // シードは引き継ぐ（10.8.6節）
  }

  // ══════════════════════════════════════════════
  //  描画
  // ══════════════════════════════════════════════
  const cv = $('board');
  const ctx = cv.getContext('2d');
  let view = { s: 1, cx: 0, cy: 0, w: 0, h: 0, mobile: false };

  function resizeBoard() {
    const pane = $('board-pane');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = pane.clientWidth, h = pane.clientHeight;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = w; view.h = h;
    view.mobile = window.innerWidth <= 860;
    view.topInset = null;                    // タイトルの高さは測り直す
    // 長軸を画面の縦方向へ（4.10.1節）。枠（クッションの厚み）まで含めて収める
    const frame = 95;                        // クッションと外枠のぶん（mm 換算の余裕）
    const outerW = T.PLAY_H + frame * 2, outerH = T.PLAY_W + frame * 2;
    view.s = Math.min(w / outerW, h / outerH);
    view.cx = w / 2; view.cy = h / 2;
  }
  window.addEventListener('resize', resizeBoard);
  // 画面を切り替えた直後は要素の大きさがまだ確定していないことがある。
  // 確定した時点で必ず取り直す（携帯で台が上下に欠けるのはこれを取りこぼしたとき）
  if (window.ResizeObserver) new ResizeObserver(resizeBoard).observe($('board-pane'));

  function toScreen(tx, ty) { return { x: view.cx + ty * view.s, y: view.cy - tx * view.s }; }
  function toTable(sx, sy) { return { x: (view.cy - sy) / view.s, y: (sx - view.cx) / view.s }; }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /** 木目の枠。単色だと板に見えないので、縞と面取りの光を重ねる */
  function drawFrame(x, y, w, h, thick) {
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#4a2a15'); g.addColorStop(.28, '#6b3d1f');
    g.addColorStop(.52, '#8a5228'); g.addColorStop(.76, '#5e3319'); g.addColorStop(1, '#3d2211');
    roundRect(x, y, w, h, Math.min(18, thick * .7)); ctx.fillStyle = g; ctx.fill();
    // 木目
    ctx.save(); roundRect(x, y, w, h, Math.min(18, thick * .7)); ctx.clip();
    ctx.globalAlpha = .12;
    for (let i = 0; i < 46; i++) {
      const yy = y + (h * i) / 46 + Math.sin(i * 1.7) * 3;
      ctx.beginPath(); ctx.moveTo(x, yy);
      ctx.bezierCurveTo(x + w * .3, yy + 5, x + w * .7, yy - 5, x + w, yy + 2);
      ctx.strokeStyle = (i % 2) ? '#2a1608' : '#a5713c';
      ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    // 上面の光と内側の落ち影
    ctx.globalAlpha = .5;
    roundRect(x + 1.5, y + 1.5, w - 3, h - 3, Math.min(16, thick * .6));
    ctx.strokeStyle = 'rgba(255,220,180,.35)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** ポケット。ただの黒丸ではなく、革の口・落ち込む影・レール側の切り欠きを描く */
  function drawPocket(p, s) {
    const q = toScreen(p.x, p.y);
    const r = p.r * s;
    ctx.save();
    // 革の口（外周のリング）
    const ring = ctx.createRadialGradient(q.x, q.y, r * .55, q.x, q.y, r * 1.35);
    ring.addColorStop(0, 'rgba(0,0,0,0)');
    ring.addColorStop(.45, '#2b1a10');
    ring.addColorStop(.8, '#4a2f1c');
    ring.addColorStop(1, 'rgba(74,47,28,0)');
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.35, 0, 7); ctx.fillStyle = ring; ctx.fill();
    // 穴そのもの（奥ほど暗い）
    const hole = ctx.createRadialGradient(q.x - r * .25, q.y - r * .3, r * .1, q.x, q.y, r);
    hole.addColorStop(0, '#1c1c1c'); hole.addColorStop(.5, '#070707'); hole.addColorStop(1, '#000');
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 7); ctx.fillStyle = hole; ctx.fill();
    // 口の縁の照り返し
    ctx.beginPath(); ctx.arc(q.x, q.y, r * .97, Math.PI * 1.05, Math.PI * 1.85);
    ctx.strokeStyle = 'rgba(255,225,190,.22)'; ctx.lineWidth = Math.max(1, r * .09); ctx.stroke();
    ctx.restore();
  }

  function drawBall2D(b, s, alpha) {
    const p = toScreen(b.x, b.y);
    const r = b.r * s;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    const lift = b.z * s;
    ctx.beginPath(); ctx.ellipse(p.x + r * .18, p.y + r * .22, r * .95, r * .95, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    const bx = p.x - lift * .25, by = p.y - lift * .5;
    const g = ctx.createRadialGradient(bx - r * .38, by - r * .42, r * .08, bx, by, r * 1.06);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.20, shade(b.color, 1.28));
    g.addColorStop(.72, b.color); g.addColorStop(1, shade(b.color, .42));
    ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, r * .06); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    if (b.stripe) {
      ctx.save(); ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillRect(bx - r, by - r, r * 2, r * .42);
      ctx.fillRect(bx - r, by + r * .58, r * 2, r * .42);
      ctx.restore();
    }
    const pole = rotV(b, 0, 0, 1);
    if (pole.z > -0.2) {
      ctx.beginPath();
      ctx.arc(bx + pole.y * r * .62, by - pole.x * r * .62, Math.max(1.1, r * .17), 0, 7);
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();
    }
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

  function draw2D() {
    const g = S.game; if (!g) return;
    const table = g.table, s = view.s;
    ctx.clearRect(0, 0, view.w, view.h);

    const a = toScreen(table.halfW, -table.halfH), b = toScreen(-table.halfW, table.halfH);
    const thick = 34 * s + 10;
    drawFrame(a.x - thick, a.y - thick, (b.x - a.x) + thick * 2, (b.y - a.y) + thick * 2, thick);
    // クロス
    const cg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    cg.addColorStop(0, '#17573f'); cg.addColorStop(.45, '#0f3d2e'); cg.addColorStop(1, '#0b2e22');
    ctx.fillStyle = cg;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    // ダイヤ（レール上の目印）
    ctx.fillStyle = 'rgba(255,240,215,.55)';
    for (let i = 1; i <= 7; i++) {
      const tx = -table.halfW + (table.halfW * 2) * i / 8;
      [-1, 1].forEach(sg => {
        const q = toScreen(tx, sg * (table.halfH + thick / s * .5));
        ctx.beginPath(); ctx.moveTo(q.x, q.y - 3.4); ctx.lineTo(q.x + 2.6, q.y); ctx.lineTo(q.x, q.y + 3.4); ctx.lineTo(q.x - 2.6, q.y); ctx.fill();
      });
    }
    for (let i = 1; i <= 3; i++) {
      const ty = -table.halfH + (table.halfH * 2) * i / 4;
      [-1, 1].forEach(sg => {
        const q = toScreen(sg * (table.halfW + thick / s * .5), ty);
        ctx.beginPath(); ctx.moveTo(q.x, q.y - 3.4); ctx.lineTo(q.x + 2.6, q.y); ctx.lineTo(q.x, q.y + 3.4); ctx.lineTo(q.x - 2.6, q.y); ctx.fill();
      });
    }

    for (const p of table.pockets) drawPocket(p, s);

    // ヘッドストリングとフットスポット
    if (table.hasPockets) {
      const h1 = toScreen(table.headSpot.x, -table.halfH), h2 = toScreen(table.headSpot.x, table.halfH);
      ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y);
      ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const sp = toScreen(table.spot.x, table.spot.y);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(1.6, 6 * s), 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();

    // 手玉を置ける範囲を明示する（4.5節）
    if (S.phase === 'place') drawPlaceArea();

    if (S.cfg.cue[6] && (S.phase === 'aim' || S.phase === 'stance')) drawElevFan();

    // 置く段では手玉の実体を描かない。描くと「もう置いてある」ように見えて、
    // 破線の輪（これから置く場所）との区別がつかなくなる
    const placing = S.phase === 'place';
    const cueNow = placing ? RU.cueBallOf(g, g.turn) : null;
    const live = g.world.balls.filter(bb => bb.state === 'live' && bb !== cueNow);
    live.sort((x, y) => x.z - y.z);
    for (const bb of live) drawBall2D(bb, s);

    if (placing && S.placePos && cueNow) {
      const q = toScreen(S.placePos.x, S.placePos.y);
      const ok = placeOk(S.placePos);
      ctx.save();
      ctx.globalAlpha = 0.45;                 // 薄く＝まだ置いていない
      ctx.beginPath(); ctx.arc(q.x, q.y, cueNow.r * s, 0, 7);
      ctx.fillStyle = '#f4f4f4'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(q.x, q.y, cueNow.r * s, 0, 7);
      ctx.strokeStyle = ok ? 'rgba(251,146,60,.95)' : 'rgba(220,38,38,.95)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    if ((S.phase === 'aim' || S.phase === 'stance') && isMyTurn()) drawAimLine();

    const tg = RU.legalTargets(g, g.turn);
    if (tg && tg.length && tg.length <= 3) {
      for (const b2 of tg) {
        const q = toScreen(b2.x, b2.y);
        ctx.beginPath(); ctx.arc(q.x, q.y, b2.r * s * 1.35, 0, 7);
        ctx.strokeStyle = 'rgba(251,146,60,.75)'; ctx.lineWidth = 1.6; ctx.stroke();
      }
    }
    fadeMiniTitle(view.mobile);   // 2Dでは玉が下に来たら薄くする
    if (S.elevAdjusting) drawElevOverlay();
  }

  function drawPlaceArea() {
    const g = S.game, table = g.table;
    const full = g.ballInHandFull;
    const x1 = -table.halfW, x2 = full ? table.halfW : kitchenLimit();
    const p1 = toScreen(x2, -table.halfH), p2 = toScreen(x1, table.halfH);
    ctx.save();
    ctx.fillStyle = 'rgba(251,146,60,.10)';
    ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx.strokeStyle = 'rgba(251,146,60,.5)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.4;
    ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx.setLineDash([]);
    ctx.restore();
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
      ctx.arc(c.x, c.y, rad, scrAngle(a0), scrAngle(a1));
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }
  }
  function scrAngle(a) { return Math.atan2(-Math.cos(a), Math.sin(a)); }

  function drawAimLine() {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    if (!cue) return;
    const s = view.s, diff = S.cfg.diff;
    const c = toScreen(cue.x, cue.y);
    const dir = S.aim.dir;
    if (diff === 'apocalypse') {
      const L = 260;
      const e = toScreen(cue.x + Math.cos(dir) * L, cue.y + Math.sin(dir) * L);
      line(c, e, 'rgba(255,255,255,.75)', 2);
      return;
    }
    const prev = getAimPreview();
    if (!prev) return;
    const hitPt = toScreen(prev.cue.x, prev.cue.y);
    line(c, hitPt, 'rgba(255,255,255,.72)', 1.8);
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
        /*
         * スロー効果ON：短時間だけ物理を先回りさせる（4.6.3節）。
         * 的球が動き出す向きが分かれば足りるので、動いた距離で打ち切る。
         * 1.1秒ぶん最後まで回すと1回あたり約30ミリ秒＝描画2フレームぶん固まる（実測）。
         */
        const w = E.cloneWorld(g.world);
        const c2 = w.balls.find(b => b.id === cue.id);
        const o2 = w.balls.find(b => b.id === fc.ball.id);
        E.applyCue(c2, { dir, power: Math.max(0.28, S.aim.power || 0.4), tipX: S.aim.tipX, tipY: S.aim.tipY, elev: S.aim.elev });
        const from = { x: o2.x, y: o2.y };
        const NEED = 40;
        E.runShot(w, 0.35, () => Math.hypot(o2.x - from.x, o2.y - from.y) < NEED);
        const mx = o2.x - from.x, my = o2.y - from.y;
        const ml = Math.hypot(mx, my);
        // 向きだけを取り出し、線の長さはスロー効果OFFのときと揃える
        obj = ml < 1 ? null : { from, to: { x: from.x + mx / ml * 620, y: from.y + my / ml * 620 } };
      } else {
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
  function dirStripH() { return Math.max(46, Math.min(66, view.h * 0.10)); }
  /**
   * 盤面の上に空けておく高さ。
   * 携帯ではここにタイトル（アイコン・名前・版・副題）を出しているので、
   * 向きを合わせる帯はその下から始める。重ねると両方とも読めない。
   */
  function topInset() {
    if (!view.mobile) return 0;
    // 毎コマ測ると、そのたびにブラウザが並べ直しを迫られる。盤の作り直しのときだけ測る
    if (view.topInset == null) {
      const el = $('board-title');
      view.topInset = el ? el.offsetHeight + 8 : 0;
    }
    return view.topInset;
  }
  function dirStripTop() { return topInset(); }
  function cueStripW() { return Math.max(58, Math.min(88, view.w * 0.16)); }
  function tipPadRect() {
    const R = Math.min(80, Math.max(46, view.w * 0.14));
    return { cx: R + 16, cy: view.h - R - 16, r: R };
  }

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

    const bg = ctx.createLinearGradient(0, 0, 0, view.h);
    bg.addColorStop(0, '#0b1512'); bg.addColorStop(1, '#05100c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, view.w, view.h);

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
    ctx.strokeStyle = '#8a5228'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (const sgm of table.rails) {
      const a = proj(sgm.x1, sgm.y1, table.cushionTop), b2 = proj(sgm.x2, sgm.y2, table.cushionTop);
      if (a && b2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }
    }
    ctx.lineCap = 'butt';
    for (const pk of table.pockets) {
      const q = proj(pk.x, pk.y, 0); if (!q) continue;
      const rr = scale * pk.r / q.z;
      const hg = ctx.createRadialGradient(q.x, q.y, rr * .15, q.x, q.y, rr);
      hg.addColorStop(0, '#151515'); hg.addColorStop(1, '#000');
      ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.45, 0, 0, 7); ctx.fillStyle = hg; ctx.fill();
    }

    const prev = getAimPreview();
    if (prev) {
      const a = proj(cue.x, cue.y, 1), b2 = proj(prev.cue.x, prev.cue.y, 1);
      if (a && b2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.stroke(); }
    }

    const live = g.world.balls.filter(b => b.state === 'live')
      .map(b => ({ b, p: proj(b.x, b.y, b.z + b.r) })).filter(o => o.p)
      .sort((m, n) => n.p.z - m.p.z);
    for (const o of live) drawBall3D(o.b, o.p.x, o.p.y, scale * o.b.r / o.p.z);

    // 3D空間のキュー。尻はカメラより後ろへ抜けるので、手前で切ってから描く
    // （切らないと投影できず、キューが1本も見えない）
    const el = S.aim.elev;
    const back = 90 + pull * 340;
    const p1 = { x: cue.x - fx * back * Math.cos(el), y: cue.y - fy * back * Math.cos(el), z: cue.r + back * Math.sin(el) };
    const p2 = { x: cue.x - fx * (back + 1300) * Math.cos(el), y: cue.y - fy * (back + 1300) * Math.cos(el), z: cue.r + (back + 1300) * Math.sin(el) };
    const zOf = v => (v.x - cam.x) * f.x + (v.y - cam.y) * f.y + (v.z - cam.z) * f.z;
    const NEAR = 60;
    let a1 = p1, a2 = p2;
    const z1 = zOf(p1), z2 = zOf(p2);
    if (z1 < NEAR && z2 < NEAR) { a1 = null; }
    else if (z2 < NEAR) {
      const k = (NEAR - z1) / (z2 - z1);
      a2 = { x: p1.x + (p2.x - p1.x) * k, y: p1.y + (p2.y - p1.y) * k, z: p1.z + (p2.z - p1.z) * k };
    } else if (z1 < NEAR) {
      const k = (NEAR - z2) / (z1 - z2);
      a1 = { x: p2.x + (p1.x - p2.x) * k, y: p2.y + (p1.y - p2.y) * k, z: p2.z + (p1.z - p2.z) * k };
    }
    const t1 = a1 ? proj(a1.x, a1.y, a1.z) : null;
    const t2 = a1 ? proj(a2.x, a2.y, a2.z) : null;
    if (t1 && t2) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#c9a06a'; ctx.lineWidth = Math.max(3, scale * 11 / t1.z);
      ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
      ctx.strokeStyle = '#f3f3f3'; ctx.lineWidth = Math.max(2, scale * 9 / t1.z);
      ctx.beginPath(); ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t1.x + (t2.x - t1.x) * .05, t1.y + (t2.y - t1.y) * .05); ctx.stroke();
      ctx.lineCap = 'butt';
    }

    drawDirStrip();
    drawCueStrip();
    drawTipPad();
    fadeMiniTitle(false);         // 3Dでは帯の上に置いてあるので薄くしない
    if (S.elevAdjusting) drawElevOverlay();
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

  /** 上部：ここを左右にドラッグすると向きが変わる、と分かる帯 */
  function drawDirStrip() {
    const h = dirStripH();
    const y0 = dirStripTop();                 // タイトルの下から始める
    ctx.save();
    ctx.translate(0, y0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(20,20,20,.82)'); g.addColorStop(1, 'rgba(20,20,20,.34)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, h);
    ctx.strokeStyle = (S.drag && S.drag.kind === 'fine') ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.4; ctx.strokeRect(.7, .7, view.w - 1.4, h - 1.4);
    // 左右の矢印。右上には言語と設定が常に居るので、そのぶんを空けて描く
    const RESERVE = 104;
    const usable = Math.max(120, view.w - RESERVE);
    const cyy = h / 2;
    ctx.fillStyle = (S.drag && S.drag.kind === 'fine') ? '#fb923c' : 'rgba(255,255,255,.72)';
    // sg は矢印が指す向き。底辺を反対側に置いて、指す先を尖らせる
    [[18, -1], [usable - 18, 1]].forEach(([x, sg]) => {
      ctx.beginPath();
      ctx.moveTo(x - sg * 9, cyy - 10); ctx.lineTo(x - sg * 9, cyy + 10); ctx.lineTo(x + sg * 8, cyy);
      ctx.closePath(); ctx.fill();
    });
    ctx.font = '12px "Noto Sans JP",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(t('hint.dir'), usable / 2, cyy - 7);
    ctx.font = '11px "Noto Sans JP",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(((S.aim.dir * 180 / Math.PI) % 360).toFixed(1) + '°', usable / 2, cyy + 11);
    ctx.restore();
  }

  /** 右端：キューの絵。ここを引くと力が溜まり、離すと撞く */
  function drawCueStrip() {
    const w = cueStripW();
    const x0 = view.w - w;
    const top = dirStripTop() + dirStripH() + 10, bot = view.h - 14;
    const H = bot - top;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,.55)';
    ctx.fillRect(x0, top - 6, w, H + 12);
    ctx.strokeStyle = (S.drag && S.drag.kind === 'pull') ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.4; ctx.strokeRect(x0 + .7, top - 5.3, w - 1.4, H + 10.6);

    // キューは上（先端）から下（尻）へ。引き代ぶん下へずらす
    const cx = x0 + w / 2;
    const travel = H * 0.34;
    const off = S.aim.power * travel;
    const tipY = top + 18 + off, buttY = bot - 6 + off;
    // 先が細く尻が太い実物の形。真っ直ぐな棒だと向きが読めない
    taperedCue(ctx, cx, tipY, cx, Math.min(buttY, bot + travel), 5.5, 13);
    // 手玉（先端の先に置いて、引く向きが分かるようにする）
    ctx.beginPath(); ctx.arc(cx, top + 6, 9, 0, 7);
    const bg2 = ctx.createRadialGradient(cx - 3, top + 3, 1, cx, top + 6, 9);
    bg2.addColorStop(0, '#fff'); bg2.addColorStop(1, '#b9b9b9');
    ctx.fillStyle = bg2; ctx.fill();
    // 文言
    ctx.save();
    ctx.translate(x0 + 12, bot - 4); ctx.rotate(-Math.PI / 2);
    ctx.font = '11px "Noto Sans JP",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.fillText(t('hint.power') + '  ' + Math.round(S.aim.power * 100) + '%', 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function drawTipPad() {
    const p = tipPadRect();
    ctx.save();
    const g = ctx.createRadialGradient(p.cx - p.r * .35, p.cy - p.r * .4, p.r * .1, p.cx, p.cy, p.r);
    g.addColorStop(0, '#fff'); g.addColorStop(.7, '#e6e6e6'); g.addColorStop(1, '#9a9a9a');
    ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = (S.drag && S.drag.kind === 'tip') ? 'rgba(251,146,60,.95)' : 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.cx - p.r, p.cy); ctx.lineTo(p.cx + p.r, p.cy);
    ctx.moveTo(p.cx, p.cy - p.r); ctx.lineTo(p.cx, p.cy + p.r);
    ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; ctx.stroke();
    const tx = p.cx + S.aim.tipX * p.r * .5, ty = p.cy - S.aim.tipY * p.r * .5;
    ctx.beginPath(); ctx.arc(tx, ty, p.r * .17, 0, 7);
    ctx.fillStyle = '#c2410c'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '10px "Noto Sans JP",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(t('hint.tip'), p.cx, p.cy + p.r + 4);
    ctx.restore();
  }

  /** 携帯：角度スライダーを触っている間だけ、横から見たキューを重ねて出す */
  function drawElevOverlay() {
    const w = Math.min(230, view.w * 0.62), h = w * 0.62;
    const x = (view.w - w) / 2, y = (view.h - h) / 2;
    ctx.save();
    ctx.globalAlpha = .93;
    roundRect(x, y, w, h, 12); ctx.fillStyle = 'rgba(12,12,12,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(251,146,60,.7)'; ctx.lineWidth = 1.4; ctx.stroke();
    drawCueSide(ctx, x + 14, y + 14, w - 28, h - 40, S.aim.elev);
    ctx.font = '13px "Noto Sans JP",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fb923c';
    ctx.fillText(Math.round(S.aim.elev * 180 / Math.PI) + '°', x + w / 2, y + h - 8);
    ctx.restore();
  }

  /**
   * キューを1本描く。**先端は細く、尻へ向かって太くなる**（実物と同じ形）。
   * 真っ直ぐな棒だと、どちらが先でどちらが尻なのか絵から読めない。
   * @param {number} tipW 先端の太さ  @param {number} buttW 尻の太さ
   */
  function taperedCue(c, tipX, tipY, buttX, buttY, tipW, buttW) {
    const dx = buttX - tipX, dy = buttY - tipY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;        // 軸に直交する向き
    const ferr = Math.min(len * 0.10, tipW * 3.2);   // 先革＋その下の白い部分
    const at = (d, wid) => ({
      ax: tipX + dx * (d / len) + nx * wid / 2, ay: tipY + dy * (d / len) + ny * wid / 2,
      bx: tipX + dx * (d / len) - nx * wid / 2, by: tipY + dy * (d / len) - ny * wid / 2,
    });
    const wAt = d => tipW + (buttW - tipW) * (d / len);
    c.save();
    // 本体（先から尻へ太くなる四角形）
    const p0 = at(0, tipW), p1 = at(len, buttW);
    const g = c.createLinearGradient(tipX, tipY, buttX, buttY);
    g.addColorStop(0, '#e8d5b5'); g.addColorStop(.14, '#c9a06a');
    g.addColorStop(.62, '#8a5a2c'); g.addColorStop(1, '#4a2f18');
    c.beginPath();
    c.moveTo(p0.ax, p0.ay); c.lineTo(p1.ax, p1.ay); c.lineTo(p1.bx, p1.by); c.lineTo(p0.bx, p0.by);
    c.closePath(); c.fillStyle = g; c.fill();
    // 先革（白）
    const q1 = at(ferr, wAt(ferr));
    c.beginPath();
    c.moveTo(p0.ax, p0.ay); c.lineTo(q1.ax, q1.ay); c.lineTo(q1.bx, q1.by); c.lineTo(p0.bx, p0.by);
    c.closePath(); c.fillStyle = '#f4f4f4'; c.fill();
    // 継ぎ目（バット寄りの帯）。実物らしさが出る
    const j0 = at(len * 0.62, wAt(len * 0.62)), j1 = at(len * 0.66, wAt(len * 0.66));
    c.beginPath();
    c.moveTo(j0.ax, j0.ay); c.lineTo(j1.ax, j1.ay); c.lineTo(j1.bx, j1.by); c.lineTo(j0.bx, j0.by);
    c.closePath(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill();
    c.restore();
  }

  /** 横から見たキューの絵。角度がそのまま傾きになる */
  function drawCueSide(c, x, y, w, h, elev) {
    const bedY = y + h * 0.82;
    c.save();
    // 台の断面
    c.fillStyle = '#12482f'; c.fillRect(x, bedY, w, Math.max(3, h * 0.10));
    c.fillStyle = '#8a5228'; c.fillRect(x, bedY - h * 0.06, w * 0.07, h * 0.06);
    // 手玉。キューは左上へ伸びるので、玉は右端に寄せてキューの長さを稼ぐ
    const bx = x + w * 0.88, br = Math.max(6, h * 0.11);
    drawSideWall(c, x, bedY, w, h, bx, br, elev);
    const bg = c.createRadialGradient(bx - br * .35, bedY - br * 1.3, br * .1, bx, bedY - br, br);
    bg.addColorStop(0, '#fff'); bg.addColorStop(1, '#b5b5b5');
    c.beginPath(); c.arc(bx, bedY - br, br, 0, 7); c.fillStyle = bg; c.fill();
    // キュー（尻を持ち上げる）。先が細く、尻が太い実物の形に寄せる
    const L = w * 0.86;
    const tipX = bx - br * 0.9, tipY = bedY - br;
    const ex = tipX - Math.cos(elev) * L, ey = tipY - Math.sin(elev) * L;
    taperedCue(c, tipX, tipY, ex, ey, Math.max(2.6, h * 0.030), Math.max(5, h * 0.062));
    c.lineCap = 'butt';
    // 角度の弧
    c.beginPath(); c.arc(tipX, tipY, L * 0.30, -elev, 0);
    c.strokeStyle = 'rgba(251,146,60,.7)'; c.lineWidth = 1.3; c.stroke();
    c.beginPath(); c.moveTo(tipX, tipY); c.lineTo(tipX - L * 0.34, tipY);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.setLineDash([4, 3]); c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    c.restore();
  }

  /**
   * 角度の絵に、キューの尻がぶつかる壁（クッション）を描く。
   * 角度を下げられない理由は「後ろに壁がある」ことなので、
   * 壁そのものを見せないと、なぜ下げられないのかが分からない。
   */
  function drawSideWall(c, x, bedY, w, h, bx, br, elev) {
    const g = S.game; if (!g) return;
    const L = w * 0.70;                       // 絵の中のキューの長さ＝CUE_LEN に相当
    const dist = wallDistFor(S.aim.dir);
    const need = minElevFor(S.aim.dir);
    if (!isFinite(dist) || dist > CUE_LEN || need <= 0.001) return;
    const tipX = bx - br * 0.9, tipY = bedY - br;
    // 実距離のままだと、壁際のときに壁が手玉に重なって1画素になる。
    // 近すぎる場合は手前に引き寄せて描く（距離ではなく「当たっていること」を見せる絵）
    const dxp = clamp(dist * (L / CUE_LEN), L * 0.30, L * 0.85);
    const wallX = tipX - dxp;
    if (wallX < x) return;                    // 絵の外なら描かない
    /*
     * 壁の高さは、その方向の最小角でキューがちょうど掠める高さにする。
     * 実寸をそのまま縮めると、横は 1/40、縦は等倍で、絵の中で辻褄が合わなくなる。
     * 「これ以上下げられない理由」を見せるのが目的なので、
     * 角度と壁の関係のほうを正しく描く。
     */
    const wallTopY = tipY - dxp * Math.tan(Math.min(need, 1.4));
    const wallH = Math.max(3, bedY - wallTopY);
    const wallW = Math.max(3, w * 0.07);
    const touching = elev <= need + 0.02;
    c.save();
    c.fillStyle = touching ? '#a3431a' : '#6b4423';
    c.fillRect(wallX - wallW / 2, bedY - wallH, wallW, wallH);
    c.fillStyle = touching ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.3)';
    c.fillRect(wallX - wallW / 2, bedY - wallH, wallW, Math.max(1.4, wallH * 0.16));
    c.restore();
  }

  /**
   * 携帯の左上に重ねたタイトルは HTML の実体（#board-title）。
   * ここでは、玉や予測線がその下に来たときに薄くするかどうかだけを決める。
   * 描く実体を2つ持たないので、アイコンや副題が片方だけ欠けることがない。
   */
  function fadeMiniTitle(active) {
    const el = $('board-title'); if (!el) return;
    if (!active) { el.classList.remove('faded'); return; }
    const g = S.game; if (!g) return;
    const r0 = el.getBoundingClientRect(), c0 = cv.getBoundingClientRect();
    const x = r0.left - c0.left, y = r0.top - c0.top, w = r0.width, h = r0.height;
    let hit = false;
    for (const b of g.world.balls) {
      if (b.state !== 'live') continue;
      const p = toScreen(b.x, b.y), r = b.r * view.s + 2;
      if (p.x + r > x && p.x - r < x + w && p.y + r > y && p.y - r < y + h) { hit = true; break; }
    }
    if (!hit && (S.phase === 'aim' || S.phase === 'stance') && S.aimPreview) {
      const cue = RU.cueBallOf(g, g.turn);
      if (cue) {
        const a = toScreen(cue.x, cue.y), b2 = toScreen(S.aimPreview.cue.x, S.aimPreview.cue.y);
        if (segRect(a, b2, x, y, w, h)) hit = true;
      }
    }
    el.classList.toggle('faded', hit);
  }
  function segRect(p, q, x, y, w, h) {
    const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
    const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
    return !(maxX < x || minX > x + w || maxY < y || minY > y + h);
  }

  // PC：角度スライダーの横に置くキューの絵
  const elevPic = $('elev-pic');
  function drawElevPic() {
    if (!elevPic || view.mobile) return;
    const c = elevPic.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 横に広げてある＝玉を右端へ寄せ、キューを長く見せるため
    const W = 112, H = 120;
    if (elevPic.width !== W * dpr) {
      elevPic.width = W * dpr; elevPic.height = H * dpr;
      elevPic.style.width = W + 'px'; elevPic.style.height = H + 'px';
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    drawCueSide(c, 2, 6, W - 4, H - 12, S.aim.elev);
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
    const g = S.game; if (!g) return false;
    const cue = RU.cueBallOf(g, g.turn); if (!cue) return false;
    const table = g.table;
    if (Math.abs(pt.x) > table.halfW - cue.r || Math.abs(pt.y) > table.halfH - cue.r) return false;
    if (g.ballInHand && !g.ballInHandFull && pt.x > kitchenLimit()) return false;
    for (const p of table.pockets) if (Math.hypot(pt.x - p.x, pt.y - p.y) < p.r + cue.r * .3) return false;
    for (const b of g.world.balls) {
      if (b === cue || b.state !== 'live') continue;
      if (Math.hypot(b.x - pt.x, b.y - pt.y) < b.r + cue.r + 0.5) return false;
    }
    return true;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  cv.addEventListener('pointerdown', e => {
    if (!S.game || !isMyTurn()) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    const p = evPos(e);
    if (S.phase === 'place') { S.drag = { kind: 'place' }; movePlace(p); }
    else if (S.phase === 'aim') { S.drag = { kind: 'aim' }; moveAim(p); }
    else if (S.phase === 'stance') {
      const pad = tipPadRect();
      if (Math.hypot(p.x - pad.cx, p.y - pad.cy) < pad.r * 1.2) {
        S.drag = { kind: 'tip', x: p.x, y: p.y, t0: { x: S.aim.tipX, y: S.aim.tipY } };
      } else if (p.x > view.w - cueStripW()) {
        S.drag = { kind: 'pull', y: p.y };
      } else if (p.y >= dirStripTop() && p.y < dirStripTop() + dirStripH()) {
        S.drag = { kind: 'fine', x: p.x, d0: S.aim.dir };
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
      S.aim.tipX = clamp(S.drag.t0.x + (p.x - S.drag.x) / (pad.r * .5), -1, 1);
      S.aim.tipY = clamp(S.drag.t0.y - (p.y - S.drag.y) / (pad.r * .5), -1, 1);
      S.aimDirty = true;
    } else if (S.drag.kind === 'fine') {
      S.aim.dir = S.drag.d0 + (p.x - S.drag.x) * 0.0016;
      S.aimDirty = true;
    } else if (S.drag.kind === 'pull') {
      S.aim.power = clamp((p.y - S.drag.y) / (view.h * 0.30), 0, 1.15);
    }
    e.preventDefault();
  });
  function endDrag(e) {
    if (!S.drag) return;
    const kind = S.drag.kind;
    S.drag = null;
    if (kind === 'pull') {
      if (S.aim.power > 0.05) shootNow(); else S.aim.power = 0;
    } else if (kind === 'aim') {
      // 方向を決めて指を離したら、そのまま構えへ進む（往復は「2Dへ戻る」でできる）
      S.phase = 'stance'; setMsg(t('ph.cue'));
    }
    if (e) e.preventDefault();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  function movePlace(p) {
    const tp = toTable(p.x, p.y - 26);   // 指が手玉を隠さないようずらす（4.11.2節）
    const g = S.game, table = g.table;
    const cue = RU.cueBallOf(g, g.turn);
    tp.x = clamp(tp.x, -table.halfW + cue.r, table.halfW - cue.r);
    tp.y = clamp(tp.y, -table.halfH + cue.r, table.halfH - cue.r);
    if (g.ballInHand && !g.ballInHandFull) tp.x = Math.min(tp.x, kitchenLimit());
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
    const place = S.pendingPlace;
    S.pendingPlace = null;
    S.aim.power = 0;
    fireShot(shot, place, true);
  }

  const elevEl = $('elev');
  elevEl.addEventListener('input', () => {
    const need = minElevFor(S.aim.dir) * 180 / Math.PI;
    let v = +elevEl.value;
    if (v < need) { v = Math.ceil(need); elevEl.value = v; }
    S.aim.elev = v * Math.PI / 180;
    S.aimDirty = true;
  });
  ['pointerdown', 'touchstart'].forEach(ev => elevEl.addEventListener(ev, () => { S.elevAdjusting = true; }));
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'].forEach(ev =>
    elevEl.addEventListener(ev, () => { S.elevAdjusting = false; }));
  window.addEventListener('pointerup', () => { S.elevAdjusting = false; });

  function mainButtonKey() {
    if (S.phase === 'place') return 'btn.place';
    if (S.phase === 'stance') return 'btn.back2d';
    return 'btn.aim';
  }
  $('btn-aim').addEventListener('click', () => {
    if (!isMyTurn()) return;
    if (S.phase === 'place') {
      if (!placeOk(S.placePos)) { setMsg(t('foul.V-09')); return; }
      const cue = RU.cueBallOf(S.game, S.game.turn);
      RU.place(cue, S.placePos.x, S.placePos.y);
      S.game.ballInHand = false;
      // 置いた位置はショットの入力の一部。通信対戦では5値と一緒に送る
      S.pendingPlace = { x: S.placePos.x, y: S.placePos.y };
      computeElevFan(cue);
      S.phase = 'aim'; setMsg(t('ph.aim'));
    } else if (S.phase === 'aim') {
      S.phase = 'stance'; setMsg(t('ph.cue'));
    } else if (S.phase === 'stance') {
      S.phase = 'aim'; S.aim.power = 0; setMsg(t('ph.aim'));
    }
    AU.sfx('button');
  });

  // ══════════════════════════════════════════════
  //  主ループ
  // ══════════════════════════════════════════════
  let lastT = performance.now();
  const dbg = { phys: 0, draw: 0, gap: 0, at: 0 };
  function loop(now) {
    const dt = Math.min(100, now - lastT); lastT = now;
    if (S.screen === 'play' && S.game) {
      const t0 = DEBUG ? performance.now() : 0;
      // 1コマで進める刻みの数。等速なら8刻み＝1/60秒ぶん。端数は次のコマへ持ち越す
      let steps = 0;
      if (S.phase === 'rolling' || S.replayRun) {
        S.stepAcc = (S.stepAcc || 0) + 8 * animSpeed();
        steps = Math.min(32, Math.floor(S.stepAcc));
        S.stepAcc -= steps;
      } else S.stepAcc = 0;
      if (S.phase === 'rolling') {
        for (let i = 0; i < steps; i++) {
          if (E.allStopped(S.game.world)) break;
          E.step(S.game.world);
        }
        drainEvents();
        if (E.allStopped(S.game.world)) { S.phase = 'idle'; finishShot(); }
      } else if (S.replayRun) {
        for (let i = 0; i < steps; i++) {
          if (E.allStopped(S.replayRun)) break;
          E.step(S.replayRun);
        }
        if (E.allStopped(S.replayRun)) S.replayRun = null;
      }
      tickClock(dt);
      const t1 = DEBUG ? performance.now() : 0;
      if (S.replayRun) drawReplay();
      else if (S.phase === 'stance') draw3D();
      else draw2D();
      if (DEBUG) {
        const t2 = performance.now();
        dbg.phys = Math.max(dbg.phys, t1 - t0);
        dbg.draw = Math.max(dbg.draw, t2 - t1);
        dbg.gap = Math.max(dbg.gap, dt);
        if (now - dbg.at > 500) {
          dbg.at = now;
          const el = $('dbg');
          if (el) el.textContent = '最悪 物理' + dbg.phys.toFixed(1) + ' 描画' + dbg.draw.toFixed(1)
            + ' 間隔' + dbg.gap.toFixed(1) + 'ms';
          dbg.phys = dbg.draw = dbg.gap = 0;
        }
      }
      renderClock();
      drawElevPic();
      $('k-elev').textContent = Math.round(S.aim.elev * 180 / Math.PI) + '°';
      $('k-power').textContent = Math.round(S.aim.power * 100) + '%';
      const gg = $('power-gauge');
      gg.classList.toggle('over', S.aim.power > 1);   // オーバーパワー警告（4.4.4節）
      gg.firstElementChild.style.width = Math.min(100, S.aim.power * 100) + '%';
      const key = mainButtonKey();
      const btn = $('btn-aim');
      if (btn.dataset.k !== key) { btn.dataset.k = key; btn.textContent = t(key); }
      btn.disabled = !isMyTurn() || S.phase === 'rolling' || S.phase === 'wait';
    }
    requestAnimationFrame(loop);
  }

  /**
   * 出来事を音にする。
   * ラックが割れる瞬間は 1 コマに 12 発の衝突が来る（実測）。
   * 同じ衝突音を12回重ねると団子になるので、まとめて1つの大きな音にする。
   * ふだんの場面でも、1コマに何発も重ねると濁るだけなので数を抑える。
   */
  const SLAM_HITS = 4;      // これ以上が同じコマに来たら「割れた」とみなす
  const MAX_PER_FRAME = 3;  // 1コマに鳴らす衝突音の上限
  function drainEvents() {
    const evs = S.game.world.events;
    const start = S.evCursor || 0;
    let hits = 0, top = 0;
    for (let i = start; i < evs.length; i++) {
      if (evs[i].type === 'hit') { hits++; if (evs[i].speed > top) top = evs[i].speed; }
    }
    const slam = hits >= SLAM_HITS;
    if (slam) AU.sfx('break', Math.min(1, top / 5000));
    let played = 0, cush = 0;
    for (let i = start; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'hit') {
        if (!slam && played++ < MAX_PER_FRAME) AU.sfx('ball', Math.min(1, e.speed / 4000));
      } else if (e.type === 'cushion') {
        if (cush++ < MAX_PER_FRAME) AU.sfx('cushion', Math.min(1, e.speed / 4000));
      } else if (e.type === 'pocket') AU.sfx('pocket');
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

  /**
   * 盤の真ん中に大きく1秒だけ出す。
   * 端の細い帯に出すだけでは、盤を見ている人の目に入らない。
   */
  let flashTimer = null;
  function flash(text, kind) {
    const el = $('flash'); if (!el || !text) return;
    el.textContent = text;
    el.className = 'on ' + (kind || '');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.className = ''; flashTimer = null; }, 1000);
  }

  function teamMark(tm) { return t('coop.team', { t: 'ABCD'[tm] || String(tm + 1) }); }

  function renderHUD() {
    const g = S.game; if (!g) return;
    $('v-turn').textContent = g.players[g.turn] ? g.players[g.turn].name : '–';
    const box = $('players-box'); box.innerHTML = '';
    g.players.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'pl-row' + (i === g.turn ? ' turn' : '');
      // 点数を持たないルールでは点を出さない（ずっと 0 点に見えて壊れて見える）
      let right = RU.HAS_SCORE[g.rule] ? String(p.score) : '';
      if (g.coop && RU.HAS_SCORE[g.rule]) right = p.score + '（' + RU.teamScore(g, p.team) + '）';
      if (g.rule === 'G-04') right = p.score + '/' + p.target;
      if (g.rule === 'G-02') right = p.group ? t('group.' + p.group).split('（')[0] : t('hud.open');
      const who = (g.coop ? teamMark(p.team) + ' ' : '') + p.name;
      d.innerHTML = '<span>' + escapeHtml(who) + '</span><span>' + escapeHtml(right) + '</span>';
      box.appendChild(d);
    });
    const tg = RU.legalTargets(g, g.turn);
    $('v-next').textContent = tg == null ? '–' : (tg.length ? tg.map(b => b.num || '●').join(' / ') : '–');
    $('v-foul').textContent = g.lastFouls && g.lastFouls.length ? g.lastFouls.map(f => t('foul.' + f)).join(', ') : t('hud.none');
    $('time-box').style.display = S.cfg.mods['G-14'] ? '' : 'none';
    $('v-config').textContent = configLabel();
  }
  function configLabel(cfg) {
    const c = cfg || S.cfg;
    return [
      t('rule.' + c.rule),
      t('shape.' + c.shape) + '（' + t(c.carom ? 'tbl.carom' : 'tbl.pocket') + '）',
      t('mode.' + c.mode), I.DIFF_LABEL[c.diff],
    ].join(' / ');
  }
  function renderClock() {
    if (!S.cfg.mods['G-14'] || !S.game) return;
    const base = $('v-base'), bank = $('v-bank');
    base.textContent = Math.ceil(S.clock.baseLeft) + 's';
    const b = S.clock.banks[S.game.turn] || 0;
    bank.textContent = Math.floor(b / 60) + ':' + String(Math.floor(b % 60)).padStart(2, '0');
    // 残り5秒はオレンジ。減っているほうだけを染める
    const r = clockRemain(), hot = S.clock.running && r <= 5;
    base.classList.toggle('hot', hot && S.clock.baseLeft > 0);
    bank.classList.toggle('hot', hot && S.clock.baseLeft <= 0);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** 勝ったときだけ、くす玉と紙吹雪を出す（MOMO Hanafuda と同じ見せ方） */
  let confettiTimer = null;
  function renderWinArt(won, draw) {
    const panel = $('res-panel'), conf = $('confetti'), head = $('res-headline');
    if (!panel) return;
    panel.classList.toggle('win', !!won);
    head.textContent = won ? t('res.win') : draw ? t('res.draw') : t('res.lose');
    head.className = 'ge-title ' + (won ? 'win' : draw ? 'draw' : 'lose');
    if (conf) conf.innerHTML = '';
    if (confettiTimer) { clearTimeout(confettiTimer); confettiTimer = null; }
    if (!won || !conf) return;
    // くす玉が開いてから紙吹雪を後追いで降らせる
    confettiTimer = setTimeout(() => {
      confettiTimer = null;
      if (!resultOpen()) return;
      const colors = ['#d8a838', '#ea580c', '#cf2b28', '#33aa99', '#5599ff', '#ffffff'];
      for (let i = 0; i < 64; i++) {
        const p = document.createElement('span');
        p.className = 'cf';
        p.style.left = ((i * 37) % 100) + '%';
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = ((i % 12) * 0.11).toFixed(2) + 's';
        p.style.animationDuration = (1.9 + (i % 6) * 0.28).toFixed(2) + 's';
        if (i % 2) p.style.borderRadius = '50%';
        conf.appendChild(p);
      }
    }, 650);
  }

  function renderResult() {
    const g = S.game;
    renderWinArt(S.won, g.winTeam < 0 && !g.failed);
    const body = $('res-body'); body.innerHTML = '';
    // 並べるのはチーム。協力プレイでなければ1人＝1チームなので今までと同じ見え方になる
    const kind = RU.WIN_KIND[g.rule];
    const order = (kind === 'points' && g.teamRanking) ? g.teamRanking : RU.teamList(g);
    const withPts = RU.HAS_SCORE[g.rule];
    order.forEach((tm, i) => {
      const members = RU.teamMembers(g, tm);
      // 規定打数を使い切って終わった局は、順位ではなく「負け」を出す。
      // 1チームしかいないので順位を出すと1位に見えてしまう
      const label = g.failed ? t('res.lose')
        : (kind === 'points') ? (i + 1) + ' ' + t('res.rank')
        : (tm === g.winTeam ? t('res.win') : g.winTeam < 0 ? t('res.draw') : t('res.lose'));
      const score = withPts ? RU.teamScore(g, tm) : null;
      const d = document.createElement('div');
      d.className = 'pl-row' + (tm === g.winTeam ? ' turn' : '');
      const who = (g.coop ? teamMark(tm) + '　' : '') + members.map(p => p.name).join(' ・ ');
      const right = score != null ? label + '　' + score + t('res.pts') : label;
      d.innerHTML = '<span>' + escapeHtml(who) + '</span><span>' + escapeHtml(right) + '</span>';
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
  function refreshServerStatus() {
    const online = !!S.net.wsOpen;
    const key = online ? 'srv.online' : (S.net.wasClosed ? 'srv.offline' : 'srv.connecting');
    ['srv-status', 'srv-status-room'].forEach(id => {
      const el = $(id); if (!el) return;
      el.classList.toggle('online', online);
      el.classList.toggle('offline', !online && S.net.wasClosed);
      const lbl = el.querySelector('.lbl');
      if (lbl) lbl.textContent = t(key);
    });
  }

  function openLobby() {
    show('lobby');
    NET.init({ version: APP_VER, onEvent: onNet });
    NET.refresh();
    refreshServerStatus();
  }

  function onNet(kind, d) {
    if (kind === 'ws-open') { S.net.wsOpen = true; S.net.wasClosed = false; refreshServerStatus(); NET.refresh(); }
    else if (kind === 'ws-close') { S.net.wsOpen = false; S.net.wasClosed = true; refreshServerStatus(); }
    else if (kind === 'rooms') { S.net.lastRooms = d.rooms; renderRooms(d.rooms); }
    else if (kind === 'ver-mismatch') { alertNote(t('lobby.title'), t('lobby.verMismatch', { a: d.theirs, b: d.mine })); }
    else if (kind === 'created') {
      S.net.on = true; S.net.isHost = true; S.net.role = 'host'; S.net.myIdx = 0;
      S.net.ready = {}; S.net.sentCfg = null;
      S.net.myPid = (d.multi && d.multi.pid) || null;
      S.net.roster = (d.multi && d.multi.roster) || [];
      showRoom();
    } else if (kind === 'joined') {
      S.net.on = true; S.net.isHost = false;
      S.net.ready = {}; S.net.sentCfg = null;
      S.net.role = (d.multi && d.multi.role) || 'player';
      S.net.myPid = (d.multi && d.multi.pid) || null;
      S.net.roster = (d.multi && d.multi.roster) || [];
      if (d.rules && d.rules.config) Object.assign(S.cfg, d.rules.config);
      showRoom();
      if (S.net.role === 'spectator') NET.send({ k: 'need' }, 'host');
    } else if (kind === 'participant') {
      if (d.roster) S.net.roster = d.roster;
      AU.sfx('join');
      showRoom();
      // 人が増えたら合意はやり直し。入ってきた人はまだ何も見ていない
      if (S.net.isHost) { NET.send({ k: 'cfg', config: netConfig() }); clearReady(); }
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

  function netConfig() { return JSON.parse(JSON.stringify(S.cfg)); }

  /**
   * 参加者の並びはホストが決めて配る。
   * 各端末が自分で名簿から順番を数えると、名簿の並びがずれた瞬間に
   * 「全員が自分の手番ではない」状態になって進行が止まる。
   * そこで席順に参加者IDを添えて配り、受け取った側は自分のIDを探すだけにする。
   */
  function seatList() {
    const st = NET.state();
    const roster = (st && st.roster) || [];
    const players = roster.filter(r => r.role !== 'spectator');
    // ホストを先頭に固定する
    players.sort((a, b) => (a.role === 'host' ? -1 : 0) - (b.role === 'host' ? -1 : 0));
    const out = players.map(r => ({ name: r.name || 'Player', type: 'human', pid: r.pid }));
    if (!out.length) out.push({ name: 'Host', type: 'human', pid: st && st.pid });
    return out;
  }
  /**
   * 配られた席順の中から自分を探す。
   * 見つからないまま黙って待たせると、全員が「相手の番です」のまま止まる。
   * 前に分かっていた席があるならそれを使い、それも無ければ画面に出す。
   */
  function seatIndexOfMe(names) {
    const st = NET.state();
    const myPid = (st && st.pid) || S.net.myPid;
    for (let i = 0; i < names.length; i++) if (names[i].pid && names[i].pid === myPid) return i;
    if (S.net.isHost) return 0;
    if (S.net.myIdx >= 0 && S.net.myIdx < names.length) return S.net.myIdx;
    alertNote(t('lobby.title'), t('lobby.noSeat'));
    return -1;
  }

  function onNetMsg(p, from) {
    if (!p || !p.k) return;
    if (p.k === 'cfg') { Object.assign(S.cfg, p.config); showRoom(); buildSetup(); return; }
    if (p.k === 'ready') { setReady(p.pid || from, !!p.ok); return; }
    if (p.k === 'rmap') { S.net.ready = p.map || {}; showRoom(); return; }
    if (p.k === 'need') {
      if (!S.net.isHost || !S.game) return;
      NET.send({
        k: 'sync', seed: S.game.seed, config: netConfig(),
        names: S.game.players.map(x => ({ name: x.name, type: x.type, pid: x.pid || null })),
        log: S.game.history,
      }, from || 'all');
      return;
    }
    if (p.k === 'start') {
      S.net.myIdx = seatIndexOfMe(p.names);
      startGame(p.seed, p.names, p.config);
      return;
    }
    if (p.k === 'sync') {
      setMsg(t('lobby.syncing'));
      S.net.myIdx = S.net.role === 'spectator' ? -1 : seatIndexOfMe(p.names);
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
      /*
       * 盤面の照合は「同じショットまで進んでから」比べる。
       * ホストは撞き終わった瞬間に送ってくるが、こちらは同じ玉をまだ転がしている。
       * まだ追いついていないだけの状態を食い違いと読むと、
       * 毎ショット組み直しになり、そのたびに席の割り当てまでやり直しになる。
       */
      S.chk[p.n] = p.h;
      compareBoardCheck();
      return;
    }
    if (p.k === 'reboard') {
      if (!S.net.isHost || !S.game) return;
      NET.send({ k: 'board', board: boardSnapshot(), turn: S.game.turn, n: S.game.shotNo, scores: S.game.players.map(x => x.score), bih: S.game.ballInHand });
      return;
    }
    if (p.k === 'board') { if (S.game) { applyBoard(p); setMsg(t('lobby.syncing')); } return; }
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
  function replayRecord(rec) {
    if (rec.timeout) {
      S.game.shotNo++;
      RU.nextTurn(S.game, { continueTurn: false });
      return;
    }
    applyShot(rec.shot, rec.place, false);
  }
  function requestResync() { if (!S.net.isHost) NET.send({ k: 'need' }, 'host'); }

  /**
   * 受け取ってある照合のうち、いま自分が到達したショットのものだけを比べる。
   * 追い越された古い照合は捨てる（比べる相手の盤面はもう無い）。
   */
  function compareBoardCheck() {
    const g = S.game; if (!g || S.net.isHost) return;
    for (const k of Object.keys(S.chk)) if (+k < g.shotNo) delete S.chk[k];
    const h = S.chk[g.shotNo];
    if (h == null) return;
    delete S.chk[g.shotNo];
    if (boardHash() !== h) NET.send({ k: 'reboard' }, 'host');
  }

  /** 部屋の一覧。何を遊ぶ部屋なのかが分からないと入りようがないので、モードまで出す */
  function renderRooms(rooms) {
    const box = $('room-list'); if (!box) return;
    box.innerHTML = '';
    const list = (rooms || []).filter(r => !r.gameType || r.gameType === NET.GAME_TYPE);
    if (!list.length) { box.innerHTML = '<div class="hint">' + escapeHtml(t('lobby.empty')) + '</div>'; return; }
    list.forEach(r => {
      const d = document.createElement('div'); d.className = 'room';
      const ver = (r.rules && r.rules.ver) || '?';
      const cfg = r.rules && r.rules.config;
      const mode = cfg ? configLabel(cfg) : '';
      const info = document.createElement('div');
      info.innerHTML = '<div class="nm">' + escapeHtml(r.name || '') + (r.hasPassword ? ' 🔒' : '') + '</div>' +
        (mode ? '<div class="mode">' + escapeHtml(mode) + '</div>' : '') +
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
    const pw = room.hasPassword ? (prompt(t('lobby.pw2')) || '') : ($('in-pw').value || '');
    NET.joinRoom(room.id, pw, myName(), role);
  }
  function myName() {
    const v = ($('in-name').value || '').trim() || DEFAULT_NAME;
    try { localStorage.setItem(KEY_NAME, v); } catch (e) {}
    return v;
  }

  // ───────── 準備完了の合意（全員が押したら始まる） ─────────
  function myPid() { const st = NET.state(); return (st && st.pid) || S.net.myPid; }
  function playersInRoom() { return (S.net.roster || []).filter(r => r.role !== 'spectator'); }
  function clearReady() {
    if (!S.net.isHost) return;
    S.net.ready = {};
    NET.send({ k: 'rmap', map: {} });
    showRoom();
  }
  function setReady(pid, ok) {
    if (!S.net.isHost) return;
    S.net.ready = S.net.ready || {};
    if (ok) S.net.ready[pid] = true; else delete S.net.ready[pid];
    NET.send({ k: 'rmap', map: S.net.ready });
    showRoom();
    const list = playersInRoom();
    if (list.length >= 1 && list.every(r => S.net.ready[r.pid])) startNetGame();
  }
  function toggleMyReady() {
    const pid = myPid();
    const on = !(S.net.ready && S.net.ready[pid]);
    AU.sfx('button');
    if (S.net.isHost) { setReady(pid, on); return; }
    S.net.ready = S.net.ready || {};
    if (on) S.net.ready[pid] = true; else delete S.net.ready[pid];
    NET.send({ k: 'ready', ok: on, pid }, 'host');
    showRoom();
  }
  function startNetGame() {
    const names = seatList();
    const seed = newSeed();
    NET.send({ k: 'start', seed, config: netConfig(), names });
    S.net.myIdx = seatIndexOfMe(names);
    startGame(seed, names, null);
  }

  function showRoom() {
    if (S.screen !== 'room') show('room');
    else mountSetup('setup-host-room', !S.net.isHost);
    const spec = S.net.role === 'spectator';
    $('room-status').textContent = spec ? t('lobby.watching') : t('lobby.waiting');
    $('room-owner-note').textContent = S.net.isHost ? t('room.youDecide') : t('room.hostDecides');
    const ready = S.net.ready || {};
    const box = $('roster'); box.innerHTML = '';
    (S.net.roster || []).forEach(r => {
      const d = document.createElement('div'); d.className = 'pl-row' + (ready[r.pid] ? ' turn' : '');
      const mark = r.role === 'spectator' ? t('lobby.spectate') : (ready[r.pid] ? t('room.ready') : t('room.notReady'));
      d.innerHTML = '<span>' + escapeHtml(r.name || '') + '</span><span>' + escapeHtml(mark) + '</span>';
      box.appendChild(d);
    });
    const btn = $('btn-ready');
    btn.style.display = spec ? 'none' : '';
    btn.textContent = ready[myPid()] ? t('room.cancelReady') : t('room.ready');
    btn.classList.toggle('primary', !ready[myPid()]);
    refreshServerStatus();
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
    $('in-speed').value = Math.round(animSpeed() * 100);
    $('speed-val').textContent = animSpeed().toFixed(1) + '×';
    $('modal-settings').classList.add('on');
  }
  $('btn-set-close').onclick = () => $('modal-settings').classList.remove('on');
  $('vol-bgm').oninput = e => AU.setBgmVolume(+e.target.value);
  $('vol-sfx').oninput = e => AU.setSfxVolume(+e.target.value);
  $('mute-bgm').onchange = e => AU.setMuted('bgm', e.target.checked);
  $('mute-sfx').onchange = e => AU.setMuted('sfx', e.target.checked);
  $('in-speed').oninput = e => setAnimSpeed((+e.target.value || 100) / 100);
  $('btn-gear').onclick = openSettings;

  // ══════════════════════════════════════════════
  //  ボタン結線
  // ══════════════════════════════════════════════
  $('btn-lobby-back').onclick = () => { NET.leave(); S.net.on = false; show('home'); };
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
  $('sw-time').onchange = e => { S.cfg.mods['G-14'] = e.target.checked; buildSetup(); };
  $('sel-players').onchange = e => { S.cfg.players = +e.target.value; buildSetup(); };
  $('sel-aicount').onchange = e => { S.cfg.aiCount = +e.target.value; buildSetup(); };
  $('in-target').onchange = e => { S.cfg.target = Math.max(1, +e.target.value || 10); };
  $('in-tbase').onchange = e => { S.cfg.tbase = Math.max(0, +e.target.value || 0); };
  $('in-tbank').onchange = e => { S.cfg.tbank = Math.max(0, +e.target.value || 0); };
  $('sw-coop').onchange = e => { S.cfg.coop = e.target.checked; buildSetup(); };
  $('in-limit').onchange = e => { S.cfg.shotLimit = Math.max(4, +e.target.value || 30); };

  $('btn-start').onclick = () => {
    AU.sfx('button');
    S.net.on = false;
    startGame(newSeed(), null, null);
  };
  $('btn-setup-back').onclick = () => { AU.sfx('button'); show('home'); };
  $('btn-ready').onclick = toggleMyReady;
  $('btn-create').onclick = () => {
    const room = ($('in-room').value || '').trim();
    try { localStorage.setItem(KEY_ROOM, room); } catch (e) {}
    NET.createRoom({
      hostName: myName(),
      roomName: room || (myName() + ' の部屋'),
      password: $('in-pw').value || '',
      isPublic: !$('in-private').checked,
      maxPlayers: S.cfg.players,
      config: netConfig(),
    });
  };
  $('btn-refresh').onclick = () => NET.refresh();

  $('btn-quit').onclick = () => {
    if (S.net.on) { NET.leave(); S.net.on = false; }
    show('home');
  };
  $('btn-deadlock').onclick = () => { if (isMyTurn()) askDeadlock(); };
  $('btn-replay').onclick = () => {
    if (!S.replay) return;
    const w = E.createWorld(S.game.table, S.replay.balls.map(b => Object.assign({}, b)), S.game.tuning);
    const cue = w.balls.find(b => b.kind === 'cue' && (S.game.rule !== 'G-04' || b.owner === S.replay.turn));
    if (!cue) return;
    E.applyCue(cue, S.replay.shot);
    S.replayRun = w;
  };
  $('btn-again').onclick = () => { AU.sfx('button'); closeResult(); startGame(newSeed(), null, null); };
  $('btn-to-setup').onclick = () => { AU.sfx('button'); closeResult(); show('home'); };
  $('lang-select').onchange = e => { I.setMode(e.target.value); applyLang(); };

  function newSeed() { return (Math.random() * 4294967296) >>> 0; }

  // ══════════════════════════════════════════════
  //  起動
  // ══════════════════════════════════════════════
  function boot() {
    I.init();
    mountSetup('setup-host', false);        // 設定の中身の定位置は設定画面の中
    ['version-tag', 'version-tag-2', 'version-tag-3', 'version-tag-4', 'version-tag-5', 'version-tag-6'].forEach(id => {
      const e = $(id); if (e) e.textContent = 'v' + APP_VER;
    });
    // 名前と部屋名は憶えておく。パスワードは憶えない
    try {
      $('in-name').value = localStorage.getItem(KEY_NAME) || DEFAULT_NAME;
      $('in-room').value = localStorage.getItem(KEY_ROOM) || '';
    } catch (e) { $('in-name').value = DEFAULT_NAME; }
    applyLang();
    AU.bindVisibility();

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
    // 「鳴らさない」はミュートを立てるだけ。音量は触らないので、あとで解除すれば鳴る
    $('btn-audio-yes').onclick = () => { $('modal-audio').classList.remove('on'); AU.enable(); };
    $('btn-audio-no').onclick = () => { $('modal-audio').classList.remove('on'); AU.enableMuted(); };

    document.addEventListener('touchmove', e => { if (e.target === cv) e.preventDefault(); }, { passive: false });

    resizeBoard();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  if (DEBUG) {
    document.body.classList.add('debug');
    window.BL = { S, E, RU, T, I, fire: fireShot, shootNow, beginTurn, startGame, finishShot, applyShot, draw2D, draw3D, drawElevPic, minElevFor, computeElevFan, placeOk, resizeBoard, show, showRoom, buildSetup, mountSetup, onNetMsg, seatList, seatIndexOfMe };
  }
})();
