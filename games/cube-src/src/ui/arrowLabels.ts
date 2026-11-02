// 矢印の横のキーの札（設計 10 §3.3・05 §1.3）。DOM の重ね書き。中身は ArrowControls が逆引きする
// 位置は描くたびに矢印の先を画面へ写して決める。文字の書き換えは中身が変わったときだけ
import { Vector3, type PerspectiveCamera } from 'three';
import { FACE_NORMAL } from '../core/types';
import { arrowMetrics, dirFace, FACE_FRAME } from '../input/arrowActions';
import type { ArrowControls } from '../input/arrowControls';

/** 矢印の先から、矢印の向きへ札をずらす量（px） */
const OFFSET_PX = 12;

export class ArrowLabels {
  private readonly root: HTMLDivElement;
  private readonly controls: ArrowControls;
  private version = -1;
  private items: HTMLSpanElement[] = [];

  constructor(parent: HTMLElement, controls: ArrowControls) {
    this.controls = controls;
    this.root = document.createElement('div');
    this.root.className = 'arrow-labels';
    this.root.setAttribute('aria-hidden', 'true');
    parent.append(this.root);
  }

  /** 描くたびに呼ぶ。width・height は描く面の大きさ（CSS px） */
  update(camera: PerspectiveCamera, width: number, height: number): void {
    const sel = this.controls.selected;
    const { version, labels } = this.controls.labels();
    if (version !== this.version) {
      this.version = version;
      this.items = labels.map((l) => {
        const el = document.createElement('span');
        el.className = 'arrow-key';
        el.textContent = l.text;
        return el;
      });
      this.root.replaceChildren(...this.items);
    }
    if (!sel || labels.length === 0) {
      this.root.hidden = true;
      return;
    }
    const { face, n } = sel;
    const m = arrowMetrics(n);
    const N = new Vector3(...FACE_NORMAL[face]);
    // 本体から面が見えていなければ出さない（鏡の中の矢印には札を出さない）
    const toCamera = camera.position.clone().sub(N.clone().multiplyScalar(m.h));
    if (toCamera.dot(N) <= 0) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const U = new Vector3(...FACE_NORMAL[FACE_FRAME[face].u]);
    const V = new Vector3(...FACE_NORMAL[FACE_FRAME[face].v]);
    const toScreen = (p: Vector3) => {
      const q = p.clone().project(camera);
      return { x: ((q.x + 1) / 2) * width, y: ((1 - q.y) / 2) * height };
    };
    const center = toScreen(N.clone().multiplyScalar(m.h));
    labels.forEach((l, i) => {
      const a = l.layout;
      const base = N.clone().multiplyScalar(m.h + m.lift).addScaledVector(U, a.s).addScaledVector(V, a.t);
      let tip = base;
      let dx: number;
      let dy: number;
      if (a.dir) {
        // まっすぐな矢印：先の少し先へ
        const D = new Vector3(...FACE_NORMAL[dirFace(face, a.dir)]);
        tip = base.clone().addScaledVector(D, a.length / 2);
        const s0 = toScreen(tip);
        const s1 = toScreen(tip.clone().addScaledVector(D, 0.2));
        dx = s1.x - s0.x;
        dy = s1.y - s0.y;
      } else {
        // 曲がった矢印：面の中心から離れる向きへ
        const s0 = toScreen(base);
        dx = s0.x - center.x;
        dy = s0.y - center.y;
      }
      const p = toScreen(tip);
      const len = Math.hypot(dx, dy) || 1;
      const offset = a.dir ? OFFSET_PX : OFFSET_PX + 14;
      const el = this.items[i];
      el.style.transform =
        `translate(${(p.x + (dx / len) * offset).toFixed(1)}px, ${(p.y + (dy / len) * offset).toFixed(1)}px) translate(-50%, -50%)`;
    });
  }
}
