// MOMO Life — 画面（モードを選ぶ画面と、選んだ世界を GPU で計算・描画して眺める画面）
// 詳細仕様書 §10（描画と計算の速さを分ける）・§12（画面）。言語は lib/momo-lang（ja/en/zh/cat）
import { getGPU, LifeGPU, HIST_N, OCC_TILE } from './life-gpu.js';
import { compile, TEMPLATES, hexToRGBA } from './life-rules.js';
import { MotherSet, planMothers, domR2 } from './life-mother.js';
import { ChainState, CHAIN_DEFAULTS, chainName, chainMax } from './life-chain.js';
import { LS, O as LO } from './life-learn.js';
import { makeBoard, fillRandom } from './life-cpu.js';
import { checkRule, checkTargets, LETTERS, FREE_MAX } from './life-expr.js';
import { steady, recordResult, nextPattern, pickTile } from './life-gen.js';
import { HELP, WARN, WARN_ICON, ruby } from './life-help.js';
import { BATTLE, DEFAULT_PATTERNS, defaultPatterns, patInfo, battleWorld } from './life-battle.js';

const $ = id => document.getElementById(id);
const VERSION = 'v0.05';

// ── 言葉（ja / en / zh。猫語は鳴き声に置き換える） ──
const I18N = {
  ja: {
    modeLabel: '世界を選ぶ',
    modeChain: '連鎖して増える', modeChainDesc: '空の盤と Conway のマザー1つから始まり、2,000 世代ごとに新しい種族が生まれて 32 種まで増えます。マザーは置き形を学び、弱い種族はルールを引き直されます。',
    modeFour: '4種族', modeFourDesc: '緑・水色・桃の3種族がじゃんけんの形で食べ合い、黄は誰も食べません。マザーが種族をまき続けます。',
    modeFree: '自由編集モード', modeFreeDesc: '空の盤から始めます。マウスで生き物を置いたり消したりでき、種族を足して、生まれる・生き残る条件を自由に書けます。最初は Conway のライフゲーム（B3/S23）の1種族です。',
    modeBattle: '対戦', modeBattleDesc: 'あなたは緑の G1。エネルギーをためて型（グライダーやどんぐりなど）を置き、コンピュータの種族と陣地を奪い合います。自分以外の種族を全滅させたら勝ちです。',
    btSpecies: '種族の数', btRule: 'ルール（全種族共通）', btYou: '（あなた）', btPatTitle: '型（1〜0 のキーでも選べる）',
    btMe: 'エネルギー {e}　1マス {p}　収入 +{i}/秒　あと {w} 秒', btCost: '{n} マス ＝ {e}',
    btHint: '盤を押すと、点線の中に型を置きます。型の絵を押すと書きかえられます（エネルギーは使いません）。',
    btPatReset: '最初の形に戻す', btPatClear: '空にする', btWin: 'あなたの勝ち！ ほかの種族が全滅しました', btLose: 'あなたの負け… G1 が全滅しました', btAgain: 'もう一度',
    btGrow: '増やした', btShoot: 'グライダーを撃った', btBomb: 'どんぐりで爆撃', btSave: 'ためている', btEscort: 'グライダーを追っている', btDead: '全滅',
    btNo_far: '点線の外には置けません', btNo_cost: 'エネルギーが足りません', btNo_empty: 'この型は空です', btNo_full: 'そこは全部ふさがっています', btNo_zoc: 'ほかの種族の陣地（相手の点線の中）には置けません', btNo_over: '対戦は終わりました',
    pt_block: 'ブロック', pt_beacon: 'ビーコン', pt_gliderSE: 'グライダー ↘', pt_gliderSW: 'グライダー ↙', pt_gliderNE: 'グライダー ↗', pt_gliderNW: 'グライダー ↖', pt_acorn: 'どんぐり（Acorn）', pt_empty: '（空き）', pt_custom: '自作',
    btColName: '種族', btColCells: 'マス', btColEnergy: 'エネルギー', btColPrice: '1マス', btColAct: 'いまの動き',
    fold: '畳む', unfold: '広げる', graph: '人口',
    toolMove: '動かす', toolDraw: '置く', toolErase: '消す', randomFill: 'ランダムに配置', clearAll: '全部消す', addSp: '＋ 種族を足す',
    colOn: '使う', colBirth: '生まれる', colSurvive: '生き残る', colEat: '食べる', colTarget: '食べる相手', colGen: '発生',
    genOn: '発生', genOff: '止める', genBest: '最長', genNow: 'いま', genTip: '空いた場所に形を1つ置き、数が落ち着いたら次を置きます（覚えた長生きの形4つ → でたらめな形4つ）',
    exprHelp: '周り8マスの数で書きます。A・B …＝その種族の数、A+B＝合計、?＝すべての種族の数。比べ方は = != < <= > >=、つなぎは AND・OR・かっこ。「23」のように数字だけなら自分の種族の数。「食べる」は相手のマスの周りで数え、成り立つと相手を自分の種族に変えます（自分が周りに1つ以上いるとき。生き残りの条件は見ません）。「食べる相手」は文字を並べます：AB＝AとB、A-C＝AからC、?＝だれでも。いくつかの種族が食べられるときは等しい確率で1つ。',
    optsTitle: '盤の設定', optSize: '盤の大きさ', optWrap: '端をつなぐ', optSeed: '種（同じ数なら同じ動き）', optSeedRand: 'ランダム（毎回変わる）',
    back: '← 世界を選ぶ', pause: '一時停止', resume: '再開', step: '1世代', reset: 'はじめから', speed: '速さ', perSecN: '{n} 世代/秒',
    mCount: 'マザー', mNone: 'なし', mMode: '置き方', mEmpty: '空のマスだけ', mOver: '上書き',
    showMother: 'マザー', showDomain: '支配領域', showLearn: '学習の様子', fade: 'フェード',
    gen: '世代', calc: '計算', perSec: '世代/秒', draw: '描画',
    spGreen: '緑', spCyan: '水色', spPink: '桃', spYellow: '黄', spN: '種{n}',
    learnFmt: '回{n}・勝{w}', learnFixed: '・固定',
    help: '説明', aboutLife: 'ライフゲームとは', close: '閉じる', sortStrong: '強い順',
    mcTitle: 'マザーの働き', mcOn: 'マザーを出す', mcLearn: '学習（組み換え）', mcDom: '支配領域', mcRep: 'ルールの引き直し',
    mSave: 'マザーの値を保存', mLoad: '読み出し', fSave: '保存', fLoad: '読み出し', showTitle: '表示',
    loadBad: 'このファイルは読めませんでした。', loadWrong: 'このファイルは「{m}」の世界のものです。', repLog: 'ルールの引き直しの記録', repNone: 'まだ引き直していません', repGen: '{g} 世代', repVer: '{v} 回目', repRank: '{r} 位・{n} マス', why_zero: '0 になった', why_thin: '支配領域を埋められない', why_eater: '多い組を食べる弱い種族', why_small: '全体で少ない', calm: '明滅をおさえる', loaded: '読み出しました', saved: '保存しました', showLabel: 'ラベル', seedNow: '種 {n}', zoomIn: '拡大', zoomOut: '縮小',
    noGpu: 'このブラウザは WebGPU に対応していません。Chrome や Edge の新しい版で開いてください。',
    notSecure: 'WebGPU は https か localhost でしか使えません。', noAdapter: 'GPU を使えませんでした。',
    lost: 'GPU が使えなくなりました（{m}）。ページを読み込み直してください。',
  },
  en: {
    modeLabel: 'Choose a world',
    modeChain: 'Chain of species', modeChainDesc: 'Starts from an empty board and one Conway mother. Every 2,000 generations a new species appears, up to 32. Mothers learn which pattern to plant, and weak species have their rules redrawn.',
    modeFour: 'Four species', modeFourDesc: 'Green, cyan and pink eat one another like rock-paper-scissors; yellow eats nobody. Mothers keep sowing each species.',
    modeFree: 'Free edit', modeFreeDesc: 'Starts from an empty board. Place or erase creatures with the mouse, add species, and write your own birth and survival conditions. You begin with one species following Conway’s Game of Life (B3/S23).',
    modeBattle: 'Battle', modeBattleDesc: 'You are green G1. Gather energy, place patterns such as gliders and acorns, and fight computer species for territory. Wipe out every other species to win.',
    btSpecies: 'Species', btRule: 'Rule (all species)', btYou: '(you)', btPatTitle: 'Patterns (keys 1–0 also select)',
    btMe: 'Energy {e}   per cell {p}   income +{i}/s   wait {w} s', btCost: '{n} cells = {e}',
    btHint: 'Click the board to place the pattern inside the dotted line. Click the pattern picture to edit it (no energy needed).',
    btPatReset: 'Reset to original', btPatClear: 'Clear', btWin: 'You win! Every other species is gone', btLose: 'You lose… G1 has been wiped out', btAgain: 'Play again',
    btGrow: 'grew', btShoot: 'fired a glider', btBomb: 'acorn bombing', btSave: 'saving', btEscort: 'following its glider', btDead: 'wiped out',
    btNo_far: 'You can only place inside the dotted line', btNo_cost: 'Not enough energy', btNo_empty: 'This pattern is empty', btNo_full: 'Every cell there is already taken', btNo_zoc: 'You cannot place inside another species’ zone', btNo_over: 'The battle is over',
    pt_block: 'Block', pt_beacon: 'Beacon', pt_gliderSE: 'Glider ↘', pt_gliderSW: 'Glider ↙', pt_gliderNE: 'Glider ↗', pt_gliderNW: 'Glider ↖', pt_acorn: 'Acorn', pt_empty: '(empty)', pt_custom: 'Custom',
    btColName: 'Species', btColCells: 'Cells', btColEnergy: 'Energy', btColPrice: 'Per cell', btColAct: 'Doing',
    fold: 'Fold', unfold: 'Unfold', graph: 'Population',
    toolMove: 'Move', toolDraw: 'Draw', toolErase: 'Erase', randomFill: 'Random fill', clearAll: 'Clear', addSp: '+ Add species',
    colOn: 'On', colBirth: 'Born', colSurvive: 'Survives', colEat: 'Eats', colTarget: 'Prey', colGen: 'Spawn',
    genOn: 'Spawn', genOff: 'Stop', genBest: 'Best', genNow: 'now', genTip: 'Places one pattern in an empty spot and the next once the count settles (the 4 longest-lived remembered patterns, then 4 random ones)',
    exprHelp: 'Count the 8 neighbours. A, B … = that species, A+B = sum, ? = all species. Compare with = != < <= > >=, combine with AND, OR and brackets. Digits alone such as "23" mean your own species. "Eats" is counted around the prey cell; when it holds (and at least one of yours is adjacent) the prey becomes your species, regardless of survival. "Prey" lists letters: AB = A and B, A-C = A to C, ? = anyone. If several species can eat, one is chosen at random.',
    optsTitle: 'Board settings', optSize: 'Board size', optWrap: 'Wrap edges', optSeed: 'Seed (same number, same run)', optSeedRand: 'Random (changes every time)',
    back: '← Choose a world', pause: 'Pause', resume: 'Resume', step: '1 gen', reset: 'Restart', speed: 'Speed', perSecN: '{n} gen/s',
    mCount: 'Mothers', mNone: 'None', mMode: 'Sowing', mEmpty: 'Empty cells only', mOver: 'Overwrite',
    showMother: 'Mothers', showDomain: 'Domains', showLearn: 'Learning', fade: 'Fade',
    gen: 'Gen', calc: 'Compute', perSec: 'gen/s', draw: 'Draw',
    spGreen: 'Green', spCyan: 'Cyan', spPink: 'Pink', spYellow: 'Yellow', spN: 'S{n}',
    learnFmt: 'tries {n} · wins {w}', learnFixed: ' · fixed',
    help: 'Guide', aboutLife: 'What is the Game of Life?', close: 'Close', sortStrong: 'Strongest first',
    mcTitle: 'Mothers', mcOn: 'Show mothers', mcLearn: 'Learning', mcDom: 'Domain', mcRep: 'Redraw rules',
    mSave: 'Save mothers', mLoad: 'Load', fSave: 'Save', fLoad: 'Load', showTitle: 'Show',
    loadBad: 'This file could not be read.', loadWrong: 'This file belongs to the “{m}” world.', repLog: 'Rule redraw log', repNone: 'No redraws yet', repGen: 'gen {g}', repVer: '#{v}', repRank: 'rank {r}, {n} cells', why_zero: 'died out', why_thin: 'could not fill its domain', why_eater: 'weak eater of a large group', why_small: 'few overall', calm: 'Reduce flicker', loaded: 'Loaded', saved: 'Saved', showLabel: 'Labels', seedNow: 'Seed {n}', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    noGpu: 'This browser does not support WebGPU. Please open it in a recent Chrome or Edge.',
    notSecure: 'WebGPU only works on https or localhost.', noAdapter: 'Could not use the GPU.',
    lost: 'The GPU was lost ({m}). Please reload the page.',
  },
  zh: {
    modeLabel: '选择世界',
    modeChain: '连锁增长', modeChainDesc: '从空棋盘和一个 Conway 母体开始，每 2,000 代诞生一个新物种，最多 32 种。母体会学习放置的图案，弱小物种的规则会被重新抽取。',
    modeFour: '四个物种', modeFourDesc: '绿、青、粉三个物种像石头剪刀布一样互相捕食，黄色不吃任何物种。母体不断播撒各个物种。',
    modeFree: '自由编辑', modeFreeDesc: '从空棋盘开始。可以用鼠标放置或擦除生物，增加物种，并自由编写诞生和存活的条件。最初是 Conway 生命游戏（B3/S23）的一个物种。',
    modeBattle: '对战', modeBattleDesc: '你是绿色的 G1。积攒能量，放置滑翔机、橡子等图案，与电脑控制的物种争夺地盘。消灭其他所有物种即获胜。',
    btSpecies: '物种数', btRule: '规则（所有物种相同）', btYou: '（你）', btPatTitle: '图案（也可用 1〜0 键选择）',
    btMe: '能量 {e}　每格 {p}　收入 +{i}/秒　还需 {w} 秒', btCost: '{n} 格 ＝ {e}',
    btHint: '点击棋盘，在虚线内放置图案。点击图案画面可以修改（不消耗能量）。',
    btPatReset: '恢复原样', btPatClear: '清空', btWin: '你赢了！其他物种全部消灭', btLose: '你输了… G1 已全部消灭', btAgain: '再来一次',
    btGrow: '扩张', btShoot: '发射了滑翔机', btBomb: '用橡子轰炸', btSave: '积攒中', btEscort: '跟随滑翔机', btDead: '已消灭',
    btNo_far: '只能放在虚线内', btNo_cost: '能量不足', btNo_empty: '这个图案是空的', btNo_full: '那里的格子都已被占', btNo_zoc: '不能放在其他物种的地盘（对方的虚线内）', btNo_over: '对战已结束',
    pt_block: '方块', pt_beacon: '信标', pt_gliderSE: '滑翔机 ↘', pt_gliderSW: '滑翔机 ↙', pt_gliderNE: '滑翔机 ↗', pt_gliderNW: '滑翔机 ↖', pt_acorn: '橡子（Acorn）', pt_empty: '（空）', pt_custom: '自制',
    btColName: '物种', btColCells: '格', btColEnergy: '能量', btColPrice: '每格', btColAct: '当前动作',
    fold: '收起', unfold: '展开', graph: '数量',
    toolMove: '移动', toolDraw: '放置', toolErase: '擦除', randomFill: '随机放置', clearAll: '全部清除', addSp: '＋ 增加物种',
    colOn: '使用', colBirth: '诞生', colSurvive: '存活', colEat: '吃', colTarget: '猎物', colGen: '生成',
    genOn: '生成', genOff: '停止', genBest: '最长', genNow: '当前', genTip: '在空位放一个图案，数量稳定后再放下一个（记住的4个长寿图案 → 4个随机图案）',
    exprHelp: '按周围 8 格的数量书写。A、B …＝该物种的数量，A+B＝合计，?＝所有物种的数量。比较用 = != < <= > >=，连接用 AND、OR 和括号。只写数字（如“23”）表示自己物种的数量。“吃”在猎物格周围计数，成立时（且周围至少有一个自己）猎物变成自己的物种，不看存活条件。“猎物”列出字母：AB＝A和B，A-C＝A到C，?＝任何。多个物种都能吃时，等概率选一个。',
    optsTitle: '棋盘设置', optSize: '棋盘大小', optWrap: '边缘相连', optSeed: '种子（相同数字，相同过程）', optSeedRand: '随机（每次不同）',
    back: '← 选择世界', pause: '暂停', resume: '继续', step: '1 代', reset: '重新开始', speed: '速度', perSecN: '{n} 代/秒',
    mCount: '母体', mNone: '无', mMode: '放置方式', mEmpty: '仅空格', mOver: '覆盖',
    showMother: '母体', showDomain: '领域', showLearn: '学习情况', fade: '淡出',
    gen: '代', calc: '计算', perSec: '代/秒', draw: '绘制',
    spGreen: '绿', spCyan: '青', spPink: '粉', spYellow: '黄', spN: '种{n}',
    learnFmt: '试{n}·胜{w}', learnFixed: '·固定',
    help: '说明', aboutLife: '什么是生命游戏', close: '关闭', sortStrong: '强者优先',
    mcTitle: '母体的作用', mcOn: '显示母体', mcLearn: '学习（重组）', mcDom: '领域', mcRep: '规则重抽',
    mSave: '保存母体', mLoad: '读取', fSave: '保存', fLoad: '读取', showTitle: '显示',
    loadBad: '无法读取这个文件。', loadWrong: '这个文件属于“{m}”世界。', repLog: '规则重抽记录', repNone: '还没有重抽', repGen: '第 {g} 代', repVer: '第 {v} 次', repRank: '第 {r} 名・{n} 格', why_zero: '数量变为 0', why_thin: '填不满支配领域', why_eater: '吃大组的弱种族', why_small: '整体数量少', calm: '减少闪烁', loaded: '已读取', saved: '已保存', showLabel: '标签', seedNow: '种子 {n}', zoomIn: '放大', zoomOut: '缩小',
    noGpu: '此浏览器不支持 WebGPU。请使用新版 Chrome 或 Edge 打开。',
    notSecure: 'WebGPU 只能在 https 或 localhost 上使用。', noAdapter: '无法使用 GPU。',
    lost: 'GPU 已不可用（{m}）。请重新载入页面。',
  },
};
// 猫語にしない言葉（数字の書き方と、困ったときの知らせ）
const CAT_KEEP = { seedNow: 1, repGen: 1, repVer: 1, repRank: 1, why_zero: 1, why_thin: 1, why_eater: 1, why_small: 1, repNone: 1, loadBad: 1, loadWrong: 1, perSecN: 1, learnFmt: 1, learnFixed: 1, spN: 1, noGpu: 1, notSecure: 1, noAdapter: 1, lost: 1 };
const SUBTITLE = { ja: 'Tiny Rules, Boundless Life', en: 'Tiny Rules, Boundless Life', zh: '微则无边，万生涌现' };
const LANG_APP_ID = 'life';
const LANGS = ['ja', 'en', 'zh', 'cat'];
if (window.MomoLang) MomoLang.bind(LANG_APP_ID, { supportedLangs: LANGS });
function detectLang() {
  try {
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (const x of list) { const l = (x || '').toLowerCase(); if (l.startsWith('ja')) return 'ja'; if (l.startsWith('zh')) return 'zh'; if (l.startsWith('en')) return 'en'; }
    return 'en';
  } catch (e) { return 'ja'; }
}
let langMode = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
let lang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID) : (LANGS.includes(langMode) ? langMode : detectLang());
let fallbackCatBase = 'ja';
const catBase = () => { const b = window.MomoLang ? MomoLang.getCatBase(LANG_APP_ID) : fallbackCatBase; return I18N[b] ? b : 'ja'; };
function meow(key) {
  const b = catBase();
  const v = b === 'en' ? ['meow', 'MEOW', 'mrrrow', 'mew', 'purr…'] : b === 'zh' ? ['喵', '喵喵', '喵！', '喵呜…', '呼噜…'] : ['にゃ', 'にゃー', 'にゃ！', 'みゃ', 'ごろごろ…'];
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;   // 同じ言葉は同じ鳴き声
  return v[h % v.length];
}
function t(key, params) {
  let s = lang === 'cat' && !CAT_KEEP[key] ? meow(key) : (I18N[lang === 'cat' ? catBase() : lang] || I18N.ja)[key];
  if (s == null) s = I18N.ja[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
  return s;
}
function applyLang() {
  const sl = lang === 'cat' ? 'en' : lang;   // 猫語のときのサブタイトルは英語
  for (const id of ['subtitle', 'hud-subtitle']) { const sub = $(id); sub.textContent = SUBTITLE[sl] || SUBTITLE.en; sub.classList.toggle('zh', sl === 'zh'); }
  $('zoom-in').title = t('zoomIn'); $('zoom-out').title = t('zoomOut');
  showSeed();
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const base = lang === 'cat' ? catBase() : lang;
  document.documentElement.lang = base === 'zh' ? 'zh-Hans' : base;
  $('lang-select').value = langMode;
  $('btn-play').textContent = t(running ? 'pause' : 'resume');
  $('speed-v').textContent = t('perSecN', { n: speed() });
  if (mode) $('mode-now').textContent = t(MODE_KEY[mode]);
  if (life) showLegend();
  for (const id of ['hud', 'graph']) $(id === 'hud' ? 'btn-fold' : 'btn-graph').title = t($(id).classList.contains('folded') ? 'unfold' : 'fold');
  if (isFree()) renderSpTable();
  renderBattle();
  drawGraph();
  if ($('help-dlg').open) fillHelp(helpKey);
  showWarnTitle();
  if ($('warn-dlg').open) fillWarnDlg();
  fillConsent();
  if (life) renderReps();
  if (window.MomoAbout) MomoAbout.apply(lang);   // 説明欄（lib/momo-about.js）
}
function onLangChange(m) {
  if (!window.MomoLang && m === 'cat' && lang !== 'cat') fallbackCatBase = lang;
  langMode = m;
  lang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, m) : (m === 'auto' ? detectLang() : m);
  applyLang();
}

