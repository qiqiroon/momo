// MOMO Darts - 3D空間 + 的描画モジュール（SPEC 4章 / 16章）
// なんちゃって 3D = CSS transform + SVG ハイブリッド
// 段階2-C: 3D空間 + 標準ダーツボード SVG + センサー連動 + 視界外方向矢印

import * as Sensor from './darts-sensor.js';
import * as Physics from './darts-physics.js';
import * as Rules from './darts-rules.js';

// ======================================================================
// 設定（実装時調整・段階6 で性能フォールバック含めて最終確定）
// ======================================================================
// v1.14: FOV は固定、ヨー/ピッチ感度は別倍率で調整
const HORIZ_FOV_DEG = 40;           // 仮想視野（固定）— 的の配置範囲計算にのみ使用
let YAW_PITCH_SCALE = 1.0;          // ヨー/ピッチ感度倍率（調整可: 0.5〜2.0）
const TARGET_DIAMETER_RATIO = 0.9;  // 画面横幅 90% に占める基準サイズ
const SHIFT_RADIUS_RATIO = 0.25;    // 直径の 1/4 までシフト
const TILT_SCALE = 0;               // v1.09: 疑似3D傾きをいったん無効化

// センサー軸マッピング（v1.08: 縦持ち専用の正しい対応に修正）
//   縦持ち時:  Yaw=gamma(Y軸回転)  Pitch=beta(X軸回転)  Roll=alpha(Z軸回転)
//   旧 v1.02-v1.07 は alpha と gamma が逆だった
const SIGN_YAW = -1;    // rel.gamma → yawDelta（v1.09 で反転）
const SIGN_PITCH = +1;  // rel.beta → pitchDelta
const SIGN_ROLL = +1;   // rel.alpha → roll (rotateZ)
let ROLL_SCALE = 0.7;   // ロール感度（調整可: 0.3〜1.5）

// ======================================================================
// 標準ダーツボード（SPEC 3.4 / 単一情報源は darts-rules.js）
// ======================================================================
const {
  R_BORDER, R_NUMBERS, R_DOUBLE_OUT, R_DOUBLE_IN,
  R_TRIPLE_OUT, R_TRIPLE_IN, R_OUTER_BULL, R_INNER_BULL,
  SEGMENT_NUMBERS,
} = Rules;

// 標準配色（4色配色 = 黒/赤/緑/白[クリーム]、SPEC 4.5）
const COLOR_BLACK = '#1a1a1a';
const COLOR_CREAM = '#f0e6c8';
const COLOR_RED   = '#d4302a';
const COLOR_GREEN = '#1f7a3a';
const COLOR_BORDER = '#0a0a0a';
const COLOR_NUM_TEXT = '#fafafa';
const COLOR_WIRE = '#888';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 偶数index = 黒胴体, 奇数index = クリーム胴体（20が黒胴体）
const isBlackBody = (i) => i % 2 === 0;

// ======================================================================
// SVG ヘルパ
// ======================================================================
function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function sectorPath(a1Deg, a2Deg, rIn, rOut, fill) {
  const r1 = (a1Deg * Math.PI) / 180;
  const r2 = (a2Deg * Math.PI) / 180;
  const x1 = Math.cos(r1) * rIn,  y1 = Math.sin(r1) * rIn;
  const x2 = Math.cos(r1) * rOut, y2 = Math.sin(r1) * rOut;
  const x3 = Math.cos(r2) * rOut, y3 = Math.sin(r2) * rOut;
  const x4 = Math.cos(r2) * rIn,  y4 = Math.sin(r2) * rIn;
  const largeArc = (a2Deg - a1Deg) > 180 ? 1 : 0;
  return el('path', {
    d: `M ${x1} ${y1} L ${x2} ${y2} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x1} ${y1} Z`,
    fill,
  });
}

