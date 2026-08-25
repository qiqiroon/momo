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

import { loadMgf } from './loader';
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
