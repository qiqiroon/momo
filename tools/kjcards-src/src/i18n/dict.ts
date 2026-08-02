// ── 翻訳辞書（ja/en/zh）＋ 猫語(CAT)の動的生成
//   CAT は MOMO 共通の「動的鳴き声方式」（辞書を持たず、呼び出しごとにランダムな鳴き声）。
//   ※生成プロンプト本文（lib/prompts.ts）は言語に依らず日本語基調（UIラベルのみここで多言語化）。

export type Lang = 'ja' | 'en' | 'zh' | 'cat';
export type CatBase = 'ja' | 'en' | 'zh';
export type Dict = Record<string, string>;

const ja: Dict = {
  'topbar.save': '保存',
  'topbar.load': '読込',
  'topbar.newCard': 'カード追加',
  'topbar.newGroup': 'グループ追加',
  'topbar.reset': '新規',

  'purpose.heading': '目的',
  'purpose.message': '伝えたいこと',
  'purpose.audience': '読み手',
  'purpose.tone': '調子',
  'purpose.messagePh': '何を一番伝えたいか（1〜2文）',
  'purpose.audiencePh': '誰に向けてか（任意）',
  'purpose.tonePh': 'どんな調子か（任意）',

  'action.heading': 'AIへの橋渡し',
  'action.cardRequest': 'カード化を依頼',
  'action.import': 'カード一覧を取り込む',
  'action.handoff': '受け渡しプロンプト生成',

  'rel.heading': '関係パレット',
  'rel.family.つづく': 'つづく（前へ進む）',
  'rel.family.ぶつかる': 'ぶつかる・分かれる',
  'rel.family.支える': '支える・掘り下げる',
  'rel.free': '自由記述',
  'rel.freePh': '好きな言葉で関係を書く',
  'rel.hint': '2枚のカード（またはグループ）の右端から左端へドラッグすると線が引けます。',
  'rel.pickFirst': 'まず線に付けるラベルを選ぶか、自由記述してから、カードどうしをつないでください。',
  'rel.current': '次に引く線のラベル',
  'rel.editLabel': 'ラベルを変更',
  'rel.delete': '線を削除',

  'park.title': '退避トレイ',
  'park.hint': '今すぐ使わないカードをここへ。AIには渡りません（復活できます）。',
  'park.empty': '（空）ここにドラッグで退避',
  'park.restore': 'キャンバスへ戻す',

  'card.titlePh': '見出し',
  'card.notePh': '補足（任意・書くほどAIが忠実に膨らませます）',
  'card.park': '退避',
  'card.delete': '完全削除',

  'group.namePh': '表札（グループの見出し）',
  'group.delete': 'グループ削除',

  'modal.copy': 'クリップボードにコピー',
  'modal.copied': 'コピーしました',
  'modal.close': '閉じる',
  'modal.cardRequestTitle': 'カード化依頼プロンプト',
  'modal.cardRequestLead': 'このプロンプトをコピーして、取り留めのない文章と一緒にお使いのAIへ貼ってください。AIが返した行形式のカード一覧を、次の「カード一覧を取り込む」で貼り込みます。',
  'modal.sourceLabel': '（任意）ここに元の文章を入れると、プロンプトに埋め込みます',
  'modal.sourcePh': '取り留めのない考えを貼る…（空でもOK。AI側で貼ってもOK）',
  'modal.handoffTitle': '受け渡しプロンプト',
  'modal.handoffLead': '盤面の構造（退避カードを除く）＋目的＋指示を1枚にまとめました。コピーしてお使いのAIへ貼ると、語る順番を提案してくれます。',

  'import.title': 'カード一覧の取り込み',
  'import.pastePh': 'AIが返したカード一覧をここに貼り付け（1行＝1カード、「見出し ｜ 補足」）',
  'import.run': '取り込む',
  'import.resultTpl': '{total}行中 {imported}件を取り込み／{skipped}件スキップ',
  'import.emptyWarn': '取り込める行がありませんでした。貼り付けた内容を直してから、もう一度お試しください。',
  'import.fixPrompt': 'AIに直させる依頼文をコピー',
  'import.localTitle': 'AIを使わない簡易分割',
  'import.localLead': '手早く試すための代替です。粒度・重複整理の質はAI経路に劣ります。',
  'import.localLine': '各行を1カードにする',
  'import.localBlank': '空行で段落を区切る',

  'misc.unfiled': '未分類',
  'confirm.deleteCard': 'このカードを完全に削除しますか？（参照する関係線も消えます）',
  'confirm.deleteGroup': 'このグループを削除しますか？（中のカードは残り、未所属に戻ります）',
  'confirm.reset': '盤面を新規にしますか？未保存の内容は失われます。',
  'confirm.load': '現在の盤面を、読み込む内容で置き換えますか？',

  'lang.auto': '自動',
  'lang.ja': '日本語',
  'lang.en': 'English',
  'lang.zh': '中文',
  'lang.cat': 'にゃんこ語',
};

