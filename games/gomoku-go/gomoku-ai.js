/**
 * gomoku-ai.js  v1.0
 * 五目並べの思考ルーチン（MOMO Go「ひとりで遊ぶ」用）
 *
 * 公開API:
 *   MomoGomokuAI.chooseMove(board, color, difficulty, opts) -> {x,y} | null
 *     - board は index.html と同じ [y][x] の二次元配列（'black' | 'white' | null）
 *     - difficulty: 'easy' | 'medium' | 'hard'（画面表示は EASY / HARD / APOCALYPSE）
 *     - opts = { size, preset, phase }
 *         preset: 'normal'（正規＝連珠）| 'casual' | 'free'
 *         phase : 'opening_b1' | 'opening_w1' | 'opening_b2' | 'normal'
 *
 *   MomoGomokuAI.chooseSwap(board, opts) -> true(黒を取る) | false(白のまま)
 *     - 正規ルールの三手交換で、白側が選ぶときに使う
 *
 * 考え方:
 *   1) 決め手の階段（五を作る → 五を止める → 達四を作る → 相手の達四を止める）
 *   2) 詰み探索（VCF＝四を連打して勝てる筋があるか。相手の筋も調べて先に潰す）
 *   3) APOCALYPSE だけ、1手仕込んでから詰み筋が立つかも調べる
 *   4) どれも無ければ、形の良し悪しで一番いい点を選ぶ
 *
 *   ※ 「四三・三三をその場で打つ/止める」という段も試したが、形の点数付けが既に
 *      同じ点を上位に置くため、上書きすると弱くなった（出だしを固定した対戦で実測）ので入れていない。
 *
 *   禁手（正規ルールの黒の三三・四四・長連）は候補から外す。
 *   打つと即負けなので、思考の外側で落とすのが確実（gomoku-rules.js の判定を借りる）。
 */
