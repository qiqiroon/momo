/* MOMO 1024 — ルールの処理（画面に依存しない）。仕様書 v0.02 §2〜§6、3D は §17.5
   ブラウザでは window.M1024Core、Node では require() で使う。
   盤面：2D は grid[r][c]、3D は grid[d][r][c]（d＝奥行き。0 が最初の向きでいちばん手前）。
   4D は grid[w][d][r][c]（w＝立方体の並びの何番目。左から）、5D は grid[v][w][d][r][c]（v＝並びの平面の何段目。上から）。
   位置は配列（2D は [r, c]、3D は [d, r, c]、4D は [w, d, r, c]、5D は [v, w, d, r, c]）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.M1024Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_SIZE = 4, MAX_SIZE = 16;          // 2D
  var MIN_SIZE_3D = 2, MAX_SIZE_3D = 5;     // 3D（§17.5）
  var MIN_SIZE_HI = 2, MAX_SIZE_HI = 4;     // 4D・5D（§18）
  var GOAL_CAP_HI = 13;                     // 4D・5D のゴールの上限 2^13＝8192（§18。遊び切れる長さにする）
  // ただし 4D 4 と 5D 4 は、8192 では出る札の強さをどう上げても「向きを順番に押すだけ」でクリアできたため、
  // 順番押しが詰まるところまでゴールを上げる（§20。tools/find_levels.js で確かめた）
  var GOAL_HI = { '4:4': 15, '5:4': 19, '2:16': 15 };
  // §20 難易度：EASY＝向きを順番に押すだけでもクリアできる強さ／HARD＝それではクリアできない強さ／APO＝その上
  var DIFFICULTIES = ['EASY', 'HARD', 'APO'];
  var OLD_DIFF = { NORMAL: 'HARD' };   // v1.02 までの名前

  // §4.2 出る数字の重みの元（8×8 基準・%）。添字が n
  var BASE_W = [50, 30, 12, 5, 2.5, 0.5, 0.25, 0.12, 0.06, 0.03];
  // §20 強さの目盛り。[1手で出る札の倍率 m, 数字の散らばり β, GOAL との段差 gap]
  //   1手で出る札 ＝ max(1, round(マスの数 ÷ 16 × m))。m＝0 は1枚、m が負なら |m| 手に1枚
  //   出る数字のいちばん上 ＝ min(元の最大, GOAL − gap)
  //   出る数字 ＝ (1−β)×元の重み ＋ β×「いちばん上まで同じ割合」
  //   目盛り1 が v1.02 までのルール（EASY の重み）と同じ
  var LEVELS = [[-2, 0, 4], [0, 0, 4], [0, 0.4, 5], [0, 1, 5], [0.25, 1, 5], [0.5, 1, 5], [0.75, 1, 5], [1, 1, 5],
    [1.5, 1, 5], [2, 1, 5], [3, 1, 5], [4, 1, 5], [6, 1, 5], [8, 1, 5], [12, 1, 5], [16, 1, 5]];
  // 盤面ごとの目盛り [EASY, HARD, APO]。tools/find_levels.js で決めた（§20）。無い盤面は [0, 1, 2]
  var LEVEL_TABLE = {
    '2:4': [0, 1, 2], '2:5': [1, 2, 3], '2:6': [5, 6, 7], '2:7': [6, 7, 8], '2:8': [6, 7, 8], '2:9': [6, 7, 8],
    '2:10': [6, 7, 8], '2:11': [6, 7, 8], '2:12': [7, 8, 9], '2:13': [9, 10, 14], '2:14': [6, 7, 8], '2:15': [8, 9, 14], '2:16': [6, 7, 9],
    '3:2': [0, 1, 2], '3:3': [6, 7, 8], '3:4': [5, 6, 7], '3:5': [6, 7, 9], '4:2': [0, 1, 2], '5:2': [1, 2, 3], '4:3': [5, 6, 7], '5:3': [10, 11, 15], '4:4': [5, 6, 8], '5:4': [5, 6, 7]
  };
  // §10.3 次の札をいくつ見せるか
  var NEXT_VISIBLE = { EASY: 3, HARD: 1, APO: 0 };
  var QUEUE_LEN = 3;

  // 向き → [軸, 行き先の端（0 か N-1）]。2D の軸は 0=r 1=c、3D の軸は 0=d 1=r 2=c
  var DIRS2 = { up: [0, 0], down: [0, 1], left: [1, 0], right: [1, 1] };
  var DIRS3 = { front: [0, 0], back: [0, 1], up: [1, 0], down: [1, 1], left: [2, 0], right: [2, 1] };
  // 4D・5D：3D の向きの軸を後ろへずらし、前に立方体の並びの軸を足す。wminus＝並びの左へ、vminus＝並びの上へ
  function shifted(k) { var o = {}; for (var d in DIRS3) o[d] = [DIRS3[d][0] + k, DIRS3[d][1]]; return o; }
  var DIRS4 = shifted(1); DIRS4.wminus = [0, 0]; DIRS4.wplus = [0, 1];
  var DIRS5 = shifted(2); DIRS5.vminus = [0, 0]; DIRS5.vplus = [0, 1]; DIRS5.wminus = [1, 0]; DIRS5.wplus = [1, 1];
  function dirsOf(dim) { return dim === 5 ? DIRS5 : dim === 4 ? DIRS4 : dim === 3 ? DIRS3 : DIRS2; }
  function normDim(dim) { return dim === 3 || dim === 4 || dim === 5 ? dim : 2; }
  function sizeRange(dim) { dim = normDim(dim); return dim === 2 ? [MIN_SIZE, MAX_SIZE] : dim === 3 ? [MIN_SIZE_3D, MAX_SIZE_3D] : [MIN_SIZE_HI, MAX_SIZE_HI]; }

  function cellsOf(N, dim) { return Math.pow(N, normDim(dim)); }
  // §2.4 ゴール：64×マスの数 に一番近い2の累乗（2D は 6 + round(2·log2 N) と同じ）。4D・5D は 8192 で頭打ち（§18）
  function goalNFor(N, dim) {
    dim = normDim(dim);
    if (GOAL_HI[dim + ':' + N]) return GOAL_HI[dim + ':' + N] + TUNE.goalAdd;
    if (dim === 2) return 6 + Math.round(2 * Math.log2(N)) + TUNE.goalAdd;
    var g = 6 + Math.round(Math.log2(cellsOf(N, dim)));
    return (dim >= 4 ? Math.min(g, GOAL_CAP_HI) : g) + TUNE.goalAdd;
  }
  // 調べる道具（tools/find_levels.js）から目盛りを直接決めるためのつまみ。null なら表を使う
  var TUNE = { level: null, goalAdd: 0 };
  // §4.1 元の重みで出せる最大。3D 以上は同じマスの数の正方形の一辺に読み替える（§17.5）
  function maxSpawnN(N, dim) {
    dim = normDim(dim);
    return dim >= 3 ? Math.max(1, Math.min(Math.round(Math.sqrt(cellsOf(N, dim))) - 3, 9)) : Math.min(N - 3, 9);
  }
  function levelsOf(N, dim) { return LEVEL_TABLE[normDim(dim) + ':' + N] || [1, 2, 3]; }
  function levelOf(N, dim, difficulty) {
    if (TUNE.level != null) return TUNE.level;
    var i = DIFFICULTIES.indexOf(OLD_DIFF[difficulty] || difficulty);
    return levelsOf(N, dim)[i < 0 ? 0 : i];
  }
  // 1手で出る札の数（1 未満なら、何手かに1枚）
  function spawnsPerMove(N, dim, difficulty) {
    var m = LEVELS[levelOf(N, dim, difficulty)][0];
    return m < 0 ? 1 / -m : m ? Math.max(1, Math.round(cellsOf(N, dim) / 16 * m)) : 1;
  }
  // 元の重みで出せる最大（GOAL との段差で頭打ち）と、散らばりも含めた出る数字のいちばん上
  function baseTopN(N, dim, difficulty) { return Math.max(1, Math.min(maxSpawnN(N, dim), goalNFor(N, dim) - LEVELS[levelOf(N, dim, difficulty)][2])); }
  function spawnTopN(N, dim, difficulty) {
    var L = LEVELS[levelOf(N, dim, difficulty)];
    return L[1] > 0 ? Math.max(1, goalNFor(N, dim) - L[2]) : baseTopN(N, dim, difficulty);
  }
  // §4.5
  function startTiles(N, dim) { return Math.round(cellsOf(N, dim) / 8); }

  // §4.2 出せる n だけ残して確率にする
  function spawnDist(N, difficulty, dim) {
    var b = LEVELS[levelOf(N, dim, difficulty)][1], top = spawnTopN(N, dim, difficulty);
    var w = BASE_W.slice(0, baseTopN(N, dim, difficulty) + 1), sum = w.reduce(function (a, x) { return a + x; }, 0), out = [];
    for (var n = 0; n <= top; n++) out.push((1 - b) * (n < w.length ? w[n] / sum : 0) + b / (top + 1));
    return out;
  }

  // §4.4 mulberry32。状態は整数1つで、記録に入れられる
  function rngNext(state) {
    var s = (state.rng + 0x6D2B79F5) | 0;
    state.rng = s;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function drawN(state) {
    var dist = spawnDist(state.size, state.difficulty, state.dim);
    var x = rngNext(state), acc = 0;
    for (var n = 0; n < dist.length; n++) {
      acc += dist[n];
      if (x < acc) return n;
    }
    return dist.length - 1;
  }

  // ── 盤面の読み書き（何次元でも同じ） ──
  function get(grid, p) { var g = grid; for (var i = 0; i < p.length - 1; i++) g = g[p[i]]; return g[p[p.length - 1]]; }
  function put(grid, p, v) { var g = grid; for (var i = 0; i < p.length - 1; i++) g = g[p[i]]; g[p[p.length - 1]] = v; }
  // 位置の一覧。先頭の軸がいちばん上の桁（2D は行ごと、3D は層ごと）
  function allPos(N, dim) {
    var out = [], total = Math.pow(N, dim);
    for (var k = 0; k < total; k++) {
      var p = new Array(dim), x = k;
      for (var i = dim - 1; i >= 0; i--) { p[i] = x % N; x = Math.floor(x / N); }
      out.push(p);
    }
    return out;
  }
  function makeGrid(N, dim) {
    var g = [];
    for (var i = 0; i < N; i++) g.push(dim > 1 ? makeGrid(N, dim - 1) : null);
    return g;
  }
  function cloneGrid(grid) { return grid.map(function (x) { return Array.isArray(x) ? cloneGrid(x) : x; }); }
  function gridDim(grid) { var d = 0, g = grid; while (Array.isArray(g)) { d++; g = g[0]; } return d; }

  function emptyCells(grid) {
    var N = grid.length, dim = gridDim(grid);
    return allPos(N, dim).filter(function (p) { return !get(grid, p); });
  }

  function newTile(state, n) { return { n: n, id: ++state.idCounter }; }

  // 空きマスの1つに札を出す。出した場所と札を返す（空きがなければ null）
  function spawnAt(state, n) {
    var cells = emptyCells(state.grid);
    if (!cells.length) return null;
    var pos = cells[Math.floor(rngNext(state) * cells.length)];
    var t = newTile(state, n);
    put(state.grid, pos, t);
    if (n > state.maxN) state.maxN = n;
    return { id: t.id, n: n, at: pos };
  }

  function takeFromQueue(state) {
    var n = state.queue.shift();
    while (state.queue.length < QUEUE_LEN) state.queue.push(drawN(state));
    return n;
  }

  function newGame(opts) {
    var N = opts.size, d = OLD_DIFF[opts.difficulty] || opts.difficulty, dim = normDim(opts.dim);
    var rg = sizeRange(dim);
    if (!(N >= rg[0] && N <= rg[1])) throw new Error('size');
    if (DIFFICULTIES.indexOf(d) < 0) throw new Error('difficulty');
    var seed = (opts.seed != null ? opts.seed : (Date.now() ^ (Math.random() * 4294967296))) | 0;
    var state = {
      size: N, dim: dim, difficulty: d, goalN: goalNFor(N, dim),
      grid: makeGrid(N, dim), queue: [], score: 0, moves: 0, maxN: 0,
      playMs: 0, idCounter: 0, seed: seed, rng: seed,
      status: 'PLAYING', spawnPerMove: opts.spawnPerMove || spawnsPerMove(N, dim, d)
    };
    var spawns = [], k = startTiles(N, dim);
    for (var i = 0; i < k; i++) spawns.push(spawnAt(state, drawN(state)));
    while (state.queue.length < QUEUE_LEN) state.queue.push(drawN(state));
    state.maxN = maxOnBoard(state.grid);
    return { state: state, events: { spawns: spawns } };
  }

  function maxOnBoard(grid) {
    var m = 0;
    allPos(grid.length, gridDim(grid)).forEach(function (p) { var t = get(grid, p); if (t && t.n > m) m = t.n; });
    return m;
  }

  function cloneState(s) {
    var o = {};
    for (var k in s) o[k] = s[k];
    o.grid = cloneGrid(s.grid);
    o.queue = s.queue.slice();
    return o;
  }

  // 向きごとの列。各列は、滑っていく先の端から並べたマスの位置
  function linesOf(dir, N, dim) {
    var a = dirsOf(dim)[dir];
    if (!a) throw new Error('dir');
    var axis = a[0], toEnd = a[1], lines = [];
    var others = [];
    for (var x = 0; x < dim; x++) if (x !== axis) others.push(x);
    var count = Math.pow(N, dim - 1);
    for (var k = 0; k < count; k++) {
      // k を N 進数に読み、上の桁から others に割り当てる（2D・3D の並び順は前と同じ）
      var digits = new Array(others.length), x = k;
      for (var j = others.length - 1; j >= 0; j--) { digits[j] = x % N; x = Math.floor(x / N); }
      var line = [];
      for (var i = 0; i < N; i++) {
        var p = new Array(dim);
        p[axis] = toEnd ? N - 1 - i : i;
        for (var j2 = 0; j2 < others.length; j2++) p[others[j2]] = digits[j2];
        line.push(p);
      }
      lines.push(line);
    }
    return lines;
  }
  function samePos(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  /* §5 滑らせる。state は変えず、新しい state と出来事を返す。
     events.slides : [{id, from, to}]        … 動いた札（合体で消える札も含む）
     events.merges : [{id, n, at, from:[id,id]}] … 合体でできた札
     events.spawns : [{id, n, at}]
     events.gained : この手で増えたスコア */
  function move(state, dir) {
    if (state.status !== 'PLAYING') return { state: state, moved: false, events: null };
    var N = state.size, dim = state.dim || 2, s = cloneState(state);
    var g = s.grid, old = state.grid;
    var slides = [], merges = [], gained = 0, moved = false;

    linesOf(dir, N, dim).forEach(function (cells) {
      var tiles = [];
      cells.forEach(function (p) { var t = get(old, p); if (t) tiles.push({ t: t, from: p }); });
      var out = [];
      for (var j = 0; j < tiles.length; j++) {
        var a = tiles[j], b = tiles[j + 1];
        var to = cells[out.length];
        if (b && b.t.n === a.t.n) {
          var nt = newTile(s, a.t.n + 1);
          out.push(nt);
          slides.push({ id: a.t.id, from: a.from, to: to });
          slides.push({ id: b.t.id, from: b.from, to: to });
          merges.push({ id: nt.id, n: nt.n, at: to, from: [a.t.id, b.t.id] });
          gained += Math.pow(2, nt.n);
          moved = true;
          j++;
        } else {
          out.push(a.t);
          if (!samePos(a.from, to)) {
            slides.push({ id: a.t.id, from: a.from, to: to });
            moved = true;
          }
        }
      }
      for (var q = 0; q < N; q++) put(g, cells[q], q < out.length ? out[q] : null);
    });

    if (!moved) return { state: state, moved: false, events: null };

    s.score += gained;
    s.moves += 1;
    var spawns = [];
    for (var m = 0; m < merges.length; m++) if (merges[m].n > s.maxN) s.maxN = merges[m].n;

    if (s.maxN >= s.goalN) {
      s.status = 'CLEAR';
    } else {
      // 1手で出す数。1 未満の割合なら、端数を持ち越して何手かに1枚出す
      var due = (s.spawnAcc || 0) + s.spawnPerMove, k = Math.floor(due + 1e-9);
      s.spawnAcc = due - k;
      for (var x = 0; x < k; x++) {
        if (!emptyCells(g).length) break;
        spawns.push(spawnAt(s, takeFromQueue(s)));
      }
      if (!canMove(g)) s.status = 'GAME_OVER';
    }
    return { state: s, moved: true, events: { dir: dir, slides: slides, merges: merges, spawns: spawns, gained: gained } };
  }

  // §6 空きがあるか、隣り合う同じ数字があれば動かせる（3D 以上は全部の軸の隣を見る）
  function canMove(grid) {
    var N = grid.length, dim = gridDim(grid), ps = allPos(N, dim);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], t = get(grid, p);
      if (!t) return true;
      for (var ax = 0; ax < dim; ax++) {
        if (p[ax] + 1 >= N) continue;
        var q = p.slice(); q[ax]++;
        var u = get(grid, q);
        if (u && u.n === t.n) return true;
      }
    }
    return false;
  }

  function visibleNext(state) { return state.queue.slice(0, NEXT_VISIBLE[state.difficulty]); }

  return {
    MIN_SIZE: MIN_SIZE, MAX_SIZE: MAX_SIZE, MIN_SIZE_3D: MIN_SIZE_3D, MAX_SIZE_3D: MAX_SIZE_3D,
    MIN_SIZE_HI: MIN_SIZE_HI, MAX_SIZE_HI: MAX_SIZE_HI, sizeRange: sizeRange, dirsOf: dirsOf,
    DIFFICULTIES: DIFFICULTIES, BASE_W: BASE_W, LEVELS: LEVELS, LEVEL_TABLE: LEVEL_TABLE, NEXT_VISIBLE: NEXT_VISIBLE,
    levelsOf: levelsOf, levelOf: levelOf, spawnTopN: spawnTopN,
    DIRS2: DIRS2, DIRS3: DIRS3, DIRS4: DIRS4, DIRS5: DIRS5,
    TUNE: TUNE, spawnsPerMove: spawnsPerMove,
    goalNFor: goalNFor, maxSpawnN: maxSpawnN, startTiles: startTiles, spawnDist: spawnDist,
    newGame: newGame, move: move, canMove: canMove, visibleNext: visibleNext,
    emptyCells: emptyCells, get: get, allPos: allPos
  };
});
