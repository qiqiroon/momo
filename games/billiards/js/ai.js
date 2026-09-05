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
   *
   * ★**ぶれの値は 2026-09-01 に3段階まとめて下げた。**
   *   実機から「AIが下手すぎる／相手の球を落とそうとしているように見えない」と指摘され、
   *   内訳を測って分かったことは**狙いは合っているということ**だった。
   *   「狙いを定めた一撞きが、その球を落とせた割合」を測ると：
   *
   *     ぶれ無し 82〜90%／0.0020 で 66%／0.0035 で 51%／0.0055 で 38%／
   *     0.0080 で 33%／**0.0110（当時の easy）で 28%**
   *
   *   ＝**狙って撞いた球の7割を、仕組みが意図的に外させていた。**
   *   逃げ道（当てずっぽう）に落ちていたのではない（実測：サバイバルで 0〜8%）。
   *   狙いも筋の選び方も正しく、最後に乗せるぶれだけが大きすぎた。
   *
   * ★**下げるときは3段階まとめて動かす。**easy だけ下げると hard より上手くなり、
   *   難易度が逆転する。順序（easy ＞ hard ＞ apocalypse）は値そのものが担っている。
   */
  const PROFILE = {
    easy: { cands: 8, aimNoise: 0.0035, powNoise: 0.07, simSec: 6, avoidScratch: 0.4, scratchBlind: 0.16 },
    hard: { cands: 14, aimNoise: 0.0020, powNoise: 0.04, simSec: 6, avoidScratch: 1.0, scratchBlind: 0.06 },
    apocalypse: { cands: 20, aimNoise: 0.0008, powNoise: 0.02, simSec: 7, avoidScratch: 1.4, scratchBlind: 0.015 },
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
    // gx, gy＝**手玉が実際に向かう先**。的球の中心とは厚みのぶんずれる
    return { dir: Math.atan2(ay, ax), cut, dist: al, objDist: l, gx, gy };
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
  function nearPocket(table, x, y, m) {
    for (const p of table.pockets) if (Math.hypot(p.x - x, p.y - y) < p.r + m) return true;
    return false;
  }

  /*
   * ★★**玉の太さを見ること。** 中心の線だけで見ると、凹んだ角の内側を半径ぶんも
   *   空けずにかすめる筋を「通れる」と数える。**玉は角に当たって止まる。**
   *   実測（台の中に無作為に取った筋）＝通れると数えたもののうち実際には玉が壁に触るものが
   *   **ドーナツ 6.8%・十字 5.0%・星型 3.4%・L字 2.5%**。
   *   **凸の台（楕円・六角形・スタジアム）は 0%** ── 凸の形では線の途中が端より壁へ
   *   近づくことがないので、**そちらだけ見ていると気づけない。**
   *
   * margin に玉の半径を渡すと「玉が丸ごと通れるか」で見る。渡さなければ中心だけ。
   * ポケットの口のまわりは外す。口へ向かう筋はそこで必ず外周に触れるためである。
   */
  function pathCrossesWall(table, x1, y1, x2, y2, margin) {
    const m = margin || 0;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(len / 20));   // 20mm 刻み
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t, py = y1 + dy * t;
      const cl = T.clearance(table, px, py);
      if (cl < -1) return true;
      if (m > 0 && cl < m && !nearPocket(table, px, py, m)) return true;
    }
    return false;
  }

  /**
   * **ポケットへ送る筋を作る相手。**
   *
   * ★**「最初に当てるべき玉」が返ってこないことを「狙える球が無い」と読んではいけない。**
   *   legalTargets が返すのは順番の決まりであって、その決まりを持たないルール
   *   （サバイバル）では null を返す。空の一覧として扱うと、
   *   **ポケットへ送る筋が1本も作られない。**
   *
   * ★**サバイバルでは、さらに自分の球と無所属の球を外す。**
   *   自分の球を落とせば自分の体力が減り、無所属の球は落としても何も起きない。
   *   どちらも「撞いてはいけない／撞いても意味がない」筋である。
   *   外さないと絞り込みが効かない：筋は「入りやすさ」だけで並べ替えて上位だけを読むが、
   *   その並べ替えは誰の球かを見ていない。実測（2人・4手進めた局面）＝送れる筋 34本
   *   （自分14／他人16／無所属4）に対し、読む上位7本は自分4／他人3／無所属0だった。
   *
   * ★★**この判断は2か所で要る（筋を作るとき・手玉を置く場所を選ぶとき）。**
   *   最初は筋を作る側だけを直し、置く場所を選ぶ側に同じ誤りが残っていた。
   *   そのためサバイバルでは**「真っすぐ入る位置」の候補が1つも作られず**、
   *   自由に置けるのに格子から実質でたらめに選んでいた（実測：12場面で成功 42%）。
   *   **同じ決めごとを2か所に書かない**ため、ここに1本だけ置いて両方から呼ぶ。
   *
   * 他人の球へ送る筋が1本も無いときは元の一覧に戻す。空にすると、
   * 「筋が1本も無いとき」の逃げ道が自分の球へ当てにいく形になるためである。
   */
  function potTargetsFor(game, playerIdx) {
    const targets = RU.legalTargets(game, playerIdx) || RU.liveObjects(game);
    if (game.rule === 'G-08' && game.survival && game.survival.assigned) {
      const mine = game.players[playerIdx].group;
      const foes = targets.filter(b => b.grp >= 0 && b.grp !== mine);
      if (foes.length) return foes;
    }
    return targets;
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

    if (game.rule === 'G-06') {
      /*
       * 陣取り（7.7節）。**ポケットへ送るのが目的ではない。**
       * 塗るのは動いた玉の色なので、狙うのは「自分の色の玉を長く走らせる」一撞きである。
       * 落とすのはむしろ損で、自分の玉が減れば以後の塗り手段を失う。
       *
       * そこで候補は**自分の色の玉へ向かう筋**から作る。強さは大きめに振る
       * （走行距離がそのまま塗る量になるため）。
       * 自分の玉が1つも残っていない席は、他人の玉を動かすしかないので全部を相手にする。
       */
      const mine = RU.territoryBallsOf(game, playerIdx);
      const pool = mine.length ? mine : RU.liveObjects(game);
      for (const o of pool) {
        const base = Math.atan2(o.y - cue.y, o.x - cue.x);
        for (const off of [-0.06, -0.03, 0, 0.03, 0.06]) {
          for (const pw of [0.55, 0.78, 1.00]) {
            out.push({ dir: base + off, power: pw, tipX: 0, tipY: 0, elev: 0, _target: o.id });
          }
        }
      }
      /*
       * 全周も粗く混ぜる。自分の玉が他の玉の陰にあるとき、
       * クッションを回って当てる筋は幾何では読めない（キャロムと同じ理由）。
       */
      for (let d = 0; d < 360; d += 12) {
        out.push({ dir: d * Math.PI / 180, power: 0.85, tipX: 0, tipY: 0, elev: 0 });
      }
      return out;
    }

    // ブレイクでラックの先頭を探すのに使う。撞く相手を絞る前の一覧
    const targets = RU.legalTargets(game, playerIdx) || RU.liveObjects(game);
    const pockets = game.table.pockets;

    const potTargets = potTargetsFor(game, playerIdx);

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
    for (const tb of potTargets) {
      for (const pk of pockets) {
        const g = ghostAim(cue, tb, pk);
        if (!g) continue;
        /*
         * 手玉→ゴースト、的球→ポケットの経路が塞がっていないか（他の球）。
         * ★★**手玉が向かうのは的球の中心ではなくゴーストの位置。**中心へ向かう線で
         *   調べていたため、厚みを切る一撞きでは実際に撞く線と数度ずれ、玉が固まった場面で
         *   隣の球に当たっていた（実測：狙い 57.0度・的球の向き 61.8度で、1番の手前の2番）。
         *   **真っすぐの場面だけ見ていると気づけない。**
         */
        if (pathBlocked(game, cue.x, cue.y, g.gx, g.gy, [cue, tb], cue.r * 0.9)) continue;
        if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
        // 同じ経路を玉が丸ごと通れるか（凹んだ形の台でだけ起きる）
        if (pathCrossesWall(game.table, cue.x, cue.y, g.gx, g.gy, cue.r * 0.95)) continue;
        if (pathCrossesWall(game.table, tb.x, tb.y, pk.x, pk.y, tb.r * 0.95)) continue;
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
    const potShots = out.length;
    {
      /*
       * ★★**「入れる筋」だけでなく「当てるだけの筋」を必ず混ぜる。**
       *   以前は「入れる筋が1本も無いとき」の逃げ道にしていた。ところが
       *   **玉が固まっている場面では、幾何の上では入る筋が何本も立つ**ので逃げ道が使われず、
       *   **どれを選んでも隣の球に当たる筋ばかりから選ぶ**ことになる
       *   （実測：ブレイクを失敗した直後の星型で、狙い 41.8度／的球の向き 62.5度）。
       *   数本しか増えないので常に並べ、試し撞きに選ばせる。
       *
       * ★「とりあえず最小番号へ真っすぐ」ではいけない。
       *   凹んだ形の台では、その真っすぐが壁を向いていることがあり、
       *   当てられずに反則になる（実測：この逃げ道のせいで、壁の判定を足した直後に
       *   L字と十字の当て損ないが 0〜4% から 13〜14% へ増えた）。
       *
       * 壁を越えない向きに的球があればそちらへ当てにいき、
       * あわせて**全周を刻んだ候補**も並べる。壁や球を回り込む筋は幾何では読めず、
       * 実際に撞いてみて初めて見つかるためである（キャロムの候補と同じ考え方）。
       */
      /*
       * ★★**壁だけでは足りない。他の球の陰も見ること。**
       *   壁しか見ていなかったため、**他の球の背後にある的球へ真っすぐ撞いていた**
       *   （実機の指摘：手玉を置いた先から1番へ真っすぐ撞いて、間の球に当たった）。
       *   塞がれていない的球が1つも無いときは壁だけで絞った一覧に戻す。空にすると
       *   全周の候補だけになり、**近くの的球へ当てる筋を落とす。**
       */
      const clearOfWall = potTargets.filter(tb =>
        !pathCrossesWall(game.table, cue.x, cue.y, tb.x, tb.y, cue.r * 0.95));
      const clearOfAll = clearOfWall.filter(tb =>
        !pathBlocked(game, cue.x, cue.y, tb.x, tb.y, [cue, tb], cue.r * 0.9));
      const reachable = clearOfAll.length ? clearOfAll : clearOfWall;
      for (const tb of reachable.slice(0, 2)) {
        const dir = Math.atan2(tb.y - cue.y, tb.x - cue.x);
        for (const pw of [0.28, 0.45]) out.push({ dir, power: pw, tipX: 0, tipY: 0, elev: 0 });
      }
      // 全周の刻みは重いので、入れる筋も当てる筋も無いときだけ
      if (!potShots && !reachable.length) {
        for (let d = 0; d < 360; d += 6) {
          out.push({ dir: d * Math.PI / 180, power: 0.55, tipX: 0, tipY: 0, elev: 0 });
        }
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
    let probe = null;
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
    } else if (game.rule === 'G-06') {
      /*
       * 陣取りは「どのマスが塗られたか」で良し悪しが決まるので、走らせながら数える。
       * ★塗りの決めごとは rules 側の1本の関数にあり、読みもそこを通る。
       *   ここに写しを書くと、AIが見ている盤面と実際に塗られる盤面が食い違う。
       */
      probe = RU.makeTerritoryProbe(game);
      E.runShot(w, p.simSec, ww => { probe.step(ww); });
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

    if (game.rule === 'G-06') {
      /*
       * 陣取り（7.7節）。**得られるのは塗ったマスの増減だけ**である。
       * 自分の増えたぶんを足し、他人の増えたぶんを引く
       * （自分の玉で他人の玉を突き飛ばすと、その玉は他人の色で塗る）。
       */
      const before = RU.territoryCount(game), after = probe.counts();
      for (let i = 0; i < after.length; i++) {
        const d = after[i] - before[i];
        score += (i === playerIdx) ? d * 10 : -d * 6;
      }
      /*
       * ★**ファウルはこの一撞きの塗りを丸ごと無効にする**（7.2.6節）。
       *   塗った量がどれだけ多くても、ファウルなら得るものはゼロで、
       *   おまけに次の人へ台全体の自由配置を渡す。塗りの点より重く見る。
       */
      const cueGone = pocketed.indexOf(cue.id) >= 0 || off.indexOf(cue.id) >= 0;
      if (firstHit == null) score -= 2000;                     // V-01 空振り
      if (cueGone) score -= 2000;                              // V-04 スクラッチ
      if (off.some(id => id !== cue.id)) score -= 2000;        // V-05 場外
      // 落ちた的球は戻らない（7.7.5節）。自分の玉が減れば以後の塗り手段を失う
      for (const id of pocketed) {
        const b = byId[id];
        if (!b || b.kind !== 'object') continue;
        score += (b.owner === playerIdx) ? -260 : 90;
      }
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

    /*
     * ★★**ファウルになる一撞きから利益を数えてはいけない**（7.2.6節「ファウル時の利益無効」）。
     *   落とした玉の点を反則かどうかに関わらず足していたため、
     *   **「順番の玉に当たらないが玉は落ちる筋」が最良の手として選ばれていた。**
     *   実測（ブレイクを失敗した直後の星型・ローテーション）＝1番の手前の3番に当たる筋が
     *   438点、1番へ真っすぐ当てる筋が 100点。規定どおりなら前者は 0点である。
     *   **ルールの側は正しく無効にしていて、読みの側だけがはぐれていた。**
     *   ★利益だけを消し、罰は残す（8番を反則と同時に落とせば負ける＝7.4.3節）。
     */
    const foulish = (firstHit == null) || (legalIds && legalIds.indexOf(firstHit) < 0)
      || pocketed.indexOf(cue.id) >= 0 || off.length > 0;
    let gain = 0;
    for (const id of pocketed) {
      const b = byId[id];
      if (!b) continue;
      // サバイバルのスクラッチは手番を失うだけでなく**自分の球が1つ減る**（7.8.5節）。
      // 他のルールより重い罰なので、避ける重みもそのぶん増やす
      if (b.kind === 'cue') { score -= (game.rule === 'G-08' ? 420 : 260) * p.avoidScratch; continue; }
      let v = 0;
      if (game.rule === 'G-01') v = (b.num === 9) ? 600 : 140;
      else if (game.rule === 'G-03') v = 60 + b.num * 12;
      else if (game.rule === 'G-08') v = survivalGain(game, playerIdx, b);
      else if (game.rule === 'G-02') {
        const pl = game.players[playerIdx];
        if (b.num === 8) v = (pl.group && RU.liveObjects(game).filter(o => RU.groupOf(o.num) === pl.group).length === 0) ? 600 : -500;
        else if (!pl.group || RU.groupOf(b.num) === pl.group) v = 140;
        else v = -90;
      }
      gain += (foulish && v > 0) ? 0 : v;
    }
    score += gain;
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

    const STEP = 0.045;                 // 強さの刻み
    const rows = [];
    for (const dOff of [0, -0.06, 0.06, -0.13, 0.13]) {
      const row = [];
      for (let k = 0; k <= 8; k++) {
        const shot = { dir: baseDir + dOff, tipX: 0, tipY: 0, elev: 0, power: 0.18 + k * STEP };
        const r = tryLag(shot);
        row.push(r.ok ? { shot, pos: r.pos } : null);
      }
      rows.push(row);
    }
    /*
     * ★**撞いたあとに強さが ±3% ずらされる**（app.js の bankWobble）。
     * AI はそのずれを知らないまま撞くので、**ぎりぎりで成立している撞き方を選ぶと、
     * ずらされた側で不成立になり、先手を丸ごと落とす。**
     *
     * そこで**両隣の刻みでも成立しているものだけを候補にする**。
     * 刻みは 0.045 で、ずれ幅 0.03 より広い。両隣が成立していれば、ずれた先も成立している。
     * **試し撞きを増やさずに余裕を測れる**
     * （ずれ幅の端を別に撞いて調べると、試し撞きが 45回から 135回に増える）。
     */
    let cands = [];
    for (const row of rows) {
      for (let k = 1; k <= 7; k++) if (row[k] && row[k - 1] && row[k + 1]) cands.push(row[k]);
    }
    // 余裕のあるものが1つも無い台では、成立しただけのものを拾う（先手を落とすよりまし）
    if (!cands.length) for (const row of rows) for (const c of row) if (c) cands.push(c);
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
    const pick = Math.min(cands.length - 1, Math.floor(game.rng() * room));

    /*
     * ★**選んだ一撞きだけ、ずれ幅の中を刻んで実際に撞いて確かめる。**
     *
     * 上の「両隣の刻みでも成立していること」は安い前さばきであって、真偽の判定ではない。
     * **成立する強さは連続した帯ではない** ── 六角形はフット頂点がポケットなので、
     * 途中の強さだけ玉が落ちる。
     *
     * **両端だけを撞いても足りない。**実測（六角形・強さ 0.225 を選んだ場面）では
     * 成立する帯が `##.....########`（0.190〜0.195 と 0.225〜0.260 が成立、
     * 間の 0.200〜0.220 が落ちる）で、**両端 0.195 と 0.255 はどちらも成立していた。**
     * 選んだ 0.225 は上の帯の左端に載っていて、少しでも弱くずれると穴へ落ちる。
     * 2点は区間の真偽を決められない（前さばきと判定は別物）。
     *
     * 撞くのは**選んだ1つだけ**なので、試し撞きは6回しか増えない。
     * 候補を全部確かめると 45回が 300回を超える。
     * 落ちたら次の候補へ送る。**順に下りるだけで、上位から選び直さない**
     * ── 選び直すと、ぶれの大きい設定ほど良い撞き方へ戻る回数が増えて、
     * 簡単な設定のほうが上手にバンキングすることになる（この節の冒頭の失敗）。
     */
    const EDGE = RU.BANK_WOBBLE, DIV = 3;      // ±EDGE を EDGE/3 刻みで見る＝中心を除いて6点
    function safeAcrossWobble(c) {
      for (let i = -DIV; i <= DIV; i++) {
        if (i === 0) continue;                 // 中心は候補を作るときに撞いてある
        if (!tryLag(Object.assign({}, c.shot, { power: c.shot.power + EDGE * i / DIV })).ok) return false;
      }
      return true;
    }
    for (let k = 0; k < cands.length; k++) {
      const c = cands[(pick + k) % cands.length];
      if (safeAcrossWobble(c)) return c.shot;
    }
    return cands[pick].shot;      // どこもずれに耐えない台では、選んだものをそのまま撞く
  }

  // ───────── フリーボールの置き場所 ─────────

  /** そこへ手玉を置けるか（台の内側・他の球と重ならない・ポケットの口でない） */
  function freeSpotAt(game, cue, x, y) {
    const table = game.table;
    if (!T.inside(table, x, y, cue.r)) return false;
    for (const b of game.world.balls) {
      if (b === cue || b.state !== 'live') continue;
      if (Math.hypot(b.x - x, b.y - y) < b.r + cue.r + 6) return false;
    }
    for (const p of table.pockets) if (Math.hypot(p.x - x, p.y - y) < p.r + cue.r) return false;
    return true;
  }

  /** 外接矩形に切った格子。どのルールでも「置ける場所が1つも取れない」ときの受け皿 */
  function gridSpots(game, cue) {
    const table = game.table, out = [];
    const nx = 7, ny = 5;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = -table.halfW + (table.halfW * 2) * (i + 0.5) / nx;
      const y = -table.halfH + (table.halfH * 2) * (j + 0.5) / ny;
      if (freeSpotAt(game, cue, x, y)) out.push({ x, y });
    }
    return out;
  }

  /**
   * 陣取りのフリーボール（7.7節）。
   *
   * ★**ポケットへ入れるのが目的ではないので、「真っすぐ入る位置」は要らない。**
   *   欲しいのは「自分の色の玉を長く走らせられる位置」＝
   *   手玉・自分の玉・台の広いほう が一直線に並ぶ場所である。
   *   ポケット狙いの置き場所をそのまま使うと、**落として自分の玉を減らす**位置を選ぶ。
   */
  function pickBallInHandTerritory(game, playerIdx) {
    const table = game.table;
    const cue = RU.cueBallOf(game, playerIdx);
    const mine = RU.territoryBallsOf(game, playerIdx);
    const pool = mine.length ? mine : RU.liveObjects(game);
    const c = (game.territory && game.territory.layout.center) || { x: 0, y: 0 };
    const cands = [];
    for (const tb of pool) {
      let ux = tb.x - c.x, uy = tb.y - c.y;
      const l = Math.hypot(ux, uy);
      if (l < 1) { ux = 1; uy = 0; } else { ux /= l; uy /= l; }
      // 玉の外側へ置く＝玉は台の真ん中を突っ切って走る＝いちばん長い距離を稼げる
      for (const d of [170, 260, 380, 520]) {
        const x = tb.x + ux * d, y = tb.y + uy * d;
        if (freeSpotAt(game, cue, x, y)) cands.push({ x, y, tb });
      }
    }
    for (const s of gridSpots(game, cue)) cands.push({ x: s.x, y: s.y, tb: null });
    if (!cands.length) return { x: table.headSpot.x, y: table.headSpot.y };

    let best = cands[0], bestQ = -Infinity;
    for (const s of cands) {
      let q = -Infinity;
      for (const tb of pool) {
        if (pathBlocked(game, s.x, s.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)) continue;
        // 陣取りも同じ見方にそろえる。玉がかすめて止まる筋を「通れる」と数えない
        if (pathCrossesWall(table, s.x, s.y, tb.x, tb.y, cue.r * 0.95)) continue;
        const dx = tb.x - s.x, dy = tb.y - s.y, d = Math.hypot(dx, dy);
        if (d < 1) continue;
        // その向きへ玉を押したとき、壁に当たるまでに走れる距離。塗る量はここで決まる
        let far = 0;
        for (let k = 60; k <= 3000; k += 60) {
          const px = tb.x + dx / d * k, py = tb.y + dy / d * k;
          if (T.clearance(table, px, py) < tb.r) break;
          far = k;
        }
        q = Math.max(q, far / 12 - d / 60);
      }
      if (q > bestQ) { bestQ = q; best = s; }
    }
    return { x: best.x, y: best.y };
  }

  function pickBallInHand(game, playerIdx) {
    if (game.rule === 'G-06') return pickBallInHandTerritory(game, playerIdx);
    /*
     * ★ボウリング型は**既定の投球位置から投げる**。
     *   手前側のどこからでも投げてよいが、真っすぐ狙える点はそこ1つなので、
     *   探し回っても得るものが無い（実測：16バリエーションすべてでそこから10本見通せる）。
     */
    if (game.rule === 'G-11' && game.bowling) {
      return { x: game.bowling.layout.throwPos.x, y: game.bowling.layout.throwPos.y };
    }
    const table = game.table;
    const cue = RU.cueBallOf(game, playerIdx);
    // ★筋を作る側と同じ判断を使う。ここに別の書き方を置くと、片方だけがはぐれる
    const targets = potTargetsFor(game, playerIdx);
    const pockets = table.pockets;
    const cands = [];

    const freeAt = (x, y) => freeSpotAt(game, cue, x, y);

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
    for (const s of gridSpots(game, cue)) cands.push(s);
    if (!cands.length) return { x: table.headSpot.x, y: table.headSpot.y };

    const scored = cands.map(c => ({ c, r: spotScore(game, cue, c, targets, pockets) }));
    scored.sort((a, b) => b.r.q - a.r.q);

    /*
     * ★★**置き場所は撞いて確かめる。幾何の見立てだけでは決められない。**
     *
     *   玉が寄り集まっている場面では、見立てを厳しくすると入る筋まで捨て
     *   （実測：サバイバルの自由配置で落とせた割合が 110% → 0%）、緩くすると
     *   **手玉が届かない場所を「ここから入れられる」と判断する**
     *   （実測：ブレイクを失敗した直後のドーナツで、1番の隣の2番に当たった）。
     *   どちらへ寄せても外れるので、**撞いて確かめる。**
     *
     *   二段構えにする。
     *     1段目＝**最初に当てるべき玉へ当たるか。**触れた時点で読みを打ち切るので 1つ 2ミリ秒。
     *            見立てが外れているとき**上位はそろって同じ外れ方をしている**ので、
     *            通る場所が見つかるまで下まで下りる（実測：ドーナツは上位8つが全滅）。
     *     2段目＝残った上位だけ、**損得まで読む。**ここを省くと
     *            **手玉が落ちる危険を誰も見ていない**ことになる
     *            （実測：自由に置いた60場面で手玉を 11 回落とした。省かなければ 0 回）。
     *            読む秒数は縮めてよい。手玉が落ちるかどうかは撞いてすぐ決まる。
     *
     *   最初に当てるべき玉が決まっていないルール（サバイバル・担当が決まる前のエイトボール）
     *   では、どの玉に当たっても反則にならないので1段目は素通りする。
     */
    const pf = prof(game.difficulty);
    const legal = RU.legalTargets(game, playerIdx);
    const ids = (legal && legal.length) ? legal.map(b => b.id) : null;
    const keep = { x: cue.x, y: cue.y, state: cue.state, onTable: cue.onTable };
    const restore = () => {
      cue.x = keep.x; cue.y = keep.y; cue.state = keep.state; cue.onTable = keep.onTable;
      cue.vx = cue.vy = cue.vz = cue.wx = cue.wy = cue.wz = 0;
    };
    const fallback = scored.length ? scored[0].c : cands[0];

    const pass = [];
    for (const s of scored.slice(0, 60)) {
      if (!s.r.shot) continue;
      if (ids) {
        RU.place(cue, s.c.x, s.c.y);
        if (ids.indexOf(firstContact(game, cue, s.r.shot)) < 0) continue;
      }
      pass.push(s);
      if (pass.length >= 5) break;
    }
    if (!pass.length) { restore(); return fallback; }

    const pq = Object.assign({}, pf, { simSec: 2 });
    let pick = null;
    for (const s of pass) {
      RU.place(cue, s.c.x, s.c.y);
      const sc = evaluate(game, playerIdx, s.r.shot, pq);
      if (!pick || sc > pick.sc) pick = { c: s.c, sc };
    }
    restore();
    return pick ? { x: pick.c.x, y: pick.c.y } : fallback;
  }

  /**
   * 手玉の置き場所の点数。**3つの段に分ける。**
   *
   *   上の段：そこから的球をポケットへ入れられる
   *   中の段：入れられないが、**的球に当てられる**
   *   下の段：当てることもできない
   *
   * ★★**「当てられるか」に点が無かった。**
   *   点を付けていたのは「入れられるか」だけで、入れられる筋が1本も無い場面では
   *   **どの置き場所も同じ点になり、候補を作った順の1番目が選ばれていた。**
   *   実測（L字台・ブレイクを失敗した直後のフリーボール）＝候補 45 個が全部同点になり、
   *   選ばれた1番目が**他の球の陰**だった。置ける場所の 71%（1137 中 804）は
   *   的球に当てられる場所だったのに、当てられない場所を選んでいた。
   *
   *   ラックが固まっている間はどこからも入れられないので、この場面は
   *   **ブレイクを失敗した直後に必ず起きる。**対局中盤では入れられる筋があるため出ない
   *   （実測：中盤のフリーボール 19 回では 0 件）。**中盤だけ見ていると気づけない。**
   *
   * ローテーションやナインボールでは的球に当てられなければその場で反則なので、
   * 「当てられるか」は「入れられるか」より先に効く条件である。段を分けるのは、
   * **入れられる場所が1つでもあれば必ずそちらを選ぶ**ため。同じ段の中では続きの数字で
   * 比べるので、同点で並んで順番任せになることが無い。
   *
   * shot＝その置き場所でいちばん良い一撞き。**撞いて確かめる**ときに使う。
   */
  function spotScore(game, cue, c, targets, pockets) {
    const table = game.table;
    let pot = -Infinity, hit = -Infinity, near = Infinity, shot = null, hitShot = null;
    for (const tb of targets) {
      const d = Math.hypot(tb.x - c.x, tb.y - c.y);
      if (d < near) near = d;
      // 当てられるか＝的球の中心へ向かう線。遠いほど狙いのぶれが効くので近いほうを良しとする
      if (!pathBlocked(game, c.x, c.y, tb.x, tb.y, [cue, tb], cue.r * 0.9)
        && !pathCrossesWall(table, c.x, c.y, tb.x, tb.y, cue.r * 0.95)
        && 300 - d / 10 > hit) {
        hit = 300 - d / 10;
        hitShot = { dir: Math.atan2(tb.y - c.y, tb.x - c.x), power: 0.45, tipX: 0, tipY: 0, elev: 0 };
      }
      for (const pk of pockets) {
        const g = ghostAim({ x: c.x, y: c.y, r: cue.r }, tb, pk);
        if (!g) continue;
        // 入れられるかは**ゴーストへ向かう線**で見る（撞くときの線と同じもの）
        if (pathBlocked(game, c.x, c.y, g.gx, g.gy, [cue, tb], cue.r * 0.9)) continue;
        if (pathBlocked(game, tb.x, tb.y, pk.x, pk.y, [tb, cue], tb.r * 0.85)) continue;
        if (pathCrossesWall(table, c.x, c.y, g.gx, g.gy, cue.r * 0.95)) continue;
        if (pathCrossesWall(table, tb.x, tb.y, pk.x, pk.y, tb.r * 0.95)) continue;
        /*
         * ★的球からポケットまでの距離も数える。
         *
         * 狙いのわずかなぶれは、的球が転がる距離のぶんだけ広がる。
         * 手玉からの距離だけで選んでいたときは、真っすぐで手玉に近い置き場所を選びながら、
         * **2 m 先のポケットを狙って外していた**（実測：切る角度 0.0度・手玉まで 113mm でも、
         * 的球からポケットまで 2130mm あると入らない）。
         * 近いポケットを選ぶほうが、置き場所の良さより効く。
         */
        const v = Math.cos(g.cut) * 100 - g.dist / 60 - g.objDist / 40;
        if (v > pot) {
          pot = v;
          shot = { dir: g.dir, power: 0.48, tipX: 0, tipY: 0, elev: 0, _cut: g.cut, _dist: g.dist };
        }
      }
    }
    // 段の境目：入れられる筋の点は最悪でも -100 を下回らないので、段どうしが混ざることはない
    if (pot > -Infinity) return { q: 2000 + pot, shot };
    if (hit > -Infinity) return { q: 1000 + hit, shot: hitShot };
    return { q: -near / 10, shot: null };
  }

  /**
   * その一撞きで**手玉が最初に触れた玉**。触れた時点で読みを打ち切るので軽い。
   * どこにも触れなければ null。
   */
  function firstContact(game, cue, shot) {
    const w = E.cloneWorld(game.world);
    const c = w.balls.find(b => b.id === cue.id);
    if (!c) return null;
    let hit = null;
    E.applyCue(c, shot);
    E.runShot(w, 6, ww => {
      for (const ev of ww.events) {
        if (ev.type === 'hit' && (ev.a === c.id || ev.b === c.id)) {
          hit = (ev.a === c.id ? ev.b : ev.a);
          return false;               // 触れた＝ここで打ち切る
        }
      }
      return true;
    });
    return hit;
  }

  // ───────── 思考（フレームをまたいで少しずつ進める） ─────────
  /**
   * @param {object} game
   * @param {number} playerIdx
   * @param {function} done  done(shot) で結果を返す
   * @returns {function} 中断用の関数
   */
  // ───────── カーリング型（G-09）の一撞き。仕様書 7.9節 ─────────
  /*
   * ★ここは**「入れる」腕ではなく「止める」腕**である。
   * 他の8ルールの読み（buildCandidates / evaluate）は「ポケットへ入るか」を数えるので、
   * このルールには1つも当てはまらない。丸ごと別の読みを持つ。
   *
   * **狙いと強さから止まる場所を数式で出すことはできない**（クッションに当たる・
   * 先に投げた玉に当たる）。そこで**試し撞きして、そのエンドが今終わったら
   * 何点になるかで採点する**。採点にはルール側の数え方をそのまま使う考え方で、
   * 自前の目安（中心に近いほど良い）だけで測ると
   * **「相手より内側に1個」というこのルールの核心**から外れる
   * ── 中心の近くに5個固めるより、相手の最内より内側に1個ある形のほうが点が入る。
   */
  /*
   * 狙う向きと強さの候補。
   * ★**強さは「寄せる」帯を細かく、「跳ね返す・弾き出す」帯を粗く**取る。
   * 実測（8形状・まっすぐ）＝目標円へ寄る強さは 0.048〜0.064 に固まっていて、
   * そこだけ 0.004 刻みで見ないと入る筋を跨いでしまう。
   * 上のほうは跳ね返して届かせる筋（0.064〜0.40）で、こちらは粗くてよい。
   */
  const CURL_DIRS = [0, -0.03, 0.03, -0.07, 0.07];
  const CURL_POWERS = [0.040, 0.044, 0.048, 0.052, 0.056, 0.060, 0.064, 0.070, 0.10, 0.16, 0.25, 0.38];
  const CURL_TOP = { easy: 0.55, hard: 0.28, apocalypse: 0.08 };
  /*
   * ★**投球位置からハウスへ真っすぐ通れない台では、跳ね返しの筋を探して撞く。**
   * 上の CURL_DIRS は真っすぐから ±4 度しか振らない。ドーナツ型は投球位置とハウスの間を
   * 中央の島が完全に塞ぐので、この範囲は全部島に当たる＝**AI が一度もハウスへ届かなくなる。**
   * しかも塞がれた台では真っすぐの筋そのものが無駄で、島の手前で止まった玉は
   * 中心から遠すぎてホグ円の外＝その場で取り除かれる。だから**足すのではなく入れ替える。**
   *
   * ★**鏡の理屈（入る角＝出る角）では当てられない。**実測すると、鏡で求めた 45 度は
   * どの強さでもハウスに入らず、実際に入るのは 17〜19 度・55〜58 度・110〜118 度だった。
   * クッションは反発 0.86 で、回転も乗るので鏡にならない。**探すには実際に撞いてみるしかない。**
   *
   * そこで**台の形ごとに一度だけ、空の盤で全方位を試し撞きして「届く筋」を覚える**。
   * 投球位置は台ごとに1点で動かないので、覚えた筋はその台のあいだじゅう使える。
   * 一撞きごとに全方位を撞き直すと、候補が 378 通りになって考える時間が5倍になった（実測）。
   *
   * ★**覚えた筋のまわりを振る数は「考える時間が長方形と同じくらいに収まる」大きさで決めた。**
   * 4本 × 向き3 × 強さ3 ＝ 36 通りで、8投目の考える時間は長方形 5.9 秒に対し 6.3 秒。
   * 5本 × 3 × 5 ＝ 75 通りにすると 10.8 秒（1.8倍）になり、ハウスに入る数は変わらなかった。
   */
  const CURL_SEED_STEP = 8;                                   // 筋を探す向きの刻み（度）
  const CURL_SEED_POWERS = [0.14, 0.20, 0.26, 0.32, 0.38];    // 筋を探す強さ
  const CURL_SEED_KEEP = 4;                                   // 覚える筋の数
  const CURL_SEED_APART = 12;                                 // 覚える筋どうしを離す角度（度）
  const CURL_SEED_DIRS = [-3, 0, 3];                          // 覚えた筋のまわりの振り（度）
  const CURL_SEED_POWS = [-0.03, 0, 0.03];                    // 同じく強さの振り
  const curlSeeds = {};      // 台の形ごとの「届く筋」。一度探したら覚えておく

  /**
   * 空の盤で全方位を試し撞きし、ハウスの中心へいちばん寄る筋を CURL_SEED_KEEP 本選ぶ。
   * **向きが近いものは1本にまとめる**（同じ筋の隣どうしで埋まると、当たりが1つしか残らない）。
   */
  function curlBankSeeds(game, cue) {
    /*
     * ★**覚える鍵に物理の設定も入れる。**跳ね返りは壁ズリや回転の設定で変わるので、
     * 台の形だけを鍵にすると、設定を変えたあとも古い筋を使い続ける（覚えた値が黙って古くなる）。
     */
    const tu = game.tuning || {};
    const key = game.table.shape + (game.table.hasPockets ? 'P' : 'C') + '|'
      + ['cushionSpin', 'spinTransfer', 'throwEffect', 'wallSlide']
        .map(k => (tu[k] ? '1' : '0')).join('');
    if (curlSeeds[key]) return curlSeeds[key];
    const L = game.curling.layout;
    const toC = Math.atan2(L.center.y - cue.y, L.center.x - cue.x);
    // 先に投げた玉を外した盤で測る（その日の配置に引きずられた筋を覚えないため）
    const empty = E.cloneWorld(game.world);
    empty.balls.forEach(b => { if (b.id !== cue.id) { b.onTable = false; b.state = 'gone'; } });
    const tried = [];
    for (let deg = 0; deg < 360; deg += CURL_SEED_STEP) {
      for (const power of CURL_SEED_POWERS) {
        const w = E.cloneWorld(empty);
        const c = w.balls.find(x => x.id === cue.id);
        if (!c) continue;
        E.applyCue(c, { dir: toC + deg * Math.PI / 180, tipX: 0, tipY: 0, elev: 0, power });
        E.runShot(w, 20);
        if (c.state !== 'live') continue;
        tried.push({ deg, power, d: Math.hypot(c.x - L.center.x, c.y - L.center.y) });
      }
    }
    tried.sort((a, b) => a.d - b.d);
    const keep = [];
    for (const t of tried) {
      if (keep.length >= CURL_SEED_KEEP) break;
      const apart = keep.every(k => {
        let g = Math.abs(k.deg - t.deg) % 360;
        if (g > 180) g = 360 - g;
        return g >= CURL_SEED_APART;
      });
      if (apart) keep.push(t);
    }
    curlSeeds[key] = keep;
    return keep;
  }

  /** その盤面で、いまエンドが終わったとしたら何点か（ホグ円の外は取り除かれる前提） */
  function curlValue(game, playerIdx, balls) {
    const L = game.curling.layout, voided = game.curling.voided || {};
    const live = balls.filter(b => b.stone != null && b.state === 'live')
      .map(b => ({
        seat: b.owner, id: b.id, mine: b.owner === playerIdx,
        d: Math.hypot(b.x - L.center.x, b.y - L.center.y),
        counted: !voided[b.id],
      }))
      .filter(s => s.d <= L.hog);          // ホグ円の外の玉は、この一撞きの終わりに消える
    const inHouse = live.filter(s => s.counted && s.d < L.radius)
      .sort((a, b) => (a.d - b.d) || (a.seat - b.seat) || (a.id - b.id));
    let mine = 0, foe = 0;
    if (inHouse.length) {
      const w = inHouse[0].seat;
      const other = inHouse.find(s => s.seat !== w);
      const lim = other ? other.d : Infinity;
      const pts = inHouse.filter(s => s.seat === w && s.d < lim).length;
      if (w === playerIdx) mine = pts; else foe = pts;
    }
    const myD = live.filter(s => s.mine).map(s => s.d);
    const foeD = live.filter(s => !s.mine).map(s => s.d);
    const myBest = myD.length ? Math.min.apply(null, myD) : L.hog;
    const foeBest = foeD.length ? Math.min.apply(null, foeD) : L.hog;
    /*
     * 点差がいちばん重い。**同じ点差の中では**
     *   ・自分の最内が相手の最内より中心に近いほど良い（次の一撞きで点になる形）
     *   ・盤に残っている自分の玉が多いほど良い（落とす・ホグ円の外へ出すのは損）
     * の順に効かせる。玉の数を点差より重くすると、**投げずに置くだけが最善**になる。
     */
    return (mine - foe) * 1000
      + (foeBest - myBest) * 2
      + myD.length * 40 - foeD.length * 15;
  }

  function curlingThink(game, playerIdx, done) {
    const cue = RU.cueBallOf(game, playerIdx);
    if (!cue) { done({ dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0.05 }); return function () {}; }
    const L = game.curling.layout;
    const toC = Math.atan2(L.center.y - cue.y, L.center.x - cue.x);

    // ハウスへ真っすぐ通れるか。塞がれている台（ドーナツ型）は狙いの作り方を変える
    const blocked = pathCrossesWall(game.table, cue.x, cue.y, L.center.x, L.center.y, cue.r);

    // 狙う向き＝目標円の中心まわりと、**盤にある玉それぞれ**（弾き出しと、その手前へ置く筋）
    const dirs = blocked ? [] : CURL_DIRS.map(o => toC + o);
    const stones = game.world.balls
      .filter(b => b !== cue && b.state === 'live' && b.stone != null)
      .map(b => ({ b, d: Math.hypot(b.x - cue.x, b.y - cue.y) }))
      .sort((a, b) => a.d - b.d).slice(0, 4);
    for (const s of stones) dirs.push(Math.atan2(s.b.y - cue.y, s.b.x - cue.x));

    const cands = [];
    for (const dir of dirs) for (const power of CURL_POWERS) {
      cands.push({ dir, power, tipX: 0, tipY: 0, elev: 0 });
    }
    // 塞がれた台では、真っすぐの代わりに**覚えた跳ね返しの筋のまわり**を試す
    if (blocked) {
      for (const s of curlBankSeeds(game, cue)) {
        for (const dd of CURL_SEED_DIRS) for (const dp of CURL_SEED_POWS) {
          cands.push({
            dir: toC + (s.deg + dd) * Math.PI / 180,
            power: Math.max(0.03, Math.min(0.40, s.power + dp)),
            tipX: 0, tipY: 0, elev: 0,
          });
        }
      }
    }

    let i = 0, cancelled = false;
    const scored = [];
    function chunk() {
      if (cancelled) return;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      while (i < cands.length) {
        const s = cands[i++];
        const w = E.cloneWorld(game.world);
        const c = w.balls.find(x => x.id === cue.id);
        if (c) { E.applyCue(c, s); E.runShot(w, 20); scored.push({ s, sc: curlValue(game, playerIdx, w.balls) }); }
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - t0 > 22) break;             // 1フレームに詰め込みすぎない
      }
      if (i < cands.length) { requestAnimationFrame(chunk); return; }
      finish();
    }
    /*
     * ★**腕前は「良い一撞きにぶれを乗せる」形では表さない**（バンキングと同じ理由）。
     * 止める競技はわずかな強さの違いが止まる場所を数百 mm 動かすので、
     * ぶれを乗せると、ぶれた結果が「玉を失う」になることがあり、
     * それを避けて撞き直させると簡単な設定のほうが上手になる。
     * **成り立つ撞き方を並べて、腕前に応じた上位から1つ選ぶ。**
     */
    function finish() {
      if (!scored.length) { done({ dir: toC, tipX: 0, tipY: 0, elev: 0, power: 0.05 }); return; }
      scored.sort((a, b) => b.sc - a.sc);
      const frac = CURL_TOP[game.difficulty] != null ? CURL_TOP[game.difficulty] : CURL_TOP.hard;
      const room = Math.max(1, Math.round(scored.length * frac));
      const pick = Math.min(scored.length - 1, Math.floor(game.rng() * room));
      done(Object.assign({}, scored[pick].s));
    }
    requestAnimationFrame(chunk);
    return function cancel() { cancelled = true; };
  }

  // ───────── G-11 ボウリング型（7.11節）の AI ─────────

  /*
   * ★**ボウリング型の AI は「倒す腕」であって、他8ルールの読み（入るか）は1つも当てはまらない。**
   * 落とすべきポケットが無く、狙う相手は10本のピンだけである。
   *
   * ★**カーリング型のような「覚えた跳ね返しの筋」は要らない。**
   * 実測：**16バリエーションすべてで、投球位置からピン10本がまっすぐ見通せる**
   * （壁までのすき間は、いちばん狭いドーナツ型でも玉の半径をわずかに上回る）。
   * したがって真っすぐ狙う候補だけで足りる。
   */
  /*
   * ★**強さは2段しか置かない。**実測（間隔1.50倍・まっすぐ狙う）では
   *   力50%・70%・85%・100% のどれでも倒れるのは 10 本で、**強さは結果をほとんど変えない。**
   *   このルールで結果を決めるのは向きである。候補を増やしても読む時間が延びるだけになる。
   *
   * ★**物理の走らせ方は縮めても同じ**（実測：上限を20秒から3秒に縮めても倒れる本数は不変。
   *   玉はそれよりずっと早く止まる）。したがって速くする余地は候補の数にしかない。
   */
  const BOWL_POWERS = [0.60, 0.85];
  // 先頭のピンのまわりを細かく振る（度）。実測でストライクは「ぴったり」の付近にしか出ない
  const BOWL_FAN = [0, -0.5, 0.5, -1.5, 1.5];
  const BOWL_OTHERS = 6;      // 先頭以外に狙うピンの数（近いほうから）
  /*
   * ★**腕前は「いちばん良い狙いに、腕前ぶんのぶれを乗せる」形で表す。**
   *
   * カーリング型は逆に「成り立つ撞き方の上位◯割から引く」形にした。あちらは**止める競技**で、
   * わずかな強さの違いが止まる場所を数百 mm 動かし、ぶれた結果が「玉を失う」になりうる。
   * ボウリング型は**倒す競技**で、狙いがずれても倒れる本数がなだらかに減るだけである
   * （実測：ぴったり10本 → 0.5度ずれて8本 → 2〜5度ずれて6〜8本。玉を失う失敗にはならない）。
   * したがって、現実のボウリングと同じく**狙いの精度がそのまま腕前**になる。
   *
   * ★**上位◯割から引く形はこのルールでは効かない。**投球位置もピンの並びもフレームごとに
   *   同じなので、候補の上位はいつも「まっすぐ＝ストライク」で埋まる。実測でその形にしたところ、
   *   ふつうの難易度でも 268〜300 点（＝ほぼ毎回パーフェクト）になった。
   *
   * 数字は狙いのぶれの幅（度）。両端が出にくいよう2回引いて足す（真ん中が出やすい）。
   */
  const BOWL_WOBBLE = { easy: 3.2, hard: 1.1, apocalypse: 0.0 };

  /**
   * その一撞きで**新たに倒れる本数**。倒れ判定はルール側と同じ（並べ直した位置から 20mm）。
   * ★**手玉が落ちる・場外へ出る一撞きはファウル**で、倒した本数が 0 と数えられる（7.2.5節）。
   *   0本と同じ値にすると「どうせ0本なら落としてもよい」になるので、0より下に置く。
   */
  function bowlValue(game, balls, standing) {
    const bw = game.bowling;
    const cue = balls.find(b => b.kind === 'cue');
    if (!cue || cue.state !== 'live') return -1;
    let n = 0;
    for (const b of balls) {
      if (b.pin == null || !standing[b.id]) continue;
      const st = bw.start[b.id];
      if (!st) continue;
      if (b.state !== 'live' || Math.hypot(b.x - st.x, b.y - st.y) >= RU.BOWL_DOWN) n++;
    }
    return n;
  }

  function bowlThink(game, playerIdx, done) {
    const cue = RU.cueBallOf(game, playerIdx);
    const pins = game.world.balls.filter(b => b.pin != null && b.state === 'live');
    if (!cue || !pins.length) { done({ dir: 0, tipX: 0, tipY: 0, elev: 0, power: 0.85 }); return function () {}; }
    const standing = {};
    pins.forEach(b => { standing[b.id] = 1; });

    // いちばん手前のピン＝ふつうはここを狙う。そのまわりだけを細かく振る
    let head = pins[0], best = Infinity;
    for (const b of pins) { const d = Math.hypot(b.x - cue.x, b.y - cue.y); if (d < best) { best = d; head = b; } }
    const toHead = Math.atan2(head.y - cue.y, head.x - cue.x);
    const dirs = BOWL_FAN.map(o => toHead + o * Math.PI / 180);
    // 残ったピンが散らばっている場面（スプリット）のために、1本ずつの向きも入れる
    const others = pins.filter(b => b !== head)
      .map(b => ({ b, d: Math.hypot(b.x - cue.x, b.y - cue.y) }))
      .sort((a, c) => a.d - c.d).slice(0, BOWL_OTHERS);
    for (const o of others) dirs.push(Math.atan2(o.b.y - cue.y, o.b.x - cue.x));

    const cands = [];
    for (const dir of dirs) for (const power of BOWL_POWERS) {
      cands.push({ dir, power, tipX: 0, tipY: 0, elev: 0 });
    }

    let i = 0, cancelled = false;
    const scored = [];
    function chunk() {
      if (cancelled) return;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      while (i < cands.length) {
        const s = cands[i++];
        const w = E.cloneWorld(game.world);
        const c = w.balls.find(x => x.id === cue.id);
        if (c) { E.applyCue(c, s); E.runShot(w, 20); scored.push({ s, sc: bowlValue(game, w.balls, standing) }); }
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - t0 > 22) break;             // 1フレームに詰め込みすぎない
      }
      if (i < cands.length) { requestAnimationFrame(chunk); return; }
      finish();
    }
    function finish() {
      if (!scored.length) { done({ dir: toHead, tipX: 0, tipY: 0, elev: 0, power: 0.85 }); return; }
      // いちばん多く倒せる狙い。同じ本数なら、先に見つけたほう（候補の並びは決定論）
      scored.sort((a, b) => b.sc - a.sc);
      const s = scored[0].s;
      const w = BOWL_WOBBLE[game.difficulty] != null ? BOWL_WOBBLE[game.difficulty] : BOWL_WOBBLE.hard;
      const off = (game.rng() + game.rng() - 1) * w * Math.PI / 180;
      done(Object.assign({}, s, { dir: s.dir + off }));
    }
    requestAnimationFrame(chunk);
    return function cancel() { cancelled = true; };
  }

  function think(game, playerIdx, done) {
    if (game.rule === 'G-09') return curlingThink(game, playerIdx, done);
    if (game.rule === 'G-11') return bowlThink(game, playerIdx, done);
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

  // curlBankSeeds は検査から直に確かめるために出している（覚えた筋に当たりの幅があるか）
  return { think, pickBallInHand, bankShot, curlingThink, curlValue, curlBankSeeds,
    bowlThink, bowlValue, BOWL_POWERS, BOWL_WOBBLE, PROFILE };
})();

if (typeof window !== 'undefined') window.BilliardsAI = BilliardsAI;