// ── モード ──
const MODE_KEY = { chain: 'modeChain', four: 'modeFour', free: 'modeFree', battle: 'modeBattle' };
let mode = null;            // いま眺めている世界（null ならモードを選ぶ画面）
const isChain = () => mode === 'chain';
const isFree = () => mode === 'free';
const isBattle = () => mode === 'battle';
const curWorld = () => life?.chain?.world ?? world;
const SP_KEY = { Green: 'spGreen', Cyan: 'spCyan', Pink: 'spPink', Yellow: 'spYellow' };
const spName = sp => isFree() ? LETTERS[sp.id - 1] : isChain() || isBattle() ? chainName(sp.id) : t(SP_KEY[sp.name?.en] ?? 'spN', { n: sp.id });

const canvas = $('board');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
// 速さのつまみ（0〜10）→ 世代/秒
const SPEEDS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 120, 240];
const MAX_STEPS_PER_FRAME = 16; // 1回の描画で進める世代の上限（追いつけないときに固まらないように）

const BG = [0.04, 0.04, 0.04, 1];
const COLORS = {
  grid: [0.16, 0.16, 0.16, 1],
  edge: [0.0, 0.0, 0.0, 1],
};

let gpu = null, life = null, world = null;
let running = true;
let acc = 0;              // 次の世代までにたまった分（1 で 1世代）
let view = { ox: 0, oy: 0, cpp: 1 };
let last = performance.now();
let frames = 0, gensDone = 0, statT = last;

