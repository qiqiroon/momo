// I18N module — ja / en / zh / cat

const I18N = {
  ja: {
    titleBtn: 'はじめる',
    sensorBtn: 'センサーを許可してスタート',
    skipSensorBtn: '（PCで遊ぶ / センサーなし）',
    titleDesc: 'スマホを傾けてボールを転がし\n同じ色のゴールへ同時に入れよう！',
    kbdHint: 'PCは矢印キー / WASD で操作',
    previewStageLabel: 'ステージ',
    previewSuffix: 'の迷路が生成されました',
    previewHint: 'スマホを水平（画面を上向き）に持って操作します',
    calibTitle: '📱 水平キャリブレーション',
    calibDesc: 'スマホを操作しやすい角度に構えて「この向きを水平とする」を押してください',
    calibrateBtnText: 'この向きを水平とする',
    calibrateUpdated: '✓ 水平を更新しました',
    startBtn: 'ゲームスタート',
    skipCalibBtn: 'そのままスタート',
    settingsTitle: '⚙️ 感度設定',
    sensLabel: '傾き感度',
    spdLabel: '最大速度（壁抜け防止）',
    settingsClose: 'OK',
    stageLabel: 'ステージ',
    stageIntroEnemies: '登場する敵',
    stageIntroItems: 'アイテム',
    stageIntroPits: 'トラップ',
    stageIntroOk: 'OK！',
    clearMsg: '🎉 クリア！',
    clearSub: 'ステージ {N} へ…',
    overMsg: '💀 ゲームオーバー',
    overSub: 'タップして再スタート',
    calibOk: '水平を保てています ✓',
    calibNg: '傾いています…「この向きを水平とする」を押してください',
    kbdMode: 'キーボードモード (矢印/WASD)',
    enemyPatrolName: 'パトロール',  enemyPatrolDesc: 'ランダムに動く',
    enemyTrackerName: '追跡',       enemyTrackerDesc: '最も近いボールを追う',
    enemySlowName: 'スロー',        enemySlowDesc: '当たると遅くなる（ライフ減なし）',
    itemLifeDesc: 'ライフ +1',
    itemScoreDesc: 'スコア +200',
    itemFreezeDesc: '全ボールを3秒凍結',
    itemShieldDesc: '5秒間無敵',
    pitName: 'ホール',
    pitDesc: '落ちるとスタートへ戻る',
  },
  en: {
    titleBtn: 'Start',
    sensorBtn: 'Allow Sensor & Start',
    skipSensorBtn: '(PC / No Sensor)',
    titleDesc: 'Tilt your phone to roll balls into\nmatching colored goals simultaneously!',
    kbdHint: 'PC: Arrow keys / WASD',
    previewStageLabel: 'Stage',
    previewSuffix: 'maze generated',
    previewHint: 'Hold phone flat (screen facing up)',
    calibTitle: '📱 Level Calibration',
    calibDesc: 'Hold phone at a comfortable angle and press "Set as Level"',
    calibrateBtnText: 'Set as Level',
    calibrateUpdated: '✓ Level Updated',
    startBtn: 'Game Start',
    skipCalibBtn: 'Start Anyway',
    settingsTitle: '⚙️ Settings',
    sensLabel: 'Sensitivity',
    spdLabel: 'Max Speed',
    settingsClose: 'OK',
    stageLabel: 'Stage',
    stageIntroEnemies: 'Enemies',
    stageIntroItems: 'Items',
    stageIntroPits: 'Traps',
    stageIntroOk: 'OK!',
    clearMsg: '🎉 Clear!',
    clearSub: 'To Stage {N}…',
    overMsg: '💀 Game Over',
    overSub: 'Tap to Restart',
    calibOk: 'Level ✓',
    calibNg: 'Tilted… press "Set as Level"',
    kbdMode: 'Keyboard mode (Arrows/WASD)',
    enemyPatrolName: 'Patrol',   enemyPatrolDesc: 'Moves randomly',
    enemyTrackerName: 'Tracker', enemyTrackerDesc: 'Chases the nearest ball',
    enemySlowName: 'Slow',       enemySlowDesc: 'Slows on contact (no life loss)',
    itemLifeDesc: 'Life +1',
    itemScoreDesc: 'Score +200',
    itemFreezeDesc: 'Freeze all balls 3s',
    itemShieldDesc: 'Invincible 5s',
    pitName: 'Hole',
    pitDesc: 'Fall sends ball back to start',
  },
  zh: {
    titleBtn: '开始',
    sensorBtn: '允许传感器并开始',
    skipSensorBtn: '（PC / 无传感器）',
    titleDesc: '倾斜手机滚动小球，\n同时送入同色目标！',
    kbdHint: 'PC：方向键 / WASD',
    previewStageLabel: '第',
    previewSuffix: '关迷宫已生成',
    previewHint: '请将手机水平（屏幕朝上）操作',
    calibTitle: '📱 水平校准',
    calibDesc: '以舒适角度握持手机，按下"设为水平"',
    calibrateBtnText: '设为水平',
    calibrateUpdated: '✓ 已更新水平',
    startBtn: '游戏开始',
    skipCalibBtn: '直接开始',
    settingsTitle: '⚙️ 灵敏度设置',
    sensLabel: '倾斜灵敏度',
    spdLabel: '最大速度',
    settingsClose: 'OK',
    stageLabel: '第',
    stageIntroEnemies: '敌人',
    stageIntroItems: '道具',
    stageIntroPits: '陷阱',
    stageIntroOk: 'OK！',
    clearMsg: '🎉 通关！',
    clearSub: '前往第{N}关…',
    overMsg: '💀 游戏结束',
    overSub: '点击重新开始',
    calibOk: '保持水平 ✓',
    calibNg: '倾斜中…请按"设为水平"',
    kbdMode: '键盘模式（方向键/WASD）',
    enemyPatrolName: '巡逻',   enemyPatrolDesc: '随机移动',
    enemyTrackerName: '追踪',  enemyTrackerDesc: '追踪最近的球',
    enemySlowName: '减速',     enemySlowDesc: '接触减速（不扣血）',
    itemLifeDesc: '生命+1',
    itemScoreDesc: '得分+200',
    itemFreezeDesc: '冻结全部球3秒',
    itemShieldDesc: '无敌5秒',
    pitName: '陷坑',
    pitDesc: '落入返回起点',
  },
};

