// プレイ記録のパネル（2026-11-04 作者の指示）。シャッフルの中身とそのあとの手をすべて覚え、保存・再生する
// - 1 行目：いまのゲームの中身（シャッフルの手数・そのあとの手数・全体の回転の数）・保存・ファイルに保存・ファイルを開く。
//   一覧が多くなってスクロールしても、1 行目はいつも出す
// - 一覧：保存したプレイ記録（新しいものが上）。名前・中身・再生・削除
// - 再生：シャッフルした姿と始めの全体の向きに戻し、手・戻す・やり直す・全体の回転を、覚えた順に 1 つずつ見せる。
//   時間は計らない。再生した手はいまのゲームの手として覚え直すので、再生の途中・あとから続けて回せる。
//   再生の途中に自分で回すと、再生は止まる
import type { MoveOrigin } from '../core/types';
import { moveCountOf, viewCountOf, type GameLog, type GameRecorder, type GameStore, type LogStep, type SavedGame } from './gameLog';
import { formatTime } from './records';
import { S } from './strings';

export interface GamePanelDeps {
  store: GameStore;
  recorder: GameRecorder;
  /** プレイ記録の始めの姿にする（途中のゲームがあれば確かめる）。やめたら false */
  load: (log: GameLog) => Promise<boolean>;
  /** 1 歩を行う（手・戻す・やり直すは待ち行列へ、全体の向きは動かして向ける） */
  step: (n: number, step: LogStep) => void;
  /** 回している手も、全体の向きの動きもない */
  idle: () => boolean;
  confirm: (message: string, okLabel: string) => Promise<boolean>;
  announce: (text: string) => void;
  status: (text: string | null, tone: 'info' | 'active' | 'warn') => void;
  flash: (text: string, tone: 'info' | 'active' | 'warn') => void;
  /** しばらく出している知らせを消す（再生を始めたら「再生中」を見せる） */
  clearFlash: () => void;
  changed: () => void;
}

/** 再生で、1 歩が終わってから次の 1 歩までの間（ms） */
const GAP_MS = 120;

export class GamePanel {
  private readonly deps: GamePanelDeps;
  private readonly list: HTMLElement;
  private readonly now: HTMLElement;
  private readonly buttons: Record<'save' | 'export' | 'import', HTMLButtonElement>;
  private readonly fileInput: HTMLInputElement;
  private playing: { id: string; name: string; log: GameLog; index: number } | null = null;
  /** 再生で入れた手（戻す・やり直すも）の確定を、利用者の手と見分ける */
  private pending = 0;
  private wasBusy = false;
  private nextAt = 0;
  private warnedFull = false;

