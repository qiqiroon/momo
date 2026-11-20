// MOMO Life — 対戦モードの裏方（セッション11）。コンピュータの考え（盤の一部を少し先まで動かす試し）で画面が止まらないように、
// 対戦の中身（life-battle.js の Battle）はここに置く。画面からは 1 秒に 1 回、読み戻した盤が届く
import { Battle, battleRules, outline } from './life-battle.js';

let b = null;
const reply = (msg, tr = []) => postMessage(msg, tr);
function view() {
  // あなたの置ける範囲（画面で、置けるかどうかの色分けに使う）と、その縁の線
  const d = b.field ? b.field.dist(b.player) : null;
  const dist = d ? d.slice() : null;
  const seg = d ? outline(d, b.W, b.H, b.wrap, b.cfg.range) : null;
  return { dist, seg };
}
onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    const r = battleRules(m.S, m.rule);
    if (!r.ok) { reply({ type: 'error', msg: r.msg, field: r.field }); return; }
    b = new Battle({ W: m.W, H: m.H, wrap: m.wrap, S: m.S, seed: m.seed, rules: r.rules });
    b.id = m.id;
    const cells = b.initialCells();
    reply({ type: 'init', id: m.id, cells, starts: b.starts, st: b.states() }, [cells.buffer]);
  } else if (!b || m.id !== undefined && m.id !== b.id) {
    // 作り直す前の対戦あての知らせは捨てる
  } else if (m.type === 'tick') {
    const writes = b.tick(m.cells, m.gen);
    const v = view();
    reply({ type: 'tick', id: b.id, gen: m.gen, writes, st: b.states(), result: b.result, ...v }, [v.dist?.buffer, v.seg?.buffer].filter(Boolean));
  } else if (m.type === 'place') {
    const r = b.place(m.rows, m.x0, m.y0);
    reply({ type: 'place', id: b.id, ...r, st: b.states() });
  }
};
