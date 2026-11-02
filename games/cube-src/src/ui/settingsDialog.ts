// 設定の画面（設計 05 §5）。キーの割り当ての画面と同じく div で作る。変えたらその場で効く
import type { ArrowLabelMode } from '../input/arrowActions';
import type { ViewGrid } from '../input/viewController';
import { DEFAULT_SETTINGS, QUARTER_MS_CHOICES, type Quality, type Settings } from './settings';
import { S } from './strings';

export interface SettingsDialogDeps {
  get: () => Settings;
  set: (s: Settings) => void;
  /** 端末が「動きを減らす」になっているか */
  reducedMotion: () => boolean;
}

export class SettingsDialog {
  private readonly deps: SettingsDialogDeps;
  private readonly backdrop: HTMLDivElement;
  private readonly form: HTMLDivElement;
  private returnFocus: HTMLElement | null = null;
  private readonly texts: { title: HTMLElement; reset: HTMLElement; close: HTMLElement };

  constructor(parent: HTMLElement, deps: SettingsDialogDeps) {
    this.deps = deps;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.hidden = true;
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'settings-title');
    const title = document.createElement('h2');
    title.id = 'settings-title';
    this.form = document.createElement('div');
    this.form.className = 'settings-list';
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.deps.set({ ...DEFAULT_SETTINGS });
      this.render();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    footer.append(reset, close);
    box.append(title, this.form, footer);
    this.backdrop.append(box);
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    parent.append(this.backdrop);
    this.texts = { title, reset, close };
    this.relabel();
  }

  /** 文言を入れ直す（言語の切り替え） */
  relabel(): void {
    this.texts.title.textContent = S.settingsTitle;
    this.texts.reset.textContent = S.settingsDefault;
    this.texts.close.textContent = S.close;
    if (this.isOpen) this.render();
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.backdrop.hidden = false;
    this.render();
    this.form.querySelector<HTMLElement>('select, input')?.focus();
  }

  close(): void {
    this.backdrop.hidden = true;
    this.returnFocus?.focus();
  }

  private render(): void {
    const s = this.deps.get();
    const update = (patch: Partial<Settings>) => this.deps.set({ ...this.deps.get(), ...patch });
    const speedNote = this.deps.reducedMotion() ? S.settingsReducedMotion : '';
    this.form.replaceChildren(
      this.select(S.settingsSpeed, QUARTER_MS_CHOICES.map((ms) => [String(ms), S.speedOption(ms)]),
        String(s.quarterMs), (v) => update({ quarterMs: Number(v) }), speedNote),
      this.select(S.grid, [['0', S.gridNone], ['15', '15°'], ['45', '45°'], ['90', '90°']],
        String(s.viewGrid), (v) => update({ viewGrid: Number(v) as ViewGrid }), S.settingsGridHelp),
      this.check(S.settingsInertia, s.viewInertia, (v) => update({ viewInertia: v }), S.settingsInertiaHelp),
      this.select(S.settingsArrowLabels, (['auto', 'all', 'none'] as const).map((m) => [m, S.arrowLabelOption[m]]),
        s.arrowLabels, (v) => update({ arrowLabels: v as ArrowLabelMode }), S.settingsArrowLabelsHelp),
      this.check(S.settingsMirrors, s.mirrors, (v) => update({ mirrors: v }), S.settingsMirrorsHelp),
      this.select(S.settingsQuality, (['auto', 'high', 'low'] as const).map((q) => [q, S.qualityOption[q]]),
        s.quality, (v) => update({ quality: v as Quality }), S.settingsQualityHelp),
    );
  }

  private select(
    label: string, options: [string, string][], value: string, onChange: (v: string) => void, help?: string,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = label;
    const sel = document.createElement('select');
    for (const [v, text] of options) sel.add(new Option(text, v, v === value, v === value));
    sel.addEventListener('change', () => onChange(sel.value));
    row.append(name, sel);
    return this.withHelp(row, help);
  }

  private check(label: string, value: boolean, onChange: (v: boolean) => void, help?: string): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = label;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => onChange(box.checked));
    row.append(name, box);
    return this.withHelp(row, help);
  }

  private withHelp(row: HTMLElement, help?: string): HTMLElement {
    if (!help) return row;
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = help;
    wrap.append(row, p);
    return wrap;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      const items = [...this.backdrop.querySelectorAll<HTMLElement>('select, input, button')];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    // 後ろのキューブには渡さない（選択肢の上下キー・Enter・Space は既定の動きのまま）
    e.stopPropagation();
  }
}
