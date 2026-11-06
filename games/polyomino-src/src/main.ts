// 起動と画面の切り替え（レベル選択 ⇄ 遊ぶ画面）と、1 回の遊び（解提示 → 遊ぶ → 完成）の流れ。
// 遊ぶ画面のレベルはアドレスの # に入れる（例 #4-legacy）。再読み込みや戻るボタンで同じ画面に戻れる

import { Game, refKey } from './core/game';
import { levelById, type LevelDef } from './core/levels';
import { formatTime, loadSave, recordBest, Stopwatch, writeSave, type KV } from './core/progress';
import { changeLangMode, initLang, type LangMode } from './i18n/langMode';
import { BoardControl } from './ui/boardControl';
import { BoardView } from './ui/boardView';
import { HintRunner } from './ui/hintUi';
import { renderLevelSelect } from './ui/levelSelect';
import { PieceList } from './ui/pieceList';
import { baseLang, S, setLang, SUBTITLE } from './ui/strings';
import { APP_VERSION } from './version';

// 言語（MOMO 共通の lib/momo-lang）。画面の部品を作る前に決める
let langState = initLang();
setLang(langState.lang, langState.catBase);
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
const subtitle = document.getElementById('subtitle')!;
const screen = document.getElementById('screen')!;
document.getElementById('version-tag')!.textContent = APP_VERSION;

// 保存（§10）。使えない設定（プライベートモードなど）でも遊べるようにする
let kv: KV | null = null;
try { kv = window.localStorage; } catch { kv = null; }
const saved = loadSave(kv);
const persist = () => writeSave(kv, saved);

/** 1 回の遊び。言語を切り替えて画面を作り直しても、これは残す */
interface Play {
  game: Game;
  watch: Stopwatch;
  /** reveal＝開始時に完成形を見せている（§6.1）／play＝遊んでいる／done＝完成した */
  phase: 'reveal' | 'play' | 'done';
  result: { time: number; best: number; isNew: boolean } | null;
}
let play: Play | null = null;
let parts: { view: BoardView; control: BoardControl; list: PieceList; hint: HintRunner; timer: number } | null = null;

function disposeGame(): void {
  if (!parts) return;
  parts.control.dispose();
  parts.view.dispose();
  parts.list.dispose();
  clearInterval(parts.timer);
  parts.hint.dispose();
  parts = null;
}

/** 遊びかけの面を保存する（確定した駒と、遊んだ時間） */
function saveProgress(): void {
  if (!play || play.phase === 'done') return;
  const g = play.game;
  if (play.phase === 'reveal' && g.placements.size === 0) return; // 何もしていなければ保存しない
  saved.games[g.level.id] = { placements: [...g.placements.values()], elapsed: Math.round(play.watch.value(performance.now())) };
  persist();
}

function newPlay(level: LevelDef): Play {
  const game = new Game(level);
  const s = saved.games[level.id];
  if (s) {
    // 遊びかけの面は、解提示を飛ばして続きから（§10）
    game.restore(s.placements);
    return { game, watch: new Stopwatch(s.elapsed), phase: 'play', result: null };
  }
  return { game, watch: new Stopwatch(0), phase: 'reveal', result: null };
}

const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function showLevelSelect(): void {
  saveProgress();
  play?.watch.stop(performance.now());
  disposeGame();
  play = null;
  document.body.classList.remove('in-game');
  renderLevelSelect(screen, (lv) => { location.hash = lv.id; }, saved.best);
  // iPhone・iPad では、保存が 7 日で消えることがあると知らせる（§10）
  if (isIOS() && !saved.iosNoticeClosed) {
    const note = document.createElement('div');
    note.className = 'ios-notice';
    const p = document.createElement('p');
    p.textContent = S.iosNotice;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = S.close;
    close.addEventListener('click', () => { saved.iosNoticeClosed = true; persist(); note.remove(); });
    note.append(p, close);
    document.getElementById('levels')?.prepend(note);
  }
}

