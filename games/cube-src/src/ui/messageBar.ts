// キューブの画面の下の知らせ欄（2026-11-04 作者：知らせを出しても画面の大きさを変えない）
// ふだんは操作の案内（キューブの外をドラッグすると全体が回る…）を出し、知らせはそれと入れ替えて出す。
// キューブの画面に重ねて置くので、何を出しても画面の行数・キューブの写る大きさは変わらない。
// - flash：しばらく出して、案内に戻す（記録した・読み込んだ・ヒントなど）
// - setState：その状態の間ずっと出す（記録中・マークを付けている・矢印を選んでいる など）。
//   いくつも重なったら、優先の高いもの 1 つだけ
export type MessageTone = 'info' | 'active' | 'warn';

interface Entry {
  text: string;
  tone: MessageTone;
}

/** 状態の知らせの優先（前ほど高い） */
const ORDER = ['seq', 'game', 'note', 'arrow', 'timer', 'slow'] as const;
export type StateKey = (typeof ORDER)[number];

const FLASH_MS = 3500;

export class MessageBar {
  readonly el: HTMLElement;
  private defaultText = '';
  private readonly states = new Map<StateKey, Entry>();
  private flashEntry: Entry | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'message-bar';
    this.el.setAttribute('role', 'status');
    parent.append(this.el);
  }

  /** ふだんの案内 */
  setDefault(text: string): void {
    this.defaultText = text;
    this.render();
  }

  /** 状態の知らせ（null で消す） */
  setState(key: StateKey, text: string | null, tone: MessageTone = 'info'): void {
    const cur = this.states.get(key);
    if (!text) {
      if (!cur) return;
      this.states.delete(key);
    } else {
      if (cur && cur.text === text && cur.tone === tone) return;
      this.states.set(key, { text, tone });
    }
    this.render();
  }

  /** しばらく出す知らせ */
  flash(text: string, tone: MessageTone = 'info', ms = FLASH_MS): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashEntry = { text, tone };
    this.flashTimer = setTimeout(() => this.clearFlash(), ms);
    this.render();
  }

  clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    if (!this.flashEntry) return;
    this.flashEntry = null;
    this.render();
  }

  /** いま出している文字（確かめ用） */
  get text(): string {
    return this.el.textContent ?? '';
  }

  private render(): void {
    let e: Entry | null = this.flashEntry;
    if (!e) {
      for (const k of ORDER) {
        const s = this.states.get(k);
        if (s) {
          e = s;
          break;
        }
      }
    }
    const text = e ? e.text : this.defaultText;
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.dataset.tone = e ? e.tone : 'default';
  }
}
