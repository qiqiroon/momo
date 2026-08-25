import { create } from 'zustand';
import type { MomoRoomInfo, MomoRole, MomoRosterEntry } from './client';
import type { GameType } from './roomNameCodec';
// v0.35: TimeControl 型は core に移動（game-store でも使うため）。ここでは re-export。
import { DEFAULT_TIME_CONTROL, type TimeControl, type TimeControlMode } from '../../core/engine/time-control';
import type { HandicapChoice } from '../../core/engine/handicap';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'in_room' | 'game_connected';

/**
 * 段階 2-5 で RoomScreen が両者の先後選択を扱う際に再利用する型。
 * 段階 2-4 時点では RoomConfig からは外し、部屋作成前には決めない。
 */
export type SideSelection = 'sente' | 'gote';
/** S06 対局準備画面での先後選択（振り駒待ちを含む） */
export type SideChoice = 'sente' | 'gote' | 'random' | null;
export { DEFAULT_TIME_CONTROL };
export type { TimeControl, TimeControlMode };

/** v0.57 段階 2-4: トーラス盤の詳細モード (S02 モック追随)
 *  - 'none'     : 平面盤 (通常)
 *  - 'cylinder' : 円筒 (左右がつながる)
 *  - 'full'     : 完全トーラス (上下左右すべてつながる)
 *  部屋名にはブール (トーラス有無) しか載らないため、cylinder/full の別は
 *  部屋のルール (サーバー中継) とルール同期の両方で送る (v1.20 / Phase 5-12)。
 */
export type TorusMode = 'none' | 'cylinder' | 'full';

/**
 * Phase 5-12: ルール同期の進み具合 (S06 の同期表示が読む)。
 *  - 'idle'   : まだ始まっていない (相手が未入室 / 旧クライアント相手で何も来ない)
 *  - 'sent'   : ホストが送って受領確認を待っている
 *  - 'ok'     : 揃った
 *  - 'failed' : 相手が扱えない、または照合が食い違った
 */
export type RuleSyncPhase = 'idle' | 'sent' | 'ok' | 'failed';

/** v0.57 段階 2-4: 量子将棋の未確定駒表示方式 (S02 モック追随)
 *  - 'cycle' : 1秒ごとに候補を1つずつ表示 (巡回)
 *  - 'stack' : 全候補を黒で重ねる (重ね)
 *  設定者側 (ホスト) が選んだ方式を両プレイヤーに共通適用する。
 */
export type QuantumDisplayMode = 'cycle' | 'stack';

export interface RoomConfig {
  /** ユーザーが入力した「素の」部屋名。encode 前・decode 後の状態を保持する。 */
  roomName: string;
  password: string;
  isPublic: boolean;
  /** ゲーム種類 (Phase 2 時点では本将棋/はさみ将棋の 2 択、自由ルールは Phase 3 で MGF 対応時に追加) */
  gameType: GameType;
  /** トーラス盤面 ON/OFF (対局実装は Phase 3+、現状はラベル用途) */
  torus: boolean;
  /** v0.57: トーラスの詳細モード (S02 の 3 択セグメント。torus と連動、torus=false のとき常に 'none') */
  torusMode: TorusMode;
  /** 量子将棋 ON/OFF (対局実装は Phase 3+、現状はラベル用途) */
  quantum: boolean;
  /** v0.57: 未確定駒の表示方式 (S02 の 2 択、両プレイヤー共通適用) */
  quantumDisplayMode: QuantumDisplayMode;
  /** 読み込んだカスタムルール (custom・§5.0) の名前 (MGF の metadata.game_name)。
   *  部屋名・棋譜・準備完了カードに出す。定義そのものをネットで運ぶのは段B②。 */
  customRuleName?: string;
  timeControl: TimeControl;
  /**
   * 手合い (駒落ち)。両方平手なら null。親 v1.28 §3.12.1 / 付録D-2 v1.6 §3.1。
   *
   * ルールの一部として S02 で決め、**ネット対戦・オフライン対人・対AI の 3 経路で共通**に使う。
   * giver は陣営ではなく**席**で持つ — S02 の時点では先後がまだ決まっていないため
   * (先後は手合いから決まる)。ネット対戦では **部屋を作った側から見た向き**が正で、
   * 受け取った側は自分から見た向きに読み替えて表示する。
   */
  handicap: HandicapChoice | null;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  roomName: '',
  password: '',
  isPublic: true,
  gameType: 'shogi',
  torus: false,
  torusMode: 'none',
  quantum: false,
  quantumDisplayMode: 'cycle',
  timeControl: DEFAULT_TIME_CONTROL,
  handicap: null,
};

