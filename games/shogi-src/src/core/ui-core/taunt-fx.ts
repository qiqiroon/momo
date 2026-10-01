/**
 * ★v1.96 威嚇の動き (ユーザー判断 2026-10-01・見本＝作業側 docs/mocks/momo_shogi_taunt_anim_mock_v1.html)。
 *
 * 威嚇つきで指した手で、
 *   ① 指した駒を大きく持ち上げ (浮き上がって少し傾く)
 *   ② ぶるぶる震えてためを作り
 *   ③ 一気に叩きつける (着地でつぶれる)
 *   ④ 着地の瞬間に、音・盤の揺れ・閃光・衝撃の輪・土ぼこりを出し、
 *      **周り 8 マスの駒を風圧で盤の外へ吹き飛ばす** (くるくる回って跳ねながら転がり、消える)
 *   ⑤ 少し間を置いて、吹き飛んだ駒を元の位置にぽんと戻す
 *
 * **見た目の演出だけ**＝盤 (局面) は指した時点でもう新しい形になっている。ここは本物の駒を
 * 一時的に隠し、写しを演出の層 (画面全体に重ねた層) で動かすだけ。**途中で打ち切っても**
 * (次の手が来た・対局をやり直した)、写しを捨てて本物を見せ直せば本当の盤に戻る。
 *
 * 値は見本の既定値のまま (ユーザーが「これでよい」と確認した値)。
 */

/** 見本で確かめた値。 */
export const TAUNT_FX = {
  /** 持ち上げる高さ (マス何個分)。 */
  lift: 1.6,
  /** 持ち上げたときの大きさ (倍)。 */
  scale: 2.0,
  /** 持ち上げにかける時間 (ms)。 */
  liftMs: 380,
  /** ためる時間 (ms)。 */
  holdMs: 450,
  /** 叩きつけにかける時間 (ms)。 */
  slamMs: 110,
  /** 吹き飛ぶ強さ。 */
  power: 1.5,
  /** 盤の揺れの強さ。 */
  shake: 1.2,
  /** 吹き飛んだ駒が戻るまでの間 (ms・飛んでいる時間 1200ms の後)。 */
  backMs: 1500,
} as const;

/** 着地までの時間 (ms)。音はこの時刻に鳴らす。 */
export const TAUNT_IMPACT_MS = TAUNT_FX.liftMs + TAUNT_FX.holdMs + TAUNT_FX.slamMs;

/** 演出の全体の長さ (ms・戻りきるまで)。 */
export const TAUNT_TOTAL_MS = TAUNT_IMPACT_MS + 1200 + TAUNT_FX.backMs + 320 + 8 * 45;

export interface TauntFxInput {
  /** 盤 (`.board`) の要素。マスは `[data-sq="行,列"]` で探す。 */
  board: HTMLElement;
  /** 盤の外枠 (揺らす)。 */
  boardOuter: HTMLElement | null;
  /** 指した駒が元いたマス。打つ手は null (行き先の真上から叩きつける)。 */
  from: { row: number; col: number } | null;
  /** 行き先のマス。 */
  to: { row: number; col: number };
  /** 着地の瞬間に呼ぶ (音を鳴らす)。 */
  onImpact: () => void;
  /** 戻りきったら呼ぶ。 */
  onDone: () => void;
}

/** 本物の駒を隠す印。CSS (`.sq[data-taunt-hidden] > *`) が見えなくする。 */
const HIDDEN = 'data-taunt-hidden';

/**
 * 威嚇の動きを始める。**打ち切る関数を返す** (呼べば写しを捨てて本物を見せ直す)。
 * 盤のマスが見つからない (画面が無い・描画前) ときは何もせず、着地の合図だけすぐ出す
 * (音は必ず鳴る)。
 */
