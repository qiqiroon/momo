// MOMO Darts - 物理計算モジュール（SPEC 6章）
// 段階2-E: リアル物理 + 初速スローダウン + 楕円ブレ
//   - レベル2: 重力 + 2乗空気抵抗、オイラー法
//   - ブレ: 角度ノイズ方式（円錐ブレ）+ 楕円分布 + 利き手バイアス
//   - 着弾判定: target 平面 (z = TARGET_DISTANCE) を通過した瞬間
//   - 床落ち: y < -FLOOR_Y で打ち切り（SPEC 6.2 ポロ落とし）

// ======================================================================
// 物理定数（SPEC 6.1）— 実機調整は段階6 で
// ======================================================================
export const G = 9.8;           // 重力加速度 m/s²
export const K_DRAG = 0.001;    // 空気抵抗係数（2乗抵抗）
export const MASS = 0.02;       // ダーツ質量 kg（標準ダーツ 20g）
export const DT = 0.016;        // 時間刻み s（60fps 想定）

// ======================================================================
// ゲーム設定
// ======================================================================
export const TARGET_DISTANCE = 2.5;   // m（プレイヤーから的までの距離）
export const FLOOR_Y = 1.5;           // m（プレイヤー目線から床までの落差）

// 強さ → 初速 [m/s]
// 最弱 (s≈0) でも届かないほど遅く、MAX (s=1) で直線に近い
const SPEED_MIN = 4.0;
const SPEED_MAX = 12.0;

// ブレ（SPEC 6.2、v1.58 で弱側/強側を非対称化）
//   最適強度 (s=0.5) 付近では σ 小、極端な強度では σ 大。
//   弱側 (s<0.5): MAX_WEAK (現状維持)
//   強側 (s>0.5): MAX_STRONG (倍に拡大) — 「全力投擲はリスクが高い」表現
//   楕円: 水平方向の σ を縦方向より少し大きく（指先のブレ）
const BRAKE_SIGMA_BASE_DEG       = 0.4;   // 最適強度時の σ（度）
const BRAKE_SIGMA_MAX_WEAK_DEG   = 3.0;   // s=0 のとき σ
const BRAKE_SIGMA_MAX_STRONG_DEG = 6.0;   // s=1 のとき σ（弱側の倍）
const BRAKE_ELLIPSE_X = 1.3;              // 水平方向の補正
const BRAKE_ELLIPSE_Y = 1.0;              // 垂直方向の補正

// 利き手バイアス（右投げ=左下、左投げ=右下、SPEC 6.2）
//   現状: 右投げ前提 / hand に応じて左右反転
const HAND_BIAS_X_DEG = 0.8;          // 度（利き手側へ）
const HAND_BIAS_Y_DEG = -0.4;         // 度（下方向、-pitch）

// ボタンの 3D 起点（プレイヤーから見たローカル座標、m）
//   ヒップ位置を想定。右投げ/左投げで x が反転
const BUTTON_LOCAL = {
  L: { x: -0.30, y: -0.45, z: 0.85 },
  R: { x:  0.30, y: -0.45, z: 0.85 },
};

