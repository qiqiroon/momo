import { create } from 'zustand';
import {
  applyMove,
  buildInitialKindMap,
  canDeclareNyugyoku,
  displayKindsFor,
  generateLegalMoves,
  hondou,
  initPosition,
  isCheckmate,
  isInCheck,
  positionHash,
} from '../engine';
import type { BoardMove, Mgf, Move, PieceInstance, Player, Position, Square } from '../engine';
import { formatMove, pieceNameJa, squareNameJa } from '../engine/kifu/format';
import { NO_LIMIT_TIME_CONTROL, initClockState, type ClockState, type TimeControl } from '../engine/time-control';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { useDebugStore, type DebugCandidateChangeEntry } from './debug-store';
import { DEFAULT_QUANTUM_PARAMS, type QuantumParams } from './quantum-params';
import {
  loadHintAlwaysOn, loadMyQuantumDisplay, saveHintAlwaysOn, saveMyQuantumDisplay,
} from './ui-settings';

/**
 * 対局開始オプション (Phase 5-2)。
 * quantum=true かつ 'quantum:init' が登録されていれば初期候補集合を割り当てる。
 * A ビルドでは quantum モジュール自体が tree-shake で除外されるため常に no-op となる。
 */
/**
 * 未確定駒の見せ方 (spec 駒デザイン・対局UI §4.2 / 対局設定 `qtdisp`)。
 * 'cycle' = 候補を 1 秒ごとに 1 種ずつ入れ替える (既定) / 'stack' = 候補を黒で重ねる。
 */
export type QuantumDisplay = 'cycle' | 'stack';

export interface ResetOptions {
  quantum?: boolean;
  /** 省略時は現在値を維持する (ルール設定者が対局中に切り替えた値を消さない)。 */
  quantumDisplay?: QuantumDisplay;
}
type QuantumInitFn = (pos: Position) => Position;
type QuantumCandidateUpdateFn = (
  pos: Position,
  mgf: Mgf,
  context?: { torusMode?: 'none' | 'cylinder' | 'full'; maxIterations?: number },
) => Position;
/**
 * v1.09 (Phase 5-11 追補): 打つ手の直後に呼ぶ絞り込みフック。
 * features/quantum が register する (core → features の型依存を作らないローカル型)。
 */
type QuantumOnDropFn = (
  pos: Position,
  mgf: Mgf,
  droppedPieceId: string,
  to: Square,
) => Position;
/**
 * Phase 5-7 (§Q8.5): 捕獲制約フック。features/quantum が register する。
 * infoMap は buildInitialInfoMap の結果で、game-store は中身に触らず isConfirmedKing に
 * 渡すだけの opaque な値として扱う (core/ → features/ 型依存を切るためのローカル型)。
 */
type QuantumOnCaptureHook = {
  applyC201: (pos: Position, capturedPieceId: string, mgf: Mgf) => Position;
  isConfirmedKing: (
    piece: import('../engine/position/types').PieceInstance,
    infoMap: ReadonlyMap<string, unknown>,
    mgf: Mgf,
  ) => boolean;
  buildInitialInfoMap: (pos: Position) => ReadonlyMap<string, unknown>;
};

/**
 * Phase 5-13 (§Q8.8 C-901 / §Q7.9.1): 異常状態の原因種別。
 * 画面はこれで原因行の文言を切り替える。音は原因で変えない (音響 §2.7.2)。
 */
export type AnomalyCause = 'empty_candidates' | 'iteration_limit';
export type AnomalyChoice = 'continue' | 'nogame';

/**
 * Phase 5-13: 異常状態の投票 (§Q17.8 `anomaly_action=vote_to_annul`)。
 *
 * 発火中は対局全体が止まる (時計凍結・駒を触れない)。盤面は「停止時点のまま」残す
 * 決まりなので、待った/中断で使う paused (盤を隠す) とは別の状態として持つ。
 *
 * online は発火時点の値を固定する。成立条件が変わるため (対人は両者「継続」で再開、
 * 一人で遊んでいるときは自分の選択だけで決まる)。
 */
export interface AnomalyState {
  cause: AnomalyCause;
  myVote: AnomalyChoice | null;
  oppVote: AnomalyChoice | null;
  online: boolean;
  /**
   * Phase 5-15: 投票を出すか (§Q17.8 `anomaly_action`)。
   * 標準の `vote_to_annul` は true。`notify_user` は知らせるだけなので false
   * (バナーは出るが投票は開かず、盤は異常状態のまま残る)。
   */
  vote: boolean;
}

/**
 * Phase 5-13: features/quantum が投げる異常状態の例外を core 側で見分けるための形。
 * core/ は features/ を import できない (モジュール境界) ので、目印フィールドで判定する。
 */
interface QuantumAnomalyLike {
  quantumAnomaly: true;
  anomalyCause: AnomalyCause;
  position: Position;
}

function asQuantumAnomaly(e: unknown): QuantumAnomalyLike | null {
  if (!e || typeof e !== 'object') return null;
  const a = e as Partial<QuantumAnomalyLike>;
  if (a.quantumAnomaly !== true) return null;
  if (a.anomalyCause !== 'empty_candidates' && a.anomalyCause !== 'iteration_limit') return null;
  if (!a.position) return null;
  return a as QuantumAnomalyLike;
}

export interface PendingPromotion {
  nonPromoteMove: BoardMove;
  promoteMove: BoardMove;
  pieceKind: string;
  promotedKind: string;
  owner: Player;
  heading: string;
  /**
   * v1.08 (Phase 5-11): 量子モードで未確定の駒が成るときの表示用。
   * 成り確認は「この駒が成るとこうなる」を見せる画面なので、未確定の駒に対して
   * pieceKind (＝初期位置の駒種で、正体ではない) を出すと嘘になる。
   * 未確定なら候補の駒種 (強さ降順) を並べて、盤上と同じ ? + 巡回/重ねで見せる。
   * 確定駒・本将棋モードでは 1 個だけ入り、従来と同じ表示になる。
   */
  candidateKinds: string[];
  promotedCandidateKinds: string[];
}

type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'sennichite'
  | 'nyugyoku_win_p1'
  | 'nyugyoku_win_p2'
  | 'resigned_p1'
  | 'resigned_p2'
  | 'agreed_draw'
  /** v0.35: 持ち時間切れ。timeout_p1 = 先手が時間切れ(＝後手勝ち) */
  | 'timeout_p1'
  | 'timeout_p2'
  /**
   * Phase 5-13: ノーゲーム (異常状態合意)。勝敗つかず・レート非変動 (親 §4.4)。
   * 異常状態の投票で片方でも「ノーゲーム」を選ぶと成立する。
   */
  | 'nogame';

/**
 * 着手発生元:
 * - 'local'  : 自分の操作で盤面に反映（オンライン対戦では相手にも送る対象）
 * - 'remote' : 相手からの受信で反映（送り返さない）
 */
export type MoveSource = 'local' | 'remote';

/**
 * 直近適用された着手の記録（対局画面が自分の手を検知して送信するのに使う）。
 * オブジェクト参照が変わるだけで React が反応するように、apply の度に新しい
 * オブジェクトを作る。
 */
export interface LastAppliedMove {
  move: Move;
  source: MoveSource;
  /** 単調増加する連番。同じ move 値でも参照を変えて subscribe 側に通知するため */
  seq: number;
}

