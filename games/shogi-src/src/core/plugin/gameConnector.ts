/**
 * オンライン対戦と対局画面の接続点。
 *
 * core（対局画面）は features（通信機能）に直接依存できないため、
 * 通信機能が起動時に registry に登録するインターフェース経由で
 * 呼び出す。A ビルドでは features が tree-shake で除外されるので、
 * pluginGet の戻り値は undefined になり、対局画面はオフラインモードで
 * 動作する。
 */

/** v0.68: S07 のルール表示バンド用。オフライン時は null (=本将棋固定扱い)。 */
export interface ActiveRulesInfo {
  gameType: 'shogi' | 'hasami' | 'shogi-custom';
  torusMode: 'none' | 'cylinder' | 'full';
  quantum: boolean;
}

export interface RemoteMovePayload {
  kind: 'move' | 'drop';
  pieceId: string;
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
  /** v0.35: 送信直後の自分側の時計状態（相手が時計をシンクするための値） */
  time?: {
    mainMs: number;
    byoyomiMs: number;
    inByoyomi: boolean;
  };
  /** v0.52 (段階 2-6): 送信直後の自分の局面ハッシュ。受信側の照合用 */
  hash?: string;
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
  /** v0.68: S07 の上部ルール表示帯に使う。オフライン時は null (対局画面が本将棋固定扱い) */
  getActiveRules(): ActiveRulesInfo | null;
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
  /** 引分を相手に申し出る（段階 2-7 v0.33）。ローカルには offers-store で「me が申し出中」を立てる。 */
  sendDrawOffer(): void;
  /** 引分申し出への応答（段階 2-7 v0.33）。accepted=true で両者引分終局。 */
  sendDrawResponse(accepted: boolean): void;
  /**
   * 待ったを相手に申し出る（v0.42 更新）。
   * challengerSide = 申し出者の side（＝ペナルティで時計が戻らない側）。
   * count = 巻き戻し手数（1=自分の1手／2=相手の直前手＋自分の1手）。
   */
  sendUndoOffer(count: number, challengerSide: 'player1' | 'player2'): void;
  /** 待った申し出への応答（v0.42）。accepted=true で承諾側の時計だけ復元して count 手戻す。 */
  sendUndoResponse(accepted: boolean): void;
  /** 待った申し出を撤回する（v0.42）。 */
  sendUndoCancel(): void;
  /** 引分を申し出た側が撤回する（v0.42）。 */
  sendDrawCancel(): void;
  /** 自分側の時間切れを相手に通知（段階 2-8 v0.35）。 */
  sendTimeout(side: 'player1' | 'player2'): void;
  /** 一時中断を相手に通知（v0.42 で合意不要に変更）。 */
  sendPauseNotify(): void;
  /** 再開を相手に申し出る。 */
  sendResumeOffer(): void;
  /** 再開申し出への応答。accepted=true で両者再開。 */
  sendResumeResponse(accepted: boolean): void;
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
   * v0.47: サーバー経由 (WS) の連絡経路だけが一時的に切れた状態。
   * true の間、対局画面は「接続を確認中…」のバナーを表示するが、
   * 実際の対局は継続する (P2P 直通が生きている前提)。
   */
  getWsPendingReconnect(): boolean;
  /**
   * v0.48: 相手から最後にメッセージを受信した時刻 (Date.now())。null なら未受信。
   * 生存確認バナー中の判定に使う。
   */
  getLastPeerMessageAt(): number | null;
  /**
   * v0.48: 生存確認 ping を相手に送信。相手が生きていれば即 pong が返る。
   * どちらのメッセージも lastPeerMessageAt を更新するので、生存判定は
   * 「送信後 N 秒以内に lastPeerMessageAt が更新されたか」でよい。
   */
  sendPing(): void;
  /**
   * v0.48: 生存確認バナー中に P2P 直通の健在を確認できたときに呼ぶ。
   * バナーを畳んで通常状態に戻す。
   */
  markConnectionHealthy(): void;
  /**
   * v0.48: 生存確認バナー中に相手からの返事が来なかった (静かに死んだ) ときに呼ぶ。
   * 「相手退室」相当の終局モーダルへ遷移させる。
   */
  markConnectionDead(): void;
  /**
   * isOnline / getMySide / getOpponentLeftDuringGame の返り値に影響する
   * 状態変化を購読する。返り値は unsubscribe 関数。
   */
  subscribe(cb: () => void): () => void;
}