// ======================================================================
// ダーツボード SVG 生成
// ======================================================================
function buildDartboardSVG() {
  const vbSize = (R_BORDER + 4) * 2;
  const svg = el('svg', {
    viewBox: `-${R_BORDER + 4} -${R_BORDER + 4} ${vbSize} ${vbSize}`,
  });
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';

  // 外周（数字を載せる黒帯 + 黒縁取り）
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: R_BORDER, fill: COLOR_BORDER }));

  // 20 セグメント本体（インナーシングル + トリプル + アウターシングル + ダブル）
  // v2.05 (v1.5): 各セクタに data-seg-sector + data-orig-fill を付与
  //   クリケットのボード色付け用。元の色に戻せるよう orig-fill を覚えておく
  for (let i = 0; i < 20; i++) {
    const center = -90 + i * 18;
    const a1 = center - 9;
    const a2 = center + 9;
    const segNum = SEGMENT_NUMBERS[i];
    const bb = isBlackBody(i);
    const bodyColor   = bb ? COLOR_BLACK : COLOR_CREAM;
    const tripleColor = bb ? COLOR_GREEN : COLOR_RED;
    const doubleColor = bb ? COLOR_RED   : COLOR_GREEN;

    const innerSingle = sectorPath(a1, a2, R_OUTER_BULL, R_TRIPLE_IN, bodyColor);
    const triple      = sectorPath(a1, a2, R_TRIPLE_IN, R_TRIPLE_OUT, tripleColor);
    const outerSingle = sectorPath(a1, a2, R_TRIPLE_OUT, R_DOUBLE_IN, bodyColor);
    const double_     = sectorPath(a1, a2, R_DOUBLE_IN, R_DOUBLE_OUT, doubleColor);
    [innerSingle, triple, outerSingle, double_].forEach((p) => {
      p.setAttribute('data-seg-sector', String(segNum));
      p.setAttribute('data-orig-fill', p.getAttribute('fill'));
      svg.appendChild(p);
    });
  }

  // セグメント境界の細線（金属ワイヤ風）
  for (let i = 0; i < 20; i++) {
    const a = ((-90 + i * 18 - 9) * Math.PI) / 180;
    const x1 = Math.cos(a) * R_OUTER_BULL;
    const y1 = Math.sin(a) * R_OUTER_BULL;
    const x2 = Math.cos(a) * R_DOUBLE_OUT;
    const y2 = Math.sin(a) * R_DOUBLE_OUT;
    svg.appendChild(el('line', {
      x1, y1, x2, y2,
      stroke: COLOR_WIRE, 'stroke-width': 0.35,
    }));
  }

  // アウターブル(25, 緑) → インナーブル(50, 赤)
  // v2.05: ブルにも data-seg-sector='bull' を付けてクリケット色付け対応
  const outerBull = el('circle', { cx: 0, cy: 0, r: R_OUTER_BULL, fill: COLOR_GREEN, stroke: COLOR_WIRE, 'stroke-width': 0.35 });
  outerBull.setAttribute('data-seg-sector', 'bull');
  outerBull.setAttribute('data-orig-fill', COLOR_GREEN);
  svg.appendChild(outerBull);
  const innerBull = el('circle', { cx: 0, cy: 0, r: R_INNER_BULL, fill: COLOR_RED });
  innerBull.setAttribute('data-seg-sector', 'bull');
  innerBull.setAttribute('data-orig-fill', COLOR_RED);
  svg.appendChild(innerBull);

  // v1.97/v2.05 (v1.5): RTC + クリケット用のセグメント枠線 overlay
  //   通常は stroke=transparent、setSegmentHighlight/setCricketBoard() で着色
  //   fill='none' で内部は元の色のまま、枠線だけ強調
  for (let i = 0; i < 20; i++) {
    const center = -90 + i * 18;
    const a1 = center - 9;
    const a2 = center + 9;
    const segNum = SEGMENT_NUMBERS[i];
    const outline = sectorPath(a1, a2, R_OUTER_BULL, R_DOUBLE_OUT, 'none');
    outline.setAttribute('stroke', 'transparent');
    outline.setAttribute('stroke-width', '2.5');
    outline.setAttribute('data-seg-outline', String(segNum));
    outline.setAttribute('pointer-events', 'none');
    svg.appendChild(outline);
  }
  // v2.05: ブル用の outline (円形、クリケットのブル オープン/クローズ枠用)
  const bullOutline = el('circle', {
    cx: 0, cy: 0, r: R_OUTER_BULL,
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': 2.5,
    'data-seg-outline': 'bull',
    'pointer-events': 'none',
  });
  svg.appendChild(bullOutline);

  // v2.07/v2.08 (v1.5): クリケット用 mark テキスト (15-20 各セグメント + bull)
  //   セグメント中央線 (-90 + i*18) を基準に、左右 4° オフセット
  //   v2.08: 画面の上半分/下半分で「画面上の左 = self」になるよう向きを切替:
  //     - 上半分 (sin(center) <= 0): self = 反時計回り (center - 4)、opp = (center + 4)
  //     - 下半分 (sin(center) >  0): self = 時計回り側 (center + 4)、opp = (center - 4)
  //   これで 15/16/17/19 (下半分) でも self が画面の左、opp が右に表示される
  const CRICKET_MARK_R = R_NUMBERS;
  const CRICKET_TARGET_SEGMENTS = [15, 16, 17, 18, 19, 20];
  CRICKET_TARGET_SEGMENTS.forEach((segNum) => {
    const i = SEGMENT_NUMBERS.indexOf(segNum);
    const center = -90 + i * 18;
    const isLower = Math.sin(center * Math.PI / 180) > 0;
    const selfDeg = isLower ? (center + 4) : (center - 4);
    const oppDeg  = isLower ? (center - 4) : (center + 4);
    const selfRad = selfDeg * Math.PI / 180;
    const oppRad  = oppDeg  * Math.PI / 180;
    const sx = Math.cos(selfRad) * CRICKET_MARK_R;
    const sy = Math.sin(selfRad) * CRICKET_MARK_R;
    const ox = Math.cos(oppRad)  * CRICKET_MARK_R;
    const oy = Math.sin(oppRad)  * CRICKET_MARK_R;
    const baseAttrs = {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': "'Fredoka One', 'Noto Sans JP', sans-serif",
      'font-size': 7,
      'font-weight': 'bold',
      stroke: '#000',
      'stroke-width': 0.6,
      'paint-order': 'stroke fill',
      'pointer-events': 'none',
    };
    const selfT = el('text', { ...baseAttrs, x: sx, y: sy, fill: '#ea580c',
                                'data-cricket-mark': 'self', 'data-cricket-seg': String(segNum) });
    svg.appendChild(selfT);
    const oppT  = el('text', { ...baseAttrs, x: ox, y: oy, fill: '#f3f4f6',
                                'data-cricket-mark': 'opp',  'data-cricket-seg': String(segNum) });
    svg.appendChild(oppT);
  });
  // bull の左右にマーク (中央 y=0、x= ±15 アウターブル R=9.4 の少し外)
  {
    const bullAttrs = {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': "'Fredoka One', 'Noto Sans JP', sans-serif",
      'font-size': 7,
      'font-weight': 'bold',
      stroke: '#000',
      'stroke-width': 0.6,
      'paint-order': 'stroke fill',
      'pointer-events': 'none',
    };
    const bSelf = el('text', { ...bullAttrs, x: -15, y: 0, fill: '#ea580c',
                                'data-cricket-mark': 'self', 'data-cricket-seg': 'bull' });
    svg.appendChild(bSelf);
    const bOpp  = el('text', { ...bullAttrs, x: 15, y: 0, fill: '#f3f4f6',
                                'data-cricket-mark': 'opp',  'data-cricket-seg': 'bull' });
    svg.appendChild(bOpp);
  }

  // 数字（黒帯の上、白文字）
  for (let i = 0; i < 20; i++) {
    const center = -90 + i * 18;
    const rad = (center * Math.PI) / 180;
    const tx = Math.cos(rad) * R_NUMBERS;
    const ty = Math.sin(rad) * R_NUMBERS;
    const t = el('text', {
      x: tx, y: ty,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: COLOR_NUM_TEXT,
      'font-family': "'Fredoka One', 'Noto Sans JP', sans-serif",
      'font-size': 11,
    });
    t.textContent = String(SEGMENT_NUMBERS[i]);
    svg.appendChild(t);
  }

  return svg;
}

// ======================================================================
// モジュール状態
// ======================================================================
let _viewEl = null;
let _sceneEl = null;   // 壁 + 的を含むシーン（センサーで一体 transform）
let _boardEl = null;
let _arrowEl = null;
let _debugCallback = null;
let _animFrameId = null;
let _targetWorld = { yaw: 0, pitch: 0 };  // ワールド座標での的中心角度（度）

// v1.21: 飛行中ダーツの状態（null = 飛行なし）
let _flight = null;   // { trajectory, impact, startTime, onComplete }
let _currentTrail = [];  // v1.85 (v1.2): 投擲中の 2D 軌跡 [{ x, y }, ...]、SPEC 7.2
// v1.21: 最新のスムージング済み角度（getCurrentAim 用、tick で更新）
let _lastYawDeg = 0, _lastPitchDeg = 0;

// v1.10: low-pass filter（センサー値の jitter / cross-axis ノイズ抑制）
let SMOOTH_FACTOR = 0.4;  // 0=止まる, 1=フィルタ無し（調整可: 0.1〜1.0）
let _smoothRel = { alpha: 0, beta: 0, gamma: 0 };

