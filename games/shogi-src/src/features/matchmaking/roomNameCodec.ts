/**
 * 部屋名エンコーダ/デコーダ。
 *
 * signaling-server は部屋一覧のレスポンスに rules を含めないため、
 * ゲーム種類/modifier などのメタ情報を部屋名の先頭にプレフィクスとして
 * 埋め込むことで、他プレイヤーがロビーから識別できるようにする。
 *
 * 形式 (v0.87 で持ち時間 T フラグ追加・v1.50 で感想戦フラグ追加):
 *   [<種類記号>(+<修飾記号>)*(+感)?(+T<時間コード>)?(:<カスタム名>)?] <ユーザー部屋名>
 *
 * 例:
 *   [本] 私の部屋               → 本将棋 (時間情報なし・旧形式)
 *   [本+TF] 私の部屋            → 本将棋 + 時間フリー
 *   [本+環] トーラス盤面        → 本将棋 + トーラス (時間情報なし・旧形式)
 *   [本+環+TB15.30] 秒読み対局  → 本将棋 + トーラス + 秒読み 15分+30秒
 *   [本+環+量+TI10.5] 全部乗せ  → 本将棋 + トーラス + 量子 + フィッシャー 10分+5秒
 *   [挟+TS15] 切れ負け対局      → はさみ将棋 + 切れ負け 15分
 *   [自+TS30:王手放置OK] おもしろ → 自由ルール将棋 + 切れ負け 30分 + カスタム名
 *   [本+量+感] 量子将棋の感想戦  → 感想戦の部屋 (持ち時間は持たない)
 *
 * 記号 (種類・修飾):
 *   種類: 本 (shogi) / 挟 (hasami) / 自 (shogi-custom)
 *   修飾: 環 (torus) / 量 (quantum)
 *   用途: 感 (review = 感想戦の部屋・v1.50 新設)
 *
 * 記号 (時間 = v0.87 新設):
 *   TF          時間フリー (no_limit)
 *   TS<分>      切れ負け sudden_death (本時間のみ)         例: TS15
 *   TB<分>.<秒> 秒読み byoyomi (本時間 + 秒読み)             例: TB15.30 / TB0.30 (秒読みのみ)
 *   TI<分>.<秒> フィッシャー fischer (本時間 + 加算)         例: TI10.5
 *   数値は分・秒単位の整数。分は 0,5,10,15,30,60、秒は 3,5,10,30,60 の想定 (S02 の選択肢)。
 *
 * なぜ T プレフィクス + 数値かつ + 区切り？:
 *   既存の flags.split('+') パーサに 1 分岐追加だけで済み、
 *   旧クライアントは T フラグを unknownFlags に退避する (種類・修飾バッジは保持される)。
 *
 * 拡張性: 新しい記号を追加するだけで拡張できる。未知の記号を含む部屋名は
 * unknown フラグと共にそのまま表示する（データを壊さない）。
 */

import type { TimeControl } from '../../core/engine/time-control';

export type GameType = 'shogi' | 'hasami' | 'shogi-custom';

export interface RoomLabelParts {
  gameType: GameType;
  torus: boolean;
  quantum: boolean;
  /** v0.87: 部屋名から復元した持ち時間 (T フラグが無い旧形式では undefined) */
  timeControl?: TimeControl;
  /**
   * v1.50: 感想戦の部屋か (親 §9.4／画面機能 §3 S04)。
   * **対局の部屋と同じ一覧に並べ、印で見分けられるようにする**ので、
   * 一覧を分けるのではなく部屋そのものに用途を持たせる。
   */
  review: boolean;
  /**
   * ★v1.61 (親 §6.3.6): **感想戦の部屋へ移るときの、その場限りの「待ち合わせの印」**。
   *
   * **パスワードではない**＝公開・非公開とパスワードは**元の部屋のものを引き継ぐ**
   * ので（§9.4.4）、**どれが移り先かを見分ける手立てを別に持つ**。
   * **人には見せない**（バッジにも出さない）。無いときは undefined。
   */
  meetToken?: string;
  customRuleName?: string;
  userRoomName: string;
  /** decode で認識できなかったフラグ記号 */
  unknownFlags: string[];
  /** そもそも [...] プレフィクスがない古い形式 or 生入力 */
  unrecognized: boolean;
}

