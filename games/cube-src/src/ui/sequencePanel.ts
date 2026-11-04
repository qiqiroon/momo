// 手順の記録・再生のパネル（2026-11-04 作者の指示）
// ボタンはいくつでも足せる。1 つの手順ごとに 名前・記録・再生・マーク・マーク削除・削除。
// 記録中も戻す・やり直すができる（戻した手は忘れる。ui/sequences.ts の SequenceRecorder）。
// ブラウザに保存するほか、ファイルに書き出し・読み込みができる
//
// - 手順は大きさごとに分けて並べる。パネルの上で大きさを切り替えられ、キューブの大きさを変えると自動で切り替わる。
//   別の大きさの手順も、外から何段目かを合わせて再生できる（半分を超える段の手がある手順は、小さいキューブでは再生できない）
// - マークは手の中には入れず、1 つの手順の中の別のデータとして持つ（手順ごとに 1 組）。
//   手順の名前を選ぶと、その手順のマークがキューブに出る。
//   「マーク」を押してからセルを押すたびに 1, 2, 3…。「マーク削除」で番号の大きいほうから 1 つ消える。
//   位置は「その手順を始めるときの姿」で覚える（記録中に付けたマークは、記録した手を逆にたどった位置にする）。
//   再生を始めると、そのマークを付け直し、回すにつれてセルと一緒に動く
// - 記録中にほかの手順を再生すると、その手もふつうの操作と同じように記録される
import type { Move, MoveOrigin } from '../core/types';
import type { ViewFrame } from '../input/viewFrame';
import { spotBefore, toSeqMark, type SeqMark, type Spot } from './marks';
import {
  adaptMark, adaptStep, MAX_NOTE, moveOf, playableOn, SequenceRecorder, type Sequence, type SequenceStore,
} from './sequences';
import { S } from './strings';