interface GameState {
  mgf: Mgf;
  position: Position;
  selectedSquare: Square | null;
  selectedHandPieceId: string | null;
  legalDestinations: Square[];
  moveHistory: string[];
  status: GameStatus;
  pendingPromotion: PendingPromotion | null;
  positionCounts: Record<string, number>;
  canNyugyokuP1: boolean;
  canNyugyokuP2: boolean;
  /** 直近適用された着手（着手送信を検知したい画面が subscribe する） */
  lastAppliedMove: LastAppliedMove | null;
  /** 待ったのための着手前局面スタック（v0.33 追加）。着手のたびに現在局面を push、undoLastMove で pop。 */
  positionHistory: Position[];
  /** positionCounts の履歴も同期して保持（千日手判定を巻き戻せるように） */
  positionCountsHistory: Record<string, number>[];
  /** 時計の履歴 (v0.42 追加): 手を指す前の {clocks, activeClockSide} を保持。待ったの時計巻き戻しに使う */
  clockHistory: { clocks: { player1: ClockState; player2: ClockState }; activeClockSide: 'player1' | 'player2' | null }[];
  /** 持ち時間設定（v0.35）。オフラインの既定は no_limit、ルームでは activeRoomConfig の値。 */
  timeControl: TimeControl;
  /** 各プレイヤーの時計状態（v0.35） */
  clocks: { player1: ClockState; player2: ClockState };
  /** 現在時計を動かしている側（v0.35）。null なら停止（対局終了・no_limit）。 */
  activeClockSide: 'player1' | 'player2' | null;
  /** 中断中フラグ（v0.41 追加）。true の間 ticker は tick しない。activeClockSide は保持されるため再開で継続 */
  paused: boolean;
  /**
   * v0.99 (Phase 5-6 拡張): 直近の候補集合更新で candidates が変化した駒の pieceId 一覧。
   * 動いた駒 (lastMove の pieceId) は除外し、量子もつれで巻き添えを食った駒のみ。
   * UI ハイライト (盤マス・持ち駒台に薄い水色半透明) の描画根拠として使う。
   */
  entangledPieceIds: string[];
  /**
   * Phase 5-13 (§Q8.8/§Q17.8): 異常状態の投票中なら中身が入る。null なら平常。
   * これが立っている間は時計が止まり、駒の選択・着手を受け付けない。
   */
  anomaly: AnomalyState | null;

  selectSquare: (sq: Square) => void;
  selectHandPiece: (pieceId: string) => void;
  clearSelection: () => void;
  tryMove: (to: Square) => boolean;
  confirmPromotion: (promote: boolean) => void;
  cancelPromotion: () => void;
  declareNyugyoku: () => boolean;
  /** 指定側を投了させる。既に対局が終わっているときは何もしない。段階 2-7 v0.30。 */
  resign: (side: 'player1' | 'player2') => void;
  /** 引分に合意した状態にする。段階 2-7 v0.33。 */
  agreeDraw: () => void;
  /**
   * 最後の n 手を巻き戻す。実際に戻せた手数を返す。段階 2-7 v0.33 / v0.42 で時計巻き戻し追加。
   * opts.restoreClockForSide が指定されたら、その side の時計を「戻される最古の手を指す前」の値に戻す。
   * 指定されなかった側の時計は現在値のまま（＝待った申し出者はペナルティで戻さない）。
   * opts 未指定なら両側とも clockHistory から復元（オフラインの即 undo など）。
   */
  undoLastMove: (count?: number, opts?: { restoreClockForSide?: 'player1' | 'player2' }) => number;
  /** 持ち時間設定を反映（オンライン game_start で呼ばれる）。clocks をこの設定で再初期化。v0.35。 */
  setTimeControl: (tc: TimeControl) => void;
  /** ticker 経由で active 側の残り時間を減らす。時間切れなら timeout 状態へ。v0.35。 */
  tickClock: (deltaMs: number) => void;
  /** 相手からの move メッセージで得た時計状態を反映（sync）。v0.35。 */
  syncClock: (side: 'player1' | 'player2', clock: ClockState) => void;
  /** 指定側を時間切れ負けにする（idempotent）。v0.35。 */
  timeout: (side: 'player1' | 'player2') => void;
  /** 対局を中断状態にする（両者合意成立後に呼ばれる）。v0.41。 */
  pauseGame: () => void;
  /** 中断状態を解除して対局再開する（両者合意成立後に呼ばれる）。v0.41。 */
  resumeGame: () => void;
  /**
   * 対局盤面をリセットする。options.quantum を渡さなかった場合は
   * currentQuantum (前回 reset で決まった値) を維持する。対局中の
   * 「リセット」ボタンから引数なしで呼んでも同じルールで再初期化される。
   */
  reset: (options?: ResetOptions) => void;
  /** 現局面が量子モードで初期化されたか。reset({quantum}) で更新される。v0.90 追加。 */
  currentQuantum: boolean;
  /**
   * 未確定駒の見せ方の **実効値** (Phase 5-11・v1.22 で 2 層化)。盤・駒・棋譜など
   * 描画側はすべてこれを読む。値の決め方は spec 駒デザイン・対局UI v0.8 §4.4:
   *   部屋の値が stack (重ね) なら常に stack / cycle (巡回) なら各自の画面の値。
   */
  quantumDisplay: QuantumDisplay;
  /**
   * v1.22: **部屋の値** (対局設定 `qtdisp`)。ルール設定者が決め、ルール同期で
   * 相手・観戦者へ配られる。読みやすさの下限を決めるもので、これより読みやすくはできない。
   */
  roomQuantumDisplay: QuantumDisplay;
  /**
   * v1.22: **各自の画面の値**。端末ごとに持ち、通信では送らない。
   * 部屋の値が cycle のときだけ実効値に効く (stack のときは無視される)。
   */
  myQuantumDisplay: QuantumDisplay;
  /**
   * 未確定駒の見せ方を切り替える。**どちらの層に書くかは本メソッドが決める** (spec §4.4):
   *   ルール設定者 → 部屋の値 (と自分の値) を変え、部屋のルールへ書き戻す。
   *   それ以外     → 部屋の値が cycle のときだけ自分の値を変える。stack のときは何もしない。
   */
  setQuantumDisplay: (mode: QuantumDisplay) => void;
  /**
   * v1.22: 部屋の値を外から受け取る (ルール同期・対局開始時)。
   * 自分の画面の値は書き換えない (部屋が cycle に戻れば再び効くため)。
   */
  applyRoomQuantumDisplay: (mode: QuantumDisplay) => void;
  /**
   * v1.22: 移動先ヒント (指せるマスをオレンジに塗る) を出すか。既定 ON・端末ごとの設定で、
   * 通信では送らない。消えるのは色だけで、指せる場所そのものは変わらない。
   */
  hintAlwaysOn: boolean;
  setHintAlwaysOn: (on: boolean) => void;
  /**
   * Phase 5-15: 量子モードの実行時パラメータ (§Q17.8)。対局設定の一部で、
   * 既定値のままなら従来と同じ挙動になる。いまはデバッグパネルからのみ変更できる。
   */
  quantumParams: QuantumParams;
  /** 実行時パラメータを部分更新する。 */
  setQuantumParams: (patch: Partial<QuantumParams>) => void;
  /**
   * Phase 5-13: 異常状態を立てる。既に立っているか対局が終わっていれば何もしない。
   * 候補更新が異常を投げたときと、デバッグから故意に起こしたときの共通入口。
   *
   * v1.15: 立てたことを相手にも伝える。fromRemote=true は「相手からの知らせで立てる」
   * 場合で、そのときは送り返さない (往復し続けないため)。
   */
  raiseAnomaly: (cause: AnomalyCause, fromRemote?: boolean) => void;
  /** Phase 5-13: 自分の投票。片方でも nogame ならその場で不成立が決まる。 */
  voteAnomaly: (choice: AnomalyChoice) => void;
  /** Phase 5-13: 相手の投票を受信したときに呼ぶ (通信側から)。 */
  receiveAnomalyVote: (choice: AnomalyChoice) => void;
  /**
   * Phase 5-13: デバッグから故意に異常を起こす (kickoff §5「意図的に破綻局面を作れる
   * スクリプトを用意」)。'empty' は実際に盤上の駒の候補を空にして本番と同じ検出経路を
   * 通す。'limit' は反復が終わらない状況を人工的に作るのが難しいので通知だけを直接出す。
   *
   * v1.15: ネット対戦では相手側にも同じ操作を実行させて盤を揃える。fromRemote=true は
   * その受け側 (自分からは送り返さない)。
   */
  debugForceAnomaly: (kind: 'empty' | 'limit', fromRemote?: boolean) => void;
  /**
   * 相手から受信した着手を盤面に反映する。
   * pieceId / from / to / promote に完全一致する合法手を探して適用。
   * 対応する合法手が見つからなければ false を返す（同期ずれ）。
   */
  applyRemoteMove: (msg: {
    kind: 'move' | 'drop';
    pieceId: string;
    from?: Square;
    to: Square;
    promote?: boolean;
  }) => boolean;
}

