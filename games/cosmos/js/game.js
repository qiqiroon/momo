/*
 * MOMO Cosmos — ゲーム処理（物理・落下・合体・出現・ゲームオーバー）
 * DOM に触れない。描画と操作は render.js / input.js が担う。
 * 状態：TITLE / PLAY / PAUSE / GAMEOVER / BH_STANDBY / BH_BIRTH / BH / BH_SUPER
 *       / FINAL_ABSORB / SILENCE / BIGBANG / ENDROLL（第12章・第13章。演出は ending.js）
 */
(function (root) {
  'use strict';

  class CosmosGame {
    constructor(config, Matter, opts) {
      this.C = config;
      this.M = Matter;
      this.random = (opts && opts.random) || Math.random;
      this.listeners = {};
      this.state = 'TITLE';
      this.speed = 1;          // デバッグ用のゲーム速度
      this.forcedStage = 0;    // デバッグ：次に落とす段階を固定（0 = 固定しない）
      this.highScore = 0;
      this.clearCount = 0;     // クリア回数（main.js が保存から読む）
      this._newGame();
    }

    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => fn(data)); }

    // ---- 開始・状態 ----------------------------------------------------
    _newGame() {
      const M = this.M, C = this.C, P = C.physics, B = C.board;
      this.engine = M.Engine.create({
        enableSleeping: false,
        positionIterations: P.positionIterations,
        velocityIterations: P.velocityIterations
      });
      this.engine.gravity.y = P.gravityY;
      const t = B.wallThickness, W = B.width, H = B.height;
      const opt = { isStatic: true, friction: P.friction, frictionStatic: P.frictionStatic, restitution: P.restitution, label: 'wall' };
      M.Composite.add(this.engine.world, [
        M.Bodies.rectangle(-t / 2, H / 2 - H, t, H * 3, opt),          // 左（上に高く伸ばす）
        M.Bodies.rectangle(W + t / 2, H / 2 - H, t, H * 3, opt),       // 右
        M.Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, Object.assign({}, opt, { label: 'floor' })) // 床
      ]);
      this._pairs = [];
      const collect = ev => { for (const p of ev.pairs) this._pairs.push(p); };
      M.Events.on(this.engine, 'collisionStart', ev => {
        // このイベントは衝突を解く前に来る。床との組だけ反発を差し替える（組の反発は2つの大きい方になるため）
        for (const p of ev.pairs) if (p.bodyA.label === 'floor' || p.bodyB.label === 'floor') p.restitution = P.floorRestitution;
        collect(ev); this._impact(ev.pairs);
      });
      M.Events.on(this.engine, 'collisionActive', collect);

      this.time = 0;            // シミュレーション時間（秒）
      this._acc = 0;
      this.score = 0;
      this.maxStage = 1;
      this.dropCount = 0;
      this.lastDropAt = -1e9;
      this.overTime = 0;
      this.warning = false;
      this.recentSpawns = [];
      this.aimX = B.width / 2;
      this.queue = [this._rollStage(), this._rollStage()];
      this.newRecord = false;
      this.resumeState = 'PLAY';
      this.standby = null;      // BH_STANDBY：{ a, b, link, t, calm }
      this.birth = null;        // BH_BIRTH：{ t, x, y }
      this.bh = null;           // ブラックホール：{ x, y, r, growth, tier, pulse, from, spin }
      this.absorbing = [];      // 吸収の演出中：{ stage, x, y, angle, r, t }
      this.superT = 0;
      this.endT = 0;            // エンディングの各状態に入ってからの秒
      this.playTime = 0;        // 超巨大に達するまでのプレイ時間（秒）
      this.rollSkippable = false;
      this.rollDone = false;
      this.rollSec = this.C.ending.rollSec;  // エンドロールの長さ。main.js が文字の量から決め直す
      this._ev = {};            // エンディングで一度だけ起こすことの済み印
    }

    _setState(st) { this.state = st; this.emit('state', st); }
    start() { this._newGame(); this._setState('PLAY'); }
    toTitle() { this._newGame(); this._setState('TITLE'); }
    /** 落下操作を受け付ける状態（通常期と餌やり） */
    get controllable() { return this.state === 'PLAY' || this.state === 'BH'; }
    /** 時間が進む状態 */
    get running() { return ['PLAY', 'BH_STANDBY', 'BH_BIRTH', 'BH', 'BH_SUPER', 'FINAL_ABSORB', 'SILENCE', 'BIGBANG', 'ENDROLL'].includes(this.state); }
    /** 最終吸収より後（物理を動かさない）。ENDROLL の後半も含む */
    get afterAbsorb() { return ['SILENCE', 'BIGBANG', 'ENDROLL'].includes(this.state); }
    pause() { if (this.controllable) { this.resumeState = this.state; this._setState('PAUSE'); } }
    resume() { if (this.state === 'PAUSE') this._setState(this.resumeState); }

    // ---- 出現テーブル（第6.3節） ----------------------------------------
    spawnRange() {
      const row = this.C.spawnTable.find(r => this.maxStage <= r.upToMaxStage);
      return row.range;
    }

    _rollStage() {
      const [lo, hi] = this.spawnRange();
      const n = hi - lo + 1;
      const w = this.C.spawnWeightsFor(n);
      const r = this.recentSpawns, lim = this.C.maxSameInARow;
      // 直前に同じ天体が lim 回続いていれば、その天体を候補から外す
      let banned = 0;
      if (r.length >= lim && r.slice(-lim).every(s => s === r[r.length - 1])) banned = r[r.length - 1];
      let total = 0;
      const cand = [];
      for (let i = 0; i < n; i++) {
        const s = lo + i;
        if (s === banned && n > 1) continue;
        cand.push([s, w[i]]); total += w[i];
      }
      let x = this.random() * total;
      let pick = cand[cand.length - 1][0];
      for (const [s, wi] of cand) { if ((x -= wi) < 0) { pick = s; break; } }
      r.push(pick);
      if (r.length > 8) r.shift();
      return pick;
    }

    get nextStage() { return this.forcedStage || this.queue[0]; }
    get nextNextStage() { return this.queue[1]; }

    // ---- 落下（第6章） ----------------------------------------------------
    clampX(x, stage) {
      const r = this.C.stages[stage || this.nextStage].radius;
      return Math.max(r + 1, Math.min(this.C.board.width - r - 1, x));
    }

    canDrop() {
      return this.controllable && (this.time - this.lastDropAt) * 1000 >= this.C.input.dropCooldownMs;
    }

    setAim(x) { this.aimX = this.clampX(x); }

    /** 落とす。連打防止中は照準だけ動かして false を返す */
    drop(x) {
      if (x != null) this.setAim(x);
      if (!this.canDrop()) return false;
      let stage;
      if (this.forcedStage) stage = this.forcedStage;
      else { stage = this.queue.shift(); this.queue.push(this._rollStage()); }
      const x0 = this.clampX(this.aimX, stage);
      const b = this._addBody(stage, x0, this.C.board.dropY);
      b.plugin.cosmos.dropped = true;
      this.lastDropAt = this.time;
      this.dropCount++;
      this._noteStage(stage);
      this.aimX = this.clampX(this.aimX);
      this.emit('drop', { stage, x: x0 });
      return true;
    }

    _addBody(stage, x, y) {
      const P = this.C.physics;
      const r = this.C.stages[stage].radius;
      const b = this.M.Bodies.circle(x, y, r, {
        restitution: P.restitution, friction: P.friction, frictionStatic: P.frictionStatic,
        frictionAir: P.frictionAir, density: P.density, label: 'body'
      });
      b.plugin = b.plugin || {};
      // sq：やわらかさの縮み量、sqV：その速さ、sqAng：縮む向き（ぶつかった向き）
      b.plugin.cosmos = { stage, born: this.time, merging: false, dropped: false, sq: 0, sqV: 0, sqAng: 0 };
      this.M.Composite.add(this.engine.world, b);
      return b;
    }

    _noteStage(stage) {
      if (stage > this.maxStage) { this.maxStage = stage; this.emit('maxStage', stage); }
    }

    bodies() { return this.M.Composite.allBodies(this.engine.world).filter(b => b.label === 'body'); }

    // ---- 更新 ------------------------------------------------------------
    update(dtSec) {
      if (!this.running) return;
      const P = this.C.physics, step = P.stepMs / 1000;
      this._acc += Math.min(dtSec, 0.1) * this.speed;
      let n = 0;
      while (this._acc >= step && n < P.maxStepsPerFrame * Math.max(1, this.speed)) {
        this._acc -= step; n++;
        this._step(step);
        if (!this.running) { this._acc = 0; break; }
      }
      if (n >= P.maxStepsPerFrame * Math.max(1, this.speed)) this._acc = 0; // 処理落ち時は追いかけない
    }

    _step(step) {
      const M = this.M;
      if (this.afterAbsorb) { this._updateEnding(step); return; }
      this._pairs.length = 0;
      this._mergedThisStep = 0;
      // BH_BIRTH の最初は物理をスローにする（第11.1節）
      this.engine.timing.timeScale = (this.state === 'BH_BIRTH' && this.birth.t < this.C.bh.gatherSec) ? this.C.bh.slowScale : 1;
      if (this.bh && this._sucking) this._suction();
      M.Engine.update(this.engine, this.C.physics.stepMs);
      this.time += step;
      this._rollingResistance();
      this._squashSpring();
      this._processMerges();
      if (this.state === 'PLAY') this._checkGameOver(step);
      else if (this.state === 'BH_STANDBY') this._updateStandby(step);
      else if (this.state === 'BH_BIRTH') this._updateBirth(step);
      if (this.bh) this._updateBH(step);
      if (this.state === 'FINAL_ABSORB') this._updateFinal(step);
    }

    get _sucking() { return this.state === 'BH' || this.state === 'BH_SUPER' || this.state === 'FINAL_ABSORB'; }

    // 接触中の天体だけ角速度を減らす（第7.2節 転がり抵抗）
    _rollingResistance() {
      const k = this.C.physics.rollingDamping;
      const touched = new Set();
      for (const p of this.engine.pairs.list) {
        if (!p.isActive) continue;
        if (!p.bodyA.isStatic) touched.add(p.bodyA);
        if (!p.bodyB.isStatic) touched.add(p.bodyB);
      }
      touched.forEach(b => this.M.Body.setAngularVelocity(b, b.angularVelocity * k));
    }

    // ぶつかった瞬間：相対速度の法線成分に応じて、その向きに縮ませる
    _impact(pairs) {
      const S = this.C.squash;
      for (const p of pairs) {
        const a = p.bodyA, b = p.bodyB, n = p.collision.normal;
        const v = Math.abs((a.velocity.x - b.velocity.x) * n.x + (a.velocity.y - b.velocity.y) * n.y);
        const amt = Math.min(S.max, v * S.gain);
        if (amt < 0.01) continue;
        const ang = Math.atan2(n.y, n.x);
        for (const o of [a, b]) {
          const c = o.plugin && o.plugin.cosmos;
          if (!c) continue;
          if (amt > c.sq) { c.sqV = 0; c.sq = amt; c.sqAng = ang; }
        }
      }
    }

    // 縮みをばねで戻す（行き過ぎて少し伸び、ぷるんと収まる）
    _squashSpring() {
      const S = this.C.squash;
      for (const b of this.bodies()) {
        const c = b.plugin.cosmos;
        if (!c.sq && !c.sqV) continue;
        c.sqV = (c.sqV - S.stiffness * c.sq) * S.damping;
        c.sq += c.sqV;
        if (Math.abs(c.sq) < 0.001 && Math.abs(c.sqV) < 0.001) c.sq = c.sqV = 0;
      }
    }

    // ---- 合体（第8章） ----------------------------------------------------
    _processMerges() {
      const M = this.M, C = this.C;
      const seen = new Set();
      for (const p of this._pairs) {
        const a = p.bodyA, b = p.bodyB;
        if (a.label !== 'body' || b.label !== 'body') continue;
        const ca = a.plugin.cosmos, cb = b.plugin.cosmos;
        if (ca.merging || cb.merging || ca.stage !== cb.stage) continue;
        const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const stage = ca.stage;
        if (ca.pending || cb.pending) continue;
        if (stage >= C.maxMergeStage) {
          // 中性子星どうし：通常期だけブラックホール誕生へ。待機中の3個目・BH 期は合体させない（吸われる）
          if (this.state === 'PLAY') this._enterStandby(a, b);
          continue;
        }
        ca.merging = cb.merging = true;
        const x = (a.position.x + b.position.x) / 2, y = (a.position.y + b.position.y) / 2;
        const vx = (a.velocity.x + b.velocity.x) / 2, vy = (a.velocity.y + b.velocity.y) / 2;
        const av = (a.angularVelocity + b.angularVelocity) / 2;
        M.Composite.remove(this.engine.world, a);
        M.Composite.remove(this.engine.world, b);
        const ns = stage + 1;
        const nb = this._addBody(ns, x, y);
        nb.plugin.cosmos.born = Math.min(ca.born, cb.born); // 合体で生まれた天体はすぐ判定対象（落下中扱いにしない）
        M.Body.setVelocity(nb, { x: vx, y: vy + C.physics.mergeBounceVy });
        M.Body.setAngularVelocity(nb, av);
        const add = C.stages[ns].score;
        this.score += add;
        this._noteStage(ns);
        this._mergedThisStep++;
        this.emit('merge', { stage: ns, x, y, add });
      }
    }

    // ---- ブラックホール誕生（第8.1節・第11.1節） --------------------------
    _enterStandby(a, b) {
      const M = this.M;
      a.plugin.cosmos.pending = b.plugin.cosmos.pending = true;
      // 2個は消さず、位置関係を保つように結ぶ
      const link = M.Constraint.create({ bodyA: a, bodyB: b, stiffness: 1, damping: 0.1,
        length: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) });
      M.Composite.add(this.engine.world, link);
      this.standby = { a, b, link, t: 0, calm: 0 };
      if (this.warning) { this.warning = false; this.emit('warning', false); }
      this.overTime = 0;
      this._setState('BH_STANDBY');
    }

    _updateStandby(step) {
      const S = this.standby, BH = this.C.bh;
      S.t += step;
      const still = !this._mergedThisStep && this.bodies().every(b => b.speed < BH.stableSpeed);
      S.calm = still ? S.calm + step : 0;
      if (S.calm >= BH.stableSec || S.t >= BH.standbyMaxSec) {
        this.birth = { t: 0, x: (S.a.position.x + S.b.position.x) / 2, y: (S.a.position.y + S.b.position.y) / 2 };
        this._setState('BH_BIRTH');
        this.emit('bhBirth', { x: this.birth.x, y: this.birth.y });
      }
    }

    _updateBirth(step) {
      const BH = this.C.bh, B = this.birth, S = this.standby;
      B.t += step;
      if (S) { B.x = (S.a.position.x + S.b.position.x) / 2; B.y = (S.a.position.y + S.b.position.y) / 2; }
      if (S && B.t >= BH.appearAt) {
        // 中性子星2個が消え、中間地点にブラックホールが出現する
        this.M.Composite.remove(this.engine.world, [S.a, S.b, S.link]);
        this.standby = null;
        this._spawnBH(B.x, B.y);
        const add = this.C.stages[13].score;
        this.score += add;
        this._noteStage(13);
        this.emit('bhAppear', { x: B.x, y: B.y, add });
      }
      if (B.t >= BH.birthSec) {
        this.bh.x = BH.home.x; this.bh.y = BH.home.y;
        this.birth = null;
        this._setState('BH');
      }
    }

    _spawnBH(x, y) {
      this.bh = { x, y, r: this.C.bh.sizeCurve[0][1], growth: 0, tier: 0, pulse: 0, from: { x, y }, spin: 0 };
    }

    /** 成長値 → 本体半径（第11.6節。間は直線でつなぐ） */
    bhRadius(growth) {
      const c = this.C.bh.sizeCurve;
      if (growth <= c[0][0]) return c[0][1];
      for (let i = 1; i < c.length; i++) {
        if (growth <= c[i][0]) { const [g0, r0] = c[i - 1], [g1, r1] = c[i]; return r0 + (r1 - r0) * (growth - g0) / (g1 - g0); }
      }
      return c[c.length - 1][1];
    }

    _grow(v) {
      const h = this.bh;
      h.growth += v;
      h.r = this.bhRadius(h.growth);
      let tier = 0;
      this.C.bh.tierAt.forEach((g, i) => { if (h.growth >= g) tier = i; });
      if (tier > h.tier) { h.tier = tier; this.emit('bhTier', tier); }
    }

    // 吸引（第11.4節）。力は重力（質量×重力の大きさ）の倍数で与える
    _suction() {
      const BH = this.C.bh, h = this.bh, M = this.M;
      const g = this.engine.gravity.scale * this.engine.gravity.y;
      const whole = this.state === 'BH_SUPER' || this.state === 'FINAL_ABSORB';
      for (const b of this.bodies()) {
        const dx = h.x - b.position.x, dy = h.y - b.position.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        let k = 0;
        if (whole || d < h.r * BH.nearR) k = BH.nearG;
        else if (d < h.r * BH.farR) k = BH.farGmax - (BH.farGmax - BH.farGmin) * (d - h.r * BH.nearR) / (h.r * (BH.farR - BH.nearR));
        if (!k) continue;
        const f = k * g * b.mass, ux = dx / d, uy = dy / d;
        // 中心へ向かう成分と、回る向きの成分（渦を巻いて吸い込まれる）
        M.Body.applyForce(b, b.position, {
          x: f * ((1 - BH.swirl) * ux - BH.swirl * uy),
          y: f * ((1 - BH.swirl) * uy + BH.swirl * ux)
        });
      }
    }

    _updateBH(step) {
      const BH = this.C.bh, h = this.bh, M = this.M;
      h.spin += step;
      h.pulse = Math.max(0, h.pulse - step * 3);
      // 誕生後、盤面中央付近へゆっくり移る
      if (this.state === 'BH_BIRTH') {
        const k = Math.min(1, (this.birth.t - BH.appearAt) / (BH.birthSec - BH.appearAt)), e = k * k * (3 - 2 * k);
        h.x = h.from.x + (BH.home.x - h.from.x) * e;
        h.y = h.from.y + (BH.home.y - h.from.y) * e;
      }
      // 吸収（第11.5節）
      if (this._sucking) {
        for (const b of this.bodies()) {
          if (Math.hypot(h.x - b.position.x, h.y - b.position.y) >= h.r * BH.absorbR) continue;
          this._absorb(b);
        }
        if (this.state === 'BH') this._grow(BH.growthPerSec * step);
      }
      for (const a of this.absorbing) a.t += step;
      this.absorbing = this.absorbing.filter(a => a.t < BH.absorbSec);
      // 超巨大に到達（第11.8節）。文字を見せてから最終吸収へ
      if (this.state === 'BH' && h.growth >= BH.superGrowth) {
        this.superT = 0;
        this.playTime = this.time;
        this._setState('BH_SUPER');
        this.emit('supermassive');
      } else if (this.state === 'BH_SUPER') {
        this.superT += step;
        if (this.superT >= BH.superHoldSec) this._enter('FINAL_ABSORB');
      }
    }

    _absorb(b) {
      const h = this.bh, c = b.plugin.cosmos;
      this.M.Composite.remove(this.engine.world, b);
      this.absorbing.push({ stage: c.stage, x: b.position.x, y: b.position.y, angle: b.angle, r: b.circleRadius, t: 0 });
      const add = c.stage * this.C.bh.absorbScorePerStage;
      this.score += add;
      h.pulse = 1;
      if (this.state === 'BH') this._grow(c.stage * c.stage);
      this.emit('absorb', { stage: c.stage, x: h.x, y: h.y, add });
    }

    // ---- エンディング（第12章・第13章） ------------------------------------
    _enter(st) { this.endT = 0; this._ev = {}; this._setState(st); }

    /** 時刻 at を初めて過ぎたときだけ true（一度だけ起こすこと） */
    _once(key, at) {
      if (this._ev[key] || this.endT < at) return false;
      return (this._ev[key] = true);
    }

    // 最終吸収：残りの天体をすべて吸い込む。箱と UI のゆがみは ending.js が描く
    _updateFinal(step) {
      const E = this.C.ending;
      this.endT += step;
      if (this._once('walls', E.wallsAt[0])) {
        // 盤面の箱も吸い込まれ始めるので、壁と床の当たり判定を外す
        this.M.Composite.remove(this.engine.world, this.M.Composite.allBodies(this.engine.world).filter(b => b.isStatic));
      }
      if (this._once('sweep', E.sweepAt)) this.bodies().forEach(b => this._absorb(b));
      E.pulseAt.forEach((t, i) => { if (this._once('pulse' + i, t)) { this.bh.pulse = 1; this.emit('bhPulse', i); } });
      if (this.endT >= E.absorbSec && !this.absorbing.length) {
        this._finishScore();
        this.rollSkippable = this.clearCount > 0; // 一度クリアしたことがあればスキップできる（第3.2節）
        this.clearCount++;
        this.emit('clear', { count: this.clearCount, score: this.score, high: this.highScore, newRecord: this.newRecord, playTime: this.playTime });
        this._enter('SILENCE');
      }
    }

    _updateEnding(step) {
      const E = this.C.ending;
      this.endT += step;
      if (this.bh) this.bh.spin += step;
      if (this.state === 'SILENCE' && this.endT >= E.silenceSec) this._enter('BIGBANG');
      else if (this.state === 'BIGBANG') {
        if (this._once('flash', E.burstAt)) this.emit('bigbangFlash');
        if (this._once('music', E.musicAt)) this.emit('endingMusic');
        if (this.endT >= E.bigbangSec) this._enter('ENDROLL');
      } else if (this.state === 'ENDROLL' && !this.rollDone && this.endT >= this.rollSec) {
        this.rollDone = true;
        this.emit('rollDone');
      }
    }

    /** エンドロールを飛ばす（一度クリアしたことがあるときだけ。第3.2節） */
    skipRoll() {
      if (this.state === 'ENDROLL' && this.rollSkippable && !this.rollDone) this.endT = this.rollSec;
    }

    // ---- ゲームオーバー（第10章） -----------------------------------------
    _checkGameOver(step) {
      const G = this.C.gameOver, line = this.C.board.deadlineY;
      let over = false;
      for (const b of this.bodies()) {
        const c = b.plugin.cosmos;
        if (c.dropped && this.time - c.born < G.settleAgeSec) continue; // 落下中
        if (b.position.y - b.circleRadius < line) { over = true; break; }
      }
      this.overTime = over ? this.overTime + step : 0;
      const warn = this.overTime >= G.warnSec;
      if (warn !== this.warning) { this.warning = warn; this.emit('warning', warn); }
      if (this.overTime >= G.overSec) {
        this.state = 'GAMEOVER';
        this.warning = false;
        this._finishScore();
        this.emit('gameOver', { score: this.score, high: this.highScore, maxStage: this.maxStage, newRecord: this.newRecord });
        this.emit('state', this.state);
      }
    }

    _finishScore() {
      if (this.score > this.highScore) { this.highScore = this.score; this.newRecord = true; this.emit('highScore', this.highScore); }
    }

    // ---- デバッグ（第9.4節） ----------------------------------------------
    debugSpawn(stage, x) {
      if (!this.controllable) return;
      const b = this._addBody(stage, this.clampX(x == null ? this.aimX : x, stage), this.C.board.dropY);
      b.plugin.cosmos.dropped = true;
      this._noteStage(stage);
    }

    /** 誕生の演出を飛ばして BH 期へ（第9.4節） */
    debugToBH() {
      if (this.state !== 'PLAY') return;
      if (this.warning) { this.warning = false; this.emit('warning', false); }
      this.overTime = 0;
      this._spawnBH(this.C.bh.home.x, this.C.bh.home.y);
      this.score += this.C.stages[13].score;
      this._noteStage(13);
      this._setState('BH');
    }

    /** 成長値を足す（デバッグ） */
    debugGrow(v) { if (this.bh && this.state === 'BH') this._grow(v); }

    /** 超巨大まで一気に育てる（エンディングの確認用） */
    debugToEnding() {
      if (this.state === 'PLAY') this.debugToBH();
      if (this.state === 'BH') this._grow(this.C.bh.superGrowth - this.bh.growth);
    }
  }

  root.CosmosGame = CosmosGame;
  if (typeof module !== 'undefined') module.exports = CosmosGame;
})(typeof window !== 'undefined' ? window : globalThis);
