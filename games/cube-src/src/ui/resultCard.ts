// そろったときの結果（設計 05 §4.3・§7）：今回の時間と手数、その大きさのベスト。キューブの上に重ねる札
// 画面をふさがない（そろった姿は見られる）。閉じる・もう一度・Esc・ほかの操作で消える
import { formatTime, type AddResult } from './records';
import { S } from './strings';

export interface ResultCardDeps {
  again: () => void;
}

export class ResultCard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly againButton: HTMLButtonElement;
  private readonly texts: { title: HTMLElement; close: HTMLElement };
  /** 出している結果（言語を切り替えたら書き直す） */
  private shown: AddResult | null = null;

  constructor(parent: HTMLElement, deps: ResultCardDeps) {
    this.root = document.createElement('div');
    this.root.className = 'result-card';
    this.root.hidden = true;
    this.root.setAttribute('role', 'group');
    const title = document.createElement('h2');
    this.body = document.createElement('div');
    this.body.className = 'result-body';
    const footer = document.createElement('div');
    footer.className = 'result-footer';
    this.againButton = document.createElement('button');
    this.againButton.type = 'button';
    this.againButton.addEventListener('click', () => {
      this.hide();
      deps.again();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.addEventListener('click', () => this.hide());
    footer.append(this.againButton, close);
    this.root.append(title, this.body, footer);
    // 読み上げは画面の札と別に、短い 1 文で出す（05 §7）
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'polite');
    parent.append(this.root, this.live);
    this.texts = { title, close };
    this.relabel();
  }

  /** 文言を入れ直す（言語の切り替え） */
  relabel(): void {
    this.root.setAttribute('aria-label', S.resultTitle);
    this.texts.title.textContent = S.resultTitle;
    this.texts.close.textContent = S.close;
    this.againButton.textContent = S.resultAgain;
    if (this.isOpen && this.shown) this.fill(this.shown, false);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(r: AddResult): void {
    this.fill(r, true);
  }

  private fill(r: AddResult, announce: boolean): void {
    this.shown = r;
    const { record, previousBest, newBestTime, newBestMoves } = r;
    const rows: [string, string, string?][] = [
      [S.resultTime, formatTime(record.timeMs), newBestTime ? S.resultNewBest : undefined],
      [S.resultMoves, S.resultMovesValue(record.moves), newBestMoves ? S.resultNewBestMoves : undefined],
    ];
    // 新記録でなければ、これまでのベストを並べる
    if (previousBest && !newBestTime) {
      rows.push([S.resultBest(S.sizeOption(record.n)), formatTime(previousBest.timeMs)]);
    }
    this.body.replaceChildren(...rows.map(([label, value, badge]) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const l = document.createElement('span');
      l.className = 'result-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'result-value';
      v.textContent = value;
      row.append(l, v);
      if (badge) {
        const b = document.createElement('span');
        b.className = 'result-badge';
        b.textContent = badge;
        row.append(b);
      }
      return row;
    }));
    if (record.usedHint || record.usedSolver) {
      const note = document.createElement('p');
      note.className = 'result-note';
      note.textContent = S.resultAssisted;
      this.body.append(note);
    }
    this.againButton.hidden = record.n <= 1;
    this.root.hidden = false;
    if (announce) this.live.textContent = S.resultAnnounce(S.spokenTime(record.timeMs), record.moves)
      + (newBestTime ? `。${S.resultNewBest}` : '');
  }

  hide(): void {
    this.root.hidden = true;
  }
}