const en: Dict = {
  'topbar.save': 'Save',
  'topbar.load': 'Load',
  'topbar.newCard': 'Add card',
  'topbar.newGroup': 'Add group',
  'topbar.reset': 'New',

  'purpose.heading': 'Purpose',
  'purpose.message': 'Message',
  'purpose.audience': 'Audience',
  'purpose.tone': 'Tone',
  'purpose.messagePh': 'What you most want to say (1–2 sentences)',
  'purpose.audiencePh': 'Who it is for (optional)',
  'purpose.tonePh': 'In what tone (optional)',

  'action.heading': 'Bridge to your AI',
  'action.cardRequest': 'Ask AI to make cards',
  'action.import': 'Import card list',
  'action.handoff': 'Build handoff prompt',

  'rel.heading': 'Relation palette',
  'rel.family.つづく': 'Continue (move forward)',
  'rel.family.ぶつかる': 'Contrast / diverge',
  'rel.family.支える': 'Support / dig deeper',
  'rel.free': 'Free text',
  'rel.freePh': 'Describe the relation in your own words',
  'rel.hint': 'Drag from the right edge of one card (or group) to the left edge of another to draw a line.',
  'rel.pickFirst': 'Pick or type a label first, then connect two cards.',
  'rel.current': 'Label for the next line',
  'rel.editLabel': 'Change label',
  'rel.delete': 'Delete line',

  'park.title': 'Park tray',
  'park.hint': 'Drop cards you are not using here. They are not sent to the AI (you can restore them).',
  'park.empty': '(empty) drag cards here to park',
  'park.restore': 'Restore to canvas',

  'card.titlePh': 'Heading',
  'card.notePh': 'Note (optional — the more you write, the more faithfully AI expands it)',
  'card.park': 'Park',
  'card.delete': 'Delete',

  'group.namePh': 'Label (group heading)',
  'group.delete': 'Delete group',

  'modal.copy': 'Copy to clipboard',
  'modal.copied': 'Copied',
  'modal.close': 'Close',
  'modal.cardRequestTitle': 'Card-request prompt',
  'modal.cardRequestLead': 'Copy this prompt and paste it into your AI together with your rough text. Then paste the line-format card list the AI returns into “Import card list”.',
  'modal.sourceLabel': '(optional) Put your source text here to embed it in the prompt',
  'modal.sourcePh': 'Paste your rough thoughts… (may be left empty; you can also paste on the AI side)',
  'modal.handoffTitle': 'Handoff prompt',
  'modal.handoffLead': 'The board structure (excluding parked cards) plus purpose and instructions, in one sheet. Copy and paste it into your AI to get ordering proposals.',

  'import.title': 'Import card list',
  'import.pastePh': 'Paste the AI’s card list here (1 line = 1 card, “heading ｜ note”)',
  'import.run': 'Import',
  'import.resultTpl': 'Imported {imported} of {total} lines / {skipped} skipped',
  'import.emptyWarn': 'Nothing could be imported. Fix the pasted text and try again.',
  'import.fixPrompt': 'Copy a request to have the AI fix it',
  'import.localTitle': 'Simple split (no AI)',
  'import.localLead': 'A quick alternative. Granularity and dedup quality are inferior to the AI route.',
  'import.localLine': 'Each line as one card',
  'import.localBlank': 'Split paragraphs by blank lines',

  'misc.unfiled': 'Unfiled',
  'confirm.deleteCard': 'Delete this card for good? (Relations referring to it are also removed.)',
  'confirm.deleteGroup': 'Delete this group? (Cards inside stay and become unfiled.)',
  'confirm.reset': 'Start a new board? Unsaved content will be lost.',
  'confirm.load': 'Replace the current board with the loaded content?',

  'lang.auto': 'Auto',
  'lang.ja': '日本語',
  'lang.en': 'English',
  'lang.zh': '中文',
  'lang.cat': 'Meow',
};

