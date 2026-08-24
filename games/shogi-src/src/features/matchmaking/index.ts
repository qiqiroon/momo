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
import { RuleLoadScreen } from './ui/RuleLoadScreen';
import { RoomScreen } from './ui/RoomScreen';
import { ReviewLobbyScreen } from './ui/ReviewLobbyScreen';
import { SpectateLobbyScreen } from './ui/SpectateLobbyScreen';
import { SpectateMigrateDialog } from './ui/SpectateMigrateDialog';
import {
  buildMigratedRoomName,
  createMigratedReviewRoom,
  createReviewRoom,
  currentUserRoomName,
  joinMigratedReviewRoom,
  lastPlayerName,
  leaveReviewRoom,
  reviewRoomBlock,
} from './reviewRoom';

import { watchRoomPhase } from './roomState';

// ★v1.55 (親 §6.8.2): 部屋の段（人待ち／対局中／終局後）を知らせ続ける。
// **観戦の一覧がその印を出す**ので、ここが止まると一覧だけが古い段を見せる。
// **呼び出し場所を数え上げず、盤の様子から決める**（入口が増えても書き足さない）。
watchRoomPhase();

const client = getMomoMatchmaking();
if (client) {
  register<MomoMatchmakingApi>('matchmaking', client);
}
// 'lobby' = トップメニュー（vs AI / vs 人 / 通信対戦）
register('screen:lobby', MenuScreen);
// 'net-lobby' = 通信対戦のロビー（部屋一覧・作成）
register('screen:net-lobby', LobbyScreen);
register('screen:rule-select', RuleSelectScreen);
// 'rule-load' = カスタムルール読み込み (第 9 段 段A・親 v1.65 §5.5)。rules/ の MGF を
// データとして読み込んでオフライン対局へ。
register('screen:rule-load', RuleLoadScreen);
// 'room' = S06 対局準備画面（段階 2-5.1 で S05 ホスト待機と統合）
register('screen:room', RoomScreen);
/**
 * ★v1.54: 'review-lobby' = 感想戦ロビー S12（親 v1.48 §9.4.1・画面機能 v0.42 §3 S12）。
 * **感想戦の入り口**＝ひとりで始める／部屋を作る／部屋に入る。
 * 一覧に並べるのは**感想戦の部屋だけ**（対局の部屋は S04 から入る）。
 */
register('screen:review-lobby', ReviewLobbyScreen);
/**
 * ★v1.55: 'spectate-lobby' = 観戦ロビー S13（親 v1.55 §6.8・画面機能 v0.49 §3 S13）。
 * **観戦の入り口**＝観戦できる部屋を選ぶだけ。**部屋は建てない**。
 * **入り口を S04 に相乗りさせない**＝どの立場で入ったのかを画面が言えなくなるため。
 */
register('screen:spectate-lobby', SpectateLobbyScreen);
/**
 * ★v1.59 (段3・親 §6.8.6): 観戦者に出す「感想戦へ移りますか」と「対局が終わりました」。
 *
 * **画面のいちばん外側に 1 か所だけ置く**（画面機能 v0.51 §3 S07）＝観戦者が居る画面は
 * 1 つではないので、**画面ごとに置くと新しい画面で必ず書き忘れる**。
 */
register('overlay:spectate', SpectateMigrateDialog);
/**
 * v1.50: 感想戦の部屋（付録D-12 §8）。**感想戦の画面はこの 3 つの口だけを見る**
 * ＝部屋の建て方も部屋名の記号も通信機能の持ち物で、感想戦の側は知らなくてよい。
 */
register('reviewRoom:create', createReviewRoom);
register('reviewRoom:block', reviewRoomBlock);
register('reviewRoom:leave', leaveReviewRoom);
register('reviewRoom:lastName', lastPlayerName);
// ★v1.55: 対局の部屋から感想戦の部屋へ移る（親 v1.49 §9.4.4／§6.3.6）。
// **建てるのも探すのも通信機能の側**で、感想戦の画面は口越しに頼むだけ。
register('reviewRoom:buildName', buildMigratedRoomName);
register('reviewRoom:currentUserName', currentUserRoomName);
register('reviewRoom:createMigrated', createMigratedReviewRoom);
register('reviewRoom:joinMigrated', joinMigratedReviewRoom);
