import type { Mgf, Player } from '../mgf/types';
import type { BoardCell, BoardTopology, PieceInstance, Position } from './types';
import { findHandicap, selectRemovedPieces, type HandicapSetting } from '../handicap';

const SFEN_LETTER_TO_KIND: Record<string, string> = {
  p: 'fu',
  l: 'kyo',
  n: 'kei',
  s: 'gin',
  g: 'kin',
  b: 'kaku',
  r: 'hi',
  k: 'ou',
};

/**
 * MGF の初期配置から開始局面を作る。
 *
 * Phase 4: `topology` を渡すと盤の端がつながった状態 (円筒・完全トーラス) で始まる。
 * 省略時は平面＝通常の将棋盤。
 *
 * Phase 3-3: `handicap` を渡すと**上手側の駒を落としてから**始まる (親 §3.12.1)。
 * 落とした駒は盤にも持ち駒にも現れず、**通し番号は落としたあとに振る**ので欠番は出ない。
 * 先手は**駒を落とした側**になる (将棋の作法・初期配置の手番指定より優先)。
 */
export function initPosition(mgf: Mgf, topology?: BoardTopology, handicap?: HandicapSetting): Position {
  const { width, height } = mgf.board;
  const board: BoardCell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null as BoardCell),
  );
  const placement = mgf.initial_placement;
  if (placement.format !== 'sfen' || !placement.sfen) {
    throw new Error('Phase 1-2 supports SFEN placement only');
  }

  const [boardStr, sideStr] = placement.sfen.split(/\s+/);
  const ranks = boardStr.split('/');
  if (ranks.length !== height) {
    throw new Error(`SFEN rank count ${ranks.length} does not match board height ${height}`);
  }

  const player1Pieces: PieceInstance[] = [];
  const player2Pieces: PieceInstance[] = [];

  for (let row = 0; row < height; row++) {
    let col = 0;
    let i = 0;
    const rankStr = ranks[row];
    while (i < rankStr.length && col < width) {
      let ch = rankStr[i];
      let promoted = false;
      if (ch === '+') {
        promoted = true;
        i++;
        ch = rankStr[i];
      }
      if (/[0-9]/.test(ch)) {
        col += Number.parseInt(ch, 10);
        i++;
        continue;
      }
      const isUpperCase = ch === ch.toUpperCase();
      const owner: Player = isUpperCase ? 'player1' : 'player2';
      const letter = ch.toLowerCase();
      const baseKind = SFEN_LETTER_TO_KIND[letter];
      if (!baseKind) throw new Error(`Unknown SFEN piece letter: ${ch}`);
      const kind = promoted ? getPromotedId(mgf, baseKind) : baseKind;
      const piece: PieceInstance = {
        pieceId: '',
        kind,
        owner,
        initialOwner: owner,
        initialKind: kind,
        initialSquare: { row, col },
        promoted,
      };
      board[row][col] = piece;
      if (owner === 'player1') player1Pieces.push(piece);
      else player2Pieces.push(piece);
      col++;
      i++;
    }
  }

  // 手合い (駒落ち): 番号を振る前に上手側の駒を取り除く (親 §3.12.1)
  let remaining1 = player1Pieces;
  let remaining2 = player2Pieces;
  if (handicap) {
    const type = findHandicap(mgf, handicap.typeId);
    if (!type) throw new Error(`Unknown handicap: ${handicap.typeId}`);
    const giverPieces = handicap.giver === 'player1' ? player1Pieces : player2Pieces;
    const removed = selectRemovedPieces(giverPieces, type, handicap.giver);
    for (const p of removed) {
      board[p.initialSquare.row][p.initialSquare.col] = null;
    }
    if (handicap.giver === 'player1') remaining1 = player1Pieces.filter((p) => !removed.includes(p));
    else remaining2 = player2Pieces.filter((p) => !removed.includes(p));
  }

  remaining1.forEach((p, idx) => {
    p.pieceId = `P${idx}`;
  });
  remaining2.forEach((p, idx) => {
    p.pieceId = `p${idx}`;
  });

  // 手合いを指定したときは、駒を落とした側 (上手) が先手 (親 §3.12.1)
  const sideToMove: Player = handicap ? handicap.giver : sideStr === 'w' ? 'player2' : 'player1';

  return {
    width,
    height,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
    ...(topology && (topology.wrapX || topology.wrapY) ? { topology } : {}),
  };
}

function getPromotedId(mgf: Mgf, baseId: string): string {
  const def = mgf.pieces.find((p) => p.id === baseId);
  if (!def?.promoted_id) throw new Error(`No promoted_id defined for ${baseId}`);
  return def.promoted_id;
}