// ======================================================================
// ログバッファ
//   - samples: 直近 5 秒のセンサーサンプル（10Hz）
//   - events:  直近 N 個の投擲イベント（shot/score/impact）
// ======================================================================
const LOG_INTERVAL_MS = 100;   // 10 Hz でサンプリング
const LOG_DURATION_MS = 5000;  // 直近 5 秒
const LOG_BUFFER_SIZE = LOG_DURATION_MS / LOG_INTERVAL_MS;
const EVENT_BUFFER_SIZE = 30;  // 直近 30 イベント（= 10 ターン分）
let _logBuffer = [];
let _eventBuffer = [];
let _lastLogTime = 0;
let _startTime = 0;

// ======================================================================
// 的の配置（SPEC 4.4：FOV ハード制限 + 毎ターン直径 1/4 ランダムシフト）
// v2.00 (v1.5): キャリブ正面 (yaw=0, pitch=0) を中心にランダム配置する方式に統一
//   旧 v1.45〜v1.63: 上下方向は「現在の端末ピッチ」を中心にしていた
//   → 「最初の 0 位置調整 (キャリブ) で決めた位置を中心に」変更 (ユーザー指示)
//   キャリブ後にユーザーが歯車設定の「0リセット再実行」で再設定した場合も、
//   その新しい正面が中心になる
// ======================================================================
const PITCH_MIN_DEG = -15;   // 弱投擲でも 2.5m に届く下限
const PITCH_MAX_DEG = 25;    // 上向き極端ドリフト対策
export function placeTargetForTurn() {
  const targetAngularDiameter = HORIZ_FOV_DEG * TARGET_DIAMETER_RATIO;
  const maxShift = targetAngularDiameter * SHIFT_RADIUS_RATIO;  // 直径の 1/4 まで
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * maxShift;
  const yawShift   = Math.cos(angle) * r;
  const pitchShift = Math.sin(angle) * r;
  // yaw ハード制限（キャリブ正面基準で FOV の半分以内）
  const half = HORIZ_FOV_DEG / 2;
  // pitch ハード制限（物理で届く範囲、上向き/下向き過ぎ抑制）
  // v2.00: キャリブ正面 (pitch=0) を中心に
  _targetWorld = {
    yaw:   Math.max(-half, Math.min(half, yawShift)),
    pitch: Math.max(PITCH_MIN_DEG, Math.min(PITCH_MAX_DEG, pitchShift)),
  };
  // v1.21: ターン進行時に着弾マークをクリア（履歴は段階2-F 以降で実装）
  clearImpactMarks();
  // v1.81 (v1.1): 残っている振動演出があれば停止（前ターンの振動がターン進行で残らないように）
  stopTargetVibrate();
}

// ======================================================================
// 視覚的振動演出（v1.81 / SPEC 7.3 v1.1 で本体仕様に昇格、v1.83 押し込み物理風）
// ======================================================================
//   - 振幅 12 度 / 周波数 6 Hz / 減衰係数 0.1^t / 1.2 秒（SPEC 7.3）
//   - 支点 = 円盤の上端中央（20 の数字の上、SVG ローカル (0, -R_BORDER)）固定
//   - 物理モデル: 当たり位置に z 方向（奥行き）の衝撃 → 上端を固定したまま当たり位置が奥に
//     沈み込む。回転軸は支点と当たり位置を結ぶ線(PH)の **円盤面内垂直方向**。
//     つまり PH が長いほど振幅大（てこの長さ）、PH の向きで振動軸が決まる:
//       * 真下当たり (20 直下を超えて中心〜下まで)  → PH ≈ Y 軸 → 軸 ≈ X 軸 → 前後にお辞儀
//       * 真上当たり (20 直下、支点直近)            → PH ≈ 0  → ほぼ振動なし
//       * 右当たり (6 / 11 寄り)                     → PH 斜め → 斜め軸まわり、右が奥にねじれる
//   - CSS の rotate3d(rx, ry, 0, θ) で実装。perspective(600px) で 3D 効果可視化
//   - 強さ連動: 0〜最適範囲上限 (0.56) は無振動、超過量に比例して振幅増
let _vibrateAnimId = null;
export function startTargetVibrate(strength, impactBoard) {
  if (!_boardEl) return;
  // 強さ閾値（Sound.playVibrate と同じ）
  const VIBRATE_THRESHOLD = 0.56;
  if (typeof strength !== 'number' || strength <= VIBRATE_THRESHOLD) return;

  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  if (_vibrateAnimId) cancelAnimationFrame(_vibrateAnimId);

  const intensity = Math.min(1, (strength - VIBRATE_THRESHOLD) / (1 - VIBRATE_THRESHOLD));
  const MAX_AMP_DEG = 12;
  const FREQ_HZ     = 6;
  const DECAY_BASE  = 0.1;
  const DURATION_MS = 1200;

  // 支点 (0, -R_BORDER) から当たり位置への振り子の腕ベクトル PH
  let leverX = 0, leverY = 0;
  if (impactBoard) {
    leverX = impactBoard.x;                  // -R 〜 +R
    leverY = impactBoard.y + R_BORDER;       // 0 〜 2R（支点真上は 0）
  }
  const leverLen = Math.hypot(leverX, leverY);
  // てこ長さスケール（最大は対角 sqrt(R^2 + (2R)^2) ≈ 2.236R、それで割って 0〜1）
  const leverScale = Math.min(1, leverLen / (R_BORDER * Math.sqrt(5)));
  const amp = MAX_AMP_DEG * intensity * leverScale;
  // 振動軸 = PH に円盤面内で垂直な方向（XY 平面内）
  //   PH = (leverX, leverY) を 90度回転 → (leverY, -leverX)、正規化
  //   leverLen が小さい時(中心当たり、しかも支点真下)は軸不定→無振動でOK
  let rx = 1, ry = 0;
  if (leverLen > 0.001) {
    rx = leverY / leverLen;
    ry = -leverX / leverLen;
  }

  // 支点を上端中央に
  svg.style.transformOrigin = '50% 0%';

  const start = performance.now();
  function step(now) {
    const t = (now - start) / 1000;
    if (t >= DURATION_MS / 1000) {
      svg.style.transform = '';
      svg.style.transformOrigin = '';
      _vibrateAnimId = null;
      return;
    }
    const decay = Math.pow(DECAY_BASE, t);
    const phase = 2 * Math.PI * FREQ_HZ * t;
    const angle = amp * Math.sin(phase) * decay;
    // 任意軸まわりの 3D 回転で「押し込み振動」を表現
    svg.style.transform = `perspective(600px) rotate3d(${rx}, ${ry}, 0, ${angle}deg)`;
    _vibrateAnimId = requestAnimationFrame(step);
  }
  _vibrateAnimId = requestAnimationFrame(step);
}

export function stopTargetVibrate() {
  if (_vibrateAnimId) {
    cancelAnimationFrame(_vibrateAnimId);
    _vibrateAnimId = null;
  }
  if (_boardEl) {
    const svg = _boardEl.querySelector('svg');
    if (svg) {
      svg.style.transform = '';
      svg.style.transformOrigin = '';
    }
  }
}

