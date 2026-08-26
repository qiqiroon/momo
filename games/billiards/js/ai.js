/**
 * MOMO Billiards — AI 対戦
 * 仕様書 momo_billiards_spec.md 第9章9.4節
 *
 * ・AIは人間と同じ5値（方向・パワー・撞点X・撞点Y・仰角）だけを出力する（9.4.3節）。
 *   AI専用の入力経路は作らない。物理はAIか人間かを区別しない。
 * ・強さは難易度が定める（9.4.2節）。ここでは
 *     候補の数・読みの深さ・狙いのぶれ幅
 *   の3つで差を付ける。
 * ・AIが使う乱数は共有PRNG（game.rng）から取る＝思考結果も決定論の対象（9.4.3節）。
 * ・思考は物理エンジンでの実際の試し撞き（先読み）で評価する。
 *   幾何だけで評価すると撞球の癖（スロー効果など）を織り込めないため。
 */
const BilliardsAI = (() => {
  'use strict';

  const E = BilliardsEngine, RU = BilliardsRules;

  // aimNoise は「狙いのぶれ」（ラジアン）。0.0045 rad ≒ 0.26 度。
  // これが的球1個ぶんの幅を外す角度にどれだけ近いかで、入る／外れるが分かれる。
  const PROFILE = {
    easy: { cands: 8, aimNoise: 0.020, powNoise: 0.18, simSec: 6, avoidScratch: 0.4 },
    hard: { cands: 14, aimNoise: 0.0045, powNoise: 0.06, simSec: 6, avoidScratch: 1.0 },
    apocalypse: { cands: 20, aimNoise: 0.0012, powNoise: 0.03, simSec: 7, avoidScratch: 1.4 },
  };

  function prof(d) { return PROFILE[d] || PROFILE.hard; }

  // ───────── 候補の生成 ─────────
  function ghostAim(cue, ball, pocket) {
    // 的球をポケットへ送るための「ゴーストボール」の位置
    const dx = pocket.x - ball.x, dy = pocket.y - ball.y;
    const l = Math.hypot(dx, dy); if (l < 1e-6) return null;
    const gx = ball.x - (dx / l) * (cue.r + ball.r);
    const gy = ball.y - (dy / l) * (cue.r + ball.r);
    const ax = gx - cue.x, ay = gy - cue.y;
    const al = Math.hypot(ax, ay); if (al < 1e-6) return null;
    // 厚み（切る角度）。90度を超える＝裏側なので撞けない
    const cut = Math.acos(Math.max(-1, Math.min(1, (ax * dx + ay * dy) / (al * l))));
    if (cut > 1.25) return null;
    return { dir: Math.atan2(ay, ax), cut, dist: al, objDist: l };
  }

  function pathBlocked(game, x1, y1, x2, y2, ignore, radius) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy); if (len < 1e-6) return false;
    const ux = dx / len, uy = dy / len;
    for (const b of game.world.balls) {
      if (b.state !== 'live') continue;
      if (ignore.indexOf(b) >= 0) continue;
      const ex = b.x - x1, ey = b.y - y1;
      const proj = ex * ux + ey * uy;
      if (proj < 0 || proj > len) continue;
      const perp = Math.abs(ex * uy - ey * ux);
      if (perp < radius + b.r) return true;
    }
    return false;
  }

  function buildCandidates(game, playerIdx, p) {
    const cue = RU.cueBallOf(game, playerIdx);
    const out = [];
    if (!cue) return out;

    if (game.rule === 'G-04') {
      // キャロム：手玉以外の2球へ当てる。
      // 方向を機械的に等分割すると、狙うべき薄い角度を跨いでしまって当たらない。
      // 各球へ真っすぐ向かう方向を軸に、そこから少しずつ振った角度を候補にする。
      // 成立する筋の多くはクッションを1〜2回まわる経路で、狙う球の方角からは読めない。
      // そこで全周をひととおり試し撞きする。刻みを粗くすると薄い筋を跨いで
      // 「当たる方向がひとつも見つからない」ことが起きるので 4 度で刻む。
      const powers = [0.30, 0.55];
      for (let d = 0; d < 360; d += 4) {
        const a = d * Math.PI / 180;
        for (const pw of powers) out.push({ dir: a, power: pw, tipX: 0, tipY: 0, elev: 0 });
      }
      // 近くの球へ直接当てにいく筋も足す（ball-in-hand 直後などで効く）
      const others = game.world.balls.filter(b => b !== cue && b.state === 'live');
      for (const o of others) {
        const base = Math.atan2(o.y - cue.y, o.x - cue.x);
        for (const off of [-0.10, -0.05, 0, 0.05, 0.10]) {
          out.push({ dir: base + off, power: 0.40, tipX: 0, tipY: 0, elev: 0 });
        }
      }
      return out;
    }

    const targets = RU.legalTargets(game, playerIdx) || [];
    const pockets = game.table.pockets;
    // 入る／入らないを決めるのはほとんど狙いの角度で、撞点と強さの差は二の次。
    // 組合せを増やすと読みが重くなるだけなので、ここは絞る。
    const powers = [0.30, 0.48];
    const tips = [{ x: 0, y: 0 }, { x: 0, y: 0.35 }];
    const shots = [];
    for (const tb of targets) {
      for (const pk of pockets) {
        const g = ghostAim(cue, tb, pk);
        if (!g) continue;
        // 手玉→ゴースト、的球→ポケットの経路が塞がっていないか
        if (pathBlocked(game, cue.x, cue.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)) continue;
        if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
        const quality = Math.cos(g.cut) / (1 + g.dist / 2500 + g.objDist / 2500);
        shots.push({ g, tb, pk, quality });
      }
    }
    shots.sort((a, b) => b.quality - a.quality);
    const take = shots.slice(0, Math.max(4, Math.round(p.cands / 2)));
    for (const s of take) {
      for (const pw of powers) {
        for (const tp of tips) {
          out.push({ dir: s.g.dir, power: pw, tipX: tp.x, tipY: tp.y, elev: 0, _target: s.tb.id });
        }
      }
    }
    if (!out.length) {
      // 狙える球が無い＝安全に「とりあえず最小番号へ当てる」
      const tb = targets[0];
      if (tb) {
        const dir = Math.atan2(tb.y - cue.y, tb.x - cue.x);
        out.push({ dir, power: 0.28, tipX: 0, tipY: 0, elev: 0 });
        out.push({ dir, power: 0.45, tipX: 0, tipY: 0, elev: 0 });
      } else {
        out.push({ dir: game.rng() * Math.PI * 2, power: 0.3, tipX: 0, tipY: 0, elev: 0 });
      }
    }
    return out;
  }

  // ───────── 候補の評価（実際に撞いてみる） ─────────
  function evaluate(game, playerIdx, shot, p) {
    const w = E.cloneWorld(game.world);
    const cueSrc = RU.cueBallOf(game, playerIdx);
    const cue = w.balls.find(b => b.id === cueSrc.id);
    if (!cue) return -Infinity;
    E.applyCue(cue, shot);
    if (game.rule === 'G-04') {
      // 2球に当たった時点で成立が決まる。そこで打ち切れば読みが何倍も速くなる。
      // 4秒かけても2球目に届かない筋は狙いとして数えないので、読みもそこで切る。
      const seen = new Set();
      E.runShot(w, 4, ww => {
        for (const ev of ww.events) {
          if (ev.type === 'hit' && (ev.a === cue.id || ev.b === cue.id)) seen.add(ev.a === cue.id ? ev.b : ev.a);
        }
        return seen.size < 2;
      });
    } else {
      E.runShot(w, p.simSec);
    }

    const byId = {}; w.balls.forEach(b => byId[b.id] = b);
    let firstHit = null, contact = false, cushionAfter = false;
    const pocketed = [], off = [];
    for (const ev of w.events) {
      if (ev.type === 'hit' && (ev.a === cue.id || ev.b === cue.id)) {
        if (!firstHit) firstHit = (ev.a === cue.id ? ev.b : ev.a);
        contact = true;
      } else if (ev.type === 'cushion' && contact) cushionAfter = true;
      else if (ev.type === 'pocket') pocketed.push(ev.ball);
      else if (ev.type === 'offtable') off.push(ev.ball);
    }

    let score = 0;
    const legal = RU.legalTargets(game, playerIdx);
    const legalIds = legal ? legal.map(b => b.id) : null;

    if (game.rule === 'G-04') {
      const distinct = new Set();
      for (const ev of w.events) {
        if (ev.type === 'hit' && (ev.a === cue.id || ev.b === cue.id)) distinct.add(ev.a === cue.id ? ev.b : ev.a);
      }
      score += distinct.size >= 2 ? 300 : distinct.size * 30;
      if (off.length) score -= 200 * p.avoidScratch;
      return score;
    }

    if (firstHit == null) score -= 300;
    else if (legalIds && legalIds.indexOf(firstHit) < 0) score -= 260;
    if (contact && !cushionAfter && pocketed.length === 0) score -= 200;
    if (off.length) score -= 180 * p.avoidScratch;

    for (const id of pocketed) {
      const b = byId[id];
      if (!b) continue;
      if (b.kind === 'cue') { score -= 260 * p.avoidScratch; continue; }
      if (game.rule === 'G-01') score += (b.num === 9) ? 600 : 140;
      else if (game.rule === 'G-03') score += 60 + b.num * 12;
      else if (game.rule === 'G-02') {
        const pl = game.players[playerIdx];
        if (b.num === 8) score += (pl.group && RU.liveObjects(game).filter(o => RU.groupOf(o.num) === pl.group).length === 0) ? 600 : -500;
        else if (!pl.group || RU.groupOf(b.num) === pl.group) score += 140;
        else score -= 90;
      }
    }
    // 次の球が撞きやすい位置に残ったか（軽い位置取りの評価）
    const cueAfter = byId[cue.id];
    if (cueAfter && cueAfter.state === 'live') {
      const rest = w.balls.filter(b => b.kind === 'object' && b.state === 'live');
      if (rest.length) {
        let near = Infinity;
        for (const b of rest) near = Math.min(near, Math.hypot(b.x - cueAfter.x, b.y - cueAfter.y));
        score += Math.max(0, 30 - near / 60);
      }
    }
    return score;
  }

  // ───────── フリーボールの置き場所 ─────────
  function pickBallInHand(game, playerIdx) {
    const table = game.table;
    const cue = RU.cueBallOf(game, playerIdx);
    const targets = RU.legalTargets(game, playerIdx) || [];
    const pockets = table.pockets;
    const cands = [];
    const nx = 7, ny = 5;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = -table.halfW + (table.halfW * 2) * (i + 0.5) / nx;
      const y = -table.halfH + (table.halfH * 2) * (j + 0.5) / ny;
      let ok = true;
      for (const b of game.world.balls) {
        if (b === cue || b.state !== 'live') continue;
        if (Math.hypot(b.x - x, b.y - y) < b.r + cue.r + 6) { ok = false; break; }
      }
      for (const p of pockets) if (Math.hypot(p.x - x, p.y - y) < p.r + cue.r) ok = false;
      if (ok) cands.push({ x, y });
    }
    if (!cands.length) return { x: table.headSpot.x, y: 0 };
    let best = cands[0], bestQ = -Infinity;
    for (const c of cands) {
      let q = 0;
      for (const tb of targets) {
        for (const pk of pockets) {
          const fake = { x: c.x, y: c.y, r: cue.r };
          const g = ghostAim(fake, tb, pk);
          if (!g) continue;
          if (pathBlocked(game, c.x, c.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)) continue;
          if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
          q = Math.max(q, Math.cos(g.cut) * 100 - g.dist / 60);
        }
      }
      if (q > bestQ) { bestQ = q; best = c; }
    }
    return best;
  }

  // ───────── 思考（フレームをまたいで少しずつ進める） ─────────
  /**
   * @param {object} game
   * @param {number} playerIdx
   * @param {function} done  done(shot) で結果を返す
   * @returns {function} 中断用の関数
   */
  function think(game, playerIdx, done) {
    const p = prof(game.difficulty);
    const cands = buildCandidates(game, playerIdx, p);
    let i = 0, cancelled = false;
    const scored = [];

    function chunk() {
      if (cancelled) return;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      while (i < cands.length) {
        const s = cands[i++];
        scored.push({ s, sc: evaluate(game, playerIdx, s, p) });
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - t0 > 22) break;   // 1フレームに詰め込みすぎない
      }
      if (i < cands.length) { requestAnimationFrame(chunk); return; }
      finish();
    }

    /**
     * 仕上げ。狙いは、腕のぶれ（難易度ぶんのばらつき）を織り込んで選ぶ。
     * いちばん高い点の狙いをそのまま撞くと、ぶれた瞬間に何にも当たらない
     * 「紙一重の筋」ばかり選ぶことになる。ぶらしても崩れない狙いを採る。
     */
    function finish() {
      scored.sort((a, b) => b.sc - a.sc);
      const top = scored.slice(0, 3);
      let best = top.length ? top[0].s : { dir: 0, power: 0.3, tipX: 0, tipY: 0, elev: 0 };
      let bestMean = -Infinity;
      for (const c of top) {
        let sum = 0, n = 0;
        for (const k of [-1.2, -0.6, 0, 0.6, 1.2]) {
          const v = Object.assign({}, c.s, { dir: c.s.dir + k * p.aimNoise });
          sum += evaluate(game, playerIdx, v, p); n++;
        }
        const mean = sum / n;
        if (mean > bestMean) { bestMean = mean; best = c.s; }
      }
      const shot = Object.assign({}, best);
      // 実際のぶれは共有PRNGから取る（＝AIの手も決定論の対象。9.4.3節）
      shot.dir += (game.rng() - 0.5) * 2 * p.aimNoise;
      shot.power = Math.max(0.08, Math.min(1, shot.power * (1 + (game.rng() - 0.5) * 2 * p.powNoise)));
      delete shot._target;
      done(shot);
    }

    requestAnimationFrame(chunk);
    return function cancel() { cancelled = true; };
  }

  return { think, pickBallInHand, PROFILE };
})();

if (typeof window !== 'undefined') window.BilliardsAI = BilliardsAI;
