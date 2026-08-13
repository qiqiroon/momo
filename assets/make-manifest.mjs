/**
 * BGM 目録 (assets/bgm/manifest.json) を作り直す道具。
 *
 *   node assets/make-manifest.mjs
 *
 * assets/bgm/ の下のフォルダを見て、入っている .mp3 を並べた目録を書き出す。
 * 各アプリはこの目録を読んでプールを組み立てるので、
 * **曲を足すときはファイルを置いてこれを走らせるだけ**でよく、プログラムは触らない。
 *
 * なぜ目録が要るか: GitHub Pages はフォルダの中身を一覧で返さないため、
 * ブラウザから「このフォルダに何本あるか」を知る手段が無い。
 *
 * 並び順は数字を数として見る (bgm-lobby-2 < bgm-lobby-10)。
 * 曲が 1 本も入っていないフォルダは目録に載せない (git は空フォルダを持てないため、
 * 用意だけして中身が無い状態は起こりうる)。
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bgmDir = join(here, 'bgm');

/** 数字を数として比べる並べ替え (bgm-lobby-2 が bgm-lobby-10 より先に来るように) */
const natural = new Intl.Collator('en', { numeric: true }).compare;

const manifest = {};
for (const entry of readdirSync(bgmDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const files = readdirSync(join(bgmDir, entry.name))
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .sort(natural);
  if (files.length > 0) manifest[entry.name] = files;
}

// 1 フォルダ 1 行。人が読んで差分を追えるようにしつつ、余分な空白は入れない。
const body = Object.entries(manifest)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
writeFileSync(join(bgmDir, 'manifest.json'), `{\n${body}\n}\n`, 'utf8');

for (const [k, v] of Object.entries(manifest)) console.log(`${k}: ${v.length} 本`);
