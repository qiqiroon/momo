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
   * **入れ替わる昇格を経た駒** (親 v1.65 §3.6.2・量子分冊 §Q23.1)。
   *
   * 裏返る成り (将棋) は `promoted` が立つので「成った」ことが後から分かるが、
   * **入れ替わる昇格 (チェス) は駒そのものが別の駒になる**ので、印を残さないと
   * **昇格したことが誰にも分からなくなる**。分からないと 2 つ困る:
   *
   * - **量子で正体が確定しない**＝§Q23.1「昇格できるのはポーンだけ＝昇格した時点で
   *   ポーンに確定する」が言えない。
   * - **強制成りの制約が逆に働く**＝最奥段に居るのに成っていない駒に見えるので、
   *   C-105 が**確定したはずのポーン候補を落としてしまう**（候補が空になる）。
   *
   * ★**この駒の正体は `kind` そのもの**である（昇格先は人が選んだ 1 つ）。したがって
   * 候補から駒種を作り直す場所は、この印が立っていたら `kind` を使う。
   */
  replaced?: boolean;
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

/**
 * 【v1.65 §3.7.1】**続けて起きる動きの 1 段**。
 *
 * 本体の手を運んだあと、この並びを書かれた順に適用する。行き先は感想戦の自由な手
 * (MoveDest) と**同じ 3 種類**を使う (マスへ／駒台へ／取り除く)＝新しい書き方を作らない。
 * これ 1 つで**キャスリング**(ルークがマスへ)・**アンパッサン**(取られるポーンを取り除く)・
 * **獅子の 2 回行動**(同じ駒がもう一度マスへ) が表せる。
 */
export interface MoveStep {
  pieceId: PieceId;
  /** 盤から動かすなら元のマス。省略＝駒台から。 */
  from?: Square;
  dest: MoveDest;
  /** 置いた後の成りの状態。省略＝いまのまま。 */
  promote?: boolean;
}

export interface BoardMove {
  type: 'move';
  pieceId: PieceId;
  from: Square;
  to: Square;
  promote: boolean;
  /**
   * 【v1.65 §3.6.2】**入れ替わる昇格で、どの駒になるか**。
   *
   * 裏返る成り (将棋) は成った姿が 1 対 1 に決まっているので**書かない**＝
   * 従来の手はそのままの形で通る。書かれていない入れ替わる昇格は、昇格先の
   * 候補の先頭になる (候補が 1 つだけのルールでは選択が起きない)。
   */
  promoteTo?: string;
  /**
   * 【v1.65 §3.7.1】**続けて起きる動きの並び**。
   *
   * **省略＝並び無し**＝本将棋・はさみ将棋の手は従来どおりこの欄を持たない
   * (知らない側は素通りする)。手の種類 (move/drop) は増やさない。
   */
  extra_steps?: MoveStep[];
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