// v1.85 (v1.2): 紙吹雪演出（SPEC 7章 / 10.5、勝利時のみ）
//   - body 直下に #confetti-overlay を作って粒子を spawn
//   - 既定 30 個、性能フォールバック段階4 では 15 個 (_confettiSimplified)
//   - 各粒子は CSS animation で 3〜5 秒かけて落下 + 回転 + 横揺れ
//   - animation 終了後に自動 remove、全粒子終了後 overlay も remove
const CONFETTI_COLORS = ['#ea580c', '#fb923c', '#fdba74', '#fafafa', '#fda4af', '#fcd34d'];
export function startConfetti() {
  // 既存の overlay があれば残骸として remove
  let overlay = document.getElementById('confetti-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'confetti-overlay';
  document.body.appendChild(overlay);

  const count = _confettiSimplified ? 15 : 30;
  const w = window.innerWidth;
  let remaining = count;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const startX = Math.random() * w;
    const driftX = (Math.random() - 0.5) * w * 0.6;  // 横揺れ ±30% 画面幅
    const rotDeg = 360 + Math.random() * 720;
    const duration = 3 + Math.random() * 2;          // 3〜5秒
    const delay = Math.random() * 0.4;               // 0〜400ms 遅延でばらつき
    piece.style.left = `${startX}px`;
    piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.setProperty('--cf-x', `${driftX.toFixed(0)}px`);
    piece.style.setProperty('--cf-rot', `${rotDeg.toFixed(0)}deg`);
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;
    piece.addEventListener('animationend', () => {
      piece.remove();
      remaining--;
      if (remaining <= 0 && overlay && overlay.parentNode) {
        overlay.remove();
      }
    }, { once: true });
    overlay.appendChild(piece);
  }
}

// v1.96/v1.97 (v1.5): ラウンド・ザ・クロック用 セグメント枠線色付け
//   myTarget=自分の current target (1-20)、oppTarget=相手の current target (1-20 or null)
//   両者同じセグメントなら myTarget(オレンジ)優先
//   v1.97: fill 塗りつぶし → 枠線 (stroke) のみに変更 (ユーザー指示「煩いので枠だけ」)
const RTC_COLOR_SELF = '#ea580c';  // オレンジ
const RTC_COLOR_OPP  = '#9ca3af';  // グレー
export function setSegmentHighlight(myTarget, oppTarget) {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('[data-seg-outline]').forEach((p) => {
    const segNum = Number(p.getAttribute('data-seg-outline'));
    if (segNum === myTarget) {
      p.setAttribute('stroke', RTC_COLOR_SELF);  // 自分=オレンジ (両者同じならこっち優先)
    } else if (segNum === oppTarget) {
      p.setAttribute('stroke', RTC_COLOR_OPP);   // 相手=グレー
    } else {
      p.setAttribute('stroke', 'transparent');
    }
  });
}
export function clearSegmentHighlight() {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('[data-seg-outline]').forEach((p) => {
    p.setAttribute('stroke', 'transparent');
  });
}

// v2.05〜v2.07 (v1.5): クリケット用ボード色付け
//   - 1〜14 セグメント (使えない) + 両者ロック = 単色の明るいグレー塗り (元色のヒント不要)
//   - 「自分のオープン」(自分 ≥3 + 相手 <3) = オレンジ枠 (得点取得可)
//   - 「相手のオープン」(相手 ≥3 + 自分 <3) = 濃いグレー枠
//   - 上記以外 = 元の色を維持 (mark 取得中、まだオープンしてない)
//   - 各セグメント外側に自分/相手のマーク数 (/, X, Ⓧ) を表示
//   ※ オープン/クローズの判定は Rules の applyShotCricket と同じ流儀
const CRICKET_STROKE_SELF = '#ea580c';   // 自分オープン
const CRICKET_STROKE_OPP  = '#6b7280';   // 相手オープン
const CRICKET_FILL_GRAY   = '#7a7a7a';   // v2.07: 明るい中明度の単色グレー
function _isCricketTarget(segKey) {
  return segKey === 'bull' || (typeof segKey === 'number' && segKey >= 15 && segKey <= 20);
}
function _cricketMarkChar(n) {
  if (n === 1) return '/';
  if (n === 2) return 'X';
  if (n >= 3)  return 'Ⓧ';
  return '';
}
export function setCricketBoard(myMarks, oppMarks) {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  myMarks = myMarks || {};
  oppMarks = oppMarks || {};

  // セクタ fill
  svg.querySelectorAll('[data-seg-sector]').forEach((p) => {
    const raw = p.getAttribute('data-seg-sector');
    const segKey = (raw === 'bull') ? 'bull' : Number(raw);
    const orig = p.getAttribute('data-orig-fill');
    if (!_isCricketTarget(segKey)) {
      p.setAttribute('fill', CRICKET_FILL_GRAY);
      return;
    }
    const my  = myMarks[segKey]  || 0;
    const opp = oppMarks[segKey] || 0;
    if (my >= 3 && opp >= 3) {
      p.setAttribute('fill', CRICKET_FILL_GRAY);
    } else if (orig) {
      p.setAttribute('fill', orig);
    }
  });

  // 外周枠
  svg.querySelectorAll('[data-seg-outline]').forEach((p) => {
    const raw = p.getAttribute('data-seg-outline');
    const segKey = (raw === 'bull') ? 'bull' : Number(raw);
    if (!_isCricketTarget(segKey)) {
      p.setAttribute('stroke', 'transparent');
      return;
    }
    const my  = myMarks[segKey]  || 0;
    const opp = oppMarks[segKey] || 0;
    if (my >= 3 && opp < 3) {
      p.setAttribute('stroke', CRICKET_STROKE_SELF);
    } else if (opp >= 3 && my < 3) {
      p.setAttribute('stroke', CRICKET_STROKE_OPP);
    } else {
      p.setAttribute('stroke', 'transparent');
    }
  });

  // マーク数表示 (15-20 + bull の左右に /、X、Ⓧ)
  svg.querySelectorAll('[data-cricket-mark]').forEach((t) => {
    const who = t.getAttribute('data-cricket-mark');   // 'self' | 'opp'
    const raw = t.getAttribute('data-cricket-seg');
    const segKey = (raw === 'bull') ? 'bull' : Number(raw);
    const marks = (who === 'self') ? myMarks : oppMarks;
    t.textContent = _cricketMarkChar(marks[segKey] || 0);
  });
}
export function clearCricketBoard() {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('[data-seg-sector]').forEach((p) => {
    const orig = p.getAttribute('data-orig-fill');
    if (orig) p.setAttribute('fill', orig);
  });
  svg.querySelectorAll('[data-seg-outline]').forEach((p) => {
    p.setAttribute('stroke', 'transparent');
  });
  svg.querySelectorAll('[data-cricket-mark]').forEach((t) => {
    t.textContent = '';
  });
}

