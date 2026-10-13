// npm run selfplay [局数] [種の頭]
// 例）npm run selfplay -- 1000 test
// 失敗したら、表示された種をそのまま playOne(種) に渡すと同じ対局が再現できる。

import { rulesOfCnSet } from '../engine/ruleSets';
import { runGames, runSelfplay } from './run';

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
console.log(`点棒：リーチ棒を出した ${p.riichiSticks} 本・流し満貫 ${p.nagashi} 局・包が決まった ${p.paoSet} 回`);
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

// 四川（段階9）：1 局ずつ（対局を終わりまで打つのは最後の「四川の完走」）
const c0 = Date.now();
const sc = runSelfplay(games, `${prefix}-sichuan`, rulesOfCnSet('sichuan'));
const q = sc.paths.que;
console.log(`
四川：${sc.games} 局・見張った出来事 ${sc.events}・失敗 ${sc.failures.length}（${Date.now() - c0} ms）`);
// 中国式は流局も結果の形が cnWin（誰もアガらずに山が尽きた局は wins が空）
console.log(`終わり方：アガった人がいた ${sc.endings.cnWin - sc.paths.cn.winners[0]}・誰もアガらずに流局 ${sc.endings.exhaust + sc.paths.cn.winners[0]}・途中で止まった ${sc.endings.unfinished}・鳴き ${sc.paths.calls} 回（うちチー ${sc.paths.chi}）`);
const cw = sc.paths.cn;
console.log(`アガリ：ツモ ${cw.tsumo}・ロン ${cw.ron}（同じ牌で2人以上 ${cw.multi} 回）・上限で切った ${cw.capped}・見逃しの縛りが立った局 ${cw.missed}`);
console.log(`血戦到底：1 局でアガった人数 ${cw.winners.map((n, i) => `${i}人 ${n}`).slice(1).join('・')}・アガった人がいて山が尽きた局 ${cw.exhaustedAfterWin}`);
console.log(`刮风下雨：${Object.entries(cw.kanIncome).map(([k, n]) => `${k} ${n}`).join('・') || 'なし'}（返した ${cw.kanReturned}）・槍槓で無効になったカン ${cw.robbed}`);
console.log(`流局の精算：${cw.draw.hands} 局（テンパイ ${cw.draw.ready} 人・ノーテン ${cw.draw.noten} 人・花豬 ${cw.draw.pig} 人）・查叫が動いた局 ${cw.draw.chajiao}・カンの収入を返した局 ${cw.draw.kanReturned}`);
console.log(`番：${Object.entries(cw.fans).map(([k, n]) => `${k} ${n}`).join('・') || 'なし'}`);
console.log(`缺一門：伏せた ${q.held} 回（手に無い色を宣言 ${q.voidSuit}）・宣言のあと捨てる色から切った ${q.fromQue}・ほかの色を切った ${q.other}`);
for (const f of sc.failures.slice(0, 5)) {
  console.log(`  失敗：種 ${f.seed}・通し番号 ${f.seq}`);
  for (const reason of f.reasons) console.log(`    ${reason}`);
}
if (sc.games === 0 || sc.failures.length || q.held !== sc.games * 4) process.exitCode = 1;

// 対局を終わりまで（半荘の完走）
const gameCount = Number(process.argv[4] ?? Math.max(1, Math.round(games / 10)));
const g0 = Date.now();
const g = runGames(gameCount, `${prefix}-game`);
console.log(`
半荘の完走：${g.games} 対局・${g.hands} 局（最多 ${g.maxHands} 局）・見張った出来事 ${g.events}・失敗 ${g.failures.length}（${Date.now() - g0} ms）`);
console.log(`終わり方：${Object.entries(g.ends).map(([k, n]) => `${k} ${n}`).join('・')}`);
console.log(`通った道：延長（西入）${g.paths.extension}・連荘 ${g.paths.renchan}・親流れ ${g.paths.rotated}・本場の最大 ${g.paths.maxHonba}・やめるか選んだ対局 ${g.paths.yameAsked}`);
for (const f of g.failures.slice(0, 5)) {
  console.log(`  失敗：種 ${f.seed}・通し番号 ${f.seq}`);
  for (const reason of f.reasons) console.log(`    ${reason}`);
}
if (g.games === 0 || g.failures.length) process.exitCode = 1;

// 四川の完走（段階9 手順6）：4 圏＝16 局で終わる・親は最初にアガった人（誰もアガらなければ親のまま）・本場なし
const sg0 = Date.now();
const sg = runGames(gameCount, `${prefix}-sichuan-game`, rulesOfCnSet('sichuan'));
console.log(`
四川の完走：${sg.games} 対局・${sg.hands} 局（最多 ${sg.maxHands} 局）・見張った出来事 ${sg.events}・失敗 ${sg.failures.length}（${Date.now() - sg0} ms）`);
console.log(`終わり方：${Object.entries(sg.ends).map(([k, n]) => `${k} ${n}`).join('・')}`);
console.log(`親：続いた ${sg.paths.renchan}・下家へ ${sg.paths.rotated}・下家以外へ飛んだ ${sg.paths.jumped}・本場の最大 ${sg.paths.maxHonba}`);
for (const f of sg.failures.slice(0, 5)) {
  console.log(`  失敗：種 ${f.seed}・通し番号 ${f.seq}`);
  for (const reason of f.reasons) console.log(`    ${reason}`);
}
if (sg.games === 0 || sg.failures.length || sg.hands !== sg.games * 16 || sg.paths.maxHonba !== 0) process.exitCode = 1;
