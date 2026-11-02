// 起動と配線のみ
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { isSolved } from './core/cubeState';
import type { Move } from './core/types';
import { formatMove } from './core/notation';
import { DEFAULT_ANIMATION, type AnimationSettings } from './engine/animator';
import { AutoSolver } from './engine/autoSolver';
import { GameSession } from './engine/gameSession';
import { cellOf, keyLabelFor } from './input/arrowActions';
import { ArrowControls } from './input/arrowControls';
import { KeyboardInput } from './input/keyboard';
import { learnKeyLabel, loadKeymap, loadLayoutLabels, saveKeymap, type Keymap } from './input/keymap';
import { Picker } from './input/picker';
import { PointerRouter } from './input/pointerRouter';
import { describeMove, faceMove } from './input/screenMoves';
import { ViewController, type ViewSettings } from './input/viewController';
import { ArrowView } from './render/arrowView';
import { CubeView } from './render/cubeView';
import { Lights } from './render/lights';
import { AdaptiveQuality } from './render/adaptiveQuality';
import { CUBE_RADIUS, MirrorRoom, framingSpheres } from './render/mirrorRoom';
import { SliceHighlight } from './render/sliceHighlight';
import { Announcer } from './ui/announcer';
import { ArrowLabels } from './ui/arrowLabels';
import { ConfirmDialog } from './ui/confirmDialog';
import { KeymapDialog } from './ui/keymapDialog';
import { ControlPanel } from './ui/panel';
import { motionOf } from './ui/panelModel';
import { browserStorage, formatTime, RecordStore, type AddResult } from './ui/records';
import { ResultCard } from './ui/resultCard';
import { Toast } from './ui/toast';
import { effectiveQuarterMs, loadSettings, saveSettings, type Settings } from './ui/settings';
import { SettingsDialog } from './ui/settingsDialog';
import { baseLang, S, setLang, SUBTITLE } from './ui/strings';
import { changeLangMode, initLang, type LangMode } from './i18n/langMode';
import { APP_VERSION } from './version';

const stage = document.getElementById('stage')!;
const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const info = document.getElementById('info')!;
const timer = document.getElementById('timer')!;
const timerLabel = timer.querySelector<HTMLElement>('.timer-label')!;
const timerValue = timer.querySelector<HTMLElement>('.timer-value')!;
const panelRoot = document.getElementById('panel')!;
// 言語（MOMO 共通の lib/momo-lang）。画面の部品を作る前に決める
let langState = initLang();
setLang(langState.lang, langState.catBase);
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
const subtitle = document.getElementById('subtitle')!;
document.title = S.title;
document.getElementById('version-tag')!.textContent = APP_VERSION;

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000);
stage.appendChild(renderer.domElement);

const scene = new Scene();
const lights = new Lights(scene);
// 矢印は鏡に映さない（2026-11-02 作者）
const mirrors = new MirrorRoom(scene, () => arrowView.objects);
const highlight = new SliceHighlight(scene);
const arrowView = new ArrowView(scene);

const camera = new PerspectiveCamera(38, 1, 0.1, 200);
// 設定（05 §5）。画面を開いたときに読み、変えたらその場で効かせて保存する
let settings: Settings = loadSettings(browserStorage());
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const quality = new AdaptiveQuality(window.devicePixelRatio || 1, coarse);
const viewSettings: ViewSettings = { viewGrid: 0 };
const animation: AnimationSettings = { ...DEFAULT_ANIMATION };
// キューブと、鏡 3 枚に映る像がすべて画面に収まるようにする
const view = new ViewController(camera, viewSettings, framingSpheres());

const session = new GameSession(3, { animation });
const cubeView = new CubeView(scene, session.state);

let needsRender = true;
const invalidate = (): void => {
  needsRender = true;
};

let keymap: Keymap = loadKeymap();
void loadLayoutLabels().then(() => panel.rebuild());

const enqueueMove = (move: Move): boolean => session.enqueue({ kind: 'move', move, origin: 'user' });

