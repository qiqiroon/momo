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
import { applyC201, isConfirmedKing } from './capture-effects';
import { buildInitialInfoMap } from './piece-lookup';
import { findConfirmedKing } from './king-detection';

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
// Phase 5-7 §Q8.5 捕獲制約群 (C-201/C-202/C-203)。propagation とは別のイベント系フック。
// game-store の applyAndCommit から捕獲検知時に呼ばれる。
register('quantum:onCapture', {
  applyC201,
  isConfirmedKing,
  buildInitialInfoMap,
});
// Phase 5-10 §Q13.4 王手判定の量子拡張。findKing を「玉として確定した駒だけ」に狭める。
// 通常将棋モード (A ビルド or shogi モード時) は hook 未登録 → check.ts の kind ベース実装が使われる。
register('quantum:findKing', findConfirmedKing);

export type QuantumInitFn = typeof quantumInit;
export type QuantumCandidateUpdateFn = typeof candidateUpdate;
export type QuantumOnCaptureHook = {
  applyC201: typeof applyC201;
  isConfirmedKing: typeof isConfirmedKing;
  buildInitialInfoMap: typeof buildInitialInfoMap;
};
export type QuantumFindKingFn = typeof findConfirmedKing;