function showMsg(text) { const m = $('msg'); m.textContent = text; m.hidden = false; }
function titleMsg(text) { const m = $('title-msg'); m.textContent = text; m.hidden = !text; }

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
}

// マザーの円と支配領域を、盤の上に線で描く（いまの位置＝次に供給する位置）
function drawMothers() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const ms = life.mothers;
  const showM = $('mshow').checked, showD = $('dshow').checked, showL = $('lblshow').checked;
  if (!ms || ms.off || (!showM && !showD && !showL)) return;
  const dpr = window.devicePixelRatio || 1;
  octx.lineWidth = 1.5 * dpr;
  octx.font = `500 ${12 * dpr}px 'Noto Sans JP', sans-serif`; octx.textBaseline = 'middle';
  const ws = curWorld().species;
  const copies = life.wrap ? [-1, 0, 1] : [0];
  for (const m of ms.ms) {
    const r = Math.max(2 * dpr, m.diameter / 2 / view.cpp);
    octx.strokeStyle = curWorld().species[m.kind - 1].color;
    octx.globalAlpha = m.active ? 0.9 : 0.3;
    for (const ky of copies) for (const kx of copies) {
      const px = (m.x + 0.5 + kx * life.W - view.ox) / view.cpp;
      const py = (m.y + 0.5 + ky * life.H - view.oy) / view.cpp;
      // 支配領域（§18 の②。Q74 で円に）：中心のマスから半径 √domR2 の円を、細い点線で描く
      const half = m.domain > 0 ? Math.floor(m.domain / 2) : 0;
      if (half && showD && !ms.noDomain) {
        const cx = (Math.floor(m.x) + 0.5 + kx * life.W - view.ox) / view.cpp;
        const cy = (Math.floor(m.y) + 0.5 + ky * life.H - view.oy) / view.cpp;
        const R = (Math.sqrt(domR2(half)) + 0.5) / view.cpp;
        if (cx - R < overlay.width && cy - R < overlay.height && cx + R > 0 && cy + R > 0) {
          octx.save(); octx.globalAlpha *= 0.55; octx.lineWidth = dpr; octx.setLineDash([4 * dpr, 4 * dpr]);
          octx.beginPath(); octx.arc(cx, cy, R, 0, Math.PI * 2); octx.stroke(); octx.restore();
        }
      }
      if (!showM && !showL) continue;
      if (px < -r - 80 * dpr || py < -r - 20 * dpr || px > overlay.width + r || py > overlay.height + r) continue;
      if (showM) { octx.beginPath(); octx.arc(px, py, r, 0, Math.PI * 2); octx.stroke(); }
      // ラベル（セッション10）：マザーの右に種族の名前
      if (showL && ws[m.kind - 1]) {
        const a = octx.globalAlpha; octx.globalAlpha = m.active ? 1 : 0.5;
        octx.fillStyle = ws[m.kind - 1].color;
        octx.lineWidth = 3 * dpr; octx.strokeStyle = 'rgba(0,0,0,0.8)';
        const tx = px + r + 4 * dpr, label = spName(ws[m.kind - 1]);
        octx.strokeText(label, tx, py); octx.fillText(label, tx, py);
        octx.lineWidth = 1.5 * dpr; octx.strokeStyle = ws[m.kind - 1].color; octx.globalAlpha = a;
      }
    }
  }
  octx.globalAlpha = 1;
}

function fitView() {
  resizeCanvas();
  const cpp = Math.max(life.W / canvas.width, life.H / canvas.height);
  view.cpp = cpp;
  view.ox = (life.W - canvas.width * cpp) / 2;
  view.oy = (life.H - canvas.height * cpp) / 2;
}

// 拡大・縮小（セッション10）：画面の真ん中を中心に k 倍。表示の倍率は「1 マスが画面の何点か」
function zoomBy(k, cx = canvas.width / 2, cy = canvas.height / 2) {
  const fx = view.ox + cx * view.cpp, fy = view.oy + cy * view.cpp;
  view.cpp = Math.min(8, Math.max(1 / 64, view.cpp / k));
  view.ox = fx - cx * view.cpp; view.oy = fy - cy * view.cpp;
}
let zoomShown = '';
function showZoom() {
  const mag = (window.devicePixelRatio || 1) / view.cpp;
  const txt = '×' + (mag >= 10 ? mag.toFixed(0) : mag >= 1 ? mag.toFixed(1) : mag.toFixed(2));
  if (txt !== zoomShown) { zoomShown = txt; $('zoom-v').textContent = txt; }
}
// 自由編集の最初の見え方：マス目が見える大きさ（1 マス 10 点）で、盤の真ん中を出す
function freeView() {
  fitView();
  const cpp = 1 / (10 * (window.devicePixelRatio || 1));
  if (cpp >= view.cpp) return;
  view.cpp = cpp;
  view.ox = (life.W - canvas.width * cpp) / 2; view.oy = (life.H - canvas.height * cpp) / 2;
}
function showSeed() { $('seed-now').textContent = life ? t('seedNow', { n: life.seed }) : ''; }

// 学習の進み（§18 の④）を状態の表に出す：回＝終えた試しの数、勝＝候補が勝った数、固定＝学習を終えた
let learnBusy = false;
let lgLearn = [];    // 種族ごとの学習の文（並びの番号は種族−1）
let lgCounts = null; // 種族ごとの盤の数（人口グラフと同じ読み取り）
function showLearn() {
  if (!life || !life.mothers || !life.mothers.ms.some(m => m.learn) || learnBusy || !$('lshow').checked) return;
  const me = life, ws = curWorld().species;
  learnBusy = true;
  me.readLearn().then(st => {
    if (me !== life || !$('lshow').checked) return;
    // 種族ごとに、その種族のマザー（4種族の世界は 3 つずつ）の回と勝ちを足す。固定は全部が固定のとき
    lgLearn = ws.map((sp, j) => {
      const ms = me.mothers.ms.filter(m => m.learn && m.kind === j + 1);
      if (!ms.length) return '';
      let n = 0, w = 0, fixed = true;
      for (const m of ms) { const o = m.slot * LS; n += st[o + LO.EPN]; w += st[o + LO.WINS]; if (!st[o + LO.FIXED]) fixed = false; }
      return t('learnFmt', { n, w }) + (fixed ? t('learnFixed') : '');
    });
    renderLegend();
  }).catch(() => {}).finally(() => { learnBusy = false; });
}

function readSize() { const [w, h] = $('size').value.split('x').map(Number); return { W: w, H: h }; }

