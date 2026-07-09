/**
 * features/matchmaking のエントリポイント。
 * main-b.tsx から副作用 import されると:
 * 1. momo-matchmaking.js を読み込み window.MomoMatchmaking を露出
 * 2. plugin registry に matchmaking client と LobbyScreen を登録
 *
 * A ビルドは main-a.tsx でこれを import しないため tree-shake で完全除外される。
 */

import { register } from '../../core/plugin/registry';
import './vendor';
import { getMomoMatchmaking, type MomoMatchmakingApi } from './client';
import { LobbyScreen } from './ui/LobbyScreen';

const client = getMomoMatchmaking();
if (client) {
  register<MomoMatchmakingApi>('matchmaking', client);
}
register('screen:lobby', LobbyScreen);
