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

  const RULE_IDS = ['G-01', 'G-02', 'G-03', 'G-04', 'G-06', 'G-08'];

  // 適用するファウル（7.2.4節）。第1段階の4ルールぶんだけを持つ。
  const FOUL_TABLE = {
    'G-01': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-02': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-03': { 'V-01': 1, 'V-02': 1, 'V-03': 1, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    'G-04': { 'V-01': 1, 'V-02': 0, 'V-03': 0, 'V-04': 0, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    /*
     * 陣取りも「最初に当てるべき玉」を持たない（7.2.4節）。どの玉に当てても結果は盤面に出る。
     * **V-04 も適用しない。**キャロム版台専用なので（D395）ポケットが存在しない。
     * 手玉の場外は V-05 で受ける（D396）。
     */
    'G-06': { 'V-01': 1, 'V-02': 0, 'V-03': 0, 'V-04': 0, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
    // サバイバルは「最初に当てるべき玉」を持たないので V-02・V-03 は適用しない（7.2.4節）
    'G-08': { 'V-01': 1, 'V-02': 0, 'V-03': 0, 'V-04': 1, 'V-05': 1, 'V-06': 1, 'V-07': 1, 'V-08': 1, 'V-09': 1 },
  };

  // 罰則の分類（7.2.5節）
  const PENALTY = { 'G-01': 'freeball', 'G-02': 'freeball', 'G-03': 'freeball', 'G-04': 'score', 'G-06': 'freeball', 'G-08': 'loss' };
  // 勝敗の決まり方（7.2.8節）
  const WIN_KIND = { 'G-01': 'reach', 'G-02': 'reach', 'G-03': 'points', 'G-04': 'reach', 'G-06': 'points', 'G-08': 'survival' };

  /**
   * 点数を数えるルールかどうか。
   * ナインボール・エイトボールは「どの玉を落としたか」で決まり点数を持たない。
   * 持たないルールで 0 点と出し続けると、壊れているように見える。
   */
  const HAS_SCORE = { 'G-01': false, 'G-02': false, 'G-03': true, 'G-04': true, 'G-06': true, 'G-08': false };
  // ラックを持つか（7.2.7節）
  const HAS_RACK = { 'G-01': true, 'G-02': true, 'G-03': true, 'G-04': false, 'G-06': false, 'G-08': true };
  // ポケットあり台が要るか
  const NEEDS_POCKETS = { 'G-01': true, 'G-02': true, 'G-03': true, 'G-04': false, 'G-06': false, 'G-08': true };
  /*
   * ブレイクの成立条件（1球以上落ちるか4球以上がクッションに触れる）を見るか。
   * **サバイバルだけは見ない。**このルールのブレイクは「グループの球が1つでも落ちたか」
   * だけで組み立てられていて、落ちなければそのまま次の人が撞く。
   * クッション数の条件を重ねると、同じ一撞きに二重の判定が掛かる。
   */
  const BREAK_VALID = { 'G-01': true, 'G-02': true, 'G-03': true, 'G-04': false, 'G-06': false, 'G-08': false };

  /*
   * 陣取り（7.7節）のプレイヤーの色。**玉そのものの色であり、塗ったマスもこの色になる。**
   * ラシャの緑の上でも読めるよう、サバイバルの輪と同じ組から選ぶ。
   * **白は使わない。**手玉が白なので、白い的球があると撞く玉を見失う。
   */
  const TERRITORY_COLORS = ['#00e5ff', '#ff2d95', '#ffd400', '#b06cff'];
  const TERRITORY_BALLS = 4;    // 色ごとの玉数（D390）
  const TERRITORY_SHOTS = 4;    // 規定打数（D393）。玉の数と一致させている

  /*
   * サバイバルの所有者を表す色（7.8.2節「色で区別する」）。
   * **玉そのものの色ではなく、玉のまわりに掛ける輪の色である。**
   * 3人以上では自分の玉が番号でしか分かれず、盤を見ても残りが読めないため。
   * 玉の地色（黄・青・赤・紫・橙・緑・臙脂・黒）と重なっても読めるよう、
   * 輪は玉の外側＝ラシャの上に描く。だから選ぶのはラシャの緑と喧嘩しない色になる。
   */
  const SURVIVAL_COLORS = ['#ffffff', '#00e5ff', '#ff2d95', '#ffd400', '#8cff5a', '#ff7a1a'];

  /**
   * サバイバルのグループ分け（7.8.2節）。
   *
   * **15球を上から順に連続で区切って人数ぶんに分け、配り切れなかった末尾は無所属。**
   *   3人 → 1〜5／6〜10／11〜15（無所属なし）
   *   4人 → 1〜3／4〜6／7〜9／10〜12（13・14・15が無所属）
   *
   * **2人だけは 1〜7 と 9〜15 で、8番が無所属。**連続区切りであることは同じで、
   * 真ん中の8番を抜くだけである。こうするとソリッドとストライプに一致し、
   * **盤を見ただけでどちらが自分か分かる**。2人にだけ見て分かる分け方が存在するための差であって、
   * 人数で規則を分けているのではない。
   */
  function survivalGroups(n) {
    if (n === 2) return { groups: [[1, 2, 3, 4, 5, 6, 7], [9, 10, 11, 12, 13, 14, 15]], free: [8] };
    const k = Math.floor(15 / n);
    const groups = [];
    for (let i = 0; i < n; i++) {
      const g = [];
      for (let j = 0; j < k; j++) g.push(i * k + j + 1);
      groups.push(g);
    }
    const free = [];
    for (let num = n * k + 1; num <= 15; num++) free.push(num);
    return { groups, free };
  }

  // ───────── 決定論的な擬似乱数（5.2.4節。1ゲーム1シード） ─────────
  /*
   * ★**種をそのまま使うと、最初の1個が種によらずほぼ同じ値になる。**
   * 実測：種 200／201／202／210／220 のいずれでも最初の値は 0.0126 前後だった。
   * xorshift は小さい種から始めるとビットが十分に混ざらないためで、
   * 2個目からは正常にばらける。
   *
   * 「最初の1個」で何かを決めている側は、どの局でも同じ答えを出すことになる。
   * 実際に効いていた：AIの手加減の抽選（think の careless）は局の最初の1個を引くので、
   * 0.0126 < 割合 となる難易度では**毎局かならず手加減が入っていた**（Easy 0.16／Hard 0.06／Apocalypse 0.015）。
   * バンキングの選択も同じ引き方をするので同じ影響を受ける。
   *
   * 種を混ぜてから空回しして直す。**乱数の並びが変わるので、AIの指し手も変わる。**
   */
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    s = (s ^ 0x9e3779b9) >>> 0;              // 種の偏りをほぐす
    const step = function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 12; i++) step();     // 空回し
    return step;
  }

  // ───────── ゲームの生成 ─────────
  /**
   * @param {object} cfg { rule, shape, hasPockets, players:[{name,type}], seed, tuning, difficulty,
   *                       target(点数目標), handicaps }
   */
  function createGame(cfg) {
    const table = T.make(cfg.shape, cfg.hasPockets);
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
        /*
         * チームは席ではなく人に付く。席順を回して次の局を始める形にしたので、
         * 席番号で引く表（cfg.teams）だけに頼ると、回した瞬間に組が入れ替わる。
         * 参加者そのものが組を持っていればそれを優先する
         */
        team: (p.team != null) ? p.team
          : (cfg.coop && cfg.teams && cfg.teams[i] != null) ? cfg.teams[i] : i,
        score: 0, group: null, fouls: 0,
        // 脱落（G-08 サバイバル。所有玉を失い切った）。離脱とは別物なので印も別に持つ
        out: false,
        // 途中離脱（9.8.3節）。やり直しても抜けた人は戻らないので、組み直しでも引き継ぐ
        retired: !!p.retired,
        target: (cfg.targets && cfg.targets[i] != null) ? cfg.targets[i] : defaultTarget(cfg.rule),
        baseLeft: 0, bankLeft: 0,
      })),
      winTeam: -1,
      /*
       * **撞く順番。**席の番号順とは限らない。
       *
       * サバイバルはバンキングで全員の打順を決め、さらに最初にグループの球を落とした人を
       * 先頭へ回す（7.8節）。席の番号を並べ替えてしまうと、席に紐づく持ち時間や
       * 通信の相手番号まで一緒にずれる。**並べ替えるのは「回る順」だけにして、席の番号は動かさない。**
       * 既定は席の番号順なので、他の4ルールの巡り方は1手も変わらない。
       */
      seatOrder: cfg.players.map((p, i) => i),
      // サバイバルのグループと所有者（割り当ては開始後に決まる）
      survival: null,
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
    // 抜けている席から始めない。組み直しで離脱者を引き継いだときに起きる
    game.turn = firstActive(game);
    // この局で実際にブレイクする席。次の局のローテーションはここから数える
    game.breaker = game.turn;
    setupBalls(game);
    return game;
  }

  // ───────── 途中離脱（9.8.3節・9.8.4節・10.8.4節） ─────────

  /**
   * 対局に残っている席か。
   * **離脱（人が抜けた）と脱落（玉を失い切った）は理由が別だが、
   * 「もう撞かない席」という点では同じ**なので、ここで1つにまとめる。
   * こうしておくと、手番を回す側・数える側に脱落のための条件を書き足さずに済む。
   */
  function isActive(p) { return !!p && !p.retired && !p.out; }

  // ───────── 席の巡り（seatOrder） ─────────
  /** 撞く順に並べた席の一覧。壊れていたら席の番号順に戻す */
  function seatCycle(game) {
    const n = game.players.length;
    const o = game.seatOrder;
    if (!o || o.length !== n) return game.players.map((p, i) => i);
    return o;
  }
  /** その席の次に撞く席（脱落・離脱は飛ばす）。誰も居なければ元の席 */
  function nextSeat(game, idx) {
    const cyc = seatCycle(game);
    const at = cyc.indexOf(idx);
    const n = cyc.length;
    for (let k = 1; k <= n; k++) {
      const j = cyc[(at + k + n) % n];
      if (isActive(game.players[j])) return j;
    }
    return idx;
  }
  /** 撞く順の先頭を head へ回す。巡りそのものは保つ */
  function rotateSeats(game, head) {
    const cyc = seatCycle(game).slice();
    const at = cyc.indexOf(head);
    if (at < 0) return;
    game.seatOrder = cyc.slice(at).concat(cyc.slice(0, at));
  }
  /** 残っている席の数。1人になったら勝ちが決まる（10.8.4節 手順4） */
  function activeCount(game) { return game.players.filter(isActive).length; }
  /** 残っているチーム。協力プレイでは同じチームに1人でも残っていればチームは存続する */
  function activeTeams(game) {
    return teamList(game).filter(tm => teamMembers(game, tm).some(isActive));
  }
  function firstActive(game) {
    for (const i of seatCycle(game)) if (isActive(game.players[i])) return i;
    return seatCycle(game)[0];
  }

  /**
   * 席を1つ、対局から外す（9.8.3節）。
   * 切断・明示の退出・やり直しへの不同意（10.8.4節）のいずれも同じ扱いになる。
   *
   * **残ったチームが1つになったらその勝ちで終局する。**
   * 2人対戦で相手が抜けた場合も、この数え方で「残った側の勝ち」になる。
   * 人数で場合分けせず、残っているチームを数えるだけにしておくと、
   * 2人・3人以上・協力プレイのどれでも同じ1本の規定で済む。
   *
   * @returns {boolean} この離脱で対局が終わったか
   */
  function retirePlayer(game, idx) {
    const p = game.players[idx];
    if (!p || p.retired || game.over) return false;
    p.retired = true;
    const alive = activeTeams(game);
    if (alive.length <= 1) {
      game.over = true;
      game.lastMessageKey = 'res.byRetire';
      setWinnerTeam(game, alive.length === 1 ? alive[0] : -1);
      return true;
    }
    /*
     * **抜けた人の番が回ってきたままにしない。**
     * 手番中の人が抜けたら、そのターンは撞かれなかったものとして次へ移す（9.8.4節）。
     * 打ちかけの入力は確定していないので盤面に反映しない。
     */
    if (game.players[game.turn].retired) nextTurn(game, null);
    return false;
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

    if (game.rule === 'G-06') {
      /*
       * 陣取り（7.7.8節）。的球は台の重心を中心とした円周上に等間隔、**色は順ぐりに配る**。
       * 手玉は円の中心（ドーナツ型だけは島を挟んだ反対側）。
       */
      const n = game.players.length;
      const total = n * TERRITORY_BALLS;
      const lay = T.territoryLayout(table, total);
      balls.push(E.makeBall({
        id: id++, num: 0, kind: 'cue', r: R, x: lay.cue.x, y: lay.cue.y, color: '#f4f4f4',
      }));
      lay.spots.forEach((s, i) => {
        const owner = i % n;    // 色は順ぐり。色ごとにまとめると方角と壁までの距離が偏る
        balls.push(E.makeBall({
          id: id++, num: i + 1, kind: 'object', owner, r: R,
          x: s.x, y: s.y, color: TERRITORY_COLORS[owner % TERRITORY_COLORS.length],
        }));
      });
      game.territory = {
        grid: T.territoryGrid(table),
        layout: { center: lay.center, radius: lay.radius },
        paint: new Map(),      // マスの番号 → 塗った人の席
        last: new Map(),       // 玉ごとに最後に見たマス。変わったときだけ塗る
        shotLog: [],           // この一撞きで塗り替えたマスと、その前の色
      };
      game.players.forEach(p => { p.score = 0; p.shots = 0; });
      game.ballInHand = false;
      game.ballInHandFull = false;
    } else if (game.rule === 'G-04') {
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
      const cue = E.makeBall({ id: id++, num: 0, kind: 'cue', r: R, x: table.headSpot.x, y: table.headSpot.y, color: '#f4f4f4' });
      balls.push(cue);
      let rack, grpOf = null;
      if (game.rule === 'G-08') {
        /*
         * サバイバル（7.8節）。15球を人数ぶんのグループに分け、**位置だけを順ぐりに配る**。
         * 番号を連続で区切るので、そのまま番号順に置くと若いグループが手前へかたまる。
         */
        const sv = survivalGroups(game.players.length);
        game.survival = {
          groups: sv.groups, free: sv.free,
          owner: sv.groups.map(() => -1),   // まだ誰のものでもない
          assigned: false,
          outOrder: [],                     // 脱落した席の順（順位は この逆）
        };
        game.players.forEach(p => { p.group = null; p.out = false; });
        rack = T.rackByGroups(table, sv.groups, sv.free);
        grpOf = num => {
          for (let g = 0; g < sv.groups.length; g++) if (sv.groups[g].indexOf(num) >= 0) return g;
          return -1;                        // 無所属（落としても罰も利益も無い）
        };
      } else if (game.rule === 'G-01') {
        rack = T.rackDiamond(table, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      } else if (game.rule === 'G-02') {
        rack = T.rackTriangle(table, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 8);
      } else {
        rack = T.rackTriangle(table, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 15);
      }
      rack.forEach(r => {
        const b = E.makeBall({
          id: id++, num: r.num, kind: 'object', r: R, x: r.x, y: r.y,
          color: BALL_COLORS[r.num] || '#cccccc', stripe: r.num >= 9,
        });
        // どのグループの球か。玉自身に持たせておくと、あとで数え方を作り直さずに済む
        if (grpOf) b.grp = grpOf(r.num);
        balls.push(b);
      });
      game.ballInHand = true;
      game.ballInHandFull = false;
    }
    /*
     * 刻みごとの通知はここで1回だけ結ぶ。**盤面を進める道は5本あるので、
     * 呼ぶ側に書き足していくと必ずどれかが抜ける**（主ループ・演出無しの一気走らせ・
     * 観戦者の追いつき・リプレイ・AIの読み）。エンジンの step が必ず通る場所に置く。
     */
    game.world = E.createWorld(table, balls, game.tuning,
      game.rule === 'G-06' ? { onAdvance: () => territoryTrack(game) } : null);
    // 玉を並べ直した＝まだ誰もブレイクしていない
    game.broken = false;
    if (game.rule === 'G-06') territoryTrack(game);   // 出発のマスを控える（塗りはしない）
  }

  // ───────── 陣取り（7.7節） ─────────

  /**
   * 玉が通ったマスを塗る（7.7.2節）。エンジンの刻みごとに呼ばれる。
   *
   * **塗るのは「マスが変わったとき」だけである。**止まっている玉のマスを毎回塗ると、
   * 玉を置いたままにするだけでその下のマスを守れてしまい、上書きが起きなくなる。
   * 仕様の「玉の中心が進入した時点で塗られる」に合わせて、入った瞬間だけ数える。
   *
   * **控えはショットをまたいで持ち続ける。**止まっている間はマスが変わらないので塗られず、
   * 次に動いたときだけ差分が出る。ショットの切れ目で消す必要がないので、
   * 消し忘れ・消しすぎのどちらも起こらない。
   */
  function paintAdvance(table, grid, paint, last, balls, log) {
    for (const b of balls) {
      if (b.kind !== 'object' || b.state !== 'live') continue;
      const c = T.gridCellAt(table, b.x, b.y);
      if (last.get(b.id) === c) continue;
      const first = !last.has(b.id);
      last.set(b.id, c);
      if (first) continue;                       // 初めて見た玉は控えるだけ。出発のマスは塗らない
      if (c < 0 || !grid.valid.has(c)) continue;
      const before = paint.has(c) ? paint.get(c) : -1;
      if (before === b.owner) continue;
      if (log) log.push({ cell: c, prev: before });
      paint.set(c, b.owner);
    }
  }

  function territoryTrack(game) {
    const tt = game.territory;
    if (!tt) return;
    /*
     * ★**「この一撞きで塗ったぶん」の区切りは、玉が動き出した瞬間に置く。**
     *
     * ファウルなら塗りを元へ戻すので（7.2.6節）、控えが一撞きぶんで区切られていないと
     * **それ以前の塗りまで巻き戻す**。撞き終わりに消す形にしていたが、
     * 玉が動くのに撞き終わりを通らない道があると、そこで溜まったぶんが
     * 次のファウルでまとめて消える（検査で 128 マスが 0 になった）。
     *
     * 消す合図（撞き終わり）に寄りかからず、**立てる側と同じ場所＝盤面が動く所**で区切る。
     */
    const moving = !E.allStopped(game.world);
    if (moving && !tt.moving) tt.shotLog.length = 0;
    tt.moving = moving;
    paintAdvance(game.table, tt.grid, tt.paint, tt.last, game.world.balls, tt.shotLog);
  }

  /**
   * 試し撞き用の塗り（AIの読み）。**本物の塗りには触れない。**
   *
   * ★塗りの決めごとは paintAdvance ただ1つで、本番も読みも同じ関数を通る。
   * 読み側に写しを書くと、片方だけ直したときに
   * 「AIが見ている盤面」と「実際に塗られる盤面」が食い違う。
   */
  function makeTerritoryProbe(game) {
    const tt = game.territory;
    const paint = new Map(tt.paint), last = new Map(tt.last);
    return {
      step(w) { paintAdvance(game.table, tt.grid, paint, last, w.balls, null); },
      counts() {
        const out = game.players.map(() => 0);
        paint.forEach(owner => { if (out[owner] != null) out[owner]++; });
        return out;
      },
    };
  }

  /** 塗られたマスを席ごとに数える（7.7.4節） */
  function territoryCount(game) {
    const out = game.players.map(() => 0);
    if (!game.territory) return out;
    game.territory.paint.forEach(owner => { if (out[owner] != null) out[owner]++; });
    return out;
  }

  /** その席の色の、まだ盤に残っている玉 */
  function territoryBallsOf(game, seat) {
    return game.world.balls.filter(b => b.kind === 'object' && b.state === 'live' && b.owner === seat);
  }

  /**
   * その人が撞く玉。
   * 「ルールがキャロムかどうか」ではなく「手玉が人数ぶんあるかどうか」で決める。
   * ルール名で見分けると、手玉を人数ぶん置く別の場面（バンキング）が同じ扱いから漏れる。
   */
  function cueBallOf(game, playerIdx) {
    const cues = game.world.balls.filter(b => b.kind === 'cue');
    if (cues.length <= 1) return cues[0] || null;
    return cues.find(b => b.owner === playerIdx) || null;
  }

  // ───────── バンキング（先手決め） ─────────
  /*
   * 仕様書に規定は無い（7.2.7節は「最初のブレイク権は参加順の先頭」）。
   * 通信対戦とAI対戦で、いつも同じ席が先手になるのを避けるために置いた手順。
   *
   * 参加者が順に1球ずつ撞き、**ヘッド側にいちばん近く止まった人が先手**。
   * 撞かなければ手玉はヘッド側に置いたままでいちばん近くなってしまうので、
   * **フット側の壁に当てて戻すこと**を成立条件にする。
   * 当てなかった玉・落ちた玉・場外の玉は最下位に置く。
   */

  /** 長軸に沿った位置。フット側を正とする（ヘッドに近いほど小さい） */
  function longPos(table, x, y) {
    const v = (table.longAxis === 'y') ? y : x;
    return v * (table.footDirection || 1);
  }

  /** フット側の壁までの距離（長軸）。バンキングの成立線に使う */
  function footReach(table) {
    let max = -Infinity;
    for (const p of table.outline) max = Math.max(max, longPos(table, p.x, p.y));
    return max;
  }

  /**
   * バンキング中は**いま撞く人の玉だけを盤に出す。**
   *
   * 現実のバンキングは全員が同時に撞くが、端末をまたいで同時には撞けないので順に撞く。
   * そのまま全員の玉を盤に並べると、順の遅い人が先に撞いた人の玉に当てて
   * 動かせてしまう（近づけることも遠ざけることもできる）。
   * 先に撞いた人の結果が見えること自体も、後の人だけが得る手がかりになる。
   * どちらも「同時に撞く」という前提が崩れたことから出てくるので、
   * **他の人の玉を盤から外しておく**ことで両方まとめて防ぐ。止まった位置は記録済み。
   */
  function bankFocus(game) {
    for (const b of game.world.balls) {
      if (b.kind !== 'cue') continue;
      const mine = (b.owner === game.turn);
      b.state = mine ? 'live' : 'gone';
      b.onTable = mine;
    }
  }

  function startBanking(game) {
    const table = game.table;
    const n = game.players.length;
    const balls = [];
    const span = 212;                       // 手玉どうしの間隔（キャロムと同じ）
    for (let i = 0; i < n; i++) {
      const y = table.headSpot.y + (i - (n - 1) / 2) * span;
      balls.push(E.makeBall({
        id: i, num: 0, kind: 'cue', owner: i, r: T.R,
        x: table.headSpot.x, y,
        color: CAROM_COLORS[i % CAROM_COLORS.length],
      }));
    }
    game.world = E.createWorld(table, balls, game.tuning);
    game.bank = { on: true, marks: game.players.map(() => null), shotBy: {} };
    game.turn = firstActive(game);          // 抜けている席から始めない
    game.ballInHand = true;                 // ヘッドストリングより手前に置いてから撞く
    game.ballInHandFull = false;
    game.broken = false;
    bankFocus(game);
  }

  /**
   * バンキングの1球ぶんを記録して次の人へ進める。
   * @returns {object} { done, winner } done=true なら全員撞き終わった
   */
  function bankResolve(game, events) {
    const table = game.table;
    const idx = game.turn;
    const ball = cueBallOf(game, idx);
    const line = Math.abs(longPos(table, table.spot.x, table.spot.y));   // フットスポットの線
    let reached = false;
    for (const ev of events) {
      if (ev.type !== 'cushion' || ev.ball !== (ball && ball.id)) continue;
      if (ev.x == null) continue;
      if (longPos(table, ev.x, ev.y) >= line) { reached = true; break; }
    }
    const ok = !!ball && ball.state === 'live' && reached;
    // marks は「撞いた結果」。不成立は null なので、撞いたかどうかは別に数える
    game.bank.marks[idx] = ok ? longPos(table, ball.x, ball.y) : null;
    game.bank.shotBy[idx] = 1;
    game.shotNo++;

    // 次に撞く人（まだ撞いていない席）
    let next = -1;
    const cyc = seatCycle(game), at = cyc.indexOf(idx);
    for (let k = 1; k <= cyc.length; k++) {
      const i = cyc[(at + k) % cyc.length];
      if (isActive(game.players[i]) && !game.bank.shotBy[i]) { next = i; break; }
    }
    if (next >= 0) {
      game.turn = next;
      game.ballInHand = true; game.ballInHandFull = false;   // 次の人も置いてから撞く
      bankFocus(game);
      return { done: false, winner: -1 };
    }

    // 全員ぶんそろった。ヘッドにいちばん近い（値が小さい）人が先手。
    // 成立しなかった人は最下位。誰も成立しなければ参加順の先頭（従来どおり）
    let winner = -1, best = Infinity;
    for (let i = 0; i < game.players.length; i++) {
      const m = game.bank.marks[i];
      if (m == null || !isActive(game.players[i])) continue;
      if (m < best) { best = m; winner = i; }
    }
    if (winner < 0) {
      for (let i = 0; i < game.players.length; i++) if (isActive(game.players[i])) { winner = i; break; }
    }
    return { done: true, winner };
  }

  /**
   * バンキングを終えて本番の盤を組む。
   *
   * **サバイバルだけは、勝った人だけでなく全員の打順をここで決める**（7.8節）。
   * 止まった位置がヘッド側に近い順。**成立しなかった人は末尾**へ回し、
   * その中では元の席順を保つ（marks が null なので大小では並べられないため）。
   */
  function endBanking(game, winner) {
    game.bank.on = false;
    game.bank.winner = winner;
    if (game.rule === 'G-08') {
      const marks = game.bank.marks || [];
      const cyc = seatCycle(game).slice();
      const rank = cyc.map((seat, at) => ({ seat, at, m: marks[seat] }));
      rank.sort((a, b) => {
        const an = (a.m == null), bn = (b.m == null);
        if (an !== bn) return an ? 1 : -1;          // 不成立は末尾
        if (an) return a.at - b.at;                 // 不成立どうしは元の順
        return (a.m - b.m) || (a.at - b.at);        // ヘッド側に近い順
      });
      game.seatOrder = rank.map(x => x.seat);
      winner = game.seatOrder[0];
      game.bank.winner = winner;
    }
    setupBalls(game);
    game.turn = winner;
    game.breaker = winner;                  // バンキングで決まった人がこの局のブレイク
    game.inningNo = 0;
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
      // 台の内側かどうかは外周から見る。矩形で見ると六角形以降で盤の外に置ける
      if (!T.inside(table, x, y, ball.r)) return false;
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
    /*
     * ★**手玉の場外をどちらのファウルで受けるかは、台にポケットがあるかで決める**
     *   （7.2.3節・D396）。ポケットのある台では V-04 が受け（10.4.2節）、
     *   ポケットの無い台では V-04 自体が成立しないので V-05 が受ける。
     *
     *   もとは「G-04 キャロムのみ V-05」とルールの名前で書いていた。
     *   キャロムが唯一のポケット無し専用ルールだった頃の書き方で、
     *   **陣取りが2つ目になった時点で古くなる**。名前を並べる形のままだと、
     *   足し忘れたルールでは**手玉が台の外へ飛んでも何のファウルにもならない**。
     */
    const noPockets = game.table.pockets.length === 0;
    // ── V-04 スクラッチ（ポケットのある台では手玉の場外もここで受ける。10.4.2節）
    if (applies['V-04'] && (cuePocketed || (!noPockets && cueOff))) fouls.push('V-04');
    // ── V-05 場外
    const objOff = offtable.filter(id => id !== pre.cueId);
    if (applies['V-05'] && (objOff.length > 0 || (noPockets && cueOff))) fouls.push('V-05');
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
    else if (rule === 'G-06') resolveTerritory(game, result, pre);
    else if (rule === 'G-08') resolveSurvival(game, result, pre);

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
    /*
     * ★この一撞きでブレイクが済んだ。
     *
     * この印は宣言も読み出しもされていたが、**どこでも立てていなかった**。
     * そのためエイトボールでは
     *   ・8番が落ちるたび「ブレイクで落ちた」と見なして戻し続ける
     *   ・担当（ソリッド／ストライプ）が永久に決まらない
     *   ・8番で勝ちも負けも起きない＝局が終わらない
     * という状態だった（実測：120手打っても8番だけが残り、終局しない）。
     * AIがブレイクを見分けるのにもこの印を使う。
     */
    game.broken = true;
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
      // 陣取りは落ちた的球を戻さない（7.7.5節）。その色の玉が1つ減る
      else if (rule === 'G-06') { b.state = 'gone'; b.onTable = false; }
      // サバイバルは場外もポケットと同じく喪失（7.8.4節・10.3.3節）。戻さない
      else if (rule === 'G-08') { b.state = 'gone'; b.onTable = false; }
    }
    // 手玉
    const cue = byId[pre.cueId];
    if (cue && (cue.state === 'off' || cue.state === 'pocketed')) {
      if (rule === 'G-04') homeBall(game, cue);
      else {
        // 次のプレイヤーが台全体へ置く（10.4.3節）
        cue.state = 'live'; cue.onTable = true;
        cue.x = game.table.headSpot.x; cue.y = game.table.headSpot.y; cue.z = 0;
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
      /*
       * 負けになる場面は変えていない（7.4.3節）。**理由の表し方だけを分けた。**
       *
       * それまでは「担当が片付いていて、かつ反則が無い」以外をひとまとめにして
       * 「自グループを残して8番を落とした」と出していた。そのため、
       * 担当を全部片付けたあとに手玉も一緒に落とした人にも、
       * 「まだ自分の球が残っている」という**事実に反する理由**が表示されていた。
       * 実測（AIどうし10局）：この負けが4件出て、うち3件の理由表示が事実と違っていた。
       */
      r.gameOver = true; game.over = true; setWinnerTeam(game, foeTeam);
      const scratched = (r.fouls || []).indexOf('V-04') >= 0;
      r.message = (p.group == null) ? 'lose.eightOpen'      // 担当が決まる前に落とした
        : !cleared ? 'lose.eightEarly'                      // 自分の球がまだ残っていた
          : scratched ? 'lose.eightScratch'                 // 8番と同時に手玉も落とした
            : 'lose.eightFoul';                             // それ以外の反則と同時に落とした
      return;
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

  // ───────── G-06 陣取り（7.7節） ─────────
  function resolveTerritory(game, r, pre) {
    const tt = game.territory;
    const before = game.players[game.turn].score;
    if (r.foul) {
      /*
       * ファウル時の利益無効（7.2.6節）。**この一撞きで塗ったマスを、塗る前の色へ戻す。**
       * 陣取りで一撞きから得る利益は塗りだけなので、これを残すと
       * 「ファウルを厭わずに強く撞いて塗り広げる」が最適解になる。
       * 7.2.6節は全9ルールに働き、個別のルールで上書きできない。
       *
       * **玉の位置は戻さない。**盤面の出来事は通常どおり起き、
       * そこから利益を得られないだけである（7.2.6節「物理挙動は制限しない」）。
       */
      for (let i = tt.shotLog.length - 1; i >= 0; i--) {
        const e = tt.shotLog[i];
        if (e.prev < 0) tt.paint.delete(e.cell); else tt.paint.set(e.cell, e.prev);
      }
      tt.shotLog.length = 0;    // 使ったら消す（同じぶんを二度戻さない）
      // フリーボール型（7.2.5節）。手玉が落ちていなくても次の人が台全体へ置ける
      game.ballInHand = true; game.ballInHandFull = true;
    }
    /*
     * 得点は「いま塗られているマス」を数え直して出す。差分を足し込む形にすると、
     * 上書きで減った側を引き忘れたときに合計が合わなくなる。
     */
    const counts = territoryCount(game);
    game.players.forEach((p, i) => { p.score = counts[i]; });
    r.gained = game.players[game.turn].score - before;

    // 1ショットごとに交代する（7.7.4節）。落としても続けて撞けない
    r.continueTurn = false;
    const me = game.players[game.turn];
    me.shots = (me.shots || 0) + 1;

    // 全員が規定打数を消化したら終了（7.7.4節）
    const done = game.players.every(p => p.retired || (p.shots || 0) >= TERRITORY_SHOTS);
    if (done) {
      r.gameOver = true; game.over = true;
      finishRanking(game);
      r.message = 'msg.territoryEnd';
    }
  }

  // ───────── G-08 サバイバル（7.8節） ─────────

  /** そのグループの、まだ盤に残っている球の数 */
  function liveInGroup(game, g) {
    return game.world.balls.filter(b => b.kind === 'object' && b.state === 'live' && b.grp === g).length;
  }
  /** その席の残り球数。割り当て前は 0 ではなく null（「まだ無い」と「もう無い」は別） */
  function survivalLeft(game, seat) {
    const p = game.players[seat];
    if (!p || p.group == null) return null;
    return liveInGroup(game, p.group);
  }

  /**
   * グループの割り当て（7.8節・利用者指示）。
   *
   * バンキングで決めた打順で撞いていき、**グループの球が1つでも落ちた一撞き**で確定する。
   *   ・撞いた人が**先頭の席**になる。巡りは保ったまま、その人を先頭へ回す
   *   ・先頭から順に、**盤に残っている球が多いグループ**を取る。**同数なら数字の若いグループ**
   *
   * ★**無所属の球だけが落ちても確定しない**（利用者指示）。罰も利益も無い球なので、
   *   席順にも影響させない。
   * ★**ファウルを伴う一撞きでは確定しない。**先頭を取ることはこの一撞きから得る利益であり、
   *   7.2.6節の「ファウル時の利益無効」は全9ルールに働き、個別のルールで上書きできない。
   */
  function assignGroups(game, shooter) {
    const sv = game.survival;
    rotateSeats(game, shooter);
    const taken = {};
    for (const seat of seatCycle(game)) {
      let best = -1, bestN = -1;
      for (let g = 0; g < sv.groups.length; g++) {
        if (taken[g]) continue;
        const n = liveInGroup(game, g);
        if (n > bestN) { bestN = n; best = g; }   // 先に見たほう＝数字の若いほうが勝つ
      }
      if (best < 0) break;
      taken[best] = 1;
      sv.owner[best] = seat;
      game.players[seat].group = best;
    }
    sv.assigned = true;
  }

  /**
   * 手玉を落としたときに失う1個（7.8.5節・10.4.4節）。
   * **盤に残っている自分の球のうち、スポットから最も遠いもの。**
   * 同じ距離なら番号の若いほう。並べ替えて先頭を採るので、比べる順に結果が左右されない。
   */
  function loseOne(game, seat, r) {
    const p = game.players[seat];
    if (!p || p.group == null) return;
    const sp = game.table.spot;
    const mine = game.world.balls.filter(b => b.kind === 'object' && b.state === 'live' && b.grp === p.group);
    if (!mine.length) return;
    const d = b => Math.round(Math.hypot(b.x - sp.x, b.y - sp.y) * 1000);
    mine.sort((a, b) => (d(b) - d(a)) || (a.num - b.num));
    const lost = mine[0];
    lost.state = 'gone'; lost.onTable = false;
    r.lostBall = lost.num;
  }

  /** 脱落と決着（7.8.6節）。残数0で脱落、残り1組で終局 */
  function checkOut(game, r) {
    const sv = game.survival;
    if (!sv || !sv.assigned) return;
    for (const p of game.players) {
      if (p.out || p.retired || p.group == null) continue;
      if (liveInGroup(game, p.group) === 0) {
        p.out = true;
        sv.outOrder.push(p.idx);
        // この一撞きで脱落した席。**知らせないと、手番が飛んだ理由が分からない**
        (r.outNow || (r.outNow = [])).push(p.idx);
      }
    }
    const alive = activeTeams(game);
    if (alive.length <= 1) {
      game.over = true; r.gameOver = true;
      survivalRanking(game);
      r.message = (alive.length === 1) ? 'win.survival' : 'msg.allOut';
    }
  }

  /** 順位は脱落順の逆（7.8.6節）。生き残った人が1位 */
  function survivalRanking(game) {
    const sv = game.survival;
    const alive = game.players.filter(isActive).map(p => p.idx);
    game.ranking = alive.concat(sv.outOrder.slice().reverse());
    game.teamRanking = [];
    game.ranking.forEach(i => {
      const tm = teamOf(game, i);
      if (game.teamRanking.indexOf(tm) < 0) game.teamRanking.push(tm);
    });
    const aliveTeams = activeTeams(game);
    setWinnerTeam(game, aliveTeams.length === 1 ? aliveTeams[0] : -1);
  }

  function resolveSurvival(game, r, pre) {
    const sv = game.survival;
    if (!sv) return;
    const byId = {}; game.world.balls.forEach(b => byId[b.id] = b);

    if (!sv.assigned) {
      const dropped = r.pocketed.map(id => byId[id])
        .filter(b => b && b.kind === 'object' && b.grp >= 0);
      if (dropped.length && !r.foul) {
        assignGroups(game, game.turn);
        r.message = 'msg.svGroups';
      }
    }

    /*
     * 手玉を落としたら自分の球が1つ減る（7.8.5節）。
     * **割り当てが済むまでは減らせない。**まだ自分の球が無いためで、
     * 手番が移るだけになる。場外もスクラッチと同じ扱い（10.4.2節）。
     */
    if (sv.assigned && r.cuePocketed) loseOne(game, game.turn, r);

    checkOut(game, r);
    // 1ショットごとに交代（7.2.2節）。連続して撞くことはない
    r.continueTurn = false;
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

  // ───────── 続けてもう1局やるときのブレイク権 ─────────
  /*
   * 仕様書 7.2.7節・D242 は「2ゲーム目以降のブレイク権は交代制。ウィナーブレイクは採らない」
   * としているが、利用者の指示により**ローテーション／勝者ブレイク／敗者ブレイクから選べる**ようにした。
   * 仕様書の改訂が要る（実装記録 7.7節）。
   *
   * **決めるのは「誰がブレイクするか」だけ。**手番の巡りは前回のまま保ち、
   * その人が先頭に来るように回す。回す先を新しい席順として配る。
   * 例：前回 A→B→C→D で C がブレイクするなら C→D→A→B。
   * 席順そのものを配り直すので、手番の巡り方（nextTurn）には手を入れない。
   */

  /** チームの中で先に座っている（生きている）人の席 */
  function seatOfTeam(game, team) {
    const m = game.players.filter(p => p.team === team && isActive(p));
    if (m.length) return m[0].idx;
    const any = game.players.filter(p => p.team === team);
    return any.length ? any[0].idx : 0;
  }

  /** 次の局でブレイクする席を決める */
  function breakSeat(game, mode) {
    const nextOf = i => nextSeat(game, i);
    /*
     * ローテーション＝**この局で実際にブレイクした人の次**（＝仕様書の交代制）。
     *
     * ★席の並びの先頭で数えてはいけない。続きの局は並びを回して始めるので
     * 「先頭＝ブレイクした人」だが、**バンキングで始まった局は席順を変えず手番だけが勝者へ移る**。
     * 先頭で数えると、バンキングに勝った人が次の局も続けてブレイクする
     * （実測：AI対戦でAIがバンキングに勝つと、ローテーションでもAIが2局続けてブレイクした）。
     */
    const rotation = () => nextOf(game.breaker == null ? 0 : game.breaker);
    if (mode !== 'winner' && mode !== 'loser') return rotation();

    // 1位。勝ちが決まらなかった局（引き分け・規定打数切れ）はローテーションへ落とす
    if (game.winTeam < 0) return rotation();
    const winSeat = seatOfTeam(game, game.winTeam);
    if (mode === 'winner') return winSeat;

    /*
     * 敗者ブレイク。
     * **全順位が決まるゲーム**（得点制・生存制）は最下位がブレイクする。
     * **1位しか決まらないゲーム**（到達制＝ナインボール・エイトボール・キャロム。7.2.8節）は
     * 敗者を特定できないので、**前回の巡りで1位の次の人**がブレイクする。
     * 2人なら相手＝敗者になり、3人以上でも勝者が最後に撞く並びになる。
     */
    /*
     * ★「得点制なら」と名指しで書くと、あとから足したルールがすり抜ける。
     *   実際に生存制（サバイバル）を足したときにここへ来た。見ているのは名前ではなく
     *   **全順位が決まるかどうか**なので、決まらないもの（到達制）を除く形で書く。
     */
    if (WIN_KIND[game.rule] !== 'reach' && game.teamRanking && game.teamRanking.length) {
      for (let i = game.teamRanking.length - 1; i >= 0; i--) {
        const s = seatOfTeam(game, game.teamRanking[i]);
        if (isActive(game.players[s])) return s;
      }
    }
    return nextOf(winSeat);
  }

  /**
   * 次の局の席順。前回の巡りを保ったまま、ブレイクする人を先頭へ回す。
   * @returns {Array} createGame へ渡せる参加者の並び
   */
  function nextOrder(game, mode) {
    const cyc = seatCycle(game);
    const n = cyc.length;
    const head = breakSeat(game, mode);
    const at = Math.max(0, cyc.indexOf(head));
    const out = [];
    for (let k = 0; k < n; k++) {
      const p = game.players[cyc[(at + k) % n]];
      // 抜けた人は次の局へ持ち越さない（局をまたぐので、やり直しとは扱いが違う）
      out.push({ name: p.name, type: p.type, pid: p.pid || null, team: p.team, retired: false });
    }
    return out;
  }

  /** 手番を進める（7.2.2節。参加順の循環。ファウルで順序は変わらない） */
  function nextTurn(game, result) {
    if (game.over) return;
    if (result && result.continueTurn) return;
    // 抜けた席・脱落した席は飛ばす（9.8.3節・7.8.6節）。巡りは seatOrder が持つ
    game.turn = nextSeat(game, game.turn);
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
    survivalGroups, survivalLeft, liveInGroup, SURVIVAL_COLORS, BREAK_VALID,
    // 陣取り（7.7節）
    TERRITORY_COLORS, TERRITORY_BALLS, TERRITORY_SHOTS,
    territoryCount, territoryBallsOf, makeTerritoryProbe, territoryTrack,
    seatCycle, nextSeat, rotateSeats,
    startBanking, bankResolve, endBanking, longPos, footReach,
    breakSeat, nextOrder,
    retirePlayer, activeCount, activeTeams, isActive,
  };
})();

if (typeof window !== 'undefined') window.BilliardsRules = BilliardsRules;
