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
    sensLabel:    '傾き感度',
    spdLabel:     '最大速度（壁抜け防止）',
    wallRepLabel: '壁の反発力',
    settingsClose: 'OK',
    settingsReset: 'デフォルトに戻す',
    stageLabel: 'ステージ',
    stageIntroEnemies: '登場する敵',
    stageIntroItems: 'アイテム',
    stageIntroPits: 'トラップ',
    stageIntroOk: 'OK！',
    clearMsg: '🎉 クリア！',
    clearSub: 'ステージ {N} へ…',
    overMsg: '💀 ゲームオーバー',
    overSub: 'タップして再スタート',
    overRanking: 'ランキング',
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
    stageIntroLocks: '鍵付きゴール',
    lockName: '鍵',
    lockDesc: '同じ番号の鍵を取るとゴールが解錠される',
    footAbout: 'MOMO Tilt について',
    footDesc: 'MOMO Tilt は、スマホを傾けて迷路の中のボールを穴に落とすブラウザゲームです。端末のジャイロセンサーを使って、転がるボールを物理的に操作します。アカウント登録もインストールも不要で、ブラウザだけですぐに遊べます。',
    footTop: 'MOMO Works トップ',
    footGames: 'ゲーム一覧',
    footTools: 'ツール一覧',
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
    sensLabel:    'Sensitivity',
    spdLabel:     'Max Speed',
    wallRepLabel: 'Wall Bounce',
    settingsClose: 'OK',
    settingsReset: 'Reset to Defaults',
    stageLabel: 'Stage',
    stageIntroEnemies: 'Enemies',
    stageIntroItems: 'Items',
    stageIntroPits: 'Traps',
    stageIntroOk: 'OK!',
    clearMsg: '🎉 Clear!',
    clearSub: 'To Stage {N}…',
    overMsg: '💀 Game Over',
    overSub: 'Tap to Restart',
    overRanking: 'High Scores',
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
    stageIntroLocks: 'Locked Goals',
    lockName: 'Key',
    lockDesc: 'Collect the matching key to unlock the goal',
    footAbout: 'About MOMO Tilt',
    footDesc: "MOMO Tilt is a browser game where you tilt your phone to roll a ball through a maze and drop it into the hole. It uses your device's gyroscope to control the rolling ball with real physics. No account or installation required — just play instantly in your browser.",
    footTop: 'MOMO Works Home',
    footGames: 'Games',
    footTools: 'Tools',
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
    sensLabel:    '倾斜灵敏度',
    spdLabel:     '最大速度',
    wallRepLabel: '墙壁反弹',
    settingsClose: 'OK',
    settingsReset: '恢复默认值',
    stageLabel: '第',
    stageIntroEnemies: '敌人',
    stageIntroItems: '道具',
    stageIntroPits: '陷阱',
    stageIntroOk: 'OK！',
    clearMsg: '🎉 通关！',
    clearSub: '前往第{N}关…',
    overMsg: '💀 游戏结束',
    overSub: '点击重新开始',
    overRanking: '排行榜',
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
    stageIntroLocks: '锁定目标',
    lockName: '钥匙',
    lockDesc: '拾取对应钥匙解锁目标',
    footAbout: '关于 MOMO Tilt',
    footDesc: 'MOMO Tilt 是一款通过倾斜手机让迷宫中的小球滚动并落入洞中的浏览器游戏。利用设备的陀螺仪传感器，以真实的物理效果操控滚动的小球。无需注册账号或安装，在浏览器中即可立即游玩。',
    footTop: 'MOMO Works 首页',
    footGames: '游戏列表',
    footTools: '工具列表',
  },
};

// 案件⑦: 言語の「判定 / モード取得 / 切替(保存ルール)」は共通ルーチン MomoLang(/momo/lib/momo-lang/momo-lang.js)に集約。
//  ここはその呼び出し側。MomoLang未ロード時(file://やネット不通)に備え最小限のfallbackだけ持つ。
//  catBase / applyLang はアプリ固有なのでここで保持。
const SUPPORTED_LANGS = ['ja','en','zh','cat'];
const LANG_APP_ID = 'tilt';
function _langDetectFallback(){
  try{ const list=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||'en'];
    for(let i=0;i<list.length;i++){ const l=(list[i]||'').toLowerCase();
      if(l.indexOf('ja')===0)return'ja'; if(l.indexOf('zh')===0)return'zh'; if(l.indexOf('en')===0)return'en'; }
    return'en';
  }catch(e){return'ja';}
}
let catBase = 'ja';
let langMode    = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
let currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID)
                : (langMode==='auto' ? _langDetectFallback()
                   : (SUPPORTED_LANGS.includes(langMode) ? langMode : _langDetectFallback()));

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

function onLangChange(mode){
  // 案件⑦: mode = auto/ja/en/zh/cat。保存ルール(ローカルモード+明示のみ共有momoLang)は共通ルーチンに委譲。
  //  catBase / applyLang はアプリ固有なのでここで扱う。
  if (mode === 'cat' && currentLang !== 'cat') catBase = currentLang;
  langMode = mode;
  currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
              : (mode === 'auto' ? _langDetectFallback()
                 : (SUPPORTED_LANGS.includes(mode) ? mode : _langDetectFallback()));
  document.querySelectorAll('.lang-select, #lang-select').forEach(s => s.value = mode);
  if (typeof applyLang === 'function') applyLang();
}
