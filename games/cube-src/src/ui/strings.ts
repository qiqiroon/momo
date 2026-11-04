// 画面の文言表（HANDOVER U3）。日本語・英語・中国語と猫語（CAT）。言語の選び方は i18n/langMode.ts（lib/momo-lang）
// 回転記号（R・U など）を知らなくても分かるよう、面は「右の面」のように見たままの言葉で書く
import type { Face } from '../core/types';
import type { KeyAction } from '../input/keymap';

export type Lang = 'ja' | 'en' | 'zh' | 'cat';
/** 猫語の鳴き声の系統（猫語を選ぶ前の言語） */
export type CatBase = 'ja' | 'en' | 'zh';

const ja = {
  title: 'MOMO Cube',
  lang: '言語',
  size: '大きさ',
  sizeOption: (n: number) => `${n}×${n}×${n}`,
  grid: '角度の刻み',
  gridNone: 'なし',
  moves: '手数',
  lastMove: '最後',
  layer: '層',
  layerWide: 'まとめて',
  solved: 'そろった！',
  time: '時間',
  best: 'ベスト',
  /** シャッフルした直後（まだ計り始めていない） */
  timerWaiting: '回し始めると時間が動きます',
  /** 矢印の操作の案内（HUD。狭い画面では出さない） */
  arrowHint: '面をタップすると、まわりに矢印が出ます',
  arrowHintSelected: '矢印を押して回す（背景のタップか Esc で消す）',
  /** キューブの下に出す操作の案内（2026-11-02 作者：どこかに表示してほしい） */
  gestureHintTouch: 'キューブの外をなぞると全体が回ります・2 本指で拡大縮小',
  gestureHintMouse: 'キューブの外をドラッグすると全体が回ります・ホイールで拡大縮小',

  scramble: 'シャッフル',
  reset: 'そろえる',
  undo: '戻す',
  redo: 'やり直す',
  home: 'ホーム',
  homeTitle: '向きを最初に戻す（色と手数はそのまま）',
  keys: 'キー設定',
  hint: 'ヒント',
  solve: '解答',
  hintTitle: '次の 1 手を、回す層を光らせて教えます（使ったゲームはベストに数えません）',
  solveTitle: '自動で回してそろえます。シャッフルと自分の手を逆にたどるので、最短ではありません（使ったゲームはベストに数えません）',
  solveStop: '止める',
  /** HUD のヒント（例：「ヒント：右の面を回す。手前が上へ（キー R）」） */
  hintMove: (text: string, key: string | null) => `ヒント：${text}${key ? `（キー ${key}）` : ''}`,
  keysTitle: 'キーの割り当てを変える',

  depthLegend: '回す層（外から数えて何枚目）',
  depthOption: (d: number) => `${d}`,
  depthTitle: (d: number) => (d === 1 ? 'いちばん外側' : `外から ${d} 枚目`),
  wide: 'まとめて回す',
  wideTitle: (d: number) => `外側から ${d} 枚目までを一度に回す`,

  /** 画面基準の面の名前（いま画面のそちら側に見えている面） */
  face: { U: '上', D: '下', L: '左', R: '右', F: '前', B: '奥' } as Record<Face, string>,
  middle: { M: '縦の真ん中', E: '横の真ん中', S: '前後の真ん中' } as Record<'M' | 'E' | 'S', string>,
  middleShort: { M: '縦中', E: '横中', S: '前中' } as Record<'M' | 'E' | 'S', string>,
  /** 面ボタンの読み上げ（例：「右の面を回す。手前が上へ」） */
  faceAria: (face: string, layer: string, dir: string) => `${face}の${layer}を回す。${dir}`,
  middleAria: (name: string, dir: string) => `${name}の層を回す。${dir}`,
  layerFace: '面',
  layerNth: (d: number) => `外から${d}枚目`,
  layerUpTo: (d: number) => `外から${d}枚目まで`,

  pickerLabel: '回す面を選ぶ',
  pickerTitle: (name: string) => `${name}を回すボタンを出す`,
  whole: '全体',
  wholeTitle: 'キューブ全体を回す（手数に数えない）',
  wholeToggle: '全体を回す…',
  wholeAria: (dir: string) => `キューブ全体を回す。${dir}`,

  /** 回る向き（画面で見たときの動き） */
  dir: {
    up: '手前が上へ',
    down: '手前が下へ',
    left: '手前が左へ',
    right: '手前が右へ',
    cw: '前から見て時計回り',
    ccw: '前から見て反時計回り',
    half: '半回転',
  },

  /** 計っている途中で、ゲームを終わらせる操作の確認（05 §3） */
  confirmTitle: 'ゲームの途中です',
  confirmReset: 'そろえると、いまのゲームは記録されずに終わります。',
  confirmScramble: 'シャッフルし直すと、いまのゲームは記録されずに終わります。',
  confirmSize: (n: number) => `大きさを ${n}×${n}×${n} に変えると、いまのゲームは記録されずに終わります。`,
  confirmContinue: 'ゲームを続ける',
  confirmSizeOk: '大きさを変える',

  /** そろったときの結果（05 §4） */
  resultTitle: 'そろった！',
  resultTime: '時間',
  resultMoves: '手数',
  resultMovesValue: (m: number) => `${m} 手`,
  resultNewBest: '新記録！',
  resultNewBestMoves: '手数の新記録！',
  resultBest: (size: string) => `${size}のベスト`,
  resultAssisted: 'ヒント・解答を使ったので、ベストには数えません',
  resultAgain: 'もう一度（シャッフル）',
  resultAnnounce: (time: string, moves: number) => `そろいました。時間 ${time}、${moves}手`,
  /** 読み上げ用の時間（「1分12秒」） */
  spokenTime: (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    return `${h ? `${h}時間` : ''}${h || m ? `${m}分` : ''}${s % 60}秒`;
  },

  /** 設定（05 §5） */
  settings: '設定',
  settingsTitleAttr: '回る速さ・角度の刻み・鏡・画質など',
  settingsTitle: '設定',
  settingsDefault: '最初の設定に戻す',
  settingsSpeed: '回る速さ',
  speedOption: (ms: number) => ({ 40: 'とても速い', 70: 'ふつう', 150: 'ゆっくり', 300: 'とてもゆっくり' } as Record<number, string>)[ms] ?? `${ms}ms`,
  settingsReducedMotion: 'この端末は「動きを減らす」設定なので、「ふつう」は少し速く回します（ほかを選べばその速さ）',
  settingsGridHelp: '手で全体を回して離したとき、この角度の刻みに寄せます',
  settingsInertia: '離したあとも少し回り続ける',
  settingsInertiaHelp: '手で全体を回して、勢いよく離したとき',
  settingsArrowLabels: '矢印のキーの札',
  arrowLabelOption: { auto: '自動', all: '全部に出す', none: '出さない' } as Record<'auto' | 'all' | 'none', string>,
  settingsArrowLabelsHelp: '自動：4×4×4 以上は、タップしたマスの列と行の分だけ出します（指で触る端末では出しません）',
  settingsMirrors: '鏡を出す',
  settingsMirrorsHelp: '消すと、キューブが大きく写り、動きも軽くなります',
  settingsQuality: '画質',
  qualityOption: { auto: '自動（重いときは粗くする）', high: 'きれい', low: '軽い' } as Record<'auto' | 'high' | 'low', string>,
  settingsQualityHelp: '動きがかくかくするときは「軽い」にしてください',
  /** 一番粗くしても重いときの案内（03 §7.1 の 3） */
  slowHint: '動きが重いときは、設定で鏡を消すと軽くなります',

  keymapTitle: 'キーの割り当て',
  keymapHelp: '変えたい操作のキーを押してから、新しく使うキーを押してください。Shift を足すと逆回り、Alt を足すと半回転です。数字は「何枚目」、Ctrl+Z は戻す、Ctrl+Y はやり直すに使います。',
  keymapWaiting: 'キーを押してください（Esc でやめる）',
  keymapReserved: (k: string) => `「${k}」は割り当てられません`,
  keymapSwapped: (k: string, other: string) => `「${k}」を使っていた「${other}」と入れ替えました`,
  keymapSaveTitle: 'いまのキーの割り当てをファイルに保存する',
  keymapLoadTitle: 'ファイルからキーの割り当てを読み出す',
  keymapLoaded: 'ファイルのキーの割り当てにしました',
  keymapLoadFailed: 'このファイルからはキーの割り当てを読めませんでした',
  keymapDefault: '最初の割り当てに戻す',
  close: '閉じる',
  /** 割り当て表の操作の名前 */
  action: {
    U: '上の面', D: '下の面', L: '左の面', R: '右の面', F: '前の面', B: '奥の面',
    M: '縦の真ん中の層', E: '横の真ん中の層', S: '前後の真ん中の層',
    x: '全体を回す（手前を上へ）', y: '全体を回す（手前を左へ）', z: '全体を回す（時計回り）',
    wide: 'まとめて回す（先に押す）', home: 'ホーム（向きを戻す）',
  } as Record<KeyAction, string>,

  /** 下のパネルの切り替え（2026-11-04 作者：出し入れ・タグで呼び出し・切り替え・消す） */
  tabControls: '操作',
  tabSequences: '手順',
  tabGames: 'プレイ記録',
  gameNow: (size: string, scr: number, moves: number, views: number) =>
    `いま：${size}・シャッフル ${scr} 手・そのあと ${moves} 手・全体の回転 ${views} 回`,
  gameSave: '保存',
  gameSaveTitle: 'いまのゲーム（シャッフルと、そのあとの手・全体の回転）を一覧に残す',
  gameSaveEmpty: '保存する手がありません',
  gameSaved: (name: string) => `「${name}」を保存しました`,
  gameFull: '手が多すぎるため、ここから先は覚えていません',
  gameEmpty: 'シャッフルしてから回すと、その手がすべて覚えられます。「保存」を押すと、ここに残ります',
  gameNameAria: 'プレイ記録の名前（書き換えられます）',
  gameDefaultName: (date: string, size: string) => `${date} ${size}`,
  gameInfo: (size: string, moves: number, time: string) => `${size}・${moves} 手${time ? `・${time}` : ''}`,
  gamePlay: '▶ 再生',
  gamePlayTitle: 'シャッフルした姿から、覚えた手と全体の回転をそのとおりに再生します',
  gameStop: '■ 止める',
  gameDelete: '削除',
  gameDeleteConfirm: (name: string) => `「${name}」を消します。元には戻せません。`,
  gameConfirmPlay: 'いまのゲームをやめて、プレイ記録を再生します。',
  gamePlaying: (name: string, i: number, total: number) => `再生中：${name}（${i}／${total}）`,
  gamePlayed: (name: string) => `「${name}」の再生が終わりました。続きから回せます`,
  gameExportTitle: '保存したプレイ記録をすべてファイルに書き出す',
  gameExportEmpty: '保存したプレイ記録がありません',
  gameImportTitle: 'ファイルからプレイ記録を読み込んで、一覧に足す',
  gameImported: (k: number) => `${k} 個のプレイ記録を読み込みました`,
  gameImportFailed: 'このファイルからはプレイ記録を読み込めませんでした',
  tabTitle: (name: string) => `${name}のパネルを出す（出ているときに押すとしまう）`,
  tabsLabel: '下のパネル',
  dockHide: '▼ しまう',
  dockShow: '▲ 出す',
  dockHideTitle: '下のパネルをしまって、キューブを大きく写す',
  dockShowTitle: 'しまったパネルを出す',

  /** 手順の記録と再生 */
  seqAdd: '＋ 追加',
  seqAddTitle: '手順を入れる場所を 1 つ足す',
  seqEmpty: '「＋ 追加」で手順を入れる場所を足し、「記録」を押してから回すと、その手順を覚えます',
  seqDefaultName: (i: number) => `手順 ${i}`,
  seqNameAria: '手順の名前（押すとこの手順のマークが出ます。書き換えもできます）',
  seqInfo: (size: string, count: number) => `${size}・${count} 手`,
  seqRecord: '● 記録',
  seqRecordStop: '■ 記録を止める',
  seqRecordTitle: '押してから回した手を覚えます。戻すと、戻した手は忘れます',
  seqPlay: '▶ 再生',
  seqPlayStop: '■ 止める',
  seqPlayTitle: 'いまの向きから見て、覚えた手順のとおりに回します',
  seqPlaySize: (size: string) => `${size}で記録した手順です。大きさを合わせると再生できます`,
  seqDelete: '削除',
  seqDeleteTitle: 'この手順を消す',
  seqConfirmTitle: '確認',
  seqCancel: 'やめる',
  seqDeleteConfirm: (name: string) => `「${name}」を消します。元には戻せません。`,
  seqOverwriteConfirm: (name: string) => `「${name}」に覚えている手順を消して、記録し直します。`,
  seqOverwriteOk: '記録し直す',
  seqRecording: (name: string, count: number) => `記録中：${name}（${count} 手）`,
  seqRecorded: (name: string, count: number) => `「${name}」に ${count} 手を覚えました`,
  seqPlaying: (name: string) => `再生中：${name}`,
  seqExport: 'ファイルに保存',
  seqExportTitle: 'すべての手順をファイルに書き出す',
  seqExportEmpty: '保存する手順がありません',
  seqImport: 'ファイルを開く',
  seqImportTitle: 'ファイルから手順を読み込んで、いまの一覧の後ろに足す',
  seqImported: (k: number) => `${k} 個の手順を読み込みました`,
  seqImportFailed: 'このファイルからは手順を読み込めませんでした',
  seqSaveFailed: 'ブラウザに保存できませんでした（ファイルに保存してください）',
  /** マーク（2026-11-04 作者：手順がどのセルを動かすためのものか示す。手順ごとに 1 組） */
  seqMark: 'マーク',
  seqMarkTitle: '押してからセルを押すたびに、1 から順に番号のマークが付きます（もう一度押すと終わり）。手順の名前を選ぶと、その手順のマークが出ます',
  seqMarkSize: (size: string) => `マークを付けられるのは、キューブが${size}のときだけです`,
  seqUnmark: 'マーク削除',
  seqUnmarkTitle: '番号のいちばん大きいマークを消す',
  seqMarking: (name: string) => `マーク中（${name}）：セルを押すと 1 から順に付きます`,
  seqViewLabel: '手順の大きさ',
  seqViewOption: (size: string, count: number) => `${size}（${count}）`,
  seqEmptySize: (size: string) => `${size}の手順はまだありません。「＋ 追加」で足せます`,
  seqPlayOther: (size: string) => `${size}で記録した手順です。外から何段目かを合わせて回します`,
  seqPlayDeep: (size: string) => `半分より奥の段を回す手があるので、${size}では再生できません`,
  seqRecordSize: (size: string) => `記録できるのは、キューブが${size}のときだけです`,
  seqNote: '説明追加',
  seqNoteTitle: '手順セット（すべての大きさの手順をまとめたもの。ファイル 1 つ分）に説明を付ける。キューブの下の知らせ欄に出ます',
  seqNotePlaceholder: '手順セットの説明',

  /** ページ下の説明（MOMO Works の各ゲームと同じ形） */
  footAbout: 'MOMO Cube について',
  footDesc: 'MOMO Cube は、ブラウザで遊べる無料の 3D キューブパズルです。1×1×1 から 10×10×10 まで大きさを選び、指やマウスで面をつまんで回して、6 つの面の色をそろえます。3 枚の鏡に裏の面が映るので、キューブを回さなくても全体が見えます。シャッフルしてから時間を計り、ベスト記録に挑戦できます。困ったときはヒントと解答も使えます。アカウント登録もインストールも不要で、ブラウザだけですぐに遊べます。',
  footTop: 'MOMO Works トップ',
  footGames: 'ゲーム一覧',
  footTools: 'ツール一覧',
};

