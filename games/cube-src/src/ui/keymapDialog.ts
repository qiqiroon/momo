// キーの割り当てを変える画面（設計 04 §5.2・05 §5）。<dialog> は Safari 15.4 未満で無いので div で作る
import {
  assignKey, DEFAULT_KEYMAP, isReservedCode, KEY_ACTIONS, keyLabel, keymapFromFile, keymapToFile, learnKeyLabel,
  type KeyAction, type Keymap,
} from '../input/keymap';
import { S } from './strings';

export interface KeymapDialogDeps {
  getKeymap: () => Keymap;
  setKeymap: (keymap: Keymap) => void;
}

export class KeymapDialog {
  private readonly deps: KeymapDialogDeps;
  private readonly backdrop: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private readonly texts: {
    title: HTMLElement; help: HTMLElement; reset: HTMLElement; close: HTMLElement; save: HTMLElement; load: HTMLElement;
  };
  private waiting: KeyAction | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement, deps: KeymapDialogDeps) {
    this.deps = deps;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.hidden = true;
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'keymap-title');
    const title = document.createElement('h2');
    title.id = 'keymap-title';
    const help = document.createElement('p');
    help.className = 'help';
    this.list = document.createElement('div');
    this.list.className = 'keymap-list';
    this.message = document.createElement('p');
    this.message.className = 'message';
    this.message.setAttribute('aria-live', 'polite');
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.deps.setKeymap(DEFAULT_KEYMAP);
      this.message.textContent = '';
      this.render();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    // 覚えたキーをファイルに保存・ファイルから読み出す（2026-11-04 作者）
    const save = document.createElement('button');
    save.type = 'button';
    save.addEventListener('click', () => this.saveFile());
    const load = document.createElement('button');
    load.type = 'button';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    load.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void this.loadFile(fileInput));
    const files = document.createElement('div');
    files.className = 'modal-files';
    files.append(save, load, fileInput);
    footer.append(reset, close);
    box.append(title, help, this.list, this.message, files, footer);
    this.backdrop.append(box);
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    // 割り当て中のキーは、ゲームの操作に渡さずここで受ける
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    parent.append(this.backdrop);
    this.texts = { title, help, reset, close, save, load };
    this.relabel();
  }

  /** 文言を入れ直す（言語の切り替え） */
  relabel(): void {
    this.texts.title.textContent = S.keymapTitle;
    this.texts.help.textContent = S.keymapHelp;
    this.texts.reset.textContent = S.keymapDefault;
    this.texts.close.textContent = S.close;
    this.texts.save.textContent = S.seqExport;
    this.texts.save.title = S.keymapSaveTitle;
    this.texts.load.textContent = S.seqImport;
    this.texts.load.title = S.keymapLoadTitle;
    if (this.isOpen) this.render();
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.backdrop.hidden = false;
    this.waiting = null;
    this.message.textContent = '';
    this.render();
    this.list.querySelector('button')?.focus();
  }

  close(): void {
    this.waiting = null;
    this.backdrop.hidden = true;
    this.returnFocus?.focus();
  }

  private render(): void {
    const keymap = this.deps.getKeymap();
    this.list.replaceChildren();
    for (const a of KEY_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'keymap-row';
      const name = document.createElement('span');
      name.textContent = S.action[a];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'keycap';
      b.dataset.action = a;
      const waiting = this.waiting === a;
      b.textContent = waiting ? '…' : keyLabel(keymap[a]);
      b.setAttribute('aria-label', `${S.action[a]}：${waiting ? S.keymapWaiting : keyLabel(keymap[a])}`);
      if (waiting) b.classList.add('waiting');
      b.addEventListener('click', () => {
        this.waiting = a;
        this.message.textContent = S.keymapWaiting;
        this.render();
        (this.list.querySelector(`[data-action="${a}"]`) as HTMLElement | null)?.focus();
      });
      row.append(name, b);
      this.list.append(row);
    }
  }

  private saveFile(): void {
    const blob = new Blob([keymapToFile(this.deps.getKeymap())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'momo-cube-keys.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async loadFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      text = '';
    }
    const keymap = keymapFromFile(text);
    if (keymap) {
      this.deps.setKeymap(keymap);
      this.waiting = null;
      this.message.textContent = S.keymapLoaded;
      this.render();
    } else {
      this.message.textContent = S.keymapLoadFailed;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.waiting) {
        this.waiting = null;
        this.message.textContent = '';
        this.render();
      } else {
        this.close();
      }
      return;
    }
    if (e.key === 'Tab') {
      this.trapFocus(e);
      return;
    }
    if (!this.waiting) {
      // Enter・Space でボタンを押せるよう、それ以外のキーだけ止める（後ろのキューブを回さない）
      if (e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // 修飾キーだけを押した瞬間は待ち続ける
    if (/^(Shift|Alt|Control|Meta|OS)/.test(e.code)) return;
    learnKeyLabel(e.code, e.key);
    if (isReservedCode(e.code)) {
      this.message.textContent = S.keymapReserved(keyLabel(e.code) || e.key);
      return;
    }
    const action = this.waiting;
    const { keymap, swapped } = assignKey(this.deps.getKeymap(), action, e.code);
    this.deps.setKeymap(keymap);
    this.waiting = null;
    this.message.textContent = swapped ? S.keymapSwapped(keyLabel(e.code), S.action[swapped]) : '';
    this.render();
    (this.list.querySelector(`[data-action="${action}"]`) as HTMLElement | null)?.focus();
  }

  private trapFocus(e: KeyboardEvent): void {
    const items = [...this.backdrop.querySelectorAll<HTMLElement>('button')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    e.stopPropagation();
  }
}