interface MatchmakingState {
  connection: ConnectionStatus;
  rooms: MomoRoomInfo[];
  currentRoomId: string | null;
  currentRoomName: string;
  isHost: boolean;
  /** 相手プレイヤー名 (ホスト側=ゲスト名、ゲスト側=ホスト名) */
  opponentName: string;
  /**
   * v1.53 (親 §6.1): 参加者名簿。**対局相手を知りたいときはここから席で選ぶ**。
   * 「自分以外の 1 人」を相手とみなしてはならない (観戦者が混じるため)。
   */
  roster: MomoRosterEntry[];
  /** v1.53: 多人数の部屋での自分の参加者 ID。 */
  myPid: string | null;
  /** v1.53: 多人数の部屋での自分の立場 (席の有無)。 */
  myRole: MomoRole | null;
  /**
   * ★v1.55 (親 §6.8.4): 席に着いている二人の名前。**観戦者の画面だけが読む**。
   *
   * 観戦者には「あなた／あいて」が使えないので、ホストが `spectate_sync` で配る。
   * 対局者の画面はこれを見ない（従来どおり playerName / opponentName）ので、
   * **null のままでも対局には何も起きない**。
   */
  seatNames: { host: string; guest: string } | null;
  /**
   * ★v1.55 (親 §6.8.4): 観戦者が「いまの対局」をまだ受け取っていない。
   *
   * **黙って空の盤を見せない**ため＝受け取る前と、受け取った結果が空である
   * ことを、見ている人が区別できないため（画面機能 §3 S06）。
   */
  spectateWaiting: boolean;
  /** 現在部屋のルール設定 (段階 2-4 では表示用) */
  activeRoomConfig: RoomConfig | null;
  /**
   * ★v1.61 (親 §6.3.6／§9.4.4): **いま居る部屋の入り方**（合言葉と、一覧に出るか）。
   *
   * **感想戦の部屋へ移るとき、元の部屋と同じ入れ方で建て直すため**に要る。
   * v1.60 までは**移り先を必ず非公開＋その場限りの合言葉**で建てていたので、
   * **元の部屋が公開でも移り先は非公開になり、一度出た観戦者は戻れなかった**。
   *
   * **入るたび・建てるたびに決め直す**＝**消す処理を持たない**（消し忘れも消しすぎも
   * 起こらない）。部屋を出ても残るが、**次に入った時点で必ず上書きされる**。
   * **画面には出さない**（合言葉は人に見せない）。
   */
  roomPassword: string;
  roomIsPublic: boolean;
  errorMessage: string | null;
  playerName: string;
  pendingRoomConfig: RoomConfig;
  /**
   * ユーザーが自分から部屋を出た直後を表すフラグ。
   * サーバーは host_leave / guest_leave を受け取ると本人にも
   * room_closed を送り返してくる。これがクライアントの onDisconnected
   * を発火し、ロビー画面が「未接続」表示に落ちるバグの原因になるため、
   * このフラグが true の間に届いた onDisconnected は無視する。
   * 一度消費したら false に戻す。
   */
  intentionallyLeft: boolean;

  /** 自分の先後選択（S06 で選ぶ） */
  mySideChoice: SideChoice;
  /** 相手の先後選択（S06 で相手から受信） */
  oppSideChoice: SideChoice;
  /** 自分の準備完了状態 */
  myReady: boolean;
  /** 相手の準備完了状態 */
  oppReady: boolean;
  /**
   * 振り駒の結果（両者「おまかせ」時にホストが計算 → 両者に配信 → 両者で同じ表示）。
   * null = 未実施 or リセット済み。faceUps は 5 コマの表裏。
   */
  furigomaResult: { faceUps: boolean[]; hostIsSente: boolean } | null;
  /** v0.53 段階 2-5.3: 公平な振り駒。自分の乱数 nonce (未リビール時は隠しておく値) */
  myFurigomaNonce: string | null;
  /** 自分の nonce の SHA-256 ハッシュ (相手に先に送るコミット値) */
  myFurigomaCommit: string | null;
  /** 相手から受信したコミット (相手の nonce のハッシュ) */
  oppFurigomaCommit: string | null;
  /** 相手から受信した nonce (リビール値)。ハッシュ検証済み */
  oppFurigomaNonce: string | null;
  /** 自分のリビール送信済みフラグ (二重送信防止) */
  myFurigomaRevealed: boolean;
  /** 検証失敗時のエラーメッセージ (相手のリビールがコミットと不一致だった等) */
  furigomaError: string | null;
  /** 対局開始時にホストが確定した先後（S07 対局画面が使用予定・段階 2-5.2） */
  gameStartInfo: { hostSide: SideSelection; guestSide: SideSelection } | null;
  /**
   * 対局中に相手が退室した／通信が切断された。v0.27 追加。
   * 対局画面がこのフラグを見てモーダルを表示、ユーザーに退室を促す。
   */
  opponentLeftDuringGame: boolean;
  /**
   * v0.47 追加: サーバー経由の連絡経路 (WebSocket) だけが一時的に切れた状態。
   * P2P DataChannel (相手との直通経路) は健在の可能性が高いので、20 秒間は
   * 対局を殺さず様子見する。20 秒以内に P2P も切れれば opponentLeftDuringGame へ
   * escalate、切れなければ猶予期間終了で単にフラグを畳む (対局は続行)。
   */
  wsPendingReconnect: boolean;
  /**
   * v0.48 追加: 相手から最後に何らかのメッセージを受信した時刻 (Date.now())。
   * 生存確認の判定に使う。ping/pong に限らず、move や chat も生存の証となる。
   */
  lastPeerMessageAt: number | null;
  /** Phase 5-12: ルール同期の進み具合 */
  ruleSyncPhase: RuleSyncPhase;
  /**
   * Phase 5-12: 揃わなかった理由コード (親 §6.5.1)。'failed' 以外では null。
   * 画面には共通の警告文だけを出し、コードは食い違いの切り分け用に持っておく。
   */
  ruleSyncReason: string | null;