const zh: Dict = {
  'topbar.save': '保存',
  'topbar.load': '读取',
  'topbar.newCard': '添加卡片',
  'topbar.newGroup': '添加分组',
  'topbar.reset': '新建',

  'purpose.heading': '目的',
  'purpose.message': '想传达的',
  'purpose.audience': '读者',
  'purpose.tone': '语气',
  'purpose.messagePh': '最想表达什么（1〜2句）',
  'purpose.audiencePh': '写给谁（可选）',
  'purpose.tonePh': '什么语气（可选）',

  'action.heading': '交给你的AI',
  'action.cardRequest': '请AI拆成卡片',
  'action.import': '导入卡片列表',
  'action.handoff': '生成交接提示词',

  'rel.heading': '关系面板',
  'rel.family.つづく': '延续（向前推进）',
  'rel.family.ぶつかる': '对立·分歧',
  'rel.family.支える': '支撑·深入',
  'rel.free': '自由描述',
  'rel.freePh': '用你自己的话描述关系',
  'rel.hint': '从一张卡片（或分组）的右边拖到另一张的左边即可连线。',
  'rel.pickFirst': '先选择或输入标签，再连接两张卡片。',
  'rel.current': '下一条线的标签',
  'rel.editLabel': '修改标签',
  'rel.delete': '删除连线',

  'park.title': '暂存盘',
  'park.hint': '把暂时不用的卡片放到这里。不会交给AI（可以还原）。',
  'park.empty': '（空）拖动卡片到此暂存',
  'park.restore': '还原到画布',

  'card.titlePh': '标题',
  'card.notePh': '补充（可选——写得越多，AI越忠实地展开）',
  'card.park': '暂存',
  'card.delete': '彻底删除',

  'group.namePh': '标签（分组标题）',
  'group.delete': '删除分组',

  'modal.copy': '复制到剪贴板',
  'modal.copied': '已复制',
  'modal.close': '关闭',
  'modal.cardRequestTitle': '拆卡请求提示词',
  'modal.cardRequestLead': '复制此提示词，连同你零散的文字一起贴给你的AI。然后把AI返回的行式卡片列表贴到“导入卡片列表”。',
  'modal.sourceLabel': '（可选）在此放入原文，会嵌入到提示词中',
  'modal.sourcePh': '粘贴你零散的想法……（可留空，也可在AI一侧粘贴）',
  'modal.handoffTitle': '交接提示词',
  'modal.handoffLead': '把盘面结构（不含暂存卡片）加上目的与指示汇成一页。复制并贴给你的AI，即可获得顺序提案。',

  'import.title': '导入卡片列表',
  'import.pastePh': '把AI返回的卡片列表贴在这里（1行＝1卡片，“标题 ｜ 补充”）',
  'import.run': '导入',
  'import.resultTpl': '共{total}行，导入{imported}项／跳过{skipped}项',
  'import.emptyWarn': '没有可导入的行。请修改粘贴的内容后重试。',
  'import.fixPrompt': '复制让AI改正的请求',
  'import.localTitle': '简易拆分（不用AI）',
  'import.localLead': '快速的替代方案。颗粒度与去重质量不如AI路径。',
  'import.localLine': '每行一张卡片',
  'import.localBlank': '按空行切分段落',

  'misc.unfiled': '未分类',
  'confirm.deleteCard': '要彻底删除这张卡片吗？（引用它的连线也会一并删除）',
  'confirm.deleteGroup': '要删除这个分组吗？（里面的卡片会保留并变为未分类）',
  'confirm.reset': '要新建盘面吗？未保存的内容会丢失。',
  'confirm.load': '用读取的内容替换当前盘面吗？',

  'lang.auto': '自动',
  'lang.ja': '日本語',
  'lang.en': 'English',
  'lang.zh': '中文',
  'lang.cat': '喵语',
};

const DICTS: Record<CatBase, Dict> = { ja, en, zh };

// ── CAT（動的鳴き声）: 呼び出しごとにランダム。画面が固まるよう世代キャッシュ。
const catCache = new Map<string, { gen: number; base: CatBase; value: string }>();
let cacheGen = 0;
export function resetCatCache(): void {
  cacheGen++;
}
function catSpeak(key: string, base: CatBase): string {
  const cached = catCache.get(key);
  if (cached && cached.gen === cacheGen && cached.base === base) return cached.value;
  let vocab: readonly string[];
  if (base === 'en') vocab = ['meow', 'Meow', 'mrrow', 'mew', 'nya~'];
  else if (base === 'zh') vocab = ['喵', '喵喵', '喵呜', '喵～'];
  else vocab = ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'にゃん'];
  const value = vocab[Math.floor(Math.random() * vocab.length)];
  catCache.set(key, { gen: cacheGen, base, value });
  return value;
}

/** キー → 表示文字列。cat のときは動的鳴き声、無い訳語は ja→キーへフォールバック。 */
export function translate(key: string, lang: Lang, catBase: CatBase): string {
  if (lang === 'cat') return catSpeak(key, catBase);
  const dict = DICTS[lang] ?? ja;
  return dict[key] ?? ja[key] ?? key;
}
