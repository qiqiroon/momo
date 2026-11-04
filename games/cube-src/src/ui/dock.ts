// 下のパネルの置き場（2026-11-04 作者の指示）。タグ（ボタン）でパネルを呼び出す・切り替える・しまう
// - タグを押すと、そのパネルを出す（ほかのパネルは引っ込む）。出ているパネルのタグをもう一度押すとしまう
// - 右端の「しまう／出す」で、最後に出していたパネルを出し入れする
// - どれを出していたかはブラウザに覚える（localStorage['cube.dock.v1']）
import type { StorageLike } from './records';
import { S } from './strings';

export const DOCK_KEY = 'cube.dock.v1';

export interface DockPanel {
  id: string;
  /** タグの文字（言語の切り替えで変わる） */
  label: () => string;
  el: HTMLElement;
}

export class Dock {
  private readonly panels: DockPanel[];
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly badges = new Map<string, string>();
  private readonly toggle: HTMLButtonElement;
  private readonly storage: StorageLike | null;
  private openId: string | null;
  private lastId: string;
  /** 出しているパネルが変わった（キューブの写る大きさが変わる） */
  onChange: () => void = () => {};

  constructor(tabsRoot: HTMLElement, panels: DockPanel[], storage: StorageLike | null) {
    this.panels = panels;
    this.storage = storage;
    const first = panels[0].id;
    const saved = this.load();
    const known = (id: unknown): id is string => typeof id === 'string' && panels.some((p) => p.id === id);
    this.openId = saved && (saved.open === null || known(saved.open)) ? saved.open : first;
    this.lastId = saved && known(saved.last) ? saved.last : this.openId ?? first;

    tabsRoot.classList.add('dock-tabs');
    tabsRoot.setAttribute('role', 'toolbar');
    for (const p of panels) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dock-tab';
      b.dataset.panel = p.id;
      b.addEventListener('click', () => this.press(p.id));
      this.tabs.set(p.id, b);
      tabsRoot.append(b);
    }
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'dock-toggle';
    this.toggle.addEventListener('click', () => this.show(this.openId ? null : this.lastId));
    tabsRoot.append(this.toggle);
    this.relabel();
    this.apply();
  }

  /** いま出しているパネル（しまっていれば null） */
  get current(): string | null {
    return this.openId;
  }

  /** タグを押した：出ていればしまう、出ていなければ出す */
  press(id: string): void {
    this.show(this.openId === id ? null : id);
  }

  /** パネル id を出す（null でしまう） */
  show(id: string | null): void {
    if (id === this.openId) return;
    this.openId = id;
    if (id) this.lastId = id;
    this.apply();
    this.save();
    this.onChange();
  }

  /** タグの横の印（記録中の ● など）。空で消す */
  setBadge(id: string, text: string): void {
    if ((this.badges.get(id) ?? '') === text) return;
    this.badges.set(id, text);
    this.relabelTab(id);
  }

  relabel(): void {
    this.toggle.parentElement?.setAttribute('aria-label', S.tabsLabel);
    for (const p of this.panels) this.relabelTab(p.id);
    this.apply();
  }

  private relabelTab(id: string): void {
    const p = this.panels.find((q) => q.id === id);
    const b = this.tabs.get(id);
    if (!p || !b) return;
    const badge = this.badges.get(id) ?? '';
    b.textContent = badge ? `${p.label()} ${badge}` : p.label();
    b.title = S.tabTitle(p.label());
  }

  private apply(): void {
    for (const p of this.panels) {
      const on = p.id === this.openId;
      p.el.hidden = !on;
      const b = this.tabs.get(p.id)!;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('active', on);
    }
    const open = this.openId !== null;
    this.toggle.textContent = open ? S.dockHide : S.dockShow;
    this.toggle.title = open ? S.dockHideTitle : S.dockShowTitle;
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  private load(): { open: string | null; last: unknown } | null {
    try {
      const raw = this.storage?.getItem(DOCK_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw) as { open?: unknown; last?: unknown };
      return { open: typeof o.open === 'string' ? o.open : null, last: o.last };
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(DOCK_KEY, JSON.stringify({ open: this.openId, last: this.lastId }));
    } catch {
      // 覚えられなくても、出し入れはできる
    }
  }
}
