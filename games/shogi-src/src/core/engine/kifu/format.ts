import type { Mgf } from '../mgf/types';
import type { Move, Position } from '../position/types';

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

/**
 * 指し手を日本語棋譜表記 (▲76歩 △34歩 ▲22角成 ▲55桂打 等) に変換する。
 * position は「その手が指される直前」の局面。
 */
export function formatMove(_mgf: Mgf, position: Position, move: Move): string {
  const mark = position.sideToMove === 'player1' ? '▲' : '△';
  const shogiFile = position.width - move.to.col;
  const shogiRank = move.to.row + 1;
  const coord = `${shogiFile}${RANK_KANJI[shogiRank - 1] ?? shogiRank}`;

  if (move.type === 'drop') {
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === move.pieceId);
    const name = piece ? pieceNameJa(piece.kind) : '?';
    return `${mark}${coord}${name}打`;
  }
  const piece = position.board[move.from.row][move.from.col];
  const name = piece ? pieceNameJa(piece.kind) : '?';
  const suffix = move.promote ? '成' : '';
  return `${mark}${coord}${name}${suffix}`;
}
