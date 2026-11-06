// 画面の文言表。日本語・英語・中国語と猫語（CAT）。言語の選び方は i18n/langMode.ts（lib/momo-lang）
// 画面・説明文にメーカー名・商品名・品番を出さない（仕様書 §2.6）。昔の形の枠は「レガシー」と呼ぶ

export type Lang = 'ja' | 'en' | 'zh' | 'cat';
/** 猫語の鳴き声の系統（猫語を選ぶ前の言語） */
export type CatBase = 'ja' | 'en' | 'zh';

const ja = {
  title: 'MOMO Polyomino',
  lang: '言語',
  selectLevel: 'レベルを選ぶ',
  levelLabel: (n: number) => `LEVEL ${n}`,
  variant: { simple: 'シンプル', legacy: 'レガシー' } as Record<'simple' | 'legacy', string>,
  /** 駒の大きさの呼び名（n マスの駒） */
  family: (n: number) =>
    (['', 'モノミノ', 'ドミノ', 'トロミノ', 'テトロミノ', 'ペントミノ', 'ヘキソミノ', 'ヘプトミノ', 'オクトミノ'][n] || `${n}マスの駒`),
  /** 例：「5 種 × 2 個・40 マス」 */
  levelInfo: (kinds: number, count: number, cells: number) =>
    `${kinds} 種${count > 1 ? ` × ${count} 個` : ''}・${cells} マス`,
  legacyNote: 'レガシー＝昔からあるプラスチックのパズルと同じ形の枠',
  simpleNote: 'シンプル＝このゲームで用意した形の枠',
  back: 'レベル選択へ',
  backTitle: 'レベルを選ぶ画面に戻る',
  pieces: '駒',
  /** 駒リストの見出し（例：「残り 5 / 10」） */
  remaining: (left: number, total: number) => `残り ${left} / ${total}`,
  boardLabel: '盤面',
  pieceAria: (name: string) => `駒 ${name}`,
  /** 駒を選んだが、まだ盤面に触れていないとき */
  placeHint: (name: string) => `${name} を選びました。盤面に触れると置けます`,
  /** マウスで駒をつかんでいるとき（PC） */
  mouseHint: (name: string) => `${name}：クリックで置く・ホイールで回す・ホイールクリックで裏返す・右クリックでやめる・右のリストでクリックするとリストへ戻す`,
  rotate: '回す（押しながらなぞると好きな向きへ）',
  flip: '裏返す（左右）',
  confirm: 'ここに置く',
  toList: 'リストへ戻す',
  /** ヒント（§8） */
  hint: 'ヒント',
  hintTitle: '今の置き方から完成できる駒を1つ、正しい場所に仮置きします',
  hintComputing: 'ヒントを計算中…',
  hintBusy: '計算に時間がかかっています。中断しますか？',
  hintStop: '中断する',
  hintContinue: '続ける',
  hintTimeout: '計算に時間がかかりすぎるため、ヒントの計算を中断しました',
  hintNone: '今の置き方からは完成できません。置いた駒を見直してください',
  hintConflict: '重なっている駒や、はみ出した駒があると、ヒントを出せません',
  cancel: 'やめる',
  zoomIn: '拡大',
  zoomOut: '縮小',
  zoomFit: '盤面全体を表示',
  scroll: { up: '上へ', down: '下へ', left: '左へ', right: '右へ' } as Record<'up' | 'down' | 'left' | 'right', string>,
  listUp: '駒リストを上へ',
  listDown: '駒リストを下へ',
  reset: '最初から',
  resetConfirm: '盤面の駒をすべて外して、最初からやり直しますか？',
  /** 開始時に完成形を見せている間の案内（§6.1） */
  revealHint: '完成形のひとつ。触れるとすぐ始まります',
  timeLabel: 'かかった時間',
  congrats: 'おめでとう！',
  completeTime: (t: string) => `タイム ${t}`,
  bestTime: (t: string) => `ベスト ${t}`,
  newRecord: '新記録！',
  playAgain: 'もう一度',
  /** iPhone・iPad の Safari の保存の注意（§10） */
  iosNotice: 'iPhone・iPad の Safari では、このサイトを 7 日間開かないと、遊びかけの盤面とベストタイムが消えることがあります。',
  close: '閉じる',

  footAbout: 'MOMO Polyomino について',
  footDesc:
    'MOMO Polyomino は、ブラウザで遊べる無料のポリオミノ敷き詰めパズルです。昭和生まれならわかる、プラスチックのピースを枠に埋めていく、あのパズルです。' +
    '正方形を辺でつないだ同じ大きさの駒を全種類使って、枠にすき間なく敷き詰めます。駒の大きさ（レベル）は自由に選べます。アカウント登録もインストールも不要で、ブラウザだけですぐに遊べます。',
  footTop: 'MOMO Works トップ',
  footGames: 'ゲーム一覧',
  footTools: 'ツール一覧',
};