// v1.84: 役達成時の祝祭振動（TON80 / 9D / ハットトリック等）
//   - 物理風振動(startTargetVibrate)とは別物
//   - 中心を支点に z 軸まわり平面回転（rotate）
//   - 投擲の強さに関係なく最大振幅(12度) で発動、当たり位置も無視
//   - 既存振動を上書きして開始
export function startCelebrateVibrate() {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  if (_vibrateAnimId) cancelAnimationFrame(_vibrateAnimId);

  const AMP_DEG     = 12;       // 最大振幅(強さ無視)
  const FREQ_HZ     = 6;
  const DECAY_BASE  = 0.1;
  const DURATION_MS = 1200;
  svg.style.transformOrigin = '50% 50%';

  const start = performance.now();
  function step(now) {
    const t = (now - start) / 1000;
    if (t >= DURATION_MS / 1000) {
      svg.style.transform = '';
      svg.style.transformOrigin = '';
      _vibrateAnimId = null;
      return;
    }
    const decay = Math.pow(DECAY_BASE, t);
    const angle = AMP_DEG * Math.sin(2 * Math.PI * FREQ_HZ * t) * decay;
    svg.style.transform = `rotate(${angle}deg)`;
    _vibrateAnimId = requestAnimationFrame(step);
  }
  _vibrateAnimId = requestAnimationFrame(step);
}

export function getTargetWorld() {
  return { ..._targetWorld };
}

// 中央リセット（of 的を画面中央に戻す）
export function recenterTarget() {
  _targetWorld = { yaw: 0, pitch: 0 };
}

// v1.14: ユーザー調整可能パラメータの setter/getter
export function setYawPitchScale(s) { YAW_PITCH_SCALE = Math.max(0.5, Math.min(2.0, s)); }
export function getYawPitchScale() { return YAW_PITCH_SCALE; }
export function setRollScale(s) { ROLL_SCALE = Math.max(0.3, Math.min(1.5, s)); }
export function getRollScale() { return ROLL_SCALE; }
export function setSmoothFactor(f) { SMOOTH_FACTOR = Math.max(0.1, Math.min(1.0, f)); }
export function getSmoothFactor() { return SMOOTH_FACTOR; }

// 直近のログ（JSON object 形式、v1.24 から構造化）
//   - config: 現在の調整パラメータ
//   - samples: 10Hz センサーサンプル（5秒）
//   - events: 投擲イベント（直近 N 件）
export function getLog() {
  return {
    config: {
      SIGN_YAW, SIGN_PITCH, SIGN_ROLL,
      HORIZ_FOV_DEG, YAW_PITCH_SCALE, ROLL_SCALE, SMOOTH_FACTOR,
    },
    samples: _logBuffer.slice(),
    events: _eventBuffer.slice(),
  };
}

// v1.24: 投擲イベントをログバッファに追加（app から呼ばれる）
export function logEvent(event) {
  const t = _startTime ? Math.round(performance.now() - _startTime) : 0;
  _eventBuffer.push({ t, ...event });
  if (_eventBuffer.length > EVENT_BUFFER_SIZE) _eventBuffer.shift();
}

function round1(v) {
  if (v === null || v === undefined) return null;
  return Math.round(v * 10) / 10;
}

// ======================================================================
// fps 計測（v1.55, SPEC 17.4 / 4-C-3）
// performance.now() ベースの frame interval を移動平均。
// タブ非表示時の異常値（1秒超）は除外
// ======================================================================
const _FPS_WINDOW = 60;     // 約1秒の平均（60fps想定）
let _fpsLastTime = 0;
let _fpsIntervals = [];     // ms
function recordFrameTime(now) {
  if (_fpsLastTime > 0) {
    const dt = now - _fpsLastTime;
    if (dt > 0 && dt < 1000) {
      _fpsIntervals.push(dt);
      if (_fpsIntervals.length > _FPS_WINDOW) _fpsIntervals.shift();
    }
  }
  _fpsLastTime = now;
}
export function getFps() {
  if (_fpsIntervals.length < 5) return null;
  const sum = _fpsIntervals.reduce((a, b) => a + b, 0);
  return Math.round(1000 / (sum / _fpsIntervals.length));
}
export function resetFps() {
  _fpsIntervals = [];
  _fpsLastTime = 0;
}

