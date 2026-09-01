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

  const E = BilliardsEngine, RU = BilliardsRules, T = BilliardsTable;

  /*
   * aimNoise は「狙いのぶれ」（ラジアン）。これは**簡単な配置のときの**ぶれで、
   * 実際のぶれは配置の難しさ（切る角度と距離）に応じて大きくなる（hardnessOf）。
   * 一定のぶれを配置によらず加えると、難しい配置では当たり前に外れるのに、
   * 目の前の1個を落とすだけの場面でも同じだけ外して、わざとらしく見える。
   *
   * scratchBlind は「手玉が落ちる危険を軽く見て撞いてしまう」割合。
   * 手玉を落とす失敗は狙いが逸れる失敗より自然に見えるが、毎回だと目立つので混ぜる程度にする。
   */
  const PROFILE = {
    easy: { cands: 8, aimNoise: 0.0110, powNoise: 0.14, simSec: 6, avoidScratch: 0.4, scratchBlind: 0.16 },
    hard: { cands: 14, aimNoise: 0.0060, powNoise: 0.06, simSec: 6, avoidScratch: 1.0, scratchBlind: 0.06 },
    apocalypse: { cands: 20, aimNoise: 0.0022, powNoise: 0.03, simSec: 7, avoidScratch: 1.4, scratchBlind: 0.015 },
  };

  /**
   * その一撞きの難しさ。1.0＝目の前を真っすぐ、大きいほど難しい。
   * 薄く切るほど狙いを見立てにくく、遠いほど誤差が効く。
   */
  function hardnessOf(shot) {
    if (shot._cut == null) return 1.6;                 // 幾何の分からない撞き方（キャロム・逃げ）
    const cut = Math.min(1.35, Math.max(0, shot._cut));
    return Math.min(4, (1 / Math.cos(cut)) * (1 + (shot._dist || 600) / 2200));
  }

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

  /**
   * 玉の通り道が台の外へ出るか（＝壁を越えるか）。
   *
   * ★凹んだ形の台（L字・十字・星型）では、狙う球との間に壁が立っていることがある。
   *   玉どうしの当たりだけを見ていると、**壁の向こうの球へ真っすぐ狙う筋**を
   *   有望な候補として並べてしまい、限られた候補の枠をそこで使い切る。
   *   実測：十字で候補の 25%・L字で 14% がこれだった（長方形と六角形は 0%）。
   *   **凸の台では起きないので、そちらだけ見ていると気づけない。**
   *
   * ポケットの口は外周の線の上にあるので、口へ向かう筋は終点で外周に触れる。
   * 「外周から 1mm 以上はみ出したか」で見て、口に触れるだけの筋は落とさない。
   */
  function pathCrossesWall(table, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(len / 20));   // 20mm 刻み
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (T.clearance(table, x1 + dx * t, y1 + dy * t) < -1) return true;
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

    /*
     * 狙う球の一覧。
     *
     * ★**「制約なし」を「狙える球なし」と読んではいけない。**
     *   legalTargets が返すのは「最初に当てなければならない球」であって、
     *   その決まりを持たないルール（サバイバル）では null を返す。
     *   そのまま空の一覧にすると、**ポケットへ送る筋の候補が1本も立たず**、
     *   当てずっぽうの逃げ道だけで撞くことになる。
     *   実測：サバイバルで AI は4局中3局、自分の球へ当てにいっていた。
     *   制約が無いということは、**盤に残っている的球すべてが狙える**ということである。
     */
    const targets = RU.legalTargets(game, playerIdx) || RU.liveObjects(game);
    const pockets = game.table.pockets;

    /*
     * ★ブレイクは別扱いにする。
     *
     * ふだんの候補は「的球をポケットへ送る筋」から作るが、ブレイクではラックが固まっていて
     * どの球からポケットへの筋も他の球で塞がっている。そのため候補が1本も立たず、
     * 下の逃げ道（最小番号へ真っすぐ・強さ 0.28／0.45）へ落ちていた。
     * **実測：どの台でも強さが 0.5 を超えず、標準長方形では8局とも1個も落ちなかった。**
     *
     * ブレイクは「ラックの先頭へ強く当てて散らす」一手なので、
     * 先頭の球へ向かう方向を軸に、強い力で少しずつ振った候補を並べる。
     * どれを選ぶかは、いつもどおり実際に撞いてみた結果で決める。
     */
    if (!game.broken && targets.length) {
      const head = targets.reduce((a, b) =>
        Math.hypot(a.x - cue.x, a.y - cue.y) <= Math.hypot(b.x - cue.x, b.y - cue.y) ? a : b);
      const base = Math.atan2(head.y - cue.y, head.x - cue.x);
      for (const off of [-0.030, -0.015, 0, 0.015, 0.030]) {
        for (const pw of [1.00, 0.85]) {
          out.push({
            dir: base + off, power: pw, tipX: 0, tipY: 0, elev: 0,
            _cut: Math.abs(off), _dist: Math.hypot(head.x - cue.x, head.y - cue.y),
          });
        }
      }
      return out;
    }
    // 入る／入らないを決めるのはほとんど狙いの角度で、撞点と強さの差は二の次。
    // 組合せを増やすと読みが重くなるだけなので、ここは絞る。
    const powers = [0.30, 0.48];
    /*
     * 撞点。中心・押し・**引き**の3つ。
     *
     * ★引き（tipY を負に取る）が無かった。そのため真っすぐの一撞きでは
     *   手玉を止めるか前へ送るかしかできず、**的球のあとを追ってポケットへ落ちていた**
     *   （実測：自由に置いて8番を狙う場面で、外した4件のうち2件がこれ）。
     *   引きは、真っすぐ入れたあとに手玉を残すための基本の道具である。
     */
    const tips = [{ x: 0, y: 0 }, { x: 0, y: 0.35 }, { x: 0, y: -0.35 }];
    const shots = [];
    for (const tb of targets) {
      for (const pk of pockets) {
        const g = ghostAim(cue, tb, pk);
        if (!g) continue;
        // 手玉→ゴースト、的球→ポケットの経路が塞がっていないか（他の球）
        if (pathBlocked(game, cue.x, cue.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)) continue;
        if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
        // 同じ経路が壁を越えていないか（凹んだ形の台でだけ起きる）
        if (pathCrossesWall(game.table, cue.x, cue.y, tb.x, tb.y)) continue;
        if (pathCrossesWall(game.table, tb.x, tb.y, pk.x, pk.y)) continue;
        const quality = Math.cos(g.cut) / (1 + g.dist / 2500 + g.objDist / 2500);
        shots.push({ g, tb, pk, quality });
      }
    }
    shots.sort((a, b) => b.quality - a.quality);
    const take = shots.slice(0, Math.max(4, Math.round(p.cands / 2)));
    for (const s of take) {
      for (const pw of powers) {
        for (const tp of tips) {
          out.push({
            dir: s.g.dir, power: pw, tipX: tp.x, tipY: tp.y, elev: 0,
            _target: s.tb.id, _cut: s.g.cut, _dist: s.g.dist,
          });
        }
      }
    }
    if (!out.length) {
      /*
       * 落とせる筋が1本も無い＝的球が他の球の陰か、壁の向こうにある。
       *
       * ★ここで「とりあえず最小番号へ真っすぐ」に落としてはいけない。
       *   凹んだ形の台では、その真っすぐが壁を向いていることがあり、
       *   当てられずに反則になる（実測：この逃げ道のせいで、壁の判定を足した直後に
       *   L字と十字の当て損ないが 0〜4% から 13〜14% へ増えた）。
       *
       * 壁を越えない向きに的球があればそちらへ当てにいき、
       * あわせて**全周を刻んだ候補**も並べる。壁や球を回り込む筋は幾何では読めず、
       * 実際に撞いてみて初めて見つかるためである（キャロムの候補と同じ考え方）。
       */
      const reachable = targets.filter(tb => !pathCrossesWall(game.table, cue.x, cue.y, tb.x, tb.y));
      for (const tb of reachable.slice(0, 2)) {
        const dir = Math.atan2(tb.y - cue.y, tb.x - cue.x);
        for (const pw of [0.28, 0.45]) out.push({ dir, power: pw, tipX: 0, tipY: 0, elev: 0 });
      }
      for (let d = 0; d < 360; d += 6) {
        out.push({ dir: d * Math.PI / 180, power: 0.55, tipX: 0, tipY: 0, elev: 0 });
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
    /*
     * ★サバイバルでは、**落ちなくても「誰の球を突き飛ばしたか」で損得が出る。**
     *   自分の球を走らせれば、その先で落ちる危険を自分で作ることになる。
     *   落ちた球だけを見ていると、どちらへ当てても点が同じになり、
     *   **候補の並び順で決まってしまう**（実測：自分の球へ当てにいく一撞きばかりを選んでいた）。
     */
    if (game.rule === 'G-08' && firstHit != null && game.survival && game.survival.assigned) {
      const hit = byId[firstHit];
      const mineGrp = game.players[playerIdx].group;
      if (hit && hit.grp >= 0) score += (hit.grp === mineGrp) ? -70 : 45;
    }
    if (contact && !cushionAfter && pocketed.length === 0) score -= 200;
    if (off.length) score -= 180 * p.avoidScratch;

    for (const id of pocketed) {
      const b = byId[id];
      if (!b) continue;
      // サバイバルのスクラッチは手番を失うだけでなく**自分の球が1つ減る**（7.8.5節）。
      // 他のルールより重い罰なので、避ける重みもそのぶん増やす
      if (b.kind === 'cue') { score -= (game.rule === 'G-08' ? 420 : 260) * p.avoidScratch; continue; }
      if (game.rule === 'G-01') score += (b.num === 9) ? 600 : 140;
      else if (game.rule === 'G-03') score += 60 + b.num * 12;
      else if (game.rule === 'G-08') score += survivalGain(game, playerIdx, b);
      else if (game.rule === 'G-02') {
        const pl = game.players[playerIdx];
        if (b.num === 8) score += (pl.group && RU.liveObjects(game).filter(o => RU.groupOf(o.num) === pl.group).length === 0) ? 600 : -500;
        else if (!pl.group || RU.groupOf(b.num) === pl.group) score += 140;
        else score -= 90;
      }
    }
    /*
     * サバイバル（7.8節）。**自分の球は体力なので、落とすと損をする。**
     *   ・割り当てが済んでいれば、他人の球は得・自分の球は損・無所属は損得なし
     *   ・割り当てが済む前は、**いま最も少ないグループをさらに削る**のが得。
     *     自分がもらうのは「最も多く残っているグループ」なので、
     *     一方だけを削るほど、無傷のグループを満杯で受け取れる。
     */
    function survivalGain(game, playerIdx, b) {
      const sv = game.survival;
      if (!sv || !(b.grp >= 0)) return 0;              // 無所属は罰も利益も無い
      if (sv.assigned) {
        const mine = game.players[playerIdx].group;
        return (b.grp === mine) ? -260 : 150;
      }
      let thin = -1, thinN = Infinity;
      for (let g = 0; g < sv.groups.length; g++) {
        const n = RU.liveInGroup(game, g);
        if (n < thinN) { thinN = n; thin = g; }
      }
      return (b.grp === thin) ? 150 : 70;
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

  // ───────── バンキング（先手決め）の一撞き ─────────
  /**
   * フット側の壁へ当てて戻し、ヘッド側にいちばん近く止めるのが良い撞き方。
   * どのくらいの強さでそうなるかは台の形と物性で変わるので、**数値で決め打ちせず試し撞きで探す。**
   * 台を1つ足すたびに強さの表を書き足す形にすると、足したときに必ず書き忘れる。
   *
   * 向きも少し振る。台によっては長軸の真っすぐ先がポケットで、
   * 真っすぐ撞くと落ちてしまう（六角形のフット頂点がそれ）。
   */
  function bankShot(game, playerIdx) {
    const p = prof(game.difficulty);
    const table = game.table;
    const cue = RU.cueBallOf(game, playerIdx);
    if (!cue) return { dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0.35 };
    const foot = table.footDirection || 1;
    const baseDir = (table.longAxis === 'y')
      ? (foot > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (foot > 0 ? 0 : Math.PI);
    const line = Math.abs(RU.longPos(table, table.spot.x, table.spot.y));

    /** 試し撞き。成立したかと、止まった位置（ヘッドに近いほど小さい）を返す */
    function tryLag(shot) {
      const w = E.cloneWorld(game.world);
      const b = w.balls.find(x => x.id === cue.id);
      if (!b) return { ok: false };
      E.applyCue(b, shot);
      E.runShot(w, 12);
      let reached = false;
      for (const ev of w.events) {
        if (ev.type === 'cushion' && ev.ball === b.id && ev.x != null
          && RU.longPos(table, ev.x, ev.y) >= line) { reached = true; break; }
      }
      if (!reached || b.state !== 'live') return { ok: false };
      return { ok: true, pos: RU.longPos(table, b.x, b.y) };
    }

    const cands = [];
    for (const dOff of [0, -0.06, 0.06, -0.13, 0.13]) {
      for (let k = 0; k <= 8; k++) {
        const shot = { dir: baseDir + dOff, tipX: 0, tipY: 0, elev: 0, power: 0.18 + k * 0.045 };
        const r = tryLag(shot);
        if (r.ok) cands.push({ shot, pos: r.pos });
      }
    }
    // どの試し撞きも成立しなかった台では、とりあえず中くらいの強さで真っすぐ
    if (!cands.length) return { dir: baseDir, tipX: 0, tipY: 0, elev: 0, power: 0.42 };

    /*
     * **腕前は「良い撞き方に狙いを重ねてからぶれを乗せる」形では表せない。**
     * 往復のバンキングは、わずかな強さの違いが止まる場所を数百 mm 動かす。
     * 良い一撞きにぶれを乗せると、
     *   ・ぶれた結果が不成立（玉が落ちる・戻らない）になることがある
     *   ・不成立を避けて撞き直させると、ぶれの大きい設定ほど「ぶれ無し」に戻る回数が増え、
     *     **難しい設定より簡単な設定のほうが上手にバンキングする**
     * 実測でそうなった（Easy 平均 221mm ／ Hard 平均 611mm ／ Apocalypse 平均 91mm）。
     *
     * そこで、**成立する撞き方を並べて、腕前に応じた上位から1つ選ぶ**形にした。
     * 選ぶ範囲が狭いほど上手。どれを選んでも成立するので、不成立で先手を丸ごと譲ることもない。
     */
    cands.sort((a, b) => a.pos - b.pos);              // ヘッドに近い順
    const TOP = { easy: 0.55, hard: 0.28, apocalypse: 0.08 };
    const frac = TOP[game.difficulty] != null ? TOP[game.difficulty] : TOP.hard;
    const room = Math.max(1, Math.round(cands.length * frac));
    return cands[Math.min(cands.length - 1, Math.floor(game.rng() * room))].shot;
  }

  // ───────── フリーボールの置き場所 ─────────
  function pickBallInHand(game, playerIdx) {
    const table = game.table;
    const cue = RU.cueBallOf(game, playerIdx);
    const targets = RU.legalTargets(game, playerIdx) || [];
    const pockets = table.pockets;
    const cands = [];

    /** そこへ手玉を置けるか（台の内側・他の球と重ならない・ポケットの口でない） */
    function freeAt(x, y) {
      if (!T.inside(table, x, y, cue.r)) return false;
      for (const b of game.world.balls) {
        if (b === cue || b.state !== 'live') continue;
        if (Math.hypot(b.x - x, b.y - y) < b.r + cue.r + 6) return false;
      }
      for (const p of pockets) if (Math.hypot(p.x - x, p.y - y) < p.r + cue.r) return false;
      return true;
    }

    /*
     * ★まず「真っすぐ入る位置」を候補に入れる。
     *
     * 的球とポケットを結ぶ線の延長上へ手玉を置けば、切る角度が 0 になり、
     * その一撞きはいちばんやさしい形になる。自由に置けるのだから、そうしない理由が無い。
     *
     * 以前は下の格子だけで選んでいた。台ぜんたいで 7×5 の 35 点しか見ないので、
     * **やさしい形を作れず、自由に置けるのに 3 回に 1 回ほど外していた**（実測 58〜67%）。
     * 格子の目より、狙いのやさしさのほうが結果に効く。
     */
    for (const tb of targets) {
      for (const pk of pockets) {
        const dx = tb.x - pk.x, dy = tb.y - pk.y, l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        const ux = dx / l, uy = dy / l;                 // ポケット → 的球 の向き
        for (const d of [170, 240, 340, 470, 640, 850]) {
          const x = tb.x + ux * d, y = tb.y + uy * d;   // その先へ手玉を置く＝真っすぐ
          if (freeAt(x, y)) cands.push({ x, y });
        }
      }
    }

    // 格子も残す（真っすぐ置ける場所が1つも取れないときのため）。
    // 候補点は外接矩形に格子を切ってから、台の外に落ちたものを捨てる。
    // 矩形のまま使うと、六角形では角の外へ手玉を置こうとする
    const nx = 7, ny = 5;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = -table.halfW + (table.halfW * 2) * (i + 0.5) / nx;
      const y = -table.halfH + (table.halfH * 2) * (j + 0.5) / ny;
      if (freeAt(x, y)) cands.push({ x, y });
    }
    if (!cands.length) return { x: table.headSpot.x, y: table.headSpot.y };

    let best = cands[0], bestQ = -Infinity;
    for (const c of cands) {
      let q = -1;
      for (const tb of targets) {
        for (const pk of pockets) {
          const fake = { x: c.x, y: c.y, r: cue.r };
          const g = ghostAim(fake, tb, pk);
          if (!g) continue;
          if (pathBlocked(game, c.x, c.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)) continue;
          if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
          // 壁を越える筋は置き場所を選ぶときにも数えない（凹んだ形の台で効く）
          if (pathCrossesWall(table, c.x, c.y, tb.x, tb.y)) continue;
          if (pathCrossesWall(table, tb.x, tb.y, pk.x, pk.y)) continue;
          /*
           * ★的球からポケットまでの距離も数える。
           *
           * 狙いのわずかなぶれは、的球が転がる距離のぶんだけ広がる。
           * 手玉からの距離だけで選んでいたときは、真っすぐで手玉に近い置き場所を選びながら、
           * **2 m 先のポケットを狙って外していた**（実測：切る角度 0.0度・手玉まで 113mm でも、
           * 的球からポケットまで 2130mm あると入らない）。
           * 近いポケットを選ぶほうが、置き場所の良さより効く。
           */
          q = Math.max(q, Math.cos(g.cut) * 100 - g.dist / 60 - g.objDist / 40);
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
    const base = prof(game.difficulty);
    /*
     * たまに「手玉の落ちる危険を軽く見る」一撞きを混ぜる。
     * 手玉が落ちる失敗は、狙いが逸れる失敗より人がやる失敗らしく見えるが、
     * 続くと目立つので、難易度ごとに決めた割合でだけ起こす。
     * わざと落としに行くのではなく、危険の勘定を軽くするだけ＝読み違えとして落ちる。
     */
    const careless = game.rng() < (base.scratchBlind || 0);
    const p = careless ? Object.assign({}, base, { avoidScratch: 0.15 }) : base;
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

    /*
     * 狙いの微調整。
     * ゴーストボールの幾何が出す狙いは、**入る範囲の真ん中ではなく端に寄っている**
     * （実測：まっすぐ手前の1個でも 0.010 ラジアンぶん外側にずれていた）。
     * 当たったあと的球がどちらへ向かうかは撞球の癖（スロー効果）で変わるからで、
     * 幾何だけでは織り込めない。そこで狙いを少しずつ振って試し撞きし、
     * **いちばん確実に入る狙い**を探す。隣も見て平らなところを選ぶので、
     * 紙一重の1点（腕がぶれた瞬間に崩れる筋）は選ばれない。
     */
    const OFFS = [-0.028, -0.021, -0.014, -0.007, 0, 0.007, 0.014, 0.021, 0.028];
    function tune(cand, pp) {
      const sc = OFFS.map(o => evaluate(game, playerIdx, Object.assign({}, cand, { dir: cand.dir + o }), pp));
      const top = Math.max.apply(null, sc);
      /*
       * 同じだけ良い狙いが並んだら、**その並びの真ん中**を採る。
       * いちばん良い点を先に見つけた順で採ると、試した幅の端が選ばれて、
       * 腕がぶれた瞬間に外れる側へ寄る。入る範囲は飛び飛びに見えることがある
       * （ポケットの口で弾かれる角度が混じる）ので、連続している並びだけを数える。
       */
      let bi = 0, bLen = -1, k = 0;
      while (k < OFFS.length) {
        if (sc[k] < top - 1) { k++; continue; }
        let j = k;
        while (j + 1 < OFFS.length && sc[j + 1] >= top - 1) j++;
        if (j - k > bLen) { bLen = j - k; bi = Math.round((k + j) / 2); }
        k = j + 1;
      }
      return { shot: Object.assign({}, cand, { dir: cand.dir + OFFS[bi] }), score: top };
    }

    /** 仕上げ。狙いを決めてから、最後に腕のぶれを乗せる */
    function finish() {
      scored.sort((a, b) => b.sc - a.sc);
      const top = scored.slice(0, 3);
      let best = null;
      for (const c of top) {
        const r = tune(c.s, p);
        if (!best || r.score > best.score) best = r;
      }
      const shot = Object.assign({}, best ? best.shot : { dir: 0, power: 0.3, tipX: 0, tipY: 0, elev: 0 });
      /*
       * 腕のぶれ。**配置の難しさに比例させる**ので、
       * 目の前の1個を落とすだけの場面ではほとんど外さず、
       * 薄い・遠い配置ではそれなりに外す。
       * 乱数は共有PRNGから取る（＝AIの手も決定論の対象。9.4.3節）。
       * 一様乱数を3つ足すと山なりのばらつきになり、大外しは滅多に起きない。
       */
      const sd = p.aimNoise * hardnessOf(shot);
      shot.dir += sd * (game.rng() + game.rng() + game.rng() - 1.5) * 2;
      shot.power = Math.max(0.08, Math.min(1, shot.power * (1 + (game.rng() - 0.5) * 2 * p.powNoise)));
      delete shot._target; delete shot._cut; delete shot._dist;
      done(shot);
    }

    requestAnimationFrame(chunk);
    return function cancel() { cancelled = true; };
  }

  return { think, pickBallInHand, bankShot, PROFILE };
})();

if (typeof window !== 'undefined') window.BilliardsAI = BilliardsAI;