export type Strings = typeof ja;

const en: Strings = {
  title: 'MOMO Polyomino',
  lang: 'Language',
  selectLevel: 'Choose a level',
  levelLabel: (n) => `LEVEL ${n}`,
  variant: { simple: 'Simple', legacy: 'Legacy' },
  family: (n) =>
    (['', 'Monomino', 'Domino', 'Tromino', 'Tetromino', 'Pentomino', 'Hexomino', 'Heptomino', 'Octomino'][n] || `${n}-omino`),
  levelInfo: (kinds, count, cells) =>
    `${kinds} ${kinds === 1 ? 'kind' : 'kinds'}${count > 1 ? ` × ${count}` : ''} · ${cells} ${cells === 1 ? 'square' : 'squares'}`,
  legacyNote: 'Legacy = the same frame as the classic plastic puzzle',
  simpleNote: 'Simple = a frame made for this game',
  back: 'Levels',
  backTitle: 'Back to the level list',
  pieces: 'Pieces',
  remaining: (left, total) => `${left} / ${total} left`,
  boardLabel: 'Board',
  pieceAria: (name) => `Piece ${name}`,
  placeHint: (name) => `${name} selected. Touch the board to place it`,
  mouseHint: (name) => `${name}: click to place · wheel to rotate · wheel-click to flip · right-click to cancel · click the list to put it back`,
  rotate: 'Rotate (press and trace around to turn freely)',
  flip: 'Flip (left-right)',
  confirm: 'Place here',
  toList: 'Back to the list',
  hint: 'Hint',
  hintTitle: 'Place one piece where it fits in a solution from your current board',
  hintComputing: 'Working out a hint…',
  hintBusy: 'This is taking a while. Stop?',
  hintStop: 'Stop',
  hintContinue: 'Keep going',
  hintTimeout: 'The hint took too long, so it was stopped',
  hintNone: 'The board cannot be completed from here. Try moving some pieces',
  hintConflict: 'No hint while pieces overlap or stick out of the board',
  cancel: 'Cancel',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomFit: 'Show the whole board',
  scroll: { up: 'Up', down: 'Down', left: 'Left', right: 'Right' },
  listUp: 'Scroll the piece list up',
  listDown: 'Scroll the piece list down',
  reset: 'Restart',
  resetConfirm: 'Remove every piece from the board and start over?',
  revealHint: 'One way to solve it. Touch to start right away',
  timeLabel: 'Time',
  congrats: 'Well done!',
  completeTime: (t) => `Time ${t}`,
  bestTime: (t) => `Best ${t}`,
  newRecord: 'New record!',
  playAgain: 'Play again',
  iosNotice: 'On iPhone and iPad Safari, your unfinished board and best times may be erased if you do not open this site for 7 days.',
  close: 'Close',

  footAbout: 'About MOMO Polyomino',
  footDesc:
    "MOMO Polyomino is a free polyomino tiling puzzle you can play in your browser. Anyone who grew up in the '70s or '80s will remember it: the puzzle where you fill a tray with plastic pieces. " +
    'Use every piece of one size, made of squares joined edge to edge, and fill the frame with no gaps. Pick the piece size (level) you like. No sign-up and no install: just open it in your browser and play.',
  footTop: 'MOMO Works Home',
  footGames: 'Games',
  footTools: 'Tools',
};

