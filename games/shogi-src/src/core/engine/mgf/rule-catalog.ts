/**
 * カスタムルール（MGF）を**データとして読み込む** (親 v1.65 §5.5・第 9 段 段A)。
 *
 * ★なぜファイルから読むか
 * チェス・中将棋・軍人将棋などの変則ルールは、**アプリに焼き込む同梱ルールではなく、
 * `rules/` フォルダに置いた MGF ファイルを実行時に読み込んで遊ぶ**（ユーザー判断
 * 2026-08-24）。まず GitHub の中（`rules/`）から、将来はユーザーのドライブからも読める
 * ようにする。ここはその「取ってきて・検証する」入口。
 *
 * 静的サイトなのでディレクトリ一覧は取れない。読み込める一覧は**マニフェスト
 * (`rules/index.json`)** が持つ。`baseUrl` は呼ぶ側が渡す（アプリでは
 * `import.meta.env.BASE_URL`＝`/momo/games/shogi/`）＝検証を差し込めるようにするため。
 */

import { loadMgf, officialCustomRule } from './loader';
import type { Mgf } from './types';

/** マニフェスト 1 行＝読み込めるルール 1 つ。 */
export interface RuleCatalogEntry {
  /** 安定した識別子（棋譜・部屋などで使う）。 */
  id: string;
  /** `rules/` からの相対ファイル名。 */
  file: string;
  /** 一覧に出す名前（正本は読み込んだ MGF の metadata.game_name）。 */
  name: string;
}

/**
 * ★段B②: 一度取ってきた一覧の目印を控える。
 *
 * ★なぜ控えるか＝**配る側は「このルールは公式一覧にあるか」を、待たずに答えたい**
 * （1 局を配るのは操作の流れの中で起きる）。**控えが無いときは「公式ではない」側に
 * 倒れる**＝定義を送ってしまうだけで、盤は食い違わない
 * （忘れたときに軽いほうへ倒す）。
 */
let knownOfficialIds: Set<string> | null = null;

/**
 * ★段B②: その目印のルールは**公式一覧にあるか**（＝受け取った側が自分で取りに行けるか）。
 *
 * アプリに焼き込んであるものと、一度取ってきた一覧に載っていたものを公式とみなす。
 * **分からないときは false**（上記のとおり、送ってしまう側が安全）。
 */
export function isOfficialRuleId(id: string): boolean {
  if (officialCustomRule(id)) return true;
  return knownOfficialIds?.has(id) ?? false;
}

function rulesBase(baseUrl: string): string {
  return `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}rules/`;
}

/** 読み込める一覧を取ってくる（`rules/index.json`）。 */
export async function fetchRuleCatalog(baseUrl: string): Promise<RuleCatalogEntry[]> {
  const res = await fetch(`${rulesBase(baseUrl)}index.json`);
  if (!res.ok) throw new Error(`ルール一覧を取得できません (${res.status})`);
  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { rules?: unknown }).rules)) {
    throw new Error('ルール一覧の形式が違います (rules 配列がありません)');
  }
  const out: RuleCatalogEntry[] = [];
  for (const r of (data as { rules: unknown[] }).rules) {
    if (typeof r === 'object' && r !== null) {
      const e = r as Partial<RuleCatalogEntry>;
      if (typeof e.id === 'string' && typeof e.file === 'string') {
        out.push({ id: e.id, file: e.file, name: typeof e.name === 'string' ? e.name : e.id });
      }
    }
  }
  knownOfficialIds = new Set(out.map((e) => e.id));
  return out;
}

/**
 * ルール 1 つを取ってきて MGF として検証する。
 * **壊れた JSON・欠けた MGF はここで弾く**（loadMgf が metadata/board/pieces/配置を確かめる）。
 */
export async function fetchRuleMgf(baseUrl: string, file: string): Promise<Mgf> {
  const res = await fetch(`${rulesBase(baseUrl)}${file}`);
  if (!res.ok) throw new Error(`ルールを取得できません (${file}・${res.status})`);
  const json: unknown = await res.json(); // 壊れた JSON はここで例外
  return loadMgf(json); // MGF として不足があればここで例外
}

/**
 * 利用者が選んだファイルを MGF として読んで検証する（§9.2.6 ②・段2）。
 *
 * カスタムルールの棋譜は「名前+版」の参照だけを持つので、公式一覧にも手元にも
 * 定義が無いときは、利用者にファイルを選んでもらって取り戻す。`rules/` からの
 * 取得 (`fetchRuleMgf`) と**同じ検証**（壊れた JSON・欠けた MGF を弾く）をドライブ上の
 * ファイルにも通す＝読み込む経路が増えても確かめる中身は 1 つにする。
 */
export async function readMgfFile(file: Blob): Promise<Mgf> {
  const text = await file.text();
  const json: unknown = JSON.parse(text); // 壊れた JSON はここで例外
  return loadMgf(json); // MGF として不足があればここで例外
}

/**
 * 公式一覧に**その目印のルールがあれば取ってくる**（無ければ null・段B②）。
 *
 * ★なぜ「取ってくる」側を用意するか
 * ネット対戦・感想戦で相手から届くのは**ルールの参照（目印）だけ**のことがある
 * ＝**公式に置いてあるものは、受け取った側が自分で取りに行けばよい**（線に大きな定義を
 * 流さない・ユーザー判断 2026-08-25）。**ホストが配るのは公式一覧に無いルールだけ**。
 *
 * **無いことは例外にしない**＝一覧に載っていないのは普通に起こること（相手のほうが
 * 新しい版を持っている等）なので、null を返して呼ぶ側に判断させる。取得そのものに
 * 失敗したときも同じ＝**受け取った側は「用意できなかった」と返さなければならず**、
 * 理由の細かさで振る舞いは変わらない。
 */
export async function fetchOfficialRuleById(baseUrl: string, id: string): Promise<Mgf | null> {
  try {
    const catalog = await fetchRuleCatalog(baseUrl);
    const entry = catalog.find((e) => e.id === id);
    if (!entry) return null;
    return await fetchRuleMgf(baseUrl, entry.file);
  } catch {
    return null;
  }
}