// ======================================================================
// ヘルパ
// ======================================================================
function gaussian() {
  // Box-Muller
  let u1 = Math.random();
  let u2 = Math.random();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function getButtonStart(hand) {
  return { ...BUTTON_LOCAL[hand] };
}

// ======================================================================
// メイン: 投擲シミュレーション
//   aimYawRad, aimPitchRad: 投擲時のデバイス角度（=照準方向）。世界座標系。
//   strength: 0〜1
//   hand: 'L' | 'R'
//   戻り値: { trajectory: [{x,y,z,t}...], impact: {x,y,z,t,hit}, duration }
//     impact.hit = true なら target 平面に到達、false なら床落ちまたは時間切れ
// ======================================================================
export function simulateThrow({ aimYawRad, aimPitchRad, strength, hand }) {
  const s = Math.max(0, Math.min(1, strength));

  // 1. 開始位置（ヒップ、デバイス角度で回転）
  //    本来は R_device * BUTTON_LOCAL だが、近似として「現在デバイスが
  //    向いている方向」に対する相対位置として扱う（小角度近似）
  const local = BUTTON_LOCAL[hand] || BUTTON_LOCAL.R;
  // 簡易回転: aimYaw, aimPitch ぶん回転。z 軸はほぼ前向きなので無視
  // → 直感的には「腕がデバイスと一緒に向く」モデル
  const cy = Math.cos(aimYawRad), sy = Math.sin(aimYawRad);
  const cp = Math.cos(aimPitchRad), sp = Math.sin(aimPitchRad);
  // ローカル→ワールド: Y回転 → X回転 を適用（簡易）
  const lx = local.x, ly = local.y, lz = local.z;
  // Y軸回転 (yaw)
  const rx1 = lx * cy + lz * sy;
  const ry1 = ly;
  const rz1 = -lx * sy + lz * cy;
  // X軸回転 (pitch)
  const rx = rx1;
  const ry = ry1 * cp - rz1 * sp;
  const rz = ry1 * sp + rz1 * cp;

  let x = rx;
  let y = ry;
  let z = rz;

  // 2. 照準点（デバイス前方 × TARGET_DISTANCE）
  const aimX = Math.sin(aimYawRad) * Math.cos(aimPitchRad) * TARGET_DISTANCE;
  const aimY = Math.sin(aimPitchRad) * TARGET_DISTANCE;
  const aimZ = Math.cos(aimYawRad) * Math.cos(aimPitchRad) * TARGET_DISTANCE;

  // 3. 投擲方向ベクトル（ボタン → 照準点）
  let dx = aimX - x;
  let dy = aimY - y;
  let dz = aimZ - z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) { dx = 0; dy = 0; dz = 1; }
  else { dx /= len; dy /= len; dz /= len; }

  // 4. ブレ（楕円分布 + 利き手バイアス、SPEC 6.2）
  // v1.58: 弱側/強側で非対称（強側の最大 σ を倍に拡大）
  const offFromOpt = Math.abs(s - 0.5) / 0.5;  // 0 (optimal) → 1 (extreme)
  const maxSideDeg = (s > 0.5) ? BRAKE_SIGMA_MAX_STRONG_DEG : BRAKE_SIGMA_MAX_WEAK_DEG;
  const sigmaDeg = BRAKE_SIGMA_BASE_DEG +
    (maxSideDeg - BRAKE_SIGMA_BASE_DEG) * offFromOpt;
  const sigmaRad = (sigmaDeg * Math.PI) / 180;

  const noiseYaw   = gaussian() * sigmaRad * BRAKE_ELLIPSE_X;
  const noisePitch = gaussian() * sigmaRad * BRAKE_ELLIPSE_Y;

  // 利き手バイアス（右投げは左下に流れる傾向、左投げは右下）
  const biasSign = (hand === 'L') ? +1 : -1;
  const biasYawRad   = (biasSign * HAND_BIAS_X_DEG * Math.PI) / 180;
  const biasPitchRad = (HAND_BIAS_Y_DEG * Math.PI) / 180;

  // 方向ベクトルに小角度ノイズ + バイアスを適用（前方成分が支配的）
  //   小角度近似: 単位ベクトルに yaw/pitch を加算してから再正規化
  dx += (noiseYaw + biasYawRad) * dz;
  dy += (noisePitch + biasPitchRad) * dz;
  const len2 = Math.hypot(dx, dy, dz);
  dx /= len2; dy /= len2; dz /= len2;

  // 5. 初速
  const speed = SPEED_MIN + s * (SPEED_MAX - SPEED_MIN);
  let vx = dx * speed;
  let vy = dy * speed;
  let vz = dz * speed;

  // 6. オイラー積分（2乗抵抗、SPEC 6.1）
  const trajectory = [{ x, y, z, t: 0 }];
  let t = 0;
  let hit = false;
  let stopReason = 'timeout';

  while (t < 3.0) {
    const sp_v = Math.hypot(vx, vy, vz);
    // drag = -k|v|*v ; a = drag/m + g
    const dragFactor = (-K_DRAG * sp_v) / MASS;
    const ax = dragFactor * vx;
    const ay = -G + dragFactor * vy;
    const az = dragFactor * vz;
    const prevZ = z;
    const prevX = x, prevY = y, prevT = t;
    vx += ax * DT;
    vy += ay * DT;
    vz += az * DT;
    x += vx * DT;
    y += vy * DT;
    z += vz * DT;
    t += DT;

    // target 平面到達？
    if (prevZ < TARGET_DISTANCE && z >= TARGET_DISTANCE) {
      // 線形補間で正確な交差点を求める
      const alpha = (TARGET_DISTANCE - prevZ) / (z - prevZ);
      const ix = prevX + alpha * (x - prevX);
      const iy = prevY + alpha * (y - prevY);
      const it = prevT + alpha * (t - prevT);
      x = ix; y = iy; z = TARGET_DISTANCE; t = it;
      trajectory.push({ x, y, z, t });
      hit = true;
      stopReason = 'hit';
      break;
    }

    trajectory.push({ x, y, z, t });

    // 床に落ちた？
    if (y < -FLOOR_Y) {
      stopReason = 'floor';
      break;
    }
    // 後ろに飛んだ？（バグ防止）
    if (z < -0.5) {
      stopReason = 'behind';
      break;
    }
  }

  return {
    trajectory,
    impact: { x, y, z, t, hit, stopReason },
    duration: t,
  };
}

// ======================================================================
// 着弾点から的のローカル座標（中央=原点）を求める
//   targetWorld: { yaw, pitch } 度（的の世界座標角度）
//   impactPoint: 物理シミュ結果の {x, y, z}
//   戻り値: { dxDeg, dyDeg, dxRad, dyRad }（的中心からの角度差）
// ======================================================================
export function impactRelativeToTarget(impactPoint, targetWorldDeg) {
  const yawRad   = Math.atan2(impactPoint.x, impactPoint.z || 0.01);
  const pitchRad = Math.atan2(impactPoint.y, Math.hypot(impactPoint.x, impactPoint.z) || 0.01);
  const yawDeg   = (yawRad   * 180) / Math.PI;
  const pitchDeg = (pitchRad * 180) / Math.PI;
  return {
    dxDeg: yawDeg   - targetWorldDeg.yaw,
    dyDeg: pitchDeg - targetWorldDeg.pitch,
    yawDeg, pitchDeg,
  };
}
