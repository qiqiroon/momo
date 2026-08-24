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

/** チェス (第 9 段 9-4・親 v1.65 §5.5 の標準バリアント)。 */
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
  chess,
};

export function mgfForGameType(gameType: string): Mgf | null {
  return MGF_BY_GAME_TYPE[gameType] ?? null;
}