// ゲーム：記録・結果・途中でやめるときの確認（設計 05 §3・§4）
const records = new RecordStore(browserStorage());
const confirmDialog = new ConfirmDialog(document.body);
/** 計っている途中で、手が 1 つ以上ある（やめると記録が消える） */
const inProgress = (): boolean => session.phase === 'playing' && session.moveCount > 0;
/** ゲームを終わらせる操作。途中なら確かめてから */
async function endGame(message: string, okLabel: string, action: () => void): Promise<boolean> {
  if (inProgress() && !(await confirmDialog.ask(message, okLabel))) return false;
  action();
  return true;
}
const scramble = (): void => void endGame(S.confirmScramble, S.scramble, () => session.scramble());
const resultCard = new ResultCard(stage, { again: scramble });
/** そろった結果。回っている最中の手が止まってから見せる */
let pendingResult: AddResult | null = null;
/** 計っていないときにそろった：「そろった！」を浮かべる（回っている手が止まってから） */
const toast = new Toast(stage);
let pendingToast = false;
/** キューブの下の操作の案内（指で触る端末とマウスで言い方を変える） */
const gestureHint = document.createElement('div');
gestureHint.className = 'gesture-hint';
gestureHint.setAttribute('aria-hidden', 'true');
stage.append(gestureHint);
const touchQuery = window.matchMedia('(hover: none) and (pointer: coarse)');

// ヒントと解答（設計 06 §3・§5）。どちらもシャッフルと自分の手を逆にたどる道筋を使う
const autoSolver = new AutoSolver(session);
autoSolver.onChange = () => updateInfo();
/** ヒントで光らせておく長さ（ms） */
const HINT_MS = 4000;
/** HUD に出しているヒント（次の手が確定したら消す） */
let hintText = '';
function showHint(): void {
  const st = session.state;
  if (isSolved(st)) return;
  const m = session.solution()[0];
  if (!m) return;
  session.noteHint();
  highlight.show(m, HINT_MS);
  const d = describeMove(st.n, view.frame, m);
  let text = formatMove(m);
  if (d) {
    const layer = d.from === 1 && d.to === 1 ? S.layerFace
      : d.from === d.to ? S.layerNth(d.from)
        : d.from === 1 ? S.layerUpTo(d.to) : `${S.layerNth(d.from)}〜${d.to}`;
    const motion = motionOf(d.face, d.variant);
    text = S.faceAria(S.face[d.face], layer, motion ? S.dir[motion] : S.dir.half);
  }
  hintText = S.hintMove(text, keyLabelFor({ kind: 'move', move: m }, keymap, view.frame, st.n));
  announcer.say(hintText);
  updateInfo();
  invalidate();
}
function toggleSolve(): void {
  if (autoSolver.running) {
    autoSolver.stop();
    return;
  }
  hintText = '';
  highlight.hide();
  autoSolver.start();
}

// 面を選んで、まわりの矢印で回す（設計 10）
const arrows = new ArrowControls({
  view: arrowView,
  getSize: () => session.state.n,
  getFrame: () => view.frame,
  getKeymap: () => keymap,
  move: enqueueMove,
  command: (command) => view.command(command),
  highlight: (move) => {
    if (move) highlight.show(move);
    else highlight.hide();
  },
  change: () => {
    invalidate();
    updateInfo();
  },
});
const arrowLabels = new ArrowLabels(stage, arrows);

const picker = new Picker(renderer.domElement, camera, () => session.state);
const announcer = new Announcer(document.body);
new PointerRouter(renderer.domElement, view, picker, {
  move: enqueueMove,
  view: (command) => view.command(command),
  change: invalidate,
}, {
  pick: (x, y) => arrows.pick(picker.rays(x, y)),
  press: (id) => arrows.press(id),
  select: (hit) => {
    const st = session.state;
    arrows.select(hit.face, cellOf(hit.face, st.cubies[hit.cubie].pos, st.n));
  },
  clear: () => arrows.clear(),
  hover: (id) => arrows.hover(id),
});

