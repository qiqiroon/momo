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
 * Phase 5-12 v1.20（ルール同期・親 §6.5）:
 * - rule_sync : ホスト → ゲスト。部屋のルール定義を送る（一方向）
 * - rule_ack  : ゲスト → ホスト。受領と検証の結果を返す
 *
 * 段階 2-7 v0.28（チャット）:
 * - chat : 対局中の会話メッセージ。発言者側と本文を含む。
 *          両者の履歴表示は共通のため、発言者側（player1=先手 / player2=後手）を
 *          相手側で描画するためにメッセージ本体に持たせる。
 */

import type { ReviewMessage } from '../../core/plugin/review';
import type { TimeControl } from '../../core/engine/time-control';
import { handicapKey, type HandicapChoice } from '../../core/engine/handicap';
import type { QuantumParams } from '../../core/store/quantum-params';
import type { GameType } from './roomNameCodec';
import type { QuantumDisplayMode, SideChoice, SideSelection, TorusMode } from './store';

export const PROTOCOL_VERSION = 1;

/**
 * Phase 5-12: このクライアントが扱える機能の名札 (キックオフ資料 5-12)。
 *
 * いまは両者が同じコードなので常に一致するが、将来クライアントの版が食い違ったときに
 * 「相手はこのルールを扱えない」を対局が始まる前に見つけるための足場。名札を増やす
 * ときは古い版が知らない値として扱われる = 古い相手が非対応を返す、が正しい動き。
 */
export const CLIENT_CAPABILITIES = [
  'shogi',
  'hasami',
  'torus:cylinder',
  'torus:full',
  'quantum',
  'quantum:params',
] as const;

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
 * 両者「おまかせ」時にホストが乱数計算して送信する振り駒結果 (v0.25 の旧方式)。
 * v0.53 で公平なコミット&リビール方式に置き換え済み。互換のためだけに残置。
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
 * 公平な振り駒 (v0.53 段階 2-5.3)。
 * commit = SHA-256(nonce) を先に交換し、相手のコミット受信後に nonce を明かす。
 * 受信側は相手の nonce をハッシュしてコミットと一致するかを検証、
 * 一致すれば両 nonce の XOR から結果を導出する。
 */