export type Strings = typeof ja;

const en: Strings = {
  title: 'MOMO Cube',
  lang: 'Language',
  size: 'Size',
  sizeOption: ja.sizeOption,
  grid: 'Angle snap',
  gridNone: 'Off',
  moves: 'Moves',
  lastMove: 'Last',
  layer: 'Layer',
  layerWide: 'together',
  solved: 'Solved!',
  time: 'Time',
  best: 'Best',
  timerWaiting: 'The clock starts with your first turn',
  arrowHint: 'Tap a face to show arrows around it',
  arrowHintSelected: 'Press an arrow to turn (tap the background or Esc to hide)',
  gestureHintTouch: 'Swipe outside the cube to turn it all · Pinch to zoom',
  gestureHintMouse: 'Drag outside the cube to turn it all · Scroll to zoom',

  scramble: 'Scramble',
  reset: 'Solve now',
  undo: 'Undo',
  redo: 'Redo',
  home: 'Home',
  homeTitle: 'Return to the starting view (colors and moves stay)',
  keys: 'Key settings',
  hint: 'Hint',
  solve: 'Solve',
  hintTitle: "Lights up the layer to turn next (games with hints don't count toward your best)",
  solveTitle: "Turns the cube until it's solved by retracing the scramble and your moves, so not the shortest way (games with it don't count toward your best)",
  solveStop: 'Stop',
  hintMove: (text, key) => `Hint: ${text}${key ? ` (key ${key})` : ''}`,
  keysTitle: 'Change the keys',

  depthLegend: 'Layer to turn (counted from the outside)',
  depthOption: ja.depthOption,
  depthTitle: (d) => (d === 1 ? 'Outermost' : `Layer ${d} from the outside`),
  wide: 'Turn together',
  wideTitle: (d) => `Turn layers 1 to ${d} at once`,

  face: { U: 'Up', D: 'Down', L: 'Left', R: 'Right', F: 'Front', B: 'Back' },
  middle: { M: 'vertical middle', E: 'horizontal middle', S: 'front-back middle' },
  middleShort: { M: 'V mid', E: 'H mid', S: 'F mid' },
  faceAria: (face, layer, dir) => `Turn the ${face.toLowerCase()} ${layer}. ${dir}`,
  middleAria: (name, dir) => `Turn the ${name} layer. ${dir}`,
  layerFace: 'face',
  layerNth: (d) => `layer ${d}`,
  layerUpTo: (d) => `layers 1 to ${d}`,

  pickerLabel: 'Choose a face to turn',
  pickerTitle: (name) => `Show the buttons for ${name}`,
  whole: 'Cube',
  wholeTitle: 'Turn the whole cube (not counted as a move)',
  wholeToggle: 'Turn cube…',
  wholeAria: (dir) => `Turn the whole cube. ${dir}`,

  dir: {
    up: 'front moves up',
    down: 'front moves down',
    left: 'front moves left',
    right: 'front moves right',
    cw: 'clockwise from the front',
    ccw: 'counterclockwise from the front',
    half: 'half turn',
  },

  confirmTitle: 'A game is in progress',
  confirmReset: 'Solving now ends this game without recording it.',
  confirmScramble: 'Scrambling again ends this game without recording it.',
  confirmSize: (n) => `Changing the size to ${n}×${n}×${n} ends this game without recording it.`,
  confirmContinue: 'Keep playing',
  confirmSizeOk: 'Change size',

  resultTitle: 'Solved!',
  resultTime: 'Time',
  resultMoves: 'Moves',
  resultMovesValue: (m) => `${m}`,
  resultNewBest: 'New best!',
  resultNewBestMoves: 'Fewest moves!',
  resultBest: (size) => `Best for ${size}`,
  resultAssisted: "Hints or Solve were used, so this doesn't count toward your best",
  resultAgain: 'Play again (scramble)',
  resultAnnounce: (time, moves) => `Solved. Time ${time}, ${moves} moves`,
  spokenTime: (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    return [h ? `${h} h` : '', h || m ? `${m} min` : '', `${s % 60} s`].filter(Boolean).join(' ');
  },

  settings: 'Settings',
  settingsTitleAttr: 'Speed, angle snap, mirrors, quality and more',
  settingsTitle: 'Settings',
  settingsDefault: 'Restore defaults',
  settingsSpeed: 'Turn speed',
  speedOption: (ms) => ({ 40: 'Very fast', 70: 'Normal', 150: 'Slow', 300: 'Very slow' } as Record<number, string>)[ms] ?? `${ms}ms`,
  settingsReducedMotion: 'This device asks for less motion, so "Normal" turns a little faster (other choices keep their speed)',
  settingsGridHelp: 'After you turn the whole cube by hand, it settles on this angle step',
  settingsInertia: 'Keep spinning after release',
  settingsInertiaHelp: 'When you turn the whole cube by hand and let go quickly',
  settingsArrowLabels: 'Key labels on arrows',
  arrowLabelOption: { auto: 'Auto', all: 'All', none: 'None' },
  settingsArrowLabelsHelp: 'Auto: from 4×4×4 up, only for the row and column of the tapped square (never on touch screens)',
  settingsMirrors: 'Show mirrors',
  settingsMirrorsHelp: 'Without mirrors the cube is drawn larger and runs lighter',
  settingsQuality: 'Quality',
  qualityOption: { auto: 'Auto (coarser when slow)', high: 'Sharp', low: 'Light' },
  settingsQualityHelp: 'If motion is choppy, choose "Light"',
  slowHint: 'If it feels slow, turn off the mirrors in Settings',

  keymapTitle: 'Keys',
  keymapHelp: 'Press the key of the action to change, then the new key. Add Shift to turn the other way, Alt for a half turn. Number keys pick the layer, Ctrl+Z undoes and Ctrl+Y redoes.',
  keymapWaiting: 'Press a key (Esc to cancel)',
  keymapReserved: (k) => `"${k}" can't be assigned`,
  keymapSwapped: (k, other) => `Swapped with "${other}", which used "${k}"`,
  keymapSaveTitle: 'Save the current key settings to a file',
  keymapLoadTitle: 'Load key settings from a file',
  keymapLoaded: 'Loaded the key settings from the file',
  keymapLoadFailed: 'Could not read key settings from this file',
  keymapDefault: 'Restore default keys',
  close: 'Close',
  action: {
    U: 'Up face', D: 'Down face', L: 'Left face', R: 'Right face', F: 'Front face', B: 'Back face',
    M: 'Vertical middle', E: 'Horizontal middle', S: 'Front-back middle',
    x: 'Turn cube (front up)', y: 'Turn cube (front left)', z: 'Turn cube (clockwise)',
    wide: 'Turn together (press first)', home: 'Home (reset the view)',
  },

  tabControls: 'Controls',
  tabSequences: 'Sequences',
  tabGames: 'Play log',
  gameNow: (size: string, scr: number, moves: number, views: number) =>
    `Now: ${size} · shuffle ${scr} · then ${moves} moves · ${views} whole-cube turns`,
  gameSave: 'Save',
  gameSaveTitle: 'Keep the current game (shuffle, moves and whole-cube turns) in the list',
  gameSaveEmpty: 'There are no moves to save',
  gameSaved: (name: string) => `Saved “${name}”`,
  gameFull: 'Too many moves; the rest is not being remembered',
  gameEmpty: 'Shuffle and play: every move is remembered. Press “Save” to keep it here',
  gameNameAria: 'Play log name (you can edit it)',
  gameDefaultName: (date: string, size: string) => `${date} ${size}`,
  gameInfo: (size: string, moves: number, time: string) => `${size} · ${moves} moves${time ? ` · ${time}` : ''}`,
  gamePlay: '▶ Play',
  gamePlayTitle: 'Replays the remembered moves and whole-cube turns from the shuffled cube',
  gameStop: '■ Stop',
  gameDelete: 'Delete',
  gameDeleteConfirm: (name: string) => `Delete “${name}”? This cannot be undone.`,
  gameConfirmPlay: 'Quit the current game and replay this play log?',
  gamePlaying: (name: string, i: number, total: number) => `Playing: ${name} (${i}/${total})`,
  gamePlayed: (name: string) => `Finished replaying “${name}”. You can continue from here`,
  gameExportTitle: 'Write all saved play logs to a file',
  gameExportEmpty: 'There are no saved play logs',
  gameImportTitle: 'Read play logs from a file and add them to the list',
  gameImported: (k: number) => `Loaded ${k} play log(s)`,
  gameImportFailed: 'Could not read play logs from this file',
  tabTitle: (name: string) => `Show the ${name} panel (press again to put it away)`,
  tabsLabel: 'Bottom panels',
  dockHide: '▼ Hide',
  dockShow: '▲ Show',
  dockHideTitle: 'Put the bottom panel away to see the cube larger',
  dockShowTitle: 'Bring the panel back',

  seqAdd: '＋ Add',
  seqAddTitle: 'Add a slot for a sequence',
  seqEmpty: 'Press “＋ Add” for a slot, then press “Record” and turn the cube to remember the sequence',
  seqDefaultName: (i: number) => `Sequence ${i}`,
  seqNameAria: 'Sequence name (tap to show its marks; you can also edit it)',
  seqInfo: (size: string, count: number) => `${size} · ${count} moves`,
  seqRecord: '● Record',
  seqRecordStop: '■ Stop recording',
  seqRecordTitle: 'Remembers the moves you make after pressing. Undo forgets the undone move',
  seqPlay: '▶ Play',
  seqPlayStop: '■ Stop',
  seqPlayTitle: 'Turns the remembered sequence as seen from the current orientation',
  seqPlaySize: (size: string) => `Recorded on ${size}. Switch to that size to play it`,
  seqDelete: 'Delete',
  seqDeleteTitle: 'Delete this sequence',
  seqConfirmTitle: 'Confirm',
  seqCancel: 'Cancel',
  seqDeleteConfirm: (name: string) => `Delete “${name}”? This cannot be undone.`,
  seqOverwriteConfirm: (name: string) => `Erase the moves in “${name}” and record again?`,
  seqOverwriteOk: 'Record again',
  seqRecording: (name: string, count: number) => `Recording: ${name} (${count} moves)`,
  seqRecorded: (name: string, count: number) => `Saved ${count} moves to “${name}”`,
  seqPlaying: (name: string) => `Playing: ${name}`,
  seqExport: 'Save to file',
  seqExportTitle: 'Write all sequences to a file',
  seqExportEmpty: 'There are no sequences to save',
  seqImport: 'Open file',
  seqImportTitle: 'Read sequences from a file and add them to the list',
  seqImported: (k: number) => `Loaded ${k} sequence(s)`,
  seqImportFailed: 'Could not read sequences from this file',
  seqSaveFailed: 'Could not save in the browser (please save to a file)',
  seqMark: 'Mark',
  seqMarkTitle: 'After pressing, each cell you tap gets a numbered mark from 1 (press again to finish). Select a sequence name to show its marks',
  seqMarkSize: (size: string) => `Marks can be added only while the cube is ${size}`,
  seqUnmark: 'Delete mark',
  seqUnmarkTitle: 'Delete the mark with the highest number',
  seqMarking: (name: string) => `Marking “${name}”: tap cells to number them from 1`,
  seqViewLabel: 'Sequences for',
  seqViewOption: (size: string, count: number) => `${size} (${count})`,
  seqEmptySize: (size: string) => `No sequences for ${size} yet. Press “＋ Add” to add one`,
  seqPlayOther: (size: string) => `Recorded on ${size}. Turns the same layers counted from the outside`,
  seqPlayDeep: (size: string) => `Some moves turn layers deeper than half, so it cannot be played on ${size}`,
  seqRecordSize: (size: string) => `You can record only while the cube is ${size}`,
  seqNote: 'Add note',
  seqNoteTitle: 'Add a note to the sequence set (all sizes together, one file). It is shown in the message area under the cube',
  seqNotePlaceholder: 'Note for the sequence set',

  footAbout: 'About MOMO Cube',
  footDesc: 'MOMO Cube is a free 3D cube puzzle you can play in your browser. Pick any size from 1×1×1 to 10×10×10, grab a face with your finger or mouse and turn it, and bring all six faces back to one color each. Three mirrors show the hidden faces, so you can see the whole cube without turning it around. Scramble it, race the clock, and go for your best time. Hints and an automatic solve are there when you get stuck. No account or installation required — just play instantly in your browser.',
  footTop: 'MOMO Works Home',
  footGames: 'Games',
  footTools: 'Tools',
};