function showLegend() {
  lgLearn = [];
  renderLegend();
  legendN = curWorld().species.length; legendR = life && life.chain ? life.chain.reps.length : 0;
  renderReps();
  showLearn();
}
// ルールの引き直しの記録（Q95=A）：新しい順。世代・種族（いまのルール）・何回目・理由・そのときの順位と数
function renderReps() {
  const box = $('rep-box');
  box.hidden = !isChain() || !life || !life.chain;
  if (box.hidden) return;
  const reps = life.chain.reps, ws = curWorld().species;
  $('rep-n').textContent = `(${reps.length})`;
  if (!reps.length) { const li = document.createElement('li'); li.textContent = t('repNone'); $('rep-list').replaceChildren(li); return; }
  $('rep-list').replaceChildren(...reps.slice(-100).reverse().map(([g, k, v, why, n, , r]) => {
    const li = document.createElement('li'), sp = ws[k - 1];
    const nm = document.createElement('span'); nm.className = 'nm';
    if (sp) { nm.style.setProperty('--c', sp.color); nm.textContent = spName(sp); }
    const w = document.createElement('span'); w.className = 'why'; w.textContent = t('why_' + why);
    li.append(t('repGen', { g: g.toLocaleString() }) + '　', nm, ' ' + t('repVer', { v }) + '　', w,
      r ? '（' + t('repRank', { r, n: (n ?? 0).toLocaleString() }) + '）' : '');
    return li;
  }));
}
// 状態の表（セッション10）：横は色の組（番号を 4 で割った余り）、縦は組の中の順番。位置は変わらない。
//   「強い順」を入れると、組の中を盤の数の多い順に並べる
function renderLegend() {
  const box = $('legend');
  if (!life || isFree()) { box.replaceChildren(); return; }
  const ws = curWorld().species, cols = 4, rows = Math.ceil(ws.length / cols);
  const sort = $('lsort').checked && lgCounts;
  const grid = [];
  for (let c = 0; c < cols; c++) {
    const col = ws.filter((sp, j) => j % cols === c);
    if (sort) col.sort((a, b) => (lgCounts[b.id - 1] ?? 0) - (lgCounts[a.id - 1] ?? 0) || a.id - b.id);
    col.forEach((sp, r) => { grid[r * cols + c] = sp; });
  }
  const cells = [];
  for (let i = 0; i < rows * cols; i++) {
    const sp = grid[i], e = document.createElement('div');
    e.className = 'lg' + (sp ? '' : ' empty');
    if (sp) {
      e.style.setProperty('--c', sp.color);
      const l1 = document.createElement('div'); l1.className = 'l1';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = spName(sp);
      l1.append(nm);
      if (isChain() && sp.label) { const rl = document.createElement('span'); rl.className = 'rl'; rl.textContent = sp.label; l1.append(rl); }
      const l2 = document.createElement('div'); l2.className = 'l2';
      const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = lgCounts ? (lgCounts[sp.id - 1] ?? 0).toLocaleString() : '';
      l2.append(ct, lgLearn[sp.id - 1] || '');
      e.append(l1, l2);
    }
    cells.push(e);
  }
  box.replaceChildren(...cells);
}
let legendN = 0, legendR = 0;

function buildChain() {
  const { W, H } = readSize();
  const wrap = $('wrap').checked, seed = Number($('seed').value) || 0;
  const chain = new ChainState(seed, W, H, { ...CHAIN_DEFAULTS, wrap, max: chainMax(W, H, CHAIN_DEFAULTS.domain) });   // 狭い盤では種族を減らす（セッション10）
  const mothers = new MotherSet([], W, H, wrap, seed, 'empty');
  life = new LifeGPU(gpu.device, { W, H, wrap, seed, density: 0, canvas, chain, mothers, palette: [BG] });
  world = chain.world;
}

// 種の「ランダム」（最初の値。セッション9）：作り直すたびに、いまの年月日時分秒から種を計算して、種の欄に出す
//   （年×12＋月）×31＋日 … ×60＋秒 を 2^32 で割った余り。出た数を控えて「ランダム」を外せば、同じ動きをもう一度見られる
function timeSeed(d = new Date()) {
  const n = (((((d.getFullYear() * 12 + d.getMonth()) * 31 + d.getDate() - 1) * 24 + d.getHours()) * 60 + d.getMinutes()) * 60 + d.getSeconds());
  return n % 4294967296;
}
function build() {
  if ($('seed-rand').checked) $('seed').value = String(timeSeed());
  if (life) life.destroy();
  life = null;
  if (isChain()) buildChain();
  else if (isBattle()) { if (!buildBattle()) return; }
  else if (isFree()) {
    const { W, H } = readSize();
    world = freeGood;
    life = new LifeGPU(gpu.device, {
      W, H, wrap: $('wrap').checked, seed: Number($('seed').value) || 0, density: 0, canvas, rules: compile(world), mothers: null,
      palette: [BG, ...world.species.map(sp => hexToRGBA(sp.color))],
    });
  } else {
    const { W, H } = readSize();
    world = TEMPLATES[mode]();
    const rules = compile(world);
    const wrap = $('wrap').checked, seed = Number($('seed').value) || 0;
    const count = Number($('mcount').value);
    const plan = count ? planMothers({ ...world, mothers: { ...(world.mothers ?? {}), count } }, W, H, seed) : [];
    const mothers = plan.length ? new MotherSet(plan, W, H, wrap, seed, $('mmode').value) : null;
    life = new LifeGPU(gpu.device, {
      W, H, wrap, seed, density: world.init.density, canvas, rules, mothers,
      palette: [BG, ...world.species.map(sp => hexToRGBA(sp.color))],
    });
  }
  lgCounts = null;
  if (isChain()) applyMotherCtl();
  showLegend();
  acc = 0;
  resetGraph();
  genReset();
  if (isFree()) freeView(); else fitView();
  showSeed();
}

// ── 自由編集モード ──
const FREE_COLORS = ['#4ade80', '#22d3ee', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#60a5fa', '#f87171',
  '#2dd4bf', '#e879f9', '#a3e635', '#fbbf24', '#818cf8', '#fca5a5', '#34d399', '#c084fc',
  '#38bdf8', '#fdba74', '#86efac', '#f9a8d4', '#93c5fd', '#fde047', '#5eead4', '#d8b4fe'];
// 種族ごとに：使うか・3 つの式（文字のまま）・色。最初は Conway の 1 種族
const newGen = () => ({ on: false, best: [], n: 0, phase: 'idle', h: [], next: 0, tile: -1, cur: null, placed: 0 });
const newSp = color => ({ on: true, birth: '3', survive: '23', eat: '', target: '', color, g: newGen() });
const free = { sp: [newSp(FREE_COLORS[0])], brush: 1, tool: 'move', fills: 0 };
const FIELDS = ['birth', 'survive', 'eat'];   // 式の欄（食べる相手の欄は別）
const FIELD_KEY = { birth: 'colBirth', survive: 'colSurvive', eat: 'colEat', target: 'colTarget' };
// 式から世界を作る。誤りは errs[種族の番号-1][欄] に入る。使わない種族は、生まれも生き残りもしない
function freeWorld() {
  const S = free.sp.length, errs = [];
  const species = free.sp.map((f, i) => {
    const id = i + 1, e = {}, r = {};
    for (const k of FIELDS) { const c = checkRule(f[k], S, id); if (c.ok) r[k] = c.groups; else { e[k] = c.msg; r[k] = []; } }
    const tg = checkTargets(f.target, S, id);
    if (!tg.ok) e.target = tg.msg;
    errs.push(e);
    return { id, name: { ja: LETTERS[i], en: LETTERS[i] }, color: f.color,
      birth: f.on ? r.birth : [], survive: f.on ? r.survive : [], prey: f.on ? r.eat : [], eatSet: f.on && tg.ok ? tg.set : 0 };
  });
  // 食べる側のルール（eatMode: 'eater'）：捕食の欄は「食べる条件」（相手のマスの周りで数える）
  return { world: { pick: 'equal', eatMode: 'eater', init: { density: 0 }, species }, errs, ok: errs.every(e => !Object.keys(e).length) };
}
let freeGood = freeWorld().world;   // いちばん新しい、正しく書けている世界（式に誤りがあるあいだは、これで動かし続ける）
// 式を書きかえたら、正しければその場でルールを入れ替える（盤はそのまま）
function freeApply() {
  const r = freeWorld();
  showFreeErrors(r.errs);
  if (!r.ok) return;
  freeGood = r.world;
  if (life && isFree()) {
    world = freeGood;
    life.setRules(compile(world));
    life.setPalette([BG, ...world.species.map(sp => hexToRGBA(sp.color))]);
  }
}
function showFreeErrors(errs) {
  [...$('sp-rows').querySelectorAll('tr.sp')].forEach((tr, i) => {
    const e = errs[i] || {};
    [...FIELDS, 'target'].forEach(k => tr.querySelector(`input[data-k=${k}]`).classList.toggle('bad', !!e[k]));
    const er = tr.nextElementSibling;
    const msgs = [...FIELDS, 'target'].filter(k => e[k]).map(k => `${t(FIELD_KEY[k])}：${e[k]}`);
    er.querySelector('.err').textContent = msgs.join(' ／ ');
    er.hidden = !msgs.length;
  });
}
let freeTimer = 0;
function renderSpTable() {
  const rows = [];
  free.sp.forEach((f, i) => {
    const tr = document.createElement('tr'); tr.className = 'sp' + (f.on ? '' : ' off');
    const pick = document.createElement('span');
    pick.className = 'sp-pick' + (free.brush === i + 1 ? ' on' : ''); pick.style.setProperty('--c', f.color); pick.textContent = LETTERS[i];
    pick.addEventListener('click', () => { free.brush = i + 1; if (free.tool === 'move') setTool('draw'); renderSpTable(); });
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = f.on;
    on.addEventListener('change', () => { f.on = on.checked; tr.classList.toggle('off', !f.on); freeApply(); });
    const cells = [pick, on];
    for (const k of [...FIELDS, 'target']) {
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = f[k]; inp.dataset.k = k; inp.spellcheck = false;
      if (k === 'target') inp.className = 'short';
      inp.addEventListener('input', () => { f[k] = inp.value; clearTimeout(freeTimer); freeTimer = setTimeout(freeApply, 300); });
      cells.push(inp);
    }
    // 発生（ランダム生成）の入り切りと、覚えた形の点
    const gb = document.createElement('span'); gb.className = 'gen-cell';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gen-btn' + (f.g.on ? ' on' : '');
    btn.textContent = t(f.g.on ? 'genOff' : 'genOn'); btn.title = t('genTip');
    btn.addEventListener('click', () => { genToggle(f); renderSpTable(); });
    const info = document.createElement('span'); info.className = 'gen-info'; info.dataset.sp = String(i);
    gb.append(btn, info); cells.push(gb);
    cells.forEach(c => { const td = document.createElement('td'); td.append(c); tr.append(td); });
    const er = document.createElement('tr'); er.hidden = true;
    const td = document.createElement('td'); td.colSpan = 7; const d = document.createElement('div'); d.className = 'err'; td.append(d); er.append(td);
    rows.push(tr, er);
  });
  $('sp-rows').replaceChildren(...rows);
  $('btn-addsp').disabled = free.sp.length >= FREE_MAX;
  showFreeErrors(freeWorld().errs);
  genInfo();
}
function setTool(tool) {
  free.tool = tool;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  canvas.classList.toggle('drawing', tool !== 'move');
}
function addSpecies() {
  if (free.sp.length >= FREE_MAX) return;
  free.sp.push(newSp(FREE_COLORS[free.sp.length % FREE_COLORS.length]));
  free.brush = free.sp.length;
  renderSpTable(); freeApply();
}
// 使う種族だけで、盤をランダムに埋める（押すたびに違う並び）
function freeRandom() {
  if (!life) return;
  const ids = free.sp.map((f, i) => (f.on ? i + 1 : 0)).filter(Boolean);
  if (!ids.length) return;
  const b = makeBoard(life.W, life.H);
  fillRandom(b, ((Number($('seed').value) || 0) + 7919 * ++free.fills) >>> 0, 0.278, ids.length);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i]) b.cells[i] = ids[b.cells[i] - 1];
  life.upload(b.cells); acc = 0; resetGraph(); genReset();
}
function freeClear() { if (!life) return; life.upload(new Uint32Array(life.W * life.H)); acc = 0; resetGraph(); genReset(); }

