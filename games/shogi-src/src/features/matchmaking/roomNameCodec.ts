/**
 * 部屋名エンコーダ/デコーダ。
 *
 * signaling-server は部屋一覧のレスポンスに rules を含めないため、
 * ゲーム種類/modifier などのメタ情報を部屋名の先頭にプレフィクスとして
 * 埋め込むことで、他プレイヤーがロビーから識別できるようにする。
 *
 * 形式:
 *   [<種類記号><+修飾記号...>:<カスタム名>] <ユーザー部屋名>
 *
 * 例:
 *   [本] 私の部屋              → 本将棋
 *   [本+環] トーラス盤面      → 本将棋 + トーラス盤面
 *   [本+環+量] 全部乗せ        → 本将棋 + トーラス + 量子
 *   [挟] はさみ将棋の部屋      → はさみ将棋
 *   [自:王手放置OK] おもしろルール → 自由ルール将棋 + カスタム名
 *
 * 記号:
 *   種類: 本 (shogi) / 挟 (hasami) / 自 (shogi-custom)
 *   修飾: 環 (torus) / 量 (quantum)
 *
 * 拡張性: 新しい記号を追加するだけで拡張できる。未知の記号を含む部屋名は
 * unknown フラグと共にそのまま表示する（データを壊さない）。
 */

export type GameType = 'shogi' | 'hasami' | 'shogi-custom';

export interface RoomLabelParts {
  gameType: GameType;
  torus: boolean;
  quantum: boolean;
  customRuleName?: string;
  userRoomName: string;
  /** decode で認識できなかったフラグ記号 */
  unknownFlags: string[];
  /** そもそも [...] プレフィクスがない古い形式 or 生入力 */
  unrecognized: boolean;
}

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

export interface EncodeInput {
  gameType: GameType;
  torus: boolean;
  quantum: boolean;
  customRuleName?: string;
  userRoomName: string;
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
    unknownFlags.push(f);
  }
  return {
    gameType: gameType ?? 'shogi',
    torus,
    quantum,
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
  unknown: string;
}

const LABELS_JA: BadgeLabels = {
  gameType: { shogi: '本将棋', hasami: 'はさみ', 'shogi-custom': '自由' },
  torus: 'トーラス',
  quantum: '量子',
  unknown: '?',
};

const LABELS_EN: BadgeLabels = {
  gameType: { shogi: 'Shogi', hasami: 'Hasami', 'shogi-custom': 'Custom' },
  torus: 'Torus',
  quantum: 'Quantum',
  unknown: '?',
};

export function getBadgeLabels(locale: string): BadgeLabels {
  if (locale === 'en') return LABELS_EN;
  // ja / zh / cat すべて日本語ラベルを使う
  return LABELS_JA;
}
