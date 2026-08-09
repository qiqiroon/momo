/**
 * 多言語（第3分冊 14章）
 *
 * 本モジュールは**文言の解決のみ**を担う（14.2 の `LocaleModule`）。
 * 言語モード（auto を含む）の判定・保存・アプリ間引き継ぎは MOMO 共通ライブラリ
 * `momo-lang` の役目であり、その橋渡しは `src/momo-lang/init.ts` が行う（実装指示書 段階6）。
 *
 * 猫語は辞書を持たず、キーの性質に応じた鳴き声を返す（MOMO Works 共通の流儀）。
 * 語彙は `catBase`（猫語を選ぶ直前の言語）で切り替わる。
 */

import type { LocaleCode } from '../data/types';

export type MessageKey = string;

/** 猫語の語彙を選ぶ「直前の言語」 */
export type CatBase = 'ja' | 'en' | 'zh';

type Dict = Record<MessageKey, string>;

// ---------------------------------------------------------------- 辞書（14.3 の3階層命名）

const ja: Dict = {
  'header.title.subtitle': "You'll call it Su-doom.",
  'footer.about': 'MOMO Sudoku について',
  'footer.desc':
    '1×1 から 49×49 まで選べる可変サイズのナンバープレイス。Easy・Hard・Apocalypse の3段階。9×9 では物足りない数字好きの方へ。解きかけは保存され、何日でもかけてじっくり取り組めます。登録不要・インストール不要。',
  'footer.top': 'MOMO Works トップ',
  'footer.games': 'ゲーム一覧',
  'footer.tools': 'ツール一覧',
  'header.settings.open': '音と触覚の設定',
  'header.locale.label': '言語',

  'settings.sound.enabled': '効果音',
  'settings.sound.volume': '音量',
  'settings.haptic.enabled': '触覚',
  'settings.screen.keepAwake': '画面を暗くしない',
  'settings.loupe.corner': 'ルーペ位置',
  'settings.palette.scale': '数字ボタンの大きさ',
  'play.loupe.toggle': 'ルーペ',
  'settings.loupe.corner.TOP_LEFT': '左上',
  'settings.loupe.corner.TOP_RIGHT': '右上',
  'settings.loupe.corner.BOTTOM_LEFT': '左下',
  'settings.loupe.corner.BOTTOM_RIGHT': '右下',

  'title.size.heading': '盤面サイズ',
  'title.size.locked': '準備中',
  'title.size.offline': 'オフラインでは選べません',
  'title.difficulty.heading': '難易度',
  'title.start.resume': '前回の続きから',
  'title.start.new': '新しく始める',

  'title.stats.heading': '成績',
  'title.stats.empty': 'まだ記録がありません。',
  'title.stats.col.size': 'サイズ',
  'title.stats.col.difficulty': '難易度',
  'title.stats.col.clear': 'クリア',
  'title.stats.col.failed': '失敗',
  'title.stats.col.best': '最短時間',
  'title.stats.col.play': 'プレイ',
  'title.stats.col.hint': 'ヒント',

  'title.transfer.heading': 'データ',
  'title.transfer.export': 'データを保存する',
  'title.transfer.import': 'データを読み込む',

  'title.data.loading': '問題データを読み込んでいます…',
  'title.data.unavailable': '問題データを取得できませんでした。通信の状態を確かめてください。',
  'title.data.retry': 'もう一度試す',

  'title.guide.heading': '遊び方と注意',
  'title.guide.rules.heading': '遊び方',
  'title.guide.rules.body':
    '縦の列・横の行・太線で囲まれた区画のそれぞれに、1 から N（9×9 盤なら 9）までの' +
    '全ての数字を1つずつ入れます。' +
    '盤面が大きいほど手数が増えます。難易度は、解くのに必要な考え方の深さです。' +
    'ヒントは難易度ごとに決められた回数使用することができます。',
  'title.guide.controls.heading': '操作',
  'title.guide.controls.body':
    'マスを選んでから、下の数字を押すと入ります。「メモ」を押している間は候補の書き込みになります。' +
    '大きい盤面は指で広げて拡大できます。小さくしすぎると数字が読めなくなるので、そのときはルーペが出ます。',
  'title.guide.storage.heading': '保存について',
  'title.guide.storage.body':
    '進行と成績は、この端末のブラウザの中に自動で保存されます。中断できるのは1件だけで、' +
    '新しく始めると前の中断は消えます。',
  'title.guide.dataloss.heading': 'データが消えることについて',
  'title.guide.dataloss.body':
    'ブラウザのデータを削除したり、長いあいだ使わずにいると、保存した内容が失われることがあります。' +
    '大事な記録は「データを保存する」で控えを取ってください。',
  'title.guide.homescreen.heading': 'ホーム画面への追加',
  'title.guide.homescreen.body':
    'ホーム画面に追加しておくと、保存した内容が消えにくくなります。',

  'play.status.mistake': 'ミス',
  'play.status.failed': '失敗',
  'play.action.suspend': '中断して戻る',
  'play.action.erase': '消去',
  'play.action.note': 'メモ',
  'play.action.undo': '取消',
  'play.action.redo': 'やり直し',
  'play.action.hint': 'ヒント',
  'play.action.palette.shrink': '数字を縮める',
  'play.action.palette.expand': '数字を戻す',
  'play.palette.heading': '数字',
  'play.zoom.in': '拡大',
  'play.zoom.out': '縮小',
  'play.zoom.fit': '全体',
  'play.zoom.slider': '表示倍率',
  'play.preparing': '問題を用意しています…',

  'dialog.failed.title': 'ミスが上限に達しました',
  'dialog.failed.body': 'この回はクリアの記録に入りません。このまま最後まで解けます。',
  'dialog.failed.confirm': '続ける',
  'dialog.complete.title': '完成しました',
  'dialog.complete.time': '所要時間 {time}',
  'dialog.complete.mistake': 'ミス {count}',
  'dialog.complete.hint': 'ヒント {count}',
  'dialog.complete.failedNote': 'ミスが上限に達したため、クリアの記録には入りません。',
  'dialog.complete.best': '最短記録を更新しました。',
  'dialog.complete.again': '同じ条件でもう1問',
  'dialog.complete.toTitle': 'タイトルへ戻る',

  'dialog.sound.title': '音を鳴らしますか？',
  'dialog.sound.body': '効果音と触覚を使ってもよろしいですか？（あとで歯車の設定から変えられます）',
  'dialog.sound.yes': '鳴らす',
  'dialog.sound.no': '鳴らさない',

  'dialog.discard.title': '中断中のゲームを破棄しますか',
  'dialog.discard.body': '新しく始めると、前回の続きは消えます。',
  'dialog.discard.confirm': '破棄して始める',
  'dialog.import.title': 'データを読み込みますか',
  'dialog.import.body': 'いまの設定・成績・中断は、読み込んだ内容に置き換わります。',
  'dialog.import.confirm': '読み込む',

  'common.cancel': 'キャンセル',
  'common.close': '閉じる',

  'toast.network': 'データを取得できませんでした。通信の状態を確かめて、もう一度お試しください。',
  'toast.dataInvalid': 'データを読み込めませんでした。',
  'toast.storageUnavailable': 'この端末では、進行と記録を保存できません。',
  'toast.storageFull': '空き容量が足りないため保存できませんでした。',
  'toast.exported': 'データを保存しました。',
  'toast.imported': 'データを読み込みました。',
  'toast.importInvalid': 'ファイルを読み込めませんでした。いまのデータはそのままです。',
};

