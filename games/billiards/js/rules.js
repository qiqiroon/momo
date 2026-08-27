/**
 * MOMO Billiards — ルール仕様と例外処理
 * 仕様書 momo_billiards_spec.md 第7章（ルール）／第10章（例外処理）
 *
 * 第1段階の対象は既存4ルール。
 *   G-01 ナインボール／G-02 エイトボール／G-03 ポケット・ローテーション／G-04 キャロム
 *
 * 共通ファウル V-01〜V-09 を1か所に置き、ルールごとに適用の有無だけを持つ（7.2.3節）。
 * ルールごとに独自のファウルは定義しない。
 */
const BilliardsRules = (() => {
  'use strict';

  const T = BilliardsTable, E = BilliardsEngine;

  // 玉の配色。現実のビリヤード球に合わせる（アイコンと同じ考え方＝識別性を優先）
  const BALL_COLORS = {
    1: '#f2c00e', 2: '#1d4ed8', 3: '#dc2626', 4: '#7c3aed', 5: '#ea6a0c',
    6: '#15803d', 7: '#7f1d1d', 8: '#1c1c1c', 9: '#f2c00e', 10: '#1d4ed8',
    11: '#dc2626', 12: '#7c3aed', 13: '#ea6a0c', 14: '#15803d', 15: '#7f1d1d',
  };
  const CAROM_COLORS = ['#f4f4f4', '#f2c00e', '#8fd14f', '#60a5fa', '#c084fc', '#f472b6'];

  const RULE_IDS = ['G-01', 'G-02', 'G-03', 'G-04'];

  // 適用するファウル（7.2.4節）。第1段階の4ルールぶんだけを持つ。
  const FOUL_TABLE = {
    'G-01': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-02': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-03': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-04': { 'V-01': 1, 'V-02': 0, 'V-03': 0, 'V-04': 0, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
  };

  // 罰則の分類（7.2.5節）
  const PENALTY = { 'G-01': 'freeball', 'G-02': 'freeball', 'G-03': 'freeball', 'G-04': 'score' };
  // 勝敗の決まり方（7.2.8節）
  const WIN_KIND = { 'G-01': 'reach', 'G-02': 'reach', 'G-03': 'points', 'G-04': 'reach' };

  /**
   * 点数を数えるルールかどうか。
   * ナインボール・エイトボールは「どの玉を落としたか」で決まり点数を持たない。
   * 持たないルールで 0 点と出し続けると、壊れているように見える。
   */
  const HAS_SCORE = { 'G-01': false, 'G-02': false, 'G-03': true, 'G-04': true };
  // ラックを持つか（7.2.7節）
  const HAS_RACK = { 'G-01': true, 'G-02': true, 'G-03': true, 'G-04': false };
  // ポケットあり台が要るか
  const NEEDS_POCKETS = { 'G-01': true, 'G-02': true, 'G-03': true, 'G-04': false };

  // ───────── 決定論的な擬似乱数（5.2.4節。1ゲーム1シード） ─────────
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // ───────── ゲームの生成 ─────────
  /**
   * @param {object} cfg { rule, hasPockets, players:[{name,type}], seed, tuning, difficulty,
   *                       target(点数目標), handicaps }
   */
  function createGame(cfg) {
    const table = T.make(cfg.hasPockets);
    const game = {
      rule: cfg.rule,
      table,
      seed: cfg.seed >>> 0,
      rng: makeRng(cfg.seed),
      difficulty: cfg.difficulty || 'easy',
      tuning: cfg.tuning,
      /*
       * 協力プレイ（9.7節）は「勝ち負けを見る相手を、個人からチームへ差し替える」だけの仕組み。
       * そこで、協力プレイでないときは「1人＝1チーム」として同じ道を通す。
       * こうしないと、ルールごとに個人用とチーム用の2本の判定が並ぶことになる。
       */
      coop: !!cfg.coop,
      shotLimit: cfg.shotLimit || 0,    // 相手チームがいないときの規定打数（9.7.3節）
      players: cfg.players.map((p, i) => ({
        idx: i, name: p.name, type: p.type,
        // 参加者IDは席の正体。局を組み直すときに配り直すので、対局にも持たせておく。
        // ここで落とすと、組み直した瞬間に全員が自分の席を見失う
        pid: p.pid || null,
        team: (cfg.coop && cfg.teams && cfg.teams[i] != null) ? cfg.teams[i] : i,
        score: 0, group: null, fouls: 0,
        target: (cfg.targets && cfg.targets[i] != null) ? cfg.targets[i] : defaultTarget(cfg.rule),
        baseLeft: 0, bankLeft: 0,
      })),
      winTeam: -1,
      turn: 0,
      shotNo: 0,
      inningNo: 0,
      broken: false,
      open: cfg.rule === 'G-02',       // エイトボールのオープン状態
      ballInHand: true,                // 開始時は手玉を置く（ブレイク位置）
      ballInHandFull: false,           // フリーボール（台全体）か、ブレイク配置か
      over: false, winner: -1, ranking: [], failed: false,
      lastFouls: [], lastPocketed: [], lastMessageKey: null,
      deadlockCount: 0, redoCount: 0,
      history: [],                      // 入力列（リプレイ・通信同期の正体）
      world: null,
    };
    setupBalls(game);
    return game;
  }

  function defaultTarget(rule) {
    if (rule === 'G-04') return 10;    // キャロムの目標点（付録B送りの値。実測で調整可）
    return 0;
  }

  function setupBalls(game) {
    const table = game.table;
    const balls = [];
    let id = 0;
    const R = T.R;

    if (game.rule === 'G-04') {
      const pos = T.caromPositions(table, game.players.length);
      pos.cues.forEach((c, i) => {
        balls.push(E.makeBall({
          id: id++, num: 0, kind: 'cue', owner: i, r: R,
          x: c.x, y: c.y, color: CAROM_COLORS[i % CAROM_COLORS.length],
        }));
      });
      pos.reds.forEach(p => {
        balls.push(E.makeBall({ id: id++, num: 0, kind: 'object', r: R, x: p.x, y: p.y, color: '#dc2626' }));
      });
      // 定位置を覚えておく（10.2.5節）
      balls.forEach((b, i) => { b.home = { x: b.x, y: b.y }; });
      game.ballInHand = false;
    } else {
      // 手玉
      const cue = E.makeBall({ id: id++, num: 0, kind: 'cue', r: R, x: table.headSpot.x, y: 0, color: '#f4f4f4' });
      balls.push(cue);
      let rack;
      if (game.rule === 'G-01') {
        rack = T.rackDiamond(table, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      } else if (game.rule === 'G-02') {
        rack = T.rackTriangle(table, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 8);
      } else {
        rack = T.rackTriangle(table, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 15);
      }
      rack.forEach(r => {
        balls.push(E.makeBall({
          id: id++, num: r.num, kind: 'object', r: R, x: r.x, y: r.y,
          color: BALL_COLORS[r.num] || '#cccccc', stripe: r.num >= 9,
        }));
      });
      game.ballInHand = true;
      game.ballInHandFull = false;
    }
    game.world = E.createWorld(table, balls, game.tuning);
  }

  function cueBallOf(game, playerIdx) {
    if (game.rule === 'G-04') {
      return game.world.balls.find(b => b.kind === 'cue' && b.owner === playerIdx) || null;
    }
    return game.world.balls.find(b => b.kind === 'cue') || null;
  }

  function liveObjects(game) {
    return game.world.balls.filter(b => b.kind === 'object' && b.state === 'live');
  }

  /** そのプレイヤーが最初に当てるべき玉（7.3.2節・7.4.2節・7.5.2節）。null＝制約なし */
  function legalTargets(game, playerIdx) {
    const objs = liveObjects(game);
    if (game.rule === 'G-04') return null;
    if (game.rule === 'G-01' || game.rule === 'G-03') {
      if (!objs.length) return [];
      let min = Infinity;
      for (const b of objs) if (b.num < min) min = b.num;
      return objs.filter(b => b.num === min);
    }
    if (game.rule === 'G-02') {
      const p = game.players[playerIdx];
      if (game.open || p.group == null) return objs.filter(b => b.num !== 8);
      const mine = objs.filter(b => groupOf(b.num) === p.group);
      if (mine.length) return mine;
      return objs.filter(b => b.num === 8);
    }
    return null;
  }

  function groupOf(num) {
    if (num === 8) return null;
    return num <= 7 ? 'solid' : 'stripe';
  }

  // ───────── チーム（9.7節） ─────────
  /** そのプレイヤーが属するチーム。協力プレイでなければ本人が1チーム */
  function teamOf(game, idx) {
    const p = game.players[idx];
    return p ? p.team : idx;
  }
  function teamMembers(game, team) { return game.players.filter(p => p.team === team); }
  function teamList(game) {
    const seen = [];
    game.players.forEach(p => { if (seen.indexOf(p.team) < 0) seen.push(p.team); });
    return seen;
  }
  /** 同じチームの成果は合算する（9.7.2節） */
  function teamScore(game, team) {
    return game.players.reduce((s, p) => s + (p.team === team ? p.score : 0), 0);
  }
  /** 相手チームのうち手近な1つ。1チームしかいなければ -1 */
  function otherTeam(game, team) {
    const l = teamList(game).filter(x => x !== team);
    return l.length ? l[0] : -1;
  }
  /** 勝者を記録する。誰が決めたか（winner）とどのチームが勝ったか（winTeam）は別物 */
  function setWinner(game, playerIdx) {
    game.winner = playerIdx;
    game.winTeam = playerIdx >= 0 ? teamOf(game, playerIdx) : -1;
  }
  function setWinnerTeam(game, team) {
    game.winTeam = team;
    const m = team >= 0 ? teamMembers(game, team) : [];
    game.winner = m.length ? m[0].idx : -1;
  }

  // ───────── スポットへ戻す（10.2節・10.3.4節） ─────────
  function spotBall(game, ball) {
    const table = game.table;
    const axis = table.footDirection;
    const base = table.spot;
    const STEP = 0.1;                    // 0.1 mm 刻みの固定手順（D300）
    const others = game.world.balls.filter(b => b !== ball && b.state === 'live');

    function free(x, y) {
      if (Math.abs(x) > table.halfW - ball.r || Math.abs(y) > table.halfH - ball.r) return false;
      for (const p of table.pockets) if (Math.hypot(x - p.x, y - p.y) < p.r + ball.r * 0.2) return false;
      for (const o of others) {
        const need = ball.r + o.r + (o.kind === 'cue' ? 1.0 : 0.0);  // 手玉には 1.0 mm の間隔
        if (Math.hypot(x - o.x, y - o.y) < need) return false;
      }
      return true;
    }
    if (free(base.x, base.y)) { place(ball, base.x, base.y); return true; }
    const maxSteps = Math.ceil((table.halfW * 2) / STEP);
    for (let i = 1; i <= maxSteps; i++) {           // ①フット側へ
      const x = base.x + axis * STEP * i;
      if (Math.abs(x) > table.halfW) break;
      if (free(x, base.y)) { place(ball, x, base.y); return true; }
    }
    for (let i = 1; i <= maxSteps; i++) {           // ②ヘッド側へ
      const x = base.x - axis * STEP * i;
      if (Math.abs(x) > table.halfW) break;
      if (free(x, base.y)) { place(ball, x, base.y); return true; }
    }
    place(ball, base.x, base.y);                     // 3順位で完結しない事態は起きない想定
    return false;
  }

  function place(ball, x, y) {
    ball.x = x; ball.y = y; ball.z = 0;
    ball.vx = ball.vy = ball.vz = 0; ball.wx = ball.wy = ball.wz = 0;
    ball.state = 'live'; ball.onTable = true;
  }

  function homeBall(game, ball) {
    if (ball.home) { place(ball, ball.home.x, ball.home.y); return true; }
    return spotBall(game, ball);
  }

  // ───────── ショットの結果を判定する ─────────
  /**
   * @param {object} game
   * @param {object} pre   ショット直前の情報 { cueId, targetIds:[], doubleHit:boolean, miscue:boolean }
   * @param {Array}  events エンジンが積んだ出来事
   * @returns {object} 判定結果
   */
  function resolveShot(game, pre, events) {
    const rule = game.rule;
    const applies = FOUL_TABLE[rule];
    const player = game.players[game.turn];
    const fouls = [];
    const byId = {};
    game.world.balls.forEach(b => byId[b.id] = b);

    // 出来事を並べ直す
    let firstHit = null;
    let cushionAfterContact = false;
    const pocketed = [], offtable = [];
    let contactSeen = false;
    const hitBalls = [];
    for (const ev of events) {
      if (ev.type === 'hit') {
        const involvesCue = (ev.a === pre.cueId || ev.b === pre.cueId);
        if (involvesCue) {
          const other = ev.a === pre.cueId ? ev.b : ev.a;
          if (!firstHit) firstHit = other;
          if (hitBalls.indexOf(other) < 0) hitBalls.push(other);
          contactSeen = true;
        }
      } else if (ev.type === 'cushion') {
        if (contactSeen) cushionAfterContact = true;
      } else if (ev.type === 'pocket') {
        pocketed.push(ev.ball);
      } else if (ev.type === 'offtable') {
        offtable.push(ev.ball);
      }
    }

    const cueBall = byId[pre.cueId];
    const cuePocketed = pocketed.indexOf(pre.cueId) >= 0;
    const cueOff = offtable.indexOf(pre.cueId) >= 0;

    // ── V-01 空振り
    if (applies['V-01'] && firstHit == null) fouls.push('V-01');
    // ── V-02 対象違い
    if (applies['V-02'] && firstHit != null && pre.targetIds && pre.targetIds.length) {
      if (pre.targetIds.indexOf(firstHit) < 0) fouls.push('V-02');
    }
    // ── V-03 無クッション
    if (applies['V-03'] && firstHit != null && !cushionAfterContact && pocketed.length === 0) {
      fouls.push('V-03');
    }
    // ── V-04 スクラッチ（手玉の場外もここで受ける。10.4.2節）
    if (applies['V-04'] && (cuePocketed || cueOff)) fouls.push('V-04');
    // ── V-05 場外
    const objOff = offtable.filter(id => id !== pre.cueId);
    if (applies['V-05'] && (objOff.length > 0 || (rule === 'G-04' && cueOff))) fouls.push('V-05');
    // ── V-06 ダブルヒット／プッシュショット
    if (applies['V-06'] && pre.doubleHit) fouls.push('V-06');

    const foul = fouls.length > 0;
    const result = {
      fouls, pocketed: pocketed.slice(), offtable: offtable.slice(),
      firstHit, hitBalls, cuePocketed: cuePocketed || cueOff,
      foul, continueTurn: false, gained: 0, message: null, gameOver: false,
    };

    // ── 盤面の復旧（第10章）
    restoreBalls(game, result, pre);

    // ── ルールごとの帰結
    if (rule === 'G-01') resolveNine(game, result, pre);
    else if (rule === 'G-02') resolveEight(game, result, pre);
    else if (rule === 'G-03') resolveRotation(game, result, pre);
    else if (rule === 'G-04') resolveCarom(game, result, pre);

    /*
     * 相手チームがいないとき（協力プレイで全員が同じチーム）は、
     * 競う相手がいないので放っておくと決着がつかない。
     * 規定打数を超えたら未達成＝敗北とする（9.7.3節）。
     */
    if (!game.over && game.shotLimit > 0 && teamList(game).length === 1
        && game.shotNo + 1 >= game.shotLimit) {
      result.gameOver = true; game.over = true;
      /*
       * 未達成の印を立ててから勝者を消す。
       * 順位付け（finishRanking）は終局のたびに呼ばれ、
       * 1チームしかいなければ「そのチームが1位＝勝ち」と書き直してしまう。
       * 打ち切りで終わったことは、順位付けの側にも分かる形で残す必要がある。
       */
      game.failed = true;
      setWinnerTeam(game, -1);
      result.message = 'lose.shotLimit';
    }

    // ── デッドロックの計数（10.8.2節）
    const progressed = result.pocketed.length > 0 || result.gained > 0 || result.offtable.length > 0;
    game.deadlockCount = progressed ? 0 : game.deadlockCount + 1;

    game.lastFouls = fouls;
    game.lastPocketed = result.pocketed;
    game.shotNo++;
    return result;
  }

  /** 場外・落球のあとの盤面復旧（10.3.3節・10.4.3節） */
  function restoreBalls(game, result, pre) {
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);
    const rule = game.rule;

    // 場外へ出た的球
    const offObjs = result.offtable.map(id => byId[id]).filter(b => b && b.kind === 'object');
    offObjs.sort((a, b) => (a.num - b.num) || (a.id - b.id));   // 番号の小さい順（10.3.5節）
    for (const b of offObjs) {
      if (rule === 'G-01') { if (b.num === 9) spotBall(game, b); else b.state = 'gone'; }
      else if (rule === 'G-02') { b.state = 'gone'; }
      else if (rule === 'G-03') { spotBall(game, b); }
      else if (rule === 'G-04') { homeBall(game, b); }
    }
    // 手玉
    const cue = byId[pre.cueId];
    if (cue && (cue.state === 'off' || cue.state === 'pocketed')) {
      if (rule === 'G-04') homeBall(game, cue);
      else {
        // 次のプレイヤーが台全体へ置く（10.4.3節）
        cue.state = 'live'; cue.onTable = true;
        cue.x = game.table.headSpot.x; cue.y = 0; cue.z = 0;
        cue.vx = cue.vy = cue.vz = cue.wx = cue.wy = cue.wz = 0;
        game.ballInHand = true; game.ballInHandFull = true;
      }
    }
  }

  // ───────── G-01 ナインボール（7.3節） ─────────
  function resolveNine(game, r, pre) {
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);
    const dropped = r.pocketed.map(id => byId[id]).filter(b => b && b.kind === 'object');
    const nine = dropped.find(b => b.num === 9);
    if (nine) {
      if (!r.foul) { r.gameOver = true; game.over = true; setWinner(game, game.turn); r.message = 'win.nine'; return; }
      // ファウルを伴う9番投入 → スポットへ戻して相手のフリーボール
      nine.state = 'live'; nine.onTable = true;
      spotBall(game, nine);
      game.ballInHand = true; game.ballInHandFull = true;
      r.message = 'msg.nineRespot';
      return;
    }
    if (r.foul) { game.ballInHand = true; game.ballInHandFull = true; return; }
    r.continueTurn = dropped.length > 0;
  }

  // ───────── G-02 エイトボール（7.4節） ─────────
  function resolveEight(game, r, pre) {
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);
    const dropped = r.pocketed.map(id => byId[id]).filter(b => b && b.kind === 'object');
    const eight = dropped.find(b => b.num === 8);
    const p = game.players[game.turn];
    // 担当グループも勝ち負けもチーム単位。協力プレイでなければ 1人＝1チーム
    const myTeam = teamOf(game, game.turn);
    const foeTeam = otherTeam(game, myTeam);

    // ブレイクで8番が落ちた → スポットへ戻して続行（7.4.2節）
    if (!game.broken && eight) {
      eight.state = 'live'; eight.onTable = true; spotBall(game, eight);
      r.message = 'msg.eightRespot';
    }
    // 8番の場外は反則負け（7.4.3節）
    const eightOff = r.offtable.map(id => byId[id]).some(b => b && b.num === 8);
    if (eightOff) { r.gameOver = true; game.over = true; setWinnerTeam(game, foeTeam); r.message = 'lose.eightOff'; return; }

    if (eight && game.broken) {
      const mine = liveObjects(game).filter(b => p.group && groupOf(b.num) === p.group);
      const cleared = p.group != null && mine.length === 0;
      if (cleared && !r.foul) { r.gameOver = true; game.over = true; setWinnerTeam(game, myTeam); r.message = 'win.eight'; return; }
      r.gameOver = true; game.over = true; setWinnerTeam(game, foeTeam); r.message = 'lose.eightEarly'; return;
    }

    if (r.foul) { game.ballInHand = true; game.ballInHandFull = true; return; }

    // グループの確定（7.4.2節）。チームの全員に同じ担当が付く
    if (game.open && game.broken) {
      const first = dropped.find(b => b.num !== 8);
      if (first) {
        const gr = groupOf(first.num);
        const other = (gr === 'solid') ? 'stripe' : 'solid';
        game.players.forEach(q => { q.group = (q.team === myTeam) ? gr : other; });
        game.open = false;
        r.message = 'msg.groupSet';
      }
    }
    const mineDropped = dropped.filter(b => b.num !== 8 && (p.group == null || groupOf(b.num) === p.group));
    r.continueTurn = mineDropped.length > 0;
  }

  // ───────── G-03 ポケット・ローテーション（7.5節） ─────────
  function resolveRotation(game, r, pre) {
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);
    const dropped = r.pocketed.map(id => byId[id]).filter(b => b && b.kind === 'object');
    if (!r.foul) {
      let gain = 0;
      for (const b of dropped) gain += b.num;     // 落とした玉の番号がそのまま得点
      game.players[game.turn].score += gain;
      r.gained = gain;
      r.continueTurn = dropped.length > 0;
    } else {
      // ファウル時の利益無効（7.2.6節）。落ちた玉は戻さない（現実のローテーションに倣う）
      game.ballInHand = true; game.ballInHandFull = true;
    }
    if (liveObjects(game).length === 0) {
      r.gameOver = true; game.over = true;
      finishRanking(game);
      r.message = 'msg.rackCleared';
    }
  }

  // ───────── G-04 キャロム（7.6節） ─────────
  function resolveCarom(game, r, pre) {
    // 手玉が「手玉以外の玉のうち2球以上」に接触すれば1得点
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);
    const distinct = r.hitBalls.filter(id => byId[id] && byId[id].id !== pre.cueId);
    const made = distinct.length >= 2;
    if (made && !r.foul) {
      game.players[game.turn].score += 1;
      r.gained = 1;
      r.continueTurn = true;
      // 目標点はチームの合計で見る（協力プレイでなければ本人の得点と同じ）
      if (teamScore(game, teamOf(game, game.turn)) >= game.players[game.turn].target) {
        r.gameOver = true; game.over = true; setWinner(game, game.turn); r.message = 'win.carom';
      }
    }
  }

  /**
   * 点数で決めるルールの順位付け。並べるのはチーム。
   * 協力プレイでなければ 1人＝1チームなので、見た目は今までと同じ順位表になる。
   */
  function finishRanking(game) {
    const teams = teamList(game).map(tm => ({ team: tm, score: teamScore(game, tm) }));
    teams.sort((a, b) => b.score - a.score);
    game.teamRanking = teams.map(x => x.team);
    // 個人の並びも残す（表示はチームごとにまとめて出す）
    const arr = game.players.map(p => ({ idx: p.idx, score: p.score }));
    arr.sort((a, b) => b.score - a.score);
    game.ranking = arr.map(a => a.idx);
    // 規定打数を使い切って終わった局は、順位をつけ直しても勝ちにはならない
    const decided = !game.failed && teams.length && (teams.length === 1 || teams[0].score > teams[1].score);
    setWinnerTeam(game, decided ? teams[0].team : -1);
  }

  /** 手番を進める（7.2.2節。参加順の循環。ファウルで順序は変わらない） */
  function nextTurn(game, result) {
    if (game.over) return;
    if (result && result.continueTurn) return;
    game.turn = (game.turn + 1) % game.players.length;
    game.inningNo++;
  }

  /** ブレイクの成立判定（7.2.7節）。1球以上落ちるか、4球以上がクッションに触れること */
  function breakValid(events, pocketedCount) {
    if (pocketedCount > 0) return true;
    const touched = new Set();
    for (const ev of events) if (ev.type === 'cushion') touched.add(ev.ball);
    return touched.size >= 4;
  }

  /** ダブルヒット／プッシュショットの判定（5.9.1節） */
  function detectDoubleHit(game, cue, shot) {
    if (!game.tuning.doubleHit) return false;
    const dirX = Math.cos(shot.dir), dirY = Math.sin(shot.dir);
    for (const b of game.world.balls) {
      if (b === cue || b.state !== 'live') continue;
      const dx = b.x - cue.x, dy = b.y - cue.y;
      const dist = Math.hypot(dx, dy) - cue.r - b.r;
      if (dist > 6) continue;                     // 密着していない
      const ang = Math.abs(normAngle(Math.atan2(dy, dx) - shot.dir));
      if (ang < 0.45 && shot.elev < Math.PI / 4) return true;
    }
    return false;
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  return {
    RULE_IDS, FOUL_TABLE, PENALTY, WIN_KIND, HAS_RACK, NEEDS_POCKETS, HAS_SCORE,
    BALL_COLORS, CAROM_COLORS,
    teamOf, teamMembers, teamList, teamScore, otherTeam,
    makeRng, createGame, setupBalls, cueBallOf, liveObjects, legalTargets, groupOf,
    spotBall, homeBall, place, resolveShot, nextTurn, breakValid, detectDoubleHit,
    finishRanking, normAngle,
  };
})();

if (typeof window !== 'undefined') window.BilliardsRules = BilliardsRules;