// ── ランダム生成（種族ごとの「発生」。life-gen.js） ──
//   置く → 世代ごとのその種族の数（GPU の輪）を読む → 落ち着いたら点を付けて次を置く
function genToggle(f) {
  f.g.on = !f.g.on;
  f.g.phase = 'idle'; f.g.h = []; f.g.cur = null;
}
// 盤を作り直した・全部消したときは、置いている途中の形を捨てる（覚えた形は残す）
function genReset() { for (const f of free.sp) { f.g.phase = 'idle'; f.g.h = []; f.g.cur = null; } }
const genActive = () => !!life && isFree() && free.sp.some(f => f.on && f.g.on);
let occT = 0;
function genTick(now) {
  const on = genActive();
  if (life) life.hist = on;
  if (!on) return;
  const me = life;
  // 置く場所を探す（待っている種族があるとき、0.2 秒に 1 回まで）
  const want = free.sp.map((f, i) => (f.on && f.g.on && f.g.phase === 'idle' ? i : -1)).filter(i => i >= 0);
  if (want.length && now - occT > 200) {
    occT = now;
    me.readOcc().then(r => {
      if (!r || me !== life) return;
      const taken = new Set(free.sp.filter(f => f.g.phase === 'run').map(f => f.g.tile));
      for (const i of want) {
        const f = free.sp[i];
        if (!f.on || !f.g.on || f.g.phase !== 'idle') continue;
        const tile = pickTile(r.occ, r.tw, r.th, me.wrap, Math.random, taken);
        if (tile < 0) break;
        taken.add(tile);
        const cur = nextPattern(f.g.best, f.g.n, Math.random);
        const x0 = (tile % r.tw) * OCC_TILE, y0 = Math.floor(tile / r.tw) * OCC_TILE, list = [];
        for (let b = 0; b < 256; b++) if ((cur.bits[b >>> 5] >>> (b & 31)) & 1) {
          const c = cellIndex(x0 + (b & 15), y0 + (b >>> 4));
          if (c >= 0) list.push([c, i + 1]);
        }
        me.setCells(list);
        Object.assign(f.g, { phase: 'run', tile, cur, placed: me.gen, next: me.gen + 1, h: [] });
      }
    });
  }
  // 世代ごとの数を読んで、落ち着いたかを見る
  if (free.sp.some(f => f.g.phase === 'run')) {
    me.readHist().then(r => {
      if (!r || me !== life) return;
      free.sp.forEach((f, i) => {
        const g = f.g;
        if (g.phase !== 'run') return;
        if (r.gen - g.next >= HIST_N) g.next = r.gen - HIST_N + 1;   // 読み逃した分は飛ばす（ふつうは起きない）
        for (; g.next <= r.gen; g.next++) {
          g.h.push(r.data[(g.next % HIST_N) * 64 + i]);
          const st = steady(g.h);
          if (st) { recordResult(g.best, g.cur, st); g.n++; g.phase = 'idle'; g.h = []; g.cur = null; break; }
        }
      });
    });
  }
}
// 世代ごとの数の輪を読み逃さないように、進める世代の数をおさえる（まだ読んでいない一番古い世代から HIST_N − 32 まで）
function genRoom() {
  if (!life || !life.hist) return Infinity;
  let low = Infinity;
  for (const f of free.sp) if (f.g.phase === 'run') low = Math.min(low, f.g.next);
  return low === Infinity ? Infinity : Math.max(0, low + HIST_N - 32 - life.gen);
}
// 種族ごとの「最長」とその点（置いてから落ち着くまでの世代）
function genInfo() {
  document.querySelectorAll('.gen-info').forEach(el => {
    const f = free.sp[Number(el.dataset.sp)];
    if (!f) return;
    const best = f.g.best.map(e => e.score.toLocaleString()).join(' / ');
    const now = f.g.phase === 'run' ? `${t('genNow')} ${f.g.h.length.toLocaleString()}` : '';
    el.textContent = [best ? `${t('genBest')} ${best}` : '', now].filter(Boolean).join(' ・ ');
  });
}
// 画面の点 → マスの位置
function cellXY(ox, oy) {
  const dpr = window.devicePixelRatio || 1;
  return [Math.floor(view.ox + ox * dpr * view.cpp), Math.floor(view.oy + oy * dpr * view.cpp)];
}
// マスの位置 → 番号（盤の外なら -1）
function cellIndex(x, y) {
  if (life.wrap) { x = ((x % life.W) + life.W) % life.W; y = ((y % life.H) + life.H) % life.H; }
  else if (x < 0 || y < 0 || x >= life.W || y >= life.H) return -1;
  return y * life.W + x;
}
// 前の点から今の点まで、すきまなく塗る
function paintLine(a, b) {
  const v = free.tool === 'erase' ? 0 : free.brush;
  if (v && !free.sp[v - 1]?.on) return;
  const list = [];
  let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 4096; n++) {
    const i = cellIndex(x0, y0); if (i >= 0) list.push([i, v]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
  life.setCells(list);
}

// ── 対戦モード（セッション11） ──
// 対戦の中身は裏方（life-battle-worker.js）が持つ。画面は 1 秒に 1 回、盤を読み戻して送り、返ってきた「置くマス」を盤に書く
const BT_PAT_KEY = 'momo-life-battle-pat';
const BT_ACT = { grow: 'btGrow', shoot: 'btShoot', bomb: 'btBomb', save: 'btSave', escort: 'btEscort' };
function loadPats() {
  try {
    const p = JSON.parse(localStorage.getItem(BT_PAT_KEY));
    if (Array.isArray(p) && p.length === BATTLE.slots && p.every(r => Array.isArray(r) && r.length === BATTLE.grid)) return p.map(r => r.map(s => String(s).padEnd(BATTLE.grid, '.').slice(0, BATTLE.grid)));
  } catch (e) {}
  return defaultPatterns().map(p => p.rows);
}
const bt = { worker: null, id: 0, ready: false, busy: false, lastTick: 0, st: [], dist: null, path: null, slot: 2, pats: loadPats(), hover: null, result: null, starts: null };
function savePats() { try { localStorage.setItem(BT_PAT_KEY, JSON.stringify(bt.pats)); } catch (e) {} }
const btRule = () => ({ birth: $('bt-b').value, survive: $('bt-sv').value, eat: $('bt-e').value, target: '?' });
const btS = () => Number($('bt-s').value);
function btWorker() {
  if (bt.worker) return bt.worker;
  bt.worker = new Worker(new URL('./life-battle-worker.js', import.meta.url), { type: 'module' });
  bt.worker.onmessage = e => btMessage(e.data);
  return bt.worker;
}
// 対戦の盤を作る（build から呼ぶ）。最初のブロックは裏方が決めて返す
function buildBattle() {
  const { W, H } = readSize();
  const w = battleWorld(btS(), btRule());
  if (!w.ok) { flash(w.msg); return false; }
  world = w.world;
  const wrap = $('wrap').checked, seed = Number($('seed').value) || 0;
  life = new LifeGPU(gpu.device, { W, H, wrap, seed, density: 0, canvas, rules: compile(world), mothers: null,
    palette: [BG, ...world.species.map(sp => hexToRGBA(sp.color))] });
  bt.id++; bt.ready = false; bt.busy = false; bt.result = null; bt.dist = null; bt.path = null; bt.st = []; bt.lastTick = 0;
  $('bt-result').hidden = true;
  btWorker().postMessage({ type: 'init', id: bt.id, W, H, wrap, S: btS(), seed, rule: btRule() });
  renderBattle();
  return true;
}
function btMessage(m) {
  if (m.id !== bt.id || !life || !isBattle()) return;
  if (m.type === 'init') {
    life.upload(m.cells); acc = 0; resetGraph();
    bt.ready = true; bt.st = m.st; bt.starts = m.starts;
    // あなた（G1）のブロックを真ん中に、1 マス 4 点で見せる
    resizeCanvas();
    //   （左上のパネルに隠れないように、パネルの右の空いたところの真ん中に出す）
    const dpr = window.devicePixelRatio || 1, [x, y] = m.starts[0], cpp = 1 / (4 * dpr);
    const hr = $('hud').getBoundingClientRect(), left = hr.right < canvas.clientWidth * 0.75 ? hr.right : 0;
    view.cpp = cpp; view.ox = x + 1 - (left + canvas.clientWidth) / 2 * dpr * cpp; view.oy = y + 1 - canvas.height * cpp / 2;
    renderBattle();
  } else if (m.type === 'tick') {
    for (const w of m.writes) life.setCells(w.list.map(i => [i, w.s]));
    bt.st = m.st; bt.dist = m.dist; bt.busy = false;
    bt.path = new Path2D();
    const sg = m.seg;
    for (let k = 0; k < sg.length; k += 4) { bt.path.moveTo(sg[k], sg[k + 1]); bt.path.lineTo(sg[k + 2], sg[k + 3]); }
    if (m.result && !bt.result) { bt.result = m.result; $('bt-result-msg').textContent = t(m.result === 'win' ? 'btWin' : 'btLose'); $('bt-result').hidden = false; }
    renderBattle();
  } else if (m.type === 'place') {
    if (m.list) life.setCells(m.list.map(i => [i, 1]));
    else flash(t('btNo_' + m.why));
    bt.st = m.st; renderBattle();
  }
}
// 1 秒に 1 回（動かしているあいだだけ。止めているとエネルギーも増えない）
function battleTick(now) {
  if (!isBattle() || !life || !bt.ready || bt.busy || bt.result || !running || now - bt.lastTick < 1000) return;
  bt.busy = true; bt.lastTick = now;
  const me = life, id = bt.id;
  me.read().then(cells => {
    if (me !== life || id !== bt.id) return;
    bt.worker.postMessage({ type: 'tick', id, cells, gen: me.gen }, [cells.buffer]);
  }).catch(() => { bt.busy = false; });
}
// いま選んでいる型を、マス (cx,cy) を真ん中にして置くときの左上と形
function btAim(cx, cy) {
  const info = patInfo(bt.pats[bt.slot]);
  return { info, x0: cx - Math.floor(info.w / 2), y0: cy - Math.floor(info.h / 2) };
}
function btPlace(cx, cy) {
  if (!bt.ready || bt.result) return;
  const { info, x0, y0 } = btAim(cx, cy);
  if (!info.n) { flash(t('btNo_empty')); return; }
  bt.worker.postMessage({ type: 'place', id: bt.id, rows: bt.pats[bt.slot], x0, y0 });
}
// 盤の上に、置ける範囲の縁（点線）と、置こうとしている型の影を描く
function drawBattle() {
  if (!isBattle() || !life) return;
  const dpr = window.devicePixelRatio || 1, c = view.cpp;
  const me = curWorld().species[0];
  const copies = life.wrap ? [-1, 0, 1] : [0];
  if (bt.path) {
    octx.save();
    octx.strokeStyle = me.color; octx.globalAlpha = 0.85;
    octx.lineWidth = 1.2 * dpr * c; octx.setLineDash([4 * dpr * c, 4 * dpr * c]);
    for (const ky of copies) for (const kx of copies) {
      octx.setTransform(1 / c, 0, 0, 1 / c, (kx * life.W - view.ox) / c, (ky * life.H - view.oy) / c);
      octx.stroke(bt.path);
    }
    octx.restore();
  }
  if (bt.hover && bt.ready && !bt.result) {
    const { info, x0, y0 } = btAim(...bt.hover);
    if (!info.n) return;
    const st = bt.st[0];
    let inside = !!bt.dist;
    for (const [dx, dy] of info.cells) { const i = cellIndex(x0 + dx, y0 + dy); if (i < 0 || !bt.dist || bt.dist[i] > BATTLE.range) { inside = false; break; } }
    const enough = st && st.energy >= info.n * st.price;
    octx.save();
    octx.fillStyle = inside && enough ? me.color : inside ? '#facc15' : '#f87171';
    octx.globalAlpha = 0.6;
    const s = Math.max(1, 1 / c);
    for (const [dx, dy] of info.cells) octx.fillRect((x0 + dx - view.ox) / c, (y0 + dy - view.oy) / c, s, s);
    octx.restore();
  }
}
const patName = k => {
  const rows = bt.pats[k], n = patInfo(rows).n;
  if (!n) return t('pt_empty');
  const def = DEFAULT_PATTERNS[k];
  return def.key !== 'empty' && def.rows.join() === rows.join() ? t('pt_' + def.key) : t('pt_custom');
};
// 型の小さな絵
function drawPat(cv, rows, color, px) {
  const g = cv.getContext('2d'), n = BATTLE.grid;
  cv.width = cv.height = n * px;
  g.fillStyle = '#111'; g.fillRect(0, 0, n * px, n * px);
  if (px >= 8) { g.strokeStyle = '#2a2a2a'; g.lineWidth = 1; g.beginPath(); for (let k = 1; k < n; k++) { g.moveTo(k * px + 0.5, 0); g.lineTo(k * px + 0.5, n * px); g.moveTo(0, k * px + 0.5); g.lineTo(n * px, k * px + 0.5); } g.stroke(); }
  g.fillStyle = color;
  rows.forEach((r, y) => { for (let x = 0; x < n; x++) if (r[x] === 'O') g.fillRect(x * px + (px >= 8 ? 1 : 0), y * px + (px >= 8 ? 1 : 0), px - (px >= 8 ? 1 : 0), px - (px >= 8 ? 1 : 0)); });
}
function renderSlots() {
  const color = curWorld()?.species?.[0]?.color ?? '#4ade80';
  const box = $('bt-slots');
  if (box.children.length !== BATTLE.slots) {
    box.replaceChildren(...bt.pats.map((_, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bt-slot';
      const cv = document.createElement('canvas'); const num = document.createElement('span'); num.className = 'bt-num'; num.textContent = String((k + 1) % 10);
      b.append(cv, num); b.addEventListener('click', () => { bt.slot = k; renderSlots(); });
      return b;
    }));
  }
  [...box.children].forEach((b, k) => { b.classList.toggle('on', k === bt.slot); drawPat(b.querySelector('canvas'), bt.pats[k], color, 3); b.title = patName(k); });
  drawPat($('bt-editor'), bt.pats[bt.slot], color, 14);
  const info = patInfo(bt.pats[bt.slot]), st = bt.st[0];
  $('bt-slot-name').textContent = `${(bt.slot + 1) % 10}. ${patName(bt.slot)}`;
  $('bt-slot-cost').textContent = t('btCost', { n: info.n, e: st ? (info.n * st.price).toLocaleString() : '—' });
}
function renderBattle() {
  if (!isBattle()) return;
  renderSlots();
  const st = bt.st[0], ws = curWorld().species;
  if (st) {
    const need = patInfo(bt.pats[bt.slot]).n * st.price;
    const wait = st.energy >= need ? 0 : st.income ? Math.ceil((need - st.energy) / st.income) : '—';
    $('bt-me').textContent = t('btMe', { e: st.energy.toLocaleString(), p: st.price.toLocaleString(), i: st.income.toLocaleString(), w: wait });
  } else $('bt-me').textContent = '';
  $('bt-rows').replaceChildren(...ws.map((sp, j) => {
    const s = bt.st[j], tr = document.createElement('tr');
    if (s && !s.alive) tr.className = 'dead';
    const nm = document.createElement('td'); nm.className = 'nm'; nm.style.setProperty('--c', sp.color);
    nm.textContent = j === 0 ? `${spName(sp)} ${t('btYou')}` : spName(sp);
    const td = v => { const e = document.createElement('td'); e.textContent = v; return e; };
    tr.append(nm, td(s ? s.cells.toLocaleString() : ''), td(s ? s.energy.toLocaleString() : ''), td(s ? s.price.toLocaleString() : ''),
      td(!s ? '' : !s.alive ? t('btDead') : j === 0 ? '' : t(BT_ACT[s.act] ?? 'btSave')));
    return tr;
  }));
}
// 型を書きかえる（10×10 の絵を押すと、そのマスを入れ替える。なぞると同じ値で塗る）
function bindEditor() {
  const cv = $('bt-editor');
  let paintV = null;
  const at = e => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * BATTLE.grid), Math.floor((e.clientY - r.top) / r.height * BATTLE.grid)]; };
  const set = (x, y, v) => {
    if (x < 0 || y < 0 || x >= BATTLE.grid || y >= BATTLE.grid) return;
    const row = bt.pats[bt.slot][y];
    if ((row[x] === 'O') === v) return;
    bt.pats[bt.slot][y] = row.slice(0, x) + (v ? 'O' : '.') + row.slice(x + 1);
    savePats(); renderBattle();
  };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const [x, y] = at(e); paintV = bt.pats[bt.slot][y]?.[x] !== 'O'; set(x, y, paintV); });
  cv.addEventListener('pointermove', e => { if (paintV !== null) set(...at(e), paintV); });
  cv.addEventListener('pointerup', () => { paintV = null; });
  $('bt-pat-reset').addEventListener('click', () => { bt.pats[bt.slot] = [...DEFAULT_PATTERNS[bt.slot].rows]; savePats(); renderBattle(); });
  $('bt-pat-clear').addEventListener('click', () => { bt.pats[bt.slot] = Array(BATTLE.grid).fill('.'.repeat(BATTLE.grid)); savePats(); renderBattle(); });
}

