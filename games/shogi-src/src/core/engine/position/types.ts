import type { Player } from '../mgf/types';

export type PieceId = string;

export interface PieceInstance {
  pieceId: PieceId;
  kind: string;
  owner: Player;
  initialOwner: Player;
  /** 対局開始時の駒種 (§Q4.1)。捕獲や成りで kind は変わるが initialKind は不変。 */
  initialKind: string;
  /** 対局開始時の盤上位置 (§Q4.1)。持ち駒で生成された駒はスコープ外 = row/col=-1。 */
  initialSquare: Square;
  promoted: boolean;
  /**
   * 量子モード時の候補集合 (§Q4.1・Phase 5-6.5 移行後)。
   * undefined = 本将棋モード (縮退・candidates == {pieceId} と同等)。
   * 中身は「初期 PieceID の集合」(自陣営 20 駒の PieceID 集合が初期値)。
   * 各 PieceID は buildInitialInfoMap で初期 kind / 初期 square に resolve できる。
   */
  candidates?: ReadonlySet<PieceId>;
  /**
   * 確定状態 (§Q4.4)。
   * undefined = 本将棋モード = 常に確定扱い。
   * 量子モード時のみ意味を持ち、候補集合が 1 個に収縮した時点で true になる。
   */
  confirmed?: boolean;
}

export interface Square {
  row: number;
  col: number;
}

export type BoardCell = PieceInstance | null;

/**
 * 盤の端のつなぎ方 (Phase 4・親 §3.4)。
 *
 * 省略時 (undefined) は平面＝どの端もつながっていない。円筒は左右だけ (wrapX)、
 * 完全トーラスは上下も (wrapX && wrapY) つなぐ。
 *
 * **座標系そのものの性質なので core に置く**。「なし/円筒/完全」というモードの解釈と、
 * 完全トーラス専用の追加規則 (王で敵王を取れない) は features/torus 側にある。
 */
export interface BoardTopology {
  /** 左右の端をつなぐ */
  wrapX: boolean;
  /** 上下の端をつなぐ */
  wrapY: boolean;
}

export type MoveKind = 'move' | 'drop';

export interface BoardMove {
  type: 'move';
  pieceId: PieceId;
  from: Square;
  to: Square;
  promote: boolean;
  capturedPieceId?: PieceId;
}

export interface DropMove {
  type: 'drop';
  pieceId: PieceId;
  to: Square;
}

/**
 * ★v1.55: 感想戦で盤を自由に組み替える 1 手（親 v1.49 §9.4.2.1）。
 *
 * **対局では絶対に生まれない**＝作れるのは感想戦の画面だけであり、**棋譜にも
 * 記憶にも入らない**（分岐は記録ではない・親 §9.4.3）。
 *
 * **なぜ「手」にするのか**＝組み替えを手として表すと、**(a) 二人のときそのまま
 * 相手へ渡り（新しい伝言が要らない） (b) 「戻す」が 1 つずつ効き（戻す仕組みは
 * 指す前の局面を積んで戻す形） (c) 分岐の長さの数え方が変わらない**（盤が持つ
 * 手の数と本譜の手数の差）。
 *
 * **行き先を `to`（マス）に押し込まない**＝駒台へ移す・消すはマスではないので、
 * マスの欄に別の意味を持たせると、**名札を正体として使う**ことになる。
 */
export type MoveDest =
  /** 盤のマスへ（**そこに駒があれば取る**）。 */
  | { kind: 'square'; square: Square }
  /** どちらかの駒台へ（自分の駒でも相手の駒でも移せる）。 */
  | { kind: 'hand'; owner: Player }
  /** 盤からも駒台からも取り除く（どこにも行かない）。 */
  | { kind: 'discard' };

export interface FreeMove {
  type: 'free';
  pieceId: PieceId;
  /** 盤から動かすなら元のマス。省略＝駒台から。 */
  from?: Square;
  /** 行き先。 */
  dest: MoveDest;
  /**
   * 置いた後の成りの状態。**省略＝いまのまま**。
   * **成り・不成の切り替えは「同じマスへ移して成りだけ変える手」**として表す
   * （`from` と `dest` が同じマス）。
   */
  promote?: boolean;
  /** 盤のマスへ移して駒を取ったとき、その駒（戻すときの手掛かり・表示用）。 */
  capturedPieceId?: PieceId;
}

export type Move = BoardMove | DropMove | FreeMove;

export interface Position {
  width: number;
  height: number;
  board: BoardCell[][];
  hands: {
    player1: PieceInstance[];
    player2: PieceInstance[];
  };
  sideToMove: Player;
  moveNumber: number;
  history: Move[];
  /**
   * 盤の端のつなぎ方 (Phase 4)。省略時は平面。対局中は変わらないので、
   * 着手を適用しても (applyMove の展開で) そのまま引き継がれる。
   */
  topology?: BoardTopology;
}

/**
 * ★v1.55: その手で駒が**着地したマス**（無ければ null）。
 *
 * **「最後に動いた場所」を出す画面が 3 つある**（対局・棋譜再生・感想戦）ので、
 * **手の形を各画面で場合分けさせない**ためにここへ置く（同じことを 3 か所に書かない）。
 * **駒台へ移した手・消した手はマスに着地していない**ので null を返す。
 */
export function moveLandingSquare(move: Move): Square | null {
  if (move.type === 'free') return move.dest.kind === 'square' ? move.dest.square : null;
  return move.to;
}
