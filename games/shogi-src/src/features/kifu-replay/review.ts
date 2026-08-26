/**
 * 感想戦 (S11) の中身。画面ではなく**盤の触り方と、入るときの持ち物**を受け持つ。
 *
 * 意味論の正本＝親 §9.4。画面の要件＝画面機能 v0.37 §3 S11。絵柄＝付録D-12 v1.0。
 *
 * **記録された対局を並べ直し、どの局面からでも自由に指せる場**であって、
 * **記録を作らない**（親 §9.4／§9.2.3 ③）。ここから記憶に触る経路は 1 つも無い。
 *
 * **並べ直す仕掛けは棋譜再生と同じものを使う**（`replayKifu`・ユーザー判断 2026-08-17）。
 * 2 か所に作ると、片方だけ直った状態が生まれるため。
 */

import { useGameStore } from '../../core/store/game-store';
import type { Square } from '../../core/engine';
import type { ReviewMovePayload } from '../../core/plugin/review';
import { wireFieldsOf, wireMoveOf } from '../../core/protocol/wire-move';
import type { Mgf } from '../../core/engine/mgf/types';
import type { KifuFile } from './types';

/**
 * どこから感想戦へ入ったか（画面機能 §3 S11「遷移」・付録D-12 §3）。
 * **戻るは入ってきた画面へ**戻す＝部屋の中で始めた感想戦は、結果へ戻れないと
 * 部屋から出てしまう（S08 の「常にモード選択」とは扱いを分ける）。
 */
export type ReviewOrigin = 'lobby' | 'game' | 'kifu-replay';

/**
 * 振り返る 1 局。**入るときに決まり、画面の中では選び直せない**（親 §9.4.1）。
 * 画面の持ち物にせず、開く側が置いていく（棋譜再生の呼び出し元と同じ流儀）。
 */
let target: KifuFile | null = null;
let origin: ReviewOrigin = 'lobby';

/**
 * ★段B②: **その 1 局と一緒に配られてきたカスタムルールの定義**（公式一覧に無いもの）。
 *
 * **1 局と同じ入れ物で持つ**＝差し替わる入口が複数あるので、別々に持つと
 * **どれかで書き忘れて、前の 1 局のルールで新しい棋譜を並べる**ことになる。
 * 配られていない（公式一覧のルール・ひとりで開いた）ときは null。
 */
let targetRule: Mgf | null = null;

/**
 * ★v1.57: 振り返る 1 局の**出どころ**（親 §9.2.5）。**盤の向きはこれで決まる**
 * ＝自分の対局なら自分の側が手前、外から読み込んだ棋譜なら先手が下。
 *
 * **入ってきた画面の名前では決めない**＝入口は増え続けており（v1.54 でロビー、
 * v1.55 で部屋の移行）、名前を数え上げる形は足すたびに書き足しが要る。
 * **出どころは入口が何通りに増えても 2 つのまま**である。
 */
let fromOwnGame = false;

/**
 * ★v1.57: **自分の側**（親 §6.3.6）。二人の感想戦で盤をどちら向きに出すかに使う。
 *
 * **なぜ控えるのか**＝先後は**対局の部屋が持っている情報**なので、v1.55 で入れた
 * 「対局の部屋から感想戦の部屋へ移る」経路では**部屋を出た時点で消える**。
 * 聞きに行っても答えが返らず、棋譜が持つ向き（＝ホストの向き）に落ちるため、
 * **ゲストの盤だけ上下が逆**になっていた（2026-08-19 実機のご報告）。
 *
 * **新しい伝言は作らない**＝先後は二人ともそれぞれ自分で知っているので送る必要が無い。
 */
let myGameSide: 'player1' | 'player2' | null = null;

export function setReviewTarget(file: KifuFile, from: ReviewOrigin, own = false, rule: Mgf | null = null): void {
  target = file;
  origin = from;
  fromOwnGame = own;
  // ★段B②: **1 局を置き換えるたびに必ず決め直す**（省略なら「添えられていない」）。
  // 「空なら入れる」形にすると、2 回目から前の 1 局の定義が残る。
  targetRule = rule;
}

