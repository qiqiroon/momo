/*
 * MOMO Cosmos — 設定値（調整はこのファイルだけで行う）
 * 出典の節番号は MOMO_Cosmos_Specification_v2_01.md（第6.2〜6.4節は v2_00 から復元）
 */
(function (root) {
  'use strict';

  const CONFIG = {
    version: 'v0.02', // v0.01 から、公開（デプロイ）のたびに +0.01（2026-10-29 作者の指示。v1.00 へは飛ばさない）

    // 第4章 盤面（論理座標）
    board: { width: 600, height: 900, dropY: 90, deadlineY: 150, wallThickness: 200 },

    // 第5章 天体進化表（spriteKey は assets/img/manifest.json のキー）
    stages: [
      null,
      { name: '月',         spriteKey: 'moon',        radius: 20,  score: 0,   color: '#bdbdbd' },
      { name: '地球',       spriteKey: 'earth',       radius: 24,  score: 30,  color: '#3b82f6' },
      { name: '火星',       spriteKey: 'mars',        radius: 29,  score: 60,  color: '#dc6b3a' },
      { name: '金星',       spriteKey: 'venus',       radius: 35,  score: 100, color: '#e8c27a' },
      { name: '水星',       spriteKey: 'mercury',     radius: 41,  score: 150, color: '#9ca3af' },
      { name: '海王星',     spriteKey: 'neptune',     radius: 50,  score: 210, color: '#2563eb' },
      { name: '天王星',     spriteKey: 'uranus',      radius: 60,  score: 280, color: '#7dd3fc' },
      { name: '土星',       spriteKey: 'saturn',      radius: 72,  score: 360, color: '#d6b47a' },
      { name: '木星',       spriteKey: 'jupiter',     radius: 86,  score: 450, color: '#c08a5a' },
      { name: '太陽',       spriteKey: 'sun',         radius: 103, score: 550, color: '#fbbf24' },
      { name: '超新星',     spriteKey: 'supernova',   radius: 124, score: 660, color: '#f0abfc' },
      { name: '中性子星',   spriteKey: 'neutronstar', radius: 149, score: 780, color: '#a5f3fc' },
      { name: 'ブラックホール', spriteKey: 'blackhole', radius: 36, score: 10000, color: '#000000' }
    ],
    maxMergeStage: 12, // 中性子星どうしはブラックホール誕生へ（M2）

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
      restitution: 0.2,
      friction: 0.3,
      frictionStatic: 0.4,
      frictionAir: 0.01,
      density: 0.001,
      rollingDamping: 0.97,
      positionIterations: 10,
      velocityIterations: 8,
      stepMs: 1000 / 60,
      maxStepsPerFrame: 8,
      mergeBounceVy: -2.5 // 合体後に加える上向きの速度（px/step）
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