const zh: Strings = {
  title: 'MOMO Polyomino',
  lang: '语言',
  selectLevel: '选择等级',
  levelLabel: (n) => `LEVEL ${n}`,
  variant: { simple: '简单', legacy: '传统' },
  family: (n) => (n === 2 ? '多米诺骨牌' : `${n}格骨牌`),
  levelInfo: (kinds, count, cells) => `${kinds} 种${count > 1 ? ` × ${count} 个` : ''}，${cells} 格`,
  legacyNote: '传统＝与经典塑料拼图相同形状的框',
  simpleNote: '简单＝本游戏准备的框',
  back: '等级列表',
  backTitle: '返回选择等级的画面',
  pieces: '骨牌',
  remaining: (left, total) => `剩余 ${left} / ${total}`,
  boardLabel: '棋盘',
  pieceAria: (name) => `骨牌 ${name}`,
  placeHint: (name) => `已选择 ${name}。触摸棋盘即可放置`,
  mouseHint: (name) => `${name}：单击放置 · 滚轮旋转 · 按下滚轮翻转 · 右键取消 · 单击右侧列表放回`,
  rotate: '旋转（按住并沿周围滑动可自由旋转）',
  flip: '翻转（左右）',
  confirm: '放在这里',
  toList: '放回列表',
  hint: '提示',
  hintTitle: '根据当前棋盘，把一块骨牌暂放到能完成的位置',
  hintComputing: '正在计算提示…',
  hintBusy: '计算需要较长时间。要中止吗？',
  hintStop: '中止',
  hintContinue: '继续',
  hintTimeout: '计算时间过长，已中止提示计算',
  hintNone: '按当前的摆法无法完成。请重新调整已放的骨牌',
  hintConflict: '有重叠或超出棋盘的骨牌时，无法给出提示',
  cancel: '取消',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomFit: '显示整个棋盘',
  scroll: { up: '向上', down: '向下', left: '向左', right: '向右' },
  listUp: '骨牌列表向上',
  listDown: '骨牌列表向下',
  reset: '重新开始',
  resetConfirm: '要移除棋盘上的所有骨牌并重新开始吗？',
  revealHint: '这是其中一种完成形。触摸即可开始',
  timeLabel: '用时',
  congrats: '恭喜完成！',
  completeTime: (t) => `用时 ${t}`,
  bestTime: (t) => `最佳 ${t}`,
  newRecord: '新纪录！',
  playAgain: '再玩一次',
  iosNotice: '在 iPhone、iPad 的 Safari 中，如果 7 天没有打开本网站，未完成的棋盘和最佳用时可能会被清除。',
  close: '关闭',

  footAbout: '关于 MOMO Polyomino',
  footDesc:
    'MOMO Polyomino 是一款可在浏览器中免费游玩的多格骨牌拼图。70后、80后都玩过的那种把塑料块填满格子的拼图。' +
    '使用同样大小、由正方形边边相连组成的全部骨牌，把框填满、不留空隙。可以自由选择骨牌的大小（等级）。无需注册，无需安装，打开浏览器即可游玩。',
  footTop: 'MOMO Works 首页',
  footGames: '游戏列表',
  footTools: '工具列表',
};

/**
 * サブタイトル（app-card-design §4。日本語の画面でも英語。猫語のときは猫語を選ぶ前の言語のまま）。
 * 2026-11-05 利用者が決定：昔からある遊び（レトロなルール）と、果てしなく選べる大きさ（レベル）を掛け合わせた言葉
 */