const panel = new ControlPanel(panelRoot, {
  getSize: () => session.state.n,
  getFrame: () => view.frame,
  getKeymap: () => keymap,
  move: enqueueMove,
  view: (command) => view.command(command),
  home: () => view.command({ kind: 'home' }),
  scramble,
  reset: () => void endGame(S.confirmReset, S.reset, () => session.reset()),
  undo: () => session.enqueue({ kind: 'undo' }),
  redo: () => session.enqueue({ kind: 'redo' }),
  openKeymap: () => keymapDialog.open(),
  openSettings: () => settingsDialog.open(),
  hint: showHint,
  solve: toggleSolve,
  highlight: (move) => {
    if (move) highlight.show(move);
    else highlight.hide();
    invalidate();
  },
  layerChanged: () => updateInfo(),
});

const keymapDialog = new KeymapDialog(document.body, {
  getKeymap: () => keymap,
  setKeymap: (k) => {
    keymap = k;
    saveKeymap(k);
    panel.rebuild();
    invalidate();
  },
});

// 論理が確定したら基準行列を作り直す。途中の角度は毎フレーム applyAnimation が付ける
let lastMove = '';
session.on('move:committed', ({ move }) => {
  cubeView.rebuildBaseMatrices();
  // そろったあとも回し続けたら、結果の札と「そろった！」は下げる（そろった手なら、このあと solved が出し直す）
  resultCard.hide();
  toast.hide();
  pendingToast = false;
  hintText = '';
  lastMove = formatMove(move);
  updateInfo();
  invalidate();
});
const rebuildAll = (): void => {
  cubeView.rebuild(session.state);
  arrows.clear();
  highlight.hide();
  resultCard.hide();
  pendingResult = null;
  toast.hide();
  pendingToast = false;
  hintText = '';
  lastMove = '';
  panel.rebuild();
  updateInfo();
  invalidate();
};
session.on('size:changed', rebuildAll);
session.on('reset', rebuildAll);
session.on('scrambled', rebuildAll);
session.on('solved', (e) => {
  if (e.timed) {
    pendingResult = records.add({
      n: e.n, timeMs: e.timeMs, moves: e.moves, scrambleLength: e.scrambleLength, completedAt: Date.now(),
      usedHint: e.usedHint, usedSolver: e.usedSolver,
    });
  } else {
    pendingToast = true;
    announcer.say(S.solved);
  }
  updateInfo();
});
session.on('queue:full', () => panel.shake());

for (let n = 1; n <= 10; n++) {
  sizeSelect.add(new Option(S.sizeOption(n), String(n), n === 3, n === 3));
}
sizeSelect.addEventListener('change', () => {
  const n = Number(sizeSelect.value);
  sizeSelect.blur();
  void endGame(S.confirmSize(n), S.confirmSizeOk, () => session.setSize(n)).then((done) => {
    if (!done) sizeSelect.value = String(session.state.n);
  });
});
const settingsDialog = new SettingsDialog(document.body, {
  get: () => settings,
  set: (s) => {
    settings = s;
    saveSettings(browserStorage(), s);
    applySettings();
  },
  reducedMotion: () => reducedMotionQuery.matches,
});

function applySettings(): void {
  const reduced = reducedMotionQuery.matches;
  const quarterMs = effectiveQuarterMs(settings, reduced);
  animation.baseQuarterMs = quarterMs;
  viewSettings.quarterMs = quarterMs;
  // 慣性は既定でオフ。オンにしたのは本人の選択なので、「動きを減らす」でも切らない
  viewSettings.viewInertia = settings.viewInertia;
  const gridChanged = viewSettings.viewGrid !== settings.viewGrid;
  viewSettings.viewGrid = settings.viewGrid;
  if (gridChanged) view.command({ kind: 'snap' });
  arrows.labelMode = settings.arrowLabels;
  if (mirrors.visible !== settings.mirrors) {
    mirrors.visible = settings.mirrors;
  }
  quality.setQuality(settings.quality);
  resize();
  updateInfo();
}
reducedMotionQuery.addEventListener('change', applySettings);

