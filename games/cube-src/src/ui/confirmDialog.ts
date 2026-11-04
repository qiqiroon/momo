// ゲームの途中で、ゲームを終わらせる操作（そろえる・シャッフル・大きさ）の確認（設計 05 §3）
// キーの割り当ての画面と同じく div で作る。Esc・背景のタップは「続ける」
import { S } from './strings';

export class ConfirmDialog {
  private readonly backdrop: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly ok: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly title: HTMLHeadingElement;
  private resolve: ((ok: boolean) => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.hidden = true;
    const box = document.createElement('div');
    box.className = 'modal confirm';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'confirm-title');
    box.setAttribute('aria-describedby', 'confirm-text');
    const title = document.createElement('h2');
    title.id = 'confirm-title';
    this.title = title;
    this.text = document.createElement('p');
    this.text.id = 'confirm-text';
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    this.cancel = document.createElement('button');
    this.cancel.type = 'button';
    this.cancel.addEventListener('click', () => this.finish(false));
    this.ok = document.createElement('button');
    this.ok.type = 'button';
    this.ok.className = 'danger';
    this.ok.addEventListener('click', () => this.finish(true));
    footer.append(this.cancel, this.ok);
    box.append(title, this.text, footer);
    this.backdrop.append(box);
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.finish(false);
    });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    parent.append(this.backdrop);
    this.relabel();
  }

  /** 文言を入れ直す（言語の切り替え） */
  relabel(): void {
    this.title.textContent = S.confirmTitle;
    this.cancel.textContent = S.confirmContinue;
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  /** message を見せて、okLabel を押したら true。見出しとやめるボタンの文字は変えられる（既定はゲームの途中の確認） */
  ask(message: string, okLabel: string, opts: { title?: string; cancel?: string } = {}): Promise<boolean> {
    this.finish(false);
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.title.textContent = opts.title ?? S.confirmTitle;
    this.cancel.textContent = opts.cancel ?? S.confirmContinue;
    this.text.textContent = message;
    this.ok.textContent = okLabel;
    this.backdrop.hidden = false;
    // 押し間違いを防ぐため、最初は「続ける」に合わせる
    this.cancel.focus();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private finish(ok: boolean): void {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    this.backdrop.hidden = true;
    this.returnFocus?.focus();
    resolve(ok);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.finish(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === this.ok ? this.cancel : this.ok).focus();
    }
    // Enter・Space はボタンに任せる。どのキーも後ろのキューブには渡さない
    e.stopPropagation();
  }
}
