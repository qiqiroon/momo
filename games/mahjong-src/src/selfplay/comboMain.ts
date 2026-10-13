// 中国式の組み合わせの自動対局（2026-10-13 第16）：3 つのセットから項目をでたらめに変え（同時に成り立ってはいけない組み合わせは除く）、
// 半荘ぶんを打って止まらないか・見張り役に引っかからないかを見る。npm run combo -- 組み合わせの数 対局数 種
import { CN_RULE_ITEMS, CN_SETS, cnConsistent, rulesOfCnSet } from '../engine/ruleSets';
import { runGames } from './run';
import { createRng } from '../engine/rng';
const n = Number(process.argv[2] ?? 60);
const games = Number(process.argv[3] ?? 1);
const rng = createRng('combo-' + (process.argv[4] ?? '1'));
const fails: string[] = [];
let done = 0;
for (let i = 0; i < n; i++) {
  const base = CN_SETS[i % 3];
  const r = rulesOfCnSet(base);
  if (r.family !== 'cn') throw 0;
  let v: Record<string, string>;
  do {
    v = { ...r.values };
    for (const it of CN_RULE_ITEMS) if (rng() < 0.35) v[it.k] = it.opts[Math.floor(rng() * it.opts.length)][0];
  } while (!cnConsistent(v as never));
  const diff = CN_RULE_ITEMS.filter((it) => v[it.k] !== r.values[it.k]).map((it) => `${it.k}=${v[it.k]}`).join(' ');
  try {
    const res = runGames(games, `c${i}`, { family: 'cn', values: v as never });
    done++;
    if (res.failures.length) fails.push(`${base} ${diff} :: ${JSON.stringify(res.failures[0]).slice(0, 300)}`);
  } catch (e) {
    fails.push(`${base} ${diff} :: 例外 ${(e as Error).message.slice(0, 200)}`);
  }
}
console.log(`組み合わせ ${n}・終わった ${done}・失敗 ${fails.length}`);
for (const f of fails.slice(0, 25)) console.log(f);