export function runTauntFx(input: TauntFxInput): () => void {
  const { board, boardOuter, from, to } = input;
  const square = (r: number, c: number) => board.querySelector<HTMLElement>(`[data-sq="${r},${c}"]`);
  const toSq = square(to.row, to.col);
  const toPc = toSq?.querySelector<HTMLElement>('.pc');
  if (!toSq || !toPc || typeof toPc.animate !== 'function') {
    input.onImpact();
    input.onDone();
    return () => {};
  }

  const layer = document.createElement('div');
  layer.className = 'taunt-fx-layer';
  // 駒の文字の大きさは盤の --cell で決まるので、写しにも同じ値を渡す。
  layer.style.setProperty('--cell', getComputedStyle(board).getPropertyValue('--cell'));
  document.body.appendChild(layer);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const hidden: HTMLElement[] = [];
  let finished = false;
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const hide = (el: HTMLElement) => {
    el.setAttribute(HIDDEN, '');
    hidden.push(el);
  };
  const show = (el: HTMLElement) => el.removeAttribute(HIDDEN);

  const cancel = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    hidden.forEach(show);
    layer.remove();
  };

  const toRect = toSq.getBoundingClientRect();
  const cell = toRect.width;
  const tcx = toRect.left + toRect.width / 2;
  const tcy = toRect.top + toRect.height / 2;

  /** 駒の写しを、指定の中心に作る。 */
  const cloneOf = (pc: HTMLElement, cx: number, cy: number) => {
    const r = pc.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'taunt-fx-piece';
    box.style.left = `${cx - r.width / 2}px`;
    box.style.top = `${cy - r.height / 2}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    // 後手の駒は .pc.gote が向きを持つ＝写しの外側では回さない (二重に回すと正立してしまう)。
    box.appendChild(pc.cloneNode(true));
    layer.appendChild(box);
    return { box, w: r.width, h: r.height };
  };
  const centerOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // ---- ① 持ち上げ ----
  const fromSq = from ? square(from.row, from.col) : null;
  const start = fromSq ? centerOf(fromSq) : { x: tcx, y: tcy };
  hide(toSq);
  const mover = cloneOf(toPc, start.x, start.y);
  const dx = tcx - start.x;
  const dy = tcy - start.y;
  const liftPx = TAUNT_FX.lift * cell;
  const S = TAUNT_FX.scale;
  const shadow = document.createElement('div');
  shadow.className = 'taunt-fx-shadow';
  const sw = mover.w * 0.9;
  shadow.style.left = `${start.x - sw / 2}px`;
  shadow.style.top = `${start.y + mover.h * 0.35 - sw * 0.22}px`;
  shadow.style.width = `${sw}px`;
  shadow.style.height = `${sw * 0.44}px`;
  layer.appendChild(shadow);

  mover.box.animate(
    [
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${dx * 0.6}px,${dy * 0.6 - liftPx * 1.1}px) scale(${S * 1.05}) rotate(-12deg)`, offset: 0.6 },
      { transform: `translate(${dx}px,${dy - liftPx}px) scale(${S}) rotate(-6deg)` },
    ],
    { duration: TAUNT_FX.liftMs, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
  );
  shadow.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 0.6 },
      { transform: `translate(${dx}px,${dy}px) scale(${0.55 + S * 0.15})`, opacity: 0.25 },
    ],
    { duration: TAUNT_FX.liftMs, easing: 'ease-out', fill: 'forwards' },
  );

  // ---- ② ためる ----
  later(TAUNT_FX.liftMs, () => {
    const n = Math.max(4, Math.round(TAUNT_FX.holdMs / 45));
    const kf: Keyframe[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = (i % 2 ? 1 : -1) * (2 + k * 4);
      const up = liftPx * (1 + 0.12 * k);
      kf.push({ transform: `translate(${dx + j}px,${dy - up}px) scale(${S * (1 + 0.06 * k)}) rotate(${-6 + j}deg)` });
    }
    mover.box.animate(kf, { duration: TAUNT_FX.holdMs, easing: 'linear', fill: 'forwards' });
  });

  // ---- ③ 叩きつけ ----
  later(TAUNT_FX.liftMs + TAUNT_FX.holdMs, () => {
    mover.box.animate(
      [
        { transform: `translate(${dx}px,${dy - liftPx * 1.12}px) scale(${S * 1.06}) rotate(-6deg)` },
        { transform: `translate(${dx}px,${dy}px) scale(1.25,0.72) rotate(0deg)` },
      ],
      { duration: TAUNT_FX.slamMs, easing: 'cubic-bezier(.75,0,1,.6)', fill: 'forwards' },
    );
    shadow.animate(
      [
        { transform: `translate(${dx}px,${dy}px) scale(${0.55 + S * 0.15})`, opacity: 0.25 },
        { transform: `translate(${dx}px,${dy}px) scale(1.2)`, opacity: 0.7 },
      ],
      { duration: TAUNT_FX.slamMs, fill: 'forwards' },
    );
  });

  // ---- ④ 着地 ----
  later(TAUNT_IMPACT_MS, () => {
    input.onImpact();
    mover.box.animate(
      [
        { transform: `translate(${dx}px,${dy}px) scale(1.25,0.72)` },
        { transform: `translate(${dx}px,${dy}px) scale(0.92,1.1)`, offset: 0.45 },
        { transform: `translate(${dx}px,${dy}px) scale(1)` },
      ],
      { duration: 260, easing: 'ease-out', fill: 'forwards' },
    );
    later(260, () => {
      mover.box.remove();
      shadow.remove();
      show(toSq);
    });

    if (boardOuter) {
      const a = 6 * TAUNT_FX.shake;
      const kf: Keyframe[] = [];
      for (let i = 0; i < 10; i++) {
        const f = 1 - i / 10;
        kf.push({
          transform: `translate(${(Math.random() * 2 - 1) * a * f}px,${(Math.random() * 2 - 1) * a * f}px) rotate(${(Math.random() * 2 - 1) * 0.8 * TAUNT_FX.shake * f}deg)`,
        });
      }
      kf.push({ transform: 'none' });
      boardOuter.animate(kf, { duration: 420, easing: 'linear' });
    }

    const flash = document.createElement('div');
    flash.className = 'taunt-fx-flash';
    const fw = cell * 4;
    Object.assign(flash.style, { left: `${tcx - fw / 2}px`, top: `${tcy - fw / 2}px`, width: `${fw}px`, height: `${fw}px` });
    layer.appendChild(flash);
    flash.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }], {
      duration: 320,
      easing: 'ease-out',
      fill: 'forwards',
    });
    for (const [delay, size] of [[0, cell * 0.9], [90, cell * 0.6]] as const) {
      const ring = document.createElement('div');
      ring.className = 'taunt-fx-ring';
      Object.assign(ring.style, { left: `${tcx - size / 2}px`, top: `${tcy - size / 2}px`, width: `${size}px`, height: `${size}px` });
      layer.appendChild(ring);
      ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: `scale(${3.5 + TAUNT_FX.power * 2})`, opacity: 0 }], {
        duration: 520,
        delay,
        easing: 'cubic-bezier(.1,.7,.3,1)',
        fill: 'forwards',
      });
    }
    for (let i = 0; i < 22; i++) {
      const d = document.createElement('div');
      d.className = 'taunt-fx-dust';
      const s = 3 + Math.random() * 7;
      Object.assign(d.style, { left: `${tcx - s / 2}px`, top: `${tcy - s / 2}px`, width: `${s}px`, height: `${s}px` });
      layer.appendChild(d);
      const ang = Math.random() * Math.PI * 2;
      const dist = cell * (0.8 + Math.random() * 1.8) * TAUNT_FX.power;
      d.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 0.9 },
          { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist}px) scale(.3)`, opacity: 0 },
        ],
        { duration: 500 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'forwards' },
      );
    }

    // 周り 8 マスの駒＝風圧で外へ。縦横は強く、斜めは少し弱い。転がりながら跳ねて盤の外へ消える。
    // 方向は画面の上での向き (盤を反転していても、行き先から見て外側へ飛ぶ)。
    const flown: HTMLElement[] = [];
    for (let r = to.row - 1; r <= to.row + 1; r++) {
      for (let c = to.col - 1; c <= to.col + 1; c++) {
        if (r === to.row && c === to.col) continue;
        const sq = square(r, c);
        const pc = sq?.querySelector<HTMLElement>('.pc');
        if (!sq || !pc) continue;
        const ctr = centerOf(sq);
        const vx = ctr.x - tcx;
        const vy = ctr.y - tcy;
        const len = Math.hypot(vx, vy) / cell;
        const ux = vx / (len * cell) + (Math.random() - 0.5) * 0.35;
        const uy = vy / (len * cell) + (Math.random() - 0.5) * 0.35;
        const dist = (cell * (7 + Math.random() * 3) * TAUNT_FX.power) / len;
        const spin = (Math.random() < 0.5 ? -1 : 1) * (540 + Math.random() * 540) * TAUNT_FX.power;
        hide(sq);
        flown.push(sq);
        const f = cloneOf(pc, ctr.x, ctr.y);
        const hops: [number, number][] = [[0, 1], [0.18, 1.7], [0.36, 1], [0.5, 1.35], [0.62, 1], [0.72, 1.15], [0.8, 1], [1, 1]];
        f.box.animate(
          hops.map(([k, s]) => {
            const e = 1 - Math.pow(1 - k, 2.2); // だんだん遅くなる (地面をこする)
            return {
              offset: k,
              transform: `translate(${ux * dist * e}px,${uy * dist * e}px) rotate(${spin * e}deg) scale(${s})`,
              opacity: k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1,
            };
          }),
          { duration: 1100 + Math.random() * 300, easing: 'linear', fill: 'forwards' },
        );
      }
    }

    // ---- ⑤ 元の位置にぽんと戻る ----
    later(1200 + TAUNT_FX.backMs, () => {
      layer.querySelectorAll('.taunt-fx-piece').forEach((el) => el.remove());
      flown.forEach((sq, i) => {
        show(sq);
        const pc = sq.querySelector<HTMLElement>('.pc');
        // 後手の駒は .pc.gote の回転を持つので、戻りの動きにも同じ回転を足す。
        const turn = pc?.classList.contains('gote') ? ' rotate(180deg)' : '';
        pc?.animate(
          [
            { transform: `scale(1.8)${turn}`, opacity: 0 },
            { transform: `scale(.9)${turn}`, opacity: 1, offset: 0.7 },
            { transform: `scale(1)${turn}`, opacity: 1 },
          ],
          { duration: 320, delay: i * 45, easing: 'ease-out', fill: 'backwards' },
        );
      });
      later(320 + flown.length * 45, () => {
        if (finished) return;
        finished = true;
        layer.remove();
        input.onDone();
      });
    });
  });

  return cancel;
}
