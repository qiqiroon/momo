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

  const APP_VER = '1.70';                 // デプロイのたびに 0.01 繰り上げる（11.8.2節）
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
  // 盤に重ねる知らせを動かした場所（利用者指示）。窓の大きさが変わっても効くよう割合で持つ
  const MSG_KEY = 'billiards_msgpos';
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
      S.animSpeed = Math.min(2, Math.max(0.1, v));
    }
    return S.animSpeed;
  }
  /*
   * つまみの位置と速さの対応。
   * 0.1〜1.0 と 1.0〜2.0 では倍率の幅が 10倍 と 2倍 で釣り合わないので、
   * つまみを等分に切ると 1.0 が端へ寄ってしまう。
   * そこで倍率の側を等分（対数）にして、**真ん中がちょうど等速**になるようにした。
   * さらに真ん中の近くでは等速へ吸い付かせる＝いちばん使う値を選びやすくする。
   */
  /*
   * ジャンプしている間だけの速さ。設定の値は無視してここまで落とす。
   * 飛んでいる時間は実測 0.4〜1.2 秒しかなく、等速だと一瞬で終わって
   * 跳ねたことも着地の音も分からないため。
   */
  const JUMP_SPEED = 0.2;
  const JUMP_Z = 6;                       // これより高ければ「飛んでいる」とみなす

  const SNAP = 4;                         // この幅ぶん真ん中に近ければ等速に合わせる
  function posToSpeed(pos) {
    if (Math.abs(pos - 50) <= SNAP) return 1;
    if (pos < 50) return 0.1 * Math.pow(10, pos / 50);
    return Math.pow(2, (pos - 50) / 50);
  }
  function speedToPos(v) {
    if (v >= 0.995 && v <= 1.005) return 50;
    if (v < 1) return Math.round(50 * (Math.log10(v) + 1));
    return Math.round(50 + 50 * Math.log2(v));
  }
  function setAnimSpeed(v) {
    S.animSpeed = Math.min(2, Math.max(0.1, v));
    try { localStorage.setItem(KEY_SPEED, String(S.animSpeed)); } catch (e) {}
    const el = $('speed-val');
    if (el) el.textContent = (S.animSpeed < 0.95 ? S.animSpeed.toFixed(2) : S.animSpeed.toFixed(2)) + '×';
  }
  const DEFAULT_NAME = 'MOMO太郎';

  // ───────── 状態 ─────────
  const S = {
    screen: 'home',
    cfg: {
      scope: 'standard',
      rule: 'G-01', shape: 'A-01', carom: false, tableChosen: true,
      // ★どちらの台でも遊べるルール（ボウリング型）で選んだほう。他のルールでは使わない
      caromPick: false,
      mode: 'normal',
      mods: { 'G-13': false, 'G-14': true, 'G-15': false },
      diff: 'easy',
      cue: [false, false, false, false, false, false, false],   // 撞球の癖7項目（既定=簡単）
      players: 2, aiCount: 1, format: 'local',
      target: 10, tbase: 30, tbank: 5,
      coop: false, teams: [], shotLimit: 30,
      // 続けてもう1局やるときのブレイク権。既定は交代制（仕様書 D242 の既定）
      breakRule: 'rotation',
    },
    game: null,
    phase: 'idle',         // idle|place|aim|stance|rolling|wait|over
    aim: { dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0 },
    // 陣取りで手番の頭に自分の色の玉を光らせる（表示だけ。決定論の外）
    flash: null,
    elevFan: null, elevAdjusting: false,
    aimPreview: null, aimDirty: true,
    drag: null,
    placePos: null, pendingPlace: null,
    msg: '',
    replay: null, replayRun: null,
    clock: { baseLeft: 0, banks: [], running: false },
    net: {
      on: false, role: 'none', isHost: false, myPid: null, myIdx: -1, roster: [], lastRooms: [],
      wsOpen: false, wasClosed: false, ready: {}, sentCfg: null,
      maxPlayers: 2,       // 部屋の定員。開いた時点で決まり、あとから変えられない（仕様2.6節）
      gone: {},            // 対局の途中で抜けた人。待ち合わせで待ち続けないための控え
    },
    aiCancel: null, confirmCb: null, dlVotes: {},
    chk: {},               // 受け取った盤面照合（ショット番号 → 指紋）。追いついてから比べる
    results: {},           // 撞いた人が配った「その手の結果」（ショット番号 → 盤面）
    shotMine: false,       // いま処理している手を撞いたのは自分か
    pendingShots: {},      // 先に届いた相手の手。こちらがその番号へ達したら指す
    waitDone: null, waitTimer: null, readyShot: null, forceShot: null,
    catchUp: false,        // 追いつき直しの最中。過去の手を黙って並べ直すあいだ立てる
    lastNeed: null,        // 追いつき直しを頼んだ手の番号。同じ手で何度も頼まない
    airZ: {},
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
    set('lbl-break', 'brk.title');
    [].forEach.call($('seg-break').children, b => { b.textContent = t('brk.' + b.dataset.v); });
    set('btn-start', 'btn.start');
    set('k-turn', 'hud.turn'); set('k-next', 'hud.next'); set('k-foul', 'hud.foul');
    set('k-base', 'hud.base'); set('k-bank', 'hud.time'); set('k-elevlabel', 'hint.elev');
    set('btn-replay', 'btn.replay'); set('btn-deadlock', 'btn.deadlock'); set('btn-quit', 'btn.quit');
    set('btn-demo', 'btn.demo');
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
    set('lbl-maxp', 'lobby.maxPlayers'); set('maxp-note', 'lobby.maxNote');
    buildMaxPlayers();
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
   * グレーは台形状の側にだけ掛け、ルールを選び直して台が成立しなくなったときは
   * 台の選択を解除して選び直しを求める（2.5.3節）。両方向へ掛けると行き止まりができる。
   */
  /*
   * ★ルールのグレーも、台形状と同じく**実際に入っているルールの一覧**から決める。
   *   STAGE は仕様書 11.2.3節の「段階の割り当て」であって、実装が済んだかどうかではない。
   *   ここで段階の数を見ていると、ルールを1本足すたびに2か所を直すことになり、
   *   片方を書き忘れると「入っているのに選べない」または「無いのに選べる」になる。
   */
  function ruleBlock(id) {
    if (RU.RULE_IDS.indexOf(id) < 0) return t('why.stage3');
    if (id === 'G-02' && S.cfg.players > 2) return t('why.twoOnly');
    /*
     * 陣取りは人数ぶんの色を要る（2.4.3節）。**上限は色の数から引く。**
     * 数字を書き込むと、色を増やしたときと人数の上限を上げたときの2か所を直すことになり、
     * 片方を忘れると**静かに2人が同じ色になる**（色の一覧を余りで回すため）。
     */
    if (id === 'G-06' && S.cfg.players > RU.TERRITORY_COLORS.length) {
      return t('why.maxPlayers', { n: RU.TERRITORY_COLORS.length });
    }
    // カーリング型も人数ぶんの色が要る（持ち球がその人の色そのもの）。上限は色の数から引く
    if (id === 'G-09' && S.cfg.players > RU.CAROM_COLORS.length) {
      return t('why.maxPlayers', { n: RU.CAROM_COLORS.length });
    }
    return null;
  }
  /**
   * そのルールで使う台がキャロム版（ポケットなし）かどうか。
   * ルールの側が「ポケットが要るか」を持っているので、そこから引く。
   * ルール名を並べて判定すると、ルールが増えたときに書き足し忘れる。
   */
  function caromForRule(rule) {
    const need = RU.NEEDS_POCKETS[rule];
    if (need === true) return false;      // ポケットあり台でしか成立しない
    if (need === false) return true;      // キャロム版台でしか成立しない
    /*
     * ★**null ＝ どちらの台でも遊べるルール**（ボウリング型だけ。2.4.1節）。
     * この場合だけ台の姿は利用者が選ぶので、ルールから決めてはいけない。
     */
    return !!S.cfg.caromPick;
  }

  /**
   * 台形状のグレー。STAGE は仕様書 11.2.3節の「段階の割り当て」であって
   * 実装が済んだかどうかではない。実際に選べるかは台定義データが持っている形だけで決める。
   * ここで形状名を並べると、台を足したときに解禁を書き忘れる（逆も同じ）。
   */
  function shapeBlock(shape) {
    if (T.SHAPE_IDS.indexOf(shape) < 0) return t('why.stage3');
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
        () => { S.cfg.rule = id; onRuleChanged(); }));
    });
    // 遊び方は選んだ1つぶんだけ下に出す。全部に付けると名前が探しにくい
    $('rule-how').textContent = t('rule.how.' + S.cfg.rule);
    /*
     * 台は形を選ぶだけ。ポケットあり／キャロム版はルールが決めるので、
     * 同じ形を2つ並べない。ルールを変えると、いま選んでいる台の姿が変わる。
     *
     * ★**ただしボウリング型だけは「どちらの台でも遊べる」**（2.4.1節）。
     *   このルールのときだけ、同じ形をポケットあり／キャロム版の2つ並べる
     *   ＝仕様書 2.3.2節のいう「台形状16種」がそのまま現れる。
     *   切り替えのつまみを別に置かないのは、**選ぶものが1つ（軸2）だから**である。
     */
    const bothTables = RU.NEEDS_POCKETS[S.cfg.rule] == null;
    S.cfg.carom = caromForRule(S.cfg.rule);
    const ot = $('opts-table'); ot.innerHTML = '';
    SHAPES_ALL.forEach(sh => {
      if (!visible('shape', sh)) return;
      const why = shapeBlock(sh);
      const kinds = bothTables ? [false, true] : [S.cfg.carom];
      kinds.forEach(cm => {
        const label = t('shape.' + sh) + '（' + t(cm ? 'tbl.carom' : 'tbl.pocket') + '）';
        const sel = S.cfg.tableChosen && S.cfg.shape === sh && (!bothTables || S.cfg.caromPick === cm);
        ot.appendChild(chip(label, sel, !!why, why, () => {
          S.cfg.shape = sh; S.cfg.caromPick = cm; S.cfg.tableChosen = true; buildSetup();
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
    const note = $('players-note');
    const maxP = (S.cfg.rule === 'G-02') ? 2 : 4;
    if (S.net.on) {
      /*
       * 通信対戦では、人数は選ぶものではなく**いま集まっている対局者の数**である。
       * 部屋の定員は開いた時点で決まっていて、あとから変えられない（仕様2.6節）。
       * ここで選ばせると「選べるのに何も起きない」欄になり、
       * 3人にしたつもりで部屋を作った人が、3人目を入れられないまま待つことになる。
       */
      S.cfg.players = Math.max(1, playersInRoom().length);
      selP.innerHTML = '<option>' + S.cfg.players + '</option>';
      selP.value = String(S.cfg.players);
      selP.disabled = true;
      if (note) { note.textContent = t('lobby.hereNow'); note.style.display = ''; }
    } else {
      /*
       * ★**下限はルールの側から引く。**ボウリング型とゴルフ型は1人でも成り立つ（7.14節）ので、
       *   ローカル対戦でも1人を選べる。ここにルール名を並べると、増えたときに書き忘れる。
       */
      const soloRule = !!RU.SOLO_OK[S.cfg.rule];
      const minP = (S.cfg.format === 'practice' || S.cfg.format === 'ai' || soloRule) ? 1 : 2;
      selP.disabled = false;
      selP.innerHTML = '';
      for (let n = minP; n <= maxP; n++) {
        const o = document.createElement('option'); o.value = n; o.textContent = n; selP.appendChild(o);
      }
      if (S.cfg.players < minP) S.cfg.players = minP;
      if (S.cfg.players > maxP) S.cfg.players = maxP;
      selP.value = S.cfg.players;
      if (note) note.style.display = 'none';
    }

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

    /*
     * 続けてもう1局やるときのブレイク権。1人では次の局も自分なので出さない。
     * 練習モードは勝敗を持たないので出さない（9.6.1節）
     */
    const seatsN = seatNames().length;
    const showBreak = seatsN >= 2 && S.cfg.format !== 'practice';
    $('brk-block').style.display = showBreak ? '' : 'none';
    [].forEach.call($('seg-break').children, b => {
      b.classList.toggle('sel', S.cfg.breakRule === b.dataset.v);
    });
    $('break-note').textContent = t('brk.note.' + (S.cfg.breakRule || 'rotation'));

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

    const bad = !S.cfg.tableChosen || !!ruleBlock(S.cfg.rule) || !!shapeBlock(S.cfg.shape);
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
      for (let i = 0; i < S.cfg.aiCount; i++) out.push('AI-' + (i + 1));
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
    // 台の姿はルールが決める。選んでいた形はそのまま残す
    S.cfg.carom = caromForRule(S.cfg.rule);
    if (S.cfg.tableChosen && shapeBlock(S.cfg.shape)) S.cfg.tableChosen = false;
    if (S.cfg.rule === 'G-02' && S.cfg.players > 2) S.cfg.players = 2;
    if (S.cfg.rule === 'G-06' && S.cfg.players > RU.TERRITORY_COLORS.length) {
      S.cfg.players = RU.TERRITORY_COLORS.length;
    }
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
    if (name === 'play') resizeBoard();
    // 待合室でも画面を消させない（観戦者は始まるまで何もしない）
    if (keepAwakeHere()) requestWakeLock(); else releaseWakeLock();
    window.scrollTo(0, 0);
  }

  /*
   * 対戦中は画面を消させない（携帯で撞いている途中に暗転しないように）。
   *
   * **観戦者は画面に触らない。** 触らないと、端末によっては画面を消さない約束を
   * 取り直せないことがあるので、次の3つで取り直しを試みる：
   *   ・画面が戻ってきたとき（消えると約束は解かれる）
   *   ・画面に触れたとき
   *   ・一定時間ごとの見直し（触らない観戦者のための命綱）
   * 待合室でも取る。観戦者は対局が始まるまで何もしないので、そこでも消えては困る。
   */
  function keepAwakeHere() { return S.screen === 'play' || S.screen === 'room'; }
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || S.wakeLock) return;
    if (document.visibilityState !== 'visible') return;   // 見えていないと必ず失敗する
    navigator.wakeLock.request('screen').then(l => {
      S.wakeLock = l;
      l.addEventListener('release', () => { S.wakeLock = null; });
    }).catch(() => {});
  }
  function releaseWakeLock() {
    if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && keepAwakeHere()) requestWakeLock();
  });
  document.addEventListener('pointerdown', () => { if (keepAwakeHere()) requestWakeLock(); }, true);
  setInterval(() => { if (keepAwakeHere()) requestWakeLock(); }, 20000);

  // ══════════════════════════════════════════════
  //  ゲームの開始
  // ══════════════════════════════════════════════
  function playerList() {
    const list = [];
    if (S.cfg.format === 'practice') { list.push({ name: 'You', type: 'human' }); return list; }
    if (S.cfg.format === 'ai') {
      list.push({ name: 'You', type: 'human' });
      for (let i = 0; i < S.cfg.aiCount; i++) list.push({ name: 'AI-' + (i + 1), type: 'ai' });
      return list;
    }
    for (let i = 0; i < S.cfg.players; i++) list.push({ name: 'P' + (i + 1), type: 'human' });
    return list;
  }

  /**
   * バンキング（先手決め）を行う対戦形式か。
   * 仕様書 7.2.7節は「最初のブレイク権は参加順の先頭」としているが、
   * それだといつも同じ席（通信対戦では主催者）が先手になる。
   * 利用者の指示により、通信対戦とAI対戦ではバンキングで決める。
   */
  /*
   * バンキングを行う場面。通信対戦とAI対戦は「席で先手が決まらないように」（7.2.7節）。
   * **サバイバルは対戦形式によらず必ず行う。**このルールはバンキングが
   * 先手だけでなく**全員の打順そのもの**を決める仕組みの一部だからである（7.8節）。
   */
  function bankingHere(cfg) {
    /*
     * ★カーリング型もバンキングをする（利用者指示）。**先攻を決めてからエンドごとに回す**ので、
     * ローカル対戦でも最初の順を決めておく必要がある。サバイバルと同じ理由である。
     */
    return cfg.format === 'online' || cfg.format === 'ai'
      || cfg.rule === 'G-08' || cfg.rule === 'G-09';
  }
  /**
   * 続けてもう1局やるときの席順。前回の巡りを保ったまま、ブレイクする人を先頭へ回す。
   * バンキングは**シリーズの最初の1局だけ**。続きの局はここで決めた順で始める。
   */
  function contOrder() {
    return S.game ? RU.nextOrder(S.game, S.cfg.breakRule || 'rotation') : null;
  }
  /** いまバンキングの最中か */
  function inBanking() { return !!(S.game && S.game.bank && S.game.bank.on); }

  /**
   * @param {boolean} cont 続きの局か。続きはバンキングをしない
   *   （先手は前回の結果とブレイク権の決め方で既に決まっており、席順として配られている）
   */
  function startGame(seed, players, remoteCfg, cont) {
    closeResult();                          // 前の局の結果画面を畳む（ゲストが start を受けたときに残っていた）
    if (remoteCfg) Object.assign(S.cfg, remoteCfg);   // 通信対戦はホストの設定を強制適用（9.5.3節）
    const cfg = S.cfg;
    // 台の姿はルールから引く。画面を作り直したときだけ決まる形にすると、
    // 設定画面を通らずに始まった局（もう一度・通信）で食い違う
    cfg.carom = caromForRule(cfg.rule);
    const g = RU.createGame({
      rule: cfg.rule, shape: cfg.shape, hasPockets: !cfg.carom,
      players: players || playerList(),
      seed: seed >>> 0, difficulty: cfg.diff,
      tuning: tuningFromCfg(), targets: null,
      coop: !!cfg.coop, teams: (cfg.teams || []).slice(), shotLimit: cfg.shotLimit,
    });
    g.players.forEach(p => { if (cfg.rule === 'G-04') p.target = cfg.target; });
    /*
     * 先手はバンキングで決める（通信対戦・AI対戦のみ）。
     * ローカル対戦は同じ人が全員ぶんを操作するので、誰が先でも有利不利にならない。
     * 練習モードは1人なので相手がいない。
     */
    g.cont = !!cont;                        // 追いつき直しのときに同じ形で作り直すため覚えておく
    if (!cont && bankingHere(cfg) && g.players.length >= 2) RU.startBanking(g);
    S.game = g;
    S.chk = {}; S.results = {};             // 前の局の照合・結果は持ち越さない
    S.dropped = null; S.bursts = []; S.airZ = {}; S.pendingShots = {};
    S.net.done = {}; S.net.gone = {}; S.waitDone = null; S.readyShot = null; S.forceShot = null;
    S.catchUp = false; S.lastNeed = null;
    if (S.waitTimer) { clearTimeout(S.waitTimer); S.waitTimer = null; }
    // ボウリング型の「結果を見せる間」の時計。局をまたいで残すと、前の局の続きが動く
    if (S.bowlTimer) { clearTimeout(S.bowlTimer); S.bowlTimer = null; }
    S.bowlBox = false;
    S.replay = null; S.replayRun = null; S.demo = null; S.endWait = 0;
    S.clock.banks = g.players.map(() => cfg.tbank * 60);
    S.aim = { dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0 };
    S.msg = '';
    clearFlash();                           // 前の局のファウルを次の局へ持ち越さない
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

  /*
   * 玉を見ている速さは人によって違う（設定＋ジャンプ中の減速）。
   * 誰かがまだ玉の転がりを見ている最中に次の手が始まると、
   * その人だけ「見ていない手」が進んでしまう。
   * そこで、次の手は**対局者全員がその手を見終わってから**始める。
   *
   * **待つのは対局者どうしの遅れだけ。観戦者の画面は待たない**（仕様9.5.8節
   * 「対局者より表示が遅れることを許容する。観戦は対局の進行に影響しない」）。
   * 間に合わなかった観戦者は、玉を見終わってから次の手を受け取る（先に届いた手は預かってある）。
   *
   * 数える相手は**この対局の席**であって、いま部屋にいる人ではない。
   * 在室者から数えると、定員に空きのある部屋へ遅れて来た人まで待つ相手に入り、
   * その人は対局を持っていないので永久に返事が来ない。
   */
  const DONE_WAIT_MS = 12000;               // これ以上待っても来なければ先へ進む
  function markDone(pid, n) {
    if (!pid) return;
    const d = S.net.done || (S.net.done = {});
    for (const k of Object.keys(d)) if (+k < n) delete d[k];   // 古い手の記録は捨てる
    (d[n] || (d[n] = {}))[pid] = 1;
  }
  function allDone(n) {
    if (S.forceShot === n) return true;      // 待ちを打ち切った手は、そろった扱いにする
    const g = S.game; if (!g) return true;
    const d = (S.net.done || {})[n] || {};
    const gone = S.net.gone || {};
    // 抜けた人は待たない。待ち続けると誰も進めなくなる
    return g.players.every(p => !p.pid || p.retired || d[p.pid] || gone[p.pid]);
  }

  /*
   * ★ボウリング型で、投げ終わったあとに結果を見せる間（利用者指示の順序）。
   *   投げ終わり → 跡（どこからどこへ動いたか）→ ピンの状態のボックス →
   *   両方消える → 次の投擲のためにピンを並べ直す。
   */
  const BOWL_LINE_MS = 700;      // 跡を出してから、ピンの状態を出すまで
  const BOWL_SHOW_MS = 2800;     // 投げ終わりから、消して並べ直すまで

  function beginTurn() {
    const g = S.game;
    if (!g || g.over) return;

    /*
     * ★**片付けが残っているうちは手番を始めない。**
     *   ここで待たずに進むと、結果を見せる前に盤が次の姿（並べ直した10本）になる。
     *   追いつき直しやリプレイのように時間の流れが無い場面では、待たずにその場で片付ける。
     */
    if (g.rule === 'G-11' && g.bowling && g.bowling.pending) {
      if (S.catchUp || S.demo) { RU.bowlFlushRack(g); }
      else if (!S.bowlTimer) {
        S.phase = 'wait';
        S.bowlBox = false;              // まずは跡だけ。ボックスは少し遅れて出す
        renderHUD();
        S.bowlTimer = setTimeout(() => {
          if (S.game !== g || g.over) { S.bowlTimer = null; return; }
          S.bowlBox = true;             // ピンの状態のボックスを出す
          renderHUD();
          S.bowlTimer = setTimeout(() => {
            S.bowlTimer = null;
            if (S.game !== g || g.over) return;
            S.bowlBox = false;          // 跡もボックスも消して、並べ直す
            RU.bowlFlushRack(g);
            renderHUD();
            beginTurn();
          }, Math.max(0, BOWL_SHOW_MS - BOWL_LINE_MS));
        }, BOWL_LINE_MS);
        return;
      } else {
        return;                          // 見せている最中。時間が来たらここへ戻ってくる
      }
    }

    /*
     * 待ち合わせは「手の入り口」で行う。
     * 撞き終わったときだけ知らせる作りにしていたが、手番が始まる経路は
     * 対局開始・ミスキュー・時間切れ・組み直しと他にもあり、
     * それらでは誰も知らせないので全員が待ったまま止まった。
     * **知らせる側と待つ側を同じ場所に置く**ことで、経路を数え落とさない。
     */
    if (S.net.on && S.net.role !== 'spectator') {
      if (S.readyShot !== g.shotNo) {
        S.readyShot = g.shotNo;
        markDone(myPid(), g.shotNo);
        sendPlayers({ k: 'done', n: g.shotNo, pid: myPid() });
      }
      if (!allDone(g.shotNo)) {
        if (S.waitDone !== g.shotNo) {
          S.waitDone = g.shotNo;
          S.phase = 'wait';
          setMsg(t('lobby.waitScreen'));
          renderHUD();
          if (S.waitTimer) clearTimeout(S.waitTimer);
          // 返事が来ないまま止まり続けるほうが困る。待つのは打ち切る
          S.waitTimer = setTimeout(() => {
            S.waitTimer = null;
            if (S.game === g && S.waitDone === g.shotNo) {
              S.forceShot = g.shotNo;        // 打ち切った印。これが無いと待ち直してしまう
              S.waitDone = null;
              beginTurn();
            }
          }, DONE_WAIT_MS);
        }
        return;
      }
    }
    if (S.waitTimer) { clearTimeout(S.waitTimer); S.waitTimer = null; }
    S.waitDone = null;
    S.aim.power = 0; S.aim.tipX = 0; S.aim.tipY = 0; S.aim.elev = 0;
    S.aimDirty = true; S.pendingPlace = null; S.drag = null;
    S.elevTouched = false;                  // 角度は自分で動かすまで自動で合わせる
    $('elev').value = 0;
    const cue = RU.cueBallOf(g, g.turn);
    if (cue) { S.aim.dir = 0; computeElevFan(cue); autoElev(); }

    if (g.ballInHand && cue) {
      S.phase = 'place';
      // ブレイクの初期位置はヘッドストリングの少し手前。そこから自由に動かせる
      // 台が既定の置き場所を持っていればそれを使う（ドーナツ型は長軸の上に線が出ない）
      const head = T.breakPlace(g.table);
      S.placePos = g.ballInHandFull ? { x: cue.x, y: cue.y } : head;
      // そこが置けない場所なら、台の内側へ引き戻したうえでヘッド側へ寄せる。
      // 台の形が変わると、決め打ちの座標が壁の外や玉の上に来ることがある
      if (!placeOk(S.placePos)) {
        S.placePos = T.clampInside(g.table, head.x, head.y, cue.r);
      }
      /*
       * ブレイクの既定の狙いはラックの方向。
       * 手玉とラックが長軸の上に一直線に並ぶ台では、これは従来どおり 0 になる。
       * ドーナツ型は手玉を脇へ寄せるので、0 のままだと壁を向いてしまう。
       */
      if (!g.ballInHandFull) {
        S.aim.dir = Math.atan2(g.table.spot.y - S.placePos.y, g.table.spot.x - S.placePos.x);
      }
    } else {
      S.phase = 'aim';
    }
    /*
     * 陣取り：手番が変わったら、これから撞く人の色の玉を数回光らせる（実機での指摘）。
     * 手番表示に色の印を置いても、**盤のどの玉が自分のものかは目で探すことになる**。
     *
     * ★**入るたびに始まりの時刻を置き直す。**残っていると、次の手番が早く始まったときに
     *   前の知らせが出たままになる。「そのうち消えるから片付けなくてよい」は通らない。
     * ★演出なので実時間で進める（決定論の外。物理の刻みには触れない）。
     */
    S.flash = (g.rule === 'G-06') ? { seat: g.turn, t0: performance.now() } : null;

    S.clock.baseLeft = S.cfg.mods['G-14'] ? S.cfg.tbase : 0;
    S.clock.lastBeep = 0;
    // バンキングは対局の前の手続きなので、持ち時間を減らさない
    S.clock.running = !inBanking() && S.cfg.mods['G-14'] && isMyTurn() && g.players[g.turn].type === 'human';

    if (g.players[g.turn].type === 'ai') {
      S.phase = 'wait';
      setMsg(t('ph.thinking'));
      let aiPlace = null;
      if (inBanking()) {
        // バンキングは置いた場所のまま撞く。置き直しても得にならないので選ばせない
        g.ballInHand = false;
        if (S.aiCancel) { S.aiCancel(); S.aiCancel = null; }
        const shot = BilliardsAI.bankShot(g, g.turn);
        setTimeout(() => { if (S.game === g && !g.over) fireShot(shot, null, true); }, 420);
      } else {
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
      }
    } else if (!isMyTurn()) {
      S.phase = 'wait';
      setMsg(S.net.role === 'spectator' ? t('lobby.watching') : t('ph.wait'));
      // 先に届いていた相手の手が、いまの番号のものなら指す
      const held = S.pendingShots && S.pendingShots[g.shotNo];
      if (held) {
        delete S.pendingShots[g.shotNo];
        setTimeout(() => {
          if (S.game !== g || g.over) return;
          S.shotMine = false;              // 預かっていた相手の手。結果は撞いた人が配る
          applyShot(held.shot, held.place, true);
        }, 60);
      }
    } else if (inBanking()) {
      setMsg(t('bank.how'));
      AU.sfx('turn');
    } else {
      /*
       * ★ボウリング型はブレイクを持たないので、置く場面の言い方も変える。
       *   同じ「手前側の区域」でも、あちらはラックを崩す一撞き、こちらは毎回の投球位置である。
       */
      const areaKey = g.ballInHandFull ? 'ph.freeArea'
        : (g.rule === 'G-11' ? 'ph.bowlArea' : 'ph.placeArea');
      setMsg(S.phase === 'place' ? t(areaKey) : t('ph.aim'));
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
  function kitchenLimit() {
    // 手玉を置ける線。台が別に持っていればそれを使う（ドーナツ型・3.5.5節）
    const t = S.game.table;
    return (t.kitchenX != null) ? t.kitchenX : t.headSpot.x;
  }
  /** 円弧の起点からの回り込み量（0〜2π）。範囲に入っているかを見るのに使う */
  function arcOffset(a) { const x = a % (2 * Math.PI); return x < 0 ? x + 2 * Math.PI : x; }
  function clampToKitchen(p) { return { x: Math.min(p.x, kitchenLimit()), y: p.y }; }

  // ══════════════════════════════════════════════
  //  キュー構え可否（4.7節）
  // ══════════════════════════════════════════════
  const CUE_LEN = 1400;
  const SHAFT_R = 7;            // キューの太さの半分（これだけ横に掠っても当たる）
  /**
   * その向きで撞くには、キューをどれだけ持ち上げないといけないか。
   * 邪魔をするのは**壁（クッション）だけではなく、手前にある玉**もである。
   * 玉を数えていなかったので、玉が邪魔な場面では角度が上がらず、
   * なぜ撞けないのかも絵に出せなかった。
   *
   * 玉の越え方は「玉の中心の真上で、玉の高さを越える」で見る。
   * 手前の縁で厳密に見ると角度がわずかに変わるだけで、
   * 「越えられる／越えられない」の答えは変わらない。
   */
  function computeElevFan(cue) {
    const fan = new Float32Array(360);
    // 何がどこで邪魔しているのかも一緒に覚える。角度の絵に描くため
    const dist = new Float32Array(360).fill(Infinity);
    const what = new Array(360).fill(null);        // 'wall' | 'ball'
    S.elevDist = dist; S.elevWhat = what;
    S.elevTipY = S.aim.tipY;
    if (!S.cfg.cue[6]) { S.elevFan = fan; return; }
    const table = S.game.table;
    // キューの先が当たる高さ。上を撞けばそのぶん高くなり、必要な角度は下がる
    const hTip = cue.r + S.aim.tipY * cue.r * 0.5;
    const balls = S.game.world.balls;
    for (let d = 0; d < 360; d++) {
      const a = d * Math.PI / 180 + Math.PI;      // キューは撞く向きの反対側へ伸びる
      const dx = Math.cos(a), dy = Math.sin(a);
      let need = 0, at = Infinity, kind = null;
      // ── 壁
      let L = Infinity;
      for (const s of table.rails) {
        if (s.kind === 'arc') {
          const qx = cue.x - s.cx, qy = cue.y - s.cy;
          const B = 2 * (qx * dx + qy * dy);
          const disc = B * B - 4 * (qx * qx + qy * qy - s.r * s.r);
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          const roots = [(-B - sq) / 2, (-B + sq) / 2];
          for (let ri = 0; ri < 2; ri++) {
            const tt = roots[ri];
            if (tt <= 0 || tt >= L) continue;
            const ang = Math.atan2(cue.y + dy * tt - s.cy, cue.x + dx * tt - s.cx);
            if (arcOffset(ang - s.a0) > s.sweep) continue;
            L = tt; break;
          }
          continue;
        }
        if (s.kind === 'ell') {
          // 縦横を 1 に縮めた座標で見れば円と同じ2次式になる（楕円弧＝A-04）
          const qx = (cue.x - s.cx) / s.ax, qy = (cue.y - s.cy) / s.by;
          const ux = dx / s.ax, uy = dy / s.by;
          const A2 = ux * ux + uy * uy;
          const B2 = 2 * (qx * ux + qy * uy);
          const disc = B2 * B2 - 4 * A2 * (qx * qx + qy * qy - 1);
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          const roots = [(-B2 - sq) / (2 * A2), (-B2 + sq) / (2 * A2)];
          for (let ri = 0; ri < 2; ri++) {
            const tt = roots[ri];
            if (tt <= 0 || tt >= L) continue;
            const ang = Math.atan2((cue.y + dy * tt - s.cy) / s.by, (cue.x + dx * tt - s.cx) / s.ax);
            if (arcOffset(ang - s.t0) > Math.abs(s.sweep)) continue;
            L = tt; break;
          }
          continue;
        }
        const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((s.x1 - cue.x) * ey - (s.y1 - cue.y) * ex) / den;
        const uu = ((s.x1 - cue.x) * dy - (s.y1 - cue.y) * dx) / den;
        if (tt > 0 && uu >= 0 && uu <= 1 && tt < L) L = tt;
      }
      if (isFinite(L) && L <= CUE_LEN) {
        const n = (L <= 1) ? Math.PI / 2
          : Math.min(Math.PI / 2, Math.atan2(Math.max(0, table.cushionTop - hTip), L));
        if (n > need) { need = n; at = L; kind = 'wall'; }
      }
      // ── 手前の玉
      for (const b of balls) {
        if (b === cue || b.state !== 'live') continue;
        const ex = b.x - cue.x, ey = b.y - cue.y;
        const proj = ex * dx + ey * dy;
        if (proj <= 0 || proj > CUE_LEN) continue;
        if (Math.abs(ex * dy - ey * dx) > b.r + SHAFT_R) continue;
        const n = (proj <= 1) ? Math.PI / 2
          : Math.min(Math.PI / 2, Math.atan2(Math.max(0, b.r * 2 + 2 - hTip), proj));
        if (n > need) { need = n; at = proj; kind = 'ball'; }
      }
      fan[d] = need;
      dist[d] = at;
      what[d] = kind;
    }
    S.elevFan = fan;
  }
  /** 撞点を上下させると必要な角度が変わる。変えたときだけ引き直す */
  function refreshElevFan() {
    const g = S.game; if (!g) return;
    if (S.elevTipY === S.aim.tipY) return;
    const cue = RU.cueBallOf(g, g.turn);
    if (cue) { computeElevFan(cue); autoElev(); }
  }
  /**
   * 自分でつまみを動かしていない間は、当たらずに済む最小の角度に合わせておく。
   * いつも水平から始まると、壁や玉が邪魔な場面で「撞けません」とだけ言われる。
   */
  function autoElev() {
    if (S.elevTouched) {
      const need = minElevFor(S.aim.dir);
      if (S.aim.elev < need) { S.aim.elev = Math.min(need, Math.PI / 2); syncElevSlider(); S.aimDirty = true; }
      return;
    }
    const v = Math.min(minElevFor(S.aim.dir), Math.PI / 2);
    if (Math.abs(v - S.aim.elev) > 1e-4) { S.aim.elev = v; syncElevSlider(); S.aimDirty = true; }
  }
  function syncElevSlider() {
    const el = $('elev'); if (el) el.value = Math.round(S.aim.elev * 180 / Math.PI);
  }
  function dirIndex(dir) {
    let d = Math.round(dir * 180 / Math.PI) % 360; if (d < 0) d += 360;
    return d;
  }
  function minElevFor(dir) {
    if (!S.elevFan) return 0;
    return S.elevFan[dirIndex(dir)];
  }
  /** いま向いている方向で、キューの尻がぶつかる邪魔物（壁または玉）までの距離。無ければ Infinity */
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
    /*
     * ★**バンキングの一撞きは、毎回わずかに強さがずれる**（規定は rules.js の bankWobble）。
     * **ずらすのは入力を作るここだけ。**ずらしたあとの5値を、この下で通信へも履歴へも流す。
     * 受け取った側（local でない）と再生は、届いた5値をそのまま使うので引き直さない。
     */
    if (local && inBanking()) shot = RU.bankWobble(shot);
    if (S.net.on && local && S.net.role !== 'spectator') {
      NET.send({ k: 'shot', n: g.shotNo, shot, place: place || null });
    }
    S.shotMine = !!local;                   // 撞いた本人だけが、この手の結果を配る
    applyShot(shot, place, true);
  }

  function applyShot(shot, place, animate) {
    const g = S.game;
    const cue = RU.cueBallOf(g, g.turn);
    // 撞く玉が見つからないまま黙って戻ると、その1手が抜けたまま盤が残る。
    // 抜けたことを言わずに済ませないで、あらためて追いつき直しを頼む
    if (!cue) { requestResync(); return; }
    if (place) { RU.place(cue, place.x, place.y); g.ballInHand = false; g.ballInHandFull = false; }

    /*
     * ★ボウリング型の「動いた跡」は**前の一投のもの**なので、撞き始めたら消す。
     * 残したまま投げると、転がっている玉に前回の線が重なって読めなくなる。
     */
    if (g.rule === 'G-11' && g.bowling) {
      RU.bowlFlushRack(g);          // 見せ終わっていなくても、撞く前には必ず盤を整える
      g.bowling.moves = null; g.bowling.pinState = null;
    }
    g.history.push({ n: g.shotNo, shot: Object.assign({}, shot), place: place || null });
    S.replay = { balls: g.world.balls.map(b => Object.assign({}, b)), shot: Object.assign({}, shot), turn: g.turn };

    const pre = {
      cueId: cue.id,
      targetIds: (RU.legalTargets(g, g.turn) || []).map(b => b.id),
      doubleHit: RU.detectDoubleHit(g, cue, shot),
      miscue: S.cfg.cue[1] && E.isMiscue(shot),
    };
    S.lastShotTip = Math.hypot(shot.tipX || 0, shot.tipY || 0);   // 捻りの強さ（説明に使う）
    S.clock.running = false;

    if (pre.miscue) {
      if (!S.catchUp) { setMsg(t('ev.miscue')); AU.sfx('cue', 0.1); }  // ファウルではない（5.9.2節）
      // バンキング中は「撞いたが成立しなかった1球」として数える。
      // ここで普通の手番送りへ流すと、その人のバンキングが記録されないまま順が回る
      if (g.bank && g.bank.on) { bankStep([]); return; }
      g.shotNo++;
      RU.nextTurn(g, { continueTurn: false });
      if (!S.catchUp) setTimeout(beginTurn, 900);
      return;
    }

    g.world.events = [];
    E.applyCue(cue, shot);
    // 音は「撞いた手応え」なので、物理の値ではなく見えている目盛りに合わせる（カーリング型は幅が違う）
    if (!S.catchUp) { AU.sfx('cue', Math.min(1, RU.aimPower(g.rule, shot.power))); setMsg(t('ph.rolling')); }
    S.pre = pre;
    S.phase = 'rolling';
    S.evCursor = 0;
    // 転がりを最後まで走らせてから後始末する。転がりを終える印は主ループと同じ形にする
    if (!animate) { E.runShot(g.world, 20); S.phase = 'idle'; finishShot(); }
  }

  /**
   * バンキングの1球ぶんを片付けて次へ進める。
   * 撞き終わりとミスキューの両方からここへ来る（入り口を2つ、出口を1つにする）。
   */
  function bankStep(events) {
    const g = S.game;
    const r = RU.bankResolve(g, events || []);
    if (r.done) RU.endBanking(g, r.winner);
    if (S.catchUp) return;                  // 並べ直しの途中では画面も通信も動かさない

    if (r.done) {
      const name = g.players[r.winner] ? g.players[r.winner].name : '';
      /*
       * ★カーリング型は**バンキングの勝者が後手**（最後に撞くのが有利）。
       * ふつうの「先手です」を出すと、直後の動き（勝者が最後に撞く）と食い違う（実機で出た不具合）。
       */
      const key = (g.rule === 'G-09') ? 'bank.decidedLast' : 'bank.decided';
      setMsg(t(key, { name }));
      flash(t(key, { name }));
    } else {
      setMsg(t('bank.turn'));
    }
    if (S.net.on) {
      let synced;
      if (S.shotMine && S.net.role !== 'spectator') { sendResult(g); synced = true; }
      else synced = adoptResult(g.shotNo);
      // 盤の突き合わせは、玉の顔ぶれが変わらない間だけ。
      // バンキングを終えた手では盤を組み直しているので、突き合わせても意味がない
      if (!synced && !r.done) {
        if (S.net.isHost) NET.send({ k: 'chk', n: g.shotNo, h: boardHash() });
        else compareBoardCheck();
      }
    }
    renderHUD();
    setTimeout(beginTurn, r.done ? 1500 : 800);
  }

  function finishShot() {
    const g = S.game;
    if (g.bank && g.bank.on) { bankStep(g.world.events); return; }
    const res = RU.resolveShot(g, S.pre, g.world.events);

    /*
     * **追いつき直しの最中は、過去の手を黙って並べ直すだけにする。**
     * ここを普段どおり通すと、過去の反則を「いま起きたこと」として
     * 音と盤の中央の大きな表示で出し直す（観戦者がずっと反則を申告してくる状態）。
     * それだけでなく、盤面の照合・やり直しの申告・練習の組み直しまで外へ出てしまい、
     * さらに途中で打ち切る経路（勝敗・デッドロック）が手番を進め損ねて、
     * 並べ直したはずの局面が本物とずれる。
     */
    const quiet = !!S.catchUp;

    /*
     * いま落ちた玉を控えておく（盤の真ん中に絵で出す）。手玉が落ちた場合も入れる。
     * 「いま落ちた」の判定は玉の状態ではなく、このショットの結果から引く。
     * 9番のように、落ちてもすぐ盤へ戻される玉があるため。
     */
    if (!quiet) {
      const nowIds = {};
      res.pocketed.forEach(id => { nowIds[id] = 1; });
      const justNow = g.world.balls.filter(b => nowIds[b.id]);
      if (justNow.length) {
        S.dropped = {
          balls: justNow,
          prev: pocketedBalls(g).filter(b => b.kind !== 'cue' && !nowIds[b.id]),
          at: performance.now(),
        };
      }
    }

    if (!g.broken && RU.HAS_RACK[g.rule] && RU.BREAK_VALID[g.rule]) {
      const ok = RU.breakValid(g.world.events, res.pocketed.length);
      g.broken = true;
      if (!ok) { if (!quiet) setMsg(t('ev.breakFail')); res.continueTurn = false; }
    }

    if (res.message) g.lastMessageKey = res.message;   // 記録は黙っていても残す
    if (!quiet) {
      let msg = '';
      if (res.fouls.length) msg = res.fouls.map(f => t('foul.' + f)).join(' / ');
      if (res.message) msg = (msg ? msg + ' — ' : '') + t(res.message);
      if (res.gained) msg = (msg ? msg + ' — ' : '') + '+' + res.gained;
      // サバイバルで球が1つ減ったとき（手玉を落とした罰。7.8.5節）
      if (res.lostBall) msg = (msg ? msg + ' — ' : '') + t('ev.svLost', { n: res.lostBall });
      setMsg(msg);
      // 脱落は盤の真ん中に出す。出さないと、次から手番が飛ぶ理由が分からない
      if (res.outNow && res.outNow.length) {
        const names = res.outNow.map(i => g.players[i] ? g.players[i].name : '?').join(' / ');
        flash(t('ev.svOut', { name: names }), 'foul');
      }
      if (res.fouls.length) {
        AU.sfx('foul');
        // ファウルは盤の真ん中に大きく出す。これが見えないと
        // 「玉が落ちたのに手番が移った」理由が分からない
        flash(t('hud.foul') + '　' + res.fouls.map(f => t('foul.' + f)).join(' / '), 'foul', foulWhy(res));
      }
      if (S.cfg.format === 'practice' && (res.gameOver || g.over)) {
        setTimeout(() => startGame(newSeed(), null, null), 900); // 練習は勝敗を持たない（9.6.1節）
        return;
      }
    }

    if (res.gameOver || g.over) { if (!quiet) endGameSoon(); return; }

    RU.nextTurn(g, res);
    /*
     * ★カーリング型は**手番送りの中でエンドが切り替わり、そこで終局もする**（7.9.3節）。
     * 上の終局の見張りは nextTurn の手前にあるので、ここでもう一度見ないと
     * 全エンドを終えたのに次の手番が始まる。
     */
    /*
     * ボウリング型は**ストライクとスペアだけ**を知らせる。
     * 倒れた本数そのものは、ピンが盤から消えるのとスコアシートの両方に出ているので、
     * 毎投そこへ字を重ねると読むものが増えるだけになる。
     */
    if (!quiet && g.rule === 'G-11' && g.bowling && g.bowling.msg) {
      const m = g.bowling.msg; g.bowling.msg = null;
      if (m.key) flash(t(m.key, m.p));
    }
    if (!quiet && g.rule === 'G-09' && g.curling) {
      const cur = g.curling;
      if (cur.hogged) flash(t('msg.curlHogged', { n: cur.hogged }));
      if (cur.msg) { flash(t(cur.msg.key, cur.msg.p)); cur.msg = null; }
      cur.hogged = 0;
    }
    if (g.over) { if (!quiet) endGameSoon(); return; }
    if (quiet) return;                        // 並べ直しの途中では画面も待ち行列も動かさない

    /*
     * **1手ごとに、撞いた人の結果へ全員を合わせる。**
     * 玉の見え方（アニメ）は端末ごとに違ってよいが、撞き終わった時点の
     * 盤面・手番・得点は必ず同じでなければならない。
     * 撞いた本人が正解を配り、受け取った側は**自分の玉が止まってから**それに合わせる。
     * 転がっている最中に入れ替えないのは、途中で入れ替えると
     * そのあと自分の後始末が重なって手番が二重に進むため。
     */
    if (S.net.on) {
      let synced;
      if (S.shotMine && S.net.role !== 'spectator') { sendResult(g); synced = true; }
      else synced = adoptResult(g.shotNo);
      /*
       * **照合するのは、正解に合わせられなかったときだけ。**
       * 合わせる前に照合すると、自分の狂った盤面で突き合わせることになり、
       * 必ず食い違って「引き直させて」と頼んでしまう。
       * その直後に正解へ合って一瞬そろい、あとから届いた履歴を入力から
       * 計算し直して同じずれが戻る——という堂々巡りになっていた。
       */
      if (!synced) {
        if (S.net.isHost) NET.send({ k: 'chk', n: g.shotNo, h: boardHash() });
        else compareBoardCheck();
      }
      // 合わせた結果が「決着」だったら、自分の計算で気づいていなくても終わりにする
      if (g.over) { endGameSoon(); return; }
    }

    renderHUD();
    /*
     * ★**デッドロックの自動検出は、手番を進め終えてから訊く**（実機で出た不具合）。
     *
     * 以前は手番を進める前に訊いて、その場で処理を打ち切っていた。そのため
     * **断ると手番が進まないまま・次の手番も始まらないまま止まった。**
     * これはカーリング型に限らず**どのルールでも起きる**形で、
     * 他のルールでは12手も進まないことがめったに無いので表に出ていなかっただけである。
     *
     * ここまで来ていれば盤面は次の手番の姿になっているので、
     * **断られたらそのまま続きを始めればよい**（やり直しに同意されたときは
     * どのみち局を組み直すので、先に進めておいても差し支えない）。
     */
    if (!quiet && g.deadlockCount >= 12) { g.deadlockCount = 0; askDeadlock(true); return; }
    // 次の手がもう届いているなら、見せる間合いを詰めて追いつく
    setTimeout(beginTurn, hasWaitingShot() ? 120 : 800);
  }

  /** 撞き終わった時点の「正解」。玉の位置と、勝敗まで含めて配る */
  function resultSnapshot(g) {
    return {
      board: boardSnapshot(),
      turn: g.turn, scores: g.players.map(x => x.score),
      groups: g.players.map(x => x.group == null ? null : x.group),
      fouls: g.players.map(x => x.fouls || 0),
      bih: !!g.ballInHand, bihFull: !!g.ballInHandFull,
      broken: !!g.broken, over: !!g.over, winTeam: g.winTeam,
      dl: g.deadlockCount || 0,
      // 誰が抜けたかも盤面の一部。載せておかないと、追いつき直した人や
      // 途中から見に来た人が、いない相手の手番を待つことになる
      ret: g.players.map(x => !!x.retired),
      // バンキングの進み具合も盤面の一部。載せないと、途中から見に来た人や
      // 追いつき直した人が「まだ先手決めの最中か」を知る手立てを持たない
      bank: g.bank ? {
        on: !!g.bank.on, marks: g.bank.marks.slice(),
        shotBy: Object.assign({}, g.bank.shotBy),
        winner: g.bank.winner == null ? -1 : g.bank.winner,
      } : null,
    };
  }
  function sendResult(g) {
    NET.send(Object.assign({ k: 'res', n: g.shotNo }, resultSnapshot(g)));
  }
  /**
   * 届いている「正解」に合わせる。無ければ何もしない（自分の計算のまま進む）。
   * @returns {boolean} 合わせられたか
   */
  function adoptResult(n) {
    const g = S.game; if (!g) return false;
    for (const k of Object.keys(S.results)) if (+k < n) delete S.results[k];
    const r = S.results[n];
    if (!r) return false;
    delete S.results[n];
    applyBoard(Object.assign({}, r, { n }), true);
    return true;
  }

  /**
   * 勝ち負けの表示は、**落ちた玉を見せ終わってから**出す。
   * 先に出すと、最後に落ちた玉が何だったのかを見ないまま結果に隠れてしまう。
   * 待つ長さは他の場面と同じ（DROP_SHOW_MS）。
   * 盤を触れば落ちた玉の表示は畳まれるので、そのときはすぐ結果へ進む。
   * 進める判断は主ループの1か所で行う（別の待ち行列を作ると途中で途切れても気づけない）。
   */
  function endGameSoon() {
    if (!S.dropped || !S.dropped.balls.length) { endGame(); return; }
    S.endWait = performance.now() + DROP_SHOW_MS + 300;    // 念のための打ち切り
  }

  function endGame() {
    const g = S.game;
    S.phase = 'over'; S.clock.running = false;
    S.flash = null;                      // 手番の知らせは局と一緒に終わる
    if (RU.WIN_KIND[g.rule] === 'points') RU.finishRanking(g);
    // 勝ったかどうかはチームで見る。協力プレイでなければ 1人＝1チームなので同じ答えになる
    const watching = S.net.on && S.net.role === 'spectator';
    const meIdx = S.net.on ? S.net.myIdx : 0;
    const myTeam = (meIdx >= 0 && g.players[meIdx]) ? RU.teamOf(g, meIdx) : -1;
    const won = (g.winTeam >= 0) && (S.net.on ? g.winTeam === myTeam
      : RU.teamMembers(g, g.winTeam).some(p => p.type === 'human'));
    S.won = won && !watching;
    /*
     * ★**引き分けは音を鳴らさない**（利用者指示）。勝ちでも負けでもないため。
     * 引き分けの見分け方は結果表示（renderResult）と同じ＝勝ちチームが無く、打ち切り負けでもない。
     * 観戦者はどちらの側でもないので、勝ちの音も負けの音も鳴らさない。
     */
    const draw = g.winTeam < 0 && !g.failed;
    if (!watching) { if (won) AU.sfx('win'); else if (!draw) AU.sfx('lose'); }
    voteReset();                            // 前の局の選択を持ち越さない（持ち越すと勝手に始まる）
    /*
     * ★**左の欄も描き直す**（実機の指摘）。
     *
     * 左の欄は「手番が始まるとき」（beginTurn）に描き直している。ところが**局が終わると
     * 手番は始まらない**ので、**最後の1投を投げる前の姿のまま止まる。**
     * 実機では、勝利画面が AI-1 を 203 点と出しているのに、
     * 左の欄は 184 点・10フレーム目「✕9」・「3投目・残り1本」のままだった
     * ＝ 同じ画面に2つの違う状態が並んでいた。
     *
     * これはボウリング型に限った話ではない。**局の終わりに一度描き直す**ことで、
     * どのルールでも最後の一撞きが左の欄へ反映される。
     */
    renderHUD();
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
  /**
   * つまんで動かす。
   *
   * **枠の外へはみ出してよい**（利用者指示：枠内に収める作りでは動かせる幅が狭すぎて盤が見えない）。
   * ただし**つまみの帯が掴めなくなる位置には置けない**。置けてしまうと二度と戻せない。
   *   ・左右は、帯が RP_KEEP だけ残るところまで
   *   ・上は枠の内側まで（帯が上に隠れると掴めない）
   *   ・下は帯が枠に残るところまで（本文は全部はみ出してよい）
   * 盤の枠は はみ出しを切り落とす作り（overflow:hidden）なので、外の欄には重ならない。
   */
  const RP_KEEP = 80;
  (function enableResultDrag() {
    const bar = $('rp-bar'), pop = $('result-pop'), pane = $('board-pane');
    if (!bar || !pop || !pane) return;
    let d = null;
    bar.addEventListener('pointerdown', e => {
      d = { x: e.clientX, y: e.clientY, l: pop.offsetLeft, t: pop.offsetTop };
      // 動かしている間は下の盤をはっきり見せる（利用者指示）
      pop.classList.add('clear');
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); e.stopPropagation();
    });
    bar.addEventListener('pointermove', e => {
      if (!d) return;
      const keep = Math.min(RP_KEEP, pop.offsetWidth);
      const minL = -(pop.offsetWidth - keep);
      const maxL = Math.max(minL, pane.clientWidth - keep);
      const maxT = Math.max(0, pane.clientHeight - bar.offsetHeight);
      pop.style.left = clamp(d.l + (e.clientX - d.x), minL, maxL) + 'px';
      pop.style.top = clamp(d.t + (e.clientY - d.y), 0, maxT) + 'px';
      e.preventDefault(); e.stopPropagation();
    });
    const end = e => { d = null; pop.classList.remove('clear'); if (e) e.stopPropagation(); };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  })();

  // ══════════════════════════════════════════════
  //  盤に重ねる知らせ：つまんで動かす／近づいたら逃げる（利用者指示）
  // ══════════════════════════════════════════════
  (function initMsgBar() {
    const bar = $('msg-bar'), grip = $('msg-grip'), pane = $('board-pane');
    if (!bar || !grip || !pane) return;
    // 前に動かした場所を覚えている。窓の大きさが変わっても効くよう、割合で持つ
    try {
      const raw = localStorage.getItem(MSG_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && isFinite(p.x) && isFinite(p.y)) S.msgPos = p; }
    } catch (e) {}

    let d = null;
    /** 盤の枠から見た、いまの左上の位置 */
    const barPos = () => {
      const r = bar.getBoundingClientRect(), c = pane.getBoundingClientRect();
      return { l: r.left - c.left, t: r.top - c.top };
    };
    grip.addEventListener('pointerdown', e => {
      const at = barPos();
      d = { x: e.clientX, y: e.clientY, l: at.l, t: at.t, moved: false };
      bar.classList.add('dragging');
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', e => {
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      const w = bar.offsetWidth, h = bar.offsetHeight;
      const l = clamp(d.l + dx, 4, Math.max(4, pane.clientWidth - w - 4));
      const t = clamp(d.t + dy, 4, Math.max(4, pane.clientHeight - h - 4));
      // 覚えるのは「割合」。中央そろえの分（幅の半分）を足して中心の位置にする
      S.msgPos = { x: (l + w / 2) / Math.max(1, pane.clientWidth), y: t / Math.max(1, pane.clientHeight) };
      S.msgDodge = false;                   // つまんでいる間は逃げない
      layoutMsgBar();
      e.preventDefault(); e.stopPropagation();
    });
    const done = e => {
      if (!d) return;
      /*
       * ★**動かさずに離したら、元の位置へ戻す。**
       * つまみを押しただけで戻るので、「2回押す」を覚えなくてよい。
       * 動かした場合だけ、その場所を覚える。
       */
      if (!d.moved) S.msgPos = null;
      d = null;
      bar.classList.remove('dragging');
      try { localStorage.setItem(MSG_KEY, S.msgPos ? JSON.stringify(S.msgPos) : ''); } catch (err) {}
      layoutMsgBar();
      if (e) e.stopPropagation();
    };
    grip.addEventListener('pointerup', done);
    grip.addEventListener('pointercancel', done);

    /*
     * ★**近づいたら反対側へ逃げる。**
     * 知らせ本体は指も矢印も素通りする（pointer-events:none）ので、
     * 重なりは**盤の上の座標で自分で測る**。こうすると、逃げる仕掛けを足しても
     * 盤をなぞる操作は1つも変わらない。
     */
    pane.addEventListener('pointermove', e => {
      if (d) return;
      const c0 = cv.getBoundingClientRect();
      const hit = msgHovered(e.clientX - c0.left, e.clientY - c0.top);
      if (hit !== !!S.msgDodge) { S.msgDodge = hit; layoutMsgBar(); }
    });
    pane.addEventListener('pointerleave', () => {
      if (S.msgDodge) { S.msgDodge = false; layoutMsgBar(); }
    });
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
    // 残っているのが自分だけなら確認せず即やり直す（10.8.5節）。抜けた人には訊きようがない
    if (RU.activeCount(g) <= 1) { redoRack(); return; }
    if (S.net.on) NET.send({ k: 'dl-open' });
    openDeadlockVote();
  }
  function openDeadlockVote() {
    // 抜けた席には訊かない。当事者ではないので票も持たない
    const g = S.game;
    if (S.net.on && g && S.net.myIdx >= 0 && g.players[S.net.myIdx]
      && g.players[S.net.myIdx].retired) return;
    S.dlVotes = {};
    openConfirm(t('dl.title'), t('dl.ask'),
      () => { if (!S.net.on) { redoRack(); return; } castVote(true); },
      // ★断られたら**続きを始める**。ここで何もしないと対局が固まる（実機で出た不具合）
      () => { if (!S.net.on) { setMsg(t('dl.refused')); beginTurn(); return; } castVote(false); });
  }
  function castVote(ok) {
    if (S.net.on && S.net.myIdx < 0) return;   // 席を持たない者は投票しない
    setMsg(ok ? t('dl.wait') : t('dl.refused'));
    if (S.net.isHost) tallyVote(S.net.myIdx, ok);
    else NET.send({ k: 'dl-vote', ok, idx: S.net.myIdx }, 'host');
  }
  function tallyVote(idx, ok) {
    if (!S.net.isHost || !S.game) return;
    // 数えるのは対局者の票だけ。席の外から届いた票は捨てる。
    // 断りの票は1枚で全員のやり直しを取り消せるので、ここを開けておくと
    // 観戦者が対局に口を出せてしまう
    if (!(idx >= 0 && idx < S.game.players.length)) return;
    S.dlVotes = S.dlVotes || {};
    S.dlVotes[idx] = ok;
    if (!ok) {
      /*
       * **やり直しに賛成しなかった者は離脱として扱う**（10.8.4節 手順3）。
       * 拒みつつ進行もしない選択を認めると、対局が永久に終わらなくなる。
       * 膠着を解く手段は必ず残しておく必要がある、というのが規定の趣旨である。
       * 残ったのが1チームだけになれば、その勝ちで終局する（同 手順4）。
       */
      NET.send({ k: 'dl-cancel' });
      setMsg(t('dl.refused'));
      S.dlVotes = {};
      retireSeat(idx, 'dl');
      return;
    }
    // 抜けた席の返事は永久に来ない。数えるのは残っている席だけ
    for (let i = 0; i < S.game.players.length; i++) {
      if (S.game.players[i].retired) continue;
      if (!S.dlVotes[i]) return;
    }
    NET.send({ k: 'dl-redo' });
    S.dlVotes = {};
    redoRack();
  }
  function redoRack() {
    const g = S.game;
    g.redoCount++;
    // 席の正体（参加者ID）も一緒に配り直す。ここで落とすと、組み直したあとに
    // 追いつき直そうとした人が自分の席を見失う
    // 抜けた人はやり直しても戻らない。離脱の印も一緒に配り直す（9.8.3節）
    const players = g.players.map(p => ({
      name: p.name, type: p.type, pid: p.pid || null, retired: !!p.retired,
    }));
    startGame(g.seed, players, null);       // シードは引き継ぐ（10.8.6節）
  }

  // ══════════════════════════════════════════════
  //  デモ（?debug=1 のときだけ出る）
  // ══════════════════════════════════════════════
  /*
   * ナインボールのブレイクで9番を一発で落として見せる。
   * **決め打ちの5値は置かない。** 物理の係数や撞球の癖の設定が変われば
   * 同じ撞き方でも落ちる玉が変わるので、その場の設定で試し撞きして探す。
   * 探し方は「真っすぐ」から左右へ広げる順（実測でだいたい 6〜45 回で見つかる）。
   * 見つけた1本は、人が撞くときとまったく同じ手順で撞かせる。
   */
  const DEMO_BACK = 40;                     // ヘッドストリングからどれだけ手前へ置くか
  const DEMO_MOVE = 800, DEMO_STANCE = 1500, DEMO_PULL = 750;   // 各段にかける時間（ミリ秒）
  /**
   * デモを仕込む。**この時点ではまだ何も動かさない。**
   * 撞き方が決まる前に手玉を動かし始めると、探しているあいだ画面が止まって見え、
   * 途中経過を出せば「デモ」ではなく「計算の実況」になる。
   */
  function startDemo() {
    if (S.demo) return;
    S.cfg.rule = 'G-01'; S.cfg.format = 'local'; S.cfg.players = 2; S.cfg.coop = false;
    startGame(newSeed(), null, null);
    const g = S.game;
    const cue = RU.cueBallOf(g, 0); if (!cue) return;
    const px = g.table.headSpot.x - DEMO_BACK, py = g.table.headSpot.y;
    // 撞く場所での角度を先に出す。**盤の玉は動かさない**（1コマも見せずに戻す）
    const ox = cue.x, oy = cue.y;
    cue.x = px; cue.y = py;
    computeElevFan(cue);
    cue.x = ox; cue.y = oy;
    const cands = [];
    const powers = [0.90, 1.00, 1.10, 0.80];
    for (let k = 0; k <= 80; k++) {
      for (const sg of (k === 0 ? [1] : [-1, 1])) {
        for (const pw of powers) cands.push({ dir: sg * k * 0.0015, power: pw });
      }
    }
    S.demo = {
      stage: 'search', i: 0, cands, px, py, t0: 0, shot: null,
      from: { x: S.placePos.x, y: S.placePos.y },
    };
  }

  /**
   * デモを1コマ進める。**主ループから呼ぶ**。
   * 段ごとに別々の待ち行列を作ると、どこか1つが途切れたときに
   * 「途中で終わったのに誰も気づかない」ことになる。進める場所を1つにする。
   */
  function stepDemo(now) {
    const d = S.demo, g = S.game;
    if (!g || g.over) { S.demo = null; return; }
    const cue = RU.cueBallOf(g, 0);
    if (!cue) { S.demo = null; return; }

    if (d.stage === 'search') {
      // 1回の試し撞きが1コマぶんより重いので、1コマに1回だけ進める。
      // 見つかるまでは画面に何も出さない＝デモはまだ始まっていない
      const c = d.cands[d.i++];
      const shot = { dir: c.dir, power: c.power, tipX: 0, tipY: 0, elev: minElevFor(c.dir) };
      if (demoTry(g, cue, shot, d.px, d.py)) { d.shot = shot; d.stage = 'place'; d.t0 = now; }
      else if (d.i >= d.cands.length) { S.demo = null; setMsg(t('ph.demoFail')); }
      return;
    }

    if (d.stage === 'place') {              // ① 手玉を置く
      const k = Math.min(1, (now - d.t0) / DEMO_MOVE);
      const e = k * k * (3 - 2 * k);        // 動き出しと止まりを滑らかに
      S.placePos = { x: d.from.x + (d.px - d.from.x) * e, y: d.from.y + (d.py - d.from.y) * e };
      S.aimDirty = true;
      if (k >= 1) {                         // ②「ここに置く」を押したのと同じ処理
        RU.place(cue, d.px, d.py);
        g.ballInHand = false;
        S.pendingPlace = { x: d.px, y: d.py };
        computeElevFan(cue); autoElev();
        S.aim.dir = d.shot.dir;
        S.phase = 'stance'; setMsg(t('ph.cue'));
        d.stage = 'stance'; d.t0 = now;
      }
      return;
    }

    if (d.stage === 'stance') {             // ③ 構えながら向きを少し左右に直す
      const el = now - d.t0;
      const k = 1 - Math.min(1, el / DEMO_STANCE);
      S.aim.dir = d.shot.dir + Math.sin(el / 140) * 0.024 * k;
      S.aimDirty = true;
      if (el >= DEMO_STANCE) { S.aim.dir = d.shot.dir; d.stage = 'pull'; d.t0 = now; }
      return;
    }

    if (d.stage === 'pull') {               // ④ キューを引いて撞く
      const k = Math.min(1, (now - d.t0) / DEMO_PULL);
      S.aim.power = d.shot.power * k;
      if (k >= 1) {
        S.aim.power = 0;
        S.demo = null;
        const place = S.pendingPlace; S.pendingPlace = null;
        fireShot(d.shot, place, true);
      }
      return;
    }
    S.demo = null;
  }

  /** その撞き方で「9番が落ちて手玉は落ちない」か。盤には触らず、写しの上で試す */
  function demoTry(g, cue, shot, px, py) {
    const w = E.cloneWorld(g.world);
    const c = w.balls.find(b => b.id === cue.id); if (!c) return false;
    c.x = px; c.y = py; c.z = 0;
    c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
    E.applyCue(c, shot);
    E.runShot(w, 14);
    const byId = {}; w.balls.forEach(b => byId[b.id] = b);
    let nine = false, bad = false;
    for (const ev of w.events) {
      if (ev.type === 'pocket') {
        const b = byId[ev.ball];
        if (b && b.kind === 'cue') bad = true;
        if (b && b.num === 9) nine = true;
      } else if (ev.type === 'offtable') bad = true;
    }
    return nine && !bad;
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
    // 長軸を画面の縦方向へ（4.10.1節）。枠（クッションの厚み）まで含めて収める。
    // 拡大率は外接矩形から決める（3.2.4節）。面積は揃っていても外接矩形は形ごとに違うので、
    // 台の寸法を決め打ちにすると六角形以降で画面から溢れる
    const frame = 95;                        // クッションと外枠のぶん（mm 換算の余裕）
    const tb = S.game ? S.game.table : null;
    const bw = (tb ? tb.halfW : T.HX) * 2, bh = (tb ? tb.halfH : T.HY) * 2;
    const outerW = bh + frame * 2, outerH = bw + frame * 2;
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

  /**
   * 台の外周（プレイ面）を画面上の輪郭としてなぞる。
   * クロスも枠も置ける範囲も、この1本の輪郭から作る。
   */
  function tablePath(table) {
    const trace = o => {
      const p0 = toScreen(o[0].x, o[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < o.length; i++) { const p = toScreen(o[i].x, o[i].y); ctx.lineTo(p.x, p.y); }
      ctx.closePath();
    };
    ctx.beginPath();
    trace(table.outline);
    /*
     * ドーナツ型の中央の島は、この輪郭の「穴」である（3.7節の内側境界要素列）。
     * 同じ道すじに輪をもう1つ足し、塗りと切り抜きは 'evenodd' で数える。
     * 輪が1つの台では 'evenodd' でも結果は変わらない。
     */
    if (table.innerOutline) trace(table.innerOutline);
  }

  /**
   * 外周をなぞる木の枠（長方形以外の台）。
   * 太い線で輪郭をなぞると、外側へ半分はみ出したぶんが枠の帯になる。
   */
  function drawFramePoly(table, thick) {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, view.w, view.h);
    g.addColorStop(0, '#4a2a15'); g.addColorStop(.28, '#6b3d1f');
    g.addColorStop(.52, '#8a5228'); g.addColorStop(.76, '#5e3319'); g.addColorStop(1, '#3d2211');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    tablePath(table); ctx.strokeStyle = g; ctx.lineWidth = thick * 2; ctx.stroke();
    // 上面の光。帯の真ん中より少し外を細く走らせる
    ctx.globalAlpha = .45;
    tablePath(table); ctx.strokeStyle = 'rgba(255,220,180,.35)';
    ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
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

  /*
   * 番号の下地の白い丸の半径。
   *
   * 白い丸には「最低 5px」という下限がある（4.2.4節の視認性の措置）。玉が小さい台では
   * この下限が縮まないので、丸が玉をほとんど覆ってしまい、玉の色が見えなくなる。
   * 玉の絵は中心から外へ向かうグラデーションで、本来の色が出るのは半径の 0.72 倍あたりなので、
   * 丸がそこを超えると、残るのは縁の暗く落とした部分だけになる。
   *
   * 下限は残したまま、丸を玉の 0.60 倍で頭打ちにして、色の帯を必ず残す。
   * 字も丸の直径を超えないところまで一緒に小さくする（呼ぶ側で掛ける）。
   *
   * ★盤の上の玉と、脇に並べる玉の2か所で同じ決まりを使うので、ここ1か所に置く。
   *   片方だけ直すと、もう片方で同じ症状が残る。
   */
  const NUM_DISC_MAX = 0.60;
  function numberDisc(r, ratio) {
    return Math.min(Math.max(5, r * ratio), r * NUM_DISC_MAX);
  }

  function drawBall2D(b, s, alpha) {
    const p = toScreen(b.x, b.y);
    const r0 = b.r * s;
    /*
     * 真上から見た絵では、高さは影との離れ具合でしか分からない。
     * 高いほど玉を大きく描いて（最大2倍）、こちらへ近づいて見えるようにする。
     */
    const r = r0 * (1 + Math.min(1, (b.z || 0) / 320));
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    const lift = b.z * s;
    // 影は地面に残す。大きくすると玉と一緒に浮いて見えてしまう
    ctx.beginPath(); ctx.ellipse(p.x + r0 * .18, p.y + r0 * .22, r0 * .95, r0 * .95, 0, 0, 7);
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
    // 縞を塗ったあとに描く。先に描くと、ストライプの玉では輪が塗りつぶされる
    strokeOwnerRing(b, bx, by, r);
    const pole = rotV(b, 0, 0, 1);
    if (pole.z > -0.2) {
      ctx.beginPath();
      ctx.arc(bx + pole.y * r * .62, by - pole.x * r * .62, Math.max(1.1, r * .17), 0, 7);
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();
    }
    if (b.num) {
      const disc = numberDisc(r, .5);
      const fs = Math.min(Math.max(8, Math.min(r * 1.0, 13)), disc * 2);
      ctx.beginPath(); ctx.arc(bx, by, disc, 0, 7);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '700 ' + fs + 'px "Noto Sans JP",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(b.num), bx, by + .5);
    }
    ctx.restore();
  }

  /**
   * サバイバルの右側の表示（7.8.2節「残数の表示は常時」）。
   * 割り当て前は「まだ決まっていない」、脱落したら「脱落」、それ以外は
   * **受け持ちの番号と残り個数**を出す。番号を出すのは、3人以上では
   * 自分の玉が番号でしか分かれないためである。
   */
  function survivalHudText(g, p) {
    if (p.out) return t('hud.svOut');
    const left = RU.survivalLeft(g, p.idx);
    if (left == null) return t('hud.open');
    const sv = g.survival;
    const nums = (sv && sv.groups[p.group]) || [];
    const range = nums.length ? nums[0] + '–' + nums[nums.length - 1] : '';
    return range + '  ' + t('hud.svLeft', { n: left });
  }

  /**
   * サバイバルで、その玉の持ち主の色（7.8.2節「色で区別する」）。
   * 無所属・持ち主が決まる前・別のルールでは null。
   */
  function ownerColor(b) {
    const g = S.game;
    if (!g || g.rule !== 'G-08' || !g.survival || !g.survival.assigned) return null;
    if (b.kind !== 'object' || !(b.grp >= 0)) return null;
    const seat = g.survival.owner[b.grp];
    if (!(seat >= 0)) return null;
    return RU.SURVIVAL_COLORS[seat % RU.SURVIVAL_COLORS.length];
  }
  /**
   * 持ち主の輪。**玉の縁のすぐ内側に描く。**
   *
   * ★最初は玉の外側（ラシャの上）に描いた。玉の地色と喧嘩しない利点はあるが、
   *   **15球をラックに組むと隣の玉と重なり、しかも細すぎて見えなかった**
   *   （実測：玉1個あたり11ピクセル）。玉は15個も並ぶと1個が小さく、
   *   外側に足す余白そのものが無い。内側なら重ならず、太さも玉の大きさに比例して取れる。
   *
   * 地色と同じ色になる組合せ（黄の玉に黄の輪など）があるので、
   * **色の帯の内側に暗い線を1本敷いて**、どの地色でも帯の境目が立つようにする。
   */
  function strokeOwnerRing(b, x, y, r) {
    const col = ownerColor(b);
    if (!col) return;
    ctx.save();
    ctx.lineWidth = Math.max(1, r * .34);
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.arc(x, y, r * .80, 0, 7); ctx.stroke();
    ctx.lineWidth = Math.max(1.2, r * .26);
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * .83, 0, 7); ctx.stroke();
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
    if (table.frameStyle === 'rect') {
      drawFrame(a.x - thick, a.y - thick, (b.x - a.x) + thick * 2, (b.y - a.y) + thick * 2, thick);
    } else {
      drawFramePoly(table, thick);
    }
    // クロス。長方形では外周の4頂点＝外接矩形なので、第1段階と同じ塗りになる
    const cg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    cg.addColorStop(0, '#17573f'); cg.addColorStop(.45, '#0f3d2e'); cg.addColorStop(1, '#0b2e22');
    tablePath(table);
    ctx.fillStyle = cg; ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    // 陣取りの塗り（7.7.2節）。クロスの上・玉の下に敷く
    if (g.rule === 'G-06' && g.territory) drawTerritory();
    // カーリング型の目標円とホグ円（7.9.2節）。同じくクロスの上・玉の下
    if (g.rule === 'G-09' && g.curling) drawHouse();
    // ボウリング型の「動いた跡」（利用者指示）。クロスの上・玉の下に敷く
    if (g.rule === 'G-11' && g.bowling && g.bowling.moves) drawBowlMoves();
    // ダイヤ（レール上の目印）。位置は外周の辺から決まる（形ごとの並べ書きはしない）
    ctx.fillStyle = 'rgba(255,240,215,.55)';
    const off = thick / s * .5;                 // 枠の帯の真ん中まで外へ出す
    for (const d of T.diamonds(table)) {
      const q = toScreen(d.x + d.nx * off, d.y + d.ny * off);
      ctx.beginPath(); ctx.moveTo(q.x, q.y - 3.4); ctx.lineTo(q.x + 2.6, q.y); ctx.lineTo(q.x, q.y + 3.4); ctx.lineTo(q.x - 2.6, q.y); ctx.fill();
    }

    for (const p of table.pockets) drawPocket(p, s);

    // ヘッドストリングとフットスポット。線は外周の中だけに出す
    if (table.hasPockets) {
      ctx.save();
      tablePath(table); ctx.clip('evenodd');
      const kx = (table.kitchenX != null) ? table.kitchenX : table.headSpot.x;
      const h1 = toScreen(kx, -table.halfH), h2 = toScreen(kx, table.halfH);
      ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y);
      ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
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
    drawTurnFlash();

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

    if ((S.phase === 'aim' || S.phase === 'stance') && isMyTurn()) drawAimTargetMark();
    drawBursts();
    drawPocketedRails();
    drawDroppedFlash();
    fadeBoardOverlays(view.mobile);   // 盤面に重ねた表示を、狙いにかぶるぶんだけ薄くする
    if (S.elevAdjusting) drawElevOverlay();
  }

  /**
   * ★ボウリング型で、**ピンが一投でどこからどこへ動いたか**を盤に描く（利用者指示）。
   *
   * このルールの「倒れた」は**並べ直した位置からの移動距離**で決まる（7.11.3節）。
   * 2Dの盤に転倒する絵が無いぶん、**その距離そのものを見せる**のが説明になる。
   *
   *   ・**玉は元の位置に戻さず、止まった場所に置いたまま描く**（利用者指示）。
   *     倒れた玉は盤から取り除かれているので、ここで薄い玉として置き直す。
   *     残った玉は盤にそのままあるので、線だけを引く。
   *   ・**倒れた＝灰色／残った＝橙**（利用者指示）
   *   ・**移動量は行き先のそば**に出す。線の真ん中に出すと、10本ぶんの線が
   *     狭い三角形から放射状に伸びるので**数字どうしが重なって読めない**（実機の指摘）。
   *
   * ★**元の位置には何も置かない。**丸を描くと「玉が元の場所に戻った」ように見える。
   */
  const BOWL_MOVE_MIN = 3;      // これ未満しか動いていない玉には線を引かない（mm）
  const BOWL_DOWN_COLOR = 'rgba(148,163,184,';   // 倒れた＝灰色
  const BOWL_STAY_COLOR = 'rgba(251,146,60,';    // 残った＝橙
  function drawBowlMoves() {
    const g = S.game, mv = g.bowling.moves, s = view.s;
    if (!mv || !mv.length) return;
    ctx.save();
    tablePath(g.table); ctx.clip('evenodd');
    /*
     * ★**線だけを引く。数字は書かない**（利用者指示）。
     *   10本ぶんの数字は狭い三角形のまわりで重なって読めない。
     *   何本倒れたかは、そばのボックス（ピンの状態）とスコアシートが受け持つ。
     *
     * ★**灰色（倒れた）を先に、橙（残った）をあとに引く。**
     *   残った玉の線は「まだそこにある玉」を指しているので、重なったときに
     *   隠れてはいけない（利用者指示）。
     */
    for (const pass of [0, 1]) {
      const wantDown = (pass === 0);
      for (const m of mv) {
        if (m.dist < BOWL_MOVE_MIN) continue;
        if (m.down !== wantDown) continue;
        const p0 = toScreen(m.x0, m.y0), p1 = toScreen(m.x1, m.y1);
        const col = m.down ? BOWL_DOWN_COLOR : BOWL_STAY_COLOR;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.lineWidth = 2;
        ctx.strokeStyle = col + '.95)';
        ctx.stroke();
        // 出発点は小さな点だけ。玉に見える大きさにしない
        ctx.beginPath(); ctx.arc(p0.x, p0.y, Math.max(1.4, 2.4 * s), 0, 7);
        ctx.fillStyle = col + '.9)'; ctx.fill();
      }
    }
    /*
     * ★**倒れた玉そのものは描かない**（利用者指示）。
     *   盤から取り除かれた玉を置き直すと「まだそこにある」ように見える。
     *   どこへ行ったかは線の先が示しており、何番が倒れたかは
     *   そばの「ピンの状態」のボックスが受け持つ。
     */
    ctx.restore();
  }

  /**
   * ★**ピンの状態を、初期配置の形のボックスで出す**（利用者指示）。
   *
   * 盤の上の玉は投げるたびに散らばるので、**何番が倒れて何番が残っているか**は
   * 盤を見ても読み取れない。現実のボウリングの「ピンの絵」と同じものを別に置く。
   *
   *   倒れたピン … 灰色の丸（番号は出さない。もう狙う相手ではない）
   *   残ったピン … 番号の入った玉
   *
   * ★**投げる人から見た並び**にする。手前（下）が1番、いちばん奥（上）が 7-8-9-10。
   *   盤の向きと同じにしないと、左右の残り方を読み替えることになる。
   */
  function bowlPinsHTML(g) {
    const st = g.bowling && g.bowling.pinState;
    if (!st || !st.length) return '';
    const R = 9, GX = 23, GY = 20, PAD = 3;
    const W = GX * 4 + PAD * 2, H = GY * 3 + R * 2 + PAD * 2;
    const byPin = {};
    st.forEach(v => { byPin[v.pin] = v; });
    let h = '<svg class="bpins" viewBox="0 0 ' + W + ' ' + H + '">';
    let k = 0;
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i <= row; i++) {
        const v = byPin[k++]; if (!v) continue;
        const cx = W / 2 + (i - row / 2) * GX;
        const cy = PAD + R + (3 - row) * GY;      // 手前（1番）を下に置く
        if (v.down) {
          // 倒れたピンは**塗りつぶした灰色の丸**（利用者指示）。番号は出さない
          h += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (R - 1)
            + '" fill="#5b6675"/>';
        } else {
          h += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + R
            + '" fill="' + RU.BOWL_PIN_COLOR + '"/>'
            + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (R * .62)
            + '" fill="#ffffff"/>'
            + '<text x="' + cx.toFixed(1) + '" y="' + (cy + 3.2).toFixed(1) + '"'
            + ' text-anchor="middle" font-size="9" font-weight="700" fill="#111">'
            + v.num + '</text>';
        }
      }
    }
    return h + '</svg>';
  }

  /**
   * 陣取りの塗り（7.7.2節・7.7.3節）。
   *
   * **塗られていない有効マスも、ごく薄く明るくする。**塗れる場所と塗れない場所の
   * 境目が見えないと、外周ぎわで走らせても点にならない理由が分からない（7.7.3節）。
   */
  function drawTerritory() {
    const g = S.game, tt = g.territory, gr = tt.grid;
    ctx.save();
    tablePath(g.table); ctx.clip('evenodd');
    const cell = (ix, iy) => {
      const p0 = toScreen(gr.x0 + ix * gr.cw, gr.y0 + iy * gr.ch);
      const p1 = toScreen(gr.x0 + (ix + 1) * gr.cw, gr.y0 + (iy + 1) * gr.ch);
      // 1px ぶん重ねる。ぴったりに切ると継ぎ目に地の色の線が残る
      ctx.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y),
        Math.abs(p1.x - p0.x) + 1, Math.abs(p1.y - p0.y) + 1);
    };
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    gr.valid.forEach(c => { if (!tt.paint.has(c)) cell(c % gr.nx, Math.floor(c / gr.nx)); });
    // 塗りは薄く敷く。濃くすると同じ色の玉が塗りに埋もれて、盤面が読めなくなる
    ctx.globalAlpha = 0.30;
    tt.paint.forEach((owner, c) => {
      ctx.fillStyle = RU.TERRITORY_COLORS[owner % RU.TERRITORY_COLORS.length];
      cell(c % gr.nx, Math.floor(c / gr.nx));
    });
    ctx.restore();
  }

  /**
   * カーリング型の盤面（7.9.2節・7.9.3節）。
   *
   * **同心円は現実のカーリングと同じ4本**（12/8/4フィートとボタン）にする。
   * D357 が退けたのは「帯ごとに点数を変えること」であって、描くことではない。
   * **現実でも帯で点数は変わらず、輪は距離を目で測るための目印**である。
   * 得点が中心からの距離だけで決まる本ルールでは、輪があったほうが読みやすい。
   *
   * ホグ円は点線で薄く出す。**得点には関わらないが、外で止まると玉が消える**ので、
   * 見えないと何が起きたのか分からない。
   */
  function drawHouse() {
    const g = S.game, L = g.curling.layout, s = view.s;
    const c = toScreen(L.center.x, L.center.y);
    ctx.save();
    tablePath(g.table); ctx.clip('evenodd');
    // ── ホグ円。ここより外で止まった玉は取り除かれる
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = Math.max(1, 1.6 * s);
    ctx.beginPath(); ctx.arc(c.x, c.y, L.hog * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    // ── ハウス。外から順に塗り重ねる。ラシャの緑の上で読める濃さに留める
    const RING = ['rgba(80,150,255,.30)', 'rgba(245,245,245,.26)', 'rgba(225,60,60,.34)', 'rgba(245,245,245,.40)'];
    L.rings.forEach((k, i) => {
      ctx.beginPath(); ctx.arc(c.x, c.y, L.radius * k * s, 0, 7);
      ctx.fillStyle = RING[i]; ctx.fill();
    });
    ctx.beginPath(); ctx.arc(c.x, c.y, L.radius * s, 0, 7);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, 1.8 * s); ctx.stroke();
    // ── 投球位置。ここに次の玉が置かれる
    const tp = toScreen(L.throwPos.x, L.throwPos.y);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = Math.max(1, 1.4 * s);
    const r = T.R * s;
    ctx.beginPath(); ctx.arc(tp.x, tp.y, r * 1.5, 0, 7); ctx.stroke();
    ctx.restore();
  }

  /**
   * 陣取り：手番が変わった直後に、これから撞く人の色の玉を数回光らせる。
   *
   * **白い輪を明滅させる。**玉そのものを明滅させると、同じ色の塗りの上では
   * 消えた瞬間に見失う。輪なら塗りの色と喧嘩しない。
   *
   * **時間で進める**（コマ数ではない）。遅い端末でだけ長く光ることがないようにする。
   * 用が済んだら控えごと消す。残しておくと、次の手番が早く始まったときに
   * 前の知らせが出たままになる。
   */
  const FLASH_SEC = 1.35, FLASH_TIMES = 3;
  function drawTurnFlash() {
    const g = S.game, f = S.flash;
    if (!f || !g || g.rule !== 'G-06') return;
    const el = (performance.now() - f.t0) / 1000;
    if (el > FLASH_SEC) { S.flash = null; return; }
    const a = Math.sin(el / FLASH_SEC * Math.PI * FLASH_TIMES);
    if (a <= 0.02) return;
    const s = view.s;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.6, 3.2 * s);
    for (const b of g.world.balls) {
      if (b.kind !== 'object' || b.state !== 'live' || b.owner !== f.seat) continue;
      const p = toScreen(b.x, b.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, b.r * s + Math.max(2, 5 * s), 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 玉を1つ、好きな場所に好きな大きさで描く（落ちた玉の一覧・中央の知らせ用）。
   * 盤上の玉と同じ見た目にする＝どの玉が落ちたのか、絵で分かるようにするため。
   */
  function drawBallIcon(x, y, r, color, stripe, num, dim) {
    ctx.save();
    if (dim) ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(x + r * .16, y + r * .2, r * .95, r * .95, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    const g = ctx.createRadialGradient(x - r * .38, y - r * .42, r * .08, x, y, r * 1.06);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.20, shade(color, 1.28));
    g.addColorStop(.72, color); g.addColorStop(1, shade(color, .42));
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = g; ctx.fill();
    if (stripe) {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillRect(x - r, y - r, r * 2, r * .42);
      ctx.fillRect(x - r, y + r * .58, r * 2, r * .42);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1, r * .07); ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    if (num) {
      const disc = numberDisc(r, .52);
      ctx.beginPath(); ctx.arc(x, y, disc, 0, 7);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '700 ' + Math.min(Math.max(8, r * .78), disc * 2) + 'px "Noto Sans JP",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(num), x, y + r * .04);
    }
    ctx.restore();
  }
  function drawBallOf(b, x, y, r, dim) { drawBallIcon(x, y, r, b.color, b.stripe, b.num, dim); }

  /** 落ちた玉（手玉も含む）。番号順。手玉は先頭 */
  function pocketedBalls(g) {
    return g.world.balls
      .filter(b => b.state === 'pocketed' || b.state === 'gone')
      /*
       * ★カーリング型は**まだ投げていない持ち球も盤に出ていない**（state='gone'）。
       * 状態だけで数えると、**始まった瞬間に持ち球が全部「落ちた玉」として台の脇に並ぶ**。
       * 「盤にいない」と「失った」は別物なので、投げた印で分ける。
       */
      .filter(b => b.stone == null || b.thrown)
      /*
       * ★**ボウリング型のピンは台の脇に並べない**（利用者指示）。
       * 「落ちた玉を脇に並べる」のはビリヤードの見せ方であって、
       * ボウリングでは玉がピットへ落ちること自体に意味が無い。倒れた本数と
       * どの番号が残っているかは、そばの「ピンの状態」のボックスが受け持つ。
       */
      .filter(b => b.pin == null)
      .sort((a, b) => (a.kind === 'cue' ? -1 : 0) - (b.kind === 'cue' ? -1 : 0) || (a.num - b.num));
  }

  /**
   * 「自分」の側。通信対戦は自分の席、そうでなければ人が持っている先頭の席。
   * 手番ごとに左右が入れ替わると、どちらが自分か分からなくなる。
   */
  function viewerIdx() {
    const g = S.game;
    if (S.net.on && S.net.myIdx >= 0) return S.net.myIdx;
    const h = g.players.findIndex(p => p.type === 'human');
    return h < 0 ? 0 : h;
  }

  /**
   * 落ちた玉を台の左右に並べる。
   * エイトボールは担当が分かれるので、相手のぶんを左・自分のぶんを右に置く。
   * それ以外のルールは担当が無いので右にまとめる。
   */
  function drawPocketedRails() {
    const g = S.game, table = g.table;
    const dropped = pocketedBalls(g).filter(b => b.kind !== 'cue');
    if (!dropped.length) return;
    const thick = 34 * view.s + 10;
    const edge = table.halfH * view.s + thick;
    const r = Math.max(7, Math.min(13, view.h * 0.018));
    const gap = r * 2.35;
    const room = Math.max(90, view.h - 40);
    const maxN = Math.max(3, Math.floor(room / gap));

    let left = [], right = [];
    if (g.rule === 'G-02') {
      const mine = g.players[viewerIdx()] ? g.players[viewerIdx()].group : null;
      dropped.forEach(b => {
        const grp = RU.groupOf(b.num);
        if (grp == null) right.push(b);                       // 8番はどちらでもない
        else if (mine && grp === mine) right.push(b);
        else if (mine) left.push(b);
        else right.push(b);                                   // 担当が決まる前
      });
    } else right = dropped;

    /*
     * 台の外に置き場が無いとき（携帯は横幅がぎりぎり）は、枠の上に重ねる。
     * 「入らないから描かない」にすると、携帯では落ちた玉が一切見えなくなる。
     */
    const column = (list, sign) => {
      if (!list.length) return;
      const want = view.cx + sign * (edge + r + 8);
      const x = clamp(want, r + 3, view.w - r - 3);
      const over = Math.abs(x - want) > 1;                    // 枠に重ねている
      const n = Math.min(list.length, maxN);
      let y = view.cy - (n - 1) * gap / 2;
      if (over) {                                             // 重ねるときは下敷きを敷く
        ctx.save();
        roundRect(x - r - 3, y - r - 5, r * 2 + 6, (n - 1) * gap + r * 2 + 10, r);
        ctx.fillStyle = 'rgba(10,10,10,.55)'; ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < n; i++) { drawBallOf(list[i], x, y, r, true); y += gap; }
    };
    column(left, -1);
    column(right, 1);
  }

  /**
   * 撞き終わって玉が止まったあと、いま落ちた玉を盤の真ん中に大きく出す。
   * 何が落ちたのかは、小さい玉が消えるのを目で追うだけでは分からない。
   * すでに落ちている玉も下に小さく並べて、全体の進み具合が見えるようにする。
   */
  const DROP_SHOW_MS = 2400;
  function drawDroppedFlash() {
    const g = S.game, d = S.dropped;
    if (!d || !d.balls.length) return;
    const age = performance.now() - d.at;
    if (age > DROP_SHOW_MS) { S.dropped = null; return; }
    const fade = age > DROP_SHOW_MS - 400 ? (DROP_SHOW_MS - age) / 400 : 1;

    const big = Math.max(18, Math.min(34, view.w * 0.055));
    const small = Math.max(8, big * 0.42);
    const n = d.balls.length;
    const w = Math.max(150, n * big * 2.5 + 44);
    const prev = d.prev.slice(0, Math.floor((w - 30) / (small * 2.3)));
    const h = big * 2.5 + (prev.length ? small * 2.6 : 0) + 34;
    const x = view.cx - w / 2, y = view.cy - h / 2;

    ctx.save();
    ctx.globalAlpha = fade;
    roundRect(x, y, w, h, 12);
    ctx.fillStyle = 'rgba(10,10,10,.86)'; ctx.fill();
    ctx.strokeStyle = 'rgba(251,146,60,.75)'; ctx.lineWidth = 2; ctx.stroke();

    ctx.font = '11px "Noto Sans JP",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText(t('drop.title'), view.cx, y + 8);

    let bx = view.cx - (n - 1) * big * 1.25;
    const by = y + 26 + big;
    for (const b of d.balls) { drawBallOf(b, bx, by, big); bx += big * 2.5; }

    if (prev.length) {
      ctx.font = '10px "Noto Sans JP",sans-serif'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      const ly = by + big + 6;
      ctx.fillText(t('drop.already'), x + 14, ly);
      let px = x + 14 + small;
      const py = ly + small + 12;
      for (const b of prev) { drawBallOf(b, px, py, small, true); px += small * 2.3; }
    }
    ctx.restore();
  }

  /**
   * ジャンプした玉が落ちてきた場所に、弾ける印を出す。
   * 玉が跳ねたことは、真上から見た2Dの絵では影の大きさでしか分からない。
   * 「米」の字のように四方八方へ線を散らして、どこへ落ちたかを一目で示す。
   */
  /** いちばん高いところにいる玉の高さ */
  function highestBall(world) {
    let hi = 0;
    for (const b of world.balls) if (b.state === 'live' && b.z > hi) hi = b.z;
    return hi;
  }

  /**
   * 飛んで着地した玉を見つけて、音と弾ける絵を出す。
   * 物理側の着地の知らせは跳ね返りが強いときしか出ないので、
   * ふわりと落ちた場合も拾えるよう、玉の高さの移り変わりから自分で見る。
   * 跳ねた高さを覚えておき、それを音と絵の大きさにする。
   */
  function watchJumps() {
    const g = S.game; if (!g) return;
    const air = S.airZ || (S.airZ = {});
    for (const b of g.world.balls) {
      if (b.state !== 'live') { delete air[b.id]; continue; }
      const rec = air[b.id];
      if (b.z > JUMP_Z) {
        if (!rec) {
          /*
           * 飛び立った瞬間。ここで「ぴょーん」を鳴らす（飛んでいる間の音）。
           * どれだけ飛ぶかは、いまの高さと上向きの速さから出せる。
           * 画面ではジャンプ中だけ遅くしているので、その分だけ音も引き伸ばす。
           */
          const vz = Math.max(0, b.vz);
          const top = b.z + vz * vz / (2 * E.G);
          const secs = (vz / E.G + Math.sqrt(2 * top / E.G)) / JUMP_SPEED;
          AU.sfx('fly', Math.min(1, top / 320), secs);
          air[b.id] = { peak: b.z };
        } else if (b.z > rec.peak) rec.peak = b.z;
        continue;
      }
      /*
       * 台に落ちた。着地はクッションと同じ「ドン」。
       * 落ちる途中で玉に当たった場合は、そこで跳ね返るのでここへは来ない
       * （衝突判定は高さも見ているため）。その場合は玉どうしの衝突音が鳴る。
       */
      if (rec && b.z <= 0.01) {
        delete air[b.id];
        const p = Math.min(1, rec.peak / 320);
        AU.sfx('cushion', 0.35 + 0.6 * p);
        addBurst(b.x, b.y, p);
      }
    }
  }

  const BURST_MS = 420;
  function addBurst(x, y, power) {
    (S.bursts = S.bursts || []).push({ x, y, at: performance.now(), p: Math.min(1, power) });
    if (S.bursts.length > 12) S.bursts.shift();
  }
  function drawBursts() {
    const list = S.bursts; if (!list || !list.length) return;
    const now = performance.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const age = now - b.at;
      if (age > BURST_MS) { list.splice(i, 1); continue; }
      const k = age / BURST_MS;                       // 0→1 で広がって消える
      const p = toScreen(b.x, b.y);
      // 玉の大きさを基準にする。台の寸法で決めると、縮尺しだいで玉より小さくなる
      const base = T.R * view.s * (1.5 + 1.8 * b.p);
      const r0 = base * (0.25 + k * 0.9), r1 = base * (0.62 + k * 1.5);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.95;
      ctx.strokeStyle = '#fde68a'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.2, base * 0.13 * (1 - k));
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4 + 0.13;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const long = (a % 2 === 0) ? 1 : 0.66;        // 縦横を長く、斜めを短く＝「米」の形
        ctx.beginPath();
        ctx.moveTo(p.x + cs * r0, p.y + sn * r0);
        ctx.lineTo(p.x + cs * r1 * long, p.y + sn * r1 * long);
        ctx.stroke();
      }
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 0.8, 0, 7);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, base * 0.07);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * いま狙っている先の玉に印を出す。
   * 当ててよい玉ならオレンジの輪、いけない玉なら禁止の印。
   * 「次に当てる玉」を文字で出すだけでは、盤の上のどれなのかが結びつかない。
   */
  function drawAimTargetMark() {
    const g = S.game;
    const pv = S.aimPreview;
    if (!pv || !pv.contact || pv.contact.type !== 'ball' || !pv.contact.ball) return;
    const b = pv.contact.ball;
    const tg = RU.legalTargets(g, g.turn);
    const ok = !tg || tg.some(x => x.id === b.id);
    const p = toScreen(b.x, b.y), r = b.r * view.s;
    ctx.save();
    if (ok) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.45, 0, 7);
      ctx.strokeStyle = 'rgba(251,146,60,.95)'; ctx.lineWidth = Math.max(2, r * .22); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.72, 0, 7);
      ctx.strokeStyle = 'rgba(251,146,60,.35)'; ctx.lineWidth = Math.max(1, r * .1); ctx.stroke();
    } else {
      // 禁止の印（丸に斜線）
      const R = r * 1.5, lw = Math.max(2.5, r * .3);
      ctx.strokeStyle = 'rgba(220,38,38,.95)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.stroke();
      const c = Math.SQRT1_2 * (R - lw * .1);
      ctx.beginPath(); ctx.moveTo(p.x - c, p.y - c); ctx.lineTo(p.x + c, p.y + c);
      ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 手玉を置ける範囲（4.5節）。
   * 長軸で切った帯を、台の外周で切り抜いて出す。帯だけを出すと台の外まで塗ってしまう
   */
  function drawPlaceArea() {
    const g = S.game, table = g.table;
    const full = g.ballInHandFull;
    const x1 = -table.halfW, x2 = full ? table.halfW : kitchenLimit();
    const p1 = toScreen(x2, -table.halfH), p2 = toScreen(x1, table.halfH);
    ctx.save();
    tablePath(table); ctx.clip('evenodd');
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
    S.aimScreen = [];                        // 狙いが画面のどこを通るか（表示を逃がすのに使う）
    if (diff === 'apocalypse') {
      const L = 260;
      const e = toScreen(cue.x + Math.cos(dir) * L, cue.y + Math.sin(dir) * L);
      line(c, e, 'rgba(255,255,255,.75)', 2);
      S.aimScreen.push([c, e]);
      return;
    }
    const prev = getAimPreview();
    if (!prev) return;
    const hitPt = toScreen(prev.cue.x, prev.cue.y);
    line(c, hitPt, 'rgba(255,255,255,.72)', 1.8);
    S.aimScreen.push([c, hitPt]);
    ctx.beginPath(); ctx.arc(hitPt.x, hitPt.y, cue.r * s, 0, 7);
    ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 1.2; ctx.stroke();
    if (diff === 'easy' && prev.obj) {
      const o0 = toScreen(prev.obj.from.x, prev.obj.from.y);
      const o1 = toScreen(prev.obj.to.x, prev.obj.to.y);
      line(o0, o1, 'rgba(251,146,60,.85)', 2);
      S.aimScreen.push([o0, o1]);
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
        E.applyCue(c2, { dir, power: RU.shotPower(g.rule, Math.max(0.28, S.aim.power || 0.4)), tipX: S.aim.tipX, tipY: S.aim.tipY, elev: S.aim.elev });
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
  function cueStripW() { return Math.max(72, Math.min(96, view.w * 0.17)); }
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
    // 台面は外周そのもの。四隅で描くと、六角形以降で無い床が見える
    const floor = (o, col, top) => {
      const pts = clipNear(o.map(p => ({ x: p.x, y: p.y, z: top || 0 })), cam, f, 45)
        .map(v => proj(v.x, v.y, v.z)).filter(Boolean);
      if (pts.length <= 2) return;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    floor(table.outline, '#12482f');
    // ドーナツ型の中央の島。台面より高い蓋として、クッションの上端の高さで塗る
    if (table.innerOutline) floor(table.innerOutline, '#6b3d1f', table.cushionTop);
    ctx.strokeStyle = '#8a5228'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (const sgm of table.rails) {
      if (sgm.kind === 'arc') {
        // 見た目だけは折れ線でよい（多角形近似の禁止は物理の法線に対する決まり）
        const steps = Math.max(2, Math.ceil(sgm.sweep / 0.35));
        let prev = null;
        for (let i = 0; i <= steps; i++) {
          const ang = sgm.a0 + sgm.sweep * i / steps;
          const q = proj(sgm.cx + Math.cos(ang) * sgm.r, sgm.cy + Math.sin(ang) * sgm.r, table.cushionTop);
          if (prev && q) { ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
          prev = q;
        }
        continue;
      }
      if (sgm.kind === 'ell') {
        // 楕円弧も見た目は折れ線でよい（同上）
        const steps = Math.max(2, Math.ceil(Math.abs(sgm.sweep) / 0.12));
        let prev = null;
        for (let i = 0; i <= steps; i++) {
          const ang = sgm.t0 + sgm.sweep * i / steps;
          const q = proj(sgm.cx + Math.cos(ang) * sgm.ax, sgm.cy + Math.sin(ang) * sgm.by, table.cushionTop);
          if (prev && q) { ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
          prev = q;
        }
        continue;
      }
      const a = proj(sgm.x1, sgm.y1, table.cushionTop), b2 = proj(sgm.x2, sgm.y2, table.cushionTop);
      if (a && b2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }
    }
    ctx.lineCap = 'butt';
    /*
     * レール上のダイヤ（目印）。2Dには出ていて3Dに無いと、
     * 3Dで狙いを合わせるときに位置の手がかりが消えてしまう。
     * 位置は2Dと同じものを台定義データから引く。
     */
    ctx.fillStyle = 'rgba(255,240,215,.72)';
    const diamond = (tx, ty) => {
      const q = proj(tx, ty, table.cushionTop + 2); if (!q) return;
      const rr = Math.max(1.2, scale * 26 / q.z);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - rr); ctx.lineTo(q.x + rr * .72, q.y);
      ctx.lineTo(q.x, q.y + rr); ctx.lineTo(q.x - rr * .72, q.y);
      ctx.closePath(); ctx.fill();
    };
    for (const d of T.diamonds(table)) diamond(d.x, d.y);
    for (const pk of table.pockets) {
      const q = proj(pk.x, pk.y, 0); if (!q) continue;
      const rr = scale * pk.r / q.z;
      const hg = ctx.createRadialGradient(q.x, q.y, rr * .15, q.x, q.y, rr);
      hg.addColorStop(0, '#151515'); hg.addColorStop(1, '#000');
      ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.45, 0, 0, 7); ctx.fillStyle = hg; ctx.fill();
    }

    /*
     * ★カーリング型の的（ハウス）を台面に描く（利用者指示）。
     * **玉より先に描くので玉の下に敷かれる。**円周を透視投影で折れ線に落とす。
     * 台面すれすれ（z=0.5）に置き、2Dの drawHouse と同じ同心円4本＋ホグ円にする。
     */
    if (g.rule === 'G-09' && g.curling) {
      const L = g.curling.layout;
      const ring = radius => {
        const pts = [];
        for (let i = 0; i < 48; i++) {
          const a = 2 * Math.PI * i / 48;
          const q = proj(L.center.x + Math.cos(a) * radius, L.center.y + Math.sin(a) * radius, 0.5);
          if (q) pts.push(q);
        }
        return pts;
      };
      const path = pts => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); };
      // ホグ円（点線）。得点には関わらないが、外で止まると玉が消えるので見せる
      const hp = ring(L.hog);
      if (hp.length >= 3) { ctx.setLineDash([7, 6]); path(hp); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
      // ハウスは外から順に塗り重ねる
      const RING = ['rgba(80,150,255,.30)', 'rgba(245,245,245,.26)', 'rgba(225,60,60,.34)', 'rgba(245,245,245,.40)'];
      L.rings.forEach((k, i) => { const pts = ring(L.radius * k); if (pts.length >= 3) { path(pts); ctx.fillStyle = RING[i]; ctx.fill(); } });
      const op = ring(L.radius);
      if (op.length >= 3) { path(op); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.8; ctx.stroke(); }
    }

    const prev = getAimPreview();
    S.aimScreen = [];
    if (prev) {
      const a = proj(cue.x, cue.y, 1), b2 = proj(prev.cue.x, prev.cue.y, 1);
      if (a && b2) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.stroke();
        S.aimScreen.push([a, b2]);
      }
    }

    const live = g.world.balls.filter(b => b.state === 'live')
      .map(b => ({ b, p: proj(b.x, b.y, b.z + b.r) })).filter(o => o.p)
      .sort((m, n) => n.p.z - m.p.z);
    for (const o of live) drawBall3D(o.b, o.p.x, o.p.y, scale * o.b.r / o.p.z);

    // 3D空間のキュー。尻はカメラより後ろへ抜けるので、手前で切ってから描く
    // （切らないと投影できず、キューが1本も見えない）
    const el = S.aim.elev;
    const back = 90 + pull * 340;
    /*
     * キューの先が当たる場所は玉の中心ではない。撞点をずらしていれば、
     * 左右にも上下にもそのぶん動く（物理側の可動域＝半径の 50%）。
     * 絵がいつも中心を指していると、撞点を変えたことが見た目に出ない。
     */
    const sx = cue.x - fy * S.aim.tipX * cue.r * 0.5;
    const sy = cue.y + fx * S.aim.tipX * cue.r * 0.5;
    const sz = cue.r + S.aim.tipY * cue.r * 0.5;
    const p1 = { x: sx - fx * back * Math.cos(el), y: sy - fy * back * Math.cos(el), z: sz + back * Math.sin(el) };
    const p2 = { x: sx - fx * (back + 1300) * Math.cos(el), y: sy - fy * (back + 1300) * Math.cos(el), z: sz + (back + 1300) * Math.sin(el) };
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
    fadeBoardOverlays(false);         // 3Dのタイトルは帯の上なので玉では薄くしない
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
    strokeOwnerRing(b, x, y, r);
    if (b.num && r > 6) {
      ctx.beginPath(); ctx.arc(x, y, r * .48, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '700 ' + Math.max(7, r * .62) + 'px "Noto Sans JP",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(b.num), x, y + .5);
    }
    ctx.restore();
  }

  /**
   * 上部：ここを左右にドラッグすると向きが変わる、と分かる帯。
   * 矢印は絵として左右の端に置き、文言には矢印の記号を入れない。
   * 両方あると同じことを2つ言っていることになり、しかも重なって読めなかった。
   */
  function drawDirStrip() {
    const h = dirStripH();
    const y0 = dirStripTop();                 // タイトルの下から始める
    // 右上には言語と設定が常に居るので、そのぶんを空けて箱を終える
    const RESERVE = 104;
    const W = Math.max(120, view.w - RESERVE);
    ctx.save();
    ctx.translate(0, y0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(20,20,20,.82)'); g.addColorStop(1, 'rgba(20,20,20,.34)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
    const hot = (S.drag && S.drag.kind === 'fine');
    ctx.strokeStyle = hot ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.4; ctx.strokeRect(.7, .7, W - 1.4, h - 1.4);
    // 箱の両端の矢印。sg は矢印が指す向き。底辺を反対側に置いて、指す先を尖らせる
    const cyy = h / 2;
    const AW = 9, PAD = 7;                    // 矢印の半幅と、箱の縁からの余白
    ctx.fillStyle = hot ? '#fb923c' : 'rgba(255,255,255,.72)';
    [[PAD + AW, -1], [W - PAD - AW, 1]].forEach(([x, sg]) => {
      ctx.beginPath();
      ctx.moveTo(x - sg * AW, cyy - 10); ctx.lineTo(x - sg * AW, cyy + 10); ctx.lineTo(x + sg * AW, cyy);
      ctx.closePath(); ctx.fill();
    });
    // 文字は矢印の内側だけを使う。狭ければ字を小さくして、矢印に掛からないようにする
    const inner = W - (PAD + AW * 2) * 2 - 12;
    const label = t('hint.dir');
    let size = 12;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (; size > 8; size--) {
      ctx.font = size + 'px "Noto Sans JP",sans-serif';
      if (ctx.measureText(label).width <= inner) break;
    }
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(label, W / 2, cyy - 7, inner);
    ctx.font = '11px "Noto Sans JP",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(((S.aim.dir * 180 / Math.PI) % 360).toFixed(1) + '°', W / 2, cyy + 11);
    ctx.restore();
  }

  /**
   * 右端：キューの絵。ここを引くと力が溜まり、離すと撞く。
   * 強さの目盛りも同じ箱の中へ、キューと並べて縦に置く。
   * 数字が箱の中・目盛りが画面の下という置き方だと、
   * どちらが何を指しているのかが結びつかなかった。
   */
  function drawCueStrip() {
    const w = cueStripW();
    const x0 = view.w - w;
    const top = dirStripTop() + dirStripH() + 10, bot = view.h - 14;
    const H = bot - top;
    const pw = Math.min(1, S.aim.power);
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,.55)';
    ctx.fillRect(x0, top - 6, w, H + 12);
    ctx.strokeStyle = (S.drag && S.drag.kind === 'pull') ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.4; ctx.strokeRect(x0 + .7, top - 5.3, w - 1.4, H + 10.6);

    /*
     * ★**バンキングの間だけ、強さの目盛りも数字も出さない。**
     * 出したままだと「この台は62%」と覚えるだけで良い位置に止められてしまい、
     * 先手決めが腕ではなく暗記になる。**全ルール共通**（バンキングをするのは
     * 通信対戦・AI対戦・サバイバル・カーリング型）。
     * 目盛りを消したぶんはキューを strip の中央へ寄せる（空白が残ると壊れて見える）。
     */
    const hideP = inBanking();
    if (!hideP) {
      // ── 強さの目盛り（縦）。左の端から順に「目盛り・数字・キュー」と並べる
      const GW = 9, GX = x0 + 7;
      roundRect(GX, top, GW, H, 4);
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
      const fh = H * pw;
      if (fh > 1) {
        roundRect(GX, top + H - fh, GW, fh, 4);
        ctx.fillStyle = S.aim.power > 1 ? '#dc2626' : '#ea580c'; ctx.fill();
      }
      // 100% の線。ここを超えると撞きすぎ（4.4.4節）
      ctx.beginPath(); ctx.moveTo(GX - 2, top + .5); ctx.lineTo(GX + GW + 2, top + .5);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // ── キューは上（先端）から下（尻）へ。引き代ぶん下へずらす
    const lead = hideP ? 16 : 30;                  // 目盛りと数字にあける幅
    const bx = x0 + lead + (w - lead) / 2;         // 目盛りと数字のぶんを空けた中央
    const ballR = 10;
    const cx = bx + S.aim.tipX * ballR * 0.5;      // 撞点の左右のずれ＝キューの位置がずれる
    const travel = H * 0.34;
    const off = S.aim.power * travel;
    const tipY = top + 18 + off, buttY = bot - 6 + off;
    // 先が細く尻が太い実物の形。真っ直ぐな棒だと向きが読めない
    taperedCue(ctx, cx, tipY, cx, Math.min(buttY, bot + travel), 5.5, 13);
    // 手玉（先端の先に置いて、引く向きが分かるようにする）
    ctx.beginPath(); ctx.arc(bx, top + 6, ballR, 0, 7);
    const bg2 = ctx.createRadialGradient(bx - 3, top + 3, 1, bx, top + 6, ballR);
    bg2.addColorStop(0, '#fff'); bg2.addColorStop(1, '#b9b9b9');
    ctx.fillStyle = bg2; ctx.fill();
    // 撞点の印。玉のどこを撞くのかを、この絵の上でも見せる
    ctx.beginPath(); ctx.arc(cx, top + 6 - S.aim.tipY * ballR * 0.5, ballR * .22, 0, 7);
    ctx.fillStyle = '#c2410c'; ctx.fill();
    // 文言と数字
    ctx.save();
    ctx.translate(x0 + (hideP ? 13 : 26), bot - 4); ctx.rotate(-Math.PI / 2);
    ctx.font = '11px "Noto Sans JP",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = (!hideP && S.aim.power > 1) ? '#fca5a5' : 'rgba(255,255,255,.62)';
    // バンキング中は数字を伏せる。「？？？」なら消し忘れではなく伏せていると伝わる
    ctx.fillText(t('hint.power') + (hideP ? '  ???' : '  ' + Math.round(S.aim.power * 100) + '%'), 0, 0);
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
    // キュー（尻を持ち上げる）。先が細く、尻が太い実物の形に寄せる。
    // 撞点を上下させると、先が当たる高さもそのぶん動く（可動域は半径の 50%）
    const ty = clamp(S.aim.tipY || 0, -1, 1) * 0.5;
    const L = w * 0.86;
    const tipX = bx - br * 0.9 * Math.sqrt(Math.max(0.04, 1 - ty * ty));
    const tipY = bedY - br - br * ty;
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
   * 角度の絵に、キューの尻がぶつかる邪魔物を描く。
   * 角度を下げられない理由は「後ろに何かある」ことなので、
   * それそのものを見せないと、なぜ下げられないのかが分からない。
   * **壁のときは壁、玉のときは玉**を描く。壁の絵しか無いと、
   * 玉が邪魔をしている場面で嘘の説明になる。
   */
  function drawSideWall(c, x, bedY, w, h, bx, br, elev) {
    const g = S.game; if (!g) return;
    const L = w * 0.70;                       // 絵の中のキューの長さ＝CUE_LEN に相当
    const dist = wallDistFor(S.aim.dir);
    const need = minElevFor(S.aim.dir);
    const kind = (S.elevWhat && S.elevWhat[dirIndex(S.aim.dir)]) || 'wall';
    if (!isFinite(dist) || dist > CUE_LEN || need <= 0.001) return;
    const ty = clamp(S.aim.tipY || 0, -1, 1) * 0.5;
    const tipX = bx - br * 0.9 * Math.sqrt(Math.max(0.04, 1 - ty * ty));
    const tipY = bedY - br - br * ty;
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
    const touching = elev <= need + 0.02;
    c.save();
    if (kind === 'ball') {
      // 玉。てっぺんをキューが掠める高さに合わせる＝越えられるかどうかが絵で分かる
      const r2 = Math.max(3, wallH / 2);
      const bg = c.createRadialGradient(wallX - r2 * .35, bedY - r2 * 1.3, r2 * .1, wallX, bedY - r2, r2);
      bg.addColorStop(0, touching ? '#ffd9c2' : '#fff');
      bg.addColorStop(1, touching ? '#c2410c' : '#9aa0a6');
      c.beginPath(); c.arc(wallX, bedY - r2, r2, 0, 7); c.fillStyle = bg; c.fill();
      c.strokeStyle = touching ? 'rgba(251,146,60,.95)' : 'rgba(255,255,255,.35)';
      c.lineWidth = 1.2; c.stroke();
    } else {
      const wallW = Math.max(3, w * 0.07);
      c.fillStyle = touching ? '#a3431a' : '#6b4423';
      c.fillRect(wallX - wallW / 2, bedY - wallH, wallW, wallH);
      c.fillStyle = touching ? 'rgba(251,146,60,.9)' : 'rgba(255,255,255,.3)';
      c.fillRect(wallX - wallW / 2, bedY - wallH, wallW, Math.max(1.4, wallH * 0.16));
    }
    c.restore();
  }

  /**
   * 携帯の左上に重ねたタイトルは HTML の実体（#board-title）。
   * ここでは、玉や予測線がその下に来たときに薄くするかどうかだけを決める。
   * 描く実体を2つ持たないので、アイコンや副題が片方だけ欠けることがない。
   */
  /** その要素が盤面のどこを覆っているか（キャンバスの座標で） */
  function rectOnBoard(el) {
    const r = el.getBoundingClientRect(), c0 = cv.getBoundingClientRect();
    return { x: r.left - c0.left, y: r.top - c0.top, w: r.width, h: r.height };
  }

  /**
   * 盤面に重ねている表示を、狙いにかぶるときだけ薄くする。
   * 消してしまうと何のための表示か分からなくなるので、うっすら残す。
   * 狙いの元・途中・先のどこが重なっても薄くする（線そのものを見る）。
   */
  function fadeIfAimCovers(el, alsoBalls) {
    if (!el) return;
    const g = S.game;
    const shown = el.offsetWidth > 0 && el.offsetHeight > 0;
    if (!g || !shown) { el.classList.remove('faded'); return; }
    const q = rectOnBoard(el);
    let hit = false;
    for (const seg of (S.aimScreen || [])) {
      if (segRect(seg[0], seg[1], q.x, q.y, q.w, q.h)) { hit = true; break; }
    }
    if (!hit && alsoBalls) {
      for (const b of g.world.balls) {
        if (b.state !== 'live') continue;
        const p = toScreen(b.x, b.y), r = b.r * view.s + 2;
        if (p.x + r > q.x && p.x - r < q.x + q.w && p.y + r > q.y && p.y - r < q.y + q.h) { hit = true; break; }
      }
    }
    el.classList.toggle('faded', hit);
  }

  /** 盤面に重ねている表示ぜんぶを見て回る。1つ足したらここへ足す */
  function fadeBoardOverlays(mobileTitle) {
    const aiming = (S.phase === 'aim' || S.phase === 'stance') && isMyTurn();
    if (!aiming) S.aimScreen = [];
    fadeIfAimCovers($('msg-bar'), false);
    fadeIfAimCovers($('flash'), false);
    fadeIfAimCovers($('board-title'), mobileTitle);
    layoutMsgBar();      // 3D と2Dで置き場所が違うので、毎コマ合わせ直す
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
    if (!T.inside(table, pt.x, pt.y, cue.r)) return false;
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
    S.dropped = null;                    // 触ったら中央の知らせは畳む
    if (!S.game || !isMyTurn() || S.demo) return;
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
      refreshElevFan();                 // 上を撞けば、越えるのに要る角度は下がる
    } else if (S.drag.kind === 'fine') {
      S.aim.dir = S.drag.d0 + (p.x - S.drag.x) * 0.0016;
      S.aimDirty = true;
      autoElev();
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
    /*
     * 置ける場所は「台の内側」と「ヘッド側の区画（キッチン）」の重なり。
     * 片方ずつ直すと、直した拍子にもう片方から出ることがあるので交互に数回かける。
     * 台の形が細くなる場所ほど1回では収まらない
     */
    const kitchen = g.ballInHand && !g.ballInHandFull;
    for (let i = 0; i < 4; i++) {
      if (kitchen) tp.x = Math.min(tp.x, kitchenLimit());
      const q = T.clampInside(table, tp.x, tp.y, cue.r);
      tp.x = q.x; tp.y = q.y;
    }
    if (kitchen) tp.x = Math.min(tp.x, kitchenLimit());
    S.placePos = tp;
    S.aimDirty = true;
  }
  function moveAim(p) {
    const g = S.game, cue = RU.cueBallOf(g, g.turn);
    const tp = toTable(p.x, p.y);
    const d = Math.atan2(tp.y - cue.y, tp.x - cue.x);
    if (isFinite(d)) { S.aim.dir = d; S.aimDirty = true; autoElev(); }
  }

  function shootNow() {
    const g = S.game;
    const need = minElevFor(S.aim.dir);
    if (need >= Math.PI / 2 - 0.01) { setMsg(t('foul.V-09')); S.aim.power = 0; return; }
    const elev = Math.max(S.aim.elev, need);
    /*
     * ★**強さは、見えている目盛りから物理の値へ割り当て直してから渡す**（rules.js の shotPower）。
     * カーリング型だけ幅が違う。ここで直しておくと、履歴にも通信にも物理の値が流れるので、
     * 受け取る側とリプレイは割り当てを知らなくてよい。
     */
    const shot = { dir: S.aim.dir, power: RU.shotPower(g.rule, Math.min(1.15, S.aim.power)), tipX: S.aim.tipX, tipY: S.aim.tipY, elev };
    const place = S.pendingPlace;
    S.pendingPlace = null;
    S.aim.power = 0;
    fireShot(shot, place, true);
  }

  const elevEl = $('elev');
  elevEl.addEventListener('input', () => {
    S.elevTouched = true;              // 自分で決めた値は、以後こちらで動かさない
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
      computeElevFan(cue); autoElev();
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
    // 1コマぶんの経過時間。長すぎる間隔は抑える（裏に回っていた直後の飛びを防ぐ）。
    // 上限を 250ms にしてあるので、1秒に4コマしか描けない端末でも玉は実時間どおりに進む
    const dt = Math.min(250, now - lastT); lastT = now;
    if (S.demo && S.screen === 'play') stepDemo(now);
    if (S.screen === 'play' && S.game) {
      const t0 = DEBUG ? performance.now() : 0;
      /*
       * 1コマで進める刻みの数は、**経過した時間から決める**。
       * コマ数で決めていたころは、画面の更新が遅い端末ほど玉がゆっくり転がり、
       * 対局者との差がどんどん開いた（携帯の観戦者が置いていかれる）。
       * 物理の刻みは 1/480 秒で変わらないので、1コマにまとめて進めても
       * 衝突を飛び越すことはない。カクカクに見えるだけで、当たり外れは変わらない。
       * 上限は念のための重し（dt は上で 250ms に抑えてある）。
       */
      let steps = 0;
      const world = S.phase === 'rolling' ? S.game.world : S.replayRun;
      if (world) {
        const flying = highestBall(world) > JUMP_Z;
        const rate = flying ? JUMP_SPEED : animSpeed();
        S.stepAcc = (S.stepAcc || 0) + (dt / 1000) / E.DT * rate;
        steps = Math.min(240, Math.floor(S.stepAcc));
        S.stepAcc -= steps;
      } else S.stepAcc = 0;
      if (S.phase === 'rolling') {
        /*
         * 観戦者は**最新の盤面を優先する**（9.5.8節）。
         * 次の手がもう届いているのに、いまの手をゆっくり見せ続けると、
         * 遅い端末では差が開く一方で二度と追いつけない。
         * 待っている手があるあいだは、いまの手を最後まで一気に走らせる。
         */
        if (S.net.on && S.net.role === 'spectator' && hasWaitingShot()) {
          E.runShot(S.game.world, 20);
          S.evCursor = S.game.world.events.length;   // 飛ばした分の音は鳴らさない
          S.stepAcc = 0;
        }
        for (let i = 0; i < steps; i++) {
          if (E.allStopped(S.game.world)) break;
          E.step(S.game.world);
          watchJumps();                     // 刻みごとに見る。着地を跨いで見落とさないため
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
      // 落ちた玉を見せ終わったら（または盤を触って畳んだら）結果へ進む
      if (S.endWait && (!S.dropped || now > S.endWait)) { S.endWait = 0; endGame(); }
      renderClock();
      drawElevPic();
      $('k-elev').textContent = Math.round(S.aim.elev * 180 / Math.PI) + '°';
      const key = mainButtonKey();
      const btn = $('btn-aim');
      if (btn.dataset.k !== key) { btn.dataset.k = key; btn.textContent = t(key); }
      btn.disabled = !isMyTurn() || S.phase === 'rolling' || S.phase === 'wait' || !!S.demo;
      /*
       * 手玉を置く場面では、置ける位置にあることが分かるようにボタンを目立たせる。
       * 押して構えへ進めば見出しが変わるので、色も自然に元へ戻る。
       */
      btn.classList.toggle('primary', S.phase === 'place' && !btn.disabled && placeOk(S.placePos));
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
      // 着地は watchJumps が玉の高さから見ている（ふわりと落ちた場合も拾うため）
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
  function setMsg(m) {
    S.msg = m || '';
    $('msg-text').textContent = S.msg;
    $('msg-bar').classList.toggle('on', !!S.msg);
    if (S.msg) layoutMsgBar();
  }

  // ══════════════════════════════════════════════
  //  盤に重ねる知らせの置き場所（利用者指示）
  // ══════════════════════════════════════════════
  /*
   * ★**既定は上。**下は撞くときに手と目が行く場所で、いちばん邪魔になる。
   *
   * ★**3D の構えでは、向きの帯のすぐ下へ下ろす。**3D は上半分が空（台の向こう）なので
   *   そこが空いているが、いちばん上には向きを合わせる帯が出ているため、真上だと重なる。
   *
   * ★**近づいたら反対側へ逃げる。**指や矢印が知らせの上に来たら、上下を入れ替える。
   *   つまみ以外は素通りするので、盤をなぞる操作そのものは邪魔しない。
   *
   * ★**つまんで動かせる。**動かした場所は覚えて、次の対局でも同じ所に出す。
   *   つまみを2回押すと元の位置へ戻る。
   */
  function msgHome() {
    // 3D の構えは向きの帯を避ける。2D は上端から少しだけ下げる
    const top = (S.phase === 'stance')
      ? dirStripTop() + dirStripH() + 12
      : topInset() + 8;
    return { x: 0.5, y: top / Math.max(1, view.h) };
  }
  /** いま出すべき置き場所（割合）。動かしてあればそれ、無ければ既定 */
  function msgSpot() {
    const home = msgHome();
    const p = S.msgPos ? { x: S.msgPos.x, y: S.msgPos.y } : home;
    if (S.msgDodge) {
      /*
       * 逃がす先は「反対の端」。上にあれば下へ、下にあれば上へ。
       * 少しだけずらす形にすると、逃げた先でまた指に当たって行ったり来たりする。
       */
      p.y = (p.y < 0.5) ? Math.max(0, 1 - (home.y + 0.02)) : home.y;
    }
    return p;
  }
  /*
   * ★毎コマ呼ばれるので、**同じ場所なら何もしない**。
   * 大きさを測る（offsetWidth）のは配置し直しを起こすので、
   * 毎コマ測ると1コマの予算を食う。文字と窓が変わったときだけ測り直す。
   */
  let msgLast = '';
  function layoutMsgBar() {
    const el = $('msg-bar');
    if (!el || !S.msg || !view.h) return;
    const key = S.msg + '|' + view.w + 'x' + view.h + '|' + S.phase;
    if (key !== msgLast) { msgLast = key; el.style.width = ''; }
    // 左上を起点に transform でずらす（left で置くと右端で箱が潰れる）
    const q = msgRect(msgSpot());
    const tr = 'translate(' + q.x + 'px,' + q.y + 'px)';
    if (el.style.transform !== tr) el.style.transform = tr;
  }
  /** 割合位置 p を画面上の矩形（左上と大きさ）へ直す。配置と当たり判定で同じ計算を使う */
  function msgRect(p) {
    const el = $('msg-bar');
    const w = el.offsetWidth || 200, h = el.offsetHeight || 26;
    const x = Math.min(Math.max(p.x * view.w, w / 2 + 4), Math.max(w / 2 + 4, view.w - w / 2 - 4));
    const y = Math.min(Math.max(p.y * view.h, 4), Math.max(4, view.h - h - 4));
    return { x: Math.round(x - w / 2), y: Math.round(y), w, h };
  }
  /**
   * 指や矢印が知らせに重なっているか（少し広めに見る）。
   * ★**見るのは「逃げていない本来の位置」。**逃げた後の実際の位置で見ると、
   *   逃げた先にマウスが居ないぶん重なりが外れて元へ戻り、
   *   マウスを動かすたびに 逃げる→戻る を繰り返して点滅する（実機で出た不具合）。
   *   本来位置で見れば、その一帯にマウスが居る間は逃げたまま留まる。
   */
  function msgHovered(px, py) {
    const el = $('msg-bar');
    if (!el || !S.msg || !el.classList.contains('on')) return false;
    const q = msgRect(S.msgPos ? S.msgPos : msgHome()), m = 16;
    return px > q.x - m && px < q.x + q.w + m && py > q.y - m && py < q.y + q.h + m;
  }

  /**
   * 盤の真ん中に大きく1秒だけ出す。
   * 端の細い帯に出すだけでは、盤を見ている人の目に入らない。
   *
   * **出し終わったら、文字ごと消して場所も空ける。**
   * 透明にするだけだと、用が済んだ知らせが文字を持ったまま盤の真ん中に居座り続ける。
   * 居座っているものは「出ている」と見なされるので、
   * 狙いの線がそこを横切ったときに薄くする印が付き、**関係のない場面で前のファウルが薄く現れる**。
   * 透明度の付け方の問題ではなく、要らなくなった知らせが在り続けることが原因。
   */
  let flashTimer = null, flashGone = null;
  function flash(text, kind, why) {
    const el = $('flash'); if (!el || !text) return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    if (flashGone) { clearTimeout(flashGone); flashGone = null; }
    el.classList.remove('gone');
    $('flash-t').textContent = text;
    $('flash-w').textContent = why || '';
    // faded（狙いを避けて薄くする印）を消さないよう、必要な組だけ触る
    el.classList.remove('foul', 'warn');
    if (kind) el.classList.add(kind);
    el.classList.add('on');
    // 理由まで読ませるときは長めに出す
    flashTimer = setTimeout(() => {
      el.classList.remove('on'); flashTimer = null;
      // 薄れ終わってから畳む。消え方（0.12秒）はそのまま残す
      flashGone = setTimeout(() => {
        $('flash-t').textContent = ''; $('flash-w').textContent = '';
        el.classList.remove('foul', 'warn', 'faded');
        el.classList.add('gone');
        flashGone = null;
      }, 220);
    }, why ? 2600 : 1000);
  }

  /**
   * 出ている知らせを、消えるのを待たずにその場で畳む。
   *
   * **前の局の知らせは、次の局の出来事ではない。**
   * 知らせは 2.6 秒で自分から消えるので、局を始めるときに何もしなくても
   * たいていは間に合っていた。しかし続けてもう1局をすぐ始めると、
   * **手玉を置く前に、前の局のファウルが盤の真ん中に出たままになる**
   * （練習モードは 0.9 秒後に自動で次を始めるので必ずそうなる）。
   * 消えるまでの時間に寄りかからず、局の入り口で必ず畳む。
   */
  function clearFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    if (flashGone) { clearTimeout(flashGone); flashGone = null; }
    const el = $('flash'); if (!el) return;
    el.classList.remove('on', 'foul', 'warn', 'faded');
    el.classList.add('gone');
    $('flash-t').textContent = ''; $('flash-w').textContent = '';
  }

  /**
   * ファウルの一言説明。
   * 「対象違い」とだけ出ても、当たったつもりの人には何が起きたのか分からない。
   * とくに撞球の癖を入れていると、狙った通りに手玉が進まないことがあるので、
   * その可能性まで添える。
   */
  /** 玉の呼び名。番号を持たない玉（キャロムの的球）は番号で呼べない */
  function ballName(b) {
    return b.num ? t('miss.numbered', { n: b.num }) : t('miss.object');
  }
  /**
   * 空振りの理由。
   * 「どの玉にも当たりませんでした」だけでは、なぜ当たらなかったのかが分からない。
   * 撞く直前の盤面（リプレイ用に控えてあるもの）をもう一度だけ走らせて、
   * **実際に何が起きたか**を測ってから言う。もっともらしい理由を並べない。
   */
  function missWhy() {
    const g = S.game;
    if (!g || !S.replay || !S.pre || !S.replay.shot) return '';
    const balls = S.replay.balls.map(b => Object.assign({}, b));
    const w = E.createWorld(g.table, balls, g.tuning);
    const cue = w.balls.find(b => b.id === S.pre.cueId);
    if (!cue) return '';
    const objs = w.balls.filter(b => b !== cue && b.state === 'live');
    if (!objs.length) return t('miss.none');
    const shot = S.replay.shot;
    const x0 = cue.x, y0 = cue.y;
    // 狙った向きの先に玉があったか（当たるはずだった相手と、そこまでの距離）
    const fc = E.firstContact(w, cue, shot.dir, 6000);
    const dx = Math.cos(shot.dir), dy = Math.sin(shot.dir);

    let near = null;              // いちばん近づいた相手 { b, gap, air, railBefore }
    let railSeen = false, evAt = 0;
    E.applyCue(cue, shot);
    E.runShot(w, 12, ww => {
      for (; evAt < ww.events.length; evAt++) {
        const ev = ww.events[evAt];
        if (ev.type === 'cushion' && ev.ball === cue.id) railSeen = true;
      }
      if (cue.state !== 'live') return;
      for (const b of objs) {
        if (b.state !== 'live') continue;
        const gap = Math.hypot(b.x - cue.x, b.y - cue.y) - (cue.r + b.r);
        if (!near || gap < near.gap) near = { b, gap, air: cue.z > cue.r * 0.5, railBefore: railSeen };
      }
    });
    if (!near) return '';
    const cm = v => (Math.max(0, v) / 10).toFixed(1);
    // 進めた距離。狙った玉まで届かずに止まったのなら、それがいちばんの理由
    const went = (cue.x - x0) * dx + (cue.y - y0) * dy;
    if (fc.type === 'ball' && fc.ball && went < fc.dist - 1 && near.gap > 0) {
      return t('miss.short', { n: ballName(fc.ball), d: cm(fc.dist - went) });
    }
    if (near.gap <= 0 && near.air) return t('miss.air', { n: ballName(near.b) });
    if (near.gap <= near.b.r * 2) return t('miss.near', { n: ballName(near.b), d: cm(near.gap) });
    if (near.railBefore) return t('miss.rail', { n: ballName(near.b) });
    return t('miss.wide', { n: ballName(near.b), d: cm(near.gap) });
  }

  function foulWhy(res) {
    const g = S.game;
    const lines = [];
    for (const f of res.fouls) lines.push(t('foul.why.' + f));
    if (res.fouls.indexOf('V-01') >= 0) {
      const why = missWhy();
      if (why) lines.push(why);
    }

    /*
     * 「当たりそうだったのに外れた」の一言。
     * 撞球の癖が入っているだけでは足りない。**その癖が効く場面だったか**まで見る。
     * クッションの捻りが効くのは、手玉が的球より先にクッションへ触れたときだけ。
     * 条件を確かめずに書くと、関係のない場面で見当違いの説明を出すことになる。
     */
    const missed = res.fouls.indexOf('V-01') >= 0 || res.fouls.indexOf('V-02') >= 0;
    const spun = (S.lastShotTip || 0) > 0.18;             // 撞点を芯から外して撞いた
    if (missed && spun && S.cfg.cue[3] && S.pre) {
      let railFirst = false;
      for (const e of g.world.events) {
        if (e.type === 'hit' && (e.a === S.pre.cueId || e.b === S.pre.cueId)) break;
        if (e.type === 'cushion' && e.ball === S.pre.cueId) { railFirst = true; break; }
      }
      if (railFirst) lines.push(t('foul.why.bend'));
    }
    return lines.filter(Boolean).join('\n');
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
      if (g.rule === 'G-08') right = survivalHudText(g, p);
      // 陣取りは「塗ったマス数」と「残りの打数」を並べる（7.7.4節）
      if (g.rule === 'G-06') {
        right = p.score + '  ' + t('hud.trShots', { n: Math.max(0, RU.TERRITORY_SHOTS - (p.shots || 0)) });
      }
      /*
       * ボウリング型は「確定した総得点」と「いま何フレーム目か」を並べる（7.11.5節）。
       * ★得点は**1フレーム遅れて確定する**ので、確定した累計だけを出す。
       *   確定前のぶんを足して見せると、次の投で数字が下がったように見える。
       */
      if (g.rule === 'G-11' && g.bowling) {
        const fr = g.bowling.frames[i] || [];
        const n = Math.min(RU.BOWL_FRAMES, Math.max(1, fr.length));
        right = p.score + '  ' + t('hud.bowlFrame', { n: n, all: RU.BOWL_FRAMES });
      }
      // カーリング型は「合計点」と「このエンドの残りの持ち球」を並べる（7.9.3節）
      if (g.rule === 'G-09' && g.curling) {
        const left = Math.max(0, RU.CURLING_STONES - (g.curling.thrown[i] || 0));
        right = p.score + '  ' + t('hud.curlStones', { n: left });
      }
      const who = (g.coop ? teamMark(p.team) + ' ' : '') + p.name;
      /*
       * 陣取りは**持ち色と玉の番号を名前の隣に置く**。
       * 盤の玉はその人の色そのもので描かれるが、**どの色が自分なのかは
       * どこにも書いていなかった**（実機での指摘）。色は順ぐりに配るので
       * 番号は飛び飛びになり（2人なら 1・3・5・7）、番号だけでも探せる。
       */
      let head = '';
      if (g.rule === 'G-06') {
        const col = RU.TERRITORY_COLORS[i % RU.TERRITORY_COLORS.length];
        const nums = RU.territoryBallsOf(g, i).map(b => b.num).sort((a, b) => a - b).join(' ');
        head = '<span class="pl-dot" style="background:' + col + '"></span>';
        // 色の印は名前と同じ枠に入れる。別の枠にすると両端へ引き離される（flex の並べ方）
        d.innerHTML = '<span>' + head + escapeHtml(who) +
          '<span class="pl-nums">' + escapeHtml(nums) + '</span></span>' +
          '<span>' + escapeHtml(right) + '</span>';
        box.appendChild(d);
        return;
      }
      /*
       * カーリング型も**持ち色を名前の隣に置く**。持ち球はその人の色そのもので描かれ、
       * どの色が自分なのかは他にどこにも出ていない（陣取りで実機から指摘された件と同じ）。
       */
      if (g.rule === 'G-09') {
        const col = RU.CAROM_COLORS[i % RU.CAROM_COLORS.length];
        d.innerHTML = '<span><span class="pl-dot" style="background:' + col + '"></span>' +
          escapeHtml(who) + '</span><span>' + escapeHtml(right) + '</span>';
        box.appendChild(d);
        return;
      }
      d.innerHTML = '<span>' + escapeHtml(who) + '</span><span>' + escapeHtml(right) + '</span>';
      box.appendChild(d);
    });
    // バンキング中は「次に当てる玉」が無い。空欄にすると何をしている場面か分からないので、
    // その場で何が行われているかを出す
    if (g.over) {
      // 局が終わったら「次に当てる玉」は無い。前の一手ぶんが残っていると、まだ続くように見える
      $('v-next').textContent = '–';
    } else if (g.bank && g.bank.on) {
      $('v-next').textContent = t('bank.label');
    } else if (g.rule === 'G-09' && g.curling) {
      // 「次に当てる玉」が無いルールなので、代わりに何エンド目かを出す（7.9.3節）
      $('v-next').textContent = t('hud.curlEnd', {
        n: Math.min(g.curling.end + 1, g.curling.ends), all: g.curling.ends,
      });
    } else if (g.rule === 'G-11' && g.bowling) {
      /*
       * ボウリング型も「次に当てる玉」が無い。代わりに**このフレームの何投目か**と
       * **立っているピンの数**を出す。2投目に何本残っているかが、次の狙いを決める材料になる。
       */
      const fr = g.bowling.frames[g.turn] || [];
      const cur = fr.length ? fr[fr.length - 1] : null;
      const ball = (cur && !RU.bowlFrameDone(cur, fr.length - 1 === RU.BOWL_FRAMES - 1))
        ? cur.rolls.length + 1 : 1;
      $('v-next').textContent = t('hud.bowlBall', { n: ball, pins: RU.bowlStanding(g) });
    } else {
      const tg = RU.legalTargets(g, g.turn);
      $('v-next').textContent = tg == null ? '–' : (tg.length ? tg.map(b => b.num || '●').join(' / ') : '–');
    }
    $('v-foul').textContent = g.lastFouls && g.lastFouls.length ? g.lastFouls.map(f => t('foul.' + f)).join(', ') : t('hud.none');
    $('time-box').style.display = S.cfg.mods['G-14'] ? '' : 'none';
    $('v-config').textContent = configLabel();
    // カーリング型はエンドごとの得点表を出す（利用者指示）。合計だけでは勝敗が読めない
    const cb = $('curl-board');
    if (cb) {
      const on = g.rule === 'G-09' && g.curling;
      cb.style.display = on ? '' : 'none';
      if (on) cb.innerHTML = curlScoreHTML(g, true);
    }
    // ボウリング型のピンの状態（利用者指示）。盤の玉が散らばると何番が残ったか読めない
    const bp = $('bowl-pins');
    if (bp) {
      // ★ボックスは**投げ終わって見せている間だけ**出す（利用者指示の順序）
      const html = (g.rule === 'G-11' && g.bowling && S.bowlBox) ? bowlPinsHTML(g) : '';
      bp.style.display = html ? 'block' : 'none';
      if (html) bp.innerHTML = '<div class="cap">' + t('bowl.pins') + '</div>' + html;
    }
    /*
     * ボウリング型のスコアシート（7.11.5節）。
     * **得点が1フレーム遅れて確定する**ルールなので、表が無いと合計の増え方が読めない。
     */
    const bb = $('bowl-board');
    if (bb) {
      const on = g.rule === 'G-11' && g.bowling;
      /*
       * ★**空文字ではなく block と書く。**この枠は CSS の側で display:none にしてあるので、
       *   空文字に戻すと「CSS のとおり＝隠す」になり、表が一度も出ない（実測でそうなった）。
       */
      bb.style.display = on ? 'block' : 'none';
      if (on) bb.innerHTML = bowlScoreHTML(g, true);
    }
  }

  /**
   * ★ボウリング型のスコアシート（7.11.5節）。
   *
   * 各フレームに**投ごとの記号**（X＝ストライク／／＝スペア／−＝0本）と、
   * その下に**確定した累計**を出す。
   * **まだボーナスの投が済んでいないフレームは得点欄を空にする**（仕様の定めるとおり）。
   * ここを暫定の数字で埋めると、次の投で数字が増えるのが「あとから足された」ように見え、
   * 確定した値との区別がつかなくなる。
   */
  function bowlScoreHTML(g, live) {
    /*
     * ★**10フレームを横一列に並べない。**この欄は 212px しか幅が無く、
     *   11列に割ると1マス 17px ＝ 2桁の累計が読めない（実測：横に溢れて隠れた）。
     *   現実のスコアシートと同じく**前半5フレームと後半5フレームの2段**に分ける。
     *   2つの表の列数はそろえる（前半の右端は空欄）。ずれると2段に見えなくなる。
     */
    const N = RU.BOWL_FRAMES, HALF = 5;
    const lines = g.players.map((p, i) => RU.bowlLine(g, i));
    let h = '<div class="cap">' + t('bowl.board') + '</div>';
    for (let part = 0; part * HALF < N; part++) {
      const from = part * HALF, to = Math.min(N, from + HALF);
      const isLastPart = (to >= N);
      h += '<table><tr><th></th>';
      for (let f = from; f < to; f++) h += '<th>' + (f + 1) + '</th>';
      h += '<th class="tot">' + (isLastPart ? t('curl.totCol') : '') + '</th></tr>';
      g.players.forEach((p, i) => {
        const L = lines[i];
        h += '<tr' + (i === g.turn && live ? ' class="cur"' : '') + '>';
        h += '<td class="nm">' + escapeHtml(p.name) + '</td>';
        for (let f = from; f < to; f++) {
          const rolls = L.frames[f];
          const marks = rolls ? bowlMarkHTML(rolls) : '';
          const cum = (L.cum[f] != null) ? L.cum[f] : '';
          h += '<td><span class="bm">' + marks + '</span>'
            + '<span class="bc">' + escapeHtml(String(cum)) + '</span></td>';
        }
        h += '<td class="tot">' + (isLastPart ? p.score : '') + '</td></tr>';
      });
      h += '</table>';
    }
    return h;
  }

  /*
   * 1フレームぶんの投の印。**現実のスコアシートと同じ印を、文字ではなく図形で描く**（利用者指示）。
   *
   * ★**文字の「X」は使わない。**書体によって太さも傾きもそろわず、
   *   スペアの「塗りつぶした三角」と並べたときに印に見えない。
   *   線を2本引いた図形にすれば、大きさを変えても同じ形で出る。
   *
   *   ストライク … 枠いっぱいの ✕（線2本）
   *   スペア     … 右下を塗りつぶした三角
   *   0本        … −／それ以外 … その本数の数字
   */
  const BOWL_STRIKE_MARK = 'X';
  const BOWL_SPARE_MARK = '/';
  const BOWL_MARK_SVG = {
    /*
     * ★ストライクは**向かい合う2つの三角**（利用者指示）。現実のスコアシートの印である。
     *   線を2本引いた「×」は文字の X と見分けがつかない。
     */
    X: '<svg class="bmk" viewBox="0 0 10 10" aria-label="strike">'
      + '<path d="M0.8 0.8L5 5L0.8 9.2Z" fill="currentColor"/>'
      + '<path d="M9.2 0.8L5 5L9.2 9.2Z" fill="currentColor"/></svg>',
    '/': '<svg class="bmk" viewBox="0 0 10 10" aria-label="spare">'
      + '<path d="M9.2 0.8L9.2 9.2L0.8 9.2Z" fill="currentColor"/></svg>',
  };
  /** 印の並びを画面へ出す形にする。図形はそのまま、数字だけ escape する */
  function bowlMarkHTML(rolls) {
    return bowlMarks(rolls).map(m => BOWL_MARK_SVG[m] || escapeHtml(m)).join('');
  }
  /**
   * ★**「10フレーム目かどうか」は見ない。**見分けに要るのは
   *   「その投の前にピンが並べ直されていたか」だけである。
   *   ストライク・スペアの直後は必ず並べ直されるので、そこで前の投を忘れる。
   *   10フレーム目を別扱いにすると、0本→10本（＝スペア）をストライクと書いてしまう。
   */
  function bowlMarks(rolls) {
    const P = RU.BOWL_PINS, out = [];
    let prev = null;
    rolls.forEach(v => {
      if (v === P && prev == null) out.push(BOWL_STRIKE_MARK);
      else if (prev != null && prev + v === P) out.push(BOWL_SPARE_MARK);
      /*
       * ★0本は **− （マイナス記号）** で書く。ふつうのハイフンだと細くて短く、
       *   隣の数字に埋もれて**その一投が無かったように見える**（実機の指摘。
       *   10フレーム目の X9− が「X9」に見えていた）。
       */
      else out.push(v === 0 ? '−' : String(v));
      const last = out[out.length - 1];
      prev = (last === BOWL_STRIKE_MARK || last === BOWL_SPARE_MARK) ? null : v;
    });
    /*
     * ★**印のあいだに空きを入れない。**1つ＝1投で、10本は必ずストライクかスペアの印になるから
     *   2桁の数字は出てこず、詰めても読み違えない。
     *   空きを入れると 10フレーム目（最大3投）の欄が 212px の枠から溢れる（実測）。
     */
    return out;
  }

  /*
   * ★カーリング型のエンド得点表（利用者指示）。
   * カーリングは**合計点**で勝敗が決まり、得点法も「相手の最内より内側の石の数」なので、
   * 盤面だけ見ても「なぜその勝敗か」が読めない。エンドごとの得点と合計を並べて見せる。
   *
   * @param {boolean} live 対局中なら true。**進行中のエンドの暫定得点**（いま終わったら何点か）を
   *                       「今」の列に出す。結果画面（false）では暫定は出さない。
   */
  function curlScoreHTML(g, live) {
    const cur = g.curling;
    const ends = cur.endScores;                 // 済んだエンドの [席ごとの点]
    // 進行中のエンドの暫定得点（盤にある石で、いま数えたら何点か）
    const prov = (live && !g.over && cur.thrown.some(v => v > 0)) ? RU.curlingEndScore(g) : null;
    const seats = g.players.map((p, i) => i);
    let h = '<div class="cap">' + t('curl.board') + '</div><table><tr><th></th>';
    for (let e = 0; e < ends.length; e++) h += '<th>' + (e + 1) + '</th>';
    if (prov) h += '<th class="now">' + t('curl.nowCol') + '</th>';
    h += '<th class="tot">' + t('curl.totCol') + '</th></tr>';
    seats.forEach(i => {
      const col = RU.CAROM_COLORS[i % RU.CAROM_COLORS.length];
      h += '<tr' + (i === g.turn && live ? ' class="cur"' : '') + '>';
      h += '<td class="nm"><span class="dot" style="background:' + col + '"></span>' + escapeHtml(g.players[i].name) + '</td>';
      ends.forEach(es => { h += '<td>' + (es[i] || 0) + '</td>'; });
      if (prov) h += '<td class="now">' + (prov[i] ? '+' + prov[i] : '·') + '</td>';
      h += '<td class="tot">' + g.players[i].score + '</td></tr>';
    });
    return h + '</table>';
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
  /**
   * 大きく出す見出し。**勝ち・負けは「自分がどちらの側か」の話**なので、
   * どちらの側でもない観戦者には出さない（観戦者に「負け」と出していた）。
   */
  function renderWinArt(won, draw, watching) {
    const panel = $('res-panel'), conf = $('confetti'), head = $('res-headline');
    if (!panel) return;
    panel.classList.toggle('win', !!won);
    const kind = watching ? 'draw' : won ? 'win' : draw ? 'draw' : 'lose';
    head.textContent = watching ? t('res.finished')
      : won ? t('res.win') : draw ? t('res.draw') : t('res.lose');
    head.className = 'ge-title ' + kind;
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
    renderWinArt(S.won, g.winTeam < 0 && !g.failed, S.net.on && S.net.role === 'spectator');
    // 通信対戦のボタンは「部屋へ戻る」。押すと何が起きるかを名前どおりにする
    $('btn-again').textContent = t(S.net.on ? 'res.backRoom' : 'res.again');
    /*
     * 通信対戦では、部屋へ戻らずそのまま次の局へ進める道を出す。
     * **再戦は同意で成立する**ので、このボタンは「そうしたい」と伝えるだけ（castVote）。
     * 押した人の端末がその場で始めていたのを改めた（実機指摘）。
     * 観戦者は当事者ではないので出さない。
     */
    const online = S.net.on && S.net.role !== 'spectator';
    $('choice-cont').style.display = online ? '' : 'none';
    if (online) $('btn-cont').textContent = t('res.rematch');
    renderVotes();
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
      // 抜けた人は名前に印を付ける。負けとだけ出すと、撞き負けたのか抜けたのか分からない
      const who = (g.coop ? teamMark(tm) + '　' : '')
        + members.map(p => p.name + (p.retired ? '（' + t('res.retired') + '）' : '')).join(' ・ ');
      const right = score != null ? label + '　' + score + t('res.pts') : label;
      d.innerHTML = '<span>' + escapeHtml(who) + '</span><span>' + escapeHtml(right) + '</span>';
      body.appendChild(d);
    });
    // カーリング型は結果にもエンド得点表を出す（なぜその合計になったかを見せる）
    if (g.rule === 'G-09' && g.curling) {
      const sb = document.createElement('div'); sb.id = 'curl-board'; sb.style.display = 'block';
      sb.style.marginTop = '10px'; sb.innerHTML = curlScoreHTML(g, false);
      body.appendChild(sb);
    }
    // ボウリング型も結果にスコアシートを出す（合計だけでは中身が読めない）
    if (g.rule === 'G-11' && g.bowling) {
      const sb = document.createElement('div'); sb.id = 'bowl-board'; sb.style.display = 'block';
      sb.style.marginTop = '10px'; sb.innerHTML = bowlScoreHTML(g, false);
      body.appendChild(sb);
    }
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

  /**
   * 部屋の定員を選ぶ欄。
   * 定員は部屋を開いた瞬間に決まり、あとから変えられない（仕様2.6節）。
   * だから**作る前に**決められる場所へ置く。
   * 部屋の中にしか無かったころは、既定の2人のまま部屋が開き、
   * 3人目がいつまでも入れなかった。
   */
  function buildMaxPlayers() {
    const sel = $('in-maxp'); if (!sel) return;
    if (!sel.options.length) {
      for (let n = 2; n <= 4; n++) {
        const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
      }
      sel.onchange = e => { S.net.maxPlayers = +e.target.value; };
    }
    sel.value = String(S.net.maxPlayers);
  }

  function openLobby() {
    show('lobby');
    NET.init({ version: APP_VER, onEvent: onNet });
    NET.refresh();
    refreshServerStatus();
  }

  function onNet(kind, d) {
    if (kind === 'ws-open') {
      S.net.wsOpen = true; S.net.wasClosed = false; refreshServerStatus(); NET.refresh();
      if (S.net.wantRejoin) tryRejoin();
    }
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
      if (S.net.wantRejoin) { S.net.wantRejoin = false; setMsg(t('lobby.rejoined')); }
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
      /*
       * 対局が始まっていたら、誰が来ても対局側は何も変えない。
       * 設定を配り直すと、同じ入力から違う盤面が出る（9.5.3節）。
       * 追いつきたい人は自分から「見せてほしい」と言ってくるので、こちらから押し付けない。
       */
      if (inGame()) return;
      AU.sfx('join');
      showRoom();
      // 人が増えたら合意はやり直し。入ってきた人はまだ何も見ていない
      if (S.net.isHost) { NET.send({ k: 'cfg', config: netConfig() }); clearReady(); }
    } else if (kind === 'participant-left') {
      // 抜けたのが対局者か観戦者かで知らせ方が変わる。名簿を書き換える前に見る
      const gonePid = d.pid || null;
      const wasPlayer = !gonePid ||
        (S.net.roster || []).some(r => r.pid === gonePid && r.role !== 'spectator');
      if (gonePid) markGone(gonePid);
      if (d.roster) S.net.roster = d.roster;
      if (wasPlayer) setMsg(t('lobby.left'));   // 観戦者の出入りは対局者に知らせない
      /*
       * **対局中に対局者が抜けたら、離脱として扱う**（9.8.3節）。
       * 待ち合わせから外すだけでは、抜けた人の手番が回ってきて誰も撞けなくなる。
       * 席を決めるのは主催者なので、判断もここ1か所に置く。
       */
      if (wasPlayer && gonePid && S.net.isHost && S.game && !S.game.over) {
        const seat = S.game.players.findIndex(pl => pl.pid === gonePid);
        if (seat >= 0) retireSeat(seat, 'left');
      }
      /*
       * **結果を見ている最中に抜けたら、「メニューへ戻る」を選んだのと同じ扱い。**
       * 選択を待っている人が、来ない返事を待ち続けて結果画面から動けなくなる。
       */
      if (gonePid && S.net.isHost && S.game && S.game.over) applyVote(gonePid, VOTE_HOME);
      if (resultOpen()) renderResult();
      showRoom();
    } else if (kind === 'disconnected' || kind === 'kicked') {
      /*
       * **切れたときは、必ず「部屋を出た」と土台へ伝える。**
       * 伝えないと、土台は部屋に入ったままのつもりで通信を閉じたまま固まり、
       * アプリを起動し直すまでどの部屋にも入れなくなる
       * （携帯の画面が消えて戻ったときに起きていた）。
       */
      NET.leave();
      S.net.on = false;
      // 追い出された（kicked）ときは戻らない。通信が切れただけなら入り直す
      const canRejoin = kind === 'disconnected' && !S.net.isHost && S.net.last;
      S.net.wantRejoin = canRejoin;
      S.net.rejoinTries = 0;
      setMsg(t(canRejoin ? 'lobby.rejoining' : 'lobby.disconnected'));
      show('lobby');
      if (canRejoin) alertNote(t('lobby.title'), t('lobby.rejoining'));
    } else if (kind === 'error') {
      // 入り直しの最中の失敗は、そのつど窓を出さずに何度か試す
      if (S.net.wantRejoin) { setTimeout(tryRejoin, 2000); return; }
      alertNote(t('lobby.title'), d.msg || '');
    } else if (kind === 'msg') {
      onNetMsg(d.payload, d.from);
    }
  }

  function netConfig() { return JSON.parse(JSON.stringify(S.cfg)); }

  /**
   * 対局者だけへ送る。
   * 待ち合わせの合図と盤面の照合は**対局者どうしの取り決め**であって、
   * 観戦者には用が無い（仕様9.5.8節＝観戦は対局の進行に影響しない）。
   * 全員へ配ると、観戦者が対局者の帳簿を持つことになり、
   * そこから対局へ口を出す経路（盤面のやり直し要求）ができてしまう。
   */
  function sendPlayers(payload) {
    const me = myPid();
    const seats = S.game ? S.game.players : seatList();
    const others = seats.filter(pl => pl.pid !== me);
    if (!others.length) return;                                   // 相手がいない
    // 名札の無い席が混じっているときは全員へ。取りこぼして黙るほうが危ない
    if (others.some(pl => !pl.pid)) { NET.send(payload); return; }
    others.forEach(pl => NET.send(payload, pl.pid));
  }

  /** 盤の前にいるかどうか。対局中に待合室の画面を出してはいけない場面の判定に使う */
  function inGame() { return !!S.game && S.screen === 'play'; }

  /**
   * 対局の途中で抜けた人を、待ち合わせの相手から外す。
   * 抜けたことを知らせずに黙っていると、残った人は返事の来ない相手を永久に待つ。
   * 待っている最中に抜けられた場合は、その場で待ちを解く。
   */
  function markGone(pid) {
    if (!pid) return;
    S.net.gone = S.net.gone || {};
    S.net.gone[pid] = 1;
    const g = S.game;
    if (g && !g.over && S.waitDone === g.shotNo && allDone(g.shotNo)) beginTurn();
  }

  /**
   * 席を対局から外すことを決める（9.8.3節・10.8.4節）。
   *
   * **誰が抜けたかは主催者が決めて配る。**
   * 各端末が自分で名簿を見て数えると、名簿の並びが1つずれた瞬間に
   * 別の席を抜いてしまい、以後すべての端末で手番が食い違う。
   * 席順を配るのと同じ理由で、ここも決めるのは1か所だけにする。
   */
  function retireSeat(idx, reason) {
    if (!S.net.isHost) return;
    const g = S.game; if (!g || g.over) return;
    if (!(idx >= 0 && idx < g.players.length) || g.players[idx].retired) return;
    NET.send({ k: 'retire', idx, reason: reason || '' });
    applyRetire(idx, reason);
  }

  /** 配られた離脱を自分の対局へ反映する。主催者も自分でこれを通る */
  function applyRetire(idx, reason) {
    const g = S.game; if (!g || g.over) return;
    const p = g.players[idx]; if (!p || p.retired) return;
    const name = p.name;
    const wasTurn = g.turn;
    const ended = RU.retirePlayer(g, idx);
    // 抜けた人の返事はもう来ない。待ち合わせの相手からも外す
    if (p.pid) markGone(p.pid);
    setMsg(t(reason === 'dl' ? 'ev.retiredDl' : 'ev.retired', { name }));
    flash(t('ev.retiredShort', { name }), 'warn');
    renderHUD();
    if (ended) { endGameSoon(); return; }
    // 手番が動いたときだけ構え直す。動いていない人まで始め直すと、
    // 同じ手をもう一度知らせることになる
    if (g.turn !== wasTurn) setTimeout(beginTurn, 400);
  }

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
   *
   * **観戦者にはそもそも席が無い**（仕様9.5.8節）。この決めごとはここ1か所に置く。
   * 呼び出す側それぞれに書くと、あとから増えた経路が書き忘れられ、
   * 観戦者に「席が分かりません」と誤って出る。
   */
  function seatIndexOfMe(names) {
    if (S.net.role === 'spectator') return -1;
    const st = NET.state();
    const myPid = (st && st.pid) || S.net.myPid;
    for (let i = 0; i < names.length; i++) if (names[i].pid && names[i].pid === myPid) return i;
    if (S.net.isHost) return 0;
    if (S.net.myIdx >= 0 && S.net.myIdx < names.length) return S.net.myIdx;
    alertNote(t('lobby.title'), t('lobby.noSeat'));
    return -1;
  }
  /**
   * 配られた席順に自分が入っているか。
   * **再戦に同意しなかった人の端末は、その局に入ってはいけない。**
   * 入ると席が無いまま盤を見せられ、誰の番でもない画面で止まる。
   * 観戦者にはそもそも席が無い（全部の局を見る）ので、ここでは外さない。
   */
  function seatedInList(names) {
    if (S.net.role === 'spectator') return true;
    const list = names || [];
    if (!list.some(x => x.pid)) return true;    // 席にIDが無い古い経路は素通し
    const me = myPid();
    return !me || list.some(x => x.pid === me);
  }

  function onNetMsg(p, from) {
    if (!p || !p.k) return;
    if (p.k === 'cfg') {
      // 対局が始まってから設定を入れ替えると、同じ入力から違う盤面が出る（9.5.3節）
      if (inGame()) return;
      Object.assign(S.cfg, p.config); showRoom(); buildSetup(); return;
    }
    if (p.k === 'ready') { setReady(p.pid || from, !!p.ok); return; }
    /*
     * ★結果画面の選択（再戦する／部屋へ戻る／メニューへ戻る）。
     * **集めて配るのは主催者だけ**（ゲスト同士は直につながっているとは限らない）。
     * 始めるかどうかの判断も主催者の中（applyVote → maybeStartRematch）で1回だけ行う。
     */
    if (p.k === 'vote') { applyVote(p.pid || from, p.v); return; }
    if (p.k === 'vmap') {
      /*
       * **自分の選択が入っていない表が来たら、もう一度出す。**
       * 局が終わる時刻は端末ごとに違う（玉が止まるまでの見え方が人ごとに違うため）。
       * 先に終わった人の選択が、あとから終わった主催者の「まっさらにする」で消える。
       * 黙って消えると、その人だけが永久に未選択のまま残る。
       */
      const me = myPid(), mine = me ? (S.net.vote || {})[me] : '';
      S.net.vote = p.map || {};
      if (mine && me && !S.net.vote[me]) {
        S.net.vote[me] = mine;
        if (!S.net.isHost) NET.send({ k: 'vote', v: mine, pid: me }, 'host');
      }
      if (resultOpen()) renderResult();
      return;
    }
    if (p.k === 'rmap') { S.net.ready = p.map || {}; showRoom(); return; }
    if (p.k === 'done') {
      markDone(p.pid || from, p.n);
      // 待っていた手がそろったら、そこから始める
      if (S.game && S.waitDone === S.game.shotNo && allDone(S.game.shotNo)) beginTurn();
      return;
    }
    if (p.k === 'need') {
      if (!S.net.isHost || !S.game) return;
      /*
       * 追いつき直しも**頼んだ人への返事**。局まるごとを組み直す重い処理なので、
       * 関係のない人に届いて走らせてしまうと、進行中の手を取り上げることになる。
       *
       * **いまの盤面そのものを一緒に送る。**
       * 履歴（入力の並び）だけを送ると、受け取った側は入力から計算し直すので、
       * その端末にずれの原因があると**同じずれを何度でも作り直してしまう**。
       * 最後に本物の盤面を被せることで、追いつき直しは必ず正しい形で終わる。
       */
      NET.send({
        k: 'sync', for: from || null, seed: S.game.seed, config: netConfig(),
        // この局がバンキングから始まったのかどうかも渡す。
        // これが無いと、追いつき直した端末だけがバンキングの盤（人数ぶんの手玉）を作り、
        // 配られた盤面と玉の顔ぶれが合わなくなる
        cont: !!S.game.cont,
        names: S.game.players.map(x => ({
          name: x.name, type: x.type, pid: x.pid || null, retired: !!x.retired, team: x.team,
        })),
        log: S.game.history,
        resN: S.game.shotNo, result: resultSnapshot(S.game),
      }, from || 'all');
      return;
    }
    if (p.k === 'start') {
      S.net.ready = {};                     // 局が始まったら準備完了の印は下ろす
      // 席に自分がいない局には入らない（再戦に同意せず部屋へ戻った人）
      if (!seatedInList(p.names)) { closeResult(); backToRoom(); return; }
      S.net.myIdx = seatIndexOfMe(p.names);
      startGame(p.seed, p.names, p.config, !!p.cont);
      return;
    }
    if (p.k === 'sync') {
      if (p.for && p.for !== myPid()) return;   // 自分が頼んだ追いつき直しでなければ触らない
      setMsg(t('lobby.syncing'));
      S.net.myIdx = seatIndexOfMe(p.names);
      /*
       * **届いて待っている手は、並べ直しをまたいで持ち越す。**
       * 頼んでから履歴が届くまでのあいだに撞かれた手は、
       * 履歴にはまだ載っておらず、手元の預かりにだけある。
       * ここで捨てると、その1手だけ永久に抜け落ちる。
       * 抜けた玉は盤に残り続け、以後の手はすべて違う盤面で判定されて
       * 反則が出続ける（実機で観戦者に起きていた形）。
       */
      const heldShots = S.pendingShots || {};
      startGame(p.seed, p.names, p.config, !!p.cont);
      // 並べ直しのあいだは黙らせる。途中で例外が出ても必ず元へ戻す
      S.catchUp = true;
      try { for (const rec of (p.log || [])) replayRecord(rec); }
      finally { S.catchUp = false; }
      /*
       * 並べ直しの最後に、**送られてきた本物の盤面を被せる**。
       * 入力から計算し直した結果ではなく、これを正解として先へ進む。
       */
      if (p.result && p.resN != null) {
        applyBoard(Object.assign({}, p.result, { n: p.resN }), true);
      }
      S.chk = {}; S.results = {};              // 古い照合・結果は捨てる
      // 並べ直したところより先の手だけを預かりへ戻す（済んだ手は捨てる）
      for (const k in heldShots) {
        if (+k >= S.game.shotNo) S.pendingShots[k] = heldShots[k];
      }
      renderHUD();
      if (S.game.over) { endGame(); return; }   // 終わった局に追いついたときは結果を出す
      beginTurn();
      return;
    }
    if (p.k === 'shot') {
      if (!S.game) { requestResync(); return; }
      /*
       * 相手のほうが先へ進んでいることがある（玉の転がる速さは人ごとに違い、
       * ジャンプ中はさらに遅くなるため）。まだ追いついていないだけなら、
       * その手を預かって、こちらがその番号に達したときに指す。
       * ここで盤面の作り直しを求めると、速さを変えている人だけが
       * 毎手やり直しになってしまう。
       */
      if (p.n > S.game.shotNo) { S.pendingShots[p.n] = p; return; }
      if (p.n < S.game.shotNo) { requestResync(); return; }
      S.shotMine = false;                 // 相手の手。結果は撞いた人が配る
      applyShot(p.shot, p.place, true);
      return;
    }
    if (p.k === 'timeout') {
      if (!S.game || S.game.shotNo !== p.n) { requestResync(); return; }
      onTimeout(false);
      return;
    }
    // 観戦者は手番を持たない＝やり直しの当事者ではない（9.5.8節）。確認そのものを出さない
    if (p.k === 'dl-open') { if (S.net.role !== 'spectator') openDeadlockVote(); return; }
    if (p.k === 'dl-vote') { tallyVote(p.idx, !!p.ok); return; }
    if (p.k === 'dl-cancel') { $('modal-dl').classList.remove('on'); setMsg(t('dl.refused')); return; }
    if (p.k === 'dl-redo') { $('modal-dl').classList.remove('on'); redoRack(); return; }
    // 誰が抜けたかは主催者が決めて配る（9.8.3節）。受け取った側は数え直さない
    if (p.k === 'retire') { $('modal-dl').classList.remove('on'); applyRetire(p.idx, p.reason); return; }
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
    if (p.k === 'res') {
      /*
       * 撞いた人が配った「その手の結果」。
       * **自分がその手を見終わってから**合わせる。転がっている最中に入れ替えると、
       * そのあと自分の後始末が重なって手番が二重に進む。
       */
      if (!S.game || p.n == null) return;
      S.results[p.n] = p;
      if (S.phase !== 'rolling' && S.game.shotNo === p.n && adoptResult(p.n)) {
        // 自分の後始末より遅れて届いた場合。手番を始め直して、正しい盤面から構える
        if (S.game.over) endGameSoon();
        else setTimeout(beginTurn, 30);
      }
      return;
    }
    if (p.k === 'reboard') {
      if (!S.net.isHost || !S.game) return;
      /*
       * 盤面の作り直しは**頼んだ人ひとりへの返事**である。
       * 全員へ配ると、ずれていない対局者の盤面まで書き換わる。
       * とくに玉が転がっている最中の人に届くと、配られた盤面で手番が進んだ上に
       * その人自身の後始末がもう一段重なり、手番と手数が二重に進んで
       * 双方が「相手の手番です」のまま止まる。
       * 宛先の名札を荷物にも書いておき、受け取る側でも自分宛かを見る。
       */
      NET.send({
        k: 'board', for: from || null,
        board: boardSnapshot(), turn: S.game.turn, n: S.game.shotNo,
        scores: S.game.players.map(x => x.score), bih: S.game.ballInHand,
      }, from || 'all');
      return;
    }
    if (p.k === 'board') {
      if (!S.game) return;
      if (p.for && p.for !== myPid()) return;   // 自分が頼んだ作り直しでなければ触らない
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
  /**
   * 配られた盤面で自分の盤面を入れ替える。
   *
   * **入れ替えたら、いま進めていた手はもう無かったことにする。**
   * 玉が転がっている最中に入れ替えると、玉は止まった状態になる。
   * そのまま放っておくと主ループが「止まった＝撞き終わった」と読んで後始末を走らせ、
   * 配られた盤面ですでに進んでいる手番の上に、もう一段手番と手数を進めてしまう。
   * 実測ではこれで主催者6手目・相手7手目にずれ、双方が相手を待って止まった。
   */
  /**
   * @param {boolean} settled 撞き終わった直後に「正解へ合わせる」ために呼ばれたか。
   *   その場合は進めていた手はもう片付いているので、捨てる処理も手番の始め直しもしない。
   */
  function applyBoard(p, settled) {
    const g = S.game;
    /*
     * **玉の顔ぶれを先に合わせる。**
     * バンキングが終わると盤を組み直すので、玉の顔ぶれ自体が入れ替わる。
     * 配られた側が終えていてこちらがまだなら、同じ手順で組み直してから位置を当てる。
     * 位置は玉の番号で当てるので、顔ぶれが違うまま当てると当たらず、
     * 「配られたのに盤が古いまま」になる。
     */
    if (p.bank && g.bank) {
      if (g.bank.on && !p.bank.on) RU.endBanking(g, p.bank.winner);
      g.bank.on = !!p.bank.on;
      g.bank.marks = p.bank.marks || g.bank.marks;
      g.bank.shotBy = p.bank.shotBy || {};
      g.bank.winner = p.bank.winner;
    }
    const byId = {}; g.world.balls.forEach(b => byId[b.id] = b);
    (p.board || []).forEach(o => {
      const b = byId[o.i]; if (!b) return;
      b.x = o.x; b.y = o.y; b.z = 0; b.state = o.s;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
      b.onTable = (o.s === 'live');
    });
    if (p.scores) p.scores.forEach((s, i) => { if (g.players[i]) g.players[i].score = s; });
    if (p.groups) p.groups.forEach((v, i) => { if (g.players[i]) g.players[i].group = v; });
    if (p.fouls) p.fouls.forEach((v, i) => { if (g.players[i]) g.players[i].fouls = v; });
    if (p.ret) p.ret.forEach((v, i) => { if (g.players[i]) g.players[i].retired = !!v; });
    if (p.turn != null) g.turn = p.turn;
    if (p.n != null) g.shotNo = p.n;
    if (p.bih != null) g.ballInHand = !!p.bih;
    if (p.bihFull != null) g.ballInHandFull = !!p.bihFull;
    if (p.broken != null) g.broken = !!p.broken;
    if (p.winTeam != null) g.winTeam = p.winTeam;
    if (p.over != null) g.over = !!p.over;
    if (p.dl != null) g.deadlockCount = p.dl;
    if (settled) { renderHUD(); return; }

    // 進めていた手を捨てる。後始末（finishShot）を走らせないために転がりを終わらせる
    S.phase = 'idle';
    S.dropped = null; S.bursts = []; S.airZ = {}; S.stepAcc = 0;
    S.replayRun = null; S.pendingPlace = null; S.drag = null;
    // 預かってある先の手と照合は、**捨てるのは古いぶんだけ**。
    // 丸ごと捨てると、まだ来ていない先の手を待ち続けることになる
    for (const k of Object.keys(S.pendingShots)) if (+k < g.shotNo) delete S.pendingShots[k];
    for (const k of Object.keys(S.chk)) if (+k < g.shotNo) delete S.chk[k];
    if (S.waitTimer) { clearTimeout(S.waitTimer); S.waitTimer = null; }
    S.waitDone = null; S.readyShot = null; S.forceShot = null;
    if (S.bowlTimer) { clearTimeout(S.bowlTimer); S.bowlTimer = null; }
    S.bowlBox = false;
    renderHUD();
    if (!g.over) setTimeout(beginTurn, 60); // 配られた盤面から、あらためて手番を始める
  }
  function replayRecord(rec) {
    if (rec.timeout) {
      S.game.shotNo++;
      RU.nextTurn(S.game, { continueTurn: false });
      return;
    }
    S.shotMine = false;                   // 並べ直しの手。結果は配らない
    applyShot(rec.shot, rec.place, false);
  }
  /**
   * 追いつき直しを頼む。
   * **同じ手で何度も頼まない。** 局まるごとを並べ直す重い処理なので、
   * 頼むたびに走らせると、直っていないあいだじゅう並べ直し続けることになる。
   * 手が1つ進めば、あらためて頼める。
   */
  /** 次の手がもう届いて待っているか。観戦者が追いつく判断に使う */
  function hasWaitingShot() {
    for (const k in S.pendingShots) if (S.pendingShots[k]) return true;
    return false;
  }

  function requestResync() {
    if (S.net.isHost) return;
    const n = S.game ? S.game.shotNo : -1;
    if (S.lastNeed === n) return;
    S.lastNeed = n;
    NET.send({ k: 'need' }, 'host');
  }

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
    if (boardHash() === h) return;
    /*
     * ずれていたときの直し方は、立場で分かれる。
     * **観戦者は対局の盤面に手を出さない**（9.5.8節＝観戦は対局の進行に影響しない）。
     * 自分の側で最初から引き直す。頼まれた側は履歴をその人ひとりへ返すだけなので、
     * 対局者の盤面には触れない。
     * 対局者だけが「盤面を作り直して」と頼める。
     */
    if (S.net.role === 'spectator') { requestResync(); return; }
    NET.send({ k: 'reboard' }, 'host');
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
        // 定員は入る前に分かる必要がある。満員の部屋へ「参加」を押しても弾かれるだけ
        '<div class="meta">' + escapeHtml((r.hostName || '') + ' / v' + ver +
          (r.maxPlayers ? ' / ' + t('lobby.maxPlayers') + ' ' + r.maxPlayers : '')) + '</div>';
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
    // 入った部屋を憶えておく。通信が切れたときに、ここへ入り直す
    S.net.last = { roomId: room.id, password: pw, role, name: myName() };
    NET.joinRoom(room.id, pw, myName(), role);
  }

  /**
   * 通信が切れたあと、元いた部屋へ入り直す。
   * 携帯は画面が消えると通信も切れる。戻ってくるたびに手で入り直すのは現実的でない。
   * 何度か試して駄目なら、黙って諦めずに画面へ出す。
   */
  const REJOIN_TRIES = 5;
  function tryRejoin() {
    const last = S.net.last;
    if (!S.net.wantRejoin || !last || !S.net.wsOpen) return;
    if ((S.net.rejoinTries || 0) >= REJOIN_TRIES) {
      S.net.wantRejoin = false;
      alertNote(t('lobby.title'), t('lobby.rejoinFail'));
      return;
    }
    S.net.rejoinTries = (S.net.rejoinTries || 0) + 1;
    NET.refresh();                       // 版番号の照合に一覧が要るので、先に取り直す
    setTimeout(() => {
      if (!S.net.wantRejoin) return;
      const ok = NET.joinRoom(last.roomId, last.password, last.name, last.role);
      if (!ok) setTimeout(tryRejoin, 2000);
      else setTimeout(() => { if (S.net.wantRejoin) tryRejoin(); }, 4000);  // 返事が無ければもう一度
    }, 800);
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
  // ══════════════════════════════════════════════
  //  再戦の合意（結果画面の投票・利用者指示）
  // ══════════════════════════════════════════════
  /*
   * **再戦は同意で成立する。**押した人の端末がその場で次の局を始める作りだったので、
   * まだ結果を見ている人が盤を取り上げられていた（実機指摘）。
   *
   * 決め方は待合室の「準備完了」と同じ形にした。
   *   ・対局者は 再戦する／部屋へ戻る／メニューへ戻る のどれかを選ぶ（＝投票）
   *   ・投票は主催者へ送り、**主催者が集めた表を全員へ配る。**
   *     ゲスト同士が直につながっているとは限らないので、各自が配ると届かない相手が出る
   *   ・全員が選び終えた時点で、**「再戦する」を選んだ人だけ**で次の局を始める（利用者指示）
   *   ・残る人が1人になったら対局が成り立たないので、そのときは押せなくする
   *   ・**主催者が戻った場合も再戦はできない。**局を配れるのも、追いつき直しを
   *     組み直せるのも主催者の端末だけで、主催者の居ない局は進められない
   *   ・抜けた人・切れた人は「戻る」を選んだのと同じ扱い（返事を待ち続けない）
   */
  const VOTE_AGAIN = 'again', VOTE_ROOM = 'room', VOTE_HOME = 'home';

  /** 主催者の参加者ID。名簿が空の経路では自分が主催者かどうかで代える */
  function hostPid() {
    const r = (S.net.roster || []).find(x => x.role === 'host');
    return r ? r.pid : (S.net.isHost ? myPid() : null);
  }
  /** 投票する人＝いま終わった局の席に着いていた人。観戦者には席が無いので入らない */
  function voteSeats() {
    const g = S.game;
    if (!g || !g.players) return [];
    return g.players.filter(p => p.pid && p.type === 'human');
  }
  /**
   * その人の選択。**抜けた人・名簿から消えた人は「メニューへ戻る」と同じ扱い。**
   * 返事の来ない相手を待ち続けると、残った全員が結果画面から動けなくなる。
   */
  function voteOf(pid) {
    if (!pid) return '';
    if (S.net.gone && S.net.gone[pid]) return VOTE_HOME;
    const roster = S.net.roster || [];
    if (roster.length && !roster.some(r => r.pid === pid)) return VOTE_HOME;
    return (S.net.vote || {})[pid] || '';
  }
  /** いまの投票の内訳と、再戦がまだ成り立つかどうか */
  function rematchState() {
    const seats = voteSeats(), hp = hostPid();
    const again = [], undecided = [];
    seats.forEach(p => {
      const v = voteOf(p.pid);
      if (v === VOTE_AGAIN) again.push(p);
      else if (!v) undecided.push(p);
    });
    const hostSeated = !!hp && seats.some(p => p.pid === hp);
    const hv = hp ? voteOf(hp) : VOTE_HOME;
    const hostOk = hostSeated && (hv === VOTE_AGAIN || !hv);
    return {
      seats, again, undecided, hostSeated, hostOk,
      possible: hostOk && (again.length + undecided.length) >= 2,
    };
  }
  /** 局が終わるたびに投票をまっさらにする。前の局の選択が残ると勝手に始まる */
  function voteReset() {
    S.net.vote = {};
    if (S.net.on && S.net.isHost) NET.send({ k: 'vmap', map: {} });
  }
  /** 主催者だけが表を書き換えて配る（席順を配るのと同じ理由：決めるのは1か所） */
  function applyVote(pid, v) {
    if (!S.net.isHost || !pid) return;
    S.net.vote = S.net.vote || {};
    if (v) S.net.vote[pid] = v; else delete S.net.vote[pid];
    NET.send({ k: 'vmap', map: S.net.vote });
    if (resultOpen()) renderResult();
    maybeStartRematch();
  }
  /** 自分の選択を出す。手元にも先に映す（主催者の返事を待って固まらないように） */
  function castVote(v) {
    const me = myPid();
    if (!S.net.on || !me) return;
    if (S.net.isHost) { applyVote(me, v); return; }
    S.net.vote = S.net.vote || {};
    S.net.vote[me] = v;
    NET.send({ k: 'vote', v, pid: me }, 'host');
    if (resultOpen()) renderResult();
  }
  /** 全員が選び終えて、再戦する人が2人以上そろったら始める（主催者の端末だけ） */
  function maybeStartRematch() {
    if (!S.net.isHost || !S.game || !S.game.over || !resultOpen()) return;
    const st = rematchState();
    if (st.undecided.length || !st.possible || st.again.length < 2) return;
    // 結果画面は startGame の側で必ず畳まれる。始まらなかったときは開けたまま残す
    startNetGame(contOrder(), true, st.again.map(p => p.pid));
  }
  /**
   * 誰が何を選んだかを、**その選択肢のボタンの真下に名前で出す**（利用者指示）。
   * 別の場所に一覧を置くと、ボタンとの対応を目で結び直さないと読めない。
   */
  function renderVotes() {
    const wa = $('who-again'), wr = $('who-room'), wh = $('who-home'), note = $('res-vote-note');
    const btn = $('btn-cont');
    if (!wa || !wr || !wh || !note) return;
    if (!S.net.on || !S.game) {
      wa.textContent = wr.textContent = wh.textContent = ''; note.textContent = '';
      if (btn) btn.disabled = false;        // 前の通信対局の灰色を持ち越さない
      return;
    }
    const me = myPid(), st = rematchState();
    const nameOf = p => (p.pid === me ? t('res.voteYou') : p.name);
    const pick = v => st.seats.filter(p => voteOf(p.pid) === v).map(nameOf).join('\n');
    wa.textContent = pick(VOTE_AGAIN);
    wr.textContent = pick(VOTE_ROOM);
    wh.textContent = pick(VOTE_HOME);
    const mine = voteOf(me);
    if (btn) btn.disabled = !st.possible || mine === VOTE_AGAIN;
    note.textContent =
      !st.possible ? t(st.hostOk ? 'res.voteOffAlone' : 'res.voteOffHost')
        : st.undecided.length ? t('res.voteNone', { names: st.undecided.map(nameOf).join('、') })
          : mine === VOTE_AGAIN ? t('res.voteWait') : '';
  }

  /**
   * @param {Array}   order 席順を指定して始める（続きの局）。省略すると名簿から作る
   * @param {boolean} cont  続きの局か（バンキングをしない）
   * @param {Array}   only  参加する人の参加者IDだけに絞る（再戦に同意した人だけの局）
   */
  function startNetGame(order, cont, only) {
    /*
     * 続きの局では前回の席順を回したものを使う。ただし**いま部屋にいる人だけ**にする。
     * 抜けた人を席に残すと、その人の番を全員が待ち続けることになる。
     * 逆に、前回いなかった人が入っていれば末尾へ足す。
     */
    let names = seatList();
    if (order && order.length) {
      const here = {}; names.forEach(x => { if (x.pid) here[x.pid] = x; });
      const kept = order.filter(x => x.pid && here[x.pid]);
      const added = names.filter(x => !order.some(o => o.pid === x.pid));
      const merged = kept.concat(added);
      if (merged.length) names = merged;
    }
    /*
     * 再戦に同意した人だけの局。**同意しなかった人を席に残さない。**
     * 残すと、部屋へ戻った人の番が回ってきて誰も撞けなくなる。
     * 席から外れた人は start を受け取っても入らない（seatedInList）。
     *
     * **絞った結果が2人に満たなければ、始めない**（同意した人が部屋から居なくなった場合）。
     * ここで「絞る前の顔ぶれ」に戻す逃げ道を作ると、戻ると言った人を巻き込んで始めてしまう。
     */
    if (only && only.length) {
      names = names.filter(x => x.pid && only.indexOf(x.pid) >= 0);
      if (names.length < 2) return false;
    }
    const seed = newSeed();
    NET.send({ k: 'start', seed, config: netConfig(), names, cont: !!cont });
    /*
     * 準備完了の印は、局が始まった時点で全員ぶん下ろす。
     * 押したままにしておくと、局が終わって誰かが部屋へ戻って押し直した瞬間に
     * 「全員そろった」と見えて、まだ結果を見ている人を置いて次の局が始まる。
     */
    S.net.ready = {};
    NET.send({ k: 'rmap', map: {} });
    S.net.myIdx = seatIndexOfMe(names);
    startGame(seed, names, null, !!cont);
    return true;
  }

  /**
   * 対局が終わったあと、次の局のために部屋へ戻る。
   * 通信対戦では「もう一度」を自分の端末だけで始めるわけにいかない
   * （他の端末は付いてこられず、別々の盤を見ることになる）。
   * 全員が部屋へ戻り、あらためて準備完了を押したところから始める。
   */
  function backToRoom() {
    S.game = null;                          // これを残すと「対局中は盤から離れない」に阻まれる
    S.phase = 'idle';
    S.replay = null; S.replayRun = null; S.demo = null; S.endWait = 0;
    S.msg = '';
    showRoom();
  }

  function showRoom() {
    /*
     * **対局中は盤から離れない。**
     * 待合室の画面を出す用事（人の出入り・設定の配布・準備の取り消し）は
     * いくつもの経路から来る。呼ぶ側それぞれで「いま対局中か」を見る作りにすると、
     * あとから増えた経路が必ず書き漏れる。ここ1か所で囲う。
     * 観戦者が1人出入りしただけで対局者全員が盤を取り上げられていたのがこれ。
     */
    if (inGame()) return;
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
    $('in-speed').value = speedToPos(animSpeed());
    $('speed-val').textContent = animSpeed().toFixed(2) + '×';
    $('modal-settings').classList.add('on');
  }
  $('btn-set-close').onclick = () => $('modal-settings').classList.remove('on');
  $('vol-bgm').oninput = e => AU.setBgmVolume(+e.target.value);
  $('vol-sfx').oninput = e => AU.setSfxVolume(+e.target.value);
  $('mute-bgm').onchange = e => AU.setMuted('bgm', e.target.checked);
  $('mute-sfx').onchange = e => AU.setMuted('sfx', e.target.checked);
  $('in-speed').oninput = e => {
    const pos = +e.target.value;
    const v = posToSpeed(pos);
    if (v === 1 && pos !== 50) e.target.value = 50;    // 等速の近くでは吸い付かせる
    setAnimSpeed(v);
  };
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
        // 台の姿はルール名を書かずに引く。キャロム版で遊ぶルールは1つとは限らない
        if (SPECIAL.shape[S.cfg.shape]) { S.cfg.shape = 'A-01'; S.cfg.carom = caromForRule(S.cfg.rule); S.cfg.tableChosen = true; }
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
  [].forEach.call($('seg-break').children, b => {
    b.onclick = () => { AU.sfx('select'); S.cfg.breakRule = b.dataset.v; buildSetup(); };
  });
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
      maxPlayers: S.net.maxPlayers,      // 定員はここで決まる。あとから変えられない
      config: netConfig(),
    });
  };
  $('btn-refresh').onclick = () => NET.refresh();

  $('btn-quit').onclick = () => {
    if (S.net.on) { NET.leave(); S.net.on = false; }
    show('home');
  };
  $('btn-deadlock').onclick = () => { if (isMyTurn()) askDeadlock(); };
  // デモは設定の中に置いてある。押したら設定の窓を閉じてから始める（窓が写り込むため）
  $('btn-demo').onclick = () => { AU.sfx('button'); $('modal-settings').classList.remove('on'); startDemo(); };
  $('btn-replay').onclick = () => {
    if (!S.replay) return;
    const w = E.createWorld(S.game.table, S.replay.balls.map(b => Object.assign({}, b)), S.game.tuning);
    const cue = w.balls.find(b => b.kind === 'cue' && (S.game.rule !== 'G-04' || b.owner === S.replay.turn));
    if (!cue) return;
    E.applyCue(cue, S.replay.shot);
    S.replayRun = w;
  };
  $('btn-again').onclick = () => {
    AU.sfx('button');
    // 通信対戦では「部屋へ戻る」。**戻ることも選択の1つ**なので、出る前に必ず伝える
    if (S.net.on) { castVote(VOTE_ROOM); closeResult(); backToRoom(); return; }
    closeResult();
    // 続きの局。バンキングはやり直さず、ブレイク権の決め方で席順を回す
    startGame(newSeed(), contOrder(), null, true);
  };
  /**
   * 通信対戦の「再戦する」。**押しても始まらない。**選択を出すだけ。
   * 全員が選び終えて、再戦する人が2人以上そろったときに、主催者の端末が始めて配る
   * （各端末が勝手に始めると別々の盤を見ることになる。席順を配るのも主催者だけ）。
   */
  $('btn-cont').onclick = () => {
    if (!S.net.on || !S.game) return;
    AU.sfx('button');
    castVote(VOTE_AGAIN);
  };
  $('btn-to-setup').onclick = () => {
    AU.sfx('button');
    /*
     * メニューへ戻る＝この部屋から抜ける。
     * **抜けることを土台へ伝えてから出る。**伝えずに画面だけ切り替えていたので、
     * 残った人からは、その人がまだ部屋に居るように見え続けていた。
     */
    if (S.net.on) { castVote(VOTE_HOME); NET.leave(); S.net.on = false; }
    closeResult(); show('home');
  };
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
    window.BL = { S, E, RU, T, I, fire: fireShot, shootNow, beginTurn, startGame, finishShot, applyShot, draw2D, draw3D, drawElevPic, minElevFor, computeElevFan, placeOk, resizeBoard, show, showRoom, watchJumps, highestBall, startDemo, stepDemo, endGame, endGameSoon, buildSetup, mountSetup, onNetMsg, seatList, seatIndexOfMe };
  }
})();
