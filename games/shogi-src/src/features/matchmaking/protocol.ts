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
 * 両者準備完了でホストが送信。
 * 先後の最終確定を含む（振り駒があった場合はここで解決済み）。
 */
export interface GameStartMsg extends Envelope {
  type: 'game_start';
  hostSide: SideSelection;
  guestSide: SideSelection;
}

export type ShogiMessage = SideSelectMsg | ReadyMsg | StateSyncMsg | GameStartMsg;

/** 型ガード：unknown をゲームメッセージとして扱えるか */
export function isShogiMessage(data: unknown): data is ShogiMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as { type?: unknown; v?: unknown };
  if (typeof m.type !== 'string') return false;
  if (typeof m.v !== 'number') return false;
  return true;
}