// ======================================================================
// rAF ループ：センサー値 → シーン(壁+的) の transform 更新 + 矢印切替
// ======================================================================
function tick() {
  recordFrameTime(performance.now());
  if (!_sceneEl || !_boardEl || !_viewEl) {
    _animFrameId = null;
    return;
  }

  const screenW = _viewEl.clientWidth || window.innerWidth;
  const screenH = _viewEl.clientHeight || window.innerHeight;
  const pxPerDeg = (screenW / HORIZ_FOV_DEG) * YAW_PITCH_SCALE;
  const targetSizePx = screenW * TARGET_DIAMETER_RATIO;

  const rel = Sensor.getRelativeOrientation();
  let yawDelta = 0, pitchDelta = 0, roll = 0;
  if (rel) {
    // v1.10: 低域パスフィルタ（cross-axis ノイズと jitter を緩和）
    _smoothRel.alpha = _smoothRel.alpha * (1 - SMOOTH_FACTOR) + (rel.alpha || 0) * SMOOTH_FACTOR;
    _smoothRel.beta  = _smoothRel.beta  * (1 - SMOOTH_FACTOR) + (rel.beta  || 0) * SMOOTH_FACTOR;
    _smoothRel.gamma = _smoothRel.gamma * (1 - SMOOTH_FACTOR) + (rel.gamma || 0) * SMOOTH_FACTOR;

    // 縦持ち想定: gamma=Yaw, beta=Pitch, alpha=Roll
    yawDelta   = SIGN_YAW   * _smoothRel.gamma;
    pitchDelta = SIGN_PITCH * _smoothRel.beta;
    roll       = SIGN_ROLL  * _smoothRel.alpha * ROLL_SCALE;
  }
  // v1.21: app から照準角度を取れるよう保存
  _lastYawDeg = yawDelta;
  _lastPitchDeg = pitchDelta;

  // 視線方向から的までの角度差
  const dxDeg = _targetWorld.yaw   - yawDelta;
  const dyDeg = _targetWorld.pitch - pitchDelta;

  // 画面上の的中心位置（viewport 中央からの px オフセット）
  const x = dxDeg * pxPerDeg;
  const y = -dyDeg * pxPerDeg;  // CSS Y は下が正

  // 的（サイズだけ動的、シーン内でセンタリング固定）
  _boardEl.style.width  = `${targetSizePx}px`;
  _boardEl.style.height = `${targetSizePx}px`;

  // v1.10: 純粋 2D 描画（translate + rotateZ のみ）
  // 3D 合成パスを避けて pivot ズレを防ぐ。疑似 3D 傾きは v1.10+ で再導入予定
  _sceneEl.style.transform =
    `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${roll.toFixed(2)}deg)`;

  // ログサンプル記録（10Hz）
  const now = performance.now();
  if (now - _lastLogTime >= LOG_INTERVAL_MS) {
    const raw = Sensor.getCurrentOrientation();
    _logBuffer.push({
      t: Math.round(now - _startTime),
      raw: raw ? { a: round1(raw.alpha), b: round1(raw.beta), g: round1(raw.gamma) } : null,
      rel: rel ? { a: round1(rel.alpha), b: round1(rel.beta), g: round1(rel.gamma) } : null,
      view: { yaw: round1(yawDelta), pitch: round1(pitchDelta), roll: round1(roll) },
      tgt: { yaw: round1(_targetWorld.yaw), pitch: round1(_targetWorld.pitch) },
      scr: { x: Math.round(x), y: Math.round(y) },
    });
    if (_logBuffer.length > LOG_BUFFER_SIZE) _logBuffer.shift();
    _lastLogTime = now;
  }

  // 視界外方向矢印（SPEC 4.2 視界外時の方向矢印）
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const halfTarget = targetSizePx / 2;
  const out = (Math.abs(x) > halfW + halfTarget) || (Math.abs(y) > halfH + halfTarget);
  if (out) {
    _arrowEl.style.display = 'flex';
    // 横方向: x の符号で左右端配置
    if (x < 0) {
      _arrowEl.style.left = '12px';
      _arrowEl.style.right = 'auto';
      _arrowEl.classList.add('flip-h');
    } else {
      _arrowEl.style.right = '12px';
      _arrowEl.style.left = 'auto';
      _arrowEl.classList.remove('flip-h');
    }
    // 縦位置: y の符号で上下に少しずらす（簡易版）
    const yFrac = Math.max(-0.4, Math.min(0.4, y / screenH));
    _arrowEl.style.top = `${50 + yFrac * 80}%`;
  } else {
    _arrowEl.style.display = 'none';
  }

  // v1.21: 飛行中のダーツを 3D 投影
  if (_flight) {
    const dartEl = document.getElementById('flying-dart');
    if (dartEl) {
      const elapsedS = (performance.now() - _flight.startTime) / 1000;
      if (elapsedS >= _flight.impact.t) {
        // 着弾 — v1.34: 矢羽根 + 軌道方向 + 投擲者色
        if (_flight.impact.hit) {
          const traj = _flight.trajectory;
          const last = traj[traj.length - 1];
          const prev = traj[Math.max(0, traj.length - 2)];
          const lastSV = worldImpactToBoardSVG(last);
          const prevSV = worldImpactToBoardSVG(prev);
          const angleDeg = Math.atan2(lastSV.y - prevSV.y, lastSV.x - prevSV.x) * 180 / Math.PI;
          showImpactMark(_flight.impact, {
            boardSV: _flight.authoritativeBoardSV || lastSV,
            angleDeg,
            thrower: _flight.thrower,
          });
        }
        endFlight();
      } else {
        const pos = interpolateTrajectory(_flight.trajectory, elapsedS);
        const proj = projectWorldToScreen(pos, yawDelta, pitchDelta, roll,
                                          screenW, screenH, pxPerDeg);
        if (proj.behind) {
          dartEl.style.opacity = '0';
        } else {
          dartEl.style.opacity = '1';
          dartEl.style.left = `${proj.x.toFixed(1)}px`;
          dartEl.style.top  = `${proj.y.toFixed(1)}px`;
          // v1.85 (v1.2): 2D 軌跡を記録（フォールバック段階3 では trail 自体を作らない）
          if (_trailEnabled) {
            _currentTrail.push({ x: proj.x, y: proj.y });
          }
        }
      }
    }
  }

  if (_debugCallback) {
    _debugCallback({ yawDelta, pitchDelta, roll, x, y, target: _targetWorld });
  }

  _animFrameId = requestAnimationFrame(tick);
}

// ======================================================================
// 起動・停止
// ======================================================================
export function start({ viewEl, sceneEl, boardEl, arrowEl, debugCallback }) {
  _viewEl = viewEl;
  _sceneEl = sceneEl;
  _boardEl = boardEl;
  _arrowEl = arrowEl;
  _debugCallback = debugCallback || null;

  // ダーツボード SVG を組み立て
  _boardEl.innerHTML = '';
  _boardEl.appendChild(buildDartboardSVG());

  // ログバッファをリセット
  _logBuffer = [];
  _eventBuffer = [];
  _lastLogTime = 0;
  _startTime = performance.now();
  _smoothRel = { alpha: 0, beta: 0, gamma: 0 };  // v1.10

  if (_animFrameId) cancelAnimationFrame(_animFrameId);
  _animFrameId = requestAnimationFrame(tick);
}

export function stop() {
  if (_animFrameId) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }
  // v1.21: 飛行中なら捨てる（callback は呼ばない）
  _flight = null;
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.classList.remove('flying');
    dart.style.opacity = '0';
    dart.style.transition = '';
  }
  _viewEl = null;
  _sceneEl = null;
  _boardEl = null;
  _arrowEl = null;
  _debugCallback = null;
}

// ======================================================================
// 段階2-E: 物理飛行 + 着弾マーク
// ======================================================================

// 軌跡を時刻 t で線形補間
function interpolateTrajectory(traj, t) {
  if (!traj || traj.length === 0) return { x: 0, y: 0, z: 0 };
  if (t <= traj[0].t) return { ...traj[0] };
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].t >= t) {
      const a = traj[i - 1], b = traj[i];
      const dt = b.t - a.t || 1e-6;
      const f = (t - a.t) / dt;
      return {
        x: a.x + f * (b.x - a.x),
        y: a.y + f * (b.y - a.y),
        z: a.z + f * (b.z - a.z),
      };
    }
  }
  return { ...traj[traj.length - 1] };
}

