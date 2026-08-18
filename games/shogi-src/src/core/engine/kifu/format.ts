import type { Mgf } from '../mgf/types';
import type { Move, PieceInstance, Position } from '../position/types';
import { buildInitialKindMap, displayKindsFor } from '../candidate-kinds';

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const NAME_MAP_JA: Record<string, string> = {
  fu: '歩',
  kyo: '香',
  kei: '桂',
  gin: '銀',
  kin: '金',
  kaku: '角',
  hi: '飛',
  ou: '王',
  to: 'と',
  narikyo: '成香',
  narikei: '成桂',
  narigin: '成銀',
  uma: '馬',
  ryu: '龍',
};

const NAME_MAP_EN: Record<string, string> = {
  fu: 'P',
  kyo: 'L',
  kei: 'N',
  gin: 'S',
  kin: 'G',
  kaku: 'B',
  hi: 'R',
  ou: 'K',
  to: '+P',
  narikyo: '+L',
  narikei: '+N',
  narigin: '+S',
  uma: '+B',
  ryu: '+R',
};

export function pieceNameJa(kind: string): string {
  return NAME_MAP_JA[kind] ?? kind;
}

export function pieceNameEn(kind: string): string {
  return NAME_MAP_EN[kind] ?? kind;
}

export function pieceNameFor(kind: string, locale: string): string {
  if (locale === 'en') return pieceNameEn(kind);
  return pieceNameJa(kind);
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
  if (kinds.length === 1) return pieceNameJa(kinds[0]);
  let base = piece.initialKind;
  let promotedMark = '';
  if (piece.promoted) {
    const def = mgf.pieces.find((p) => p.id === piece.initialKind);
    if (def?.promoted_id) base = def.promoted_id;
    else promotedMark = '成';
  }
  return `仮${pieceNameJa(base)}${promotedMark}`;
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
