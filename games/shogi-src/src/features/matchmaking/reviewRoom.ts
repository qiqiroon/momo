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
import { decodeRoomName, encodeRoomName } from './roomNameCodec';
import { createSeatedRoom } from './roster';
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
  createSeatedRoom(client, {
    hostName,
    name: encodedName,
    // ★v1.55: パスワードと非公開も効かせる（親 v1.49 §9.4.4・ユーザー判断 2026-08-19）
    // ＝**S04 とまったく同じ扱い**にする。感想戦の部屋だけ扱いを変えない。
    // 終局から移ってきた部屋（§6.3.6 の合言葉）も、この同じ口を通って建つ。
    password: info.password ?? '',
    isPublic: info.isPublic ?? true,
    // ★v1.55 (親 §6.8.2): 観戦の可否。省略＝許す。
    allowSpectators: info.allowSpectators ?? true,
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

/**
 * ★v1.55: 対局の部屋から移る先の、**感想戦の部屋の名前**を組み立てる
 * （親 v1.49 §9.4.4／§6.3.6）。**同じ部屋名**にする＝人から見て同じ場が続くように。
 *
 * 名前は用途の印を載せた形（`roomNameCodec`）にする＝**サーバーは部屋名を素通しする
 * だけ**なので、感想戦であることは名前に載せて運ぶしかない。
 */
export function buildMigratedRoomName(userRoomName: string): string {
  const s = useMatchmakingStore.getState();
  const parts = decodeRoomName(s.currentRoomName);
  return encodeRoomName({
    gameType: parts.gameType,
    torus: parts.torus,
    quantum: parts.quantum,
    review: true,
    customRuleName: parts.customRuleName,
    userRoomName: userRoomName || parts.userRoomName,
  });
}

/** ★v1.55: いま居る部屋の、人が付けた名前（移る先でもこれを使う）。 */
export function currentUserRoomName(): string {
  return decodeRoomName(useMatchmakingStore.getState().currentRoomName).userRoomName;
}

/**
 * ★v1.55: 移る先の感想戦の部屋を建てる（ホスト側・親 §6.3.6 の手順 3）。
 *
 * **必ず非公開＋合言葉**にする（§9.4.4）＝二人で始めた話の続きなので、
 * 人の入れ方を勝手に広げない。合言葉は**人には見せない**。
 */
export function createMigratedReviewRoom(p: { room: string; pass: string }): boolean {
  const client = getMomoMatchmaking();
  if (!client) return false;
  const s = useMatchmakingStore.getState();
  s.setCurrentRoom({ roomId: null, roomName: p.room, isHost: true });
  s.setOpponentName('');
  createSeatedRoom(client, {
    hostName: lastPlayerName(),
    name: p.room,
    password: p.pass,
    isPublic: false,
    rules: { review: true },
  });
  return true;
}

/**
 * ★v1.55: 移る先の感想戦の部屋を見つけて入る（ゲスト側・親 §6.3.6 の手順 4）。
 *
 * **名前だけで見分けない**＝同じ名前の部屋が 2 つあっても、**合言葉の合う部屋は
 * 1 つしか無い**。見つからない間は一覧を取り直して待つ（**待ち続けない**＝
 * 打ち切りは呼んだ側が持つ）。
 *
 * **人には見せない**＝部屋の一覧も合言葉も画面に出さない。
 */
export function joinMigratedReviewRoom(p: { room: string; pass: string }): void {
  const client = getMomoMatchmaking();
  if (!client) return;
  let stopped = false;
  let unsub: (() => void) | null = null;
  let timer: number | null = null;

  const stop = () => {
    stopped = true;
    if (unsub) unsub();
    if (timer !== null) window.clearInterval(timer);
  };

  const tryJoin = () => {
    if (stopped) return;
    const st = useMatchmakingStore.getState();
    if (st.currentRoomId) {
      stop();
      return;
    }
    const found = st.rooms.find((r) => r.name === p.room && !r.isPublic && r.hasPassword);
    if (!found) return;
    stop();
    client.joinRoom(found.id, p.pass, lastPlayerName());
  };

  // **一覧が届いた瞬間に見る**＝決まった間隔で覗きに行くと、その分だけ待たされる。
  unsub = useMatchmakingStore.subscribe(tryJoin);
  // 一覧を取り直しながら待つ（届けば上の見張りが拾う）。
  client.refreshRooms();
  tryJoin();
  timer = window.setInterval(() => {
    if (stopped) return;
    client.refreshRooms();
    tryJoin();
  }, 700);
  // 呼んだ側の打ち切りより長く回さない（親 §9.4.4＝待ち続けない）。
  window.setTimeout(stop, 12_000);
}