const zh: Strings = {
  title: 'MOMO Cube',
  lang: '语言',
  size: '阶数',
  sizeOption: ja.sizeOption,
  grid: '角度吸附',
  gridNone: '无',
  moves: '步数',
  lastMove: '上一步',
  layer: '层',
  layerWide: '多层',
  solved: '复原了！',
  time: '时间',
  best: '最佳',
  timerWaiting: '转动第一步时开始计时',
  arrowHint: '点击一个面，周围会出现箭头',
  arrowHintSelected: '按箭头转动（点击背景或按 Esc 关闭）',
  gestureHintTouch: '在魔方外滑动可转动整体 · 双指缩放',
  gestureHintMouse: '在魔方外拖动可转动整体 · 滚轮缩放',

  scramble: '打乱',
  reset: '复原',
  undo: '撤销',
  redo: '重做',
  home: '归位',
  homeTitle: '回到最初的视角（颜色和步数不变）',
  keys: '按键设置',
  hint: '提示',
  solve: '解答',
  hintTitle: '点亮下一步要转的层（使用后不计入最佳记录）',
  solveTitle: '自动转动直到复原。按打乱和你的操作倒推，并非最短（使用后不计入最佳记录）',
  solveStop: '停止',
  hintMove: (text, key) => `提示：${text}${key ? `（按键 ${key}）` : ''}`,
  keysTitle: '更改按键',

  depthLegend: '转动的层（从外数第几层）',
  depthOption: ja.depthOption,
  depthTitle: (d) => (d === 1 ? '最外层' : `从外数第 ${d} 层`),
  wide: '多层一起转',
  wideTitle: (d) => `一次转动第 1 至第 ${d} 层`,

  face: { U: '上', D: '下', L: '左', R: '右', F: '前', B: '后' },
  middle: { M: '竖中层', E: '横中层', S: '前后中层' },
  middleShort: { M: '竖中', E: '横中', S: '前中' },
  faceAria: (face, layer, dir) => `转动${face}${layer}。${dir}`,
  middleAria: (name, dir) => `转动${name}。${dir}`,
  layerFace: '面',
  layerNth: (d) => `第${d}层`,
  layerUpTo: (d) => `第1至${d}层`,

  pickerLabel: '选择要转的面',
  pickerTitle: (name) => `显示${name}的按钮`,
  whole: '整体',
  wholeTitle: '转动整个魔方（不计步数）',
  wholeToggle: '转动整体…',
  wholeAria: (dir) => `转动整个魔方。${dir}`,

  dir: {
    up: '前面向上',
    down: '前面向下',
    left: '前面向左',
    right: '前面向右',
    cw: '从前看顺时针',
    ccw: '从前看逆时针',
    half: '半圈',
  },

  confirmTitle: '游戏进行中',
  confirmReset: '现在复原，本局不会被记录。',
  confirmScramble: '重新打乱，本局不会被记录。',
  confirmSize: (n) => `改为 ${n}×${n}×${n}，本局不会被记录。`,
  confirmContinue: '继续游戏',
  confirmSizeOk: '更改阶数',

  resultTitle: '复原了！',
  resultTime: '时间',
  resultMoves: '步数',
  resultMovesValue: (m) => `${m} 步`,
  resultNewBest: '新纪录！',
  resultNewBestMoves: '最少步数！',
  resultBest: (size) => `${size} 最佳`,
  resultAssisted: '使用了提示或解答，不计入最佳记录',
  resultAgain: '再来一局（打乱）',
  resultAnnounce: (time, moves) => `复原了。时间 ${time}，${moves} 步`,
  spokenTime: (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    return `${h ? `${h}小时` : ''}${h || m ? `${m}分` : ''}${s % 60}秒`;
  },

  settings: '设置',
  settingsTitleAttr: '速度、角度吸附、镜子、画质等',
  settingsTitle: '设置',
  settingsDefault: '恢复默认设置',
  settingsSpeed: '转动速度',
  speedOption: (ms) => ({ 40: '很快', 70: '普通', 150: '慢', 300: '很慢' } as Record<number, string>)[ms] ?? `${ms}ms`,
  settingsReducedMotion: '此设备设置了“减少动态效果”，“普通”会稍快一些（其他选项保持原速）',
  settingsGridHelp: '用手转动整体后松开时，吸附到这个角度',
  settingsInertia: '松开后继续转一会儿',
  settingsInertiaHelp: '用手转动整体并快速松开时',
  settingsArrowLabels: '箭头上的按键标签',
  arrowLabelOption: { auto: '自动', all: '全部', none: '不显示' },
  settingsArrowLabelsHelp: '自动：4×4×4 以上只显示所点格子所在的行和列（触屏设备不显示）',
  settingsMirrors: '显示镜子',
  settingsMirrorsHelp: '关闭后魔方显示得更大，运行也更流畅',
  settingsQuality: '画质',
  qualityOption: { auto: '自动（卡顿时降低）', high: '清晰', low: '流畅' },
  settingsQualityHelp: '如果画面卡顿，请选择“流畅”',
  slowHint: '如果感觉卡顿，可在设置中关闭镜子',

  keymapTitle: '按键设置',
  keymapHelp: '先按要更改的操作的按键，再按新的按键。加 Shift 反向转动，加 Alt 转半圈。数字键选择第几层，Ctrl+Z 撤销，Ctrl+Y 重做。',
  keymapWaiting: '请按一个键（Esc 取消）',
  keymapReserved: (k) => `“${k}”不能设置`,
  keymapSwapped: (k, other) => `已与使用“${k}”的“${other}”互换`,
  keymapSaveTitle: '把当前的按键设置保存到文件',
  keymapLoadTitle: '从文件读取按键设置',
  keymapLoaded: '已改用文件中的按键设置',
  keymapLoadFailed: '无法从这个文件读取按键设置',
  keymapDefault: '恢复默认按键',
  close: '关闭',
  action: {
    U: '上面', D: '下面', L: '左面', R: '右面', F: '前面', B: '后面',
    M: '竖中层', E: '横中层', S: '前后中层',
    x: '转动整体（前面向上）', y: '转动整体（前面向左）', z: '转动整体（顺时针）',
    wide: '多层一起转（先按）', home: '归位（回到最初视角）',
  },

  tabControls: '操作',
  tabSequences: '步骤',
  tabGames: '对局记录',
  gameNow: (size: string, scr: number, moves: number, views: number) =>
    `当前：${size} · 打乱 ${scr} 步 · 之后 ${moves} 步 · 整体旋转 ${views} 次`,
  gameSave: '保存',
  gameSaveTitle: '把当前这局（打乱、之后的步骤和整体旋转）留在列表中',
  gameSaveEmpty: '没有可保存的步骤',
  gameSaved: (name: string) => `已保存「${name}」`,
  gameFull: '步骤太多，此后的步骤不再记录',
  gameEmpty: '打乱后转动，所有步骤都会被记住。按「保存」即可留在这里',
  gameNameAria: '对局记录的名称（可以修改）',
  gameDefaultName: (date: string, size: string) => `${date} ${size}`,
  gameInfo: (size: string, moves: number, time: string) => `${size} · ${moves} 步${time ? ` · ${time}` : ''}`,
  gamePlay: '▶ 播放',
  gamePlayTitle: '从打乱后的状态起，按记住的步骤和整体旋转重放',
  gameStop: '■ 停止',
  gameDelete: '删除',
  gameDeleteConfirm: (name: string) => `要删除「${name}」吗？删除后无法恢复。`,
  gameConfirmPlay: '要结束当前这局并播放这份对局记录吗？',
  gamePlaying: (name: string, i: number, total: number) => `播放中：${name}（${i}/${total}）`,
  gamePlayed: (name: string) => `「${name}」已播放完毕，可以接着转动`,
  gameExportTitle: '把保存的对局记录全部写入文件',
  gameExportEmpty: '没有保存的对局记录',
  gameImportTitle: '从文件读取对局记录并加入列表',
  gameImported: (k: number) => `已读取 ${k} 份对局记录`,
  gameImportFailed: '无法从这个文件读取对局记录',
  tabTitle: (name: string) => `显示「${name}」面板（显示时再按一次即收起）`,
  tabsLabel: '下方面板',
  dockHide: '▼ 收起',
  dockShow: '▲ 展开',
  dockHideTitle: '收起下方面板，让魔方显示得更大',
  dockShowTitle: '展开收起的面板',

  seqAdd: '＋ 添加',
  seqAddTitle: '添加一个存放步骤的位置',
  seqEmpty: '按「＋ 添加」新建位置，按「录制」后转动魔方，即可记住这段步骤',
  seqDefaultName: (i: number) => `步骤 ${i}`,
  seqNameAria: '步骤名称（点按即可显示它的标记，也可以修改）',
  seqInfo: (size: string, count: number) => `${size} · ${count} 步`,
  seqRecord: '● 录制',
  seqRecordStop: '■ 停止录制',
  seqRecordTitle: '记住按下后转动的步骤。撤销时，会忘掉被撤销的那一步',
  seqPlay: '▶ 播放',
  seqPlayStop: '■ 停止',
  seqPlayTitle: '以当前朝向为准，按记住的步骤转动',
  seqPlaySize: (size: string) => `这是在 ${size} 上录制的步骤。切换到相同大小即可播放`,
  seqDelete: '删除',
  seqDeleteTitle: '删除这段步骤',
  seqConfirmTitle: '确认',
  seqCancel: '取消',
  seqDeleteConfirm: (name: string) => `删除「${name}」？删除后无法恢复。`,
  seqOverwriteConfirm: (name: string) => `清除「${name}」中记住的步骤并重新录制？`,
  seqOverwriteOk: '重新录制',
  seqRecording: (name: string, count: number) => `录制中：${name}（${count} 步）`,
  seqRecorded: (name: string, count: number) => `已在「${name}」中记住 ${count} 步`,
  seqPlaying: (name: string) => `播放中：${name}`,
  seqExport: '保存到文件',
  seqExportTitle: '把所有步骤写入文件',
  seqExportEmpty: '没有可保存的步骤',
  seqImport: '打开文件',
  seqImportTitle: '从文件读取步骤，添加到列表末尾',
  seqImported: (k: number) => `已读取 ${k} 段步骤`,
  seqImportFailed: '无法从此文件读取步骤',
  seqSaveFailed: '无法保存到浏览器（请保存到文件）',
  seqMark: '标记',
  seqMarkTitle: '按下后，每点按一个格子，就会从 1 开始依次加上编号标记（再按一次结束）。选中步骤名称即可显示它的标记',
  seqMarkSize: (size: string) => `只有魔方为 ${size} 时才能添加标记`,
  seqUnmark: '删除标记',
  seqUnmarkTitle: '删除编号最大的标记',
  seqMarking: (name: string) => `正在标记「${name}」：点按格子即可从 1 开始依次编号`,
  seqViewLabel: '步骤的大小',
  seqViewOption: (size: string, count: number) => `${size}（${count}）`,
  seqEmptySize: (size: string) => `还没有 ${size} 的步骤。按「＋ 添加」即可添加`,
  seqPlayOther: (size: string) => `这是在 ${size} 上录制的步骤。按从外侧数的层数对应转动`,
  seqPlayDeep: (size: string) => `其中有转动超过一半深度的层的步骤，无法在 ${size} 上播放`,
  seqRecordSize: (size: string) => `只有魔方为 ${size} 时才能录制`,
  seqNote: '添加说明',
  seqNoteTitle: '为步骤集（所有大小的步骤合在一起，即一个文件）添加说明，显示在魔方下方的提示栏',
  seqNotePlaceholder: '步骤集的说明',

  footAbout: '关于 MOMO Cube',
  footDesc: 'MOMO Cube 是一款可在浏览器中免费游玩的 3D 魔方益智游戏。尺寸可从 1×1×1 选到 10×10×10，用手指或鼠标抓住一个面转动，让六个面各自恢复成同一种颜色。三面镜子映出背面，不用转动魔方也能看到全貌。打乱后开始计时，挑战最佳纪录。遇到困难时还可以使用提示和自动解答。无需注册账号或安装，在浏览器中即可立即游玩。',
  footTop: 'MOMO Works 首页',
  footGames: '游戏列表',
  footTools: '工具列表',
};