(function (root) {
  'use strict';

  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // 形の値＝「その形がどれだけ勝ちに近いか」の目安
  const VAL = {
    five: 10000000, open4: 500000, four: 12000,
    open3: 9000, three: 600, open2: 250, two: 40
  };
  // EASY 用。決め手（達四・活三）を安く見積もるので、読み落として負けてくれる。
  // ※「強い手にぶれを混ぜて弱くする」のではなく、見えている形の価値表そのものを浅くしている
  const VAL_EASY = {
    five: 10000000, open4: 3000, four: 1200,
    open3: 320, three: 180, open2: 130, two: 40
  };

  // 形の見分け方。'o'=自分の石 'x'=相手の石 '.'=空 '#'=盤外
  const RE = {
    five:  [/ooooo/g],
    open4: [/\.oooo\./g],
    four:  [/oooo\./g, /\.oooo/g, /oo\.oo/g, /o\.ooo/g, /ooo\.o/g],
    open3: [/\.ooo\./g, /\.oo\.o\./g, /\.o\.oo\./g],
    three: [/ooo/g, /oo\.o/g, /o\.oo/g],
    open2: [/\.oo\./g],
    two:   [/oo/g, /o\.o/g]
  };
  const ORDER = ['five', 'open4', 'four', 'open3', 'three', 'open2', 'two'];

  // ---- 盤の読み取り ----

  function cellChar(board, x, y, size, me, opp) {
    if (x < 0 || x >= size || y < 0 || y >= size) return '#';
    const v = board[y][x];
    if (v === me) return 'o';
    if (v === opp) return 'x';
    return '.';
  }

  // (x,y) に me の石を置いたと仮定して、方向 (dx,dy) の 9 マスを文字列にする（中心は 4 番目）。
  // 盤を書き換えずに中心だけ 'o' として読むので、置く/戻すの手間がいらない。
  function window9(board, x, y, dx, dy, size, me, opp) {
    let s = '';
    for (let i = -4; i <= 4; i++) {
      s += (i === 0) ? 'o' : cellChar(board, x + dx * i, y + dy * i, size, me, opp);
    }
    return s;
  }

  // 4方向ぶんの窓をまとめて作る
  function windows4(board, x, y, size, me, opp) {
    const out = [];
    for (const [dx, dy] of DIRS) out.push(window9(board, x, y, dx, dy, size, me, opp));
    return out;
  }

  // 窓の中に自分の石がいくつあるか（'o' の数）。四になりうるかの安い前さばきに使う。
  function ownCount(w) {
    let n = 0;
    for (let i = 0; i < w.length; i++) if (w.charCodeAt(i) === 111) n++;
    return n;
  }

  // その形が「中心の石を含んで」成立しているかを見る。
  // 中心を含まない離れた形を数えると、関係ない所の手を高く買ってしまう。
  function hitsCenter(w, re) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(w)) !== null) {
      if (m.index <= 4 && m.index + m[0].length > 4) return true;
      re.lastIndex = m.index + 1;
    }
    return false;
  }

  function classify(w) {
    for (const kind of ORDER) {
      for (const re of RE[kind]) {
        if (hitsCenter(w, re)) return kind;
      }
    }
    return null;
  }

  /**
   * (x,y) に color を置いたときの形の強さを測る。
   * 戻り値 { score, fours, open3s, five }
   * board[y][x] は呼び出し時に空であること（中で一時的に置いて戻す）。
   */
  function moveShape(board, x, y, color, size, vtab, wins) {
    const opp = color === 'black' ? 'white' : 'black';
    const ws = wins || windows4(board, x, y, size, color, opp);
    let score = 0, fours = 0, open3s = 0, five = false;
    for (const w of ws) {
      const kind = classify(w);
      if (!kind) continue;
      score += vtab[kind];
      if (kind === 'five') five = true;
      if (kind === 'four' || kind === 'open4') fours++;
      if (kind === 'open3') open3s++;
    }
    if (five) return { score: vtab.five, fours, open3s, five: true };
    return { score, fours, open3s, five: false };
  }

  // ---- 候補手 ----

  function hasAnyStone(board, size) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (board[y][x]) return true;
    return false;
  }

  // 既にある石から radius 以内の空点だけを候補にする（盤全部を見ても意味が無い）
  function candidates(board, size, radius) {
    const out = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y][x]) continue;
        let near = false;
        for (let dy = -radius; dy <= radius && !near; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            if (board[ny][nx]) { near = true; break; }
          }
        }
        if (near) out.push({ x, y });
      }
    }
    return out;
  }

  // 正規ルールの禁手（黒の三三・四四・長連）。打つと即負けなので候補から外す。
  function isForbiddenFor(board, x, y, color, preset, size) {
    if (typeof GomokuRules === 'undefined') return false;
    const tbl = GomokuRules.PRESET_RULESETS[preset];
    const ruleSet = tbl ? tbl[color] : null;
    if (!ruleSet) return false;
    return GomokuRules.isForbidden(board, x, y, color, ruleSet, size);
  }

  // ---- 詰み探索（VCF＝四を連打して五まで持っていく筋） ----
  // 四を打つと相手は必ず止めに来るので枝が細い。深く読んでも軽い。

  function fourMoves(board, cands, color, size, preset) {
    const opp = color === 'black' ? 'white' : 'black';
    const out = [];
    for (const p of cands) {
      if (board[p.y][p.x]) continue;
      const ws = windows4(board, p.x, p.y, size, color, opp);
      // 四になるには同じ窓に自分の石が4つ（中心込み）要る。足りない点は形を調べるまでもない
      let maybe = false;
      for (const w of ws) { if (ownCount(w) >= 4) { maybe = true; break; } }
      if (!maybe) continue;
      if (isForbiddenFor(board, p.x, p.y, color, preset, size)) continue;
      const s = moveShape(board, p.x, p.y, color, size, VAL, ws);
      if (s.five) return [{ p, five: true }];
      if (s.fours >= 1) out.push({ p, five: false, score: s.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 12);
  }

  // 相手が五を作れる点（＝いま止めなければならない点）を全部返す
  function fiveMakers(board, cands, color, size) {
    const opp = color === 'black' ? 'white' : 'black';
    const out = [];
    for (const p of cands) {
      if (board[p.y][p.x]) continue;
      const ws = windows4(board, p.x, p.y, size, color, opp);
      let maybe = false;
      for (const w of ws) { if (ownCount(w) >= 5) { maybe = true; break; } }
      if (!maybe) continue;
      const s = moveShape(board, p.x, p.y, color, size, VAL, ws);
      if (s.five) out.push(p);
    }
    return out;
  }

  // baseCands は入口で1回だけ作った候補一覧。探索の途中で作り直すと、
  // そこが一番の重荷になって深く読めなくなる（打った石の周りは元から入っている）。
  function vcf(board, color, size, preset, depth, deadline, state, baseCands) {
    if (depth <= 0) return null;
    if (++state.nodes > state.nodeCap) return null;
    if ((state.nodes & 63) === 0 && Date.now() > deadline) return null;
    const opp = color === 'black' ? 'white' : 'black';
    const attacks = fourMoves(board, baseCands, color, size, preset);
    for (const a of attacks) {
      if (a.five) return [a.p];
      board[a.p.y][a.p.x] = color;
      // 相手は自分の五を止めるしかない。ただし相手が先に五を作れるならこの筋は失敗。
      const oppWin = fiveMakers(board, baseCands, opp, size);
      if (oppWin.length > 0) { board[a.p.y][a.p.x] = null; continue; }
      const blocks = fiveMakers(board, baseCands, color, size);
      if (blocks.length === 1) {
        const b = blocks[0];
        board[b.y][b.x] = opp;
        const r = vcf(board, color, size, preset, depth - 1, deadline, state, baseCands);
        board[b.y][b.x] = null;
        board[a.p.y][a.p.x] = null;
        if (r) return [a.p].concat(r);
      } else {
        // 止める点が2つ以上＝達四。相手は受け切れないのでここで勝ち
        board[a.p.y][a.p.x] = null;
        if (blocks.length >= 2) return [a.p];
      }
    }
    return null;
  }

  // ---- 本体 ----

  const LEVELS = {
    easy:   { vtab: VAL_EASY, ladder: 1, vcfDepth: 0, budgetMs: 60,   topPick: 5, prepWidth: 0  },
    medium: { vtab: VAL,      ladder: 2, vcfDepth: 7, budgetMs: 500,  topPick: 1, prepWidth: 0  },
    hard:   { vtab: VAL,      ladder: 2, vcfDepth: 9, budgetMs: 1200, topPick: 1, prepWidth: 8  }
  };

  function chooseMove(board, color, difficulty, opts) {
    opts = opts || {};
    const size = opts.size || board.length;
    const preset = opts.preset || 'free';
    const phase = opts.phase || 'normal';
    const lv = LEVELS[difficulty] || LEVELS.medium;
    const opp = color === 'black' ? 'white' : 'black';
    const center = Math.floor(size / 2);

    // 正規ルールの黒1手目は天元に固定されている
    if (phase === 'opening_b1') return { x: center, y: center };
    if (!hasAnyStone(board, size)) return { x: center, y: center };

    let cands = candidates(board, size, 2);
    if (!cands.length) return { x: center, y: center };

    // 禁手を候補から外す。全部禁手なら（ほぼ起こらないが）仕方なくそのまま使う
    const legal = cands.filter(p => !isForbiddenFor(board, p.x, p.y, color, preset, size));
    if (legal.length) cands = legal;

    // 各候補について「自分が打った形」と「相手にそこを打たれた形」を測る
    const scored = cands.map(p => {
      const mine = moveShape(board, p.x, p.y, color, size, lv.vtab);
      const theirs = moveShape(board, p.x, p.y, opp, size, lv.vtab);
      // 守りを少し軽く見る＝同じ大きさなら攻める
      const defWeight = (difficulty === 'easy') ? 0.55 : 0.95;
      return { p, mine, theirs, total: mine.score + theirs.score * defWeight };
    });
    scored.sort((a, b) => b.total - a.total);

    // --- 決め手の階段 ---
    // 1. 自分が五を作れる
    const myFive = scored.find(s => s.mine.five);
    if (myFive) return myFive.p;
    // 2. 相手が五を作れる → 止める
    const theirFive = scored.find(s => s.theirs.five);
    if (theirFive) return theirFive.p;

    if (lv.ladder >= 2) {
      // 3. 自分が達四を作れる
      const myOpen4 = scored.find(s => s.mine.fours >= 1 && s.mine.score >= VAL.open4);
      if (myOpen4) return myOpen4.p;
      // 4. 相手の達四を止める
      const theirOpen4 = scored.find(s => s.theirs.score >= VAL.open4);
      if (theirOpen4) return theirOpen4.p;
    }
    const deadline = Date.now() + lv.budgetMs;

    // --- 詰み探索 ---
    if (lv.vcfDepth > 0) {
      const win = vcf(board, color, size, preset, lv.vcfDepth, deadline, { nodes: 0, nodeCap: 60000 }, cands);
      if (win && win.length) return win[0];
      // 相手に詰み筋があるなら、その1手目を先に取って崩す
      const lose = vcf(board, opp, size, preset, Math.min(lv.vcfDepth, 11), deadline, { nodes: 0, nodeCap: 40000 }, cands);
      if (lose && lose.length && !isForbiddenFor(board, lose[0].x, lose[0].y, color, preset, size)) return lose[0];
    }

    // --- 仕込んでから詰ます（APOCALYPSE のみ） ---
    // 上位の候補を1手打ってみて、相手が一番いい受けをした後に詰み筋が立つなら、その候補を選ぶ。
    if (lv.prepWidth > 0) {
      for (const s of scored.slice(0, lv.prepWidth)) {
        if (Date.now() > deadline) break;
        board[s.p.y][s.p.x] = color;
        // 相手の受け＝相手にとって一番いい点（ここで五を作れるなら仕込みは失敗）
        let reply = null, replyBest = -1, replyFive = false;
        for (const q of cands) {
          if (board[q.y][q.x]) continue;
          if (isForbiddenFor(board, q.x, q.y, opp, preset, size)) continue;
          const r = moveShape(board, q.x, q.y, opp, size, VAL);
          if (r.five) { replyFive = true; break; }
          if (r.score > replyBest) { replyBest = r.score; reply = q; }
        }
        if (!replyFive && reply) {
          board[reply.y][reply.x] = opp;
          const w = vcf(board, color, size, preset, lv.vcfDepth, deadline, { nodes: 0, nodeCap: 20000 }, cands);
          board[reply.y][reply.x] = null;
          board[s.p.y][s.p.x] = null;
          if (w && w.length) return s.p;
          continue;
        }
        board[s.p.y][s.p.x] = null;
      }
    }

    if (lv.topPick > 1) {
      // EASY: 同じくらい良い手が並んでいたら、その中から気まぐれに選ぶ
      const head = scored.slice(0, lv.topPick).filter(s => s.total >= scored[0].total * 0.85);
      const pick = head.length ? head : scored.slice(0, 1);
      return pick[Math.floor(Math.random() * pick.length)].p;
    }
    return scored[0].p;
  }

  /**
   * 三手交換の判断（正規ルール・白側）。
   * 盤には黒2子・白1子が置かれている。黒側が明らかに得なら黒を取る。
   * ※ 序盤の形の善し悪しは読みが一番効きにくいところなので、ここは大まかな目安で決めている。
   */
  function chooseSwap(board, opts) {
    opts = opts || {};
    const size = opts.size || board.length;
    const preset = opts.preset || 'normal';
    const cands = candidates(board, size, 2);
    let blackBest = 0, whiteBest = 0;
    for (const p of cands) {
      if (!isForbiddenFor(board, p.x, p.y, 'black', preset, size)) {
        const b = moveShape(board, p.x, p.y, 'black', size, VAL);
        if (b.score > blackBest) blackBest = b.score;
      }
      const w = moveShape(board, p.x, p.y, 'white', size, VAL);
      if (w.score > whiteBest) whiteBest = w.score;
    }
    // 黒の一番いい続きが白のそれを大きく上回るなら、黒をもらう
    return blackBest > whiteBest * 1.35 + 200;
  }

  const api = { chooseMove, chooseSwap, _internal: { moveShape, candidates, classify, vcf, LEVELS } };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MomoGomokuAI = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