const en: Dict = {
  'header.title.subtitle': "You'll call it Su-doom.",
  'footer.about': 'About MOMO Sudoku',
  'footer.desc':
    'Number-place puzzles on boards from 1x1 up to 49x49, in three difficulty levels: Easy, Hard and Apocalypse. For people who love numbers and have outgrown 9x9. Your unfinished board is saved, so you can take days over it. No account and no install needed.',
  'footer.top': 'MOMO Works home',
  'footer.games': 'Games',
  'footer.tools': 'Tools',
  'header.settings.open': 'Sound & haptics',
  'header.locale.label': 'Language',

  'settings.sound.enabled': 'Sound',
  'settings.sound.volume': 'Volume',
  'settings.haptic.enabled': 'Haptics',
  'settings.screen.keepAwake': 'Keep screen awake',
  'settings.loupe.corner': 'Loupe position',
  'settings.palette.scale': 'Number button size',
  'play.loupe.toggle': 'Loupe',
  'settings.loupe.corner.TOP_LEFT': 'Top left',
  'settings.loupe.corner.TOP_RIGHT': 'Top right',
  'settings.loupe.corner.BOTTOM_LEFT': 'Bottom left',
  'settings.loupe.corner.BOTTOM_RIGHT': 'Bottom right',

  'title.size.heading': 'Board size',
  'title.size.locked': 'Coming soon',
  'title.size.offline': 'Not available offline',
  'title.difficulty.heading': 'Difficulty',
  'title.start.resume': 'Continue',
  'title.start.new': 'New game',

  'title.stats.heading': 'Records',
  'title.stats.empty': 'No records yet.',
  'title.stats.col.size': 'Size',
  'title.stats.col.difficulty': 'Difficulty',
  'title.stats.col.clear': 'Cleared',
  'title.stats.col.failed': 'Failed',
  'title.stats.col.best': 'Best time',
  'title.stats.col.play': 'Played',
  'title.stats.col.hint': 'Hints',

  'title.transfer.heading': 'Data',
  'title.transfer.export': 'Save my data',
  'title.transfer.import': 'Load my data',

  'title.data.loading': 'Loading puzzles…',
  'title.data.unavailable': 'Could not load the puzzles. Please check your connection.',
  'title.data.retry': 'Try again',

  'title.guide.heading': 'How to play',
  'title.guide.rules.heading': 'Rules',
  'title.guide.rules.body':
    'Fill every row, every column and every outlined block with all of the numbers 1 to N ' +
    '(9 on a 9×9 board), once each. ' +
    'Larger boards simply take more moves. The difficulty is how deep you have to reason. ' +
    'Hints can be used a set number of times, decided by the difficulty.',
  'title.guide.controls.heading': 'Controls',
  'title.guide.controls.body':
    'Tap a cell, then tap a number below to enter it. With "Memo" on, you write candidates instead. ' +
    'Pinch to zoom on large boards. When the cells get too small to read, a loupe appears.',
  'title.guide.storage.heading': 'About saving',
  'title.guide.storage.body':
    'Your progress and records are saved automatically inside this browser. Only one suspended game ' +
    'is kept, so starting a new game discards the previous one.',
  'title.guide.dataloss.heading': 'Your data can disappear',
  'title.guide.dataloss.body':
    'Clearing your browser data, or leaving the app unused for a long time, can wipe what was saved. ' +
    'Use "Save my data" to keep a copy of anything you care about.',
  'title.guide.homescreen.heading': 'Add to home screen',
  'title.guide.homescreen.body':
    'Adding this page to your home screen makes the saved data far less likely to be discarded.',

  'play.status.mistake': 'Mistakes',
  'play.status.failed': 'Failed',
  'play.action.suspend': 'Suspend and leave',
  'play.action.erase': 'Erase',
  'play.action.note': 'Notes',
  'play.action.undo': 'Undo',
  'play.action.redo': 'Redo',
  'play.action.hint': 'Hint',
  'play.action.palette.shrink': 'Shrink keys',
  'play.action.palette.expand': 'Restore keys',
  'play.palette.heading': 'Numbers',
  'play.zoom.in': 'Zoom in',
  'play.zoom.out': 'Zoom out',
  'play.zoom.fit': 'Fit',
  'play.zoom.slider': 'Zoom',
  'play.preparing': 'Preparing a puzzle…',

  'dialog.failed.title': 'You have reached the mistake limit',
  'dialog.failed.body': 'This round will not count as a clear. You can still solve it to the end.',
  'dialog.failed.confirm': 'Continue',
  'dialog.complete.title': 'Solved',
  'dialog.complete.time': 'Time {time}',
  'dialog.complete.mistake': 'Mistakes {count}',
  'dialog.complete.hint': 'Hints {count}',
  'dialog.complete.failedNote': 'You hit the mistake limit, so this does not count as a clear.',
  'dialog.complete.best': 'New best time.',
  'dialog.complete.again': 'Another one, same settings',
  'dialog.complete.toTitle': 'Back to title',

  'dialog.sound.title': 'Play sound?',
  'dialog.sound.body': 'May we use sound effects and haptics? (You can change this later from the gear settings.)',
  'dialog.sound.yes': 'Play',
  'dialog.sound.no': "Don't play",

  'dialog.discard.title': 'Discard the suspended game?',
  'dialog.discard.body': 'Starting a new game will erase the game you left unfinished.',
  'dialog.discard.confirm': 'Discard and start',
  'dialog.import.title': 'Load this data?',
  'dialog.import.body':
    'Your current settings, records and suspended game will be replaced by the loaded data.',
  'dialog.import.confirm': 'Load',

  'common.cancel': 'Cancel',
  'common.close': 'Close',

  'toast.network': 'Could not fetch the data. Check your connection and try again.',
  'toast.dataInvalid': 'That data could not be read.',
  'toast.storageUnavailable': 'This browser cannot save your progress or records.',
  'toast.storageFull': 'There was not enough free space to save.',
  'toast.exported': 'Your data has been saved.',
  'toast.imported': 'Your data has been loaded.',
  'toast.importInvalid': 'That file could not be read. Your existing data is unchanged.',
};

