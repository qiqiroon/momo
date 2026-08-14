/**
 * 目録への並び方 (親 §7.1.1・付録 D-5 §6.3)。
 *
 * 汎用MCTS を足しても**既定は自作探索のまま**であること (順位表の数値どおり) と、
 * **強さの段では行が増えない**こと (段は AI 選択と直交＝親 §7.1.1 v1.30 追記) を固定する。
 */

import { describe, it, expect } from 'vitest';
import '../selfmade-alphabeta';
import './index';
import { AI_MODES } from '../../core/ai/types';
import { listEngines, defaultEngine, weightOf, findEngine } from '../../core/ai/engine-registry';
import { SELFMADE_ENGINE_ID } from '../selfmade-alphabeta';
import { MCTS_ENGINE_ID } from './index';

describe('AI の目録', () => {
  it('自作探索と汎用MCTS の 2 つが並ぶ', () => {
    const ids = listEngines('shogi').map((c) => c.descriptor.id);
    expect(ids).toContain(SELFMADE_ENGINE_ID);
    expect(ids).toContain(MCTS_ENGINE_ID);
  });

  it('★段 (Easy/Hard/Apocalypse) では行が増えない＝思考ルーチンごとに 1 行', () => {
    const rows = listEngines('shogi');
    expect(rows.length).toBe(new Set(rows.map((c) => c.descriptor.id)).size);
    expect(rows.length).toBe(2);
  });

  it('どのモードでも既定は自作探索 (汎用MCTS は下位)', () => {
    for (const mode of AI_MODES) {
      expect(defaultEngine(mode)?.id).toBe(SELFMADE_ENGINE_ID);
    }
  });

  it('汎用MCTS は全モードに対応すると名乗る (どのモードでも選べる)', () => {
    const mcts = findEngine(MCTS_ENGINE_ID)!;
    for (const mode of AI_MODES) {
      expect(weightOf(mcts, mode)).not.toBeNull();
    }
  });

  it('順位表どおり、どのモードでも自作探索のほうが重い', () => {
    const selfmade = findEngine(SELFMADE_ENGINE_ID)!;
    const mcts = findEngine(MCTS_ENGINE_ID)!;
    for (const mode of AI_MODES) {
      expect(weightOf(selfmade, mode)!).toBeGreaterThan(weightOf(mcts, mode)!);
    }
  });
});
