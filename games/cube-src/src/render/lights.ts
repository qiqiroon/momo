// 照明（設計 03 §1）。照明は画面（部屋）に固定する：
// 全体の回転は中ではカメラが回る形なので、照明を世界に置くと、回して上に向けた面が暗いままになる。
// ホームのときに設計どおりの位置になるよう、見た目の回り具合 Δ の逆で照明を回す。
// 鏡に映る面（キューブの左・下・奥）も読めるよう、反対側からの起こし光を設計より強めにしてある
import { DirectionalLight, HemisphereLight, Quaternion, Vector3, type Scene } from 'three';

// 強さは設計 03 §1 の値を基準に、three r155 以降の物理単位に合わせて π 倍する
const SKY = new Vector3(0, 1, 0);
const KEY = new Vector3(5, 8, 6);
// 設計 03 §1 は (-6,-4,-5)。下の面に浅くしか当たらず、床の鏡で黄が橙に見えたので下寄りにした
const FILL = new Vector3(-5, -7, -5);

export class Lights {
  // 下からの照り返し（地の色）を明るめにして、床の鏡に映る下の面も読めるようにする
  private readonly hemi = new HemisphereLight(0xffffff, 0xb4b4bc, 0.6 * Math.PI);
  private readonly key = new DirectionalLight(0xffffff, 0.7 * Math.PI);
  // 鏡の側（左・下・奥）から当てる光。画面で見えている 3 面には当たらない
  private readonly fill = new DirectionalLight(0xffffff, 0.95 * Math.PI);
  private readonly inv = new Quaternion();

  constructor(scene: Scene) {
    // DirectionalLight の向きは「位置 → 目標（原点）」。目標は既定で原点のまま
    scene.add(this.hemi, this.key, this.fill);
    this.follow(new Quaternion());
  }

  /** delta＝見た目の回り具合 Δ（ホームで恒等）。照明を Δ⁻¹ で回し、画面に対する向きを保つ */
  follow(delta: Quaternion): void {
    this.inv.copy(delta).invert();
    this.hemi.position.copy(SKY).applyQuaternion(this.inv);
    this.key.position.copy(KEY).applyQuaternion(this.inv);
    this.fill.position.copy(FILL).applyQuaternion(this.inv);
    for (const l of [this.hemi, this.key, this.fill]) l.updateMatrixWorld();
  }
}
