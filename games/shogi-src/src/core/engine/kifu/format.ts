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
 */
export function kifuPieceName(mgf: Mgf, position: Position, piece: PieceInstance): string {
  const kinds = displayKindsFor(mgf, piece, buildInitialKindMap(position));
  if (kinds.length === 1) return pieceNameJa(kinds[0]);
  let base = piece.initialKind;
  if (piece.promoted) {
    const def = mgf.pieces.find((p) => p.id === piece.initialKind);
    if (def?.promoted_id) base = def.promoted_id;
  }
  return `仮${pieceNameJa(base)}`;
}

/**
 * 指し手を日本語棋譜表記 (▲76歩 △34歩 ▲22角成 ▲55桂打 等) に変換する。
 * position は「その手が指される直前」の局面。
 */
export function formatMove(mgf: Mgf, position: Position, move: Move): string {
  const mark = position.sideToMove === 'player1' ? '▲' : '△';
  const coord = squareNameJa(position.width, move.to);

  if (move.type === 'drop') {
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === move.pieceId);
    const name = piece ? kifuPieceName(mgf, position, piece) : '?';
    return `${mark}${coord}${name}打`;
  }
  const piece = position.board[move.from.row][move.from.col];
  const name = piece ? kifuPieceName(mgf, position, piece) : '?';
  const suffix = move.promote ? '成' : '';
  return `${mark}${coord}${name}${suffix}`;
}
