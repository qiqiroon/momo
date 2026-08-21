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

/**
 * ★v1.55 (親 §6.8.1): その立場は観戦者か。
 *
 * **`!hasSeat()` と書かない**＝立場が分かっていない (null) ときまで観戦者に
 * なってしまう。**「席が無い」と「まだ分からない」は別**。
 */
export function isSpectator(role: MomoRole | null | undefined): boolean {
  return role === 'spectator';
}

/** ★v1.55: 名簿のうち観戦者だけ。 */
export function spectatorsOf(roster: MomoRosterEntry[]): MomoRosterEntry[] {
  return roster.filter((p) => isSpectator(p.role));
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
 * ★v1.55 (親 §6.8.7): 観戦枠の数 = **1 部屋 8 人**。
 *
 * これは**共通の多人数トランスポートのハード上限**であり (`MAX_SPECTATORS=8`)、
 * 将棋側から超えられない。**花札と同じ数**にそろえてある。
 * v1.54 までは 0 (観戦を入れない段) だった。
 */
export const SHOGI_MAX_SPECTATORS = 8;

/**
 * ★v1.55 (親 §6.8.2): 「観戦を許さない」は**観戦枠 0 で建てることで表す**。
 *
 * **可否を別の項目として持たない**＝持つと「枠はあるのに許さない」「許すのに枠が無い」
 * という食い違う組み合わせが生まれ、**判定が二重になって片方だけ直った状態**になる。
 */
export function spectatorSlotsFor(allowSpectators: boolean): number {
  return allowSpectators ? SHOGI_MAX_SPECTATORS : 0;
}

/** ★v1.55: その部屋は観戦を受け入れているか (枠が 1 つ以上あるか)。 */
export function roomAllowsSpectators(room: MomoRoomInfo): boolean {
  return (room.maxSpectators ?? 0) > 0;
}

/** ★v1.55: その部屋の観戦がもう満員か。 */
export function isRoomSpectatorsFull(room: MomoRoomInfo): boolean {
  return (room.spectatorCount ?? 0) >= (room.maxSpectators ?? 0);
}

/**
 * ★v1.55 (親 §6.8.2): 観戦の一覧に出す部屋か。
 *
 * **満員でも一覧には出す**＝押せないことと理由を見せるため (画面機能 §3 S13)。
 * **出さないのは「観戦を許していない部屋」だけ**。
 */
export function isSpectatable(room: MomoRoomInfo): boolean {
  return roomAllowsSpectators(room);
}

/**
 * 部屋を建てる (v1.53・親 §6.1)。
 *
 * **部屋は必ず「席＋観戦枠」を持つ形で建てる**。建てる場所は 3 か所あるので、
 * **席の指定をそれぞれの呼び出しに書かない**＝1 か所書き忘れると、その部屋だけが
 * 従来の 1 対 1 になり、**観戦者が入れないだけでなく、相手が来たことにも気づけない**
 * (多人数の部屋と 1 対 1 の部屋では、入室を知らせる口そのものが違うため)。
 *
 * ★v1.55: `allowSpectators` を省いたときは**観戦を許す**(親 §6.8.2 の既定)。
 * **既定を「許さない」にしない**＝書き忘れた部屋だけが観戦できなくなり、
 * その部屋を建てた人には理由が分からないため。
 */
export function createSeatedRoom(
  client: MomoMatchmakingApi,
  options: MomoCreateRoomOptions & { allowSpectators?: boolean },
): void {
  const { allowSpectators, ...rest } = options;
  client.createRoom({
    ...rest,
    mode: 'multi',
    maxPlayers: SHOGI_MAX_PLAYERS,
    maxSpectators: spectatorSlotsFor(allowSpectators !== false),
  });
}
