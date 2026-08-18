/**
 * 感想戦の部屋（v1.50・親 §9.4／§6.3.6・画面機能 §3 S04／S11・付録D-12 §8）。
 *
 * **対局の部屋と同じ一覧に、印つきで並べる**＝感想戦専用の一覧は作らない。
 * サーバーは部屋名を素通しするだけなので、**用途は部屋名の記号（`感`）に載せて運ぶ**
 * （`roomNameCodec`）。したがって**通信サーバーには一切手を入れない**。
 *
 * ここは通信機能 (features/matchmaking) 側の受け持ちで、感想戦の画面
 * (features/kifu-replay) からは registry の口を通してだけ呼ばれる。
 * **A ビルドではどちらの機能も無いので、口ごと存在しない**。
 */

import type { ReviewRoomBlock, ReviewRoomRequest } from '../../core/plugin/reviewRoom';
import { getMomoMatchmaking } from './client';
import { encodeRoomName } from './roomNameCodec';
import { useMatchmakingStore } from './store';

const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';

/**
 * 部屋を建てられるか（付録D-12 §8＝**建てられないときは不活性にして理由を添える**）。
 *
 * 返すのは真偽ではなく**理由**にしてある＝画面が「押せない」だけを出すと、
 * 待てば直るのか自分の事情なのかが分からない（灰色は「押せない」しか意味しない）。
 */
export function reviewRoomBlock(): ReviewRoomBlock {
  if (!getMomoMatchmaking()) return 'no-server';
  const conn = useMatchmakingStore.getState().connection;
  if (conn === 'in_room' || conn === 'game_connected') return 'already-in-room';
  if (conn !== 'connected') return 'no-server';
  return 'ok';
}

/**
 * 感想戦の部屋を建てる。建てられたら true。
 *
 * **持ち時間は載せない**＝感想戦に時計は無い（親 §9.4）ので、時間の記号を付けると
 * 一覧に意味の無いバッジが出る。**手合いも載せない**（棋譜が持っている）。
 */
export function createReviewRoom(info: ReviewRoomRequest): boolean {
  if (reviewRoomBlock() !== 'ok') return false;
  const client = getMomoMatchmaking();
  if (!client) return false;

  const s = useMatchmakingStore.getState();
  // v1.52: 名前は画面で決めてもらったものを使う。**次からの既定にもする**
  // ＝対局のロビーと同じ 1 つの名前を使い回す（別々に覚えると食い違う）。
  const hostName = info.playerName.trim();
  if (hostName) {
    s.setPlayerName(hostName);
    try {
      localStorage.setItem(LS_LAST_PLAYER_NAME, hostName);
    } catch {
      // localStorage が使えない環境は無視
    }
  }

  const encodedName = encodeRoomName({
    gameType: info.gameType,
    torus: info.torus,
    quantum: info.quantum,
    review: true,
    customRuleName: info.customRuleName,
    userRoomName: info.roomName,
  });

  s.setCurrentRoom({ roomId: null, roomName: encodedName, isHost: true });
  s.setOpponentName('');
  client.createRoom({
    hostName,
    name: encodedName,
    password: '',
    isPublic: true,
    // ルールは**棋譜が持っているもの**を継ぐ（親 §9.4）ので、部屋のルールは
    // 一覧の表示のためだけに載せる。ゲスト側の盤は配られた棋譜から組み立てる。
    rules: {
      game: info.gameType,
      torus: info.torus,
      quantum: info.quantum,
      customRuleName: info.customRuleName,
      review: true,
    },
  });
  return true;
}

/** v1.52: 前に使った名前（画面が既定として出すために聞きに来る）。 */
export function lastPlayerName(): string {
  const inStore = useMatchmakingStore.getState().playerName.trim();
  if (inStore) return inStore;
  try {
    return (localStorage.getItem(LS_LAST_PLAYER_NAME) ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * 感想戦のために建てた／入った部屋から出る。
 *
 * **感想戦の画面を離れるときに呼ぶ**＝この部屋は感想戦のためだけに在るので、
 * 残すと一覧に**誰も居ない感想戦の部屋**が並び続ける（対局の部屋のように
 * 戻ってくる画面が無い）。
 */
export function leaveReviewRoom(): void {
  const client = getMomoMatchmaking();
  if (!client) return;
  // **先に「自分から出た」と立てる**＝切断の知らせが来たときに、事故として
  // 扱われないようにするため（bootstrap の `onDisconnected`）。
  client.leaveRoom();
  useMatchmakingStore.getState().resetRoomState();
}
