/**
 * 参加者名簿の読み方 (v1.53・親 §6.1)。
 *
 * サーバー中継の部屋には**席に着いている者 (対局者) と席を持たない者 (観戦者)** が混じる。
 * 「自分以外の 1 人が相手」という数え方は**部屋に居るのが 2 人とは限らなくなった時点で成り立たない**ので、
 * 相手を知りたい箇所はすべてこのファイルの関数を通す。
 *
 * ここに集めた理由 = 判定を呼び出し側に散らすと、観戦者が入ってくる段2 で
 * 「席を見ていない箇所」を数え上げて直すことになり、必ず 1 か所書き忘れる。
 */

import type {
  MomoCreateRoomOptions,
  MomoMatchmakingApi,
  MomoRole,
  MomoRoomInfo,
  MomoRosterEntry,
} from './client';

/** その立場は席に着いているか (= 対局者か)。 */
export function hasSeat(role: MomoRole | null | undefined): boolean {
  return role === 'host' || role === 'player';
}

/** 名簿のうち、自分以外で席に着いている者。 */
export function seatedOthers(roster: MomoRosterEntry[], myPid: string | null): MomoRosterEntry[] {
  return roster.filter((p) => hasSeat(p.role) && p.pid !== myPid);
}

/**
 * 対局相手 (自分以外で席に着いている最初の 1 人)。居なければ null。
 * 将棋は席が 2 つなので「最初の 1 人」で足りる。
 */
export function opponentOf(roster: MomoRosterEntry[], myPid: string | null): MomoRosterEntry | null {
  return seatedOthers(roster, myPid)[0] ?? null;
}

/** 対局相手が居るか。**「部屋に入れたか」とは別の問い** (親 §6.2)。 */
export function hasOpponent(roster: MomoRosterEntry[], myPid: string | null): boolean {
  return opponentOf(roster, myPid) !== null;
}

/**
 * その部屋の席が埋まっているか (= もう対局者としては入れないか)。
 *
 * 多人数の部屋は `guestConnected` を持たない (サーバーが返す項目が違う) ので、
 * **席の数で見る**。1 対 1 で建てられた部屋 (古い部屋) は従来どおり `guestConnected`。
 */
export function isRoomPlayersFull(room: MomoRoomInfo): boolean {
  if (room.mode === 'multi') {
    return (room.playerCount ?? 0) >= (room.maxPlayers ?? SHOGI_MAX_PLAYERS);
  }
  return !!room.guestConnected;
}

/** 将棋の席の数 (先手・後手)。 */
export const SHOGI_MAX_PLAYERS = 2;

/**
 * 観戦枠の数。**段1 では 0** = 観戦者は入れない。
 * 段2 で人数を決めて開ける (親 §6.8)。
 */
export const SHOGI_MAX_SPECTATORS = 0;

/**
 * 部屋を建てる (v1.53・親 §6.1)。
 *
 * **部屋は必ず「席＋観戦枠」を持つ形で建てる**。建てる場所は 4 か所あるので、
 * **席の指定をそれぞれの呼び出しに書かない**＝1 か所書き忘れると、その部屋だけが
 * 従来の 1 対 1 になり、**観戦者が入れないだけでなく、相手が来たことにも気づけない**
 * (多人数の部屋と 1 対 1 の部屋では、入室を知らせる口そのものが違うため)。
 */
export function createSeatedRoom(client: MomoMatchmakingApi, options: MomoCreateRoomOptions): void {
  client.createRoom({
    ...options,
    mode: 'multi',
    maxPlayers: SHOGI_MAX_PLAYERS,
    maxSpectators: SHOGI_MAX_SPECTATORS,
  });
}