  constructor(root: HTMLElement, deps: GamePanelDeps) {
    this.deps = deps;
    root.classList.add('panel', 'seq-panel', 'game-panel');
    const head = div('panel-row seq-head');
    this.now = div('seq-info game-now');
    this.buttons = {
      save: button(() => this.save()),
      export: button(() => this.exportFile()),
      import: button(() => this.fileInput.click()),
    };
    this.buttons.save.classList.add('seq-add');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.importFile());
    head.append(this.now, ...Object.values(this.buttons), this.fileInput);
    this.list = div('seq-list');
    root.append(head, this.list);
    deps.recorder.onChange = () => this.renderNow();
    this.relabel();
  }

  get isPlaying(): boolean {
    return this.playing !== null;
  }

  relabel(): void {
    const b = this.buttons;
    b.save.textContent = S.gameSave;
    b.save.title = S.gameSaveTitle;
    b.export.textContent = S.seqExport;
    b.export.title = S.gameExportTitle;
    b.import.textContent = S.seqImport;
    b.import.title = S.gameImportTitle;
    this.render();
  }

  /** 手が確定した（再生の見張り）。覚えるのは main が recorder に渡す */
  committed(_origin: MoveOrigin): void {
    if (!this.playing) return;
    if (this.pending > 0) this.pending--;
    else this.stop();
  }

  /** シャッフル・そろえる・大きさを変えたとき */
  stopAll(): void {
    this.stop();
    this.warnedFull = false;
  }

  /** 毎フレーム。前の 1 歩が終わって少し間をおいたら、次の 1 歩 */
  tick(now: number): void {
    const rec = this.deps.recorder;
    if (rec.full && !this.warnedFull) {
      this.warnedFull = true;
      this.deps.flash(S.gameFull, 'warn');
    }
    const p = this.playing;
    if (!p) return;
    if (!this.deps.idle()) {
      this.wasBusy = true;
      return;
    }
    if (this.wasBusy) {
      this.wasBusy = false;
      this.nextAt = now + GAP_MS;
    }
    if (now < this.nextAt) return;
    if (p.index >= p.log.steps.length) {
      const name = p.name;
      this.stop();
      this.say(S.gamePlayed(name));
      return;
    }
    const step = p.log.steps[p.index++];
    if (step[0] !== 'v') this.pending++;
    this.wasBusy = true;
    this.deps.step(p.log.n, step);
    this.renderStatus();
  }

  private async play(g: SavedGame): Promise<void> {
    if (this.playing?.id === g.id) {
      this.stop();
      return;
    }
    this.stop();
    if (!(await this.deps.load(g.log))) return;
    this.playing = { id: g.id, name: g.name, log: g.log, index: 0 };
    this.pending = 0;
    this.wasBusy = false;
    this.nextAt = performance.now() + GAP_MS * 3;
    this.render();
    this.deps.clearFlash();
    this.renderStatus();
    this.deps.announce(S.gamePlaying(g.name, 0, g.log.steps.length));
    this.deps.changed();
  }

  private stop(): void {
    if (!this.playing) return;
    this.playing = null;
    this.pending = 0;
    this.deps.status(null, 'info');
    this.render();
    this.deps.changed();
  }

  private renderStatus(): void {
    const p = this.playing;
    this.deps.status(p ? S.gamePlaying(p.name, p.index, p.log.steps.length) : null, 'active');
  }

  private save(): void {
    const log = this.deps.recorder.log;
    if (log.steps.length === 0 && log.scramble.length === 0) {
      this.say(S.gameSaveEmpty, 'warn');
      return;
    }
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const date = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const g = this.deps.store.add(S.gameDefaultName(date, S.sizeOption(log.n)), log);
    this.render();
    this.list.scrollTop = 0;
    if (this.deps.store.saveFailed) this.say(S.seqSaveFailed, 'warn');
    else this.say(S.gameSaved(g.name));
  }

  private async remove(g: SavedGame): Promise<void> {
    if (!(await this.deps.confirm(S.gameDeleteConfirm(g.name), S.gameDelete))) return;
    if (this.playing?.id === g.id) this.stop();
    this.deps.store.remove(g.id);
    this.render();
  }

  private renderNow(): void {
    const log = this.deps.recorder.log;
    this.now.textContent = S.gameNow(S.sizeOption(log.n), log.scramble.length, moveCountOf(log), viewCountOf(log));
  }

  private render(): void {
    this.renderNow();
    const games = this.deps.store.all;
    if (games.length === 0) {
      this.list.replaceChildren(div('seq-empty', S.gameEmpty));
      return;
    }
    this.list.replaceChildren(...games.map((g) => this.row(g)));
  }

  private row(g: SavedGame): HTMLElement {
    const playing = this.playing?.id === g.id;
    const row = div(`seq-row${playing ? ' playing' : ''}`);
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'seq-name';
    name.value = g.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', S.gameNameAria);
    name.addEventListener('change', () => {
      this.deps.store.rename(g.id, name.value.trim() || g.name);
      name.value = this.deps.store.get(g.id)?.name ?? name.value;
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    const time = g.log.timeMs !== undefined ? formatTime(g.log.timeMs) : '';
    const info = div('seq-info', S.gameInfo(S.sizeOption(g.log.n), moveCountOf(g.log), time));
    const play = button(() => void this.play(g));
    play.textContent = playing ? S.gameStop : S.gamePlay;
    play.title = S.gamePlayTitle;
    if (playing) play.classList.add('active');
    const del = button(() => void this.remove(g));
    del.textContent = S.gameDelete;
    row.append(name, info, play, del);
    return row;
  }

  private exportFile(): void {
    if (this.deps.store.all.length === 0) {
      this.say(S.gameExportEmpty, 'warn');
      return;
    }
    const blob = new Blob([this.deps.store.toFile()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    a.download = `momo-cube-games-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      text = '';
    }
    const added = this.deps.store.importFile(text);
    this.render();
    if (added > 0) this.say(S.gameImported(added));
    else this.say(S.gameImportFailed, 'warn');
  }

  private say(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.deps.flash(text, tone);
    this.deps.announce(text);
  }
}

function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
