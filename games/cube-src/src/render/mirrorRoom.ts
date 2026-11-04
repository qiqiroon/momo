// 仮想鏡：3D 空間に置いた本物の平面鏡 3 枚（設計 03 §4。2026-11-01 利用者の指示で作り直し）
//
// 外部仕様：キューブは手元で回すもの。鏡は部屋（画面）に固定してあり、キューブの
// 左・下・奥に、部屋の角のように突き合わせて立っている。手前からその角をのぞき込む。
//
// 映り方は平面鏡の計算そのもの（光線追跡はしない）：three の Reflector が、
// 本体カメラを鏡の面で裏返した仮想カメラで、鏡の向こう側だけ（斜めの切り取り面）を描き、
// それを鏡の板に貼る。
//
// パズルとしての見やすさのため（2026-11-01 利用者の指示）：
// - 反射は 1 回だけ。鏡を描く間はほかの鏡を隠し、鏡どうしの映し合い（2 回・3 回反射の像）を出さない。
//   像は左上（左の鏡）・右上（奥の鏡）・下（床の鏡）の 3 つだけになる
// - 鏡像は本体よりはっきり暗くして、見分けやすくする
// - 鏡はガラスに見せる（ごく薄い青み・少しぼかす。2026-11-04 作者）
import {
  Color, EdgesGeometry, Group, LinearSRGBColorSpace, LineBasicMaterial, LineSegments, PlaneGeometry, Quaternion, Vector3,
  type Object3D, type Scene,
} from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FACES, FACE_NORMAL, type Axis, type Face } from '../core/types';
import { CUBE_WORLD_SIZE } from './cubeView';

/** キューブの外接球の半径（回しても角がこの球の外へは出ない） */
export const CUBE_RADIUS = (CUBE_WORLD_SIZE * Math.sqrt(3)) / 2;
/** キューブの中心から鏡の面までの距離。回しても角が鏡に当たらない */
export const MIRROR_DISTANCE = CUBE_RADIUS + 0.75;
/** 鏡の板の広がり：奥側の端は角（−D）、手前側は +FAR まで */
const MIRROR_FAR = MIRROR_DISTANCE * 2;
/**
 * 鏡像の明るさ（リニアの値に掛ける割合）。0.26 は見た目（sRGB）でおよそ 5 割強の明るさ
 * （前は 0.3＝およそ 6 割。2026-11-04 作者「あとほんのちょっと暗く」）。
 * 色の比はそのままなので、黄が橙に寄るなど色合いは変わらない。
 * 16 進（sRGB）で渡すとリニアへ直されて値が変わるので、リニアで直接渡す
 */
const MIRROR_BRIGHTNESS = 0.26;
const MIRROR_COLOR = new Color().setRGB(MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS, LinearSRGBColorSpace);

/**
 * three の Reflector の絵の貼り方を「重ね焼き」から「掛け算」に替えたもの。
 * 重ね焼きでは明るいところ（白など）がほとんど暗くならず、本体と見分けにくかった
 */
// ReflectorShader は three の実体にあるが、@types/three に型が無い
const BASE_SHADER = (Reflector as unknown as { ReflectorShader: Record<string, unknown> }).ReflectorShader;
/**
 * 鏡はガラスに見せる（2026-11-04 作者：鏡に映ったキューブが実体に見えてしまう。4 案から「ガラス」を選んだ。
 * そのあと「ゆがみはやめて少しぼやけさせる・真ん中の三角〔光の筋〕は消す・青は 5 分の 1 に」）。
 * 像にごく薄い青みを足し、少しぼかす（鏡の面に斜めの線を入れる案も試したが、不自然なのでやめた）
 */
/** ぼかしの半径（画面の px） */
export const MIRROR_BLUR_PX = 1.2;

