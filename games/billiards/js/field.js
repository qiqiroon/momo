/**
 * MOMO Billiards — 盤面イベント層（仕様書 5.3.1節・第6章）
 *
 * 第5章5.3.2節は「通常モードとは、変則モード層と盤面イベント層が
 * 何もしない状態のことである」と定めている。したがってモードの違いは
 * **分岐ではなく、この層が働くか働かないか**で表す。
 * app.js や rules.js に「異常モードなら〜」と書き始めたら、その設計は崩れている。
 *
 * ★engine.js はギミックの名前を1つも知らない。
 *   台の形と同じで、engine の中に形状名やギミック名の分岐を書き始めたら
 *   設計が壊れかけている合図（このフォルダの案内書 §5）。
 *   engine が呼ぶのは apply() ひとつだけで、中身は全部こちらが持つ。
 *
 * ★抽選は必ず共有シードの乱数（game.rng）から引き、玉が転がっている最中には引かない。
 *   転がりの途中で引くと、AIの読み・リプレイ・観戦の追いつきが同じ乱数列を消費できず、
 *   決定論（5.2節）が壊れる。引くのは「ゲーム開始時・ターン開始時・ショット開始時」の3か所だけ。
 */
const BilliardsField = (() => {
  'use strict';

  /*
   * 採用ギミック8種（6.5.2節）。door は盤面イベント層の3つの入口（6.10.1節）。
   *   force   … 外力の注入
   *   state   … 状態の書き換え
   *   terrain … 可変地形の設置
   */
  const ALL = [
    { id: 'F-01', door: 'force' },     // 地震
    { id: 'F-03', door: 'force' },     // 台の傾き
    { id: 'F-05', door: 'force' },     // ブラックホール
    { id: 'F-06', door: 'force' },     // 突風
    { id: 'F-07', door: 'terrain' },   // 水たまり
    { id: 'F-08', door: 'terrain' },   // 氷の領域
    { id: 'F-11', door: 'state' },     // 番号シャッフル
    { id: 'B-08', door: 'state' },     // テレポートポケット
  ];
  const ALL_IDS = ALL.map(g => g.id);
  const DOOR = {}; ALL.forEach(g => { DOOR[g.id] = g.door; });

  /*
   * ★**実装が済んだギミックだけをここに並べる。**
   *   選択画面のグレーはこの一覧から決まる。仕様書 11.2.3節の「段階の割り当て」（app.js の STAGE）は
   *   *どの段階でやる予定か* を書いた表であって、*もう入っているか* ではない。
   *   段階の表を見てグレーを決めると、ギミックを1つ足すたびに2か所を直すことになり、
   *   片方を書き忘れれば「入っているのに選べない」か「無いのに選べる」になる。
   *   ルール（RULE_IDS）・台形状（SHAPE_IDS）と同じ形にしてある。
   */
  const IDS = ['F-07', 'F-08'];

  /** 同時に選べる数の上限（6.5.1節）。既定は3種で確定値。apocalypse だけ引き上げる（付録B.2節送り） */
  const PICK_MAX = 3;
  const PICK_MAX_APOCALYPSE = 5;        // 暫定。付録B.2節で詰める

  /*
   * ───────── 可変地形（F-07 水たまり／F-08 氷の領域）─────────
   *
   * 物理は**専用の処理を持たない**（5.11.1節）。「氷の上では摩擦が低い」とは、
   * その場所で摩擦係数の値が小さいという意味でしかない。
   * そこで、ゴルフ型の砂や池と同じ「台面の一部だけ摩擦の違う場所」＝**区画**（5.3.4節・D430）
   * として台へ渡す。engine 側に地形の名前は1つも出てこない。
   *
   * ★下の数値はどれも**付録B送り**（6.12節）＝実際に玉を転がして詰めるもの。
   *   いまの値は暫定である。**5.11.2節の絶対制約だけは破れない**
   *   ＝摩擦係数は0であってはならない（0にすると玉が止まらず、ターンが終わらない）。
   */
  const CLOTH_SLIDE = 0.20, CLOTH_ROLL = 0.010;   // 台の標準値（table.js）。比べるための目安

  const TERRAIN = {
    // 水たまり＝摩擦の増大。ゴルフの池ほど重くはしない（あちらは「入ったら止まる」ための値）
    water: { count: 2, size: 5.0, slide: 0.45, roll: 0.055, apo: 1.6 },
    /*
     * 氷＝摩擦の大幅な低下。**ゼロにはしない**（6.6.7節）。
     *
     * ★**利用者の指示で、台に占める割合を 30〜40%、摩擦を出せるかぎり低くした**（第55セッション）。
     *   ・広さ … 大きさは変えず**個数を 2 → 20**（同じ種類どうしが重なってよくなったため入る＝D448）。
     *     実測 31.5〜39.4%（8形状すべて）。**効き目のほとんどは、摩擦ではなく広さから来る**
     *     （5% で 92mm → 35% で 561mm。そこから摩擦を最小まで下げて 656mm）。
     *   ・摩擦 … **apocalypse でちょうど下限に届く値**を通常の値とした。
     *     apocalypse は強度だけを引き上げる決まり（6.2.5節）なので、通常の値を下限に置くと
     *     **apocalypse で下げる余地が無くなり、難易度の差が消える。**
     *     そこで下限 × 1.8 を通常とし、apocalypse で下限ちょうどになるようにしてある。
     */
    ice: { count: 20, size: 5.0, slide: 0.009, roll: 0.00072, apo: 1 / 1.8 },
  };
  const TERRAIN_GAP = 40;        // **種類が違う**地形のあいだに空ける最小の隙間（mm）。付録B送り
  const PLACE_TRIES = 400;       // 置き場所を1つ探すのに試す回数
  /*
   * ★入らないときは、**その1個だけを縮めて**入れる（利用者判断・第54セッション）。
   *
   *   星型は腕が細く、3個置いた時点で4個目を置ける場所が**1点も残らない**（実測）。
   *   台の面積は8形状そろえてあるのに、置ける場所の広さは形でまるで違う
   *   （外接矩形に対して 標準長方形 59.5% ／ 十字 15.7% ／ 星型 9.1%）。
   *   ・全部の台を小さくすると、7形状の効きまで薄くなる
   *   ・台の太さに比例させると、輪が長くて4個入るドーナツまで縮む
   *   そこで「入らなかったものだけ縮める」。7形状は 5.0 倍のまま1ミリも変わらず、
   *   星型だけ置いた地形の3割ほどが縮む（平均 4.55 倍）。
   */
  const PLACE_SHRINK = [1, 0.8, 0.65, 0.5];

  /** そのギミックが置く地形の種類 */
  const TERRAIN_OF = { 'F-07': 'water', 'F-08': 'ice' };

  /**
   * 地形を1つ置ける場所を探す（6.7.1節）。
   *
   * ★**輪郭は控えている半径よりふくらむ**ので、盤面の内側かどうかは
   *   「ふくらんだあとの大きさ」で見る。ふくらむ前の半径で見ると、
   *   見えている縁が台からはみ出す（第53セッションで砂について直したのと同じ話）。
   * ★玉は避けない（6.7.1節）。開始直後のブレイクで散るため実害が無い。
   * ★乱数は共有シードから引く。ここで Math.random を使うと、通信対戦の相手と
   *   観戦者が別々の地形の盤面を見ることになる。
   *
   * ★**離すのは種類が違うものだけ。同じ種類どうしは重なってよい**（6.7.1節・D448）。
   *   「重ならない」という決まりの理由は**水と氷が重なった場所の物性を定めなければならない**ことにあり、
   *   **氷と氷が重なってもそこは一様に氷のまま**なので、その理由は当てはまらない。
   *   重なりを許さないと、いくつ置こうとしても**台の 28% で頭打ちになる**（実測）。
   */
  function findSpot(rng, table, r, placed, kind) {
    const T = BilliardsTable;
    const grown = r * T.GOLF_BLOB_MAX;
    for (let i = 0; i < PLACE_TRIES; i++) {
      const x = (rng() * 2 - 1) * table.halfW;
      const y = (rng() * 2 - 1) * table.halfH;
      if (T.clearance(table, x, y) < grown) continue;          // 輪郭ごと盤面の内側に収める
      let clash = false;
      for (const o of placed) {
        if (o.kind === kind) continue;                          // 同じ種類どうしは重なってよい（D448）
        const need = grown + o.r * T.GOLF_BLOB_MAX + TERRAIN_GAP;
        if (Math.hypot(x - o.x, y - o.y) < need) { clash = true; break; }
      }
      if (!clash) return { x, y };
    }
    return null;
  }

  /** ゲーム開始時に地形を配置する（6.7.1節）。異常モードは1ゲーム中これが変わらない */
  function placeTerrain(field, rng, table) {
    const out = [];
    ['F-07', 'F-08'].forEach(id => {
      if (!field.has(id)) return;
      const kind = TERRAIN_OF[id];
      const spec = TERRAIN[kind];
      const r0 = BilliardsTable.R * spec.size;
      for (let k = 0; k < spec.count; k++) {
        // まずそのままの大きさで探し、入らなければ順に縮めて入れる
        for (const f of PLACE_SHRINK) {
          const r = r0 * f;
          const spot = findSpot(rng, table, r, out, kind);
          if (spot) { out.push({ kind, x: spot.x, y: spot.y, r, blob: true }); break; }
        }
        // いちばん小さくしても入らなければ、その1個は諦める
      }
    });
    return out;
  }

  /**
   * 台へ渡す区画（摩擦の違う場所）。engine はこれを見るだけで、地形の名前は知らない。
   * 難易度 apocalypse は**強度だけ**を引き上げる（6.2.5節）。
   */
  function patches(field) {
    if (!field || !field.game.terrain) return [];
    return field.game.terrain.map(h => {
      const spec = TERRAIN[h.kind];
      const k = field.apocalypse ? spec.apo : 1;
      // 摩擦は0にできない（5.11.2節）。下限を置いて必ず正にする
      return {
        x: h.x, y: h.y, r: h.r, blob: true,
        slide: Math.max(0.005, spec.slide * k),
        roll: Math.max(0.0004, spec.roll * k),
      };
    });
  }

  /**
   * 水で満たされたポケット（6.7.2節）。
   * **口径の一部が重なっただけでもポケット全体が水になる。**中途半端な水没は作らない。
   * 落球の挙動は変えない。変わるのは効果音だけ。
   * 氷は流れないので、この扱いはしない（重なった範囲だけが氷）。
   */
  function floodedPockets(field, table) {
    const out = {};
    if (!field || !field.game.terrain || !table.pockets) return out;
    const T = BilliardsTable;
    field.game.terrain.forEach(h => {
      if (h.kind !== 'water') return;
      table.pockets.forEach(pk => {
        if (out[pk.id]) return;
        // ポケットの口のどこか1点でも水に入っていれば、そのポケットは水で満たされる
        for (let a = 0; a < 12; a++) {
          const th = a / 12 * Math.PI * 2;
          if (T.blobContains(h, pk.x + Math.cos(th) * pk.r, pk.y + Math.sin(th) * pk.r)) { out[pk.id] = true; return; }
        }
        if (T.blobContains(h, pk.x, pk.y)) out[pk.id] = true;
      });
    });
    return out;
  }

  /** 番号を使わないルール（6.5.5節）。番号シャッフルはここでは働かない */
  const NO_NUMBER_RULES = ['G-04', 'G-06', 'G-09', 'G-11'];

  /**
   * そのギミックが選べない理由。選べるなら null。
   * 返すのは i18n のキーであって文言ではない（文言は i18n.js だけが持つ）。
   * @param {string} id  ギミックID
   * @param {{rule:string, hasPockets:boolean}} ctx いま選んでいるルールと台
   */
  function blockOf(id, ctx) {
    if (IDS.indexOf(id) < 0) return 'why.stage3';                       // まだ実装していない（11.6.1節）
    const c = ctx || {};
    if (id === 'F-11' && NO_NUMBER_RULES.indexOf(c.rule) >= 0) return 'why.gimNoNumber';
    if (id === 'B-08' && c.hasPockets === false) return 'why.gimNoPocket';
    return null;
  }

  /** いまのルール・台で実際に選べるギミック。異常モードが選べるかもここから決まる */
  function available(ctx) { return ALL_IDS.filter(id => !blockOf(id, ctx)); }

  /** 同時選択数の上限。難易度 apocalypse だけ引き上がる（6.2.5節） */
  function pickMax(difficulty) { return difficulty === 'apocalypse' ? PICK_MAX_APOCALYPSE : PICK_MAX; }

  /**
   * そのゲームで効くギミックを決める（6.5.3節・6.5.4節）。
   * 異常モード以外は null を返す＝**この層は何もしない**＝通常モードの定義（5.3.2節）。
   *
   * @param {object} spec {mode, gimmicks[], random, difficulty, rule, hasPockets, rng}
   * @returns {object|null} 盤面イベント層の状態
   */
  function create(spec) {
    if (!spec || spec.mode !== 'abnormal') return null;
    const ctx = { rule: spec.rule, hasPockets: spec.hasPockets };
    const pool = available(ctx);
    if (!pool.length) return null;
    const max = pickMax(spec.difficulty);
    let ids;
    if (spec.random) {
      /*
       * ランダムはゲーム開始時に1回だけ抽選し、そのゲーム中は同じ顔ぶれ（6.5.4節）。
       * 抽選は共有シードで引く。ここで Math.random を使うと、
       * 通信対戦の相手と観戦者が別々のギミックの盤面を見ることになる。
       */
      const rng = spec.rng || (() => 0.5);
      const bag = pool.slice();
      const n = Math.min(bag.length, 1 + Math.floor(rng() * max));
      ids = [];
      for (let i = 0; i < n; i++) ids.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
      ids.sort((a, b) => ALL_IDS.indexOf(a) - ALL_IDS.indexOf(b));
    } else {
      ids = (spec.gimmicks || []).filter(id => pool.indexOf(id) >= 0).slice(0, max);
    }
    if (!ids.length) return null;
    return {
      mode: 'abnormal',
      ids,
      apocalypse: spec.difficulty === 'apocalypse',
      has: id => ids.indexOf(id) >= 0,
      game: {},        // ゲーム開始時に決めたもの（地形・傾き）
      turn: {},        // ターン開始時に決めたもの（ブラックホール・テレポの対・シャッフル）
      shot: {},        // ショット開始時に決めたもの（地震の位相・突風）
    };
  }

  /*
   * ───────── 抽選の3か所 ─────────
   * どれも「盤面が止まっている時点」で呼ぶ。転がっている最中には呼ばない。
   * 第1段では中身が無い（口だけ通してある）。ギミックを足すたびにここへ書く。
   */

  /** ゲーム開始時（1ゲーム中不変のもの＝水たまり・氷・台の傾き） */
  function beginGame(field, rng, ctx) {
    if (!field) return;
    field.game = {};
    const table = ctx && ctx.table;
    if (!table) return;
    field.game.terrain = placeTerrain(field, rng, table);
    field.game.flooded = floodedPockets(field, table);
  }

  /** ターン開始時（そのターンだけのもの＝ブラックホール・テレポの対・番号シャッフル） */
  function beginTurn(field, rng, ctx) {
    if (!field) return;
    field.turn = {};
  }

  /** ショット開始時（そのショットだけのもの＝地震の位相・突風の向きと遅れ） */
  function beginShot(field, rng, ctx) {
    if (!field) return;
    field.shot = {};
  }

  /**
   * その1刻みで、その玉へ外力を加える（6.10.1節「外力の注入」）。
   *
   * ★engine.js の step() から**必ず1か所で**呼ばれる。呼ぶ側に書き足してはいけない。
   *   盤面を進める道は5本ある（主ループ・演出無しの一気走らせ・観戦者の追いつき・
   *   リプレイ・AIの読み）ので、呼ぶ側に書くと必ずどれかが抜け、
   *   たとえば「AIだけ地震の無い盤面を読む」という食い違いになる。
   *
   * ★実時間を見ない。揺れの位相はゲーム内の刻み数 tick から作る。
   *
   * 静止球に作用しない原則（6.2.3節）と空中の玉の扱い（6.2.4節）は
   * ギミックごとに違うので、判断はこの中で行う。engine には持ち込まない。
   *
   * @param {object} field
   * @param {object} b     玉
   * @param {number} tick  ゲーム内時間（刻み数）
   * @param {number} dt    1刻みの秒数
   * @param {object} table 台
   */
  function apply(field, b, tick, dt, table) {
    if (!field) return false;
    return false;      // 第1段＝まだ何も注入しない
  }

  /** 画面が描くための地形の一覧（物理・ルールと同じものを見る） */
  function terrain(field) { return (field && field.game.terrain) || []; }
  /** その点がいずれかの地形の中か。中なら地形を返す（音と演出が使う） */
  function terrainAt(field, x, y) {
    const list = terrain(field);
    for (const h of list) if (BilliardsTable.blobContains(h, x, y)) return h;
    return null;
  }

  return {
    ALL_IDS, DOOR, IDS, PICK_MAX, TERRAIN, CLOTH_SLIDE, CLOTH_ROLL,
    blockOf, available, pickMax, create,
    beginGame, beginTurn, beginShot, apply,
    patches, terrain, terrainAt, floodedPockets,
  };
})();

if (typeof window !== 'undefined') window.BilliardsField = BilliardsField;