/** サブタイトル（app-card-design §4。日本語の画面でも英語。猫語のときは猫語を選ぶ前の言語のまま） */
export const SUBTITLE: Record<CatBase, string> = {
  ja: 'Fast Hands, Six Faces',
  en: 'Fast Hands, Six Faces',
  zh: '快手六面',
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
/** 怒った鳴き声にする文言（できない・やめる確認） */
const ERROR_KEYS = new Set(['keymapReserved', 'confirmTitle', 'confirmReset', 'confirmScramble', 'confirmSize',
  'seqDeleteConfirm', 'seqOverwriteConfirm', 'seqImportFailed', 'seqSaveFailed', 'seqPlayDeep',
  'gameDeleteConfirm', 'gameConfirmPlay', 'gameImportFailed', 'gameFull', 'keymapLoadFailed']);
/** 穏やかな鳴き声にする文言（待ち・案内） */
const CALM_KEYS = new Set(['timerWaiting', 'arrowHint', 'arrowHintSelected', 'gestureHintTouch', 'gestureHintMouse', 'keymapWaiting',
  'seqEmpty', 'seqMarking', 'seqEmptySize', 'gameEmpty']);
/** 猫語にしない文言（名前・数の書式） */
const KEEP_KEYS = new Set(['title', 'sizeOption', 'depthOption', 'seqViewOption', 'gameDefaultName']);

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

const TABLE: Record<CatBase, Strings> = { ja, en, zh };

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
