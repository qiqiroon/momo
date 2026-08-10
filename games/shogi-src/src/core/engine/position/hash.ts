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
        rowParts.push(`${owner}${cell.kind}${cell.promoted ? '+' : ''}${candidateTag(cell)}`);
      }
    }
    boardParts.push(rowParts.join('|'));
  }
  const board = boardParts.join('/');
  const h1 = position.hands.player1
    .map((p) => `${p.kind}${candidateTag(p)}`)
    .sort()
    .join(',');
  const h2 = position.hands.player2
    .map((p) => `${p.kind}${candidateTag(p)}`)
    .sort()
    .join(',');
  return `${board}#${h1}#${h2}#${position.sideToMove}`;
}

/**
 * v1.09: 候補集合をハッシュに織り込む。
 *
 * 量子将棋では駒が同じ場所に戻ってきても候補は減っているので「同じ局面」ではない。
 * 候補を無視すると、駒を往復させただけで千日手 (既定 4 回で引分) が成立してしまう。
 *
 * 本将棋モード (candidates undefined) では空文字を返すので、ハッシュ値は従来と
 * 完全に同じになる (棋譜・通信の照合に影響しない)。
 */
function candidateTag(piece: { candidates?: ReadonlySet<string> }): string {
  if (piece.candidates === undefined) return '';
  return `{${Array.from(piece.candidates).sort().join('+')}}`;
}