export interface FurigomaCommitMsg extends Envelope {
  type: 'furigoma_commit';
  commit: string;
}
export interface FurigomaRevealMsg extends Envelope {
  type: 'furigoma_reveal';
  nonce: string;
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

/**
 * Phase 5-13: 異常状態の投票 (親 §6.3.4 `anomaly_vote`・量子分冊 §Q17.8.1)。
 *
 * 片方拒否権モデル: 受信側は「ノーゲーム」を受け取った瞬間に対局を不成立にする
 * (相手の投票は待たない)。両者「継続」が揃ったときだけ対局を再開する。
 * タイムアウトは設けない (待ちきれない側は自分で「ノーゲーム」を選べる)。
 *
 * pieceIdListHash は停止時点の量子状態ハッシュ (§Q18)。同じ異常について投票して
 * いるかの照合用で、現状は受信側で使っていない (将来の再送・遅延対策のため送る)。
 */
export interface AnomalyVoteMsg extends Envelope {
  type: 'anomaly_vote';
  choice: 'continue' | 'nogame';
  pieceIdListHash?: string;
  timestamp: number;
}

/**
 * v1.15 (ユーザー報告): 異常状態が起きたことを相手に伝える。
 *
 * 本来の異常はどちらの端末でも同じ計算をするので同時に気づくが、デバッグで故意に
 * 起こした異常は押した側の端末でしか起きず、相手は何も知らないまま投票を待たされて
 * 進行が止まっていた。異常を立てた側が必ず知らせることで、どちらの経路でも両者が
 * 同じタイミングで投票に入る。既に投票中なら受信側は黙って無視する (二重に立てない)。
 *
 * debugForce が付いている場合、受信側は**同じ操作を自分の盤にも実行する**。
 * 走査の手順が決まっているので、同じ局面からは同じ駒の候補が空になり、両者の盤が
 * 揃ったまま投票に入れる (揃えないと「継続」を選んだ後の局面照合で食い違う)。
 */
export interface AnomalyRaiseMsg extends Envelope {
  type: 'anomaly_raise';
  cause: 'empty_candidates' | 'iteration_limit';
  debugForce?: 'empty' | 'limit';
}

/**
 * v1.47 (親 §6.3.6): 感想戦のやり取り。**対局用の部屋をそのまま使う**ので、
 * 新しい通信の仕組みは作らない。中身の型は `core/plugin/review.ts` が正本で、
 * ここはそれを線に乗せる形だけを決める (通信機能は感想戦の画面に依存しない)。
 *
 * 棋譜は**文字列のまま**運ぶ (保存で使っている形をそのまま流用する)。
 * 通信側が棋譜の中身を知る必要はなく、知らないほうが版が食い違ったときに強い。
 */
/**
 * ★v1.56: **感想戦の伝言は 1 本の入れ物で丸ごと運ぶ**（親 §6.3.6）。
 *
 * v1.55 までは伝言の種類ごとに型を立て、**項目を 1 つずつ書き写して**いた
 * （送る側・受け取る側・型の 3 か所）。**書き写す欄に無いものは黙って捨てられる**ので、
 * v1.55 で足した**ハイライトの伝言**と、**部屋を移るための合言葉**が
 * どちらも相手に届いていなかった（2026-08-19 実機のご報告）。
 *
 * **数え上げる形は必ず漏れる**ので、**中身には触れずそのまま渡す**形に改めた
 * ＝この欄の元からの言い分（「通信機能は中身を解釈しない」）に実装をそろえたことになる。
 * **これ以降、感想戦の伝言を増やしても通信側は何も直さなくてよい。**
 *
 * 棋譜は**文字列のまま**運ぶ（保存で使っている形をそのまま流用する）。
 */
export interface ReviewMsg extends Envelope {
  type: 'review';
  /** 感想戦の伝言そのもの（`core/plugin/review.ts` の `ReviewMessage`）。 */
  payload: ReviewMessage;
}

/**
 * Phase 5-12: ルール同期で揃える対局設定の一式 (親 §6.5)。
 *
 * 「部屋を作った人が決めたルールを対戦相手に送って揃える」ためのもので、対応可否を
 * 相談する仕組みではない (受け取る側は原則そのまま採用する)。ゲストが返せるのは
 * 「自分のエンジンでは扱えない」という拒否だけ。
 *
 * 自作ルールの定義本体 (MGF) はここに含めていない。作る・保存する・選ぶ機能自体が
 * Phase 7 (自由ルール基盤) の担当で、いま送れる中身が無いため。§6.5 が定める MGF
 * 送信はその段で足す (2026-08-12 ユーザー判断)。
 */
export interface SyncedRules {
  gameType: GameType;
  torusMode: TorusMode;
  quantum: boolean;
  quantumDisplayMode: QuantumDisplayMode;
  timeControl: TimeControl;
  customRuleName?: string;
  /**
   * 量子の実行時パラメータ (§Q17.8)。両者の計算結果を左右するので必ず揃える。
   * デバッグパネルで片側だけ変えると局面がずれる、という v1.19 の申し送りがここで閉じる。
   */
  quantumParams: QuantumParams;
  /**
   * v1.33: 手合い (駒落ち)。平手なら null。親 v1.28 §3.12.1 / §6.5。
   *
   * 手合いが揃わないと初期局面そのものが食い違い、駒の通し番号の突き合わせも成立しない。
   * **席は送り手 (部屋を作った側) から見た向き**で運ぶ＝受け取った側は自分から見た
   * 向きに読み替えて表示する。
   */
  handicap: HandicapChoice | null;
}

/** ルールを受け取れなかった理由 (親 §6.5.1 の reason コードに準じる)。 */
export type RuleAckReason =
  | 'unsupported_game_type'
  | 'unsupported_torus_mode'
  | 'engine_not_quantum_capable'
  | 'rule_digest_mismatch'
  | 'pieceid_hash_mismatch';

/**
 * Phase 5-12: ホスト → ゲスト。部屋のルール定義を送る (親 §6.5)。
 *
 * digest は送る側が組み立てたルールの見取り図。受け取った側は自分が採用した設定から
 * 同じ見取り図を作り直して返すので、途中で欠けた項目があれば食い違いとして表に出る
 * (古いクライアントが知らない項目を捨てた場合など)。
 */
export interface RuleSyncMsg extends Envelope {
  type: 'rule_sync';
  rules: SyncedRules;
  digest: string;
  capabilities: readonly string[];
}

/**
 * Phase 5-12: ゲスト → ホスト。受領と検証の結果 (親 §6.5・§6.5.2)。
 *
 * pieceIdListHash は量子 ON のときだけ入れる。駒の身元の並びが両者で一致しているかの
 * 突き合わせで、量子 OFF では駒の外形的な区別が要らないので省く (§6.5.2)。
 */
export interface RuleAckMsg extends Envelope {
  type: 'rule_ack';
  ok: boolean;
  digest: string;
  pieceIdListHash?: string;
  reason?: RuleAckReason;
  capabilities: readonly string[];
}

/**
 * ルール一式を 1 本の文字列にまとめる (照合用)。
 *
 * ハッシュ関数を通さないのは、食い違ったときにどの項目が違うのかをそのまま
 * 読めるようにするため (positionHash と同じ方針)。項目を足したらここにも足す
 * — 足し忘れるとその項目の食い違いを見逃す。
 */
export function ruleDigest(r: SyncedRules): string {
  const tc = r.timeControl;
  const qp = r.quantumParams;
  return [
    r.gameType,
    r.torusMode,
    r.quantum ? 'q1' : 'q0',
    r.quantumDisplayMode,
    `${tc.mode}/${tc.mainSeconds}/${tc.byoyomiSeconds ?? '-'}/${tc.incrementSeconds ?? '-'}`,
    r.customRuleName ?? '',
    `${qp.observationTiming}/${qp.maxIterations}/${qp.initialPropagation ? 1 : 0}/${qp.anomalyAction}`,
    handicapKey(r.handicap),
  ].join('#');
}

/**
 * 受け取ったルールを自分のエンジンで扱えるかを見る (親 §6.5.1)。
 *
 * いまは両者が同じコードなので実質いつも扱える。将来の版ちがいに備えた入口で、
 * 名札 (CLIENT_CAPABILITIES) に無いものを頼まれたら断る、という形にしてある。
 */
export function checkRuleSupport(rules: SyncedRules): { ok: true } | { ok: false; reason: RuleAckReason } {
  const caps: readonly string[] = CLIENT_CAPABILITIES;
  if (!caps.includes(rules.gameType)) return { ok: false, reason: 'unsupported_game_type' };
  if (rules.torusMode !== 'none' && !caps.includes(`torus:${rules.torusMode}`)) {
    return { ok: false, reason: 'unsupported_torus_mode' };
  }
  if (rules.quantum && !caps.includes('quantum')) {
    return { ok: false, reason: 'engine_not_quantum_capable' };
  }
  return { ok: true };
}

export type ShogiMessage =
  | SideSelectMsg
  | ReadyMsg
  | StateSyncMsg
  | FurigomaResultMsg
  | FurigomaCommitMsg
  | FurigomaRevealMsg
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
  | PongMsg
  | AnomalyVoteMsg
  | AnomalyRaiseMsg
  | RuleSyncMsg
  | RuleAckMsg
  | ReviewMsg;

/** 型ガード：unknown をゲームメッセージとして扱えるか */
export function isShogiMessage(data: unknown): data is ShogiMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as { type?: unknown; v?: unknown };
  if (typeof m.type !== 'string') return false;
  if (typeof m.v !== 'number') return false;
  return true;
}