const zh: Dict = {
  'header.title.subtitle': '你会叫它数毒。',
  'footer.about': '关于 MOMO Sudoku',
  'footer.desc':
    '盘面从 1×1 到 49×49 的可变尺寸数字谜题，难度分为 Easy、Hard、Apocalypse 三级。献给觉得 9×9 已不够尽兴、又喜爱数字的你。解到一半会保存下来，可以花上好几天慢慢琢磨。无需注册，无需安装。',
  'footer.top': 'MOMO Works 首页',
  'footer.games': '游戏列表',
  'footer.tools': '工具列表',
  'header.settings.open': '音效与触感设置',
  'header.locale.label': '语言',

  'settings.sound.enabled': '音效',
  'settings.sound.volume': '音量',
  'settings.haptic.enabled': '触感',
  'settings.screen.keepAwake': '保持屏幕常亮',
  'settings.loupe.corner': '放大镜位置',
  'settings.palette.scale': '数字按钮大小',
  'play.loupe.toggle': '放大镜',
  'settings.loupe.corner.TOP_LEFT': '左上',
  'settings.loupe.corner.TOP_RIGHT': '右上',
  'settings.loupe.corner.BOTTOM_LEFT': '左下',
  'settings.loupe.corner.BOTTOM_RIGHT': '右下',

  'title.size.heading': '盘面大小',
  'title.size.locked': '准备中',
  'title.size.offline': '离线时无法选择',
  'title.difficulty.heading': '难度',
  'title.start.resume': '继续上次',
  'title.start.new': '开始新局',

  'title.stats.heading': '成绩',
  'title.stats.empty': '还没有记录。',
  'title.stats.col.size': '大小',
  'title.stats.col.difficulty': '难度',
  'title.stats.col.clear': '通关',
  'title.stats.col.failed': '失败',
  'title.stats.col.best': '最短用时',
  'title.stats.col.play': '游玩',
  'title.stats.col.hint': '提示',

  'title.transfer.heading': '数据',
  'title.transfer.export': '保存数据',
  'title.transfer.import': '读取数据',

  'title.data.loading': '正在读取题目数据…',
  'title.data.unavailable': '无法取得题目数据。请检查网络连接。',
  'title.data.retry': '再试一次',

  'title.guide.heading': '玩法与注意',
  'title.guide.rules.heading': '玩法',
  'title.guide.rules.body':
    '在每一行、每一列以及每个粗线区块中，把 1 到 N（9×9 盘面即为 9）的所有数字各填入一次。' +
    '盘面越大，步数越多。难度指的是需要推理的深度。' +
    '提示的可用次数由难度决定。',
  'title.guide.controls.heading': '操作',
  'title.guide.controls.body':
    '先选中一格，再按下方的数字即可填入。开启「备注」后写入的是候选数字。' +
    '大盘面可以用手指放大。缩得太小时数字会看不清，这时会出现放大镜。',
  'title.guide.storage.heading': '关于保存',
  'title.guide.storage.body':
    '进度与成绩会自动保存在本机浏览器中。中断的对局只保留一份，开始新局会覆盖上一份。',
  'title.guide.dataloss.heading': '数据可能丢失',
  'title.guide.dataloss.body':
    '清除浏览器数据，或长期不使用，都可能让保存的内容消失。请用「保存数据」留一份备份。',
  'title.guide.homescreen.heading': '添加到主屏幕',
  'title.guide.homescreen.body': '把本页添加到主屏幕后，保存的内容更不容易被清除。',

  'play.status.mistake': '失误',
  'play.status.failed': '失败',
  'play.action.suspend': '中断并返回',
  'play.action.erase': '清除',
  'play.action.note': '备注',
  'play.action.undo': '撤销',
  'play.action.redo': '重做',
  'play.action.hint': '提示',
  'play.action.palette.shrink': '缩小数字',
  'play.action.palette.expand': '恢复数字',
  'play.palette.heading': '数字',
  'play.zoom.in': '放大',
  'play.zoom.out': '缩小',
  'play.zoom.fit': '整体',
  'play.zoom.slider': '显示倍率',
  'play.preparing': '正在准备题目…',

  'dialog.failed.title': '失误已达上限',
  'dialog.failed.body': '本局不会计入通关记录。仍然可以继续解到最后。',
  'dialog.failed.confirm': '继续',
  'dialog.complete.title': '完成了',
  'dialog.complete.time': '用时 {time}',
  'dialog.complete.mistake': '失误 {count}',
  'dialog.complete.hint': '提示 {count}',
  'dialog.complete.failedNote': '因失误已达上限，本局不计入通关记录。',
  'dialog.complete.best': '刷新了最短用时。',
  'dialog.complete.again': '同样条件再来一题',
  'dialog.complete.toTitle': '返回标题',

  'dialog.sound.title': '要播放声音吗？',
  'dialog.sound.body': '可以使用音效和振动反馈吗？（之后可在齿轮设置中更改。）',
  'dialog.sound.yes': '播放',
  'dialog.sound.no': '不播放',

  'dialog.discard.title': '要放弃中断中的对局吗',
  'dialog.discard.body': '开始新局后，上次未完成的进度会被清除。',
  'dialog.discard.confirm': '放弃并开始',
  'dialog.import.title': '要读取这份数据吗',
  'dialog.import.body': '当前的设置、成绩与中断进度都会被读取的内容替换。',
  'dialog.import.confirm': '读取',

  'common.cancel': '取消',
  'common.close': '关闭',

  'toast.network': '无法取得数据。请检查网络连接后重试。',
  'toast.dataInvalid': '无法读取该数据。',
  'toast.storageUnavailable': '此浏览器无法保存进度与记录。',
  'toast.storageFull': '可用空间不足，未能保存。',
  'toast.exported': '数据已保存。',
  'toast.imported': '数据已读取。',
  'toast.importInvalid': '无法读取该文件。现有数据保持不变。',
};

