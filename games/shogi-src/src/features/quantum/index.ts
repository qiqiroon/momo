/**
 * features/quantum のエントリポイント (Phase 5)。
 * main-b.tsx から副作用 import されると plugin registry に量子ロジックを登録する。
 *
 * A ビルド (main-a.tsx) はこのモジュールを import しないため tree-shake で完全除外される。
 */

import { register } from '../../core/plugin/registry';
import { quantumInit } from './init';
import { candidateUpdate } from './candidate-update';
import { basicConstraints } from './constraints/basic';
import { legalConstraints } from './constraints/legal';
import { propagationConstraints } from './constraints/propagation';

register('quantum:init', quantumInit);
register('quantum:candidateUpdate', candidateUpdate);
// Phase 5-5 basicConstraints + Phase 5-6 legalConstraints + Phase 5-6.5 propagationConstraints
// を順序付きで結合登録。basic (framework 不変) が先、legal (per-piece 狭め) が中、
// propagation (全体視点の C-108/C-106) が最後。反復ループが基本狭め → 空間制約 → hidden single
// の順で進み、素早く安定状態に達する。
register('quantum:constraints', [
  ...basicConstraints,
  ...legalConstraints,
  ...propagationConstraints,
]);

export type QuantumInitFn = typeof quantumInit;
export type QuantumCandidateUpdateFn = typeof candidateUpdate;