// ワールド座標 (m) → 画面座標 (px)。プレイヤーは原点、Z+ 前方
// v2.02 (v1.5): roll 回転を反映
//   scene (壁+的) は `translate(...) rotate(roll)` で描画される（rotate origin = 画面中央）。
//   放物線 / 飛行中ダーツは scene 外の画面座標で配置されるため、roll を適用しないと
//   ロール時に的との位置関係がズレる。座標を画面中央を支点に rotate(roll) する。
function projectWorldToScreen(pos, devYawDeg, devPitchDeg, rollDeg, screenW, screenH, pxPerDeg) {
  if (pos.z <= 0.05) return { x: 0, y: 0, behind: true };
  const yawDeg   = Math.atan2(pos.x, pos.z) * 180 / Math.PI;
  const pitchDeg = Math.atan2(pos.y, Math.hypot(pos.x, pos.z)) * 180 / Math.PI;
  const dxDeg = yawDeg   - devYawDeg;
  const dyDeg = pitchDeg - devPitchDeg;
  const offX = dxDeg * pxPerDeg;
  const offY = -dyDeg * pxPerDeg;  // CSS Y は下が正
  // 画面中央を支点に roll で回転（scene と同じ方向）
  const rad = (rollDeg || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotX = offX * cos - offY * sin;
  const rotY = offX * sin + offY * cos;
  return {
    x: rotX + screenW / 2,
    y: rotY + screenH / 2,
    behind: false,
  };
}

// world 座標の着弾 → board-local SVG 座標
const _UNITS_PER_DEG = ((R_BORDER + 4) * 2) / (HORIZ_FOV_DEG * TARGET_DIAMETER_RATIO);

function worldImpactToBoardSVG(impact) {
  const rel = Physics.impactRelativeToTarget(impact, _targetWorld);
  return {
    x: rel.dxDeg * _UNITS_PER_DEG,
    y: -rel.dyDeg * _UNITS_PER_DEG,   // SVG Y は下が正
  };
}

// v1.34: board SVG 座標 → world 座標（受信側が sender authoritative impact から world を逆算）
function boardSVGToWorldImpact(boardSV) {
  const dxDeg = boardSV.x / _UNITS_PER_DEG;
  const dyDeg = -boardSV.y / _UNITS_PER_DEG;
  const yawRad   = (_targetWorld.yaw   + dxDeg) * Math.PI / 180;
  const pitchRad = (_targetWorld.pitch + dyDeg) * Math.PI / 180;
  const z = 2.5;
  const x = z * Math.tan(yawRad);
  const y = (z / Math.cos(yawRad)) * Math.tan(pitchRad);
  return { x, y, z, t: 0, hit: true };
}

// v1.33 (3-C): sim 結果から board impact を取得（対戦時の即時送信用）
export function boardImpactFromSim(sim) {
  return sim && sim.impact && sim.impact.hit ? worldImpactToBoardSVG(sim.impact) : null;
}

// v1.34: 投擲者色（CSS変数とも揃える）
const COLOR_SELF = '#ea580c';  // orange-mid
const COLOR_OPP  = '#9ca3af';  // gray-400

// 着弾マーク（v1.36）：的に垂直に刺さった姿。チップ + 軸線 + Y字3枚羽根
//   - tip: 着弾点に小さな先端ドット（板に刺さった部分の頭）
//   - shaft: tip → backCenter の細線（軌道方向の反対側に少しだけずれる）
//   - backCenter: シャフト末端の小さな暗ドット（立体的な深み）
//   - 3 枚羽根 Y 字: backCenter から +up, +down-right, +down-left の 3 方向
//     画面上方向の1枚は full width、両側の2枚は半幅で foreshortening を簡易表現
function showImpactMark(impact, opts) {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (!svg) return;
  const sv = (opts && opts.boardSV) || worldImpactToBoardSVG(impact);
  const motionAngleDeg = (opts && typeof opts.angleDeg === 'number') ? opts.angleDeg : 0;
  const color = (opts && opts.thrower === 'opp') ? COLOR_OPP : COLOR_SELF;

  const TILT_OFFSET = 2.5;     // tip → backCenter の距離（軌道方向の反対側）
  const FLIGHT_LEN  = 6.5;     // 各羽根の長さ
  const FLIGHT_W    = 2.4;     // 羽根の最大幅（正面を向く1枚）

  const motionRad = motionAngleDeg * Math.PI / 180;
  const backX = -TILT_OFFSET * Math.cos(motionRad);
  const backY = -TILT_OFFSET * Math.sin(motionRad);

  const group = el('g', { transform: `translate(${sv.x},${sv.y})` });
  group.classList.add('impact-mark');

  // 軸線（tip → backCenter）
  const shaft = el('line', {
    x1: 0, y1: 0,
    x2: backX, y2: backY,
    stroke: color,
    'stroke-width': 0.7,
    'stroke-linecap': 'round',
    opacity: 0.85,
  });
  group.appendChild(shaft);

  // backCenter グループ — ここに Y 字 3 枚と中心ドット
  const back = el('g', { transform: `translate(${backX}, ${backY})` });

  // 3 枚羽根を Y 字配置（画面 -y = 上、+30° / +150° で下右と下左）
  // 画面上の 1 枚は full width、左右両側の 2 枚は半幅で foreshortening 簡易表現
  const FLIGHT_CONFIG = [
    { angle: -90,  widthMult: 1.0  },  // 上（手前を向いている想定）
    { angle:  30,  widthMult: 0.55 },  // 下右（120°回転、奥に向いて見えるので foreshortened）
    { angle: 150,  widthMult: 0.55 },  // 下左（120°回転、同上）
  ];
  for (const cfg of FLIGHT_CONFIG) {
    const flight = el('g', { transform: `rotate(${cfg.angle})` });
    const w = FLIGHT_W * cfg.widthMult;
    // 羽根 = 中央が太い菱形（diamond）。基部は backCenter から細く始まり、
    // 中央でふくらみ、先端に向かって絞る
    const paddle = el('path', {
      d: `M 0 0 L ${FLIGHT_LEN * 0.5} -${(w/2).toFixed(2)} L ${FLIGHT_LEN} 0 L ${FLIGHT_LEN * 0.5} ${(w/2).toFixed(2)} Z`,
      fill: color,
      stroke: '#0a0a0a',
      'stroke-width': 0.3,
      'stroke-linejoin': 'round',
    });
    flight.appendChild(paddle);
    back.appendChild(flight);
  }

  // backCenter ドット（軸の末端 = 立体感の hint、暗色 + プレイヤー色の縁）
  const backDot = el('circle', {
    cx: 0, cy: 0, r: 1.0,
    fill: '#0a0a0a',
    stroke: color,
    'stroke-width': 0.4,
  });
  back.appendChild(backDot);

  group.appendChild(back);

  // tip ドット（最後に追加 = 軸線の上に重ねる）
  const tip = el('circle', {
    cx: 0, cy: 0, r: 0.8,
    fill: color,
    stroke: '#ffffff',
    'stroke-width': 0.3,
  });
  group.appendChild(tip);

  svg.appendChild(group);

  // v1.59 (4-C-5): 着弾履歴上限を超えたら古い順に削除（フォールバック段階2）
  if (_maxImpactMarks !== Infinity) {
    const marks = svg.querySelectorAll('.impact-mark');
    const excess = marks.length - _maxImpactMarks;
    for (let i = 0; i < excess; i++) marks[i].remove();
  }
}

export function clearImpactMarks() {
  if (!_boardEl) return;
  const svg = _boardEl.querySelector('svg');
  if (svg) svg.querySelectorAll('.impact-mark').forEach((e) => e.remove());
}

// ======================================================================
// 性能フォールバック（v1.59 / SPEC 17.4 段階1〜4、v1.85/v1.2 で 3/4 復活）
// ======================================================================
//   段階1: 木目 → 単色（darts-app.js が #game-3d-wall に .no-texture を付与）
//   段階2: 着弾履歴の上限化（_maxImpactMarks）
//   段階3: 軌道線フェード即時消去（_trailEnabled = false で trail 蓄積を停止）
//   段階4: 紙吹雪粒子数削減（_confettiSimplified = true で 30→15）
let _maxImpactMarks = Infinity;
let _trailEnabled = true;          // v1.85: trail 蓄積 ON/OFF（false で軌道線スキップ）
let _confettiSimplified = false;   // v1.85: 紙吹雪粒子数を半減
export function setMaxImpactMarks(n) {
  _maxImpactMarks = (typeof n === 'number' && n > 0) ? Math.floor(n) : Infinity;
}
export function setTrailEnabled(on) { _trailEnabled = !!on; }
export function setConfettiSimplified(on) { _confettiSimplified = !!on; }
export function isTrailEnabled() { return _trailEnabled; }
export function isConfettiSimplified() { return _confettiSimplified; }
export function getQualityState() {
  return {
    maxImpactMarks: _maxImpactMarks,
    trailEnabled: _trailEnabled,
    confettiSimplified: _confettiSimplified,
  };
}

// 現在のスムージング済み照準角度（app から照準を渡したいとき用）
export function getCurrentAim() {
  return { yawDeg: _lastYawDeg, pitchDeg: _lastPitchDeg };
}

// 飛行開始（simResult = Physics.simulateThrow の戻り値）
// v1.34: opts.authoritativeBoard で受信側の sender authoritative impact を上書き、
//        opts.thrower ('self' | 'opp') でダーツ色を切替
export function fireFlight(simResult, onComplete, opts) {
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.style.transition = 'none';
    dart.style.opacity = '0';
    dart.classList.add('flying');
    // 投擲者色
    if (opts && opts.thrower === 'opp') {
      dart.classList.add('opp');
    } else {
      dart.classList.remove('opp');
    }
  }

  let trajectory = simResult.trajectory;
  let impact = simResult.impact;
  let authoritativeBoardSV = null;

  if (opts && opts.authoritativeBoard && impact.hit && trajectory.length >= 2) {
    // 受信側: sender authoritative impact を world に逆算 → 軌道末尾を shift
    const targetWorld = boardSVGToWorldImpact(opts.authoritativeBoard);
    const lastIdx = trajectory.length - 1;
    const dx = targetWorld.x - trajectory[lastIdx].x;
    const dy = targetWorld.y - trajectory[lastIdx].y;
    trajectory = trajectory.map((p, i) => ({
      x: p.x + dx * (i / lastIdx),
      y: p.y + dy * (i / lastIdx),
      z: p.z,
      t: p.t,
    }));
    impact = { ...impact, x: targetWorld.x, y: targetWorld.y };
    authoritativeBoardSV = opts.authoritativeBoard;
  }

  _flight = {
    trajectory,
    impact,
    startTime: performance.now(),
    onComplete,
    authoritativeBoardSV,
    thrower: (opts && opts.thrower) || 'self',
  };
  // v1.85 (v1.2): 軌跡蓄積をリセット
  _currentTrail = [];
}