// ── 人口グラフ（覚えておかない。いま眺めている世界の、最近の分だけ） ──
const GRAPH_N = 300;
let graph = [], graphT = 0;
function resetGraph() { graph = []; drawGraph(); }
function sampleGraph(now) {
  if (!life || now - graphT < 250) return;   // 畳んでいても数は読む（状態の表に出す）
  graphT = now;
  const me = life;
  me.readCounts().then(r => {
    if (!r || me !== life) return;
    const S = curWorld().species.length;
    const c = Array.from(r.counts.subarray(0, S));
    lgCounts = c;
    const lastG = graph.length ? graph[graph.length - 1].gen : -1;
    if (r.gen < lastG) graph = [];
    if (r.gen === lastG) graph[graph.length - 1].c = c;
    else { graph.push({ gen: r.gen, c }); if (graph.length > GRAPH_N) graph.shift(); }
    if (!$('graph').classList.contains('folded')) drawGraph();
  });
}
function drawGraph() {
  const cv = $('graph-cv'), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#2a2a2a'; g.lineWidth = 1;
  g.beginPath(); for (let k = 1; k < 4; k++) { const y = Math.round(h * k / 4) + 0.5; g.moveTo(0, y); g.lineTo(w, y); } g.stroke();
  if (!graph.length || !life) { $('graph-max').textContent = ''; $('graph-gen').textContent = ''; $('graph-top').replaceChildren(); return; }
  const ws = curWorld().species;
  let max = 1; for (const s of graph) for (const v of s.c) if (v > max) max = v;
  const g0 = graph[0].gen, g1 = graph[graph.length - 1].gen, span = Math.max(1, g1 - g0);
  g.lineWidth = 1.5 * dpr;
  ws.forEach((sp, j) => {
    if (graph.every(s => !s.c[j])) return;
    g.strokeStyle = sp.color; g.beginPath();
    graph.forEach((s, k) => {
      const x = graph.length === 1 ? w - dpr : (s.gen - g0) / span * (w - 2 * dpr) + dpr;
      const y = h - dpr - ((s.c[j] ?? 0) / max) * (h - 2 * dpr);
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  });
  $('graph-max').textContent = max.toLocaleString();
  // 左上に、いまの数の多い順に 4 種族（名前・色・数）
  const now = graph[graph.length - 1].c;
  const top = now.map((v, j) => [v, j]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 4);
  $('graph-top').replaceChildren(...top.map(([v, j]) => {
    const e = document.createElement('div'); e.className = 'gt';
    e.style.setProperty('--c', ws[j].color); e.textContent = `${spName(ws[j])} ${v.toLocaleString()}`;
    return e;
  }));
  $('graph-gen').textContent = `${t('gen')} ${g0.toLocaleString()} – ${g1.toLocaleString()}`;
}

// ── パネルを畳む・広げる（畳んだかどうかは、この端末にだけ覚える） ──
const FOLD_KEY = 'momo-life-fold';
function loadFold() { try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch (e) { return {}; } }
function setFold(id, folded, save = true) {
  const panel = $(id), btn = $(id === 'hud' ? 'btn-fold' : 'btn-graph');
  panel.classList.toggle('folded', folded);
  document.body.classList.toggle(id === 'hud' ? 'hud-folded' : 'graph-open', id === 'hud' ? folded : !folded);
  btn.textContent = folded ? '▸' : '▾';
  btn.title = t(folded ? 'unfold' : 'fold');
  btn.setAttribute('aria-expanded', String(!folded));
  if (save) { const f = loadFold(); f[id] = folded; try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) {} }
  if (id === 'graph' && !folded) drawGraph();
}

function speed() { return SPEEDS[Number($('speed').value)]; }

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (life && mode) {
    resizeCanvas();
    if (running) {
      acc += dt * speed();
      let n = Math.floor(acc);
      if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; acc = n + (acc % 1); }
      if (n > 0) { const room = genRoom(); if (n > room) { n = room; acc = n + (acc % 1); } }
      if (n > 0) { gensDone += life.step(n); acc -= n; }
    }
    // 明滅をおさえる（セッション10・Q100=A）：速さが 5 世代/秒より上のときは、描き替えを 1 秒に 3 回までにまとめる
    //   （描かないあいだは前の絵がそのまま残る。1 マスが 1 秒に 3 回より多く変わらないので、閃光は 1 秒に 1.5 回まで）
    //   盤の写しを 1 秒に 3 回だけ取り、毎回の描画はその写しから描く（動かす・拡大はなめらかなまま）。
    //   フェードが入っていれば、前の写しから今の写しへ、次の写しまでの時間をかけて変える
    const calmNow = $('calm').checked && speed() > SAFE_SPEED;
    $('lab-calm').classList.toggle('now', calmNow);
    if (calmNow) {
      if (!life.snapReady || now - lastDraw >= CALM_MS) { life.snapshot(); lastDraw = now; }
      const fd = $('fade').checked;
      life.render({ ...view, t: fd ? (now - lastDraw) / CALM_MS : 1, fade: fd, snap: true, colors: COLORS });
    } else { life.snapReady = false; life.render({ ...view, t: running ? acc : 1, fade: $('fade').checked && speed() <= 30, colors: COLORS }); }
    drawMothers();
    drawBattle();
    battleTick(now);
    showZoom();
    sampleGraph(now);
    genTick(now);
    if (life.chain && (life.chain.n !== legendN || life.chain.reps.length !== legendR)) showLegend();
    frames++;
    if (now - statT >= 500) {
      const s = (now - statT) / 1000;
      $('st-fps').textContent = Math.round(frames / s);
      $('st-gps').textContent = Math.round(gensDone / s);
      $('st-gen').textContent = life.gen.toLocaleString();
      frames = 0; gensDone = 0; statT = now;
      showLearn();
      renderLegend();
      if (isFree()) genInfo();
    }
  }
  requestAnimationFrame(frame);
}

