/*
 * MOMO Cosmos — 言語（仕様書 第24章）
 * 共通ライブラリ momo-lang v1.11 を使う。判定・保存・アプリ間の引き継ぎは momo-lang に任せ、
 * 辞書・文言の差し替え・猫語はこのファイルに持つ（Fireworks v0.67 と同じ作り）。
 */
(function (root) {
  'use strict';

  const LANG_APP_ID = 'cosmos';
  const SUPPORTED_LANGS = ['ja', 'en', 'zh', 'cat'];
  if (root.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: SUPPORTED_LANGS });

  function detectFallback() {
    try {
      const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
      for (let i = 0; i < list.length; i++) {
        const l = (list[i] || '').toLowerCase();
        if (l.indexOf('ja') === 0) return 'ja';
        if (l.indexOf('zh') === 0) return 'zh';
        if (l.indexOf('en') === 0) return 'en';
      }
      return 'en';
    } catch (e) { return 'ja'; }
  }

  // ---- 辞書 -----------------------------------------------------------------
  // GAME OVER・SCORE・START など演出や見出しの英字は、どの言語でも英語のまま（第24.5節）
  const I18N = {
    ja: {
      subtitle: 'Merge the Stars, Birth a Universe',
      // 説明はあいまいにし、ブラックホールと宇宙の誕生は遊んで驚いてもらう（2026-10-30 作者の指示）
      howTo: '同じ天体どうしをぶつけると、ひとつ大きな天体に育ちます。天体を育てて、あなたの宇宙を作りましょう。',
      start: 'START', score: 'SCORE', high: 'HIGH', next: '次', nextNext: '次々',
      highScore: 'ハイスコア',
      pause: '一時停止', paused: '一時停止',
      resume: '再開', restart: '最初から', settings: '設定', toTitle: 'タイトルへ',
      confirmRestart: '最初からやり直しますか？',
      confirmTitle: 'タイトルに戻りますか？（このプレイは記録されません）',
      yes: 'はい', no: 'いいえ',
      gameOver: 'GAME OVER', retry: 'もう一度', maxReached: '到達した天体', newRecord: 'ハイスコア更新',
      clearMark: 'クリア',   // タイトルのクリアの印（第13.3節）
      bhBornSub: 'ブラックホール誕生', bhSuperSub: '超巨大ブラックホール',
      bhGauge: 'ブラックホール', bhTier0: '小型', bhTier1: '中型', bhTier2: '大型', bhTier3: '超巨大',
      board: '盤面',
      // 設定パネル（第18.4節）
      setTitle: '設定', setSe: '効果音', setBgm: 'BGM', setMute: 'ミュート',
      setSoundNote: '効果音はまだ入っていません（BGM は鳴ります）',
      musicTitle: '音楽を再生しますか？', musicBody: 'BGM と効果音を再生してもよろしいですか？（あとで歯車の設定から変えられます）',
      musicNo: '再生しない', musicYes: '再生する',
      setEvents: '特殊イベント', setEventsNote: '流星群などの突然の出来事（準備中）',
      setCredits: 'クレジット', setOpen: '開く', setVersion: 'バージョン',
      setDebug: 'デバッグ表示', setClose: '閉じる',
      // クレジット（第18.5節）
      credTitle: 'クレジット',
      credApp: 'アプリ', credPhysics: '物理エンジン', credImages: '画像のクレジット', credFonts: 'フォント', credTerms: '利用規約',
      credImgGen: 'AI 画像生成：OpenAI ChatGPT Images', credImgDir: '画像の監修・選定：MOMO Works',
      credImagesBody: 'このゲームの画像は、OpenAI の ChatGPT Images の支援を受けて AI で生成し、選んで使っています。',
      credBgm: 'BGM', credBgmBody: 'MOMO Works（作者本人が作った曲）',
      credSoundNote: '効果音のクレジットは、効果音を入れるときに追加します。',
      credTermsLink: 'MOMO Works 利用規約',
      // フッター
      footAbout: 'MOMO Cosmos について',
      footDesc: '同じ天体どうしをぶつけて、ひとつ大きな天体に育てていく落ち物パズルです。月から始めて、どこまで育てられるか。天体を育てて、あなたの宇宙を作りましょう。ブラウザだけで遊べ、登録もインストールもいりません。',
      footTop: 'MOMO Works トップ', footGames: 'ゲーム一覧', footTools: 'ツール一覧',
      stages: ['', '月', '水星', '火星', '金星', '地球', '海王星', '天王星', '土星', '木星', '太陽', '超新星', '中性子星', 'ブラックホール']
    },
    en: {
      subtitle: 'Merge the Stars, Birth a Universe',
      howTo: 'Drop celestial bodies and bump matching ones together to grow them into something bigger. Grow your celestial bodies and build a universe of your own.',
      start: 'START', score: 'SCORE', high: 'HIGH', next: 'Next', nextNext: 'After',
      highScore: 'High score',
      pause: 'Pause', paused: 'Paused',
      resume: 'Resume', restart: 'Restart', settings: 'Settings', toTitle: 'Title',
      confirmRestart: 'Start over from the beginning?',
      confirmTitle: 'Return to the title? (This game will not be recorded.)',
      yes: 'Yes', no: 'No',
      gameOver: 'GAME OVER', retry: 'Play again', maxReached: 'Reached', newRecord: 'New high score!',
      clearMark: 'Cleared',
      // エンドロールは言語設定にかかわらず英語だけ（2026-10-30 作者の指示）。index.html に英語で書き、
      // 最後のレシピだけここに置く。p つなぎの文／t 料理名／h 見出し／i 材料／e 締め
      recipe: [
        ["p", "The universe was compressed into a single point."],
        ["p", "Everything ceased to exist."],
        ["p", "One truth remained:"],
        ["p", "even a newborn universe needs energy."],
        ["t", "Cosmic Teriyaki Chicken"],
        ["h", "Ingredients (serves 2)"],
        ["i", "Chicken thighs, skin-on, boneless — 500 g"],
        ["i", "Soy sauce (dark matter) — 2 tbsp"],
        ["i", "Mirin — 2 tbsp"],
        ["i", "Sake — 2 tbsp"],
        ["i", "Sugar — 1 tbsp"],
        ["i", "Cooking oil — 1 tbsp"],
        ["h", "PHASE 1　Initiation"],
        ["p", "Prick the skin with a fork."],
        ["p", "Mix the soy sauce, mirin, sake and sugar."],
        ["h", "PHASE 2　Thermal Fusion"],
        ["p", "Heat the oil over medium-high heat."],
        ["p", "Cook skin-side down for 5 minutes, until golden."],
        ["h", "PHASE 3　Equilibrium"],
        ["p", "Turn over, cover, and cook on low heat for 4–5 minutes."],
        ["p", "Wipe away the excess oil with a paper towel."],
        ["h", "PHASE 4　Critical Mass"],
        ["p", "Pour in the sauce."],
        ["p", "Spoon it over the chicken until it thickens into a glaze."],
        ["h", "PHASE 5　Rebirth"],
        ["p", "Slice, and serve warm over rice."],
        ["e", "The new universe is online."],
        ["e", "See you in the next Big Bang."]
      ],
      bhBornSub: '', bhSuperSub: '',
      bhGauge: 'Black hole', bhTier0: 'Small', bhTier1: 'Medium', bhTier2: 'Large', bhTier3: 'Supermassive',
      board: 'Board',
      setTitle: 'Settings', setSe: 'Sound effects', setBgm: 'BGM', setMute: 'Mute',
      setSoundNote: 'Sound effects are not added yet (BGM plays).',
      musicTitle: 'Play sound?', musicBody: 'Is it OK to play BGM and sound effects? (You can change this later from the gear settings.)',
      musicNo: "Don't play", musicYes: 'Play',
      setEvents: 'Special events', setEventsNote: 'Sudden happenings such as meteor showers (coming soon)',
      setCredits: 'Credits', setOpen: 'Open', setVersion: 'Version',
      setDebug: 'Debug panel', setClose: 'Close',
      credTitle: 'Credits',
      credApp: 'App', credPhysics: 'Physics engine', credImages: 'Image Credits', credFonts: 'Fonts', credTerms: 'Terms of use',
      credImgGen: 'AI Image Generation: OpenAI ChatGPT Images', credImgDir: 'Image Direction & Selection: MOMO Works',
      credImagesBody: "AI-generated images were created with assistance from OpenAI's ChatGPT Images and selected for use in this game.",
      credBgm: 'BGM', credBgmBody: 'MOMO Works (original music by the author)',
      credSoundNote: 'Credits for sound effects will be added when they are added.',
      credTermsLink: 'MOMO Works Terms of Use',
      footAbout: 'About MOMO Cosmos',
      footDesc: 'A falling-block puzzle where you merge matching celestial bodies into bigger ones. Start with the Moon, see how far you can grow them, and build a universe of your own. Plays in your browser — no sign-up, no install.',
      footTop: 'MOMO Works Home', footGames: 'Games', footTools: 'Tools',
      stages: ['', 'Moon', 'Mercury', 'Mars', 'Venus', 'Earth', 'Neptune', 'Uranus', 'Saturn', 'Jupiter', 'Sun', 'Supernova', 'Neutron star', 'Black hole']
    },
    zh: {
      subtitle: '合并星辰，孕育宇宙',
      howTo: '让相同的天体相撞，就会合成更大的天体。培育天体，创造属于你的宇宙吧。',
      start: 'START', score: 'SCORE', high: 'HIGH', next: '下一个', nextNext: '再下一个',
      highScore: '最高分',
      pause: '暂停', paused: '暂停',
      resume: '继续', restart: '重新开始', settings: '设置', toTitle: '返回标题',
      confirmRestart: '要从头重新开始吗？',
      confirmTitle: '要返回标题吗？（本局不会被记录）',
      yes: '是', no: '否',
      gameOver: 'GAME OVER', retry: '再来一次', maxReached: '到达的天体', newRecord: '刷新最高分',
      clearMark: '通关',
      bhBornSub: '黑洞诞生', bhSuperSub: '超大质量黑洞',
      bhGauge: '黑洞', bhTier0: '小型', bhTier1: '中型', bhTier2: '大型', bhTier3: '超大质量',
      board: '棋盘',
      setTitle: '设置', setSe: '音效', setBgm: 'BGM', setMute: '静音',
      setSoundNote: '尚未加入音效（BGM 会播放）',
      musicTitle: '要播放声音吗？', musicBody: '可以播放 BGM 和音效吗？（之后可以在齿轮设置中更改）',
      musicNo: '不播放', musicYes: '播放',
      setEvents: '特殊事件', setEventsNote: '流星雨等突发事件（准备中）',
      setCredits: '版权信息', setOpen: '打开', setVersion: '版本',
      setDebug: '调试面板', setClose: '关闭',
      credTitle: '版权信息',
      credApp: '应用', credPhysics: '物理引擎', credImages: '图像版权', credFonts: '字体', credTerms: '使用条款',
      credImgGen: 'AI 图像生成：OpenAI ChatGPT Images', credImgDir: '图像指导与挑选：MOMO Works',
      credImagesBody: '本游戏的图像借助 OpenAI 的 ChatGPT Images 由 AI 生成，并经挑选后使用。',
      credBgm: 'BGM', credBgmBody: 'MOMO Works（作者本人创作的乐曲）',
      credSoundNote: '音效的版权信息将在加入音效时补充。',
      credTermsLink: 'MOMO Works 使用条款',
      footAbout: '关于 MOMO Cosmos',
      footDesc: '让相同的天体相撞、合成更大天体的下落式益智游戏。从月球开始，看看你能培育到哪一步，创造属于你的宇宙吧。在浏览器中即可游玩，无需注册和安装。',
      footTop: 'MOMO Works 首页', footGames: '游戏列表', footTools: '工具列表',
      stages: ['', '月球', '水星', '火星', '金星', '地球', '海王星', '天王星', '土星', '木星', '太阳', '超新星', '中子星', '黑洞']
    }
  };

  // ---- 状態 -----------------------------------------------------------------
  let langMode = root.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
  let currentLang = root.MomoLang ? MomoLang.resolve(LANG_APP_ID)
    : (langMode === 'auto' ? detectFallback() : (SUPPORTED_LANGS.includes(langMode) ? langMode : detectFallback()));

  function catBase() {
    const b = root.MomoLang ? MomoLang.getCatBase(LANG_APP_ID) : detectFallback();
    return I18N[b] ? b : 'ja';
  }
  /** 猫語のときは系統言語、それ以外は表示言語 */
  function baseLang() { return currentLang === 'cat' ? catBase() : currentLang; }

  /* 猫語：文言の種類（エラー系／通常）でランダムな鳴き声。系統は MomoLang.getCatBase から取る */
  function catSpeak(key) {
    const isError = /[Ee]rror/.test(key);
    const cb = catBase();
    const pick = a => a[Math.floor(Math.random() * a.length)];
    if (cb === 'en') return isError ? pick(['HISS!', 'SPIT!', 'FSSST!', 'HISSS!']) : pick(['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!']);
    if (cb === 'zh') return isError ? pick(['唾！', '喵喵！', '！！']) : pick(['喵', '喵喵', '咪', '喵～']);
    return isError ? pick(['シャー！', 'フーッ！', 'シャシャシャ！', 'シャッ！']) : pick(['にゃあ', 'にゃ', 'にゃーん', 'みゃぁ', 'にゃ！']);
  }

  // 猫語でも英字のまま出す見出し（第24.5節の演出の文字と同じ扱い）
  const FIXED = new Set(['start', 'score', 'high', 'gameOver', 'setBgm']);

  /** 表示言語で引く（猫語なら鳴き声） */
  function t(key) {
    if (currentLang === 'cat' && !FIXED.has(key)) return catSpeak(key);
    return tBase(key);
  }
  /** 猫語のときも系統言語で引く（サブタイトル・説明文・クレジット・フッター。第24.4節） */
  function tBase(key) {
    const d = I18N[baseLang()] || I18N.ja;
    return d[key] !== undefined ? d[key] : (I18N.ja[key] !== undefined ? I18N.ja[key] : key);
  }
  /**
   * 天体名。猫語のときにどう出すかは第21章の未決事項（M1 で表示を見て決める）。
   * config.js の catStageNames で切り替える：'base'＝系統言語のまま／'cat'＝鳴き声
   */
  function stageName(stage, C) {
    if (currentLang === 'cat' && C && C.catStageNames === 'cat') return catSpeak('stage');
    return (I18N[baseLang()] || I18N.ja).stages[stage] || '';
  }

  const listeners = [];
  function setMode(mode) {
    langMode = mode;
    currentLang = root.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
      : (mode === 'auto' ? detectFallback() : (SUPPORTED_LANGS.includes(mode) ? mode : detectFallback()));
    listeners.forEach(fn => fn(currentLang));
  }

  root.CosmosI18n = {
    t, tBase, stageName, setMode, baseLang,
    /** 英語の辞書から引く（エンドロール用） */
    en(key) { return I18N.en[key]; },
    onChange(fn) { listeners.push(fn); },
    get mode() { return langMode; },
    get lang() { return currentLang; },
    /** <html lang> に入れる値 */
    htmlLang() { const b = baseLang(); return b === 'zh' ? 'zh-Hans' : b; }
  };
})(window);
