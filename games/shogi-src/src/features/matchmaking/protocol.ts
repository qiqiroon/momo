/**
 * P2P メッセージのプロトコル定義（段階 2-5.1〜）。
 *
 * 送受信するすべてのゲームメッセージは discriminated union `ShogiMessage`
 * で表現する。type フィールドで dispatcher が分岐。
 *
 * バージョニング:
 * - envelope に protocolVersion を含める。将来の非互換変更に備える。
 * - 段階 2-5.1 では v=1。
 * - 知らない type は dispatcher が黙って無視する（フォワード互換）。
 *
 * 段階 2-5.1（S06 対局準備画面のハンドシェイク）:
 * - side_select : 自分の先後選択（先手/後手/おまかせ/未選択）を相手に通知
 * - ready       : 自分の準備完了状態を相手に通知
 * - state_sync  : 画面表示時に自分の現在状態を相手に投げる（後入りキャッチアップ用）
 * - game_start  : 両者準備完了でホストが送信・両者の先後最終確定
 *
 * 段階 2-5.2 以降:
 * - move / resign / undo / draw / chat / hash_check / …
 *
 * 段階 2-7 v0.28（チャット）:
 * - chat : 対局中の会話メッセージ。発言者側と本文を含む。
 *          両者の履歴表示は共通のため、発言者側（player1=先手 / player2=後手）を
 *          相手側で描画するためにメッセージ本体に持たせる。
 */

import type { SideChoice, SideSelection } from './store';

export const PROTOCOL_VERSION = 1;

/** すべてのメッセージ共通の envelope */
interface Envelope {
  /** プロトコルバージョン（今 v=1） */
  v: number;
}

/** 自分の先後選択を相手に通知 */
export interface SideSelectMsg extends Envelope {
  type: 'side_select';
  choice: SideChoice;
}

/** 自分の準備完了状態を相手に通知 */
export interface ReadyMsg extends Envelope {
  type: 'ready';
  ready: boolean;
}

/**
 * 画面表示時のキャッチアップ用。
 * 自分の現在の先後選択・準備完了状態を相手にまとめて投げる。
 */
export interface StateSyncMsg extends Envelope {
  type: 'state_sync';
  choice: SideChoice;
  ready: boolean;
}

/**
 * 両者「おまかせ」時にホストが乱数計算して送信する振り駒結果。
 * 両者が同じ結果を受け取ってアニメを再生する。
 *
 * faceUps は 5 コマの各面（true = 表 = 歩、false = 裏 = と）。
 * hostIsSente = 表の枚数が過半なら true（同数の場合はホストが再計算して送り直す）。
 */
export interface FurigomaResultMsg extends Envelope {
  type: 'furigoma_result';
  faceUps: boolean[];
  hostIsSente: boolean;
}

/**
 * 両者準備完了でホストが送信。
 * 先後の最終確定を含む（振り駒があった場合はここで解決済み）。
 */
export interface GameStartMsg extends Envelope {
  type: 'game_start';
  hostSide: SideSelection;
  guestSide: SideSelection;
}

/**
 * 対局中の着手情報（段階 2-5.2）。
 * 送信側は自分の局面で合法性を確認済み。受信側はそのまま局面に反映する
 * （合法性の相互検証は段階 2-6 の局面ハッシュ検証で担保予定）。
 *
 * 盤上移動: kind='move' + pieceId + from + to + promote
 * 駒の打ち込み: kind='drop' + pieceId + to
 *
 * pieceId は両側の初期化で決定的に生成されるので同一。
 */
export interface MoveMsg extends Envelope {
  type: 'move';
  kind: 'move' | 'drop';
  pieceId: string;
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
  /**
   * 送信側の時計状態（v0.35 追加）。指し終わった直後の指し手側の残り時間で、
   * 受信側は自分の内部モデル（相手の時計）をこの値に上書きして時計をシンクさせる。
   * 省略時は時計調整をしない（オフライン互換 / no_limit）。
   */
  time?: {
    mainMs: number;
    byoyomiMs: number;
    inByoyomi: boolean;
  };
  /**
   * v0.52 (段階 2-6): 送信側が指し終わった直後の局面ハッシュ。
   * 受信側は着手を適用したあと自分側でハッシュを計算し、この値と一致するかを確認。
   * 一致しなければ両者の盤面がずれている (バグや通信ミスの兆候) ので警告して対局中止。
   * 省略時 (旧クライアント互換) は照合をスキップする。
   */
  hash?: string;
}

