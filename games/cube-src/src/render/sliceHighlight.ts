// 選んだ層を半透明の枠で示す（設計 04 §6.2。要求仕様 §9「どの層を回しているのか明確に認識できる」）
// 箱 1 つの位置と大きさを変えて使い回す。表示中だけ描画命令が 2 つ増える
import {
  BoxGeometry, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  type Scene,
} from 'three';
import { AXIS_INDEX, type Move } from '../core/types';
import { CUBE_WORLD_SIZE } from './cubeView';

/** 表示してから消え始めるまで・消えきるまで（ms） */
const HOLD_MS = 1100;
const FADE_MS = 400;
const FILL_OPACITY = 0.22;
/** 層の厚み以外の方向に、キューブより少しはみ出させる */
const MARGIN = 0.12;

export class SliceHighlight {
  private readonly group = new Group();
  private readonly fill: MeshBasicMaterial;
  private readonly line: LineBasicMaterial;
  private age = Infinity;
  private hold = HOLD_MS;

  constructor(scene: Scene) {
    const box = new BoxGeometry(1, 1, 1);
    this.fill = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide,
    });
    this.line = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.group.add(new Mesh(box, this.fill), new LineSegments(new EdgesGeometry(box), this.line));
    this.group.visible = false;
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  /** move が回す層を示す。連続していない層組みは、両端を含む範囲で示す。holdMs は消え始めるまで */
  show(move: Move, holdMs = HOLD_MS): void {
    this.hold = holdMs;
    const unit = CUBE_WORLD_SIZE / move.n;
    let lo = -1;
    let hi = -1;
    for (let s = 0; s < move.n; s++) {
      if (move.slices & (1 << s)) {
        if (lo < 0) lo = s;
        hi = s;
      }
    }
    const k = AXIS_INDEX[move.axis];
    const size = [CUBE_WORLD_SIZE + MARGIN, CUBE_WORLD_SIZE + MARGIN, CUBE_WORLD_SIZE + MARGIN];
    const pos = [0, 0, 0];
    size[k] = (hi - lo + 1) * unit + MARGIN / 2;
    pos[k] = ((lo + hi + 1) / 2) * unit - CUBE_WORLD_SIZE / 2;
    this.group.scale.set(size[0], size[1], size[2]);
    this.group.position.set(pos[0], pos[1], pos[2]);
    this.age = 0;
    this.apply();
  }

  hide(): void {
    this.age = Infinity;
    this.apply();
  }

  /** 毎フレーム。見た目が変わったら true */
  update(dtMs: number): boolean {
    if (!this.group.visible) return false;
    this.age += dtMs;
    this.apply();
    return true;
  }

  private apply(): void {
    const t = this.age <= this.hold ? 1 : 1 - (this.age - this.hold) / FADE_MS;
    const a = Math.max(0, Math.min(1, t));
    this.group.visible = a > 0;
    this.fill.opacity = FILL_OPACITY * a;
    this.line.opacity = 0.85 * a;
  }
}