let catBase = 'ja';
let currentLang = (() => {
  try {
    const v = localStorage.getItem('momoLang');
    return ['ja','en','zh','cat'].includes(v) ? v : 'ja';
  } catch(e) { return 'ja'; }
})();

function catSpeak(key) {
  const calmKeys = ['calibOk', 'kbdMode', 'clearMsg', 'overMsg'];
  let vocab;
  if (catBase === 'en') {
    vocab = calmKeys.includes(key)
      ? ['purrrr...', 'mrrr...', 'prrr...']
      : ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'];
  } else if (catBase === 'zh') {
    vocab = calmKeys.includes(key)
      ? ['呼噜…', '咕噜…', '喵呼…']
      : ['喵', '喵喵', '喵！', '喵喵喵'];
  } else {
    vocab = calmKeys.includes(key)
      ? ['ごろごろ…', 'にゃ…', 'むーにゃ…']
      : ['にゃ', 'にゃー', 'にゃ！', 'みゃ', 'にゃにゃ！'];
  }
  return vocab[Math.floor(Math.random() * vocab.length)];
}

function t(key) {
  if (currentLang === 'cat') return catSpeak(key);
  return (I18N[currentLang] || I18N.ja)[key] ?? I18N.ja[key] ?? key;
}

function onLangChange(lang) {
  if (lang === 'cat') catBase = (currentLang !== 'cat') ? currentLang : catBase;
  currentLang = lang;
  try { localStorage.setItem('momoLang', lang); } catch(e) {}
  if (typeof applyLang === 'function') applyLang();
}
