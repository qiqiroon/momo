/* MOMO 1024 — ルールの処理（画面に依存しない）。仕様書 v0.02 §2〜§6
   ブラウザでは window.M1024Core、Node では require() で使う。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.M1024Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_SIZE = 4, MAX_SIZE = 16;
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

  // §2.4 ゴール：64×N² に一番近い2の累乗
  function goalNFor(N) { return 6 + Math.round(2 * Math.log2(N)); }
  // §4.1
  function maxSpawnN(N) { return Math.min(N - 3, 9); }
  // §4.5
  function startTiles(N) { return Math.round(N * N / 8); }

  // §4.2 出せる n だけ残して確率にする
  function spawnDist(N, difficulty) {
    var w = WEIGHTS[difficulty].slice(0, maxSpawnN(N) + 1);
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
    var dist = spawnDist(state.size, state.difficulty);
    var x = rngNext(state), acc = 0;
    for (var n = 0; n < dist.length; n++) {
      acc += dist[n];
      if (x < acc) return n;
    }
    return dist.length - 1;
  }

  function emptyCells(grid) {
    var out = [];
    for (var r = 0; r < grid.length; r++)
      for (var c = 0; c < grid.length; c++)
        if (!grid[r][c]) out.push([r, c]);
    return out;
  }

  function newTile(state, n) { return { n: n, id: ++state.idCounter }; }

  // 空きマスの1つに札を出す。出した場所と札を返す（空きがなければ null）
  function spawnAt(state, n) {
    var cells = emptyCells(state.grid);
    if (!cells.length) return null;
    var pos = cells[Math.floor(rngNext(state) * cells.length)];
    var t = newTile(state, n);
    state.grid[pos[0]][pos[1]] = t;
    if (n > state.maxN) state.maxN = n;
    return { id: t.id, n: n, at: pos };
  }

  function takeFromQueue(state) {
    var n = state.queue.shift();
    while (state.queue.length < QUEUE_LEN) state.queue.push(drawN(state));
    return n;
  }

  function newGame(opts) {
    var N = opts.size, d = opts.difficulty;
    if (!(N >= MIN_SIZE && N <= MAX_SIZE)) throw new Error('size');
    if (DIFFICULTIES.indexOf(d) < 0) throw new Error('difficulty');
    var seed = (opts.seed != null ? opts.seed : (Date.now() ^ (Math.random() * 4294967296))) | 0;
    var state = {
      size: N, difficulty: d, goalN: goalNFor(N),
      grid: [], queue: [], score: 0, moves: 0, maxN: 0,
      playMs: 0, idCounter: 0, seed: seed, rng: seed,
      status: 'PLAYING', spawnPerMove: opts.spawnPerMove || 1
    };
    for (var r = 0; r < N; r++) { state.grid.push([]); for (var c = 0; c < N; c++) state.grid[r].push(null); }
    var spawns = [], k = startTiles(N);
    for (var i = 0; i < k; i++) spawns.push(spawnAt(state, drawN(state)));
    while (state.queue.length < QUEUE_LEN) state.queue.push(drawN(state));
    state.maxN = maxOnBoard(state.grid);
    return { state: state, events: { spawns: spawns } };
  }

  function maxOnBoard(grid) {
    var m = 0;
    for (var r = 0; r < grid.length; r++)
      for (var c = 0; c < grid.length; c++)
        if (grid[r][c] && grid[r][c].n > m) m = grid[r][c].n;
    return m;
  }

  function cloneState(s) {
    var o = {};
    for (var k in s) o[k] = s[k];
    o.grid = s.grid.map(function (row) { return row.slice(); });
    o.queue = s.queue.slice();
    return o;
  }

  // 向きごとに、列 k の i 番目（滑っていく先から数える）のマス
  function cellOf(dir, N, k, i) {
    switch (dir) {
      case 'left':  return [k, i];
      case 'right': return [k, N - 1 - i];
      case 'up':    return [i, k];
      case 'down':  return [N - 1 - i, k];
    }
    throw new Error('dir');
  }

  /* §5 滑らせる。state は変えず、新しい state と出来事を返す。
     events.slides : [{id, from, to}]        … 動いた札（合体で消える札も含む）
     events.merges : [{id, n, at, from:[id,id]}] … 合体でできた札
     events.spawns : [{id, n, at}]
     events.gained : この手で増えたスコア */
  function move(state, dir) {
    if (state.status !== 'PLAYING') return { state: state, moved: false, events: null };
    var N = state.size, s = cloneState(state);
    var g = s.grid, old = state.grid;
    var slides = [], merges = [], gained = 0, moved = false;

    for (var k = 0; k < N; k++) {
      var cells = [], tiles = [];
      for (var i = 0; i < N; i++) {
        var p = cellOf(dir, N, k, i);
        cells.push(p);
        if (old[p[0]][p[1]]) tiles.push({ t: old[p[0]][p[1]], from: p });
      }
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
          if (a.from[0] !== to[0] || a.from[1] !== to[1]) {
            slides.push({ id: a.t.id, from: a.from, to: to });
            moved = true;
          }
        }
      }
      for (var q = 0; q < N; q++) {
        var c2 = cells[q];
        g[c2[0]][c2[1]] = q < out.length ? out[q] : null;
      }
    }

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

  // §6 空きがあるか、隣り合う同じ数字があれば動かせる
  function canMove(grid) {
    var N = grid.length;
    for (var r = 0; r < N; r++)
      for (var c = 0; c < N; c++) {
        var t = grid[r][c];
        if (!t) return true;
        if (c + 1 < N && grid[r][c + 1] && grid[r][c + 1].n === t.n) return true;
        if (r + 1 < N && grid[r + 1][c] && grid[r + 1][c].n === t.n) return true;
      }
    return false;
  }

  function visibleNext(state) { return state.queue.slice(0, NEXT_VISIBLE[state.difficulty]); }

  return {
    MIN_SIZE: MIN_SIZE, MAX_SIZE: MAX_SIZE, DIFFICULTIES: DIFFICULTIES,
    WEIGHTS: WEIGHTS, NEXT_VISIBLE: NEXT_VISIBLE,
    goalNFor: goalNFor, maxSpawnN: maxSpawnN, startTiles: startTiles, spawnDist: spawnDist,
    newGame: newGame, move: move, canMove: canMove, visibleNext: visibleNext,
    emptyCells: emptyCells
  };
});
