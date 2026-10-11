// npm run arena -- 打ち手A 打ち手B [種の組の数] [種の頭]
// 例）npm run arena -- bench tsumogiri 50
// 同じ種で席を入れ替えて 2 回ずつ打つ＝対局数は「組の数×2」。打ち手の名前は PLAYERS を見る。

import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { arena, arenaReport } from './arena';
import type { Player } from './run';

const PLAYERS: Record<string, Player> = {
  tsumogiri: tsumogiriCpu,
  bench: benchCpu,
};

const [nameA = 'bench', nameB = 'tsumogiri', pairsArg = '20', prefix = 'arena'] = process.argv.slice(2);
const a = PLAYERS[nameA];
const b = PLAYERS[nameB];
if (!a || !b) {
  console.error(`打ち手の名前は ${Object.keys(PLAYERS).join(' / ')} のどれか`);
  process.exit(1);
}
const t0 = Date.now();
const r = arena(a, b, Number(pairsArg), prefix);
for (const l of arenaReport(r, nameA, nameB)) console.log(l);
console.log(`かかった時間 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.failures.length > 0 || r.games === 0) process.exit(1);