/*
 * MOMO Cosmos — 設定値（調整はこのファイルだけで行う）
 * 出典の節番号は MOMO_Cosmos_Specification_v2_02.md
 */
(function (root) {
  'use strict';

  const CONFIG = {
    version: 'v0.16', // v0.01 から、公開（デプロイ）のたびに +0.01（2026-10-29 作者の指示。v1.00 へは飛ばさない）

    // 第14章 特殊イベント（M4。2026-10-30）
    events: {
      delaySec: [45, 120],   // 前のイベント（とゲームの始め）から、この間のランダムな秒数がたったら必ず起こす（くじはしない。2026-10-30 作者の指示）
      warnSec: 1.5,          // 発生前にバナーで予告する長さ
      minDrops: 10,          // 前のイベント（とゲームの始め）から、この数だけ落とすまでは起こさない
      idleSec: 8,            // 最後に落としてからこの秒数を過ぎたら、待ちの時間を数えず、起こさない（落とすのを止めている間は数えない）
      weights: { flare: 2 }, // 選ぶときの重み（書いていないものは1）。フレアは弱めなので多めに
      playTypes: ['flare', 'comet', 'meteor', 'storm', 'wormhole'], // 通常期に起こるもの（惑星衝突は条件で起こる）
      bhTypes: ['comet', 'meteor'],                                  // ブラックホール期に起こるもの（第14.4節）
      // 太陽以上。予告の間に対象の星が明るくなり、発生で半径の3.5倍以内を外へ押す（上向きは弱める）。炎の弧を sec 秒見せる
      // 強さは 2026-10-31 作者の指示で強めた（半径の3.5倍・14 → 4.5倍・24）
      flare:    { minStage: 10, rangeMul: 4.5, push: 24, upMul: 0.8, sec: 1.8 },
      comet:    { crossSec: 0.55, maxSec: 8, radius: 34, yRange: [260, 700], tiltMax: 0.22, margin: 80,
                  fromY: [40, 200], aimJitter: 30, // 通常期は左右の上の方から、天体の山の重心（面積で重み付け）と底板の中間へ斜めに突っ込む（2026-10-31 作者の指示）
                  apexY: 0, bounceVx: 3.5, fall: 0.17, // 重心で跳ね返り、放物線の山が盤面の上の境目（y=0）に来る上向きの速さで飛ぶ。
                                                       // 跳ね返ったあとは横 3.5px/step、毎 step 0.17 ずつ落ちる（ゆっくりめ）
                  push: 55, pushRef: 80, upMul: 1, // 当たった天体に足す速さ（px/step）。半径 80 より大きい天体は半径に反比例して弱める
                  captureMul: 2.5, steer: 0.12, growth: 20 }, // すり抜けて当たった天体を1回押す。合体しない。BH 期は近づくと吸い込まれる
      meteor:   { topY: 350, count: [10, 10], sec: 4, startVy: 4 }, // 出現範囲の最下段の天体を上から降らせる（10個。2026-10-31 作者の指示で 5〜7個から）
      // 重力を斜め下に傾ける（左右はランダム）。積もった山は傾いた重力に対して平らになろうとして崩れる
      storm:    { sec: 12, angleDeg: [30, 40], gravityMul: 1, rampSec: 1.2 },
      // 2つの穴は双方向。ゆっくり動き回る。入った天体は、もう一方の穴から出る（穴から出るまでは戻さない）
      wormhole: { sec: 30, r: 44, maxRadius: 60, area: { x: [70, 530], y: [260, 800] }, minDist: 220, speed: 18, openSec: 0.8, cooldownSec: 1.2 },
      // 木星以上の異なる天体が速く（4px/step 以上）ぶつかったら（10秒に1回まで）。一瞬スローにし、2つを弾き離す。得点・合体は変えない
      // 境目は 6 だと20回のゲーム中4回でしか起きなかったので、4 に下げた（10回で起きる。M6 の見直し、2026-10-30）
      collision:{ minStage: 9, minSpeed: 4, cooldownSec: 10, slowSec: 0.6, slowScale: 0.25, knock: 5 },
      // 盤面を揺さぶるイベントの間と、そのあと天体が落ち着くまでは、デッドラインを越えてもゲームオーバーにしない
      calm: { types: ['flare', 'comet', 'storm', 'collision'], speed: 0.8, stillSec: 0.6, maxSec: 8 }
    },

    // 難易度（2026-10-31 作者の指示）。sizeMul＝天体（月〜中性子星）の半径の倍率、missiles＝1回のゲームで撃てるミサイルの数
    //   apocalypse … 今までの大きさ（先読みのボットで約1割クリアに合わせた。線越えを10秒にしたあとの測定では4回中0回）
    //   hard       … 天体を小さくして、先読みのボットで約3分の1クリア（0.8倍 8回中7回・0.85倍 4回中3回・0.9倍 5回中3回・0.93倍 12回中7回・0.94倍 4回中1回を見て、作者の指示で 0.94。2026-10-31）
    //   easy       … hard と同じ大きさに、好きな天体を1つ壊せるミサイルを3発
    difficulties: {
      easy:       { sizeMul: 0.94, missiles: 3 },
      hard:       { sizeMul: 0.94, missiles: 0 },
      apocalypse: { sizeMul: 1,   missiles: 0 }
    },
    missile: { flySec: 0.45, explodeSec: 0.7, explodeMul: 3.2 },   // 盤面の下から天体まで飛ぶ秒・爆発の絵を出す秒・爆発の大きさ（天体の半径の倍）

    // 第4章 盤面（論理座標）
    board: { width: 600, height: 900, dropY: 90, deadlineY: 150, wallThickness: 200,
             nameTopY: 4 },   // 落とす前の天体名の上端がこれより上（盤面の外＝情報ヘッダーの裏）になるなら、名前は天体の真ん中に出す

    // 第5章 天体進化表（spriteKey は assets/img/manifest.json のキー）
    // 並びは本当の大きさ（平均半径）の順。月 1,737 km < 水星 2,440 < 火星 3,390 < 金星 6,052 < 地球 6,371
    //   < 海王星 24,622 < 天王星 25,362 < 土星 58,232 < 木星 69,911 < 太陽 695,700。太陽より上は順を問わない
    //   （2026-10-29 作者の指示で地球と水星を入れ替えた。半径とスコアは段階ごとのまま）
    // 半径：地球（41）から上は1段ごとに1.19倍。クリアできるのが先読みのボットで約1割になるよう、約1.2倍から少し縮めた（第9.3節。2026-10-30）
    stages: [
      null,
      { name: '月',         spriteKey: 'moon',        radius: 20,  score: 0,   color: '#bdbdbd' },
      { name: '水星',       spriteKey: 'mercury',     radius: 24,  score: 30,  color: '#9ca3af' },
      { name: '火星',       spriteKey: 'mars',        radius: 29,  score: 60,  color: '#dc6b3a' },
      { name: '金星',       spriteKey: 'venus',       radius: 35,  score: 100, color: '#e8c27a' },
      { name: '地球',       spriteKey: 'earth',       radius: 41,  score: 150, color: '#3b82f6' },
      { name: '海王星',     spriteKey: 'neptune',     radius: 49,  score: 210, color: '#2563eb' },
      { name: '天王星',     spriteKey: 'uranus',      radius: 58,  score: 280, color: '#7dd3fc' },
      { name: '土星',       spriteKey: 'saturn',      radius: 69,  score: 360, color: '#d6b47a' },
      { name: '木星',       spriteKey: 'jupiter',     radius: 82,  score: 450, color: '#c08a5a' },
      { name: '太陽',       spriteKey: 'sun',         radius: 98,  score: 550, color: '#fbbf24' },
      { name: '超新星',     spriteKey: 'supernova',   radius: 117, score: 660, color: '#f0abfc' },
      { name: '中性子星',   spriteKey: 'neutronstar', radius: 139, score: 780, color: '#a5f3fc' },
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
      passR: 2.2,            // Rb × 2.2 より内側では天体どうしがすり抜ける（詰まり対策。2026-10-30 作者の回答 A）
      swirl: 0.2,            // 回る向きの成分（全体の約20%）
      absorbSec: 0.3,        // 吸収の演出
      growthPerSec: 1,       // 止まらないよう1秒ごとに足す
      digestPerSec: 10,      // 吸い込んだ分はいったん消化待ちにため、毎秒この分だけ成長に回す。600 まで最短約1分（2026-10-30 作者の回答 Q1=B）
      superGrowth: 600,      // 超巨大
      absorbScorePerStage: 20,
      superHoldSec: 2.5      // 「SUPERMASSIVE BLACK HOLE」を見せてから最終吸収へ
    },

    // 第12章・第13章 エンディング（時刻は各状態の開始からの秒）
    ending: {
      absorbSec: 7.0,        // FINAL_ABSORB 全体
      wallsAt: [1.0, 3.5],   // 盤面の箱（地・壁・床）を吸い込む時間帯
      hudAt: [2.5, 5.0],     // 情報ヘッダー・成長ゲージ・一時停止ボタンを吸い込む時間帯
      sweepAt: 5.0,          // 吸い残しの天体をまとめて吸い込む
      pulseAt: [5.2, 6.2],   // ブラックホールの最後の脈動
      bgmFadeSec: 6.5,       // BGM を徐々に小さくする長さ
      cellPx: 16,            // ゆがませる格子の一辺（画面の px）
      silenceSec: 3.0,       // SILENCE
      // BIGBANG（2026-10-30 作者の指示で作り直し）：収縮 → 黒い画面5秒 → 中央に光の点 → 左右に広がって白い線
      //   → 爆発（白い中心が画面いっぱいに）→ ホワイトアウト → だんだん透けて、描いてある宇宙が見える → 膨張
      collapseSec: 0.8,      // 収縮して消える
      dotAt: 5.8,            // 黒い画面を5秒残してから、白い光の点
      lineAt: 5.8, lineSec: 0.2, // 点が現れると同時に左右へ広がり白い線に（点から爆発まで約0.25秒。2026-10-30 作者の指示）
      burstAt: 6.05,         // 爆発（ここで bigbangFlash）
      whiteAt: 7.85,         // 画面全体が白くなる
      whiteHoldSec: 0.5,     // 真っ白のまま
      revealSec: 4.0,        // だんだん透明になって宇宙が見えてくる
      musicAt: 7.85,         // エンディングの曲：画面が真っ白になったところから（2026-10-30 作者の指示で早めた）
      expandAt: 12.35,       // 宇宙の膨張（星が流れ始める）
      bigbangSec: 14.35,     // BIGBANG 全体
      rollSec: 80,           // クレジットを流す長さの仮の値。実際は main.js が文字の量と下の速さから決める
      rollPxPerSec: 40,      // クレジットを流す速さ（画面の px／秒）
      thanksStopAt: 0.1,     // 「Thank you for playing」は画面の高さのこの位置まで来たら、そこに残す（2026-10-30 作者の指示）
      leadGap: 0.05,         // つなぎの文は「Thank you」の下にこの間隔（画面の高さの割合）を空けて止める
      recipeIntervalSec: 10, // レシピのブロックを出す間隔。曲の終わりから逆算して始める
      recipeLoop: 2,         // 曲の何周目の終わりに出すか。出すのはこの1回だけ（2026-10-30 作者の指示）
      songSecFallback: 200,  // 曲の長さが分からないとき（音を出せない環境）の仮の長さ
      bgAlpha: 0.3           // エンドロールの背景画像の濃さ（第13.1節）
    },

    // 第6.3節 出現テーブル：到達した最高段階 → 出現範囲 [下限, 上限]
    // 範囲の引き上げは、1段早くした（第9.3節の調整。2026-10-30）
    spawnTable: [
      { upToMaxStage: 7,  range: [1, 5] },
      { upToMaxStage: 8,  range: [1, 6] },
      { upToMaxStage: 9,  range: [2, 6] },
      { upToMaxStage: 10, range: [2, 7] },
      { upToMaxStage: 99, range: [3, 7] }
    ],
    // 範囲の下から順の確率（%）。5段階以外の範囲では 30→10 の直線で按分して合計100に正規化する
    spawnWeights5: [30, 25, 20, 15, 10],
    maxSameInARow: 3, // 同じ天体は4回以上連続させない

    // 第6.1節・第6.4節 操作
    input: {
      tapMaxMs: 250, tapMaxMovePx: 10, // 論理座標ではなく画面上の px
      dropCooldownMs: 500,
      holdRepeatMs: 600, // 押したまま（指・マウス・Space）この時間たつと、連打防止の間隔で続けて落とす（2026-10-31）
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
    // 線を越えたまま overSec 秒続いたらゲームオーバー（2.0 → 10。2026-10-31 作者の指示）。警告中は警告音を鳴らし続け、残りの秒を出す
    gameOver: { settleAgeSec: 1.0, overSec: 10.0, warnSec: 0.5 },

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
      // 天体の一覧の本体の半径（枠の半分に対する割合。2026-10-31）。[0] がふつう。超新星（11）・中性子星（12）は光が薄く小さく見えるので大きめ
      listBodyScale: { 0: 0.8, 11: 1.05, 12: 1.05 },
      starCount: 220
    },

    // 第16章 効果音（2026-10-30 作者が試聴して決めた。Sound_List v1_02）
    se: {
      files: {
        event:   'sfx/eye-shine1.mp3',          // 特殊イベントの予告・惑星衝突：効果音ラボ「きらーん1」
        drop:    'sfx/knife-throw1.mp3',        // 落下：効果音ラボ「ナイフを投げる」
        merge:   'sfx/puyon1.mp3',              // 合体：効果音ラボ「ぷよん」。天体の段階ごとに高さを変える
        bhBirth: 'sfx/buun1.mp3',               // ブラックホール誕生：効果音ラボ「ブウーン（重低音）」
        bhTier:  'sfx/buun1.mp3',               // 成長段階アップ：同じ音
        absorb:  'sfx/magic-drain1.mp3',        // 吸収：効果音ラボ「HP吸収魔法1」
        warn:    'sfx/news-title4.mp3',         // 警告（デッドライン）：効果音ラボ「ニュースタイトル表示4」
        bigbang: 'sfx/bigbang1.mp3',            // ビッグバン：効果音ラボ「爆発4」＋「大爆発1」を重ねたもの。合成の重低音も一緒に鳴らす
        button:  '../../assets/se/se-button.mp3', // ボタン：共通 se-button（Taira Komori、CC BY 4.0。表記が要る）
        pause:   '../../assets/se/se-pause.mp3'   // 一時停止：共通 se-pause（Freesound BaggoNotes、CC0）
      },
      // land（着地・衝突）はプログラムで作る小さな「とん」
      vol:      { event: 0.3, drop: 0.8, land: 0.5, merge: 0.9, bhBirth: 1, bhTier: 0.8, absorb: 0.8, warn: 0.7, button: 0.6, pause: 0.6, bigbang: 1, rumble: 1 },
      minGapMs: { event: 500, drop: 60, land: 70, merge: 40, bhBirth: 500, bhTier: 500, absorb: 150, warn: 500, button: 40, pause: 40 }, // 同じ音を続けて鳴らす最短の間
      maxVoices:{ land: 4, merge: 4, absorb: 3 },  // 同時に鳴らす数の上限（書いていない音は2）
      landMinSpeed: 2.5,     // これより遅い衝突では「とん」を鳴らさない（px/step）
      landFullSpeed: 12      // この速さで最大の音量
    },

    bgmCrossSec: 4,   // 超新星ができたとき、easy の曲から緊迫感のある曲へ重ねて切り替える秒数（2026-10-31）

    storageKeys: { highScore: 'momoCosmos.highScore', clearCount: 'momoCosmos.clearCount', settings: 'momoCosmos.settings' },

    // 第18.4節 設定パネルの既定値（音は M5 で鳴らす。今は値だけ保存する）
    settingsDefault: { se: 100, bgm: 40, seMute: false, bgmMute: false, events: true, debugPanel: true, difficulty: 'easy' },   // 難易度の初期値は easy

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