// ── マザーの働き（連鎖の世界。セッション10） ──
function applyMotherCtl() {
  if (!life || !life.mothers) return;
  life.setMotherFlags({ off: !$('mc-on').checked, noDomain: !$('mc-dom').checked, frozen: !$('mc-learn').checked });
  if (life.chain) life.chain.noReplace = !$('mc-rep').checked;
}

// ── ファイルの保存・読み出し（セッション10） ──
function flash(text) {
  const e = $('toast'); e.textContent = text; e.hidden = false;
  clearTimeout(flash.t); flash.t = setTimeout(() => { e.hidden = true; }, 2500);
}
function saveJSON(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(t('saved'));
}
// 盤（1 マス 1 バイト）を gzip して文字にする・戻す
async function packCells(cells) {
  const u8 = Uint8Array.from(cells, v => v);
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = ''; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function unpackCells(text, n) {
  const bin = atob(text), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const buf = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length !== n) throw new Error('size');
  return Uint32Array.from(u8);
}
const stampName = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
// 自由編集：盤の様子と種族の表
async function freeSave() {
  if (!life || !isFree()) return;
  saveJSON(await freeData(), `momo-life-free-${stampName()}.json`);
}
async function freeData() {
  const me = life, cells = await me.read();
  const species = free.sp.map(f => ({ on: f.on, birth: f.birth, survive: f.survive, eat: f.eat, target: f.target, color: f.color,
    gen: { on: f.g.on, n: f.g.n, best: f.g.best.map(e => ({ bits: Array.from(e.bits), score: e.score, short: e.short ?? [] })) } }));
  return { app: 'momo-life', type: 'free', v: 1, W: me.W, H: me.H, wrap: me.wrap, gen: me.gen, brush: free.brush, species,
    cells: await packCells(cells) };
}
async function freeLoad(d) {
  if (!Array.isArray(d.species) || !d.species.length || !(d.W > 0 && d.H > 0)) throw new Error('bad');
  const cells = await unpackCells(d.cells, d.W * d.H);
  free.sp = d.species.slice(0, FREE_MAX).map((e, i) => {
    const f = newSp(e.color || FREE_COLORS[i % FREE_COLORS.length]);
    for (const k of ['birth', 'survive', 'eat', 'target']) f[k] = String(e[k] ?? '');
    f.on = e.on !== false;
    f.g.on = !!e.gen?.on; f.g.n = e.gen?.n | 0;
    f.g.best = (e.gen?.best ?? []).map(b => ({ bits: Uint32Array.from(b.bits), score: b.score, short: b.short ?? [] }));
    return f;
  });
  free.brush = Math.min(Math.max(1, d.brush | 0), free.sp.length);
  const size = `${d.W}x${d.H}`, sel = $('size');
  if (![...sel.options].some(o => o.value === size)) { const o = document.createElement('option'); o.value = size; o.textContent = `${d.W}×${d.H}`; sel.append(o); }
  sel.value = size; $('wrap').checked = !!d.wrap;
  freeGood = freeWorld().world;
  build();
  life.upload(cells); life.gen = d.gen >>> 0;
  renderSpTable();
}
// 連鎖の世界：マザーの値
async function motherSave() {
  if (!life || !isChain()) return;
  saveJSON(await life.saveMothers(), `momo-life-mothers-${stampName()}.json`);
}
let loadKind = null;
function pickFile(kind) { loadKind = kind; $('file-in').value = ''; $('file-in').click(); }
async function onFile(file) {
  if (!file || !life) return;
  try {
    await loadData(JSON.parse(await file.text()));
  } catch (e) { flash(t('loadBad')); }
}
async function loadData(d) {
  if (d.app !== 'momo-life') throw new Error('bad');
  if (d.type !== loadKind) { flash(t('loadWrong', { m: t(d.type === 'free' ? 'modeFree' : 'modeChain') })); return; }
  if (d.type === 'free') await freeLoad(d);
  else { life.loadMothers(d, $('mc-on').checked); showLegend(); }
  flash(t('loaded'));
}

// ── 光の点滅の注意（セッション10・Q99=A・Q101） ──
//   速さ 5 世代/秒（つまみの 2）より上へ上げるときは毎回確かめる。スマホ（指で触る・画面の短い辺が 768 未満）は上げられない
const SAFE_SPEED = 5, SAFE_IDX = SPEEDS.indexOf(SAFE_SPEED);
const isPhone = (() => { try { return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768; } catch (e) { return false; } })();
const CALM_MS = 1000 / 3;   // 明滅をおさえる表示の、盤の写しを取る間隔
let lastDraw = 0, speedIdx = SAFE_IDX, wantIdx = SAFE_IDX;
const warnText = () => WARN[lang === 'cat' ? catBase() : lang] || WARN.ja;   // 猫語でも注意は読める言葉で
function showWarnTitle() {
  const w = warnText(), m = isPhone ? w.titleMobile : w.titlePC;
  $('warn-title').innerHTML = `<div class="warn-kid">${WARN_ICON}<span>${ruby(m.kid)}</span></div>`
    + `<div class="warn-adult"><b>${WARN_ICON}${w.label}</b>${m.adult}</div>`;
}
function fillWarnDlg() {
  const w = warnText(), d = isPhone ? w.dlgMobile : w.dlgPC;
  $('warn-dlg-title').innerHTML = WARN_ICON + `<span>${ruby(d.title)}</span>`;
  $('warn-dlg-kid').innerHTML = `<span>${ruby(d.kid)}</span>`;   // 1 つの塊にする（並べる箱の中で文字がばらけないように）
  $('warn-dlg-adult').innerHTML = `<b>${WARN_ICON}${w.label}</b>${d.adult}`;
  $('warn-ok').innerHTML = ruby(d.ok);
  $('warn-cancel').innerHTML = d.cancel ? ruby(d.cancel) : '';
  $('warn-cancel').hidden = !d.cancel;
}
function setSpeedIdx(i) { speedIdx = i; $('speed').value = String(i); $('speed-v').textContent = t('perSecN', { n: speed() }); }
function onSpeedInput() {
  const i = Number($('speed').value);
  if (i > SAFE_IDX && speedIdx <= SAFE_IDX) {   // 5 以下から上へ上げようとした：いったん戻して確かめる
    setSpeedIdx(speedIdx);
    wantIdx = i; fillWarnDlg();
    showDlg($('warn-dlg'));
    return;
  }
  setSpeedIdx(i);
}

// 窓（同意・説明・速さの確かめ）が開いているあいだは、右上の言語の切り替えを窓の中へ移して押せるようにする
//   （見える位置は同じ）。閉じたら body の先頭（元の場所）へ戻す
function showDlg(d) {
  if (d.open) return;
  d.append($('lang-switcher'));
  if (!d.dataset.langBack) { d.dataset.langBack = '1'; d.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.prepend($('lang-switcher')); }); }
  d.showModal();
}