function computeLegalDestinationsFromBoard(mgf: Mgf, position: Position, from: Square): Square[] {
  const legal = generateLegalMoves(mgf, position);
  const dests: Square[] = [];
  const seen = new Set<string>();
  for (const m of legal) {
    if (m.type !== 'move') continue;
    if (m.from.row !== from.row || m.from.col !== from.col) continue;
    const key = `${m.to.row},${m.to.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dests.push(m.to);
  }
  return dests;
}

function computeLegalDestinationsFromHand(mgf: Mgf, position: Position, pieceId: string): Square[] {
  const legal = generateLegalMoves(mgf, position);
  const dests: Square[] = [];
  const seen = new Set<string>();
  for (const m of legal) {
    if (m.type !== 'drop') continue;
    if (m.pieceId !== pieceId) continue;
    const key = `${m.to.row},${m.to.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dests.push(m.to);
  }
  return dests;
}

/**
 * v1.09: 「この手で駒種が決まった駒」を棋譜に書くための行を作る。
 *
 * 量子将棋では、指した手そのものより「その結果どの駒の正体が決まったか」が
 * 局面の意味を左右する。棋譜に残らないと後から追えないので、決まった瞬間を
 * 「3三 先手 金に確定」の形で手の下に書き足す。
 *
 * 判定は盤の表示と同じ「候補の駒種が 1 つに絞れたか」。どちらの金かまでは
 * 決まっていなくても、金と呼べるようになった時点で確定として扱う。
 *
 * v1.14: 1 手で何枚も決まると棋譜が縦に伸びすぎるので、3 件までを並べて
 * 残りは「他 N 件」でまとめる (付録D-8 §10.3 の同時収縮の圧縮にならった)。
 */
const CONFIRM_LINES_MAX = 3;

function diffConfirmedKinds(mgf: Mgf, before: Position, after: Position): string[] {
  const beforeMap = buildInitialKindMap(before);
  const afterMap = buildInitialKindMap(after);
  const kindsBefore = new Map<string, number>();
  for (const p of allPieces(before)) {
    if (p.candidates === undefined) continue;
    kindsBefore.set(p.pieceId, displayKindsFor(mgf, p, beforeMap).length);
  }

  const lines: string[] = [];
  for (const { piece, square } of allPiecesWithSquare(after)) {
    if (piece.candidates === undefined) continue;
    const prev = kindsBefore.get(piece.pieceId);
    if (prev === undefined || prev < 2) continue;
    const kinds = displayKindsFor(mgf, piece, afterMap);
    if (kinds.length !== 1) continue;
    const where = square ? squareNameJa(after.width, square) : '持駒';
    const side = piece.owner === 'player1' ? '先手' : '後手';
    lines.push(`${where} ${side} ${pieceNameJa(kinds[0])}に確定`);
  }
  if (lines.length > CONFIRM_LINES_MAX) {
    const rest = lines.length - CONFIRM_LINES_MAX;
    return [...lines.slice(0, CONFIRM_LINES_MAX), `他 ${rest} 件`];
  }
  return lines;
}

function allPieces(pos: Position): PieceInstance[] {
  const out: PieceInstance[] = [];
  for (const row of pos.board) for (const c of row) if (c) out.push(c);
  out.push(...pos.hands.player1, ...pos.hands.player2);
  return out;
}

function allPiecesWithSquare(pos: Position): { piece: PieceInstance; square: Square | null }[] {
  const out: { piece: PieceInstance; square: Square | null }[] = [];
  for (let row = 0; row < pos.height; row++) {
    for (let col = 0; col < pos.width; col++) {
      const c = pos.board[row][col];
      if (c) out.push({ piece: c, square: { row, col } });
    }
  }
  for (const p of pos.hands.player1) out.push({ piece: p, square: null });
  for (const p of pos.hands.player2) out.push({ piece: p, square: null });
  return out;
}

/**
 * v1.11: 成る/成らずの選択肢に並べる候補を「その手を指した後の姿」で求める。
 *
 * 動くこと自体が候補を狭める (斜め 1 マスの移動なら銀・金・角・王しか説明できない) ので、
 * 動く前の候補をそのまま並べると、その手では絶対にあり得ない駒が選択肢に出てしまう。
 * 成る側はさらに「成れない駒 (王・金) ではあり得ない」で狭まる。
 *
 * どちらも実際に着手した盤面を作って候補更新まで回し、動いた駒の候補を読み取ることで、
 * 本番の絞り込みと同じ結果を先取りする (絞り込みの規則をここで作り直さない)。
 *
 * 候補更新は矛盾局面で例外を投げ得るので、投げたら動く前の候補に落とす。
 * 選択肢が出せないより、広めでも出せたほうが操作が止まらない。
 */
function previewKindsAfterMove(state: GameState, move: BoardMove): string[] {
  const { mgf, position, currentQuantum } = state;
  try {
    let next = applyMove(mgf, position, move);
    if (currentQuantum) {
      // 捕獲を伴うなら C-201 (取られた駒は王ではない) まで本番と同じ手順を踏む
      const captured = position.board[move.to.row][move.to.col];
      if (captured) {
        const capHook = pluginGet<QuantumOnCaptureHook>('quantum:onCapture');
        if (capHook) {
          const infoMap = capHook.buildInitialInfoMap(position);
          if (!capHook.isConfirmedKing(captured, infoMap, mgf)) {
            next = capHook.applyC201(next, captured.pieceId, mgf);
          }
        }
      }
      const updateFn = pluginGet<QuantumCandidateUpdateFn>('quantum:candidateUpdate');
      if (updateFn) next = updateFn(next, mgf);
    }
    const moved = next.board[move.to.row][move.to.col];
    if (!moved) return [];
    return displayKindsFor(mgf, moved, buildInitialKindMap(next));
  } catch {
    const before = position.board[move.from.row][move.from.col];
    return before ? displayKindsFor(mgf, before, buildInitialKindMap(position)) : [];
  }
}

function computeStatusAfterMove(
  mgf: Mgf,
  position: Position,
  positionCounts: Record<string, number>,
): { status: GameStatus; positionCounts: Record<string, number> } {
  if (isCheckmate(mgf, position)) {
    return { status: 'checkmate', positionCounts };
  }
  const hash = positionHash(position);
  const count = (positionCounts[hash] ?? 0) + 1;
  const nextCounts = { ...positionCounts, [hash]: count };
  const threshold = mgf.repetition?.detection_threshold ?? 4;
  if (count >= threshold) {
    return { status: 'sennichite', positionCounts: nextCounts };
  }
  return { status: 'playing', positionCounts: nextCounts };
}

function applyAndCommit(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  move: Move,
  source: MoveSource = 'local',
): void {
  const state = get();
  const { position, mgf, moveHistory, positionCounts, lastAppliedMove, positionHistory, positionCountsHistory, clockHistory, timeControl, clocks, activeClockSide, currentQuantum } = state;
  const formatted = formatMove(mgf, position, move);
  let nextPos = applyMove(mgf, position, move);
  // v1.04 (Phase 5-7 §Q8.5): 捕獲制約 C-201/C-202/C-203。捕獲を検知して:
  //   - 捕獲された駒が「王として確定」なら C-202 で即終局 (checkmate 相当)、候補更新は
  //     スキップ (§Q8.5 C-202 の但し書き・親§4.4 の「王として確定した駒の合法捕獲」)。
  //   - 未確定王候補持ちなら C-201 で王 (royal) 系候補を除外してから候補更新へ。
  //   - C-203 (「捕獲を理由に候補を変えるのは C-201 だけ」) は apply.ts の継承がそのまま
  //     守っているので追加処理不要。
  let statusOverride: GameStatus | null = null;
  if (currentQuantum && move.type === 'move') {
    const capturedBefore = position.board[move.to.row][move.to.col];
    if (capturedBefore) {
      const capHook = pluginGet<QuantumOnCaptureHook>('quantum:onCapture');
      if (capHook) {
        const infoMapBefore = capHook.buildInitialInfoMap(position);
        if (capHook.isConfirmedKing(capturedBefore, infoMapBefore, mgf)) {
          statusOverride = 'checkmate';
        } else {
          nextPos = capHook.applyC201(nextPos, capturedBefore.pieceId, mgf);
        }
      }
    }
  }
  // v1.09 (Phase 5-11 追補): 打つ手から得られる絞り込み。
  // 「詰みになる手が打てた = 打ち歩詰めではない = その駒は歩ではない」を反映する。
  // 詰み判定が要るので候補更新の反復ループには入れず、捕獲時の C-201 と同じく
  // イベント側でこの位置に 1 回だけ挟む。二歩・行き所のない駒による絞り込みは
  // 打った駒が盤上の駒になった時点で C-103 / C-104 が拾うのでここでは扱わない。
  // Phase 5-13: 候補更新が異常 (候補が空 / 反復上限) を投げたら、打ち切り時点の盤面を
  // そのまま採用して、着手をコミットしたあとに投票 UI を出す。盤を「停止時点のまま」
  // 見せる決まり (付録D-1 §5.7.3.3) なので、着手をなかったことにはしない。
  let anomalyCause: AnomalyCause | null = null;
  if (currentQuantum && move.type === 'drop') {
    const dropHook = pluginGet<QuantumOnDropFn>('quantum:onDrop');
    if (dropHook) nextPos = dropHook(nextPos, mgf, move.pieceId, move.to);
  }
  // v0.96 (Phase 5-4): 量子モードなら着手直後に候補集合を再評価する。
  // v0.98 (Phase 5-6): torus モード情報を context として渡す。torus 実装は Phase 4
  // で完成予定なので現状は 'none' を渡す (C-103/C-104 は非 torus 環境で有効化)。
  // v1.04 (Phase 5-7): C-202 発動時は候補更新をスキップ (§Q8.5)。
  if (currentQuantum && !statusOverride) {
    const candidateUpdateFn = pluginGet<QuantumCandidateUpdateFn>('quantum:candidateUpdate');
    // Phase 5-6.5 移行後: context (infoMap 含む) は candidateUpdate 側で pos から自動生成。
    // torusMode 等の追加副次情報を渡したい場合はここで context を組み立てる。
    if (candidateUpdateFn) {
      try {
        // Phase 5-15: 反復上限は対局設定 (§Q17.8 `max_iterations`) から。
        nextPos = candidateUpdateFn(nextPos, mgf, { maxIterations: state.quantumParams.maxIterations });
      } catch (e) {
        const anomaly = asQuantumAnomaly(e);
        if (!anomaly) throw e;
        nextPos = anomaly.position;
        anomalyCause = anomaly.anomalyCause;
      }
    }
  }
  // v0.99 (Phase 5-6 拡張): 動いた駒以外で candidates が変化した駒を「量子もつれ」として
  // 記録する。UI ハイライトと debug の候補変更履歴表示で使う。動いた駒 (move.pieceId) は
  // 除外し、その他で before/after の candidates が異なる駒のみ集める。
  const entangledPieceIds = currentQuantum
    ? diffEntangledPieceIds(position, nextPos, move)
    : [];
  // v1.09: この手で駒種が決まった駒があれば、棋譜の手の下に書き足す
  const confirmedLines = currentQuantum ? diffConfirmedKinds(mgf, position, nextPos) : [];
  const kifuEntry = confirmedLines.length > 0
    ? `${formatted}\n${confirmedLines.join('\n')}`
    : formatted;
  const { status, positionCounts: nextCounts } = computeStatusAfterMove(mgf, nextPos, positionCounts);
  // v1.04 (Phase 5-7 §Q8.5 C-202): 確定王捕獲は checkmate に強制上書き (千日手・詰み判定より優先)。
  const finalStatus = statusOverride ?? status;
  const nextSeq = (lastAppliedMove?.seq ?? 0) + 1;
  // v0.35: 時計の更新。指し終わった側は byoyomi なら秒読みリセット / fischer なら加算
  const moverSide = position.sideToMove;
  const nextClocks = updateClocksAfterMove(clocks, moverSide, timeControl);
  const isTerminal = finalStatus !== 'playing';
  const nextActiveSide =
    isTerminal || timeControl.mode === 'no_limit'
      ? null
      : moverSide === 'player1'
        ? 'player2'
        : 'player1';
  // v0.42: clockHistory に「指す前の {clocks, activeClockSide}」を積む
  const preClockSnapshot = {
    clocks: { player1: { ...clocks.player1 }, player2: { ...clocks.player2 } },
    activeClockSide,
  };
  set({
    position: nextPos,
    selectedSquare: null,
    selectedHandPieceId: null,
    legalDestinations: [],
    pendingPromotion: null,
    moveHistory: [...moveHistory, kifuEntry],
    status: finalStatus,
    positionCounts: nextCounts,
    canNyugyokuP1: canDeclareNyugyoku(mgf, nextPos, 'player1'),
    canNyugyokuP2: canDeclareNyugyoku(mgf, nextPos, 'player2'),
    lastAppliedMove: { move, source, seq: nextSeq },
    // v0.33: 待ったの巻き戻し用に、着手前の局面と positionCounts を履歴に積む
    positionHistory: [...positionHistory, position],
    positionCountsHistory: [...positionCountsHistory, positionCounts],
    clockHistory: [...clockHistory, preClockSnapshot],
    clocks: nextClocks,
    activeClockSide: nextActiveSide,
    entangledPieceIds,
  });
  // Phase 5-13: 着手を反映し終えてから異常状態を立てる。順序を逆にすると、盤に
  // 停止時点の局面が乗る前に投票 UI が開いてしまい「何が起きて止まったか」が見えない。
  if (anomalyCause) get().raiseAnomaly(anomalyCause);
  // v0.99 (Phase 5-6 拡張): デバッグモード有効なら候補変更履歴を debug-store にも積む。
  // 動いた駒自身の変化も含めて全部押し込む (UI ハイライトは動いた駒を除外するが、
  // デバッグ情報は全変化を時系列で見たい)。debug-store は core/store 内で
  // 直接 import する (プラグイン境界は不要・A ビルドでも enabled=false で自然に no-op)。
  if (currentQuantum) {
    const dbg = useDebugStore.getState();
    if (dbg.enabled) {
      const moveNumber = position.moveNumber;
      const changes: DebugCandidateChangeEntry[] = diffAllCandidateChanges(position, nextPos).map((c) => ({
        time: Date.now(),
        moveNumber,
        pieceId: c.pieceId,
        before: c.before,
        after: c.after,
        removed: c.removed,
        added: c.added,
      }));
      if (changes.length > 0) dbg.logCandidateChanges(changes);
    }
  }
}

/**
 * Phase 5-13: 投票が揃ったかを判定して結果を反映する (§Q17.8.1 片方拒否権モデル)。
 *
 * - 片方でも「ノーゲーム」→ その瞬間に不成立。相手の投票は待たない。
 * - 対人対局は両者「継続」で再開。
 * - 一人で遊んでいるときは相手が居ないので、自分の「継続」だけで再開する。
 *
 * まだ決まらない場合は何もしない (投票 UI が相手待ちの表示を出す)。
 */
function resolveAnomaly(set: (partial: Partial<GameState>) => void, a: AnomalyState): void {
  if (a.myVote === 'nogame' || a.oppVote === 'nogame') {
    set({ status: 'nogame', anomaly: null, activeClockSide: null });
    return;
  }
  const agreed = a.online ? a.myVote === 'continue' && a.oppVote === 'continue' : a.myVote === 'continue';
  if (agreed) set({ anomaly: null });
}

/**
 * v0.99: before → after で candidates が変化した駒の pieceId を集める (動いた駒を除外)。
 * UI ハイライトで使う量子もつれ判定。
 */
function diffEntangledPieceIds(before: Position, after: Position, move: Move): string[] {
  const beforeMap = collectPieceInstances(before);
  const afterMap = collectPieceInstances(after);
  const movedId = move.pieceId;
  const ids: string[] = [];
  for (const [pid, afterPiece] of afterMap) {
    if (pid === movedId) continue;
    const beforePiece = beforeMap.get(pid);
    if (!beforePiece) continue; // 新規登場 (捕獲で hand に入った等) は対象外
    if (!candidatesChanged(beforePiece.candidates, afterPiece.candidates)) continue;
    ids.push(pid);
  }
  return ids;
}

/**
 * v0.99: デバッグログ用 (動いた駒も含む全変化)。時系列で candidates before/after を表現。
 */
function diffAllCandidateChanges(before: Position, after: Position): {
  pieceId: string;
  before: string[];
  after: string[];
  removed: string[];
  added: string[];
}[] {
  const beforeMap = collectPieceInstances(before);
  const afterMap = collectPieceInstances(after);
  const changes: {
    pieceId: string;
    before: string[];
    after: string[];
    removed: string[];
    added: string[];
  }[] = [];
  for (const [pid, afterPiece] of afterMap) {
    const beforePiece = beforeMap.get(pid);
    if (!beforePiece) continue;
    const beforeCands = beforePiece.candidates ? Array.from(beforePiece.candidates).sort() : [];
    const afterCands = afterPiece.candidates ? Array.from(afterPiece.candidates).sort() : [];
    if (!candidatesChanged(beforePiece.candidates, afterPiece.candidates)) continue;
    const beforeSet = new Set(beforeCands);
    const afterSet = new Set(afterCands);
    const removed = beforeCands.filter((x) => !afterSet.has(x));
    const added = afterCands.filter((x) => !beforeSet.has(x));
    changes.push({ pieceId: pid, before: beforeCands, after: afterCands, removed, added });
  }
  return changes;
}

/** 位置全体から pieceId → PieceInstance の map を作る (盤上+持ち駒両方)。 */
function collectPieceInstances(pos: Position): Map<string, import('../engine/position/types').PieceInstance> {
  const map = new Map<string, import('../engine/position/types').PieceInstance>();
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell) map.set(cell.pieceId, cell);
    }
  }
  for (const p of pos.hands.player1) map.set(p.pieceId, p);
  for (const p of pos.hands.player2) map.set(p.pieceId, p);
  return map;
}