const keyboard = new KeyboardInput({
  getSize: () => session.state.n,
  getFrame: () => view.frame,
  getKeymap: () => keymap,
});
window.addEventListener('keydown', (e) => {
  if (keymapDialog.isOpen || confirmDialog.isOpen || settingsDialog.isOpen) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.code === 'Escape' && resultCard.isOpen) {
    resultCard.hide();
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape' && arrows.selected) {
    arrows.clear();
    e.preventDefault();
    return;
  }
  learnKeyLabel(e.code, e.key);
  const r = keyboard.handle(e);
  switch (r.kind) {
    case 'ignored':
      return;
    case 'move':
      enqueueMove(r.move);
      break;
    case 'view':
      view.command(r.command);
      break;
    case 'command':
      if (r.command === 'home') view.command({ kind: 'home' });
      else session.enqueue({ kind: r.command });
      break;
    case 'prefix': {
      // 先に押した数字・まとめての層を、画面の右の面から数えて示す
      const { depth, wide } = keyboard.prefix;
      const to = wide && depth === 1 ? 2 : depth;
      const m = faceMove(session.state.n, view.frame, 'R', 'cw', wide ? 1 : depth, to);
      if (m) highlight.show(m);
      invalidate();
      break;
    }
  }
  // Alt はメニューのアクセスキーを起こすことがあるので、受けたキーは必ず止める（04 §5.3）
  e.preventDefault();
  updateInfo();
});

function updateInfo(): void {
  const p = keyboard.prefix;
  const choice = panel.layerChoice;
  const n = session.state.n;
  const items: { text: string; className?: string }[] = [{ text: `${S.moves} ${session.moveCount}` }];
  if (lastMove) items.push({ text: `${S.lastMove} ${lastMove}` });
  // 層：キーの先行打鍵があればそれ、なければパネルで選んでいる層（既定の 1 枚目は淡く）
  const layer = p.depth !== 1 || p.wide ? p : n >= 4 ? choice : null;
  if (layer) {
    items.push({
      text: `${S.layer} ${layer.depth}${layer.wide ? `・${S.layerWide}` : ''}`,
      className: layer.depth === 1 && !layer.wide ? 'dim' : undefined,
    });
  }
  if (hintText) items.push({ text: hintText, className: 'hint-move' });
  if (session.phase === 'scrambled') items.push({ text: S.timerWaiting, className: 'dim' });
  const best = records.bestTime(n);
  if (best) items.push({ text: `${S.best} ${formatTime(best.timeMs)}`, className: 'dim' });
  if (quality.verySlow && settings.mirrors) items.push({ text: S.slowHint, className: 'slow' });
  items.push({ text: arrows.selected ? S.arrowHintSelected : S.arrowHint, className: 'dim hint' });
  info.replaceChildren(...items.map(({ text, className }) => {
    const el = document.createElement('span');
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }));
  panel.update({
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    canScramble: n > 1,
    canReset: session.moveCount > 0 || session.canRedo || !isSolved(session.state),
    canHint: !isSolved(session.state),
    solving: autoSolver.running,
  });
}

/** 言語に合わせて、画面の文言を入れ直す（i18n-spec：applyLang） */
function applyLang(): void {
  const base = baseLang();
  document.documentElement.lang = base === 'zh' ? 'zh-Hans' : base;
  langSelect.value = langState.mode;
  langSelect.setAttribute('aria-label', S.lang);
  // サブタイトルは猫語でも鳴き声にしない（猫語を選ぶ前の言語のまま。app-card-design §4.2）
  subtitle.textContent = SUBTITLE[base];
  subtitle.classList.toggle('zh', base === 'zh');
  document.getElementById('size-label')!.textContent = S.size;
  gestureHint.textContent = touchQuery.matches ? S.gestureHintTouch : S.gestureHintMouse;
  for (const [id, text] of [
    ['foot-about', S.footAbout], ['foot-desc', S.footDesc],
    ['foot-top', S.footTop], ['foot-games', S.footGames], ['foot-tools', S.footTools],
  ] as const) {
    document.getElementById(id)!.textContent = text;
  }
  panel.relabel();
  keymapDialog.relabel();
  settingsDialog.relabel();
  confirmDialog.relabel();
  resultCard.relabel();
  hintText = '';
  timerText = '';
  updateInfo();
  updateTimer();
  invalidate();
}
langSelect.addEventListener('change', () => {
  langState = changeLangMode(langSelect.value as LangMode, langState);
  setLang(langState.lang, langState.catBase);
  applyLang();
  langSelect.blur();
});

