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
import { ReviewLobbyScreen } from './ui/ReviewLobbyScreen';
import { createReviewRoom, lastPlayerName, leaveReviewRoom, reviewRoomBlock } from './reviewRoom';

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
/**
 * ★v1.54: 'review-lobby' = 感想戦ロビー S12（親 v1.48 §9.4.1・画面機能 v0.42 §3 S12）。
 * **感想戦の入り口**＝ひとりで始める／部屋を作る／部屋に入る。
 * 一覧に並べるのは**感想戦の部屋だけ**（対局の部屋は S04 から入る）。
 */
register('screen:review-lobby', ReviewLobbyScreen);
/**
 * v1.50: 感想戦の部屋（付録D-12 §8）。**感想戦の画面はこの 3 つの口だけを見る**
 * ＝部屋の建て方も部屋名の記号も通信機能の持ち物で、感想戦の側は知らなくてよい。
 */
register('reviewRoom:create', createReviewRoom);
register('reviewRoom:block', reviewRoomBlock);
register('reviewRoom:leave', leaveReviewRoom);
register('reviewRoom:lastName', lastPlayerName);
