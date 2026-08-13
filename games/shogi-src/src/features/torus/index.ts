/**
 * features/torus のエントリポイント (Phase 4)。
 * main-b.tsx から副作用 import されると plugin registry にトーラス機能を登録する。
 *
 * A ビルド (main-a.tsx) はこのモジュールを import しないため tree-shake で完全除外され、
 * 盤は常に平面になる (対局設定でトーラスを選ぶ画面も A には無い)。
 *
 * **回り込みの座標計算そのものは core 側**にある (盤の座標系の性質なので)。
 * ここに置くのは「なし/円筒/完全」というモードの解釈と、完全トーラス専用の追加制限。
 */

import { register } from '../../core/plugin/registry';
import { noRoyalCaptureRoyal, topologyFor } from './topology';

register('torus:topology', topologyFor);
register('topology:moveFilter', noRoyalCaptureRoyal);

export type { TorusMode } from './topology';
export { topologyFor, noRoyalCaptureRoyal } from './topology';
