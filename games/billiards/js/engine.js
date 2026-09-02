/**
 * MOMO Billiards — 物理エンジン
 * 仕様書 momo_billiards_spec.md 第5章（物理モデル）
 *
 * 守るべき性質（5.2節）
 *   ・固定タイムステップ 1/480 秒。描画フレームレートとは完全に分離する
 *   ・乱数はこのエンジンの中では一切使わない（呼び出し側が共有PRNGを持つ）
 *   ・衝突は掃引判定（連続衝突判定）で、厳密な時刻を求めてから解く（5.6.4節）
 *   ・同一の初期盤面＋同一の5値入力からは、何度走らせても同一の結果になる
 *
 * 層構造（5.3節）は「値が変わるだけ」で表す。エンジンに変則モード用の分岐は無い。
 *
 * 台の形は知らない。壁は台定義データがくれる線分の並びとして扱い、
 * 「台の内側かどうか」も台定義データ側の判定（BilliardsTable.clearance）へ預ける。
 * ここに形状名の分岐を書き始めたら設計が壊れかけている合図。
 */
const BilliardsEngine = (() => {
  'use strict';

  const DT = 1 / 480;                 // 固定タイムステップ（5.2.2節）
  const G = 9806.65;                  // 重力 mm/s^2
  const EPS = 1e-9;

  const BALL_M = 0.170;               // kg（標準玉。玉定義データ層の既定値）
  const BALL_E = 0.93;                // 玉どうしの反発係数
  const BALL_MU = 0.06;               // 玉どうしの摩擦（スロー効果・スピン転写の源）
  const CUE_M = 0.540;                // キューの質量 kg
  const CUE_E = 0.75;                 // キュー先革の反発係数
  const V_MAX = 12000;                // 最大手玉速度 mm/s（5.2.2節の想定値）

  const STOP_V = 8.0;                 // 停止判定（速度 mm/s）
  const STOP_W = 0.6;                 // 停止判定（角速度 rad/s）

  // ───────── ベクトル小道具（3次元） ─────────
  function v3(x, y, z) { return { x, y, z }; }
  function cross(a, b) {
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }

  // ───────── 玉 ─────────
  function makeBall(o) {
    return {
      id: o.id,                 // 一意の識別番号（同時衝突の解の確定に使う。5.6.5節）
      num: o.num != null ? o.num : 0,   // 表示上の番号（0=番号なし）
      kind: o.kind || 'object', // 'cue' | 'object'
      owner: o.owner != null ? o.owner : -1, // キャロムの手玉の持ち主
      color: o.color || '#ffffff',
      stripe: !!o.stripe,
      x: o.x, y: o.y, z: o.z != null ? o.z : 0, // z は台面からの玉の中心高さ − 半径（接地で0）
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
      r: o.r, m: o.m != null ? o.m : BALL_M,
      e: o.e != null ? o.e : BALL_E,
      onTable: true,            // 盤面に居るか（落球・場外で false）
      state: 'live',            // 'live' | 'pocketed' | 'off'
      // 曲面クッションに沿って走った長さと、前に沿わせた場所（5.7.3節・D29）
      slideRun: 0, slideX: null, slideY: null,
      // 回転の見た目（表面テクスチャの回転。4.2.2節）。単位クォータニオン
      qw: 1, qx: 0, qy: 0, qz: 0,
    };
  }

  function inertia(b) { return 0.4 * b.m * b.r * b.r; }

  // ───────── ワールド ─────────
  /**
   * @param {object} table  BilliardsTable.make() の結果
   * @param {Array}  balls  makeBall() で作った玉の配列
   * @param {object} tuning 撞球の癖6項目など（5.10節）
   */
  function createWorld(table, balls, tuning, opts) {
    return {
      table,
      balls,
      tuning: Object.assign({
        throwEffect: true,      // スロー効果
        spinTransfer: true,     // スピン転写
        cushionSpin: true,      // クッション反射時のスピン
        wallSlide: true,        // 壁ズリ
        // ダブルヒット判定・ミスキュー判定はショット入力側で使う
        doubleHit: true, miscue: true,
      }, tuning || {}),
      tick: 0,                  // ゲーム内時間＝ステップ数（5.2.3節）
      events: [],
      // 刻みごとの通知（step の末尾で呼ぶ）。使い道はエンジンの外が決める
      onAdvance: (opts && opts.onAdvance) || null,
    };
  }

  function cloneWorld(w) {
    return {
      table: w.table,
      balls: w.balls.map(b => Object.assign({}, b)),
      tuning: w.tuning,
      tick: w.tick,
      events: [],
    };
  }

  // ───────── ショット入力（5値）→ 初速・初期回転 ─────────
  /**
   * shot = { dir, power, tipX, tipY, elev }
   *   dir   … 撞く方向（ラジアン。台座標のX+を0とする）
   *   power … 0〜1（1が最大。オーバーパワーは >1 も受け付ける）
   *   tipX  … 撞点X（-1〜1。+ が右）
   *   tipY  … 撞点Y（-1〜1。+ が上＝フォロー）
   *   elev  … キュー仰角（ラジアン。0が水平・π/2が真上）
   *
   * 撞点とキュー先の作用は剛体の力積として解く。
   * 接触点 P = -c·d + a·u + b·w、力積 J·d を与えると
   *   Δv = J/m · d,  Δω = (P×d)·J/I
   * となり、P×d = (-a·sinθ, b, -a·cosθ)。
   * b>0（上撞き）で ωy>0＝フォロー、a>0（右撞き）で ωz<0、
   * 仰角があると a が ωx を生む＝これがマッセの源になる。
   */
  function applyCue(ball, shot) {
    const R = ball.r;
    const th = shot.elev;
    const a = shot.tipX * R * 0.5;   // 撞点は半径の 50% までを可動域とする（ミスキュー限界）
    const b = shot.tipY * R * 0.5;
    const off2 = a * a + b * b;
    const I = inertia(ball);
    const m = ball.m;

    // 接触点の相対速度が反発係数ぶん返る、という条件から力積が決まる。
    //   V0(1+e) = J·(1/M + 1/m + |P×d|²/I)   ／ |P×d|² = a² + b²
    // 撞点が中心から離れるほど回転にエネルギーが逃げ、前へ出る速度は落ちる。
    const gain = 1 / (1 + m / CUE_M + (m * off2) / I);
    const gain0 = 1 / (1 + m / CUE_M);     // 中心撞きのときの値
    // power=1・撞点中央・仰角0 のとき、ちょうど V_MAX が出るように正規化する
    const vAlong = shot.power * V_MAX * (gain / gain0);

    const cosT = Math.cos(th), sinT = Math.sin(th);
    const dirX = Math.cos(shot.dir), dirY = Math.sin(shot.dir);

    ball.vx = dirX * vAlong * cosT;
    ball.vy = dirY * vAlong * cosT;
    // 仰角ぶんの下向き成分は台が受け止め、跳ね返りとして上向きに現れる（ジャンプショット）
    ball.vz = vAlong * sinT * 0.55;
    if (ball.vz < 30) ball.vz = 0;         // わずかな仰角では浮かない

    // 角速度。ball frame（e1=撞く向き, e2=左, e3=上）で作ってから台座標へ回す
    const k = (m * vAlong) / I;            // J/I
    const w1 = -a * sinT * k;              // 撞く向きまわり＝マッセ成分
    const w2 = b * k;                      // 左向きまわり＝フォロー／ドロー
    const w3 = -a * cosT * k;              // 上向きまわり＝サイドスピン
    // e1 = (dirX, dirY, 0), e2 = (-dirY, dirX, 0), e3 = (0,0,1)
    ball.wx = w1 * dirX + w2 * (-dirY);
    ball.wy = w1 * dirY + w2 * dirX;
    ball.wz = w3;
  }

  /** ミスキューの判定（5.9.2節）。撞点とキュー仰角の両方で決まる。 */
  function isMiscue(shot) {
    const off = Math.hypot(shot.tipX, shot.tipY);
    const limit = 1.0 - 0.30 * Math.sin(shot.elev);   // 仰角が高いほど限界が狭まる
    return off > limit;
  }

  // ───────── 接地中の摩擦（5.5節） ─────────
  function contactSlip(b) {
    // 接地点の相対速度。接地点は中心の真下 (0,0,-r)
    //   u = v + ω × (0,0,-r) = (vx - wy·r, vy + wx·r)
    return { x: b.vx - b.wy * b.r, y: b.vy + b.wx * b.r };
  }

  function applyFriction(b, table, dt) {
    if (b.z > 0.01) {           // 空中：重力のみ（5.8.1節。横方向の力は働かない）
      b.vz -= G * dt;
      return;
    }
    const u = contactSlip(b);
    const us = Math.hypot(u.x, u.y);
    const mu = table.clothSlide;
    // 滑りは 3.5·μg の速さで消える（並進の減速 μg と、回転側の 2.5·μg の合計）。
    // これを1ステップ丸ごと当てると行き過ぎて滑りの向きが毎ステップ裏返り、
    // 摩擦が打ち消し合って玉が永久に止まらなくなる。
    // そこで「滑りが消える時刻」でステップを二つに割り、残りは転がりとして扱う。
    const tSlide = us > 1e-9 ? Math.min(dt, us / (3.5 * mu * G)) : 0;
    if (tSlide > 0) {
      const ux = u.x / us, uy = u.y / us;
      b.vx += -mu * G * ux * tSlide;
      b.vy += -mu * G * uy * tSlide;
      // 接地点まわりのトルク τ = (0,0,-r) × F。F は滑りの逆向きなので
      //   Δωx = -(5/2r)·μg·ûy ／ Δωy = +(5/2r)·μg·ûx
      // （前へ滑る玉は順回転を得て転がりへ移る、という向き）
      const c = (5 / (2 * b.r)) * mu * G * tSlide;
      b.wx += -c * uy;
      b.wy += c * ux;
    }
    const tRoll = dt - tSlide;
    if (tRoll > 0) {
      // 転がり：転がり抵抗のみ。角速度は転がり条件を保つ
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > EPS) {
        const dec = table.clothRoll * G * tRoll;
        const f = Math.max(0, (sp - dec) / sp);
        b.vx *= f; b.vy *= f;
      }
      b.wy = b.vx / b.r;
      b.wx = -b.vy / b.r;
    }
    // 縦軸まわり（サイドスピン）の減衰
    const sd = (5 / (2 * b.r)) * table.clothSpin * G * dt;
    if (Math.abs(b.wz) <= sd) b.wz = 0;
    else b.wz -= Math.sign(b.wz) * sd;
  }

  // ───────── 掃引判定 ─────────
  // 玉どうし：相対運動の距離が (r1+r2) になる最初の時刻
  function timeBallBall(a, b, tmax) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dvx = b.vx - a.vx, dvy = b.vy - a.vy, dvz = b.vz - a.vz;
    const rr = a.r + b.r;
    const A = dvx * dvx + dvy * dvy + dvz * dvz;
    if (A < EPS) return Infinity;
    const B = 2 * (dx * dvx + dy * dvy + dz * dvz);
    if (B >= 0) return Infinity;                 // 離れていく
    const C = dx * dx + dy * dy + dz * dz - rr * rr;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    let t = (-B - sq) / (2 * A);
    if (t < -1e-7) t = 0;                        // 既に重なっている＝即時に解く
    if (t > tmax) return Infinity;
    return Math.max(0, t);
  }

  // 玉とクッション（線分をカプセルとして扱う）
  function timeBallSeg(b, s, tmax) {
    // 線分方向
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    const el = Math.hypot(ex, ey);
    if (el < EPS) return Infinity;
    const ux = ex / el, uy = ey / el;
    // 玉の中心の線分ローカル座標（線分に沿う成分 sPos、法線成分 nPos）
    const rel = { x: b.x - s.x1, y: b.y - s.y1 };
    const nPos = rel.x * (-uy) + rel.y * ux;
    const sPos = rel.x * ux + rel.y * uy;
    const nVel = b.vx * (-uy) + b.vy * ux;
    const sVel = b.vx * ux + b.vy * uy;
    let best = Infinity;
    // 面（線分の内部）との接触
    if (Math.abs(nVel) > EPS) {
      const target = nPos > 0 ? b.r : -b.r;
      const t = (target - nPos) / nVel;
      if (t >= -1e-7 && t <= tmax) {
        const sp = sPos + sVel * Math.max(0, t);
        if (sp >= 0 && sp <= el && ((nPos > 0 && nVel < 0) || (nPos < 0 && nVel > 0))) {
          best = Math.max(0, t);
        }
      }
    }
    // 端点（ポケットの口の角）との接触
    for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
      const dx = p.x - b.x, dy = p.y - b.y;
      const A = b.vx * b.vx + b.vy * b.vy;
      if (A < EPS) continue;
      const B = -2 * (dx * b.vx + dy * b.vy);
      if (B >= 0) continue;
      const C = dx * dx + dy * dy - b.r * b.r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      let t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t < -1e-7) t = 0;
      if (t >= 0 && t <= tmax && t < best) best = t;
    }
    return best;
  }

  function norm2pi(a) { const x = a % (2 * Math.PI); return x < 0 ? x + 2 * Math.PI : x; }

  /**
   * 円弧のクッションに当たるまでの時間（3.7節）。
   *
   * 台の内側が円の外側にある壁（凹頂点の丸め・ドーナツの中の島）は side='out' で、
   * 玉の中心が中心から r + 玉半径 の距離に来たときに接する。
   * 台の内側が円の中にある壁（スタジアムの端・ドーナツの外周）は side='in' で、
   * r − 玉半径 の距離に来たときに接する。
   *
   * **円弧を多角形で近似しない**（3.7節）。近似すると法線に誤差が乗り、
   * 通信対戦の双方で盤面が食い違う。
   */
  function timeBallArc(b, a, tmax) {
    const reff = a.side === 'in' ? a.r - b.r : a.r + b.r;
    if (reff <= EPS) return Infinity;
    const A = b.vx * b.vx + b.vy * b.vy;
    if (A < EPS) return Infinity;
    const dx = b.x - a.cx, dy = b.y - a.cy;

    /*
     * ★すでに壁へ食い込んでいるときは、その場（0秒後）を接触として返す。
     *
     * 円弧に沿って走る玉は接線方向へ進むだけで外へ膨らむので、
     * 1ステップのあいだにわずかに壁の外側へ出ることがある。
     * いったん外へ出ると、そこから外向きに進む玉には
     * 「近づいてくる解」が存在しなくなり、**二度と捕まえられない**。
     * 直線の壁では壁と平行に走っても外へ膨らまないので、この形は起きない。
     */
    const d0 = Math.hypot(dx, dy);
    if (d0 > EPS && (a.side === 'in' ? d0 > reff : d0 < reff)) {
      let ix = dx / d0, iy = dy / d0;
      if (norm2pi(Math.atan2(iy, ix) - a.a0) <= a.sweep) {
        if (a.side === 'in') { ix = -ix; iy = -iy; }          // 台の内側を向く向き
        if (b.vx * ix + b.vy * iy < 0) return 0;              // なお外へ向かっている
      }
    }

    const B = 2 * (dx * b.vx + dy * b.vy);
    const C = dx * dx + dy * dy - reff * reff;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    const roots = [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    for (let i = 0; i < 2; i++) {
      const raw = roots[i];
      if (raw < -1e-7 || raw > tmax) continue;
      const t = raw < 0 ? 0 : raw;
      const px = b.x + b.vx * t, py = b.y + b.vy * t;
      let nx = px - a.cx, ny = py - a.cy;
      const nl = Math.hypot(nx, ny);
      if (nl < EPS) continue;
      nx /= nl; ny /= nl;
      if (norm2pi(Math.atan2(ny, nx) - a.a0) > a.sweep) continue;   // 円弧の範囲の外
      if (a.side === 'in') { nx = -nx; ny = -ny; }                  // 壁から台の内側を向く向き
      if (b.vx * nx + b.vy * ny >= 0) continue;                     // 離れていく向き
      return t;
    }
    return Infinity;
  }

  /**
   * 楕円弧のクッションに当たるまでの時間（3.7節）。
   *
   * ★円弧と違い、**玉の中心が通る線が楕円にならない**（円なら半径を玉半径ぶん
   * 増減した円のままなので、実効半径ひとつで解けた）。だからこの手は使えない。
   *
   * そこで媒介変数で解く。楕円の上の点 Q(θ) から台の内側へ玉半径ぶん寄せた点を C(θ) とし、
   *   「C(θ) が玉の進む直線の上に乗る」
   * という 1 本の式の零点を探す。**θ が決まれば接点も法線も式のまま出る**ので、
   * 折れ線で近似することにはならない（3.7節）。
   * 根の在りかは θ を刻んで符号の変わり目で挟み、あとは挟み込みで詰めるだけである。
   *
   * 玉半径（28.575）は楕円のいちばんきつい曲がりの半径（635²/1270 ＝ 317.5）より
   * ずっと小さいので、C(θ) は自分と交わらない。巨大玉でここを超えると前提が崩れる。
   */
  function ellOffsetPoint(e, th, r) {
    const q = BilliardsTable.ellPoint(e, th);
    const n = BilliardsTable.ellNormal(e, th);
    const s = e.side === 'in' ? -r : r;
    return { x: q.x + n.x * s, y: q.y + n.y * s };
  }

  /** 台の内側を向く単位法線（θ の場所で） */
  function ellInward(e, th) {
    const n = BilliardsTable.ellNormal(e, th);
    return e.side === 'in' ? { x: -n.x, y: -n.y } : n;
  }

  function timeBallEll(b, e, tmax) {
    const A = b.vx * b.vx + b.vy * b.vy;
    if (A < EPS) return Infinity;
    const reach = Math.sqrt(A) * tmax + b.r;

    // 安い足切り。要素の外接矩形までの距離より遠くへは、このステップで届かない
    const gx = Math.max(0, e.x0 - b.x, b.x - e.x1);
    const gy = Math.max(0, e.y0 - b.y, b.y - e.y1);
    if (gx > reach || gy > reach || Math.hypot(gx, gy) > reach) return Infinity;

    /*
     * すでに壁へ食い込んでいるなら、その場を接触として返す（円弧と同じ理由）。
     *
     * ★楕円では「玉の中心が壁からどれだけ離れているか」だけでは足りない。
     * 円弧なら実効半径ひとつの大小比較が浅い食い込みも深い食い込みも同時に表すが、
     * 楕円では距離しか持たないので、**壁の向こうへ丸ごと入り込むと
     * 距離が玉半径より大きくなり「触れていない」と読めてしまう**
     * （ドーナツの中央の島に玉が入り込んだまま出てこなくなる）。
     * そこで先に「どちら側に居るか」を見る。縦横を 1 に縮めれば内外は半径ひとつで分かる。
     *
     * ただしこれは**その玉に正対している一片**にだけ当てる。円弧を切った一片では、
     * 遠くの玉まで「向こう側に居る」と数えてしまい、ポケットへ落ちる玉を押し戻す。
     */
    const thRaw = BilliardsTable.ellNearestParam(e, b.x, b.y);
    const inRange = BilliardsTable.ellInRange(e, thRaw);
    const thN = inRange ? thRaw : BilliardsTable.ellNearestClamped(e, b.x, b.y);
    const qN = BilliardsTable.ellPoint(e, thN);
    const sc = Math.hypot((b.x - e.cx) / e.ax, (b.y - e.cy) / e.by);
    const wrongSide = inRange && ((e.side === 'in') ? (sc > 1) : (sc < 1));
    if (wrongSide || Math.hypot(b.x - qN.x, b.y - qN.y) < b.r) {
      const i = ellInward(e, thN);
      if (b.vx * i.x + b.vy * i.y < 0) return 0;
    }

    const G = th => {
      const c = ellOffsetPoint(e, th, b.r);
      return (c.x - b.x) * b.vy - (c.y - b.y) * b.vx;
    };
    // 凸な曲線に直線を当てるので、交わるのは多くて2か所。刻みは粗くてよい
    const M = Math.max(12, Math.ceil(Math.abs(e.sweep) / (2 * Math.PI) * 64));
    let best = Infinity;
    let thA = e.t0, gA = G(thA);
    for (let i = 1; i <= M; i++) {
      const thB = e.t0 + e.sweep * i / M, gB = G(thB);
      if ((gA < 0) !== (gB < 0)) {
        let lo = thA, hi = thB, gl = gA;
        for (let k = 0; k < 40; k++) {
          const m = (lo + hi) / 2, gm = G(m);
          if ((gl < 0) !== (gm < 0)) hi = m; else { lo = m; gl = gm; }
        }
        const th = (lo + hi) / 2;
        const c = ellOffsetPoint(e, th, b.r);
        const t = ((c.x - b.x) * b.vx + (c.y - b.y) * b.vy) / A;
        if (t >= -1e-7 && t <= tmax) {
          const tt = t < 0 ? 0 : t;
          const iw = ellInward(e, th);
          if (tt < best && b.vx * iw.x + b.vy * iw.y < 0) best = tt;
        }
      }
      thA = thB; gA = gB;
    }
    return best;
  }

  function timeBallRail(b, s, tmax) {
    if (s.kind === 'arc') return timeBallArc(b, s, tmax);
    if (s.kind === 'ell') return timeBallEll(b, s, tmax);
    return timeBallSeg(b, s, tmax);
  }

  // ───────── 衝突の解決 ─────────
  function resolveBallBall(w, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    let d = Math.hypot(dx, dy, dz);
    if (d < EPS) d = EPS;
    const n = v3(dx / d, dy / d, dz / d);
    const rvx = a.vx - b.vx, rvy = a.vy - b.vy, rvz = a.vz - b.vz;
    const vn = rvx * n.x + rvy * n.y + rvz * n.z;
    if (vn <= 0) return null;

    const e = Math.min(a.e, b.e);
    const invM = 1 / a.m + 1 / b.m;
    const jn = (1 + e) * vn / invM;
    a.vx -= jn * n.x / a.m; a.vy -= jn * n.y / a.m; a.vz -= jn * n.z / a.m;
    b.vx += jn * n.x / b.m; b.vy += jn * n.y / b.m; b.vz += jn * n.z / b.m;

    // 接触点の相対滑り → 摩擦力積。これがスロー効果とスピン転写の正体（5.6.3節）
    const ra = v3(n.x * a.r, n.y * a.r, n.z * a.r);
    const rb = v3(-n.x * b.r, -n.y * b.r, -n.z * b.r);
    const wa = cross(v3(a.wx, a.wy, a.wz), ra);
    const wb = cross(v3(b.wx, b.wy, b.wz), rb);
    let sx = (a.vx + wa.x) - (b.vx + wb.x);
    let sy = (a.vy + wa.y) - (b.vy + wb.y);
    let sz = (a.vz + wa.z) - (b.vz + wb.z);
    const sn = sx * n.x + sy * n.y + sz * n.z;
    sx -= sn * n.x; sy -= sn * n.y; sz -= sn * n.z;
    const sl = Math.hypot(sx, sy, sz);
    if (sl > 1e-6) {
      const Ia = inertia(a), Ib = inertia(b);
      const kEff = invM + (a.r * a.r) / Ia + (b.r * b.r) / Ib;
      const jtStop = sl / kEff;
      const jt = Math.min(BALL_MU * jn, jtStop);
      const tx = -sx / sl * jt, ty = -sy / sl * jt, tz = -sz / sl * jt;
      // 並進側＝スロー効果。回転側＝スピン転写。独立にON/OFFできる（5.10.3節）
      if (w.tuning.throwEffect) {
        a.vx += tx / a.m; a.vy += ty / a.m; a.vz += tz / a.m;
        b.vx -= tx / b.m; b.vy -= ty / b.m; b.vz -= tz / b.m;
      }
      if (w.tuning.spinTransfer) {
        const ta = cross(ra, v3(tx, ty, tz));
        const tb = cross(v3(-rb.x, -rb.y, -rb.z), v3(tx, ty, tz));
        a.wx += ta.x / Ia; a.wy += ta.y / Ia; a.wz += ta.z / Ia;
        b.wx += tb.x / Ib; b.wy += tb.y / Ib; b.wz += tb.z / Ib;
      }
    }
    // わずかに離して二重解決を防ぐ
    const overlap = (a.r + b.r) - d;
    if (overlap > 0) {
      const push = overlap / 2 + 1e-4;
      a.x -= n.x * push; a.y -= n.y * push; a.z -= n.z * push;
      b.x += n.x * push; b.y += n.y * push; b.z += n.z * push;
    }
    return { speed: Math.abs(vn) };
  }

  function nearestOnSeg(s, px, py) {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    const l2 = ex * ex + ey * ey;
    let t = l2 < EPS ? 0 : ((px - s.x1) * ex + (py - s.y1) * ey) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: s.x1 + ex * t, y: s.y1 + ey * t };
  }

  /** 円弧の上で、その点にいちばん近い場所。範囲の外なら近いほうの端へ寄せる */
  function nearestOnArc(a, px, py) {
    let dx = px - a.cx, dy = py - a.cy;
    const d = Math.hypot(dx, dy);
    if (d < EPS) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    let ang = Math.atan2(dy, dx);
    const off = norm2pi(ang - a.a0);
    if (off > a.sweep) {
      // 端からの隔たりが小さいほうへ。円弧の外側は 2π − sweep ぶんある
      ang = (off - a.sweep) * 2 < (2 * Math.PI - a.sweep) ? a.a0 + a.sweep : a.a0;
    }
    return { x: a.cx + Math.cos(ang) * a.r, y: a.cy + Math.sin(ang) * a.r };
  }

  /**
   * クッションの上で、その点にいちばん近い場所。
   * 跳ね返りの向きは「玉の中心から見て、そこがどちら側か」で決まるので、
   * 直線でも円弧でも、この1点さえ出れば反射の計算は同じもので済む。
   */
  function nearestOnRail(s, px, py) {
    if (s.kind === 'arc') return nearestOnArc(s, px, py);
    if (s.kind === 'ell') return BilliardsTable.ellPoint(s, BilliardsTable.ellNearestClamped(s, px, py));
    return nearestOnSeg(s, px, py);
  }

  function resolveBallRail(w, b, s) {
    const p = nearestOnRail(s, b.x, b.y);
    let nx = b.x - p.x, ny = b.y - p.y;
    let d = Math.hypot(nx, ny);
    if (d < EPS) { nx = 1; ny = 0; d = 1; }
    nx /= d; ny /= d;

    /*
     * ★円弧の壁では、台の内側がどちらかを**玉の居場所から決めてはいけない。**
     *
     * 円弧に沿って走る玉は接線方向へ進むだけで外へ膨らむので、
     * わずかに壁の外側へ出た状態でここへ来ることがある。
     * そのとき玉の居場所から向きを取ると「外向きこそ台の内側」と読んでしまい、
     * 押し戻す代わりに玉を台の外へ送り出す。
     * 円弧は中心と side を持っているので、**内側を向く向きは形から決まる。**
     * 玉が円弧の範囲の外にいるとき（端が最寄り＝角に当たる形）だけは、
     * 中心から見た向きが接触の向きと一致しないので、従来どおり玉の側から決める。
     */
    if (s.kind === 'arc') {
      const rx = p.x - s.cx, ry = p.y - s.cy, rl = Math.hypot(rx, ry);
      if (rl > EPS && norm2pi(Math.atan2(b.y - s.cy, b.x - s.cx) - s.a0) <= s.sweep) {
        const sgn = s.side === 'in' ? -1 : 1;
        nx = sgn * rx / rl; ny = sgn * ry / rl;
      }
    } else if (s.kind === 'ell') {
      const raw = BilliardsTable.ellNearestParam(s, b.x, b.y);
      if (BilliardsTable.ellInRange(s, raw)) {            // 端が最寄り（角）でなければ形から決める
        const n = ellInward(s, raw);
        nx = n.x; ny = n.y;
      }
    }

    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return null;

    // クッションに寄りかかっているだけの状態。ここで反発を返すと
    // 「当たっては戻る」を延々と繰り返し、玉が止まらず衝突音も鳴り続ける。
    // 押し戻すだけにして、出来事としては数えない。
    if (-vn < 25) {
      b.vx -= vn * nx; b.vy -= vn * ny;
      b.x = p.x + nx * (b.r + 1e-3);
      b.y = p.y + ny * (b.r + 1e-3);
      return null;
    }

    const table = w.table;
    const speed = Math.hypot(b.vx, b.vy);
    const tx = -ny, ty = nx;                 // 接線
    let vt = b.vx * tx + b.vy * ty;

    /*
     * 壁ズリ（5.7.3節）：浅い角度で強く入った玉は跳ね返らずに沿って走る。
     *
     * **曲面のクッションでは走行距離に上限を設ける（D29）。**
     * 直線の壁なら、沿って走る玉は壁が終われば自然に離れる。
     * ところが曲面では、沿わせた玉が接線方向へ進むとすぐまた壁へ食い込むので、
     * 離れる契機を自分では持たない。上限が無ければ玉は台の縁を回り続ける。
     *
     * 上限は**外周の 1/4**とする（スタジアムで約 1632 mm）。台の大きさに合わせて
     * 動くように外周から出す ── 形ごとに数値を並べると台を足したときに書き忘れる。
     * **この値は仕様書に無い**（5.7.3節は「上限を設ける」とだけ定める）。
     *
     * 走った長さは、前に沿わせた場所からの距離を足していく。
     * 玉の直径2つぶんより遠くから来たときは、いったん離れて戻ってきたのだから
     * 別の走りとして数え直す。
     */
    const incidence = Math.abs(Math.atan2(vn, Math.abs(vt)));   // 0 に近いほど浅い
    if (w.tuning.wallSlide && speed > 1400 && incidence < 0.21) {
      const curved = (s.kind === 'arc' || s.kind === 'ell');
      let run = 0;
      if (curved) {
        const gap = (b.slideX == null) ? Infinity : Math.hypot(b.x - b.slideX, b.y - b.slideY);
        run = (gap > 4 * b.r) ? 0 : b.slideRun + gap;
        b.slideRun = run; b.slideX = b.x; b.slideY = b.y;
      }
      const cap = w.table.perimeter ? w.table.perimeter / 4 : Infinity;
      if (!curved || run < cap) {
        b.vx = tx * vt; b.vy = ty * vt;      // 法線成分を殺して沿わせる
        b.x = p.x + nx * (b.r + 1e-3);
        b.y = p.y + ny * (b.r + 1e-3);
        return { speed: Math.abs(vn), slide: true };
      }
      /*
       * 上限に達した。沿わせるのをやめ、下の反射へ落とす（＝接線方向へ離脱する）。
       * **走った長さはここで 0 に戻さない。**戻すと次の接触でまた沿い始めてしまい、
       * ひと突きぶんの周回はまったく短くならない。
       * 数え直すのは、玉が壁から離れたと分かったとき（上の gap の判定）だけにする。
       */
    }

    if (!w.tuning.cushionSpin) {
      // 素直な反射（設定OFF）。回転は触らない
      b.vx -= (1 + table.cushionRestitution) * vn * nx;
      b.vy -= (1 + table.cushionRestitution) * vn * ny;
    } else {
      const e = table.cushionRestitution;
      const jn = b.m * (1 + e) * (-vn);
      b.vx += jn * nx / b.m;
      b.vy += jn * ny / b.m;
      // 接線方向の滑り。サイドスピンが接触点を横へ擦る
      const I = inertia(b);
      const slip = vt - b.r * b.wz;
      const jtStop = slip * b.m / (1 + (b.m * b.r * b.r) / I);
      const jt = -Math.sign(slip) * Math.min(0.22 * jn, Math.abs(jtStop));
      b.vx += jt * tx / b.m;
      b.vy += jt * ty / b.m;
      b.wz += (-b.r * jt) / I;
      // 縦回転はクッションとの摩擦で少し削られる（向きの反転は速度が返ることで自然に起きる）
      b.wx *= 0.82; b.wy *= 0.82;
    }
    b.x = p.x + nx * (b.r + 1e-3);
    b.y = p.y + ny * (b.r + 1e-3);
    return { speed: Math.abs(vn) };
  }

  // ───────── 回転の見た目（クォータニオン積分） ─────────
  function spinVisual(b, dt) {
    const wl = Math.hypot(b.wx, b.wy, b.wz);
    if (wl < 1e-4) return;
    const ang = wl * dt * 0.5;
    const s = Math.sin(ang) / wl, c = Math.cos(ang);
    const dx = b.wx * s, dy = b.wy * s, dz = b.wz * s;
    const nw = c * b.qw - dx * b.qx - dy * b.qy - dz * b.qz;
    const nx = c * b.qx + dx * b.qw + dy * b.qz - dz * b.qy;
    const ny = c * b.qy - dx * b.qz + dy * b.qw + dz * b.qx;
    const nz = c * b.qz + dx * b.qy - dy * b.qx + dz * b.qw;
    const n = Math.hypot(nw, nx, ny, nz) || 1;
    b.qw = nw / n; b.qx = nx / n; b.qy = ny / n; b.qz = nz / n;
  }

  // ───────── 1ステップ進める ─────────
  function step(w) {
    const table = w.table;
    const live = w.balls.filter(b => b.state === 'live');
    let remaining = DT;
    let guard = 0;
    // 解こうとしたが実際には接近していなかった組。同じステップの中で数え直さない。
    // これを持たないと、既に重なっている組が毎回 t=0 の候補として出続け、
    // 時刻が1ステップぶんも進まないまま打ち切られる（玉が固まって見える）。
    const declined = new Set();

    while (remaining > 1e-12 && guard++ < 48) {
      let tMin = remaining, hit = null, key = null;

      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const k = 'b' + live[i].id + '_' + live[j].id;
          if (declined.has(k)) continue;
          const t = timeBallBall(live[i], live[j], tMin);
          if (t < tMin - 1e-12) { tMin = t; hit = { kind: 'bb', a: live[i], b: live[j] }; key = k; }
        }
      }
      for (const b of live) {
        if (b.z - 0 > table.cushionTop - b.r) continue;   // クッションを越えている（5.8.4節）
        for (let si = 0; si < table.rails.length; si++) {
          const k = 'r' + b.id + '_' + si;
          if (declined.has(k)) continue;
          const t = timeBallRail(b, table.rails[si], tMin);
          if (t < tMin - 1e-12) { tMin = t; hit = { kind: 'rail', a: b, s: table.rails[si] }; key = k; }
        }
      }

      // 位置を進める（この区間では速度は一定）
      for (const b of live) {
        b.x += b.vx * tMin; b.y += b.vy * tMin; b.z += b.vz * tMin;
        spinVisual(b, tMin);
      }
      remaining -= tMin;

      if (hit) {
        let r;
        if (hit.kind === 'bb') {
          r = resolveBallBall(w, hit.a, hit.b);
          if (r) w.events.push({ type: 'hit', a: hit.a.id, b: hit.b.id, speed: r.speed, tick: w.tick });
        } else {
          r = resolveBallRail(w, hit.a, hit.s);
          // 当たった場所も載せる。「台のどのあたりの壁に当たったか」を
          // 見たい側（バンキングの成立判定）が、あとから知る手立てを持たないため
          if (r) w.events.push({ type: 'cushion', ball: hit.a.id, x: hit.a.x, y: hit.a.y, speed: r.speed, slide: !!r.slide, tick: w.tick });
        }
        if (!r && key) declined.add(key);
      }
    }

    // 摩擦・重力（ステップ全体ぶんをまとめて反映）
    for (const b of live) {
      applyFriction(b, table, DT);
      // 着地（5.8.3節）
      if (b.z < 0) {
        b.z = 0;
        if (b.vz < 0) {
          const bounce = -b.vz * table.clothRestitution;
          b.vz = bounce > 120 ? bounce : 0;
          // 着地した場所も添える。画面側がそこへ弾ける絵を出すため
          if (bounce > 200) w.events.push({ type: 'land', ball: b.id, speed: bounce, x: b.x, y: b.y, tick: w.tick });
        }
      }
      // 停止判定（5.5.5節）
      if (b.z <= 0.01) {
        const sp = Math.hypot(b.vx, b.vy);
        const wl = Math.hypot(b.wx, b.wy, b.wz);
        if (sp < STOP_V && wl < STOP_W) { b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; }
      }
    }

    // ポケット・場外の判定
    for (const b of live) {
      if (b.state !== 'live') continue;
      if (b.z <= b.r * 0.6) {
        let dropped = false;
        for (const p of table.pockets) {
          if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
            b.state = 'pocketed'; b.onTable = false;
            b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
            w.events.push({ type: 'pocket', ball: b.id, pocket: p.id, tick: w.tick });
            dropped = true; break;
          }
        }
        if (dropped) continue;
      }
      // 台の内外は外周（台定義データ）から見る。外接矩形で見ると六角形以降で
      // 「壁は六角形なのに場外は長方形で数える」ことになり、角の外に玉が残る。
      const clear = BilliardsTable.clearance(table, b.x, b.y);   // 内側が正・外側が負
      if (clear < -b.r * 0.2 && b.z <= 0.01) {
        // 台面の外へ着地した＝場外（5.8.5節・5.8.7節）
        b.state = 'off'; b.onTable = false;
        b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        w.events.push({ type: 'offtable', ball: b.id, tick: w.tick });
      } else if (clear < -900) {
        b.state = 'off'; b.onTable = false;
        b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        w.events.push({ type: 'offtable', ball: b.id, tick: w.tick });
      }
    }

    w.tick++;

    /*
     * 刻みごとの通知。**エンジンはこれが何に使われるかを知らない。**
     * 陣取り（G-06）は玉が通ったマスを塗るので、玉の位置を刻みごとに見る必要がある。
     *
     * ★呼び出す側で数え上げると必ず漏れる。**盤面を進める道は5本ある**
     *   （主ループ・演出無しの一気走らせ・観戦者の追いつき・リプレイ・AIの読み）。
     * どれか1本に書き忘れれば、その道を通ったぶんだけ塗りが消える。
     * ここに置けば、盤面が1刻み進むところは必ずこの1行を通る。
     *
     * **cloneWorld はこの通知を引き継がない。**AIの読みは複製の上で走るので、
     * 引き継ぐと読むたびに本物の塗りが増える。
     */
    if (w.onAdvance) w.onAdvance(w);
  }

  function allStopped(w) {
    for (const b of w.balls) {
      if (b.state !== 'live') continue;
      if (b.z > 0.01) return false;
      if (Math.hypot(b.vx, b.vy, b.vz) > 0) return false;
    }
    return true;
  }

  /**
   * ショットを最後まで解く（AIの読みやリプレイで使う）。
   * @param {number} maxSeconds 打ち切り時間（安全弁）
   */
  function runShot(w, maxSeconds, onStep) {
    const limit = Math.round((maxSeconds || 20) / DT);
    for (let i = 0; i < limit; i++) {
      step(w);
      if (onStep && onStep(w, i) === false) return i;
      if (allStopped(w)) return i;
    }
    return limit;
  }

  /** 手玉が最初に当たる相手を幾何で求める（エイムライン用。4.6.3節の幾何計算側） */
  function firstContact(w, cue, dir, maxLen) {
    const dx = Math.cos(dir), dy = Math.sin(dir);
    let best = { dist: maxLen || 6000, type: 'none', ball: null, point: null, normal: null };
    for (const b of w.balls) {
      if (b === cue || b.state !== 'live') continue;
      const ex = b.x - cue.x, ey = b.y - cue.y;
      const proj = ex * dx + ey * dy;
      if (proj <= 0) continue;
      const perp2 = (ex * ex + ey * ey) - proj * proj;
      const rr = cue.r + b.r;
      if (perp2 > rr * rr) continue;
      const d = proj - Math.sqrt(rr * rr - perp2);
      if (d > 0 && d < best.dist) {
        best = { dist: d, type: 'ball', ball: b, point: { x: cue.x + dx * d, y: cue.y + dy * d } };
      }
    }
    for (const s of w.table.rails) {
      if (s.kind === 'arc') {
        // 円弧の壁。中心からの距離が reff になる点が接触点（速さ1で進むので時間＝距離）
        const reff = s.side === 'in' ? s.r - cue.r : s.r + cue.r;
        if (reff <= EPS) continue;
        const qx = cue.x - s.cx, qy = cue.y - s.cy;
        const B = 2 * (qx * dx + qy * dy);
        const disc = B * B - 4 * (qx * qx + qy * qy - reff * reff);
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const roots = [(-B - sq) / 2, (-B + sq) / 2];
        for (let ri = 0; ri < 2; ri++) {
          const t = roots[ri];
          if (t <= 0 || t >= best.dist) continue;
          let nx = cue.x + dx * t - s.cx, ny = cue.y + dy * t - s.cy;
          const nl = Math.hypot(nx, ny); if (nl < EPS) continue;
          nx /= nl; ny /= nl;
          if (norm2pi(Math.atan2(ny, nx) - s.a0) > s.sweep) continue;
          if (s.side === 'in') { nx = -nx; ny = -ny; }
          if (dx * nx + dy * ny >= 0) continue;
          best = { dist: t, type: 'rail', ball: null, point: { x: cue.x + dx * t, y: cue.y + dy * t }, normal: { x: nx, y: ny } };
          break;
        }
        continue;
      }
      if (s.kind === 'ell') {
        /*
         * 楕円弧は当たり判定とまったく同じ解き方を使う。
         * 速さ1で進ませれば「当たるまでの時間」がそのまま距離になる。
         * ★ここを直線として読むと、存在しない端の座標を見て NaN になり、
         *   **先に見つけた玉の当たりまで NaN で上書きされて**エイムラインが消える。
         */
        const probe = { x: cue.x, y: cue.y, r: cue.r, vx: dx, vy: dy };
        const t = timeBallEll(probe, s, best.dist);
        if (t > 0 && t < best.dist) {
          const px = cue.x + dx * t, py = cue.y + dy * t;
          const iw = ellInward(s, BilliardsTable.ellNearestClamped(s, px, py));
          best = { dist: t, type: 'rail', ball: null, point: { x: px, y: py }, normal: { x: iw.x, y: iw.y } };
        }
        continue;
      }
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
      const el = Math.hypot(ex, ey); if (el < EPS) continue;
      const ux = ex / el, uy = ey / el, nx = -uy, ny = ux;
      const rel = { x: cue.x - s.x1, y: cue.y - s.y1 };
      const nPos = rel.x * nx + rel.y * ny;
      const nVel = dx * nx + dy * ny;
      if (Math.abs(nVel) < EPS) continue;
      const target = nPos > 0 ? cue.r : -cue.r;
      const t = (target - nPos) / nVel;
      if (t <= 0 || t >= best.dist) continue;
      const sp = (rel.x * ux + rel.y * uy) + (dx * ux + dy * uy) * t;
      if (sp < 0 || sp > el) continue;
      best = { dist: t, type: 'rail', ball: null, point: { x: cue.x + dx * t, y: cue.y + dy * t }, normal: { x: nPos > 0 ? nx : -nx, y: nPos > 0 ? ny : -ny } };
    }
    // ポケットの口へ抜けるか
    for (const p of w.table.pockets) {
      const ex = p.x - cue.x, ey = p.y - cue.y;
      const proj = ex * dx + ey * dy;
      if (proj <= 0) continue;
      const perp2 = (ex * ex + ey * ey) - proj * proj;
      if (perp2 > p.r * p.r) continue;
      const d = proj - Math.sqrt(p.r * p.r - perp2);
      if (d > 0 && d < best.dist) best = { dist: d, type: 'pocket', ball: null, point: { x: cue.x + dx * d, y: cue.y + dy * d } };
    }
    return best;
  }

  return {
    DT, G, V_MAX, BALL_M, BALL_E,
    makeBall, createWorld, cloneWorld,
    applyCue, isMiscue, step, runShot, allStopped, firstContact,
    contactSlip, nearestOnSeg, nearestOnRail, timeBallRail,
  };
})();

if (typeof window !== 'undefined') window.BilliardsEngine = BilliardsEngine;