function showGame(level: LevelDef): void {
  disposeGame();
  if (!play || play.game.level.id !== level.id) play = newPlay(level);
  const pl = play;
  const g = pl.game;
  document.body.classList.add('in-game');
  screen.replaceChildren();

  const sec = document.createElement('section');
  sec.id = 'game';

  const bar = document.createElement('div');
  bar.id = 'game-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.id = 'back';
  back.textContent = '← ' + S.back;
  back.title = S.backTitle;
  back.addEventListener('click', () => { location.hash = ''; });
  const title = document.createElement('span');
  title.id = 'game-title';
  title.textContent = S.levelLabel(level.n);
  if (level.variant) {
    const v = document.createElement('span');
    v.className = 'variant';
    v.textContent = S.variant[level.variant];
    title.append(v);
  }
  const clock = document.createElement('span');
  clock.id = 'clock';
  clock.title = S.timeLabel;
  clock.setAttribute('aria-label', S.timeLabel);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.id = 'reset';
  reset.textContent = S.reset;
  // ヒント（解を持っているレベルだけ。§8.1）
  const hintBtn = document.createElement('button');
  hintBtn.type = 'button';
  hintBtn.id = 'hint';
  hintBtn.textContent = S.hint;
  hintBtn.title = S.hintTitle;
  hintBtn.hidden = !level.solution.length;
  bar.append(back, title, clock, hintBtn, reset);

  const main = document.createElement('div');
  main.id = 'game-main';
  const wrap = document.createElement('div');
  wrap.id = 'board-wrap';
  const canvas = document.createElement('canvas');
  canvas.id = 'board';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', S.boardLabel);
  const revealHint = document.createElement('div');
  revealHint.className = 'place-hint reveal-hint';
  revealHint.textContent = S.revealHint;
  revealHint.hidden = true;
  wrap.append(canvas, revealHint);
  const aside = document.createElement('aside');
  aside.id = 'piece-list';
  aside.setAttribute('aria-label', S.pieces);
  main.append(wrap, aside);

  sec.append(bar, main);
  screen.append(sec);

  const view = new BoardView(canvas, g);
  let list: PieceList | null = null;
  const refreshBar = () => {
    clock.textContent = formatTime(pl.watch.value(performance.now()));
    reset.disabled = pl.phase !== 'play' || (g.placements.size === 0 && !g.sel);
    hintBtn.disabled = pl.phase !== 'play';
  };
  let hint: HintRunner | null = null;
  const control = new BoardControl(wrap, canvas, view, g, () => {
    list?.update();
    refreshBar();
    hint?.boardChanged();
    if (pl.phase === 'play' && g.isComplete()) complete();
    else if (!g.sel) saveProgress(); // 確定・取り消しのたびに保存（仮置きは保存しない）
  });
  list = new PieceList(
    aside,
    g,
    (ref, mouse) => {
      control.pick(ref, mouse);
      list!.reveal(refKey(ref));
    },
    (key) => view.showPiece(key),
  );

  control.onListWheel = (dy) => list!.scrollBy(dy);
  control.setDropZone(aside);
  hint = new HintRunner(wrap, g, (p) => control.placeHint(p), (busy) => hintBtn.classList.toggle('busy', busy));
  hintBtn.addEventListener('click', () => { if (pl.phase === 'play') hint!.request(); });

  const startClock = () => {
    if (pl.phase === 'play' && document.visibilityState === 'visible') pl.watch.start(performance.now());
    refreshBar();
  };

  /** 完成（§6.2）：時計を止め、ベストを記録し、遊びかけの保存を消して、演出を出す */
  const complete = () => {
    const now = performance.now();
    pl.watch.stop(now);
    const time = Math.round(pl.watch.value(now));
    const isNew = recordBest(saved, level.id, time);
    delete saved.games[level.id];
    persist();
    hint?.stop();
    pl.phase = 'done';
    pl.result = { time, best: saved.best[level.id], isNew };
    control.locked = true;
    refreshBar();
    view.celebrate();
    setTimeout(() => { if (parts?.view === view) showComplete(true); }, 900);
  };

  const showComplete = (animate: boolean) => {
    const r = pl.result!;
    const box = document.createElement('div');
    box.className = 'complete' + (animate ? ' animate' : '');
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) box.append(confetti());
    const card = document.createElement('div');
    card.className = 'complete-card';
    const h = document.createElement('h2');
    h.textContent = S.congrats;
    const t = document.createElement('p');
    t.className = 'time';
    t.textContent = S.completeTime(formatTime(r.time));
    const b = document.createElement('p');
    b.className = 'best';
    b.textContent = r.isNew ? S.newRecord : S.bestTime(formatTime(r.best));
    if (r.isNew) b.classList.add('new');
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'primary';
    again.textContent = S.playAgain;
    again.addEventListener('click', () => {
      play = { game: g, watch: new Stopwatch(0), phase: 'reveal', result: null };
      g.reset();
      showGame(level);
    });
    const toLevels = document.createElement('button');
    toLevels.type = 'button';
    toLevels.textContent = S.back;
    toLevels.addEventListener('click', () => { location.hash = ''; });
    const btns = document.createElement('div');
    btns.className = 'complete-buttons';
    btns.append(again, toLevels);
    card.append(h, t, b, btns);
    box.append(card);
    wrap.append(box);
    if (animate) again.focus({ preventScroll: true });
  };

  reset.addEventListener('click', () => {
    if (!window.confirm(S.resetConfirm)) return;
    hint!.stop();
    g.reset();
    pl.watch = new Stopwatch(0);
    startClock();
    view.fit();
    list!.update();
    saveProgress();
    refreshBar();
  });

  const timer = window.setInterval(refreshBar, 500);
  parts = { view, control, list, hint: hint!, timer };

  if (pl.phase === 'reveal') {
    // 開始時に完成形を見せてから、駒をリストへ飛ばす（§6.1）。触れれば飛ばせる
    control.locked = true;
    aside.classList.add('revealing');
    revealHint.hidden = false;
    control.onLockedTap = () => view.skipReveal();
    view.startReveal(() => {
      pl.phase = 'play';
      control.locked = false;
      control.onLockedTap = null;
      aside.classList.remove('revealing');
      revealHint.hidden = true;
      startClock();
    });
  } else if (pl.phase === 'done') {
    control.locked = true;
    showComplete(false);
  } else {
    startClock();
  }
  refreshBar();
  view.invalidate();
}

