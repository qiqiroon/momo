import type { Position } from './types';

/**
 * 局面ハッシュ (千日手判定用) を生成する。
 * 仕様: 盤面配置 + 持ち駒 + 手番 + (各駒の候補集合) のハッシュ一致で同一局面と判定
 * (親仕様 §3.11・§4.2)。通常モードでは候補集合は不変・単一駒種なので実質
 * 「盤面 + 持ち駒 + 手番」の一致判定と等価。
 */
export function positionHash(position: Position): string {
  const boardParts: string[] = [];
  for (let row = 0; row < position.height; row++) {
    const rowParts: string[] = [];
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell) {
        rowParts.push('.');
      } else {
        const owner = cell.owner === 'player1' ? 'P' : 'p';
        rowParts.push(`${owner}${cell.kind}${cell.promoted ? '+' : ''}`);
      }
    }
    boardParts.push(rowParts.join('|'));
  }
  const board = boardParts.join('/');
  const h1 = position.hands.player1
    .map((p) => p.kind)
    .sort()
    .join(',');
  const h2 = position.hands.player2
    .map((p) => p.kind)
    .sort()
    .join(',');
  return `${board}#${h1}#${h2}#${position.sideToMove}`;
}
