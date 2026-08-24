import type { Mgf } from '../mgf/types';
import type { Move, PieceInstance, Position } from '../position/types';
import { buildInitialKindMap, displayKindsFor } from '../candidate-kinds';
import { pieceNameOf } from '../piece-rules';

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 駒に書く文字 (親 v1.65 §3.6.1)。
 *
 * ★以前はここに日本語用・英語用の表が直書きされていた。**ルール定義に駒の名前の欄が
 * 最初から在ったのに読んでおらず**、同じことが 2 か所に書かれている状態だったので、
 * **自作ルールで新しい駒を作っても盤に名前が出なかった** (内部の呼び名がそのまま出た)。
 * v1.65 で**ルール定義を正本**と定め、表は piece-rules の読み方 1 本にした。
 */
export function pieceNameFor(mgf: Mgf, kind: string, locale: string): string {
  return pieceNameOf(mgf, kind, locale);
}

/** 棋譜は日本語の呼び方で書くので、日本語名だけを引く近道。 */
export function pieceNameJa(mgf: Mgf, kind: string): string {
  return pieceNameOf(mgf, kind, 'ja');
}

/** 盤の座標を将棋の呼び方 (3三 等) にする。 */
export function squareNameJa(width: number, square: { row: number; col: number }): string {
  const file = width - square.col;
  const rank = square.row + 1;
  return `${file}${RANK_KANJI[rank - 1] ?? rank}`;
}

/**
 * 棋譜に書く駒の名前 (v1.09・量子将棋対応)。
 *
 * 量子モードでは正体が決まるまで駒名を確定できない。かといって名前が無いと
 * 棋譜が読めないので、**「元の場所に置かれていた駒の名前」に「仮」を付けて呼ぶ**
 * (5 一の駒なら 仮王)。これは正体の主張ではなく、その駒を指し示すための呼び名。
 *
 * 候補が 1 駒種に絞れた時点からは、その駒名で呼ぶ (仮 が外れる)。盤の表示が
 * 顔を切り替えるのと同じ条件なので、棋譜と盤で呼び方がズレない。
 *
 * ## v1.49 (ユーザー判断 2026-08-18): 成った未確定駒に 成 を添える
 *
 * 呼び名の元にする initialKind は「対局開始時にそのマスに置かれていた駒種」であって
 * 正体ではない。金・王のマスから来た駒は、正体が桂でも **名札の側に成った姿が無い** ので、
 * 成った後も `仮金` `仮王` という成っていない字になり、盤 (成り駒の顔) と食い違って見えた。
 *
 * 名札を成り駒へ差し替えることはできない (金・王に成った姿は無い) ので、
 * **名札はそのままにして末尾に 成 を添える** = `仮金成` `仮王成`。
 * 移動の 成 は行き先座標の後ろに付く (`▲3三仮金3四成`) ので、
 * 呼び名の 成 (行き先の前) と位置で見分けられる。
 */
export function kifuPieceName(mgf: Mgf, position: Position, piece: PieceInstance): string {
  const kinds = displayKindsFor(mgf, piece, buildInitialKindMap(position));
  if (kinds.length === 1) return pieceNameJa(mgf, kinds[0]);
  let base = piece.initialKind;
  let promotedMark = '';
  if (piece.promoted) {
    const def = mgf.pieces.find((p) => p.id === piece.initialKind);
    if (def?.promoted_id) base = def.promoted_id;
    else promotedMark = '成';
  }
  return `仮${pieceNameJa(mgf, base)}${promotedMark}`;
}

/**
 * 指し手を日本語棋譜表記に変換する。position は「その手が指される直前」の局面。
 *
 * ## 本将棋・その他のルール (従来どおり)
 *
 * `▲7六歩` `▲2二角成` `▲5五桂打` — 行き先だけを書く普通の棋譜。
 *
 * ## 量子将棋のときだけ変わる (v1.14・ユーザー指示)
 *
 * `▲3三仮歩3四` のように **元の座標 + 駒名 + 行き先座標** で書く。
 *
 * 理由: 未確定の駒が多いと「そのマスへ行ける駒」が何枚もあり、行き先だけの
 * 書き方ではどの駒が動いたのか読み取れない。元の座標を書けば一意に決まる。
 *
 * - 成るときは末尾に付ける: `▲3三仮歩3四成`
 * - 打つ手は元の座標が無いので `▲仮歩打3四` (打 が持ち駒から来たことを示す)
 *
 * 量子将棋かどうかは「動かす駒が候補集合を持っているか」で判定する。
 * 本将棋モードの駒は候補集合を持たないので、自然に従来表記へ縮退する。
 */
export function formatMove(mgf: Mgf, position: Position, move: Move): string {
  // ★v1.55: 感想戦の自由な手（親 v1.49 §9.4.2.1・付録D-12 v1.4 §14.2）。
  // **手数リストに 1 行として出す**が、**「自由な手である」ことは書かない**＝
  // 感想戦の分岐はもともと記録ではないので、区別しても使い道が無い（枝であることは
  // リストの側が示す）。
  if (move.type === 'free') return formatFree(mgf, position, move);

  const mark = position.sideToMove === 'player1' ? '▲' : '△';
  const to = squareNameJa(position.width, move.to);

  if (move.type === 'drop') {
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === move.pieceId);
    const name = piece ? kifuPieceName(mgf, position, piece) : '?';
    if (piece?.candidates !== undefined) return `${mark}${name}打${to}`;
    return `${mark}${to}${name}打`;
  }
  const piece = position.board[move.from.row][move.from.col];
  const name = piece ? kifuPieceName(mgf, position, piece) : '?';
  const suffix = move.promote ? '成' : '';
  if (piece?.candidates !== undefined) {
    const from = squareNameJa(position.width, move.from);
    return `${mark}${from}${name}${to}${suffix}`;
  }
  return `${mark}${to}${name}${suffix}`;
}

/**
 * ★v1.55: 自由な手の書き方（付録D-12 v1.4 §14.2）。
 *
 * **手番ではなく駒の持ち主で先後の印を選ぶ**＝感想戦には手番の縛りが無いので、
 * 手番から選ぶと**動かした駒と印が食い違う**（名札を正体として使わない）。
 *
 * 棋譜の他の書き方と同じく**日本語で書く**（`formatMove` 全体がそうなっている）。
 */
function formatFree(mgf: Mgf, position: Position, move: Extract<Move, { type: 'free' }>): string {
  const piece = move.from
    ? position.board[move.from.row][move.from.col]
    : position.hands.player1.find((p) => p.pieceId === move.pieceId) ??
      position.hands.player2.find((p) => p.pieceId === move.pieceId) ??
      null;
  const mark = piece?.owner === 'player2' ? '△' : '▲';
  const name = piece ? kifuPieceName(mgf, position, piece) : '?';
  const src = move.from ? squareNameJa(position.width, move.from) : '';

  if (move.dest.kind === 'discard') return `${mark}${src}${name} を消す`;
  if (move.dest.kind === 'hand') {
    const side = move.dest.owner === 'player1' ? '先手' : '後手';
    return `${mark}${src}${name} → ${side}の駒台`;
  }
  const sq = move.dest.square;
  // 同じマスへ戻す手＝**成り・不成の切り替え**（§9.4.2.1）。
  if (move.from && move.from.row === sq.row && move.from.col === sq.col) {
    return move.promote ? `${mark}${src}${name} を成る` : `${mark}${src}${name} を不成に`;
  }
  return `${mark}${src}${name} → ${squareNameJa(position.width, sq)}`;
}
