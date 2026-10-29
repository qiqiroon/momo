/*
 * MOMO Cosmos — 設定値（調整はこのファイルだけで行う）
 * 出典の節番号は MOMO_Cosmos_Specification_v2_01.md（第6.2〜6.4節は v2_00 から復元）
 */
(function (root) {
  'use strict';

  const CONFIG = {
    version: 'v0.04', // v0.01 から、公開（デプロイ）のたびに +0.01（2026-10-29 作者の指示。v1.00 へは飛ばさない）

    // 第4章 盤面（論理座標）
    board: { width: 600, height: 900, dropY: 90, deadlineY: 150, wallThickness: 200 },

    // 第5章 天体進化表（spriteKey は assets/img/manifest.json のキー）
    // 並びは本当の大きさ（平均半径）の順。月 1,737 km < 水星 2,440 < 火星 3,390 < 金星 6,052 < 地球 6,371
    //   < 海王星 24,622 < 天王星 25,362 < 土星 58,232 < 木星 69,911 < 太陽 695,700。太陽より上は順を問わない
    //   （2026-10-29 作者の指示で地球と水星を入れ替えた。半径とスコアは段階ごとのまま）
    stages: [
      null,
      { name: '月',         spriteKey: 'moon',        radius: 20,  score: 0,   color: '#bdbdbd' },
      { name: '水星',       spriteKey: 'mercury',     radius: 24,  score: 30,  color: '#9ca3af' },
      { name: '火星',       spriteKey: 'mars',        radius: 29,  score: 60,  color: '#dc6b3a' },
      { name: '金星',       spriteKey: 'venus',       radius: 35,  score: 100, color: '#e8c27a' },
      { name: '地球',       spriteKey: 'earth',       radius: 41,  score: 150, color: '#3b82f6' },
      { name: '海王星',     spriteKey: 'neptune',     radius: 50,  score: 210, color: '#2563eb' },
      { name: '天王星',     spriteKey: 'uranus',      radius: 60,  score: 280, color: '#7dd3fc' },
      { name: '土星',       spriteKey: 'saturn',      radius: 72,  score: 360, color: '#d6b47a' },
      { name: '木星',       spriteKey: 'jupiter',     radius: 86,  score: 450, color: '#c08a5a' },
      { name: '太陽',       spriteKey: 'sun',         radius: 103, score: 550, color: '#fbbf24' },
      { name: '超新星',     spriteKey: 'supernova',   radius: 124, score: 660, color: '#f0abfc' },
      { name: '中性子星',   spriteKey: 'neutronstar', radius: 149, score: 780, color: '#a5f3fc' },
      { name: 'ブラックホール', spriteKey: 'blackhole', radius: 36, score: 10000, color: '#000000' }
    ],
    maxMergeStage: 12, // 中性子星どうしはブラックホール誕生へ（第11章）

    // 第8.1節・第11章 ブラックホール
    bh: {
      standbyMaxSec: 3,      // BH_STANDBY の最長
      stableSec: 0.5,        // 「全天体の速さが stableSpeed 未満」がこの時間続いたら安定
      stableSpeed: 0.5,      // px/step
      birthSec: 3.0,         // BH_BIRTH 全体
      gatherSec: 0.5,        // 光を集め、物理をスローにする時間
      slowScale: 0.3,        // スローの倍率
      appearAt: 0.6,         // 閃光ののち出現する時刻（誕生開始から）
      flashSec: 0.35,        // 白い閃光の長さ（光過敏に配慮して短く1回）
      home: { x: 300, y: 520 }, // 出現後に移る位置
      // 成長値 → 本体半径 Rb（間は直線でつなぎ、急に変えない。第11.6節）
      sizeCurve: [[0, 50], [100, 70], [300, 95], [600, 130]],
      tierAt: [0, 100, 300, 600], // 小型・中型・大型・超巨大の始まり
      absorbR: 0.6,          // Rb × 0.6 未満で吸収
      nearR: 2.5, nearG: 3,  // 近距離：Rb × 2.5 まで、重力の3倍
      farR: 8, farGmax: 1.5, farGmin: 1.2, // 中距離：Rb × 8 まで、重力の1.5→1.2倍（距離で減衰）。仕様書は Rb×5・1→0.5倍。
                             // 重力に勝てず床に落ちて吸われないため強めた（2026-10-29 作者の回答 B）
      swirl: 0.2,            // 回る向きの成分（全体の約20%）
      absorbSec: 0.3,        // 吸収の演出
      growthPerSec: 1,       // 止まらないよう1秒ごとに足す
      superGrowth: 600,      // 超巨大
      absorbScorePerStage: 20,
      superHoldSec: 2.5      // 「SUPERMASSIVE BLACK HOLE」を見せてから次へ（M3 までは仮の画面）
    },

    // 第6.3節 出現テーブル：到達した最高段階 → 出現範囲 [下限, 上限]
    spawnTable: [
      { upToMaxStage: 8,  range: [1, 5] },
      { upToMaxStage: 9,  range: [1, 6] },
      { upToMaxStage: 10, range: [2, 6] },
      { upToMaxStage: 11, range: [2, 7] },
      { upToMaxStage: 99, range: [3, 7] }
    ],
    // 範囲の下から順の確率（%）。5段階以外の範囲では 30→10 の直線で按分して合計100に正規化する
    spawnWeights5: [30, 25, 20, 15, 10],
    maxSameInARow: 3, // 同じ天体は4回以上連続させない

    // 第6.1節・第6.4節 操作
    input: {
      tapMaxMs: 250, tapMaxMovePx: 10, // 論理座標ではなく画面上の px
      dropCooldownMs: 500,
      keyAimSpeed: 420 // 論理px/秒（← → キー）
    },

    // 第7.2節 物理
    physics: {
      gravityY: 1,
      // ゴムボールのような手触り（2026-10-29 作者の要望）：少し弾み、表面がよく噛んで押されると回る
      restitution: 0.7,       // 仕様書の初期値 0.2。0.35 → 0.7（2026-10-29 作者「弾みを今の倍くらい」）
      friction: 0.6,          // 0.3。噛みを強くして、押された勢いで回るようにする
      frictionStatic: 0.5,    // 0.4
      floorRestitution: 0,    // 底板に当たったときは弾まない（2026-10-29 作者の指示）。天体どうし・左右の壁は restitution
      frictionAir: 0.01,
      density: 0.001,
      rollingDamping: 0.99,   // 0.97。回転を長く残す（1 に近いほど回り続ける）
      positionIterations: 10,
      velocityIterations: 8,
      stepMs: 1000 / 60,
      maxStepsPerFrame: 8,
      mergeBounceVy: -2.5 // 合体後に加える上向きの速度（px/step）
    },

    // やわらかさ（見た目だけ。当たり判定は円のまま）。ぶつかった向きに縮み、ばねで戻る
    squash: {
      gain: 0.0036,    // ぶつかる速さ（px/step）1 あたりの縮み。0.018 → 1/5（2026-10-29 作者「やわらかさを5分の1」）
      max: 0.04,       // 縮みの上限（半径に対する割合）。0.2 → 1/5
      stiffness: 0.25, // ばねの強さ（大きいほど速く戻る）
      damping: 0.78,   // 揺れの残り方（小さいほどすぐ収まる）
      bulge: 0.6       // 縮んだ分の横へのふくらみ
    },

    // 第10章 ゲームオーバー
    gameOver: { settleAgeSec: 1.0, overSec: 2.0, warnSec: 0.5 },

    // 第8.2節 合体演出
    mergeFx: {
      small:  { maxStage: 5,  durSec: 0.35, size: 1.4, shake: 0 },
      medium: { maxStage: 9,  durSec: 0.45, size: 1.7, shake: 0 },
      large:  { maxStage: 13, durSec: 0.6,  size: 2.0, shake: 6 },
      popupSec: 0.9
    },

    // 第17.4節・切り出し仕様書 第7章 描画
    render: {
      rotateSprites: true,     // 陰影が不自然なら false（第21章）
      glowScale: 1.2,          // 超新星・中性子星の表示倍率（短辺＝直径×1.2）
      starCount: 220
    },

    storageKeys: { highScore: 'momoCosmos.highScore', clearCount: 'momoCosmos.clearCount', settings: 'momoCosmos.settings' },

    // 第18.4節 設定パネルの既定値（音は M5 で鳴らす。今は値だけ保存する）
    settingsDefault: { se: 100, bgm: 40, seMute: false, bgmMute: false, events: true, debugPanel: true },

    // 猫語のときの天体名（第21章。2026-10-29 作者の回答で鳴き声に決定）。'base'＝系統言語のまま／'cat'＝鳴き声
    catStageNames: 'cat'

    // 文言は js/i18n.js（momo-lang の4言語辞書）
  };

  // 範囲の長さに応じた出現確率（合計1）
  CONFIG.spawnWeightsFor = function (n) {
    let w;
    if (n === 5) w = CONFIG.spawnWeights5.slice();
    else if (n === 1) w = [1];
    else { w = []; for (let i = 0; i < n; i++) w.push(30 - 20 * i / (n - 1)); }
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map(v => v / sum);
  };

  root.COSMOS_CONFIG = CONFIG;
  if (typeof module !== 'undefined') module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
