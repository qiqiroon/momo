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
  /**
   * チャット用の自分側識別子（段階 v0.32）。
   * gameStartInfo があれば実 side、なければ入室中は isHost で暫定 side、
   * 未接続時は null。S06 対局準備画面のチャットで use される。
   */
  getMyChatSide(): 'player1' | 'player2' | null;
  /** 自分の表示名（ロビーで入力したもの）。オフライン時／未設定時は空文字。段階 2-7 v0.29 追加。 */
  getMyName(): string;
  /** 相手の表示名。オフライン時／未取得時は空文字。段階 2-7 v0.29 追加。 */
  getOpponentName(): string;
  /** 自分の着手を相手に送信 */
  sendMove(payload: RemoteMovePayload): void;
  /**
   * 自分のチャット発言を相手に送信し、ローカルの履歴にも追加する。
   * 空文字や isOnline=false の場合は何もしない。段階 2-7 v0.28。
   */
  sendChat(text: string): void;
  /**
   * 自分の投了を相手に送信し、ローカルの盤面状態も投了扱いにする。
   * オフライン時（isOnline=false）は指定側をローカルに投了させるだけ。段階 2-7 v0.30。
   */
  sendResign(side: 'player1' | 'player2'): void;
  /**
   * オンライン対局を離脱する。退室通知を送り、通信対戦ロビーに戻る。
   */
  leaveOnline(): void;
  /**
   * 対局終了後に部屋を継続したまま S06 対局準備画面に戻す。段階 v0.31。
   * ハンドシェイク（先後選択・準備完了・振り駒結果・gameStartInfo）と
   * 盤面・チャットをリセットし、対戦相手との接続はそのまま。
   */
  returnToPreparation(): void;
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
