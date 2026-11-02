// キューブの上に一瞬浮かぶ知らせ（「そろった！」など）。
// 上の帯に行を足すと画面がずれるので、画面の上に重ねて出し、ふわっと浮いて消える（2026-11-02 作者）
const SHOW_MS = 1600;

export class Toast {
  private readonly el: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toast';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    parent.append(this.el);
  }

  show(text: string): void {
    window.clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.hidden = false;
    // 同じ知らせを続けて出しても、浮かび方を最初からやり直す
    this.el.classList.remove('play');
    void this.el.offsetWidth;
    this.el.classList.add('play');
    this.timer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.hidden = true;
    this.el.classList.remove('play');
  }
}
