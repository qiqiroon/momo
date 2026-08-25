import type { Mgf } from './types';
import hondouRaw from './hondou.json';
import hasamiRaw from './hasami.json';
import chessRaw from './chess.json';

export function loadMgf(json: unknown): Mgf {
  if (typeof json !== 'object' || json === null) {
    throw new Error('MGF must be an object');
  }
  const mgf = json as Mgf;
  if (!mgf.metadata?.game_id) throw new Error('MGF missing metadata.game_id');
  if (!mgf.board?.width || !mgf.board?.height) throw new Error('MGF missing board dimensions');
  if (!Array.isArray(mgf.pieces) || mgf.pieces.length === 0) throw new Error('MGF must have pieces');
  if (!mgf.initial_placement) throw new Error('MGF must have initial_placement');
  return mgf;
}

export const hondou: Mgf = loadMgf(hondouRaw);

/** はさみ将棋 (Phase 6・親 v1.29 §5.3 の標準バリアント)。 */
export const hasami: Mgf = loadMgf(hasamiRaw);

/**
 * チェス (第 9 段 9-4・親 v1.66 §5.5)。**「読み込んで遊ぶカスタムルール」の実証例**であり、
 * gameType の名札としては持たない (§5.0)。実アプリはメニュー「カスタムルール作成」→
 * 読み込み画面から `rules/chess.json` を読み込み、`gameType:'custom'` として対局する。
 * この export はエンジン検査と読み込み定義の drift 防止照合のための参照実体である。
 */
export const chess: Mgf = loadMgf(chessRaw);

/**
 * ルールの種類 → ルール定義 (MGF)。**まだ定義を持たないルールは null**。
 *
 * 手合いの一覧のように「ルール定義が持っているかどうか」で決まる項目は、
 * 画面ではなくここから引く (親 §3.12.1)。定義が無いルールは平手のみになる。
 */
const MGF_BY_GAME_TYPE: Record<string, Mgf> = {
  shogi: hondou,
  hasami,
};

export function mgfForGameType(gameType: string): Mgf | null {
  return MGF_BY_GAME_TYPE[gameType] ?? null;
}

/**
 * 公式に用意したカスタムルール（`game_id` → 定義）。§9.2.6 の「公式一覧から取り戻す」の
 * 同期版。**チェスの定義は `rules/chess.json` と同一（drift 照合済み）のものをアプリが
 * 持っている**ので、棋譜が持つ参照（`game_id`）からここで同期的に引ける。ここに無い
 * ルールは `rules/` から取ってくる・利用者にファイルを選ばせる（段2・§9.2.6 ②）。
 */
const OFFICIAL_CUSTOM_RULES: Record<string, Mgf> = {
  chess,
};

export function officialCustomRule(id: string): Mgf | null {
  return OFFICIAL_CUSTOM_RULES[id] ?? null;
}
