import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = 'dist/assets';

const FORBIDDEN = [
  { feature: 'cat-lang', strings: ['i18n:cat', 'にゃんこ語', 'にゃにゃ将棋', 'ようこそにゃ'] },
  { feature: 'momo-lang', strings: ['momoLang_mode', 'momoCatBase', 'momolang_mode_'] },
];

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('b-'));
} catch {
  console.error(`ERROR: cannot read ${ASSETS_DIR}. Run 'npm run build' first.`);
  process.exit(1);
}

const violations = [];
for (const file of files) {
  const content = readFileSync(join(ASSETS_DIR, file), 'utf-8');
  for (const { feature, strings } of FORBIDDEN) {
    for (const s of strings) {
      if (content.includes(s)) {
        violations.push({ file, feature, string: s });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('A build forbidden identifier check FAILED:');
  for (const v of violations) {
    console.error(`  ${v.file}: contains "${v.string}" (features/${v.feature})`);
  }
  process.exit(1);
}

const totalStrings = FORBIDDEN.reduce((n, f) => n + f.strings.length, 0);
console.log(`A build clean: ${files.length} chunks scanned, ${totalStrings} forbidden strings, ${FORBIDDEN.length} features tracked`);