/** 紙吹雪（オレンジと白の小さな四角。CSS で落とす） */
function confetti(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['var(--orange-light)', 'var(--orange-mid)', '#ffffff', 'var(--orange)'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random() * 0.6}s`;
    s.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    s.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    s.style.setProperty('--spin', `${(Math.random() - 0.5) * 900}deg`);
    box.append(s);
  }
  return box;
}

function route(): void {
  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  const level = id ? levelById(id) : undefined;
  if (level) showGame(level);
  else showLevelSelect();
}

/** 言語に合わせて、画面の文言を入れ直す（i18n-spec：applyLang） */
function applyLang(): void {
  const base = baseLang();
  document.documentElement.lang = base === 'zh' ? 'zh-Hans' : base;
  langSelect.value = langState.mode;
  langSelect.setAttribute('aria-label', S.lang);
  subtitle.textContent = SUBTITLE[base];
  subtitle.classList.toggle('zh', base === 'zh');
  document.getElementById('foot-about')!.textContent = S.footAbout;
  document.getElementById('foot-desc')!.textContent = S.footDesc;
  document.getElementById('foot-top')!.textContent = S.footTop;
  document.getElementById('foot-games')!.textContent = S.footGames;
  document.getElementById('foot-tools')!.textContent = S.footTools;
  // 画面の部品は文言ごと作り直す（置いた駒・時間などの状態は play に残っている）
  if (play) showGame(play.game.level);
  else if (document.getElementById('levels')) showLevelSelect();
}

langSelect.addEventListener('change', () => {
  langState = changeLangMode(langSelect.value as LangMode, langState);
  setLang(langState.lang, langState.catBase);
  applyLang();
  langSelect.blur();
});

// 中断（画面が見えなくなった）：時計を止めて保存する。戻ったら続きから数える（§6.3）
document.addEventListener('visibilitychange', () => {
  if (!play) return;
  const now = performance.now();
  if (document.visibilityState === 'hidden') {
    play.watch.stop(now);
    saveProgress();
  } else if (play.phase === 'play') {
    play.watch.start(now);
  }
});
window.addEventListener('pagehide', saveProgress);

// 遊ぶ画面では、ホイールでページを動かさない。盤面の外のホイールは駒リストを動かす
// （ページを動かすのはスクロールバーだけ。2026-11-06 利用者の指示）。盤面の上のホイールは BoardControl が先に受ける
window.addEventListener('wheel', (e) => {
  if (!play || e.defaultPrevented || e.ctrlKey) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
  parts?.list.scrollBy((e.deltaY || e.deltaX) * unit);
}, { passive: false });

window.addEventListener('hashchange', route);
applyLang();
route();

// 開発時だけ、内蔵ブラウザでの確かめ用に状態を出す
if (import.meta.env.DEV) {
  (window as unknown as { __poly: unknown }).__poly = {
    get game() { return play?.game; },
    get play() { return play; },
    get view() { return parts?.view; },
    get control() { return parts?.control; },
    saved,
  };
}
