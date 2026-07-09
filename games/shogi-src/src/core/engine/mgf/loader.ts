import type { Mgf } from './types';
import hondouRaw from './hondou.json';

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
