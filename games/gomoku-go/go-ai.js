/**
 * go-ai.js  v1.0
 * 囲碁の思考ルーチン（MOMO Go「ひとりで遊ぶ」用）
 *
 * 公開API:
 *   MomoGoAI.chooseMove(board, color, difficulty, opts) -> {x,y} | 'pass'
 *     - board は index.html と同じ [y][x] の二次元配列（'black' | 'white' | null）
 *     - difficulty: 'easy' | 'medium' | 'hard'（画面表示は EASY / HARD / APOCALYPSE）
 *     - opts = { size, prevOwnBoard, captures, komi, moveNumber, oppPassed, lastMove }
 *         prevOwnBoard … コウ判定用（自分が前回打った直後の盤面）
 *         captures      … { black, white } 取った石の数
 *
 * ★強さについて、はじめに断っておくこと
 *   19路の囲碁は、形の良し悪しを式で書いて強くできる競技ではありません。
 *   ここでやっているのは「石の取り合い・アタリ・自分の目をつぶさない」といった
 *   目の前の損得と、序盤の置き場所の目安だけです。**大局観はありません。**
 *   APOCALYPSE でも絶対的には弱く、対局相手になる程度と考えてください。
 *   （五目並べ側と違い、読みで押し切れる競技ではないためです）
 *
 * 見ているもの:
 *   1) 石を取れるか／自分の石が取られるか（アタリ・逃げ・自分から詰まる手）
 *   2) 自分の目をつぶす手は打たない
 *   3) 置き場所の目安（3線・4線、既にある石との間合い、相手の直前手の近く）
 *   4) APOCALYPSE だけ、打った後に相手に取り返されないかを1手だけ見る
 */