/** ★段B②: その 1 局と一緒に配られてきた定義（無ければ null）。 */
export function reviewTargetRule(): Mgf | null {
  return targetRule;
}

/** ★v1.57: 振り返る 1 局が「いま自分が指した対局」から来たものか（親 §9.2.5）。 */
export function reviewIsOwnGame(): boolean {
  return fromOwnGame;
}

/**
 * ★v1.57: 自分の側を控える／忘れる（親 §6.3.6）。
 * **対局の部屋を出る前に控える**。**別の入り方をしたときは必ず忘れる**
 * ＝残っていると、2 回目から前の対局の側で盤が出る。
 */
export function setReviewMySide(side: 'player1' | 'player2' | null): void {
  myGameSide = side;
}

export function reviewMySide(): 'player1' | 'player2' | null {
  return myGameSide;
}

/**
 * v1.50: **振り返る 1 局がまだ決まっていない状態**で入る（感想戦の部屋へゲストとして
 * 入ったとき・親 §6.3.6）。**ホストから配られるまで待つ**ので、ここで手元の記憶を
 * 代わりに置かない＝配られる 1 局とは限らないのに盤へ出ると、届いた瞬間に別の対局へ
 * 化けたように見える。
 */
export function clearReviewTarget(from: ReviewOrigin): void {
  target = null;
  origin = from;
  targetRule = null;
  // ★v1.57: 配られるのを待つ側は、まだ何も持っていない＝自分の対局でもない。
  fromOwnGame = false;
}

export function reviewTarget(): KifuFile | null {
  return target;
}

export function reviewOrigin(): ReviewOrigin {
  return origin;
}

/**
 * これから `side` が指せる状態に盤を整える。
 *
 * **感想戦には手番の縛りが無い**（親 §9.4）ので、触った駒の側をそのまま手番にする。
 * **勝敗も無い**ので、詰みや投了で止まっている盤でも指し継げるように「対局中」へ戻す
 * ＝ここで止めると、**詰みの局面から別の手を試す**という感想戦の本来の用途が塞がる。
 *
 * **記憶は動かない**＝この画面が開いている間は「本物の対局ではない」と名乗り続けている
 * （`holdReplayGuard`）ので、状態が変わっても記録は生まれない。
 */
function prepareFor(side: 'player1' | 'player2'): void {
  const g = useGameStore.getState();
  const nextStatus = g.status === 'playing' ? undefined : ('playing' as const);
  const nextPosition =
    g.position.sideToMove === side ? undefined : { ...g.position, sideToMove: side };
  if (!nextStatus && !nextPosition) return;
  useGameStore.setState({
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextPosition ? { position: nextPosition } : {}),
  });
}

/**
 * 盤の駒を選ぶ。**どちらの駒でも掴める**（親 §9.4・付録D-12 §4）。
 * 選べたら true（＝掴んだ）。空きマスや掴めないものなら選択を解いて false。
 */
export function reviewSelectSquare(sq: Square): boolean {
  const g = useGameStore.getState();
  const piece = g.position.board[sq.row][sq.col];
  if (!piece) {
    g.clearSelection();
    return false;
  }
  prepareFor(piece.owner);
  useGameStore.getState().selectSquare(sq);
  return useGameStore.getState().selectedSquare !== null;
}

/** 駒台の駒を選ぶ。盤と同じく**どちらの駒台からでも**掴める。 */
export function reviewSelectHand(owner: 'player1' | 'player2', pieceId: string): void {
  prepareFor(owner);
  useGameStore.getState().selectHandPiece(pieceId);
}

/**
 * 分岐の手を 1 手戻す（親 §9.4.2「戻す」）。戻せたら true。
 *
 * **待ったの仕掛けをそのまま使う**（付録D-12 §12.2）＝指す前の局面を丸ごと積んで
 * あるので、**量子でも候補の状態ごと戻る**。計算し直さないので食い違いようがない。
 */