/**
 * 対局中のチャット発言（段階 2-7 v0.28）。
 * side は発言者（player1=先手／player2=後手）で、両者の表示履歴を同一に保つ。
 */
export interface ChatMsg extends Envelope {
  type: 'chat';
  side: 'player1' | 'player2';
  text: string;
}

/**
 * 投了メッセージ（段階 2-7 v0.30）。
 * side は投了した側。受信側は対応するプレイヤーを負けにし、終局モーダルを表示する。
 */
export interface ResignMsg extends Envelope {
  type: 'resign';
  side: 'player1' | 'player2';
}

/** 引分の申し出（段階 2-7 v0.33）。応答は draw_response で返す。 */
export interface DrawOfferMsg extends Envelope {
  type: 'draw_offer';
}
/** 引分申し出への応答（段階 2-7 v0.33）。accepted=true で両者引分終局。 */
export interface DrawResponseMsg extends Envelope {
  type: 'draw_response';
  accepted: boolean;
}
/**
 * 待ったの申し出（段階 2-7 v0.33、v0.42 改装）。応答は undo_response で返す。
 * count は巻き戻し手数（1=自分の1手だけ／2=相手の直前手＋自分の1手）。
 * challengerSide は申し出者の side（＝ペナルティで時計が戻らない側）。
 */
export interface UndoOfferMsg extends Envelope {
  type: 'undo_offer';
  count: number;
  challengerSide: 'player1' | 'player2';
}
/** 待った申し出への応答（v0.42）。承諾者は count/challengerSide を保持済み。 */
export interface UndoResponseMsg extends Envelope {
  type: 'undo_response';
  accepted: boolean;
}

/** 時間切れ通知（段階 2-8 v0.35）。side は時間切れになった側（＝負け）。両者検出の可能性がある idempotent 扱い。 */
export interface TimeoutMsg extends Envelope {
  type: 'timeout';
  side: 'player1' | 'player2';
}

/** 一時中断の通知（段階 2-8 v0.42）— 合意不要、相手に一方的に通知 */
export interface PauseNotifyMsg extends Envelope { type: 'pause_notify'; }
/** 生存確認 ping / pong（v0.48）— サーバー経路が瞬断した際に P2P 直通の生存確認に使う */
export interface PingMsg extends Envelope { type: 'ping'; }
export interface PongMsg extends Envelope { type: 'pong'; }
/** 再開の申し出／応答（段階 2-8 v0.41）— 両者合意で中断を解除 */
export interface ResumeOfferMsg extends Envelope { type: 'resume_offer'; }
export interface ResumeResponseMsg extends Envelope { type: 'resume_response'; accepted: boolean; }
/** 申し出の撤回（段階 2-8 v0.42）— 待った/引分 を申し出た側が取り下げる */
export interface UndoCancelMsg extends Envelope { type: 'undo_cancel'; }
export interface DrawCancelMsg extends Envelope { type: 'draw_cancel'; }

export type ShogiMessage =
  | SideSelectMsg
  | ReadyMsg
  | StateSyncMsg
  | FurigomaResultMsg
  | GameStartMsg
  | MoveMsg
  | ChatMsg
  | ResignMsg
  | DrawOfferMsg
  | DrawResponseMsg
  | UndoOfferMsg
  | UndoResponseMsg
  | TimeoutMsg
  | PauseNotifyMsg
  | ResumeOfferMsg
  | ResumeResponseMsg
  | UndoCancelMsg
  | DrawCancelMsg
  | PingMsg
  | PongMsg;

/** 型ガード：unknown をゲームメッセージとして扱えるか */
export function isShogiMessage(data: unknown): data is ShogiMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as { type?: unknown; v?: unknown };
  if (typeof m.type !== 'string') return false;
  if (typeof m.v !== 'number') return false;
  return true;
}
