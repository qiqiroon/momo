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
import { MenuScreen } from './ui/MenuScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { RuleSelectScreen } from './ui/RuleSelectScreen';
import { WaitingScreen } from './ui/WaitingScreen';
import { RoomScreen } from './ui/RoomScreen';

const client = getMomoMatchmaking();
if (client) {
  register<MomoMatchmakingApi>('matchmaking', client);
}
// 'lobby' = トップメニュー（vs AI / vs 人 / 通信対戦）
register('screen:lobby', MenuScreen);
// 'net-lobby' = 通信対戦のロビー（部屋一覧・作成）
register('screen:net-lobby', LobbyScreen);
register('screen:rule-select', RuleSelectScreen);
register('screen:waiting', WaitingScreen);
register('screen:room', RoomScreen);