// v1.85/v1.86 (v1.2): 軌道線を #trail-layer に追加、着弾後 0.5 秒でフェード (SPEC 7.2)
//   - 先細り表現: 投擲元（手前）が太く、着弾点（先端）に向けて細くなる
//   - 個別 <line> セグメントの stroke-width を線形補間
//   - 性能フォールバック段階3: setTrailEnabled(false) で trail 蓄積自体を停止
const TRAIL_WIDTH_NEAR = 6;  // 手前（投擲元側）の太さ
const TRAIL_WIDTH_FAR  = 1;  // 先端（着弾点側）の太さ
const TRAIL_FADE_MS    = 500; // 0.5 秒で完全消去

function spawnTrailPolyline(thrower) {
  if (!_trailEnabled || _currentTrail.length < 2) return;
  const layer = document.getElementById('trail-layer');
  if (!layer) return;
  const ns = 'http://www.w3.org/2000/svg';
  // viewBox は画面ピクセルサイズに合わせる（再計算）
  const w = layer.clientWidth || window.innerWidth;
  const h = layer.clientHeight || window.innerHeight;
  layer.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // 線形補間で stroke-width を変えるセグメント群を <g> に詰める
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', thrower === 'opp' ? 'opp' : 'self');
  const N = _currentTrail.length - 1;
  for (let i = 0; i < N; i++) {
    const p0 = _currentTrail[i];
    const p1 = _currentTrail[i + 1];
    const seg = document.createElementNS(ns, 'line');
    seg.setAttribute('x1', p0.x.toFixed(1));
    seg.setAttribute('y1', p0.y.toFixed(1));
    seg.setAttribute('x2', p1.x.toFixed(1));
    seg.setAttribute('y2', p1.y.toFixed(1));
    // i=0 で TRAIL_WIDTH_NEAR、i=N-1 で TRAIL_WIDTH_FAR に線形補間
    const tFrac = N > 1 ? i / (N - 1) : 0;
    const sw = TRAIL_WIDTH_NEAR * (1 - tFrac) + TRAIL_WIDTH_FAR * tFrac;
    seg.setAttribute('stroke-width', sw.toFixed(2));
    g.appendChild(seg);
  }
  layer.appendChild(g);
  // 着弾後即フェード開始
  requestAnimationFrame(() => {
    g.classList.add('fade');
  });
  setTimeout(() => {
    if (g.parentNode) g.parentNode.removeChild(g);
  }, TRAIL_FADE_MS + 100);  // 余裕 100ms
}

function endFlight() {
  if (!_flight) return;
  const f = _flight;
  _flight = null;
  const dart = document.getElementById('flying-dart');
  if (dart) {
    dart.style.transition = 'opacity 240ms ease-out';
    dart.style.opacity = '0';
    setTimeout(() => {
      dart.classList.remove('flying');
      dart.classList.remove('opp');  // v1.34: 投擲者色をリセット
      dart.style.transition = '';
    }, 260);
  }
  // v1.85 (v1.2): 軌道線を spawn して 2.5 秒フェード (SPEC 7.2)
  spawnTrailPolyline(f.thrower);
  // 受信側で sender authoritative を上書きしている場合はそれを返す
  const boardImpact = f.authoritativeBoardSV
    || (f.impact.hit ? worldImpactToBoardSVG(f.impact) : null);
  if (f.onComplete) f.onComplete({ world: f.impact, board: boardImpact });
}
