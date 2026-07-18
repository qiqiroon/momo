import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = 'dist/assets';

// 禁止語 = 「features/* の実装本体が A ビルドに漏れ出た時にだけ出るはずの文字列」。
// 注意: プラグインレジストリの照会キー (例: 'i18n:cat') は core 側に literal で
// 埋まっており、A ビルドの共有バンドル (App-*.js) にも出現するが、照会先の
// プラグイン実装本体 (features/cat-lang/index.ts 等) が A に import されなければ
// pluginGet(...) は undefined を返してその機能は自動で無効化される (縮退互換)。
// よって照会キー単体を禁止語に入れると誤検知になる。
// ここでは「実装本体だけが持つ literal」(=各国語翻訳文・機能名の英字識別子等) を
// 選ぶことで、実際の実装漏出だけを検出できるようにしている。
const FORBIDDEN = [
  { feature: 'cat-lang', strings: ['にゃんこ語', 'にゃにゃ将棋', 'ようこそにゃ'] },
  { feature: 'momo-lang', strings: ['momoLang_mode', 'momoCatBase', 'momolang_mode_'] },
  { feature: 'matchmaking', strings: ['MomoMatchmaking', 'enter_lobby', 'create_room', 'signalingUrl'] },
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