/**
 * ★v1.53 (親 §6.2): **対局の伝言は包みに入れて運ぶ**。
 *
 * **理由＝土台が使う名前と、将棋が使う名前がぶつかるため。**
 * サーバー中継では **`to` が「宛先」**、**`from` が「送り主」**として扱われ、
 * **送る瞬間と中継の瞬間に、その 2 つが土台の値で上書きされる**。
 * 将棋の「指した手」は **`from`（どこから）／`to`（どこへ）** という名前で
 * マスを運んでいたので、**行き先と出どころが両方とも消えて、受け取った側が
 * 手を捨てていた**（2026-08-20・第54セッション・実サーバーで実測）。
 *
 * **名前を 2 つ変えるだけの直し方は採らない**＝**次に `role` や `pid` と同じ名前の
 * 項目を足した人が、また同じ壊れ方をする**。**包みの中に入れてしまえば、
 * 中の名前が何であっても土台とはぶつからない**（[[見張りは仕組みの側で囲う]]）。
 *
 * 包みの外に出すのは**土台が読む項目だけ**（`type` と版）。
 */
export const SHOGI_ENVELOPE_TYPE = 'shogi_msg';

interface ShogiEnvelope {
  v: number;
  type: typeof SHOGI_ENVELOPE_TYPE;
  body: unknown;
}

/** 対局の伝言を包みに入れる。 */
export function wrapShogiMessage(msg: ShogiMessage): ShogiEnvelope {
  return { v: PROTOCOL_VERSION, type: SHOGI_ENVELOPE_TYPE, body: msg };
}

/**
 * 対局の伝言を送る。**送る口はこの 1 つだけ**にする。
 *
 * 生の `client.send` を直に呼ぶと包み忘れが起き、**その伝言だけが黙って壊れる**
 * （`from` と `to` を持つ伝言＝指した手が、いちばん壊れて困るもの）。
 * 宛先を省くと「自分以外の全員」＝観戦者にも届く（親 §6.2）。
 */
export function sendShogiMessage(
  client: { send: (data: unknown, to?: string) => void },
  msg: ShogiMessage,
  to?: string,
): void {
  client.send(wrapShogiMessage(msg), to);
}

/**
 * 受け取ったものから対局の伝言を取り出す。
 * 包みでなければそのまま返す（包みを使わない相手＝旧版とも話せるように）。
 */
export function unwrapShogiMessage(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const m = data as { type?: unknown; body?: unknown };
  if (m.type === SHOGI_ENVELOPE_TYPE) return m.body;
  return data;
}