/** 2 つの candidates 集合が実質的に異なるか (undefined 同士は同じ扱い)。 */
function candidatesChanged(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined,
): boolean {
  if (a === undefined && b === undefined) return false;
  if (a === undefined || b === undefined) return true;
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

/** v0.35: 指し終わった側の時計を、時間モードに応じて調整（byoyomi リセット / fischer 加算） */
function updateClocksAfterMove(
  clocks: { player1: ClockState; player2: ClockState },
  moverSide: 'player1' | 'player2',
  tc: TimeControl,
): { player1: ClockState; player2: ClockState } {
  const cur = clocks[moverSide];
  let nextMover: ClockState = { ...cur };
  if (tc.mode === 'byoyomi') {
    if (cur.inByoyomi) {
      // 秒読み中に指したので秒読みを満タンに戻す
      nextMover.byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
    }
  } else if (tc.mode === 'fischer') {
    // フィッシャー: 一手ごとに加算
    nextMover.mainMs = cur.mainMs + (tc.incrementSeconds ?? 0) * 1000;
  }
  // sudden_death / no_limit は変化なし
  return { ...clocks, [moverSide]: nextMover };
}

const initialMgf: Mgf = hondou;
const initialPos = initPosition(initialMgf);
const initialHash = positionHash(initialPos);

export const useGameStore = create<GameState>((set, get) => ({
  mgf: initialMgf,
  position: initialPos,
  selectedSquare: null,
  selectedHandPieceId: null,
  legalDestinations: [],
  moveHistory: [],
  status: 'playing',
  pendingPromotion: null,
  positionCounts: { [initialHash]: 1 },
  canNyugyokuP1: false,
  canNyugyokuP2: false,
  lastAppliedMove: null,
  positionHistory: [],
  positionCountsHistory: [],
  clockHistory: [],
  timeControl: NO_LIMIT_TIME_CONTROL,
  clocks: {
    player1: initClockState(NO_LIMIT_TIME_CONTROL),
    player2: initClockState(NO_LIMIT_TIME_CONTROL),
  },
  activeClockSide: null,
  paused: false,
  currentQuantum: false,
  quantumDisplay: loadMyQuantumDisplay(),
  roomQuantumDisplay: 'cycle',
  myQuantumDisplay: loadMyQuantumDisplay(),
  hintAlwaysOn: loadHintAlwaysOn(),
  quantumParams: DEFAULT_QUANTUM_PARAMS,
  entangledPieceIds: [],
  anomaly: null,

  setQuantumParams: (patch) => set({ quantumParams: { ...get().quantumParams, ...patch } }),

  raiseAnomaly: (cause, fromRemote = false) => {
    const { status, anomaly, quantumParams } = get();
    // 既に投票中、または対局が終わっているなら二重に立てない。
    if (anomaly || status !== 'playing') return;
    const connector = pluginGet<OnlineGameConnector>('gameConnector');
    const online = connector?.isOnline() ?? false;
    // v1.15: 相手にも知らせる。ふつうに起きた異常は相手側も同じ計算で気づくので
    // 二重になるが、受信側は既に投票中なら無視するので害はない。相手が気づけない
    // 経路 (デバッグで故意に起こした場合) はこの知らせだけが頼りになる。
    if (!fromRemote) connector?.sendAnomalyRaise(cause);
    // Phase 5-15 (§Q17.8 `anomaly_action`): 投票を挟まず即ノーゲームにする設定。
    // 相手にも上で知らせてあるので、向こうも同じ設定なら同じ結末になる。
    if (quantumParams.anomalyAction === 'no_game') {
      set({
        status: 'nogame',
        anomaly: null,
        activeClockSide: null,
        selectedSquare: null,
        selectedHandPieceId: null,
        legalDestinations: [],
        pendingPromotion: null,
      });
      return;
    }
    set({
      anomaly: {
        cause,
        myVote: null,
        oppVote: null,
        online,
        vote: quantumParams.anomalyAction === 'vote_to_annul',
      },
      // 盤は停止時点のまま残すが、駒の選択だけは解除する (投票中は指せないため)。
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
  },

  voteAnomaly: (choice) => {
    const { anomaly } = get();
    if (!anomaly || anomaly.myVote !== null) return;
    // 相手にも自分の選択を伝える (オフラインでは connector が無いので何も起きない)。
    pluginGet<OnlineGameConnector>('gameConnector')?.sendAnomalyVote(choice);
    const next = { ...anomaly, myVote: choice };
    set({ anomaly: next });
    resolveAnomaly(set, next);
  },

  receiveAnomalyVote: (choice) => {
    const { anomaly } = get();
    if (!anomaly || anomaly.oppVote !== null) return;
    const next = { ...anomaly, oppVote: choice };
    set({ anomaly: next });
    resolveAnomaly(set, next);
  },

  debugForceAnomaly: (kind, fromRemote = false) => {
    const { position, mgf, currentQuantum, status } = get();
    if (status !== 'playing') return;
    // v1.15: 相手側でも同じ操作を実行してもらう。盤を壊す操作なので、知らせるだけだと
    // 両者の盤が食い違い、「継続」を選んだ後の局面照合で対局が止まってしまう。
    // 走査の手順は決まっているので、同じ局面からは同じ駒の候補が空になる。
    if (!fromRemote) {
      pluginGet<OnlineGameConnector>('gameConnector')?.sendAnomalyRaise(
        kind === 'limit' ? 'iteration_limit' : 'empty_candidates',
        kind,
      );
    }
    if (kind === 'limit') {
      get().raiseAnomaly('iteration_limit', true);
      return;
    }
    // 'empty': 盤上の未確定駒を 1 枚選んで候補を空にし、本番と同じ候補更新に通す。
    // 通知だけ直接出すのではなく検出経路ごと動かしたいので、この形にしている。
    if (!currentQuantum) {
      get().raiseAnomaly('empty_candidates', true);
      return;
    }
    let broken: Position | null = null;
    outer: for (let r = 0; r < position.height; r++) {
      for (let c = 0; c < position.width; c++) {
        const cell = position.board[r][c];
        if (!cell || cell.candidates === undefined) continue;
        const board = position.board.map((row) => row.slice());
        board[r][c] = { ...cell, candidates: new Set<string>() };
        broken = { ...position, board };
        break outer;
      }
    }
    if (!broken) {
      get().raiseAnomaly('empty_candidates', true);
      return;
    }
    let cause: AnomalyCause = 'empty_candidates';
    let nextPos = broken;
    const candidateUpdateFn = pluginGet<QuantumCandidateUpdateFn>('quantum:candidateUpdate');
    if (candidateUpdateFn) {
      try {
        nextPos = candidateUpdateFn(broken, mgf);
      } catch (e) {
        const anomaly = asQuantumAnomaly(e);
        if (!anomaly) throw e;
        nextPos = anomaly.position;
        cause = anomaly.anomalyCause;
      }
    }
    set({ position: nextPos });
    get().raiseAnomaly(cause, true);
  },

  setQuantumDisplay: (mode) => {
    // spec 駒デザイン・対局UI v0.9 §4.4。**対局中に動かせるのは「自分の画面の値」だけ**で、
    // これはルールを決めた側も含めた全員に等しく効く (v1.24 で改訂・誰が決めた側かを見ない)。
    //
    // 部屋の値 (対局の基準) が決まるのはルール設定画面ただ 1 か所。対局中にルールを決めた側だけが
    // 基準を動かせると、自分に有利な局面で読みやすさを変えられて不公平になるため
    // (ユーザー判断 2026-08-13)。開始時点で決まっていれば両者同じ条件で始められる。
    //
    // 部屋の値が重ねなら何もしない = 読みやすい側へは誰も逃げられない。
    // 巡回なら各自が自分の画面だけ重ねにできる (読みにくくするのは自由)。
    if (get().roomQuantumDisplay === 'stack') return;
    saveMyQuantumDisplay(mode);
    set({ myQuantumDisplay: mode, quantumDisplay: mode });
  },

  setHintAlwaysOn: (on) => {
    saveHintAlwaysOn(on);
    set({ hintAlwaysOn: on });
  },

  applyRoomQuantumDisplay: (mode) => {
    // 部屋の値が重ねに変わった瞬間、自分の画面の値は無視して重ねへ落とす。
    // 自分の値そのものは残す (部屋が巡回に戻ればまた効く)。
    set({ roomQuantumDisplay: mode, quantumDisplay: mode === 'stack' ? 'stack' : get().myQuantumDisplay });
  },

  selectSquare: (sq) => {
    const { position, mgf, status, anomaly } = get();
    if (status !== 'playing' || anomaly) return;
    const piece = position.board[sq.row][sq.col];
    if (!piece || piece.owner !== position.sideToMove) {
      set({ selectedSquare: null, selectedHandPieceId: null, legalDestinations: [] });
      return;
    }
    set({
      selectedSquare: sq,
      selectedHandPieceId: null,
      legalDestinations: computeLegalDestinationsFromBoard(mgf, position, sq),
    });
  },

  selectHandPiece: (pieceId) => {
    const { position, mgf, status, anomaly } = get();
    if (status !== 'playing' || anomaly) return;
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === pieceId);
    if (!piece) return;
    set({
      selectedSquare: null,
      selectedHandPieceId: pieceId,
      legalDestinations: computeLegalDestinationsFromHand(mgf, position, pieceId),
    });
  },

  clearSelection: () => {
    set({ selectedSquare: null, selectedHandPieceId: null, legalDestinations: [] });
  },

  tryMove: (to) => {
    const { position, mgf, selectedSquare, selectedHandPieceId, status, anomaly } = get();
    if (status !== 'playing' || anomaly) return false;

    if (selectedSquare) {
      const piece = position.board[selectedSquare.row][selectedSquare.col];
      if (!piece) return false;
      const legal = generateLegalMoves(mgf, position);
      const candidates: BoardMove[] = legal.filter(
        (m): m is BoardMove =>
          m.type === 'move' &&
          m.from.row === selectedSquare.row &&
          m.from.col === selectedSquare.col &&
          m.to.row === to.row &&
          m.to.col === to.col,
      );
      if (candidates.length === 0) return false;
      if (candidates.length === 1) {
        applyAndCommit(set, get, candidates[0]);
        return true;
      }
      const nonPromote = candidates.find((m) => !m.promote);
      const promote = candidates.find((m) => m.promote);
      if (!nonPromote || !promote) {
        applyAndCommit(set, get, candidates[0]);
        return true;
      }
      const def = mgf.pieces.find((p) => p.id === piece.kind);
      const promotedKind = def?.promoted_id ?? piece.kind;
      // v1.11: 成る/成らずの選択肢は「その手を指した後の候補」で見せる。
      // 動いたこと自体で候補は狭まる (斜め 1 マスなら銀・金・角・王しか説明できない、等) ので、
      // 動く前の候補を並べるとあり得ない駒が選択肢に出てしまう。
      // 成る側はさらに「成れない駒 (王・金) ではあり得ない」で狭まるため、
      // 実際に成った盤面で候補更新まで回してから読み取る。
      const candidateKinds = previewKindsAfterMove(get(), nonPromote);
      const promotedCandidateKinds = previewKindsAfterMove(get(), promote);
      set({
        pendingPromotion: {
          nonPromoteMove: nonPromote,
          promoteMove: promote,
          pieceKind: piece.kind,
          promotedKind,
          owner: piece.owner,
          heading: formatMove(mgf, position, nonPromote),
          candidateKinds: candidateKinds.length > 0 ? candidateKinds : [piece.kind],
          promotedCandidateKinds:
            promotedCandidateKinds.length > 0 ? promotedCandidateKinds : [promotedKind],
        },
      });
      return true;
    }

    if (selectedHandPieceId) {
      const legal = generateLegalMoves(mgf, position);
      const found = legal.find(
        (m) => m.type === 'drop' && m.pieceId === selectedHandPieceId && m.to.row === to.row && m.to.col === to.col,
      );
      if (!found) return false;
      applyAndCommit(set, get, found);
      return true;
    }

    return false;
  },

  confirmPromotion: (promote) => {
    const { pendingPromotion } = get();
    if (!pendingPromotion) return;
    const move = promote ? pendingPromotion.promoteMove : pendingPromotion.nonPromoteMove;
    applyAndCommit(set, get, move);
  },

  cancelPromotion: () => {
    const { pendingPromotion, position, mgf } = get();
    if (!pendingPromotion) return;
    const from = pendingPromotion.nonPromoteMove.from;
    set({
      pendingPromotion: null,
      selectedSquare: from,
      selectedHandPieceId: null,
      legalDestinations: computeLegalDestinationsFromBoard(mgf, position, from),
    });
  },

  declareNyugyoku: () => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return false;
    const player = position.sideToMove;
    if (!canDeclareNyugyoku(mgf, position, player)) return false;
    set({
      status: player === 'player1' ? 'nyugyoku_win_p1' : 'nyugyoku_win_p2',
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
    return true;
  },

  resign: (side) => {
    const { status } = get();
    if (status !== 'playing') return;
    set({
      status: side === 'player1' ? 'resigned_p1' : 'resigned_p2',
      anomaly: null,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
  },

  agreeDraw: () => {
    const { status } = get();
    if (status !== 'playing') return;
    set({
      status: 'agreed_draw',
      anomaly: null,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      activeClockSide: null,
    });
  },

  setTimeControl: (tc) => {
    // 対局開始時（game_start）に呼ばれる。時計を初期化して先手の時計を動かす。
    set({
      timeControl: tc,
      clocks: {
        player1: initClockState(tc),
        player2: initClockState(tc),
      },
      activeClockSide: tc.mode === 'no_limit' ? null : 'player1',
      paused: false,
    });
  },

  tickClock: (deltaMs) => {
    const state = get();
    if (state.status !== 'playing') return;
    if (!state.activeClockSide) return;
    if (state.paused) return; // v0.41: 中断中は tick しない
    // Phase 5-13: 異常状態の投票中は時計凍結 (音響 §2.2.1 状態遷移表「異常状態投票中」)。
    // 待った/中断の paused と分けているのは、投票中は盤を隠さず見せ続けるため。
    if (state.anomaly) return;
    if (state.timeControl.mode === 'no_limit') return;
    const side = state.activeClockSide;
    const cur = state.clocks[side];
    const tc = state.timeControl;
    let nextClock: ClockState = { ...cur };
    if (cur.inByoyomi) {
      // 秒読みフェーズ: byoyomiMs を減らす
      nextClock.byoyomiMs = Math.max(0, cur.byoyomiMs - deltaMs);
      if (nextClock.byoyomiMs <= 0) {
        // 時間切れ負け
        set({
          clocks: { ...state.clocks, [side]: nextClock },
          status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
          activeClockSide: null,
          selectedSquare: null,
          selectedHandPieceId: null,
          legalDestinations: [],
          pendingPromotion: null,
        });
        return;
      }
    } else {
      // 本時間フェーズ: mainMs を減らす
      nextClock.mainMs = Math.max(0, cur.mainMs - deltaMs);
      if (nextClock.mainMs <= 0) {
        if (tc.mode === 'byoyomi') {
          // 本時間切れ→秒読みフェーズへ移行
          nextClock.mainMs = 0;
          nextClock.inByoyomi = true;
          nextClock.byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
        } else {
          // sudden_death or fischer: 時間切れ負け
          set({
            clocks: { ...state.clocks, [side]: nextClock },
            status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
            activeClockSide: null,
            selectedSquare: null,
            selectedHandPieceId: null,
            legalDestinations: [],
            pendingPromotion: null,
          });
          return;
        }
      }
    }
    set({ clocks: { ...state.clocks, [side]: nextClock } });
  },

  syncClock: (side, clock) => {
    const state = get();
    set({ clocks: { ...state.clocks, [side]: clock } });
  },

  timeout: (side) => {
    const state = get();
    if (state.status !== 'playing') return;
    // v0.38: 敗者の時計を明示的に 0 にゼロクリア。
    // 勝者側で相手時計が「1秒残る」ような drift 表示にならないよう、
    // ローカルの tick と外部から受け取った timeout どちらの経路でも同じ最終状態を保つ。
    const tc = state.timeControl;
    const zeroed: ClockState = {
      mainMs: 0,
      byoyomiMs: 0,
      inByoyomi: tc.mode === 'byoyomi',
    };
    set({
      status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
      anomaly: null,
      activeClockSide: null,
      clocks: { ...state.clocks, [side]: zeroed },
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
  },

  pauseGame: () => {
    const state = get();
    if (state.status !== 'playing') return;
    if (state.paused) return;
    set({ paused: true });
  },

  resumeGame: () => {
    const state = get();
    if (!state.paused) return;
    set({ paused: false });
  },

  undoLastMove: (count = 1, opts) => {
    const state = get();
    const available = state.positionHistory.length;
    const actual = Math.min(count, available);
    if (actual <= 0) return 0;
    const restoredPos = state.positionHistory[state.positionHistory.length - actual];
    const restoredCounts = state.positionCountsHistory[state.positionCountsHistory.length - actual];
    // v0.42: 時計履歴も同じ位置から取り出す。restoreClockForSide が指定されたら
    // その side だけ復元、もう片方 (＝待った申し出者) は現在値のまま保持する。
    // 未指定なら両側とも復元（オフラインで即 undo する場合など）。
    const snapshotIdx = state.clockHistory.length - actual;
    const snap = state.clockHistory[snapshotIdx];
    let nextClocks = state.clocks;
    let nextActiveClockSide = state.activeClockSide;
    if (snap) {
      const restoreSide = opts?.restoreClockForSide;
      if (restoreSide) {
        nextClocks = { ...state.clocks, [restoreSide]: snap.clocks[restoreSide] };
      } else {
        nextClocks = snap.clocks;
      }
      nextActiveClockSide = snap.activeClockSide;
    }
    set({
      position: restoredPos,
      positionCounts: restoredCounts,
      positionHistory: state.positionHistory.slice(0, state.positionHistory.length - actual),
      positionCountsHistory: state.positionCountsHistory.slice(0, state.positionCountsHistory.length - actual),
      clockHistory: state.clockHistory.slice(0, snapshotIdx),
      moveHistory: state.moveHistory.slice(0, state.moveHistory.length - actual),
      clocks: nextClocks,
      activeClockSide: nextActiveClockSide,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      status: 'playing',
      anomaly: null,
      canNyugyokuP1: canDeclareNyugyoku(state.mgf, restoredPos, 'player1'),
      canNyugyokuP2: canDeclareNyugyoku(state.mgf, restoredPos, 'player2'),
      // v0.33 バグ修正: lastAppliedMove を触らない。触ると対局画面の
      // 「自分の手を相手に送信」useEffect が発火して直前の着手が再送信されてしまい、
      // 相手の巻き戻しが直後に上書きされる。
    });
    return actual;
  },

  reset: (options?: ResetOptions) => {
    const state = get();
    // 明示指定があればそれを、なければ前回 reset の値を引き継ぐ (対局中「リセット」ボタン用)
    const quantum = options?.quantum ?? state.currentQuantum;
    let pos = initPosition(state.mgf);
    let initialAnomaly: AnomalyState | null = null;
    if (quantum) {
      const quantumInitFn = pluginGet<QuantumInitFn>('quantum:init');
      if (quantumInitFn) pos = quantumInitFn(pos);
      // v1.08 (Phase 5-11): 初期配置の時点で既に成り立っている制約 (歩は最初に居た筋から
      // 動かない = C-108 等) を、対局開始時に 1 回だけ適用しておく。
      //
      // これを入れないと、着手と無関係な絞り込みが「初手の候補更新」のタイミングで
      // 初めてまとめて走り、40 枚全部の候補が一斉に減る = 初手が盤全体に波及したように
      // 見えてしまう (実測: 候補 20 → 12 は着手前から確定していた減り方で、初手自身が
      // 減らすのは動いた 1 枚だけだった)。
      //
      // ここでの減りは対局開始前の整理なので、演出もハイライトも出さない。
      // reset は lastAppliedMove=null / entangledPieceIds=[] で終わるため、
      // 観測アニメ・もつれハイライトのどちらも発火しない (下の set を参照)。
      // Phase 5-15: 開始時に走らせるかは対局設定 (§Q17.8 `initial_propagation`)。
      const candidateUpdateFn = state.quantumParams.initialPropagation
        ? pluginGet<QuantumCandidateUpdateFn>('quantum:candidateUpdate')
        : undefined;
      if (candidateUpdateFn) {
        try {
          pos = candidateUpdateFn(pos, state.mgf, { maxIterations: state.quantumParams.maxIterations });
        } catch (e) {
          // Phase 5-13: 開始前の整理で矛盾が出るのはルール定義そのものが破綻している状態。
          // 起きたことは隠さず、打ち切り時点の盤で始めて投票 UI に載せる。
          const anomaly = asQuantumAnomaly(e);
          if (!anomaly) throw e;
          pos = anomaly.position;
          initialAnomaly = {
            cause: anomaly.anomalyCause,
            myVote: null,
            oppVote: null,
            online: false,
            vote: state.quantumParams.anomalyAction === 'vote_to_annul',
          };
        }
      }
    }
    const tc = state.timeControl;
    set({
      currentQuantum: quantum,
      // Phase 5-11: 表示方式は対局設定 (qtdisp) の一部＝これは「部屋の値」。未指定なら現在値を維持。
      // v1.22: 実効値は「部屋が重ねなら重ね／巡回なら各自の画面の値」(spec 駒UI v0.8 §4.4)。
      roomQuantumDisplay: options?.quantumDisplay ?? state.roomQuantumDisplay,
      quantumDisplay:
        (options?.quantumDisplay ?? state.roomQuantumDisplay) === 'stack'
          ? 'stack'
          : state.myQuantumDisplay,
      position: pos,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      moveHistory: [],
      status: 'playing',
      pendingPromotion: null,
      positionCounts: { [positionHash(pos)]: 1 },
      canNyugyokuP1: false,
      canNyugyokuP2: false,
      lastAppliedMove: null,
      positionHistory: [],
      positionCountsHistory: [],
      clockHistory: [],
      // v0.35: timeControl は保持しつつ clocks を再初期化、先手の時計を動かす
      clocks: {
        player1: initClockState(tc),
        player2: initClockState(tc),
      },
      activeClockSide: tc.mode === 'no_limit' ? null : 'player1',
      paused: false,
      entangledPieceIds: [],
      anomaly: initialAnomaly,
    });
  },

  applyRemoteMove: (msg) => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return false;
    const legal = generateLegalMoves(mgf, position);
    let target: Move | null = null;
    if (msg.kind === 'move') {
      if (!msg.from) return false;
      const found = legal.find(
        (m): m is BoardMove =>
          m.type === 'move' &&
          m.pieceId === msg.pieceId &&
          m.from.row === msg.from!.row &&
          m.from.col === msg.from!.col &&
          m.to.row === msg.to.row &&
          m.to.col === msg.to.col &&
          m.promote === (msg.promote ?? false),
      );
      if (found) target = found;
    } else {
      const found = legal.find(
        (m) =>
          m.type === 'drop' &&
          m.pieceId === msg.pieceId &&
          m.to.row === msg.to.row &&
          m.to.col === msg.to.col,
      );
      if (found) target = found;
    }
    if (!target) return false;
    applyAndCommit(set, get, target, 'remote');
    return true;
  },
}));

export { isInCheck };
