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

register('quantum:init', quantumInit);
register('quantum:candidateUpdate', candidateUpdate);
register('quantum:constraints', basicConstraints);

export type QuantumInitFn = typeof quantumInit;
export type QuantumCandidateUpdateFn = typeof candidateUpdate;