// ── 起動時の同意（セッション10）：開くたびに注意を出し、同意するまでゲームを始めない ──
let consented = false;
function fillConsent() {
  const c = warnText().consent;
  $('consent-title').innerHTML = WARN_ICON + `<span>${ruby(c.title)}</span>`;
  $('consent-kid').innerHTML = `<span>${ruby(c.kid)}</span>`;
  $('consent-adult').innerHTML = `<b>${WARN_ICON}${warnText().label}</b>${c.adult}${isPhone ? ' ' + c.mobile : ''}`;
  $('consent-ok').innerHTML = ruby(c.ok);
  $('consent-no').innerHTML = ruby(c.cancel);
  $('consent-denied-msg').innerHTML = ruby(c.denied);
  $('consent-again').innerHTML = ruby(c.again);
}
function openConsent() { fillConsent(); showDlg($('consent-dlg')); }
function setConsent(ok) {
  consented = ok;
  $('consent-dlg').close();
  $('consent-denied').hidden = ok;
  document.querySelectorAll('.mode-card').forEach(b => { b.disabled = !ok || !!(gpu && !gpu.ok); });
}

// ── 説明（セッション10） ──
let helpKey = 'life';
function fillHelp(key) {
  helpKey = key;
  const base = lang === 'cat' ? catBase() : lang;
  const h = (HELP[base] || HELP.ja)[key];
  $('help-title').textContent = h.title;
  $('help-body').innerHTML = h.html;
}
function openHelp(key) { fillHelp(key); showDlg($('help-dlg')); $('help-body').scrollTop = 0; }

// ── 画面の切り替え ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('in-game', id === 'screen-game');
}
function startMode(m) {
  if (!consented) { openConsent(); return; }
  if (!gpu || !gpu.ok) return;
  mode = m;
  showScreen('screen-game');
  $('row-mother').hidden = isChain() || isFree() || isBattle();
  $('lab-mother').hidden = isFree() || isBattle();
  $('battle-box').hidden = !isBattle();
  $('bt-result').hidden = true;
  $('free-box').hidden = !isFree();
  $('legend-box').hidden = isFree() || isBattle();
  $('row-chainctl').hidden = !isChain();
  if (isFree()) { renderSpTable(); setTool(free.tool); } else canvas.classList.remove('drawing');
  $('lab-domain').hidden = !isChain();
  $('lab-learn').hidden = isFree() || isBattle();
  $('lab-label').hidden = isFree() || isBattle();
  $('fade').checked = !isFree() && !isBattle();   // 自由編集はフェードなし、ほかはありが最初（セッション10）
  if (!isChain() && !isFree() && !isBattle()) $('mcount').value = String(TEMPLATES[m]().mothers?.count ?? 0);
  $('mode-now').textContent = t(MODE_KEY[m]);
  if (!running) { running = true; $('btn-play').textContent = t('pause'); }
  build();
}
function backToTitle() {
  if (life) life.destroy();
  life = null; mode = null; bt.id++; bt.ready = false;
  $('bt-result').hidden = true;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  showScreen('screen-title');
}

// ── 操作 ──
function bindUI() {
  $('lang-select').addEventListener('change', e => onLangChange(e.target.value));
  document.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => startMode(b.dataset.mode)));
  $('btn-back').addEventListener('click', backToTitle);
  $('speed').addEventListener('input', onSpeedInput);
  // 確かめの窓：PC は「わかった」で上げる・「やめる」で 5 のまま。スマホは「わかった」で閉じるだけ（上げない）
  $('warn-ok').addEventListener('click', () => { $('warn-dlg').close(); if (!isPhone) setSpeedIdx(wantIdx); });
  $('warn-cancel').addEventListener('click', () => $('warn-dlg').close());
  $('consent-ok').addEventListener('click', () => setConsent(true));
  $('consent-no').addEventListener('click', () => setConsent(false));
  $('consent-dlg').addEventListener('cancel', e => { e.preventDefault(); setConsent(false); });   // Esc は「同意しない」
  $('consent-again').addEventListener('click', openConsent);
  $('btn-play').addEventListener('click', () => { running = !running; $('btn-play').textContent = t(running ? 'pause' : 'resume'); });
  $('btn-step').addEventListener('click', () => { if (running) $('btn-play').click(); life.step(1); acc = 1; });
  $('btn-reset').addEventListener('click', build);
  $('mcount').addEventListener('change', build);
  $('mmode').addEventListener('change', build);
  $('lshow').addEventListener('change', () => { if (life) showLegend(); });
  $('btn-fold').addEventListener('click', () => setFold('hud', !$('hud').classList.contains('folded')));
  $('btn-graph').addEventListener('click', () => setFold('graph', !$('graph').classList.contains('folded')));
  { const f = loadFold(); setFold('hud', !!f.hud, false); setFold('graph', !!f.graph, false); }
  document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  // パネルの中では、引きずって運ぶ動き（文字・部品のドラッグ）を始めない。つまみのドラッグが止まらないように（セッション9）
  for (const id of ['hud', 'graph']) $(id).addEventListener('dragstart', e => { if (!e.target.closest?.('input[type=text]')) e.preventDefault(); });
  $('seed').value = String(timeSeed());   // 最初の画面でも、ランダムの種を見せておく（世界を選ぶと、その時刻で計算し直す）
  $('seed').addEventListener('input', () => { $('seed-rand').checked = false; });   // 種を書いたら、ランダムは外す
  $('btn-random').addEventListener('click', freeRandom);
  $('btn-clear').addEventListener('click', freeClear);
  $('btn-addsp').addEventListener('click', addSpecies);
  $('bt-s').addEventListener('change', () => { if (isBattle()) build(); });
  for (const id of ['bt-b', 'bt-sv', 'bt-e']) $(id).addEventListener('change', () => { if (isBattle()) build(); });
  $('bt-again').addEventListener('click', build);
  bindEditor();
  $('zoom-in').addEventListener('click', () => zoomBy(2));
  $('zoom-out').addEventListener('click', () => zoomBy(0.5));
  $('btn-about-life').addEventListener('click', () => openHelp('life'));
  $('btn-help').addEventListener('click', () => openHelp(mode));
  $('help-close').addEventListener('click', () => $('help-dlg').close());
  $('help-dlg').addEventListener('click', e => { if (e.target === $('help-dlg')) $('help-dlg').close(); });   // 外側を押すと閉じる
  $('lsort').addEventListener('change', renderLegend);
  for (const id of ['mc-on', 'mc-learn', 'mc-dom', 'mc-rep']) $(id).addEventListener('change', applyMotherCtl);
  $('btn-msave').addEventListener('click', motherSave);
  $('btn-mload').addEventListener('click', () => pickFile('mothers'));
  $('btn-fsave').addEventListener('click', freeSave);
  $('btn-fload').addEventListener('click', () => pickFile('free'));
  $('file-in').addEventListener('change', e => onFile(e.target.files[0]));
  window.addEventListener('resize', () => { const old = canvas.width; resizeCanvas(); if (old && canvas.width) view.cpp *= old / canvas.width; });
  window.addEventListener('keydown', e => {
    if (!mode) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); }
    else if (e.key === '.') $('btn-step').click();
    else if (e.key === 'f') fitView();
    else if (isBattle() && /^[0-9]$/.test(e.key)) { bt.slot = (Number(e.key) + 9) % 10; renderBattle(); }
  });

  // ホイールで拡大縮小（指した場所を中心に）
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX * dpr, e.offsetY * dpr);
  }, { passive: false });

  // ドラッグで移動（指2本でつまむと拡大縮小）
  const pts = new Map();
  let pinch = null;
  let paint = null;   // 置く・消すのあいだ：{ id, last:[x,y] }
  let click = null;   // 対戦：押して動かさずに離したら、型を置く
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    if (isFree() && free.tool !== 'move' && !pts.size && e.button === 0 && life) {
      const c = cellXY(e.offsetX, e.offsetY); paint = { id: e.pointerId, last: c }; paintLine(c, c); return;
    }
    if (paint) return;
    click = isBattle() && !pts.size && e.button === 0 ? { id: e.pointerId, x: e.offsetX, y: e.offsetY } : null;
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', e => {
    if (paint && paint.id === e.pointerId) { const c = cellXY(e.offsetX, e.offsetY); paintLine(paint.last, c); paint.last = c; return; }
    if (isBattle()) bt.hover = cellXY(e.offsetX, e.offsetY);
    if (click && (click.id !== e.pointerId || Math.hypot(e.offsetX - click.x, e.offsetY - click.y) > 5)) click = null;
    if (!pts.has(e.pointerId)) return;
    const dpr = window.devicePixelRatio || 1;
    const p = pts.get(e.pointerId);
    if (pts.size === 1) {
      view.ox -= (e.offsetX - p.x) * dpr * view.cpp;
      view.oy -= (e.offsetY - p.y) * dpr * view.cpp;
    }
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2 * dpr, my = (a.y + b.y) / 2 * dpr;
      if (pinch) {
        const fx = view.ox + mx * view.cpp, fy = view.oy + my * view.cpp;
        view.cpp = Math.min(8, Math.max(1 / 64, view.cpp * pinch / d));
        view.ox = fx - mx * view.cpp; view.oy = fy - my * view.cpp;
      }
      pinch = d;
    }
  });
  const up = e => {
    if (paint && paint.id === e.pointerId) { paint = null; return; }
    if (click && click.id === e.pointerId && e.type === 'pointerup' && pts.size === 1) btPlace(...cellXY(e.offsetX, e.offsetY));
    click = null;
    pts.delete(e.pointerId); pinch = null; if (!pts.size) canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { bt.hover = null; });
  canvas.addEventListener('dblclick', () => { if (!isFree() || free.tool === 'move') fitView(); });
}

async function main() {
  $('version-tag').textContent = VERSION; $('hud-version').textContent = VERSION;
  bindUI();
  applyLang();
  window.__life = { get life() { return life; }, view, fitView, startMode, freeData, loadData, setLoadKind: k => { loadKind = k; } };
  requestAnimationFrame(t0 => { last = t0; statT = t0; frame(t0); });
  openConsent();
  gpu = await getGPU();
  if (!gpu.ok) {
    const key = { 'no-navigator-gpu': 'noGpu', 'not-secure': 'notSecure', 'no-adapter': 'noAdapter' }[gpu.why] ?? 'noAdapter';
    titleMsg(t(key));
    document.querySelectorAll('.mode-card').forEach(b => { b.disabled = true; });
    return;
  }
  gpu.device.lost.then(l => showMsg(t('lost', { m: l.message || l.reason })));
}
main();
