import type { LocaleData } from '../../core/i18n/types';

/** v0.64: 猫語 (CAT) を動的ランダム生成方式に置き換え (cat-lang-spec.txt 準拠)。
 *
 *  従来は静的な翻訳表を持っていたが、仕様書の方針:
 *    - 翻訳キー追加ゼロ・辞書ゼロ
 *    - t() 呼び出しごとにキー分類に応じた語彙リストからランダム 1 語を返す
 *    - catBase (CAT 選択直前の言語) により語彙 (ja/en/zh) を切替
 *
 *  この LocaleData は「code = 'cat' が登録されている」というマーカー役のみで、
 *  translations は空。実際の文言生成は core/i18n/index.ts の t() が catSpeak を呼ぶ。
 */
export const cat: LocaleData = {
  code: 'cat',
  name: 'にゃんこ語',
  translations: {},
};

/** 猫語モードでの語彙選択に使う「直前の言語」の型 (i18n-store と同じ) */
export type CatBase = 'ja' | 'en' | 'zh';

/** エラー系キー (末尾一致): シャー/HISS 系の攻撃的な鳴き声 */
const ERROR_KEYS = new Set<string>([
  'pwError', 'noRoomError', 'fullRoomError', 'kicked',
  'createErrorEmpty', 'privateIdRequired',
]);
/** 待機・接続系キー (末尾一致): ごろごろ/purrrr 系の穏やかな鳴き声 */
const CALM_KEYS = new Set<string>([
  'connecting', 'reconnecting', 'waitingGuest', 'waitingStart',
]);

/** キーの最後の segment を取り出す。s06.frRolling → 'frRolling'。
 *  仕様書のキー分類 (pwError 等) はドット無しで書かれているため、末尾一致で判定する。 */
function tail(key: string): string {
  const i = key.lastIndexOf('.');
  return i >= 0 ? key.slice(i + 1) : key;
}

/** v0.66: 同じ画面内では同じキーは同じ鳴き声を返すためのキャッシュ。
 *  何もしないと 1 秒ごとの再レンダリング (例: 量子巡回) で画面全体の文言が
 *  リロールされて読みにくい / 不快になる。世代 (gen) 番号を進めることで
 *  「画面切替や locale/catBase 変更時にだけ再生成」を実現。 */
type CachedMeow = { gen: number; base: CatBase; value: string };
const catCache = new Map<string, CachedMeow>();
let cacheGen = 0;

/** 画面切替や言語切替のタイミングで呼ぶ。次回の catSpeak() から新しい鳴き声を採用。 */
export function resetCatCache(): void {
  cacheGen++;
}

/** キーの性質に応じたランダム鳴き声を返す (cat-lang-spec.txt §3-4)。
 *  catBase: 'ja' | 'en' | 'zh' — CAT 選択直前の言語。
 *  v0.66: 同じ key + catBase + cacheGen の組では同じ鳴き声を返し、
 *  再レンダリング時に文言が変わらないようにする。 */
export function catSpeak(key: string, catBase: CatBase): string {
  const cached = catCache.get(key);
  if (cached && cached.gen === cacheGen && cached.base === catBase) return cached.value;

  const k = tail(key);
  let vocab: readonly string[];
  if (catBase === 'en') {
    if (ERROR_KEYS.has(k)) vocab = ['HISS!', 'SPIT!', 'FSSST!'];
    else if (CALM_KEYS.has(k)) vocab = ['purrrr...', 'mrrr...', 'prrr...'];
    else vocab = ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'];
  } else if (catBase === 'zh') {
    if (ERROR_KEYS.has(k)) vocab = ['嘶！', '哈！', '嘶嘶！'];
    else if (CALM_KEYS.has(k)) vocab = ['呼噜…', '喵…', '咕噜…'];
    else vocab = ['喵', '喵喵', '喵呜', '喵！'];
  } else {
    // ja (default)
    if (ERROR_KEYS.has(k)) vocab = ['シャー！', 'フーッ！', 'シャシャシャ！'];
    else if (CALM_KEYS.has(k)) vocab = ['ごろごろ…', 'にゃ…', 'ぐるぐる…'];
    else vocab = ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！'];
  }
  const value = vocab[Math.floor(Math.random() * vocab.length)];
  catCache.set(key, { gen: cacheGen, base: catBase, value });
  return value;
}
