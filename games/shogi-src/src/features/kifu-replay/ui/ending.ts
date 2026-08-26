/**
 * 棋譜に残った終局を言葉にする（親 v1.40 §9.2.4・付録D-8 §6）。
 *
 * **投了・時間切れ・合意による中断は手ではない**ので、手の並びだけを見ても
 * 「どう終わったか」「どちらが勝ったか」は分からない。素性ブロックに残っている
 * 終局の理由と勝者から、対局画面とまったく同じ言葉を組み立てる。
 *
 * **同じことを 2 通りの言葉で呼ばない**ため、理由名の翻訳キーは対局画面と共用する。
 */

import type { LocaleCode } from '../../../core/i18n/types';
import { t as _t } from '../../../core/i18n';
import type { GameStatus } from '../../../core/store/game-store';

/** 終局の理由 → 翻訳キー。対局画面（GameScreen の結果パネル）と同じ対応。 */
function reasonKeyOf(status: GameStatus): string | null {
  switch (status) {
    case 'checkmate':
      return 'result.reason.checkmate';
    case 'nyugyoku_win_p1':
    case 'nyugyoku_win_p2':
      return 'result.reason.nyugyoku';
    case 'resigned_p1':
    case 'resigned_p2':
      return 'result.reason.resign';
    case 'sennichite':
      return 'result.reason.sennichite';
    case 'stalemate':
      // ★v1.90: ステイルメイト (親 §3.10・チェス §5.5.5)。
      return 'result.reason.stalemate';
    case 'stalemate_loss_p1':
    case 'stalemate_loss_p2':
      return 'result.reason.stalemate_loss';
    case 'agreed_draw':
      return 'result.reason.agreed_draw';
    case 'jishogi':
      return 'result.reason.jishogi';
    case 'timeout_p1':
    case 'timeout_p2':
      return 'result.reason.timeout';
    case 'nogame':
      return 'result.reason.nogame';
    case 'annihilation_win_p1':
    case 'annihilation_win_p2':
      return 'result.reason.annihilation';
    default:
      // 'playing' と、まだ言葉を持たない終局理由。**何も出さない**＝
      // 分からないことを分かったふりで書かない。
      return null;
  }
}

/**
 * 「投了 ☗先手の勝ち」のような 1 行を返す。
 *
 * **終局の記録を持たない古い棋譜では null**（縮退互換・親 §9.2.4）。
 * ファイル形式の版は上げていないので、古いファイルもそのまま読めることが要る。
 */
export function endingLabel(
  result: { status: GameStatus; winner: 'player1' | 'player2' | null } | undefined,
  locale: LocaleCode,
): string | null {
  if (!result) return null;
  const key = reasonKeyOf(result.status);
  if (!key) return null;
  const t = (k: string) => _t(k, locale);
  const reason = t(key);
  if (result.status === 'nogame') return `${reason}・${t('result.verdict.nogame')}`;
  if (result.winner === null) return `${reason}・${t('result.verdict.draw')}`;
  return `${reason}・${t(
    result.winner === 'player1' ? 'result.verdict.senteWin' : 'result.verdict.goteWin',
  )}`;
}