const DICTS: Record<Exclude<LocaleCode, 'cat'>, Dict> = { ja, en, zh };

// ---------------------------------------------------------------- 猫語（動的な鳴き声）

/** 攻撃的な鳴き声を返すキー（失敗・エラーの通知） */
const ERROR_KEYS: ReadonlySet<MessageKey> = new Set([
  'title.data.unavailable',
  'toast.network',
  'toast.dataInvalid',
  'toast.storageUnavailable',
  'toast.storageFull',
  'toast.importInvalid',
]);

/** 穏やかな鳴き声を返すキー（待ちの通知） */
const CALM_KEYS: ReadonlySet<MessageKey> = new Set(['title.data.loading', 'play.preparing']);

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

/**
 * 同じ状況では同じ鳴き声を返すための覚え書き。
 * これが無いと、React が描き直すたびに画面じゅうの文言が引き直されて読めなくなる。
 */
const catCache = new Map<string, { gen: number; base: CatBase; value: string }>();
let catGen = 0;

/** 場面が変わったときに呼ぶ。次の解決から新しい鳴き声になる */
export function resetCatCache(): void {
  catGen++;
  catCache.clear();
}

function catSpeak(key: MessageKey, base: CatBase): string {
  const cached = catCache.get(key);
  if (cached && cached.gen === catGen && cached.base === base) return cached.value;

  const vocab = CAT_VOCAB[base];
  const list = ERROR_KEYS.has(key) ? vocab.error : CALM_KEYS.has(key) ? vocab.calm : vocab.normal;
  const value = list[Math.floor(Math.random() * list.length)];
  catCache.set(key, { gen: catGen, base, value });
  return value;
}