/**
 * ★v1.61: 待ち合わせの印の頭文字（親 §6.3.6）。**時間フラグ `T` と衝突しない字**を選ぶ。
 * 印そのものは 16 進の短い文字列で、**その場限り**（部屋が建つたびに作り直す）。
 */
const MEET_PREFIX = 'M';

const GAME_TYPE_CHAR: Record<GameType, string> = {
  shogi: '本',
  hasami: '挟',
  'shogi-custom': '自',
};

const CHAR_TO_GAME_TYPE: Record<string, GameType> = {
  本: 'shogi',
  挟: 'hasami',
  自: 'shogi-custom',
};

const MODIFIER_TORUS = '環';
const MODIFIER_QUANTUM = '量';
/** v1.50: 感想戦の部屋の印。**用途**であって盤のルールの修飾ではない。 */
const PURPOSE_REVIEW = '感';

export interface EncodeInput {
  gameType: GameType;
  torus: boolean;
  quantum: boolean;
  /** v0.87: 持ち時間を T フラグとして部屋名に埋め込む (省略時は T フラグ無しに) */
  timeControl?: TimeControl;
  /** v1.50: 感想戦の部屋として建てる (持ち時間は持たない)。 */
  review?: boolean;
  /**
   * ★v1.61: 待ち合わせの印（親 §6.3.6）。**パスワードではない**ので、
   * **公開・非公開とパスワードは元の部屋のものを引き継ぐ**（§9.4.4）。
   */
  meetToken?: string;
  customRuleName?: string;
  userRoomName: string;
}

/**
 * v0.87: TimeControl を T プレフィクス付きの 1 フラグにエンコード。
 * no_limit → TF / sudden_death → TS<分> / byoyomi → TB<分>.<秒> / fischer → TI<分>.<秒>
 */
export function encodeTimeFlag(tc: TimeControl): string {
  const min = Math.floor(tc.mainSeconds / 60);
  switch (tc.mode) {
    case 'no_limit':
      return 'TF';
    case 'sudden_death':
      return `TS${min}`;
    case 'byoyomi':
      return `TB${min}.${tc.byoyomiSeconds ?? 0}`;
    case 'fischer':
      return `TI${min}.${tc.incrementSeconds ?? 0}`;
  }
}

/**
 * v0.87: T プレフィクス付き 1 フラグを TimeControl にデコード。
 * 認識できない場合 null (呼び出し側で undefined として timeControl に入れる)。
 */
export function decodeTimeFlag(flag: string): TimeControl | null {
  if (!flag.startsWith('T') || flag.length < 2) return null;
  const body = flag.slice(1);
  if (body === 'F') return { mode: 'no_limit', mainSeconds: 0 };
  const modeChar = body[0];
  const rest = body.slice(1);
  if (modeChar === 'S') {
    const min = Number(rest);
    if (!Number.isFinite(min) || min < 0) return null;
    return { mode: 'sudden_death', mainSeconds: min * 60 };
  }
  const dot = rest.indexOf('.');
  if (dot < 0) return null;
  const min = Number(rest.slice(0, dot));
  const sub = Number(rest.slice(dot + 1));
  if (!Number.isFinite(min) || !Number.isFinite(sub) || min < 0 || sub < 0) return null;
  if (modeChar === 'B') {
    return { mode: 'byoyomi', mainSeconds: min * 60, byoyomiSeconds: sub };
  }
  if (modeChar === 'I') {
    return { mode: 'fischer', mainSeconds: min * 60, incrementSeconds: sub };
  }
  return null;
}

/**
 * config を部屋名文字列にエンコードする。
 * userRoomName が空でも `[本] ` の形は保つ（後方で trim される可能性はあるが
 * サーバーはこの文字列を素通しするので decode 側で対応する）。
 */
export function encodeRoomName(input: EncodeInput): string {
  const gameChar = GAME_TYPE_CHAR[input.gameType] ?? GAME_TYPE_CHAR.shogi;
  const parts: string[] = [gameChar];
  if (input.torus) parts.push(MODIFIER_TORUS);
  if (input.quantum) parts.push(MODIFIER_QUANTUM);
  // v1.50: 用途 (感) は修飾のあと・時間の前。感想戦の部屋は持ち時間を持たない。
  if (input.review) parts.push(PURPOSE_REVIEW);
  // v0.87: 時間フラグは修飾記号列の末尾 + カスタム名の前に置く (順序:
  // 種類 → 修飾 (環/量) → 用途 (感) → 時間 (T*) → カスタム名 (:))
  if (input.timeControl) parts.push(encodeTimeFlag(input.timeControl));
  // ★v1.61: 待ち合わせの印 (M プレフィクス)。**人には見せない**ので、
  // decode 側は unknownFlags へ落とさずに専用の欄で受ける。
  if (input.meetToken) parts.push(`${MEET_PREFIX}${input.meetToken}`);
  const prefixInside =
    input.gameType === 'shogi-custom' && input.customRuleName?.trim()
      ? `${parts.join('+')}:${input.customRuleName.trim()}`
      : parts.join('+');
  const userPart = input.userRoomName.trim();
  return userPart ? `[${prefixInside}] ${userPart}` : `[${prefixInside}]`;
}

