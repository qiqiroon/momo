// 適応的品質（設計 03 §7.1）：重ければ画素の細かさ（pixelRatio）を 1 段ずつ下げ、軽くなったら戻す
// 描くのは変化があるときだけなので、描画が続いたフレームどうしの間隔だけを数える（止まっている間は測らない）
import type { Quality } from '../ui/settings';

/** 下げるときの段（上限は端末の画素比と、スマホでは 1.5 で切る） */
const STEPS = [2, 1.5, 1] as const;
const SLOW_MS = 22;
const FAST_MS = 13;
/** これより重いままなら、鏡を消す案内を出す */
const VERY_SLOW_MS = 28;
const WINDOW = 60;
const RECOVER_FRAMES = 180;

export class AdaptiveQuality {
  private readonly maxRatio: number;
  private quality: Quality = 'auto';
  private step = 0;
  private samples: number[] = [];
  private fastRun = 0;
  /** 一番低い段でも重い（鏡を消す案内の合図）。一度立てたら下ろさない */
  private _verySlow = false;

  /** deviceRatio：window.devicePixelRatio。coarse：指で触る端末 */
  constructor(deviceRatio: number, coarse: boolean) {
    this.maxRatio = Math.min(deviceRatio, coarse ? 1.5 : 2);
    this.step = this.firstStep();
  }

  get pixelRatio(): number {
    if (this.quality === 'low') return Math.min(this.maxRatio, 1);
    if (this.quality === 'high') return this.maxRatio;
    return Math.min(this.maxRatio, STEPS[this.step]);
  }

  get verySlow(): boolean {
    return this._verySlow;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.step = this.firstStep();
    this.samples = [];
    this.fastRun = 0;
  }

  /**
   * 続けて描いた 2 フレームの間隔（ms）を渡す。画素比が変わったら true（描く大きさを作り直す）
   */
  sample(frameMs: number): boolean {
    if (this.quality !== 'auto') return false;
    this.samples.push(frameMs);
    if (this.samples.length > WINDOW) this.samples.shift();
    this.fastRun = frameMs < FAST_MS ? this.fastRun + 1 : 0;
    if (this.samples.length === WINDOW) {
      const avg = this.samples.reduce((a, b) => a + b, 0) / WINDOW;
      if (avg > SLOW_MS && this.step < STEPS.length - 1) return this.move(1);
      if (avg > VERY_SLOW_MS && this.step === STEPS.length - 1) this._verySlow = true;
    }
    if (this.fastRun >= RECOVER_FRAMES && this.step > this.firstStep()) return this.move(-1);
    return false;
  }

  private move(d: number): boolean {
    const before = this.pixelRatio;
    this.step += d;
    this.samples = [];
    this.fastRun = 0;
    return this.pixelRatio !== before;
  }

  /** 上限より細かい段は飛ばす（画素比 1 の端末は最初から 1） */
  private firstStep(): number {
    const i = STEPS.findIndex((s) => s <= this.maxRatio);
    return i < 0 ? STEPS.length - 1 : i;
  }
}