/** 時間の表示。文字が変わったときだけ書き換える（100ms 刻み。05 §2） */
let timerText = '';
let timerClass = '';
function updateTimer(): void {
  const phase = session.phase;
  const ms = session.elapsedMs;
  const text = formatTime(ms);
  const cls = phase === 'playing' ? 'running' : phase === 'solved' && ms > 0 ? 'done' : 'idle';
  if (text !== timerText) {
    // 文字が空のとき（言語を切り替えた直後）は見出しも入れ直す
    if (!timerText) timerLabel.textContent = S.time;
    timerValue.textContent = timerText = text;
  }
  if (cls !== timerClass) timer.className = timerClass = cls;
}
applyLang();
// 先行打鍵（数字・w）の失効を表示に反映する
setInterval(updateInfo, 250);

/** 写したい範囲の決め方（鏡の有無・狭い画面か）。変わったときだけ視点に渡す */
let framingKey = '';
/** これより幅の狭い画面を携帯とみなす（px。CSS の狭い画面と同じ） */
const NARROW_STAGE = 640;

function resize(): void {
  renderer.setPixelRatio(quality.pixelRatio);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  // 鏡を消したら、キューブだけを画面いっぱいに写す。狭い画面（携帯）では鏡の像の奥側は欠けてよい
  const compact = w < NARROW_STAGE;
  const key = `${mirrors.visible}:${compact}`;
  if (key !== framingKey) {
    framingKey = key;
    view.setFraming(mirrors.visible ? framingSpheres(compact) : [{ center: new Vector3(), radius: CUBE_RADIUS }]);
  }
  view.setViewport(w, h);
  const pr = renderer.getPixelRatio();
  mirrors.setResolution(Math.round(w * pr), Math.round(h * pr));
  invalidate();
}
new ResizeObserver(resize).observe(stage);
applySettings();

let last = performance.now();
/** 前のフレームも描いたか（続けて描いたフレームの間隔だけを、重さとして数える） */
let renderedLast = false;
function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;
  if (view.update(dt)) needsRender = true;
  if (highlight.update(dt)) needsRender = true;
  if (arrows.update(dt)) needsRender = true;
  autoSolver.update();
  session.tick(dt);
  updateTimer();
  if (pendingResult && !session.getAnimation()) {
    resultCard.show(pendingResult);
    pendingResult = null;
  }
  if (pendingToast && !session.getAnimation()) {
    toast.show(S.solved);
    pendingToast = false;
  }
  const anim = session.getAnimation();
  if (cubeView.applyAnimation(anim)) needsRender = true;
  if (needsRender) {
    // 照明と鏡は画面に固定（キューブを手元で回す外部仕様）。中ではカメラが回るので、その逆に回す
    const delta = view.delta;
    lights.follow(delta);
    mirrors.follow(delta);
    renderer.render(scene, camera);
    arrowLabels.update(camera, stage.clientWidth, stage.clientHeight);
    needsRender = false;
    if (renderedLast && quality.sample(dt)) resize();
    renderedLast = true;
  } else {
    renderedLast = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 開発時の確かめ用（計測・自動確認）。本番ビルドには入らない
if (import.meta.env.DEV) {
  Object.assign(window, { __cube: { renderer, scene, camera, view, cubeView, session, mirrors, lights, highlight, panel, keyboard, arrows, picker, records, resultCard, confirmDialog, autoSolver, quality, settingsDialog, getSettings: () => settings } });
}
