/*
 * MOMO Cosmos — ゲーム処理（物理・落下・合体・出現・ゲームオーバー）
 * DOM に触れない。描画と操作は render.js / input.js が担う。
 * 状態：TITLE / PLAY / PAUSE / GAMEOVER / BH_PENDING（M2 で BH_STANDBY 以降に置き換える）
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
        M.Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, opt)        // 床
      ]);
      this._pairs = [];
      const collect = ev => { for (const p of ev.pairs) this._pairs.push(p); };
      M.Events.on(this.engine, 'collisionStart', collect);
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
    }

    start() { this._newGame(); this.state = 'PLAY'; this.emit('state', this.state); }
    toTitle() { this._newGame(); this.state = 'TITLE'; this.emit('state', this.state); }
    pause() { if (this.state === 'PLAY') { this.state = 'PAUSE'; this.emit('state', this.state); } }
    resume() { if (this.state === 'PAUSE') { this.state = 'PLAY'; this.emit('state', this.state); } }

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
      return this.state === 'PLAY' && (this.time - this.lastDropAt) * 1000 >= this.C.input.dropCooldownMs;
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
      b.plugin.cosmos = { stage, born: this.time, merging: false, dropped: false };
      this.M.Composite.add(this.engine.world, b);
      return b;
    }

    _noteStage(stage) {
      if (stage > this.maxStage) { this.maxStage = stage; this.emit('maxStage', stage); }
    }

    bodies() { return this.M.Composite.allBodies(this.engine.world).filter(b => b.label === 'body'); }

    // ---- 更新 ------------------------------------------------------------
    update(dtSec) {
      if (this.state !== 'PLAY') return;
      const P = this.C.physics, step = P.stepMs / 1000;
      this._acc += Math.min(dtSec, 0.1) * this.speed;
      let n = 0;
      while (this._acc >= step && n < P.maxStepsPerFrame * Math.max(1, this.speed)) {
        this._acc -= step; n++;
        this._step(step);
        if (this.state !== 'PLAY') { this._acc = 0; break; }
      }
      if (n >= P.maxStepsPerFrame * Math.max(1, this.speed)) this._acc = 0; // 処理落ち時は追いかけない
    }

    _step(step) {
      const M = this.M;
      this._pairs.length = 0;
      M.Engine.update(this.engine, this.C.physics.stepMs);
      this.time += step;
      this._rollingResistance();
      this._processMerges();
      if (this.state === 'PLAY') this._checkGameOver(step);
    }

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
        if (stage >= C.maxMergeStage) {
          // 中性子星どうし：M2 で BH_STANDBY へ。M1 では仮の画面を出して止める
          ca.merging = cb.merging = true;
          this.state = 'BH_PENDING';
          this._finishScore();
          this.emit('bhPending', { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 });
          this.emit('state', this.state);
          return;
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
        this.emit('merge', { stage: ns, x, y, add });
      }
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
      if (this.state !== 'PLAY') return;
      const b = this._addBody(stage, this.clampX(x == null ? this.aimX : x, stage), this.C.board.dropY);
      b.plugin.cosmos.dropped = true;
      this._noteStage(stage);
    }
  }

  root.CosmosGame = CosmosGame;
  if (typeof module !== 'undefined') module.exports = CosmosGame;
})(typeof window !== 'undefined' ? window : globalThis);
