/**
 * オンライン対戦と対局画面の接続点。
 *
 * core（対局画面）は features（通信機能）に直接依存できないため、
 * 通信機能が起動時に registry に登録するインターフェース経由で
 * 呼び出す。A ビルドでは features が tree-shake で除外されるので、
 * pluginGet の戻り値は undefined になり、対局画面はオフラインモードで
 * 動作する。
 */

export interface RemoteMovePayload {
  kind: 'move' | 'drop';
  pieceId: string;
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
}

export interface OnlineGameConnector {
  /** オンライン対戦の対局中か（game_start 済み・game_end 前） */
  isOnline(): boolean;
  /** 自分の側（先手 = player1、後手 = player2）。オフライン時は null */
  getMySide(): 'player1' | 'player2' | null;
  /** 自分の着手を相手に送信 */
  sendMove(payload: RemoteMovePayload): void;
  /**
   * オンライン対局を離脱する。退室通知を送り、通信対戦ロビーに戻る。
   */
  leaveOnline(): void;
  /**
   * 対局中に相手が退室 or 通信が切断されたか。true なら対局画面が退室モーダルを表示する。
   */
  getOpponentLeftDuringGame(): boolean;
  /**
   * isOnline / getMySide / getOpponentLeftDuringGame の返り値に影響する
   * 状態変化を購読する。返り値は unsubscribe 関数。
   */
  subscribe(cb: () => void): () => void;
}
