/**
 * 強さ比べの実行口 (★v1.93・開発用・アプリには載らない)。`npm run selfplay` で走る。
 *
 * 1 局に数分かかるので、**出だしごとに子の走り手へ手分けして並べて走らせる**。
 * 親は子を起こして 1 局ずつの記録 (JSON) を受け取り、全部そろったら集計する
 * (集計は harness.ts の summarize だけ＝数え方を 2 か所に持たない)。
 *
 * 条件は環境変数で渡す (省略時は既定)。
 *   SP_MODE      shogi | quantum            (既定 shogi)
 *   SP_A / SP_B  比べる 2 つの設定の名前    (既定 base / base＝同じもの同士＝物差しの確かめ)
 *   SP_OPENINGS  出だしの数 (×2 局)         (既定 20)
 *   SP_NODES     1 手に読む局面の数          (既定 本将棋 5000 / 量子 1500)
 *   SP_NODES_A / SP_NODES_B  片方だけ読む量を変える (読む量の差が強さにどれだけ効くかを測る)
 *   SP_PLIES     手数の上限                  (既定 300)
 *   SP_SEED      出だしの種の始まり          (既定 1)
 *   SP_JOBS      並べて走らせる数            (既定 8)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import '../features/quantum';
import { hondou } from '../core/engine/mgf/loader';
import { initPosition } from '../core/engine/position/init';
import { quantumInit } from '../features/quantum/init';
import type { AdvanceRules } from '../core/engine/position/advance';
import type { SearchOptions } from '../adapters/selfmade-alphabeta/search';
import { alphaBetaPlayer, playPair, summarize, type GameRecord } from './harness';

/**
 * 比べる設定の一覧。改良を足したら、その入り・切りをここに名前で並べる
 * (探索の設定を差し替えるだけで、探索そのものは同じもの)。
 */
const VARIANTS: Record<string, Partial<SearchOptions>> = {
  base: {},
  tt: { features: { tt: true } },
  killers: { features: { killers: true } },
  check: { features: { checkExtension: true } },
  mate: { features: { mateSearch: true } },
  all: { features: { tt: true, killers: true, checkExtension: true, mateSearch: true } },
  /** 量子の案 A＝駒の値打ちを候補の平均 (期待値) で数える (＋全部入り)。 */
  mean: { features: { tt: true, killers: true, checkExtension: true, mateSearch: true, quantumMeanValue: true } },
  /** 量子の案 B＝まだ王でありうる自分の駒が少ないほど減点する (＋全部入り)。 */
  kingsafe: { features: { tt: true, killers: true, checkExtension: true, mateSearch: true, quantumKingSafety: true } },
};

const env = process.env;
const mode = env.SP_MODE ?? 'shogi';
const quantum = mode === 'quantum';
const nodes = Number(env.SP_NODES ?? (quantum ? 1500 : 5000));
const nodesA = Number(env.SP_NODES_A ?? nodes);
const nodesB = Number(env.SP_NODES_B ?? nodes);
const aName = env.SP_A ?? 'base';
const bName = env.SP_B ?? 'base';
const openings = Number(env.SP_OPENINGS ?? 20);
const maxPlies = Number(env.SP_PLIES ?? 300);
const seedBase = Number(env.SP_SEED ?? 1);
const jobs = Math.max(1, Math.min(Number(env.SP_JOBS ?? 8), openings));

for (const name of [aName, bName]) {
  if (!VARIANTS[name]) throw new Error(`設定 ${name} が無い (${Object.keys(VARIANTS).join(', ')})`);
}

/** 子の仕事＝割り当てられた出だしを指して、1 局ごとに記録を 1 行で出す。 */
function runShard(shard: number, shards: number): void {
  const rules: AdvanceRules = { quantum };
  const initial = quantum ? quantumInit(initPosition(hondou)) : initPosition(hondou);
  const a = alphaBetaPlayer(hondou, rules, nodesA, VARIANTS[aName]);
  const b = alphaBetaPlayer(hondou, rules, nodesB, VARIANTS[bName]);
  for (let o = shard; o < openings; o += shards) {
    for (const rec of playPair({ mgf: hondou, rules, initial, a, b, opening: seedBase + o, openingPlies: 4, maxPlies })) {
      process.stdout.write(`SPJSON ${JSON.stringify(rec)}\n`);
    }
  }
}

/** 親の仕事＝子を起こして記録を集め、集計を出す。 */
async function runParent(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..', '..');
  const viteNode = resolve(root, 'node_modules', 'vite-node', 'vite-node.mjs');
  const self = resolve(here, 'match.ts');
  const records: GameRecord[] = [];
  const total = openings * 2;
  const t0 = Date.now();
  console.log(`==== ${mode}  A=${aName}  B=${bName}  局面数/手=${nodesA === nodesB ? nodes : `A${nodesA}・B${nodesB}`}  ${total}局  ${jobs}並列`);

  await Promise.all(
    Array.from({ length: jobs }, (_, shard) =>
      new Promise<void>((done, fail) => {
        const child = spawn(process.execPath, [viteNode, self], {
          cwd: root,
          env: { ...env, SP_SHARD: String(shard), SP_SHARDS: String(jobs) },
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        let buf = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('SPJSON ')) continue;
            const rec = JSON.parse(line.slice(7)) as GameRecord;
            records.push(rec);
            const mark = rec.aScore === 1 ? '勝' : rec.aScore === 0 ? '負' : '分';
            const sec = ((Date.now() - t0) / 1000).toFixed(0);
            console.log(`局 ${records.length}/${total}  出だし${rec.opening} A=${rec.aIsP1 ? '先' : '後'} ${mark} ${rec.end} ${rec.plies}手  (${sec}秒)`);
          }
        });
        child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`子 ${shard} が ${code} で終わった`))));
      }),
    ),
  );

  const r = summarize(records);
  const pct = (x: number) => (x * 100).toFixed(1);
  console.log(
    [
      `==== 結果 ${mode}  A=${aName}  B=${bName}  局面数/手=${nodesA === nodesB ? nodes : `A${nodesA}・B${nodesB}`}  ${r.games}局  ${((Date.now() - t0) / 1000).toFixed(0)}秒`,
      `A の成績 ${r.wins}勝 ${r.draws}分 ${r.losses}敗  得点率 ${pct(r.score)}% (±${pct(r.margin)})`,
      `終わり方 ${Object.entries(r.ends).map(([k, v]) => `${k}=${v}`).join(' ')}  平均 ${r.avgPlies.toFixed(0)}手`,
      `A 深さ${r.a.depth.toFixed(2)} 局面${r.a.nodes.toFixed(0)} ${r.a.ms.toFixed(0)}ms/手   B 深さ${r.b.depth.toFixed(2)} 局面${r.b.nodes.toFixed(0)} ${r.b.ms.toFixed(0)}ms/手`,
    ].join('\n'),
  );
}

if (env.SP_SHARD !== undefined) runShard(Number(env.SP_SHARD), Number(env.SP_SHARDS ?? 1));
else await runParent();
