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
console.log(`終わり方：ツモアガリ ${r.endings.tsumo}・ロン ${r.endings.ron}（2人以上 ${r.paths.doubleRon}）・流局 ${r.endings.exhaust}・3人ロンで流局 ${r.endings.tripleRon}・途中流局 ${r.endings.abort}・途中で止まった ${r.endings.unfinished}`);
console.log(`見逃しのフリテンが起きた局：${r.paths.missed}`);
console.log(`鳴き：${r.paths.calls} 回（うちチー ${r.paths.chi}）・鳴いた手のアガリ ${r.paths.openWin}`);
const p = r.paths;
console.log(`流局のテンパイの人数：${p.tenpaiCounts.map((n, i) => `${i}人 ${n}`).join('・')}`);
console.log(`同じ牌に2人以上が宣言：${p.clash.total} 回（ロンが勝った ${p.clash.ronWon}・ポン/カンが勝った ${p.clash.ponWon}・チーが負けた ${p.clash.chiLost}）`);
console.log(`途中流局の内訳：${Object.entries(p.aborts).map(([k, n]) => `${k} ${n}`).join('・') || 'なし'}・喰い替えで切れない牌を持って切った回数 ${p.kuikaeBanned}`);
const k = p.kan;
console.log(`カン：暗槓 ${k.ankan}（リーチのあと ${k.riichiAnkan}）・加槓 ${k.kakan}・大明槓 ${k.minkan}・カンドラ ${k.kanDora} 枚・嶺上開花 ${k.rinshanWin}・槍槓 ${k.chankan}・4回カンした局 ${k.fourKans}`);
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
