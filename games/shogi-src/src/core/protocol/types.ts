import type { Move, PieceId, Square } from '../engine';

/**
 * 対局メッセージプロトコル (親仕様 §6.3)。
 * P2P 経由で相手プレイヤーに送信される discriminated union。
 * 各メッセージには moveNumber (現在の手数) が含まれ、受信側は自らの moveNumber と照合して整合性を担保する。
 *
 * 実装フェーズ:
 * - 段階 2-1 (現): 型定義のみ (skeleton)
 * - 段階 2-5: 送信・受信ロジック
 * - 段階 2-6: hash 相互検証
 * - 段階 2-7: undo_request・resign・draw_offer・chat の handler
 */

export interface ShogiMessageBase {
  moveNumber: number;
  timestamp?: number;
}

export interface ShogiMoveMessage extends ShogiMessageBase {
  type: 'move';
  move: Move;
  positionHash: string;
}

export interface ShogiHashVerifyMessage extends ShogiMessageBase {
  type: 'hash_verify';
  positionHash: string;
}

export interface ShogiChatMessage extends ShogiMessageBase {
  type: 'chat';
  text: string;
}

export interface ShogiResignMessage extends ShogiMessageBase {
  type: 'resign';
}

export interface ShogiDrawOfferMessage extends ShogiMessageBase {
  type: 'draw_offer';
}

export interface ShogiDrawAcceptMessage extends ShogiMessageBase {
  type: 'draw_accept';
  accept: boolean;
}

export interface ShogiUndoRequestMessage extends ShogiMessageBase {
  type: 'undo_request';
}

export interface ShogiUndoResponseMessage extends ShogiMessageBase {
  type: 'undo_response';
  accept: boolean;
}

export interface ShogiPauseRequestMessage extends ShogiMessageBase {
  type: 'pause_request';
}

export interface ShogiNyugyokuDeclareMessage extends ShogiMessageBase {
  type: 'nyugyoku_declare';
}

export type ShogiMessage =
  | ShogiMoveMessage
  | ShogiHashVerifyMessage
  | ShogiChatMessage
  | ShogiResignMessage
  | ShogiDrawOfferMessage
  | ShogiDrawAcceptMessage
  | ShogiUndoRequestMessage
  | ShogiUndoResponseMessage
  | ShogiPauseRequestMessage
  | ShogiNyugyokuDeclareMessage;

/** 段階 2-5 で使用予定: 未知のメッセージ受信時のフォールバック処理識別子。 */
export type ShogiMessageType = ShogiMessage['type'];

/**
 * 型ガード群。受信データがメッセージであるかの検証や、handler の絞り込みに使用。
 */
export function isShogiMessage(v: unknown): v is ShogiMessage {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as { type?: unknown };
  return typeof obj.type === 'string';
}

/** Move メッセージ生成のヘルパ (段階 2-5 で本使用)。 */
export function createMoveMessage(move: Move, moveNumber: number, positionHash: string): ShogiMoveMessage {
  return { type: 'move', move, moveNumber, positionHash };
}

// 未使用 export 警告を避けるための型スタブ (段階 2-5 で削除予定)
export type __Unused_types_hint = PieceId | Square;