export const SUBTITLE: Record<CatBase, string> = {
  ja: 'Retro Rule, Endless Room',
  en: 'Retro Rule, Endless Room',
  zh: '复古规则，无尽空间',
};

// ── 猫語（CAT。MOMO Works 共通の流儀：辞書は持たず、文言の種類で鳴き声を選ぶ）
const CAT_VOCAB: Record<CatBase, { error: string[]; calm: string[]; normal: string[] }> = {
  ja: {
    error: ['シャー！', 'フーッ！', 'シャシャシャ！'],
    calm: ['ごろごろ…', 'にゃ…', 'ぐるぐる…'],
    normal: ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！'],
  },
  en: {
    error: ['HISS!', 'SPIT!', 'FSSST!'],
    calm: ['purrrr...', 'mrrr...', 'prrr...'],
    normal: ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'],
  },
  zh: {
    error: ['嘶！', '哈！', '嘶嘶！'],
    calm: ['呼噜…', '喵…', '咕噜…'],
    normal: ['喵', '喵喵', '喵呜', '喵！'],
  },
};
const ERROR_KEYS = new Set<string>(['resetConfirm', 'hintNone', 'hintConflict', 'hintTimeout']);
const CALM_KEYS = new Set(['legacyNote', 'simpleNote', 'revealHint', 'iosNotice', 'mouseHint']);
/** 猫語にしない文言（名前・数の書式） */
const KEEP_KEYS = new Set(['title', 'levelLabel']);
/**
 * 猫語でも、猫語を選ぶ前の言語のまま出す文言。
 * 説明文は「昭和生まれならわかる…」の一文を必ず含める決まり（仕様書 §9.6）なので、鳴き声に置き換えない。
 * タイムの表示も、数字が読めないと困るので元の言語のまま
 */
const BASE_KEYS = new Set(['footDesc', 'footTop', 'footGames', 'footTools', 'completeTime', 'bestTime']);

const TABLE: Record<CatBase, Strings> = { ja, en, zh };

/**
 * 猫語の表を作る。鳴き声は作ったときに 1 回だけ選ぶ（画面が書き換わるたびに変わると読めないため）。
 * 文字は鳴き声に、関数は同じ鳴き声を返す関数に、入れ子の表は中身ごと置き換える
 */
export function catStrings(base: CatBase, random: () => number = Math.random): Strings {
  const vocab = CAT_VOCAB[base];
  const pick = (key: string) => {
    const list = ERROR_KEYS.has(key) ? vocab.error : CALM_KEYS.has(key) ? vocab.calm : vocab.normal;
    return list[Math.floor(random() * list.length)];
  };
  const convert = (key: string, value: unknown): unknown => {
    if (KEEP_KEYS.has(key)) return value;
    if (BASE_KEYS.has(key)) return (TABLE[base] as Record<string, unknown>)[key];
    if (typeof value === 'string') return pick(key);
    if (typeof value === 'function') {
      const meow = pick(key);
      return () => meow;
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(key, v)]));
    }
    return value;
  };
  return Object.fromEntries(Object.entries(ja).map(([k, v]) => [k, convert(k, v)])) as Strings;
}

export let S: Strings = ja;
let current: { lang: Lang; catBase: CatBase } = { lang: 'ja', catBase: 'ja' };

/** 言語を切り替える（猫語なら、鳴き声の系統も） */
export function setLang(lang: Lang, catBase: CatBase = 'ja'): void {
  current = { lang, catBase };
  S = lang === 'cat' ? catStrings(catBase) : TABLE[lang];
}

/** 猫語のときは猫語を選ぶ前の言語（サブタイトルなど、鳴き声にすると意味が消えるもの用） */
export function baseLang(): CatBase {
  return current.lang === 'cat' ? current.catBase : current.lang;
}

export function currentLang(): Lang {
  return current.lang;
}