// ---------------------------------------------------------------- 状態と公開API（14.2）

let currentLocale: LocaleCode = 'ja';
let currentCatBase: CatBase = 'ja';
const listeners = new Set<(code: LocaleCode) => void>();

export function current(): LocaleCode {
  return currentLocale;
}

/** 言語を切り替える。辞書は同梱のため即座に解決する */
export async function setLocale(code: LocaleCode): Promise<void> {
  if (code === currentLocale) return;
  currentLocale = code;
  resetCatCache();
  for (const listener of listeners) listener(code);
}

/**
 * 猫語の語彙を選ぶ元の言語を設定する。
 * 値の出所は共通ライブラリ `momo-lang` であり、橋渡しから渡される。
 */
export function setCatBase(base: CatBase): void {
  if (base === currentCatBase) return;
  currentCatBase = base;
  resetCatCache();
  for (const listener of listeners) listener(currentLocale);
}

export function catBase(): CatBase {
  return currentCatBase;
}

/** 文言を解決する。未定義キーはキー文字列をそのまま返す（14.2） */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const raw =
    currentLocale === 'cat'
      ? catSpeak(key, currentCatBase)
      : (DICTS[currentLocale] ?? ja)[key] ?? ja[key] ?? key;

  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] !== undefined ? String(params[name]) : whole,
  );
}

/**
 * 猫語のときも**元の言語のまま**返す（⑰）
 *
 * サブタイトルのように、猫語へ訳すと意味が消えてしまうものに使う。
 * 猫語でないときは `t` と同じである。
 */
export function tBase(key: MessageKey): string {
  const code = currentLocale === 'cat' ? currentCatBase : currentLocale;
  return (DICTS[code] ?? ja)[key] ?? ja[key] ?? key;
}

/** 切替の購読。UI の再描画に用いる（14.2） */
export function subscribe(listener: (code: LocaleCode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const localeModule = { current, setLocale, t, subscribe };