/**
 * 部屋名文字列を decode する。
 * [...] プレフィクスがない or 記号が全く認識できない場合、unrecognized=true で
 * 全体を userRoomName にフォールバック（見えなくなるより良い）。
 */
export function decodeRoomName(raw: string): RoomLabelParts {
  const trimmed = raw ?? '';
  const m = trimmed.match(/^\[([^\]]*)\]\s?(.*)$/);
  if (!m) {
    return {
      gameType: 'shogi',
      torus: false,
      quantum: false,
      review: false,
      userRoomName: trimmed,
      unknownFlags: [],
      unrecognized: true,
    };
  }
  const inside = m[1];
  const userRoomName = m[2];
  // ":" でカスタム名を切り出す
  const colonIdx = inside.indexOf(':');
  const flagsPart = colonIdx >= 0 ? inside.slice(0, colonIdx) : inside;
  const customRuleName = colonIdx >= 0 ? inside.slice(colonIdx + 1).trim() || undefined : undefined;
  const flags = flagsPart.split('+').filter((s) => s.length > 0);
  let gameType: GameType | null = null;
  let torus = false;
  let quantum = false;
  let review = false;
  let timeControl: TimeControl | undefined = undefined;
  let meetToken: string | undefined = undefined;
  const unknownFlags: string[] = [];
  for (const f of flags) {
    if (gameType == null && CHAR_TO_GAME_TYPE[f]) {
      gameType = CHAR_TO_GAME_TYPE[f];
      continue;
    }
    if (f === MODIFIER_TORUS) {
      torus = true;
      continue;
    }
    if (f === MODIFIER_QUANTUM) {
      quantum = true;
      continue;
    }
    if (f === PURPOSE_REVIEW) {
      review = true;
      continue;
    }
    // ★v1.61: 待ち合わせの印 (M プレフィクス)。**バッジには出さない**
    // （unknownFlags へ落とすと、人に見える印になってしまう）。
    if (f.length > 1 && f.startsWith(MEET_PREFIX)) {
      meetToken = f.slice(1);
      continue;
    }
    // v0.87: 時間フラグ (T プレフィクス) を先に判定してから unknown に落とす
    if (f.startsWith('T')) {
      const tc = decodeTimeFlag(f);
      if (tc) {
        timeControl = tc;
        continue;
      }
    }
    unknownFlags.push(f);
  }
  return {
    gameType: gameType ?? 'shogi',
    torus,
    quantum,
    review,
    timeControl,
    meetToken,
    customRuleName,
    userRoomName,
    unknownFlags,
    unrecognized: gameType == null,
  };
}

/**
 * ロケール別のバッジラベル。
 * 中国語モードは「日本語のまま」の指示に従い ja と同じテキストを返す。
 */
export interface BadgeLabels {
  gameType: Record<GameType, string>;
  torus: string;
  quantum: string;
  /** v1.50: 感想戦の部屋の印 (付録D-12 §8)。 */
  review: string;
  unknown: string;
}

const LABELS_JA: BadgeLabels = {
  gameType: { shogi: '本将棋', hasami: 'はさみ', 'shogi-custom': '自由' },
  torus: 'トーラス',
  quantum: '量子',
  review: '感想戦',
  unknown: '?',
};

const LABELS_EN: BadgeLabels = {
  gameType: { shogi: 'Shogi', hasami: 'Hasami', 'shogi-custom': 'Custom' },
  torus: 'Torus',
  quantum: 'Quantum',
  review: 'Review',
  unknown: '?',
};

export function getBadgeLabels(locale: string): BadgeLabels {
  if (locale === 'en') return LABELS_EN;
  // ja / zh / cat すべて日本語ラベルを使う
  return LABELS_JA;
}