const MIRROR_SHADER = {
  ...BASE_SHADER,
  uniforms: {
    ...(BASE_SHADER.uniforms as Record<string, unknown>),
    /** ぼかしの半径（鏡に貼る絵の上での割合 x, y） */
    blur: { value: [0, 0] },
  },
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec2 blur;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      // 少しぼかす：まわり 8 か所と真ん中を重みを付けて混ぜる
      vec2 p = vUv.xy / vUv.w;
      vec3 c = texture2D(tDiffuse, p).rgb * 0.25;
      c += (texture2D(tDiffuse, p + vec2(blur.x, 0.0)).rgb + texture2D(tDiffuse, p - vec2(blur.x, 0.0)).rgb
          + texture2D(tDiffuse, p + vec2(0.0, blur.y)).rgb + texture2D(tDiffuse, p - vec2(0.0, blur.y)).rgb) * 0.125;
      c += (texture2D(tDiffuse, p + blur).rgb + texture2D(tDiffuse, p - blur).rgb
          + texture2D(tDiffuse, p + vec2(blur.x, -blur.y)).rgb + texture2D(tDiffuse, p - vec2(blur.x, -blur.y)).rgb) * 0.0625;
      c *= color;
      // ごく薄い青み（最初の案の 5 分の 1）
      c = c * vec3(0.924, 0.972, 1.09) + vec3(0.0008, 0.0024, 0.006);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** ホームのときの鏡の面の法線（キューブの方を向く）。x＝左の壁、y＝床、z＝奥の壁 */
export const MIRROR_NORMAL: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

export const MIRROR_LABEL: Record<Axis, string> = { x: '左の鏡', y: '下の鏡', z: '奥の鏡' };

/**
 * 点 p の、鏡 axis（ホームの部屋の座標）での像。平面鏡の像は面で折り返した位置にできる：
 * p' = p − 2 (p·n + D) n
 */
export function mirrorImage(p: Vector3, axis: Axis): Vector3 {
  const n = MIRROR_NORMAL[axis];
  return p.clone().addScaledVector(n, -2 * (p.dot(n) + MIRROR_DISTANCE));
}

/** 鏡の面の法線（世界座標）。鏡は画面に固定なので、キューブが Δ だけ回って見えるとき世界では Δ⁻¹ */
export function mirrorNormal(delta: Quaternion, axis: Axis): Vector3 {
  return MIRROR_NORMAL[axis].clone().applyQuaternion(delta.clone().invert());
}

/** その鏡にいちばん正面から映っているキューブの面（鏡の方を向いている面） */
export function mirrorFaceOf(delta: Quaternion, axis: Axis): Face {
  const towardMirror = mirrorNormal(delta, axis).negate();
  let best: Face = FACES[0];
  let bestDot = -Infinity;
  for (const f of FACES) {
    const d = towardMirror.dot(new Vector3(...FACE_NORMAL[f]));
    if (d > bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

/** 狭い画面で、鏡の像のうち必ず写す範囲の半径（像の手前の面＝鏡の方を向いた面のまわり） */
/** （2026-11-04 作者：スマホでは左右の鏡の像が少し欠けてもよいので、キューブを大きく。1.15 → 0.5） */
const COMPACT_IMAGE_RADIUS = (CUBE_WORLD_SIZE / 2) * 0.5;

/**
 * 本体のカメラに写したい球（キューブと、鏡 3 枚に映る像）。ホームの部屋の座標。
 * compact（携帯などの狭い画面。2026-11-02 作者）：像は丸ごとでなく、鏡の方を向いた面（キューブの対面の面）の
 * まわりだけを収める。像の奥側は画面の外へ欠けてよく、その分キューブを大きく写す
 */
export function framingSpheres(compact = false): { center: Vector3; radius: number }[] {
  const origin = new Vector3();
  const images = (['x', 'y', 'z'] as const).map((a) => {
    const center = mirrorImage(origin, a);
    if (!compact) return { center, radius: CUBE_RADIUS };
    // 像の、鏡に近い側の面の中心（像の中心から鏡の方へ半辺）
    return { center: center.addScaledVector(MIRROR_NORMAL[a], CUBE_WORLD_SIZE / 2), radius: COMPACT_IMAGE_RADIUS };
  });
  return [{ center: origin, radius: CUBE_RADIUS }, ...images];
}

export class MirrorRoom {
  /** 鏡 3 枚をまとめた部屋。画面に固定するため、毎フレーム Δ⁻¹ だけ回す */
  private readonly room = new Group();
  private readonly mirrors: Reflector[] = [];
  private readonly inv = new Quaternion();
  private readonly notReflected: () => Object3D[];

  /** notReflected：鏡に映さないもの（毎回呼んで、その時に出ているものだけ隠す） */
  constructor(scene: Scene, notReflected: () => Object3D[] = () => []) {
    this.notReflected = notReflected;
    const D = MIRROR_DISTANCE;
    const size = D + MIRROR_FAR;
    const mid = (MIRROR_FAR - D) / 2;
    const plane = new PlaneGeometry(size, size);
    const edges = new EdgesGeometry(plane);
    const edgeMat = new LineBasicMaterial({ color: 0x5a6068 });

    // PlaneGeometry の表は +z。各鏡の表をキューブの方へ向ける
    const place: Record<Axis, (o: Group) => void> = {
      x: (o) => { o.position.set(-D, mid, mid); o.rotation.y = Math.PI / 2; },
      y: (o) => { o.position.set(mid, -D, mid); o.rotation.x = -Math.PI / 2; },
      z: (o) => { o.position.set(mid, mid, -D); },
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      const holder = new Group();
      place[axis](holder);
      const mirror = new Reflector(plane, {
        color: MIRROR_COLOR, shader: MIRROR_SHADER, textureWidth: 1024, textureHeight: 1024, clipBias: 0.003,
      });
      mirror.name = MIRROR_LABEL[axis];
      const frame = new LineSegments(edges, edgeMat);
      frame.position.z = 0.002;
      holder.add(mirror, frame);
      this.room.add(holder);
      this.mirrors.push(mirror);
    }
    // 反射は 1 回だけ：ある鏡を描き込む間は、ほかの鏡を隠す（鏡どうしの映し合いを出さない）。
    // 鏡に映さないもの（矢印など）も同じ間だけ隠す
    for (const mirror of this.mirrors) {
      const original = mirror.onBeforeRender.bind(mirror);
      const others = this.mirrors.filter((m) => m !== mirror);
      mirror.onBeforeRender = (...args) => {
        const hidden = [...others, ...this.notReflected().filter((o) => o.visible)];
        for (const o of hidden) o.visible = false;
        original(...args);
        for (const o of hidden) o.visible = true;
      };
    }
    scene.add(this.room);
  }

  private uniforms(mirror: Reflector): Record<string, { value: unknown }> {
    return (mirror.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
  }

  /** 鏡を出す・消す（設定。消しているあいだは鏡の絵も描かない） */
  get visible(): boolean {
    return this.room.visible;
  }

  set visible(v: boolean) {
    this.room.visible = v;
  }

  /** 鏡に貼る絵の解像度。画面の画素数に合わせる（pixelRatio：画面の 1px が何画素か。ぼかしの幅に使う） */
  setResolution(width: number, height: number, pixelRatio = 1, blurPx = MIRROR_BLUR_PX): void {
    const blur = [(blurPx * pixelRatio) / Math.max(1, width), (blurPx * pixelRatio) / Math.max(1, height)];
    for (const m of this.mirrors) {
      m.getRenderTarget().setSize(width, height);
      this.uniforms(m).blur.value = blur;
    }
  }

  /** delta＝キューブの見た目の回り具合 Δ。部屋（鏡）を画面に固定する */
  follow(delta: Quaternion): void {
    this.room.quaternion.copy(this.inv.copy(delta).invert());
    this.room.updateMatrixWorld(true);
  }

  dispose(): void {
    for (const m of this.mirrors) m.dispose();
    this.room.removeFromParent();
  }
}
