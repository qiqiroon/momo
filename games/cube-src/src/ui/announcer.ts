// 読み上げ専用の短い知らせ（設計 05 §7）。画面の帯は何度も書き換わるので、読ませたい文だけをここに出す
export class Announcer {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sr-only';
    this.el.setAttribute('aria-live', 'polite');
    parent.append(this.el);
  }

  say(text: string): void {
    // 同じ文を続けて出しても読まれるよう、いったん空にする
    this.el.textContent = '';
    requestAnimationFrame(() => (this.el.textContent = text));
  }
}