export function reviewUndoBranch(): boolean {
  return useGameStore.getState().undoLastMove(1) > 0;
}

/**
 * いま分岐で何手指しているか。
 *
 * **別に数えず、盤が持っている手の並びから引く**＝本譜を `ply` 手まで並べ直した盤に
 * 指し足しているので、**その差が分岐**。二重に数えると、片方だけずれる。
 */
export function branchCount(ply: number): number {
  return Math.max(0, useGameStore.getState().moveHistory.length - ply);
}

/**
 * いま分岐で指している手を、線に乗せられる形で取り出す（二人の感想戦・親 §6.3.6）。
 *
 * **別に控えず、盤が持っている手の並びから引く**（branchCount と同じ理由）＝
 * 二重に持つと片方だけずれる。本譜を `ply` 手まで並べ直した後ろが分岐そのもの。
 */
export function reviewBranchMoves(ply: number): ReviewMovePayload[] {
  return useGameStore
    .getState()
    .position.history.slice(ply)
    .map((m): ReviewMovePayload => {
      // ★v1.90: 盤の手の項目は 1 か所で作る（昇格先と、続けて起きる動きの並びを含む）。
      if (m.type === 'move' || m.type === 'drop') return wireMoveOf(m);
      // ★v1.55: 盤の組み替えも**同じ形で運ぶ**（親 §9.4.2.1）＝行き先の種類が
      // 増えるだけで、新しい伝言は作らない。
      return { kind: 'free', pieceId: m.pieceId, from: m.from, dest: m.dest, promote: m.promote };
    });
}

/**
 * 相手が指した分岐を、自分の盤にも並べる（二人の感想戦）。
 *
 * **手番の縛りが無い**ので、どちらの駒が動いたのかは**手そのものから引く**
 * ＝盤に居る駒／持ち駒の持ち主を見る。送り手に側を名乗らせると、名乗りと実物が
 * 食い違ったときに気づけない。
 *
 * 並べられなかったら false（＝ホストの配り直しを待つ）。
 */
export function reviewApplyMoves(moves: ReviewMovePayload[]): boolean {
  for (const m of moves) {
    const owner = ownerOf(m);
    if (!owner) return false;
    prepareFor(owner);
    // ★v1.55: 自由な手は**合法性を検めない**（親 §6.3.6）＝**送り手の側でも見て
    // いない**ので、受け手だけが検めると同じ操作が片方でだけ通り、食い違いの解消が
    // 毎回走る。**量子の候補も絞らない**（量子分冊 §Q22.4＝絞る側と絞らない側が
    // できると、手の並びが同じでも候補が食い違う）。
    if (m.kind === 'free') {
      if (!m.dest) return false;
      const ok = useGameStore.getState().applyFreeMove({
        pieceId: m.pieceId,
        from: m.from,
        dest: m.dest,
        promote: m.promote,
      });
      if (!ok) return false;
      continue;
    }
    if (!m.to) return false;
    const ok = useGameStore.getState().applyRemoteMove(
      wireFieldsOf({ ...m, kind: m.kind === 'drop' ? 'drop' : 'move', to: m.to }),
    );
    if (!ok) return false;
  }
  return true;
}

/** その手を指すのはどちらか（盤の駒／持ち駒の持ち主）。 */
function ownerOf(m: ReviewMovePayload): 'player1' | 'player2' | null {
  const { position } = useGameStore.getState();
  if (m.kind === 'move' || (m.kind === 'free' && m.from)) {
    if (!m.from) return null;
    return position.board[m.from.row]?.[m.from.col]?.owner ?? null;
  }
  if (position.hands.player1.some((p) => p.pieceId === m.pieceId)) return 'player1';
  if (position.hands.player2.some((p) => p.pieceId === m.pieceId)) return 'player2';
  return null;
}
