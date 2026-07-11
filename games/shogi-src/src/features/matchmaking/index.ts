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
import './gameConnector';
import { getMomoMatchmaking, type MomoMatchmakingApi } from './client';
import { MenuScreen } from './ui/MenuScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { RuleSelectScreen } from './ui/RuleSelectScreen';
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
// 'room' = S06 対局準備画面（段階 2-5.1 で S05 ホスト待機と統合）
register('screen:room', RoomScreen);