export interface SequencePanelDeps {
  store: SequenceStore;
  getSize: () => number;
  getFrame: () => ViewFrame;
  /** 手を待ち行列に入れる（入らなければ false） */
  enqueue: (move: Move) => boolean;
  /** 待ち行列に入っている数（再生は空になるたびに次の 1 手を入れる） */
  queueLength: () => number;
  /** マークを、画面の向き frame で覚えた位置のセルに付け直す（空で全部外す） */
  showMarks: (marks: readonly SeqMark[], frame: ViewFrame) => void;
  /** いま付いているマークの位置（付けた順） */
  markSpots: () => Spot[];
  /** 番号のいちばん大きいマークを外す */
  removeMark: () => void;
  confirm: (message: string, okLabel: string) => Promise<boolean>;
  announce: (text: string) => void;
  /**
   * 知らせ（キューブの画面の下の知らせ欄。2026-11-04 作者：知らせで画面の大きさを変えない）。
   * status＝記録中などの間ずっと出す（null で消す）、flash＝しばらく出す
   */
  status: (text: string | null, tone: 'info' | 'active' | 'warn') => void;
  flash: (text: string, tone: 'info' | 'active' | 'warn') => void;
  /** 手順セットの説明を知らせ欄に出す（null で消す） */
  note: (text: string | null) => void;
  /** 記録・再生・マークの状態が変わった（タグの印など） */
  changed: () => void;
}

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export class SequencePanel {
  private readonly deps: SequencePanelDeps;
  private readonly list: HTMLElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly sizeLabel: HTMLElement;
  private readonly buttons: Record<'add' | 'note' | 'export' | 'import', HTMLButtonElement>;
  /** 説明を書く箱（「説明追加」で開く） */
  private readonly noteBox: HTMLElement;
  private readonly noteText: HTMLTextAreaElement;
  private readonly fileInput: HTMLInputElement;
  private recordingId: string | null = null;
  private recorder: SequenceRecorder | null = null;
  private playingId: string | null = null;
  private playQueue: Move[] = [];
  /** 再生で入れた手の確定を、利用者の手と見分ける */
  private playPending = 0;
  /** 名前を選んでいる手順（そのマークを出している） */
  private selectedId: string | null = null;
  /** マークを付けている手順（セルを押すとマークが付く） */
  private markingId: string | null = null;
  /** 並べている手順の大きさ */
  private viewSize: number;
  /** 前に見たキューブの大きさ（変わったら並べる大きさも合わせる） */
  private cubeSize: number;

  constructor(root: HTMLElement, deps: SequencePanelDeps) {
    this.deps = deps;
    this.viewSize = this.cubeSize = deps.getSize();
    root.classList.add('panel', 'seq-panel');
    const head = div('panel-row seq-head');
    const label = document.createElement('label');
    label.className = 'seq-size';
    this.sizeLabel = document.createElement('span');
    this.sizeSelect = document.createElement('select');
    this.sizeSelect.addEventListener('change', () => {
      this.setViewSize(Number(this.sizeSelect.value));
      this.sizeSelect.blur();
    });
    label.append(this.sizeLabel, this.sizeSelect);
    this.buttons = {
      add: button(() => this.add()),
      note: button(() => this.toggleNoteBox()),
      export: button(() => this.exportFile()),
      import: button(() => this.fileInput.click()),
    };
    this.buttons.add.classList.add('seq-add');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.importFile());
    head.append(label, ...Object.values(this.buttons), this.fileInput);
    this.list = div('seq-list');
    // 手順セットの説明（2026-11-04 作者）。1 行目の「説明追加」で開く箱に書く。書いた説明は知らせ欄に出す
    this.noteBox = div('seq-note-box');
    this.noteBox.hidden = true;
    this.noteText = document.createElement('textarea');
    this.noteText.className = 'seq-note-text';
    this.noteText.rows = 2;
    this.noteText.maxLength = MAX_NOTE;
    this.noteText.addEventListener('input', () => {
      this.deps.store.setNote(this.noteText.value);
      this.checkSaved();
      this.showNote();
    });
    // 書いている間のキーは、キューブに渡さない
    this.noteText.addEventListener('keydown', (e) => e.stopPropagation());
    const noteClose = button(() => this.toggleNoteBox(false));
    noteClose.className = 'seq-note-close';
    this.noteBox.append(this.noteText, noteClose);
    // 1 行目（手順の大きさ・追加…）はいつも出し、手順の一覧だけをスクロールする（2026-11-04 作者）
    root.append(head, this.noteBox, this.list);
    this.relabel();
  }

  get recording(): boolean {
    return this.recordingId !== null;
  }

  get playing(): boolean {
    return this.playingId !== null;
  }

  /** マークを付けている最中（セルを押すとマークが付く） */
  get marking(): boolean {
    return this.markingId !== null;
  }

  relabel(): void {
    const b = this.buttons;
    b.add.textContent = S.seqAdd;
    b.add.title = S.seqAddTitle;
    b.note.textContent = S.seqNote;
    b.note.title = S.seqNoteTitle;
    (this.noteBox.lastElementChild as HTMLElement).textContent = S.close;
    this.noteText.placeholder = S.seqNotePlaceholder;
    this.noteText.setAttribute('aria-label', S.seqNoteTitle);
    b.export.textContent = S.seqExport;
    b.export.title = S.seqExportTitle;
    b.import.textContent = S.seqImport;
    b.import.title = S.seqImportTitle;
    this.sizeLabel.textContent = S.seqViewLabel;
    this.render();
  }

  /**
   * 手順の名前以外を押した（キューブのドラッグも）：選択を外してマークを消す（2026-11-04 作者）。
   * ただし記録・再生・マークを付けている最中は、その手順のまま
   */
  deselect(): void {
    if (!this.selectedId || this.recordingId || this.playingId || this.markingId) return;
    this.selectedId = null;
    this.showSelectedMarks();
    this.markRows();
    this.deps.changed();
  }

  /** 手順セット（すべての大きさに共通。ファイル 1 つに 1 つ）の説明を知らせ欄に出す。説明が無ければ消す */
  showNote(): void {
    const text = this.deps.store.note;
    this.deps.note(text.trim() ? text : null);
  }

  /** 説明を知らせ欄から消す（手順のパネルの外を押した・ほかのパネルに替えた・しまった） */
  hideNote(): void {
    this.deps.note(null);
  }

  private toggleNoteBox(open: boolean = this.noteBox.hidden !== false): void {
    this.noteBox.hidden = !open;
    this.buttons.note.classList.toggle('active', open);
    this.buttons.note.setAttribute('aria-expanded', String(open));
    if (open) {
      this.noteText.value = this.deps.store.note;
      this.noteText.focus();
    }
    this.showNote();
  }

  /** 手が確定した（記録と、再生の見張り） */
  committed(move: Move, origin: MoveOrigin): void {
    if (this.playingId) {
      if (origin === 'user' && this.playPending > 0) this.playPending--;
      else this.stopPlay();
    }
    // 再生した手も、ふつうの操作と同じように記録する（2026-11-04 作者）
    if (this.recorder && this.recorder.committed(move, origin)) {
      this.saveRecording();
      this.renderStatus();
    }
  }

  /** セルを押してマークを付けた（マークを付けている手順に覚える） */
  marksEdited(): void {
    const seq = this.markingId ? this.deps.store.get(this.markingId) : undefined;
    if (seq) this.storeMarks(seq);
  }

  /** いま付いているマークを、手順の始めの姿の位置にして覚える */
  private storeMarks(seq: Sequence): void {
    let spots = this.deps.markSpots();
    let frame = this.deps.getFrame();
    if (this.recordingId === seq.id && this.recorder) {
      // 記録中：ここまでに記録した手を逆にたどって、記録を始めたときの位置にする
      const moves = this.recorder.moves();
      const n = this.recorder.n;
      spots = spots.map((p) => moves.reduceRight((q, m) => spotBefore(n, q, m), p));
      frame = this.recorder.frame;
    }
    this.deps.store.setMarks(seq.id, spots.map((p) => toSeqMark(seq.n, frame, p)));
    this.checkSaved();
    this.render();
  }

  /** リセット・シャッフル・大きさの変更：記録と再生をやめる（記録した分は残す） */
  stopAll(): void {
    this.stopRecord();
    this.stopPlay();
  }

  /** 毎フレーム。再生中で待ち行列が空なら次の 1 手を入れる */
  tick(): void {
    if (!this.playingId || this.deps.queueLength() > 0) return;
    const m = this.playQueue.shift();
    if (!m) {
      this.stopPlay();
      return;
    }
    this.playPending++;
    if (!this.deps.enqueue(m)) this.stopPlay();
  }

  /** キューブを作り直した（リセット・シャッフル・大きさの変更）。大きさが変わったら並べる大きさも合わせる */
  refresh(): void {
    const n = this.deps.getSize();
    if (n !== this.cubeSize) {
      this.cubeSize = n;
      this.viewSize = n;
      this.syncNoteBox();
      this.selectedId = null;
      this.markingId = null;
      this.deps.changed();
    }
    this.render();
    // 作り直した姿に、選んでいる手順のマークを付け直す（手順の始めの姿とみなす）
    this.showSelectedMarks();
  }

  private setViewSize(n: number): void {
    if (n === this.viewSize) return;
    this.viewSize = n;
    this.syncNoteBox();
    if (!this.recordingId) {
      this.selectedId = null;
      this.markingId = null;
      this.showSelectedMarks();
      this.deps.changed();
    }
    this.render();
  }

  /** 手順の名前を選んだ：その手順のマークを出す（記録中は、記録している手順のまま） */
  private select(seq: Sequence): void {
    if (this.recordingId && this.recordingId !== seq.id) return;
    if (this.selectedId === seq.id) return;
    this.selectedId = seq.id;
    if (this.markingId !== seq.id) this.markingId = null;
    this.showSelectedMarks();
    this.markRows();
    this.renderStatus();
    this.deps.changed();
  }

  /** 説明の箱の中身と、知らせ欄の説明を入れ直す（ファイルを読み込んだときなど） */
  private syncNoteBox(): void {
    this.noteText.value = this.deps.store.note;
    this.noteText.placeholder = S.seqNotePlaceholder;
    if (this.noteShown) this.showNote();
  }

  /** 説明を知らせ欄に出している（main が知らせ欄の状態を見て渡す） */
  noteShown = false;

  private showSelectedMarks(): void {
    const seq = this.selectedId ? this.deps.store.get(this.selectedId) : undefined;
    const n = this.deps.getSize();
    const marks = seq ? seq.marks.map((m) => adaptMark(m, seq.n, n)).filter((m): m is SeqMark => m !== null) : [];
    this.deps.showMarks(marks, this.deps.getFrame());
  }

  private toggleMark(seq: Sequence): void {
    if (this.markingId === seq.id) {
      this.markingId = null;
    } else {
      this.select(seq);
      if (this.selectedId !== seq.id) return;
      this.markingId = seq.id;
    }
    this.render();
    this.deps.changed();
  }

  private unmark(seq: Sequence): void {
    this.select(seq);
    if (this.selectedId !== seq.id) return;
    this.deps.removeMark();
    this.storeMarks(seq);
  }

  private add(): void {
    const k = this.deps.store.all.filter((q) => q.n === this.viewSize).length;
    const s = this.deps.store.add(S.seqDefaultName(k + 1), this.viewSize);
    this.render();
    this.checkSaved();
    // 足した手順の名前の欄へ（すぐ名前を付けられる）
    this.list.querySelector<HTMLElement>(`[data-id="${s.id}"] .seq-name`)?.focus();
  }

  private async toggleRecord(seq: Sequence): Promise<void> {
    if (this.recordingId === seq.id) {
      this.stopRecord();
      return;
    }
    if (seq.n !== this.deps.getSize()) return;
    if (seq.steps.length > 0 && !(await this.deps.confirm(S.seqOverwriteConfirm(seq.name), S.seqOverwriteOk))) return;
    this.stopRecord();
    if (this.playingId) this.stopPlay();
    this.recordingId = seq.id;
    this.recorder = new SequenceRecorder(this.deps.getSize(), this.deps.getFrame());
    this.deps.store.setSteps(seq.id, this.recorder.n, []);
    // いまの姿をこの手順の始めとして、マークを付け直す
    this.selectedId = seq.id;
    if (this.markingId !== seq.id) this.markingId = null;
    this.showSelectedMarks();
    this.checkSaved();
    this.render();
    this.deps.changed();
  }

  private stopRecord(): void {
    if (!this.recordingId) return;
    const seq = this.deps.store.get(this.recordingId);
    this.saveRecording();
    if (seq) {
      this.say(S.seqRecorded(seq.name, seq.steps.length));
    }
    this.recordingId = null;
    this.recorder = null;
    this.render();
    this.deps.changed();
  }

  private saveRecording(): void {
    if (!this.recordingId || !this.recorder) return;
    this.deps.store.setSteps(this.recordingId, this.recorder.n, this.recorder.steps);
    this.checkSaved();
  }

  private togglePlay(seq: Sequence): void {
    if (this.playingId === seq.id) {
      this.stopPlay();
      return;
    }
    const n = this.deps.getSize();
    if (!playableOn(seq, n)) return;
    this.stopPlay();
    // いまの向きで、全部の手を先に決めておく（再生の途中で全体を回しても、同じ手順のまま）。
    // 別の大きさの手順は、外から何段目かを合わせる
    const frame = this.deps.getFrame();
    const moves: Move[] = [];
    for (const s of seq.steps) {
      const step = adaptStep(s, seq.n, n);
      const move = step ? moveOf(n, frame, step) : null;
      if (move) moves.push(move);
    }
    if (moves.length === 0) return;
    // 記録中でなければ、この手順を選んで、いまの姿にマークを付ける（回すとセルと一緒に動く）
    if (!this.recordingId) {
      this.selectedId = seq.id;
      if (this.markingId !== seq.id) this.markingId = null;
      this.showSelectedMarks();
    }
    this.playingId = seq.id;
    this.playQueue = moves;
    this.playPending = 0;
    this.render();
    this.deps.changed();
  }

  private stopPlay(): void {
    if (!this.playingId) return;
    this.playingId = null;
    this.playQueue = [];
    this.playPending = 0;
    this.render();
    this.deps.changed();
  }

  private async remove(seq: Sequence): Promise<void> {
    if (!(await this.deps.confirm(S.seqDeleteConfirm(seq.name), S.seqDelete))) return;
    if (this.recordingId === seq.id) {
      this.recordingId = null;
      this.recorder = null;
    }
    if (this.playingId === seq.id) this.stopPlay();
    this.deps.store.remove(seq.id);
    // 消した手順のマークも一緒に消える
    if (this.selectedId === seq.id) {
      this.selectedId = null;
      this.markingId = null;
      this.showSelectedMarks();
    }
    this.checkSaved();
    this.render();
    this.deps.changed();
  }

  private exportFile(): void {
    if (this.deps.store.all.length === 0) {
      this.say(S.seqExportEmpty, 'warn');
      return;
    }
    const blob = new Blob([this.deps.store.toFile()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    a.download = `momo-cube-sequences-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
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
    this.syncNoteBox();
    if (added > 0) this.say(S.seqImported(added));
    else this.say(S.seqImportFailed, 'warn');
    this.checkSaved();
  }

  private say(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.deps.flash(text, tone);
    this.deps.announce(text);
  }

  private checkSaved(): void {
    if (this.deps.store.saveFailed) {
      this.say(S.seqSaveFailed, 'warn');
    }
  }

  private render(): void {
    const n = this.deps.getSize();
    const all = this.deps.store.all;
    // 大きさの選び：それぞれの大きさの手順の数も出す
    const value = String(this.viewSize);
    this.sizeSelect.replaceChildren(...SIZES.map((k) => {
      const count = all.filter((q) => q.n === k).length;
      return new Option(S.seqViewOption(S.sizeOption(k), count), String(k), false, String(k) === value);
    }));
    this.sizeSelect.value = value;
    this.sizeSelect.setAttribute('aria-label', S.seqViewLabel);
    const shown = all.filter((q) => q.n === this.viewSize);
    if (shown.length === 0) {
      this.list.replaceChildren(div('seq-empty', all.length === 0 ? S.seqEmpty : S.seqEmptySize(S.sizeOption(this.viewSize))));
    } else {
      this.list.replaceChildren(...shown.map((seq) => this.row(seq, n)));
    }
    this.markRows();
    this.renderStatus();
  }

  /** 選んでいる手順の行に印を付ける（行を作り直さない。名前の欄の入力を切らないため） */
  private markRows(): void {
    for (const r of this.list.querySelectorAll<HTMLElement>('.seq-row')) {
      r.classList.toggle('selected', r.dataset.id === this.selectedId);
    }
  }

  private renderStatus(): void {
    const rec = this.recordingId ? this.deps.store.get(this.recordingId) : undefined;
    const play = this.playingId ? this.deps.store.get(this.playingId) : undefined;
    const marking = this.markingId ? this.deps.store.get(this.markingId) : undefined;
    let text: string | null = null;
    if (marking) text = S.seqMarking(marking.name);
    else if (rec && this.recorder) text = S.seqRecording(rec.name, this.recorder.steps.length);
    else if (play) text = S.seqPlaying(play.name);
    this.deps.status(text, rec || marking ? 'active' : 'info');
    if (rec && this.recorder) {
      const info = this.list.querySelector<HTMLElement>(`[data-id="${rec.id}"] .seq-info`);
      if (info) info.textContent = S.seqInfo(S.sizeOption(rec.n), this.recorder.steps.length);
    }
  }

  private row(seq: Sequence, n: number): HTMLElement {
    const r = div('seq-row');
    r.dataset.id = seq.id;
    const recording = this.recordingId === seq.id;
    const playing = this.playingId === seq.id;
    const marking = this.markingId === seq.id;
    const sameSize = seq.n === n;
    /** ほかの手順を記録している最中（マークを触れるのは、記録している手順だけ） */
    const otherRecording = this.recordingId !== null && !recording;
    r.classList.toggle('recording', recording);
    r.classList.toggle('playing', playing);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'seq-name';
    name.value = seq.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', S.seqNameAria);
    name.title = S.seqNameAria;
    // 名前を選ぶと、その手順のマークが出る
    name.addEventListener('focus', () => this.select(seq));
    name.addEventListener('click', () => this.select(seq));
    // 手順を呼び出したら、手順セットの説明も出す
    name.addEventListener('pointerdown', () => this.showNote());
    name.addEventListener('change', () => {
      this.deps.store.rename(seq.id, name.value.trim() || seq.name);
      name.value = this.deps.store.get(seq.id)?.name ?? name.value;
      this.checkSaved();
      this.renderStatus();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
      // 名前を打っている間のキーは、キューブに渡さない
      e.stopPropagation();
    });

    const count = recording && this.recorder ? this.recorder.steps.length : seq.steps.length;
    const info = div('seq-info', S.seqInfo(S.sizeOption(seq.n), count));

    const rec = button(() => void this.toggleRecord(seq));
    rec.className = recording ? 'seq-rec active' : 'seq-rec';
    rec.textContent = recording ? S.seqRecordStop : S.seqRecord;
    rec.title = sameSize ? S.seqRecordTitle : S.seqRecordSize(S.sizeOption(seq.n));
    rec.setAttribute('aria-pressed', String(recording));
    rec.disabled = playing || (!recording && !sameSize);

    const play = button(() => this.togglePlay(seq));
    play.className = playing ? 'seq-play active' : 'seq-play';
    play.textContent = playing ? S.seqPlayStop : S.seqPlay;
    const playable = playableOn(seq, n);
    play.title = seq.steps.length > 0 && !playable ? S.seqPlayDeep(S.sizeOption(n))
      : sameSize ? S.seqPlayTitle : S.seqPlayOther(S.sizeOption(seq.n));
    play.disabled = !playing && (recording || !playable);

    const mark = button(() => this.toggleMark(seq));
    mark.className = marking ? 'seq-mark active' : 'seq-mark';
    mark.textContent = S.seqMark;
    mark.title = sameSize ? S.seqMarkTitle : S.seqMarkSize(S.sizeOption(seq.n));
    mark.setAttribute('aria-pressed', String(marking));
    mark.disabled = !marking && (!sameSize || otherRecording);

    const unmark = button(() => this.unmark(seq));
    unmark.className = 'seq-unmark';
    unmark.textContent = S.seqUnmark;
    unmark.title = sameSize ? S.seqUnmarkTitle : S.seqMarkSize(S.sizeOption(seq.n));
    unmark.disabled = !sameSize || seq.marks.length === 0 || otherRecording;

    const del = button(() => void this.remove(seq));
    del.className = 'seq-del';
    del.textContent = S.seqDelete;
    del.title = S.seqDeleteTitle;

    r.append(name, info, rec, play, mark, unmark, del);
    return r;
  }
}

function div(className: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

function button(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
