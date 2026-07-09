/**
 * features/matchmaking のエントリポイント。
 * main-b.tsx から副作用 import されると:
 * 1. momo-matchmaking.js を読み込み window.MomoMatchmaking を露出
 * 2. plugin registry に matchmaking client を登録
 *
 * 段階 2-1: 骨組みのみ。実際の接続確立は 2-2 以降。
 */

import { register } from '../../core/plugin/registry';
import './vendor';
import { getMomoMatchmaking, type MomoMatchmakingApi } from './client';

const client = getMomoMatchmaking();
if (client) {
  register<MomoMatchmakingApi>('matchmaking', client);
}
