/* MOMO 1024 — ルールの処理（画面に依存しない）。仕様書 v0.02 §2〜§6、3D は §17.5
   ブラウザでは window.M1024Core、Node では require() で使う。
   盤面：2D は grid[r][c]、3D は grid[d][r][c]（d＝奥行き。0 が最初の向きでいちばん手前）。
   位置はどちらも配列（2D は [r, c]、3D は [d, r, c]）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.M1024Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_SIZE = 4, MAX_SIZE = 16;          // 2D
  var MIN_SIZE_3D = 2, MAX_SIZE_3D = 5;     // 3D（§17.5）
  var DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'];

  // §4.2 重みの表（8×8 基準・%）。添字が n
  var WEIGHTS = {
    EASY:   [50, 30, 12, 5, 2.5, 0.5, 0.25, 0.12, 0.06, 0.03],
    NORMAL: [40, 30, 15, 8, 5,   2,   1.2,  0.7,  0.4,  0.25],
    HARD:   [30, 25, 20, 12, 8,  5,   3.5,  2.5,  1.75, 1.25]
  };
  // §10.3 次の札をいくつ見せるか
  var NEXT_VISIBLE = { EASY: 3, NORMAL: 1, HARD: 0 };
  var QUEUE_LEN = 3;

  // 向き → [軸, 行き先の端（0 か N-1）]。2D の軸は 0=r 1=c、3D の軸は 0=d 1=r 2=c
  var DIRS2 = { up: [0, 0], down: [0, 1], left: [1, 0], right: [1, 1] };
  var DIRS3 = { front: [0, 0], back: [0, 1], up: [1, 0], down: [1, 1], left: [2, 0], right: [2, 1] };
  function dirsOf(dim) { return dim === 3 ? DIRS3 : DIRS2; }

  function cellsOf(N, dim) { return Math.pow(N, dim === 3 ? 3 : 2); }
  // §2.4 ゴール：64×マスの数 に一番近い2の累乗（2D は 6 + round(2·log2 N) と同じ）
  function goalNFor(N, dim) { return dim === 3 ? 6 + Math.round(Math.log2(cellsOf(N, 3))) : 6 + Math.round(2 * Math.log2(N)); }
  // §4.1。3D は同じマスの数の正方形の一辺に読み替える（§17.5）
  function maxSpawnN(N, dim) {
    if (dim === 3) return Math.max(1, Math.min(Math.round(Math.sqrt(cellsOf(N, 3))) - 3, 9));
    return Math.min(N - 3, 9);
  }
  // §4.5
  function startTiles(N, dim) { return Math.round(cellsOf(N, dim) / 8); }

  // §4.2 出せる n だけ残して確率にする
  function spawnDist(N, difficulty, dim) {
    var w = WEIGHTS[difficulty].slice(0, maxSpawnN(N, dim) + 1);
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    return w.map(function (x) { return x / sum; });
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

  // ── 盤面の読み書き（2D・3D 共通） ──
  function get(grid, p) { return p.length === 3 ? grid[p[0]][p[1]][p[2]] : grid[p[0]][p[1]]; }
  function put(grid, p, v) { if (p.length === 3) grid[p[0]][p[1]][p[2]] = v; else grid[p[0]][p[1]] = v; }
  function allPos(N, dim) {
    var out = [];
    if (dim === 3) { for (var d = 0; d < N; d++) for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) out.push([d, r, c]); }
    else { for (var r2 = 0; r2 < N; r2++) for (var c2 = 0; c2 < N; c2++) out.push([r2, c2]); }
    return out;
  }
  function makeGrid(N, dim) {
    function plane() { var g = []; for (var r = 0; r < N; r++) { g.push([]); for (var c = 0; c < N; c++) g[r].push(null); } return g; }
    if (dim !== 3) return plane();
    var g3 = []; for (var d = 0; d < N; d++) g3.push(plane()); return g3;
  }
  function cloneGrid(grid, dim) {
    if (dim === 3) return grid.map(function (pl) { return pl.map(function (row) { return row.slice(); }); });
    return grid.map(function (row) { return row.slice(); });
  }
  function gridDim(grid) { return Array.isArray(grid[0][0]) ? 3 : 2; }

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
    var N = opts.size, d = opts.difficulty, dim = opts.dim === 3 ? 3 : 2;
    var lo = dim === 3 ? MIN_SIZE_3D : MIN_SIZE, hi = dim === 3 ? MAX_SIZE_3D : MAX_SIZE;
    if (!(N >= lo && N <= hi)) throw new Error('size');
    if (DIFFICULTIES.indexOf(d) < 0) throw new Error('difficulty');
    var seed = (opts.seed != null ? opts.seed : (Date.now() ^ (Math.random() * 4294967296))) | 0;
    var state = {
      size: N, dim: dim, difficulty: d, goalN: goalNFor(N, dim),
      grid: makeGrid(N, dim), queue: [], score: 0, moves: 0, maxN: 0,
      playMs: 0, idCounter: 0, seed: seed, rng: seed,
      status: 'PLAYING', spawnPerMove: opts.spawnPerMove || 1
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
    o.grid = cloneGrid(s.grid, s.dim || 2);
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
      var line = [], u = k % N, v = Math.floor(k / N);
      for (var i = 0; i < N; i++) {
        var p = new Array(dim);
        p[axis] = toEnd ? N - 1 - i : i;
        p[others[0]] = dim === 3 ? v : k;
        if (dim === 3) p[others[1]] = u;
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
      for (var x = 0; x < s.spawnPerMove; x++) {
        if (!emptyCells(g).length) break;
        spawns.push(spawnAt(s, takeFromQueue(s)));
      }
      if (!canMove(g)) s.status = 'GAME_OVER';
    }
    return { state: s, moved: true, events: { dir: dir, slides: slides, merges: merges, spawns: spawns, gained: gained } };
  }

  // §6 空きがあるか、隣り合う同じ数字があれば動かせる（3D は奥行きの隣も見る）
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
    DIFFICULTIES: DIFFICULTIES, WEIGHTS: WEIGHTS, NEXT_VISIBLE: NEXT_VISIBLE,
    DIRS2: DIRS2, DIRS3: DIRS3,
    goalNFor: goalNFor, maxSpawnN: maxSpawnN, startTiles: startTiles, spawnDist: spawnDist,
    newGame: newGame, move: move, canMove: canMove, visibleNext: visibleNext,
    emptyCells: emptyCells, get: get, allPos: allPos
  };
});
