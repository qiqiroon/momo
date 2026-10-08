// npm run selfplay [局数] [種の頭]
// 例）npm run selfplay -- 1000 test
// 失敗したら、表示された種をそのまま playOne(種) に渡すと同じ対局が再現できる。

import { runSelfplay } from './run';

const games = Number(process.argv[2] ?? 500);
const prefix = process.argv[3] ?? 'selfplay';

const started = Date.now();
const r = runSelfplay(games, prefix);
const ms = Date.now() - started;

console.log(`回した対局 ${r.games}・見張った出来事 ${r.events}・失敗 ${r.failures.length}（${ms} ms）`);
console.log(`終わり方：ツモアガリ ${r.endings.tsumo}・ロン ${r.endings.ron}（2人以上 ${r.paths.doubleRon}）・流局 ${r.endings.exhaust}・3人ロンで流局 ${r.endings.tripleRon}・途中で止まった ${r.endings.unfinished}`);
console.log(`見逃しのフリテンが起きた局：${r.paths.missed}`);
const p = r.paths;
console.log(`流局のテンパイの人数：${p.tenpaiCounts.map((n, i) => `${i}人 ${n}`).join('・')}`);
console.log(`通った道：リーチ ${p.riichi}（ダブル立直のアガリ ${p.double}）・リーチでのツモ ${p.riichiWin}・一発 ${p.ippatsu}・裏ドラが乗った ${p.ura}`);
if (r.games === 0 || r.events === 0) {
  console.log('★1件も回っていない＝検査になっていない');
  process.exitCode = 1;
}
for (const f of r.failures.slice(0, 5)) {
  console.log(`  失敗：種 ${f.seed}・通し番号 ${f.seq}`);
  for (const reason of f.reasons) console.log(`    ${reason}`);
}
if (r.failures.length) process.exitCode = 1;