(function (root) {
  'use strict';

  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  function inBounds(x, y, size) { return x >= 0 && x < size && y >= 0 && y < size; }

  function countStones(board, size) {
    let n = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (board[y][x]) n++;
    return n;
  }

  // 自分の目（囲まれた1目の空点）かどうか。ここを埋めると自分の陣地が壊れる。
  function isOwnEye(board, x, y, color, size) {
    for (const [dx, dy] of ORTH) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny, size)) continue;   // 盤の縁は壁として数える
      if (board[ny][nx] !== color) return false;
    }
    let mine = 0, onBoard = 0, off = 0;
    for (const [dx, dy] of DIAG) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny, size)) { off++; continue; }
      onBoard++;
      if (board[ny][nx] === color) mine++;
    }
    // 端・隅では斜めが全部自分、盤の中では3つ以上あれば目とみなす
    return off > 0 ? (mine === onBoard) : (mine >= 3);
  }

  // 一番近い石までの距離（縦横斜めの粗い距離）。石が無ければ -1。
  function nearestStoneDist(board, x, y, size, cap) {
    for (let r = 1; r <= cap; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny, size)) continue;
          if (board[ny][nx]) return r;
        }
      }
    }
    return -1;
  }

  // 置き場所の目安。序盤は3線・4線、石からの間合いも見る。
  function placementScore(board, x, y, size, stones, lastMove) {
    const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
    let s = 0;
    const opening = stones < 40;
    if (opening) {
      if (edge === 0) s -= 14;
      else if (edge === 1) s -= 6;
      else if (edge === 2) s += 8;
      else if (edge === 3) s += 9;
      else if (edge === 4) s += 4;
    } else {
      if (edge === 0) s -= 4;
    }
    const nd = nearestStoneDist(board, x, y, size, 6);
    if (nd < 0) {
      s += 2;
    } else if (opening) {
      if (nd === 1) s += 1;
      else if (nd === 2) s += 6;
      else if (nd === 3) s += 7;
      else if (nd === 4) s += 5;
      else if (nd >= 6) s -= 3;
    } else {
      if (nd === 1) s += 5;
      else if (nd === 2) s += 3;
      else if (nd >= 5) s -= 4;
    }
    // 相手の直前手の近くは、放っておくと損をしやすい
    if (lastMove) {
      const d = Math.max(Math.abs(x - lastMove.x), Math.abs(y - lastMove.y));
      if (d <= 2) s += 5;
      else if (d <= 4) s += 2;
    }
    return s;
  }

  // 盤を全部調べると重いので、打つ値打ちのありそうな空点だけに絞る
  function candidatePoints(board, size, stones, lastMove) {
    const out = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y][x]) continue;
        const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
        const nd = nearestStoneDist(board, x, y, size, 4);
        // 石の近く／盤に石が無い序盤の3線4線 を候補にする
        if (nd >= 1 || (stones < 40 && edge >= 2 && edge <= 3)) {
          out.push({ x, y, nd, edge });
        }
      }
    }
    if (!out.length) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!board[y][x]) out.push({ x, y, nd: -1, edge: 0 });
    }
    return out;
  }

  // 隣り合う相手の石のうち、取られそう（呼吸点が少ない）ものの様子
  function neighborBlocks(board, x, y, size, want) {
    const seen = new Set();
    const out = [];
    for (const [dx, dy] of ORTH) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny, size)) continue;
      const c = board[ny][nx];
      if (c !== want) continue;
      const key = ny * size + nx;
      if (seen.has(key)) continue;
      const blk = GoRules.getBlock(board, nx, ny, size);
      if (!blk) continue;
      for (const st of blk.stones) seen.add(st.y * size + st.x);
      out.push(blk);
    }
    return out;
  }

  const LEVELS = {
    easy:   { tactics: 0.45, placement: 0.5, jitter: 6, topPick: 8, reply: false },
    medium: { tactics: 1.0,  placement: 1.0, jitter: 2, topPick: 2, reply: false },
    hard:   { tactics: 1.0,  placement: 1.0, jitter: 1, topPick: 1, reply: true }
  };

  // 打つ値打ちがこれを下回ったら、もう打つところが無いとみなす
  const PASS_THRESHOLD = 0.5;

  function evaluate(board, p, color, size, opts, lv, stones, terr, fillW) {
    const opp = color === 'black' ? 'white' : 'black';
    if (isOwnEye(board, p.x, p.y, color, size)) return null;   // 自分の目は埋めない
    const r = GoRules.placeMove(board, p.x, p.y, color, opts.prevOwnBoard, size);
    if (!r.valid) return null;

    let tac = 0;
    // 取った石
    tac += r.captured.length * 14;
    // 打った後の自分の呼吸点。1つしか無いのに何も取っていない＝自分から詰む手
    const myBlk = GoRules.getBlock(r.newBoard, p.x, p.y, size);
    const myLib = myBlk ? myBlk.liberties : 0;
    if (r.captured.length === 0) {
      if (myLib === 1) tac -= 40;
      else if (myLib === 2) tac -= 3;
    }
    // アタリになっていた自分の石を助けた
    for (const blk of neighborBlocks(board, p.x, p.y, size, color)) {
      if (blk.liberties === 1 && myLib >= 2) tac += 10 + blk.stones.length * 3;
    }
    // 相手をアタリにした／追い詰めた
    for (const blk of neighborBlocks(r.newBoard, p.x, p.y, size, opp)) {
      if (blk.liberties === 1) tac += 7 + blk.stones.length * 2;
      else if (blk.liberties === 2) tac += 2;
    }

    let pos = placementScore(board, p.x, p.y, size, stones, opts.lastMove);
    // 自分の地の中を埋めても1目も増えない。盤が埋まってくるほど強くこれを嫌う。
    // 決まった地はアプリの地計算（go-scoring.js）と同じ見方を借りるので、
    // 「AI はまだ打てると思っているのに数え方では地」というズレが起きない。
    if (fillW > 0 && terr) {
      const owner = terr.territoryMap[p.y][p.x];
      if (owner === color) pos -= 30 * fillW;
      else if (owner === opp) pos -= 14 * fillW;   // 相手の地の中は普通は死ぬだけ
    }
    const jit = lv.jitter > 0 ? (Math.random() - 0.5) * lv.jitter : 0;
    return { p, r, myLib, score: tac * lv.tactics + pos * lv.placement + jit };
  }

  function chooseMove(board, color, difficulty, opts) {
    opts = opts || {};
    const size = opts.size || board.length;
    const lv = LEVELS[difficulty] || LEVELS.medium;
    const opp = color === 'black' ? 'white' : 'black';
    if (typeof GoRules === 'undefined') return 'pass';

    const stones = countStones(board, size);
    // 空の盤なら星（隅の目印）から始める
    if (stones === 0) {
      const s = [3, size - 4];
      const x = s[Math.floor(Math.random() * 2)], y = s[Math.floor(Math.random() * 2)];
      return { x, y };
    }

    // 「どこが誰の地になりそうか」は1手につき1回だけ数える
    const terr = (typeof GoScoring !== 'undefined') ? GoScoring.computeTerritory(board, [], size) : null;
    const fillW = Math.max(0, Math.min(1, (stones - 80) / 80));

    const cands = candidatePoints(board, size, stones, opts.lastMove);
    const scored = [];
    for (const p of cands) {
      const e = evaluate(board, p, color, size, opts, lv, stones, terr, fillW);
      if (e) scored.push(e);
    }
    if (!scored.length) return 'pass';
    scored.sort((a, b) => b.score - a.score);

    // APOCALYPSE: 上位だけ「打った後に相手が大きく取り返せないか」を1手見る
    let best = scored[0];
    if (lv.reply) {
      let bestV = -Infinity;
      for (const e of scored.slice(0, 10)) {
        let worst = 0;
        for (const blk of neighborBlocks(e.r.newBoard, e.p.x, e.p.y, size, color)) {
          if (blk.liberties === 1) worst = Math.max(worst, 8 + blk.stones.length * 3);
        }
        if (e.myLib === 1) worst = Math.max(worst, 8 + (e.r.captured.length ? 0 : 20));
        const v = e.score - worst;
        if (v > bestV) { bestV = v; best = e; }
      }
    } else if (lv.topPick > 1) {
      // EASY / HARD: 同じくらいの手が並んでいたら気まぐれに選ぶ（毎回同じ碁にしない）
      const head = scored.slice(0, lv.topPick);
      best = head[Math.floor(Math.random() * head.length)];
    }

    // --- 終わらせる判断 ---
    const moveNumber = opts.moveNumber || stones;
    if (moveNumber > 400) return 'pass';
    if (best.score < PASS_THRESHOLD) return 'pass';
    if (opts.oppPassed && typeof GoScoring !== 'undefined') {
      // 相手がパスした。今の見込みで自分が勝っているならここで終わらせる
      const sc = GoScoring.computeScore(board, [], opts.captures, opts.komi, size);
      if (sc && sc.winner === color) return 'pass';
    }
    return { x: best.p.x, y: best.p.y };
  }

  const api = { chooseMove, _internal: { isOwnEye, placementScore, candidatePoints, LEVELS } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MomoGoAI = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
