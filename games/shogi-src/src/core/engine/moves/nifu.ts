import type { Player } from '../mgf/types';
import type { PieceId, PieceInstance, Position } from '../position/types';
import { buildInitialKindMap } from '../candidate-kinds';

/**
 * 「その筋には必ず歩が居る」と言い切れるかの判定 (v1.15・ユーザー指摘)。
 *
 * 二歩は「打てるか」(打つ前) と「打った駒から歩の可能性を外すか」(打った後) の
 * 両方で同じことを数える必要があるので、判定をここ 1 本にまとめて双方から呼ぶ。
 * 別実装にすると「打てたのに打った瞬間に矛盾する」ズレが起きる。
 *
 * ## 数え方は 2 通りある
 *
 * **(1) 歩と言い切れる駒がその筋に居る**
 * 候補がすべて歩の身元なら、どれに決まっても歩なので歩と言い切れる。
 *
 * **(2) その筋にしか居られない歩の身元がある** ← 今回追加した方
 * 例えば対局開始直後の 7 筋には 7 七と 7 九の 2 枚が居て、どちらも正体は未確定。
 * ところが「7 筋の歩」という身元を担える駒はこの 2 枚しか残っていない
 * (歩は成らない限り筋を移れないため、開始時の絞り込みで他の筋の駒からは落ちている)。
 * つまり **どちらかは必ず歩**なので、この筋に歩を打てば必ず二歩になる。
 * 個々の駒を見るだけでは分からず、身元を担える駒を横断で数えて初めて出る結論。
 *
 * ## 陣営はいま持っている側で見る (ユーザー指摘)
 *
 * 二歩は「同じ人が同じ筋に歩を 2 枚持っている」ことの禁止なので、**現在の持ち主**で
 * 数える。取った歩は自分の駒になるので、元の持ち主の歩と突き合わせても意味がない。
 *
 * ## 「自分を根拠にしない」
 *
 * 問いは常に「**自分以外に**その筋に歩が居るか」なので、判定する駒自身は数から外す。
 * (2) では**自分が担える身元は根拠にできない**ことに注意が要る。7 筋の 2 枚のうち片方に
 * ついて「どちらかは必ず歩」を当てはめると「相手の 1 枚が歩だから自分は歩ではない」と
 * なってしまうが、実際には**自分がその歩かもしれない**。担える身元は根拠から外す。
 *
 * @param self 判定対象の駒 (これから打つ持ち駒／絞り込み中の盤上の駒)。省略すると
 *        「その筋に歩が居るか」を誰の立場でもなく数える。
 */
export function fileHasCertainPawn(
  pos: Position,
  col: number,
  owner: Player,
  self?: PieceInstance,
): boolean {
  const kindMap = buildInitialKindMap(pos);

  // (1) その筋に「歩と言い切れる駒」が居るか。
  for (let row = 0; row < pos.height; row++) {
    const cell = pos.board[row][col];
    if (!cell || cell.pieceId === self?.pieceId) continue;
    if (cell.owner !== owner || cell.promoted) continue;
    if (isCertainlyPawn(cell, kindMap)) return true;
  }

  // (2) 「その筋にしか居られない歩の身元」があるか (量子モードのみ意味を持つ)。
  const carriers = collectPawnIdentityCarriers(pos, kindMap);
  for (const [identity, holders] of carriers) {
    if (holders.length === 0) continue;
    if (self && couldBe(self, identity)) continue; // 自分かもしれない身元は根拠にならない
    if (holders.every((h) => h.col === col && h.piece.owner === owner && !h.piece.promoted)) {
      return true;
    }
  }
  return false;
}

/** その駒がその身元でありうるか。本将棋モードは pieceId そのものが身元。 */
function couldBe(piece: PieceInstance, identity: PieceId): boolean {
  if (piece.candidates === undefined) return piece.pieceId === identity;
  return piece.candidates.has(identity);
}

/** 候補がすべて歩の身元なら、どれに決まっても歩。本将棋モードは駒種そのもので判定。 */
function isCertainlyPawn(piece: PieceInstance, kindMap: Map<PieceId, string>): boolean {
  if (piece.candidates === undefined) return piece.kind === 'fu';
  if (piece.candidates.size === 0) return false;
  for (const pid of piece.candidates) {
    if (kindMap.get(pid) !== 'fu') return false;
  }
  return true;
}

interface PawnCarrier {
  piece: PieceInstance;
  /** 盤上なら筋、持ち駒なら null (＝どの筋にでも打てるので筋を縛れない)。 */
  col: number | null;
}

/**
 * 歩の身元ごとに「それを担える駒」を集める。
 * 持ち駒も必ず含める。持ち駒が担えるうちは「盤上のこの筋に居る」と言い切れない。
 */
function collectPawnIdentityCarriers(
  pos: Position,
  kindMap: Map<PieceId, string>,
): Map<PieceId, PawnCarrier[]> {
  const carriers = new Map<PieceId, PawnCarrier[]>();
  const add = (piece: PieceInstance, col: number | null): void => {
    if (piece.candidates === undefined) return;
    for (const pid of piece.candidates) {
      if (kindMap.get(pid) !== 'fu') continue;
      const list = carriers.get(pid);
      if (list) list.push({ piece, col });
      else carriers.set(pid, [{ piece, col }]);
    }
  };
  for (let row = 0; row < pos.height; row++) {
    for (let col = 0; col < pos.width; col++) {
      const cell = pos.board[row][col];
      if (cell) add(cell, col);
    }
  }
  for (const p of pos.hands.player1) add(p, null);
  for (const p of pos.hands.player2) add(p, null);
  return carriers;
}
