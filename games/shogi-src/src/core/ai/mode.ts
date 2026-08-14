/**
 * 対局設定から「AI を選ぶときのモード」を決める (親 §7.1.1・付録 D-5 §6.3 の列)。
 *
 * 区分は 4 つ。**上から順に当てはめる**(量子が最優先)。
 *   量子     … 量子 ON (盤の端のつなぎ方は問わない)
 *   トーラス … 円筒または完全トーラス ON (量子 OFF)
 *   変則     … はさみ将棋等のプリセット、および保存したカスタムルール (平面盤・量子 OFF)
 *   本将棋   … プリセット本将棋・平面盤・量子 OFF
 *
 * 量子を最優先にしているのは、量子が**駒の正体が確定していない**という
 * いちばん特殊な条件で、そこで動けるかどうかが思考ルーチンの適性を最も強く分けるため。
 */

import type { AiMode } from './types';

export interface AiModeInput {
  gameType?: string | null;
  torusMode?: string | null;
  quantum?: boolean | null;
}

export function aiModeFrom(rules: AiModeInput | null | undefined): AiMode {
  if (!rules) return 'shogi';
  if (rules.quantum) return 'quantum';
  if (rules.torusMode && rules.torusMode !== 'none') return 'torus';
  if (rules.gameType && rules.gameType !== 'shogi') return 'variant';
  return 'shogi';
}

/** 一覧で「なぜ選べないか」を示すための区分 (付録 D-5 §6.2 の理由バッジ)。 */
export function unsupportedReasonKey(mode: AiMode): string {
  switch (mode) {
    case 'quantum':
      return 'ai.unsupported.quantum';
    case 'torus':
      return 'ai.unsupported.torus';
    case 'variant':
      return 'ai.unsupported.variant';
    default:
      return 'ai.unsupported.shogi';
  }
}
