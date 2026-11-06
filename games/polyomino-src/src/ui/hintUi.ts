// ヒントの流れ（仕様書 §8）：押す → すぐ出せれば出す／出せなければ Worker で計算 → 2 秒で問い → 5 分で中断。
// 計算中も画面と操作は止めない。画面が見えない間は計算も時計も止める。
// 結果は「駒を1つ、正しい場所に仮置き」。フォールバック（別の答え方）はしない（§8.2）

import { type Game } from '../core/game';
import { chooseHint, startHint } from '../core/hint';
import { type HintProblem } from '../core/hintSolver';
import { type Placement } from '../core/levels';
import type { HintWorkerOut } from '../hint/hintWorker';
import { S } from './strings';

/** 2 秒たったら「時間がかかっています。中断しますか？」（計算は続ける。§8.4） */
const ASK_MS = 2000;
/** 見えている時間の累計がこれに達したら自動で中断（§8.4） */
const LIMIT_MS = 5 * 60 * 1000;

export class HintRunner {
  private worker: Worker | null = null;
  private jobId = 0;
  private running: { id: number; sig: string; visibleMs: number; last: number; asked: boolean } | null = null;
  private readonly toast: HTMLElement;
  private tick = 0;
  private hideTimer = 0;
  private readonly onVis = () => this.visibility();

  /**
   * @param apply 見つかった駒を仮置きにする
   * @param busyChanged 計算中かどうかが変わった（ヒントのボタンの見た目）
   */
  constructor(
    wrap: HTMLElement,
    private readonly game: Game,
    private readonly apply: (pl: Placement) => void,
    private readonly busyChanged: (busy: boolean) => void,
  ) {
    this.toast = document.createElement('div');
    this.toast.className = 'hint-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    wrap.append(this.toast);
    document.addEventListener('visibilitychange', this.onVis);
  }

  get busy(): boolean {
    return !!this.running;
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    document.removeEventListener('visibilitychange', this.onVis);
  }

  /** 置いた駒の並び（計算中に盤面が変わったら、その計算は捨てる） */
  private signature(): string {
    return JSON.stringify([...this.game.placements]);
  }

  /** ヒントのボタンを押した */
  request(): void {
    if (this.running) { this.ask(); return; } // 計算中にもう一度押したら、中断するかを聞く
    if (this.game.sel) this.game.cancel();
    const st = startHint(this.game);
    if (st.kind === 'conflict') { this.say(S.hintConflict); return; }
    if (st.kind === 'full') return;
    if (st.kind === 'ready') { this.apply(st.placement); return; }
    this.compute(st.problem);
  }

  /** 盤面が変わった（駒を置いた・外した）。計算中なら、その計算は今の盤面に合わないのでやめる */
  boardChanged(): void {
    if (this.running && this.running.sig !== this.signature()) this.stop();
  }

  private compute(problem: HintProblem): void {
    if (!this.worker) {
      this.worker = new Worker(new URL('../hint/hintWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<HintWorkerOut>) => this.done(e.data);
    }
    const id = ++this.jobId;
    this.running = { id, sig: this.signature(), visibleMs: 0, last: performance.now(), asked: false };
    this.worker.postMessage({ type: 'start', id, problem });
    if (document.visibilityState !== 'visible') this.worker.postMessage({ type: 'pause' });
    this.say(S.hintComputing, [], true);
    this.busyChanged(true);
    this.tick = window.setInterval(() => this.check(), 250);
  }

  /** 見えている時間だけを数え、2 秒で問い、5 分で中断する */
  private check(): void {
    const r = this.running;
    if (!r) return;
    const now = performance.now();
    if (document.visibilityState === 'visible') r.visibleMs += now - r.last;
    r.last = now;
    if (r.visibleMs >= LIMIT_MS) {
      this.stop();
      this.say(S.hintTimeout);
    } else if (r.visibleMs >= ASK_MS && !r.asked) {
      r.asked = true;
      this.ask();
    }
  }

  private ask(): void {
    this.say(S.hintBusy, [
      { label: S.hintStop, primary: true, fn: () => { this.stop(); this.hideToast(); } },
      { label: S.hintContinue, fn: () => this.say(S.hintComputing, [], true) },
    ], true);
  }

  private visibility(): void {
    const r = this.running;
    if (!r || !this.worker) return;
    if (document.visibilityState === 'visible') {
      r.last = performance.now();
      this.worker.postMessage({ type: 'resume' });
    } else {
      this.check();
      this.worker.postMessage({ type: 'pause' });
    }
  }

  private done(m: HintWorkerOut): void {
    const r = this.running;
    if (!r || m.id !== r.id) return;
    const sameBoard = r.sig === this.signature();
    this.stop();
    if (!sameBoard) return;
    if (m.result.status === 'none') { this.say(S.hintNone); return; }
    const pl = chooseHint(this.game, m.result.placements);
    this.hideToast();
    if (pl) this.apply(pl);
  }

  /** 計算をやめる（盤面は何も変えない。§8.2 フォールバックなし） */
  stop(): void {
    if (!this.running) return;
    this.running = null;
    this.worker?.postMessage({ type: 'stop' });
    clearInterval(this.tick);
    this.hideToast();
    this.busyChanged(false);
  }

  // ── 盤面の下に出す短い知らせ

  private say(text: string, buttons: Array<{ label: string; primary?: boolean; fn: () => void }> = [], sticky = false): void {
    clearTimeout(this.hideTimer);
    this.toast.replaceChildren();
    const p = document.createElement('span');
    p.textContent = text;
    this.toast.append(p);
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.addEventListener('click', b.fn);
      this.toast.append(el);
    }
    this.toast.classList.toggle('busy', sticky && !buttons.length);
    this.toast.hidden = false;
    if (!sticky) this.hideTimer = window.setTimeout(() => this.hideToast(), 4000);
  }

  private hideToast(): void {
    clearTimeout(this.hideTimer);
    this.toast.hidden = true;
  }
}