  setConnection: (c: ConnectionStatus) => void;
  setRooms: (rooms: MomoRoomInfo[]) => void;
  setCurrentRoom: (info: { roomId: string | null; roomName: string; isHost: boolean }) => void;
  /** v1.53: 部屋に入った/建てたときの多人数情報をまとめて置く。 */
  setMultiInfo: (info: { pid: string | null; role: MomoRole; roster: MomoRosterEntry[] }) => void;
  /** v1.53: 名簿だけ差し替える (誰かが出入りしたとき)。 */
  setRoster: (roster: MomoRosterEntry[]) => void;
  setOpponentName: (name: string) => void;
  setActiveRoomConfig: (config: RoomConfig | null) => void;
  setError: (msg: string | null) => void;
  setPlayerName: (name: string) => void;
  setPendingRoomConfig: (config: Partial<RoomConfig>) => void;
  resetPendingRoomConfig: () => void;
  resetRoomState: () => void;
  setIntentionallyLeft: (v: boolean) => void;
  setMySideChoice: (c: SideChoice) => void;
  setOppSideChoice: (c: SideChoice) => void;
  setMyReady: (b: boolean) => void;
  setOppReady: (b: boolean) => void;
  setFurigomaResult: (r: MatchmakingState['furigomaResult']) => void;
  setMyFurigomaCommit: (nonce: string, commit: string) => void;
  setOppFurigomaCommit: (commit: string) => void;
  setOppFurigomaNonce: (nonce: string) => void;
  setMyFurigomaRevealed: (v: boolean) => void;
  setFurigomaError: (msg: string | null) => void;
  resetFurigoma: () => void;
  setGameStartInfo: (info: MatchmakingState['gameStartInfo']) => void;
  setOpponentLeftDuringGame: (b: boolean) => void;
  setWsPendingReconnect: (b: boolean) => void;
  setLastPeerMessageAt: (t: number | null) => void;
  setRuleSync: (phase: RuleSyncPhase, reason?: string | null) => void;
  resetHandshake: () => void;
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  connection: 'disconnected',
  rooms: [],
  currentRoomId: null,
  currentRoomName: '',
  isHost: false,
  opponentName: '',
  roster: [],
  myPid: null,
  myRole: null,
  seatNames: null,
  spectateWaiting: false,
  activeRoomConfig: null,
  roomPassword: '',
  roomIsPublic: true,
  errorMessage: null,
  playerName: '',
  pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG },
  intentionallyLeft: false,
  mySideChoice: null,
  oppSideChoice: null,
  myReady: false,
  oppReady: false,
  furigomaResult: null,
  myFurigomaNonce: null,
  myFurigomaCommit: null,
  oppFurigomaCommit: null,
  oppFurigomaNonce: null,
  myFurigomaRevealed: false,
  furigomaError: null,
  gameStartInfo: null,
  opponentLeftDuringGame: false,
  wsPendingReconnect: false,
  lastPeerMessageAt: null,
  ruleSyncPhase: 'idle',
  ruleSyncReason: null,

  setConnection: (c) => set({ connection: c }),
  setRooms: (rooms) => set({ rooms }),
  /**
   * ★v1.59: **部屋に入るたび「自分から出た」の印を決め直す**（親 §6.8.6 の実装で判明）。
   *
   * この印は「出た直後に返ってくる知らせを無視する」ための使い捨てだが、
   * **消えるのはその知らせが実際に届いたときだけ**だった。**自分から出たあと、
   * 何も届かないまま次の部屋へ入ると、印は立ったまま持ち越される**＝その部屋で
   * 起きた**本物の切断を握りつぶす**。
   *
   * 実機で出た形＝**観戦者が一度「観戦をやめる」を押してから入り直すと、
   * 対局者が全員抜けても「対局が終わりました」が出ず、画面が固まったままになる**
   * （感想戦へ移る経路でも同じ＝移るときに一度部屋を出るため）。
   *
   * **入るたびに決め直す**なら、消し忘れる場所が無い（**画面より長生きする控えは、
   * 入るたびに決め直す**）。**部屋に入る場所はこの 1 つ**なので、ここに置けば足りる。
   */
  setCurrentRoom: ({ roomId, roomName, isHost }) =>
    set({ currentRoomId: roomId, currentRoomName: roomName, isHost, intentionallyLeft: false }),
  setMultiInfo: ({ pid, role, roster }) => set({ myPid: pid, myRole: role, roster }),
  setRoster: (roster) => set({ roster }),
  setOpponentName: (opponentName) => set({ opponentName }),
  setActiveRoomConfig: (activeRoomConfig) => set({ activeRoomConfig }),
  setError: (errorMessage) => set({ errorMessage }),
  setPlayerName: (playerName) => set({ playerName }),
  setPendingRoomConfig: (partial) => set({ pendingRoomConfig: { ...get().pendingRoomConfig, ...partial } }),
  resetPendingRoomConfig: () => set({ pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG } }),
  resetRoomState: () => set({
    currentRoomId: null,
    currentRoomName: '',
    isHost: false,
    opponentName: '',
    roster: [],
    myPid: null,
    myRole: null,
    seatNames: null,
    spectateWaiting: false,
    activeRoomConfig: null,
    connection: 'connected',
    intentionallyLeft: true,
    mySideChoice: null,
    oppSideChoice: null,
    myReady: false,
    oppReady: false,
    furigomaResult: null,
    myFurigomaNonce: null,
    myFurigomaCommit: null,
    oppFurigomaCommit: null,
    oppFurigomaNonce: null,
    myFurigomaRevealed: false,
    furigomaError: null,
    gameStartInfo: null,
    opponentLeftDuringGame: false,
    wsPendingReconnect: false,
    ruleSyncPhase: 'idle',
    ruleSyncReason: null,
  }),
  setIntentionallyLeft: (intentionallyLeft) => set({ intentionallyLeft }),
  setMySideChoice: (mySideChoice) => set({ mySideChoice }),
  setOppSideChoice: (oppSideChoice) => set({ oppSideChoice }),
  setMyReady: (myReady) => set({ myReady }),
  setOppReady: (oppReady) => set({ oppReady }),
  setFurigomaResult: (furigomaResult) => set({ furigomaResult }),
  setMyFurigomaCommit: (myFurigomaNonce, myFurigomaCommit) => set({ myFurigomaNonce, myFurigomaCommit }),
  setOppFurigomaCommit: (oppFurigomaCommit) => set({ oppFurigomaCommit }),
  setOppFurigomaNonce: (oppFurigomaNonce) => set({ oppFurigomaNonce }),
  setMyFurigomaRevealed: (myFurigomaRevealed) => set({ myFurigomaRevealed }),
  setFurigomaError: (furigomaError) => set({ furigomaError }),
  resetFurigoma: () =>
    set({
      furigomaResult: null,
      myFurigomaNonce: null,
      myFurigomaCommit: null,
      oppFurigomaCommit: null,
      oppFurigomaNonce: null,
      myFurigomaRevealed: false,
      furigomaError: null,
    }),
  setGameStartInfo: (gameStartInfo) => set({ gameStartInfo }),
  setOpponentLeftDuringGame: (opponentLeftDuringGame) => set({ opponentLeftDuringGame }),
  setWsPendingReconnect: (wsPendingReconnect) => set({ wsPendingReconnect }),
  setLastPeerMessageAt: (lastPeerMessageAt) => set({ lastPeerMessageAt }),
  setRuleSync: (ruleSyncPhase, ruleSyncReason = null) => set({ ruleSyncPhase, ruleSyncReason }),
  resetHandshake: () => set({
    mySideChoice: null,
    oppSideChoice: null,
    myReady: false,
    oppReady: false,
    furigomaResult: null,
    myFurigomaNonce: null,
    myFurigomaCommit: null,
    oppFurigomaCommit: null,
    oppFurigomaNonce: null,
    myFurigomaRevealed: false,
    furigomaError: null,
    gameStartInfo: null,
    opponentLeftDuringGame: false,
    wsPendingReconnect: false,
    ruleSyncPhase: 'idle',
    ruleSyncReason: null,
  }),
}));
