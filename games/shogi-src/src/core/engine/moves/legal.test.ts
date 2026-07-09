import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { DropMove, PieceInstance, Position } from '../position/types';
import { generateLegalMoves, isCheckmate, isMoveLegal } from './legal';
import { generateDropMoves } from './drops';

function withPieceInHand(pos: Position, kind: string, owner: 'player1' | 'player2', pieceId = 'H1'): Position {
  const piece: PieceInstance = { pieceId, kind, owner, initialOwner: owner === 'player1' ? 'player2' : 'player1', promoted: false };
  return { ...pos, hands: { ...pos.hands, [owner]: [...pos.hands[owner], piece] } };
}

describe('generateLegalMoves at initial (no fouls apply, same as pseudo)', () => {
  it('sente has 30 legal moves (no drops available)', () => {
    const pos = initPosition(hondou);
    const moves = generateLegalMoves(hondou, pos);
    expect(moves).toHaveLength(30);
  });
});

describe('nifu (二歩) rule', () => {
  it('cannot drop fu on file where own fu already exists', () => {
    let pos = initPosition(hondou);
    pos = withPieceInHand(pos, 'fu', 'player1', 'P_test');
    // File col 2 already has sente 歩 at row 6. Try dropping fu at (row 4 col 2).
    const drop: DropMove = { type: 'drop', pieceId: 'P_test', to: { row: 4, col: 2 } };
    expect(isMoveLegal(hondou, pos, drop)).toBe(false);
  });

  it('can drop fu on file where own promoted fu (to) exists', () => {
    let pos = initPosition(hondou);
    // Replace sente 歩 at (6, 0) with sente と
    const newBoard = pos.board.map((r) => r.slice());
    const senteFu = newBoard[6][0]!;
    newBoard[6][0] = { ...senteFu, kind: 'to', promoted: true };
    pos = { ...pos, board: newBoard };
    pos = withPieceInHand(pos, 'fu', 'player1', 'P_test');
    const drop: DropMove = { type: 'drop', pieceId: 'P_test', to: { row: 4, col: 0 } };
    expect(isMoveLegal(hondou, pos, drop)).toBe(true);
  });
});

describe('dead_zone rule', () => {
  it('cannot drop fu on enemy back rank (would be dead)', () => {
    let pos = initPosition(hondou);
    pos = withPieceInHand(pos, 'fu', 'player1', 'P_test');
    // File without own fu: col 3. Empty at (0, 3)? Row 0 is gote back rank. Col 3 has gote 金.
    // Try col 3 row 0 → occupied. Use col 3 with occupied gote piece → generateDropMoves excludes.
    // Instead use col 5 (also gote 金 at (0,5)). Occupied.
    // Find an empty col-0 row: file 5 (col 4) — row 0 is gote 王 — occupied.
    // Actually all row 0 is gote back rank, all occupied.
    // Use another approach: place sente fu somewhere non-blocking, then drop fu at row 1 col X (empty)
    //   Row 1 has gote 飛 at col 1, gote 角 at col 7. Others empty.
    // Drop fu at (row=0, col=X) — all row 0 occupied so drops excluded.
    // Test at row 0 col 0: gote 香 → occupied → drop is not generated.
    // We can only test dead_zone if drop target is empty. Let's clear row 0 col 3.
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[0][3] = null;
    pos = { ...pos, board: newBoard };
    const drop: DropMove = { type: 'drop', pieceId: 'P_test', to: { row: 0, col: 3 } };
    expect(isMoveLegal(hondou, pos, drop)).toBe(false);
  });

  it('cannot drop kei within 2 ranks of enemy back', () => {
    let pos = initPosition(hondou);
    pos = withPieceInHand(pos, 'kei', 'player1', 'N_test');
    // Clear row 1 col 3
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[1][3] = null;
    pos = { ...pos, board: newBoard };
    const drop: DropMove = { type: 'drop', pieceId: 'N_test', to: { row: 1, col: 3 } };
    expect(isMoveLegal(hondou, pos, drop)).toBe(false);
  });
});

describe('generateDropMoves count', () => {
  it('when sente holds 1 fu with no nifu conflicts on 8 files, generates 8 * (empty in that file)', () => {
    let pos = initPosition(hondou);
    // Clear all sente fu from row 6 (so no nifu conflicts anywhere)
    const newBoard = pos.board.map((r) => r.slice());
    for (let c = 0; c < 9; c++) newBoard[6][c] = null;
    pos = { ...pos, board: newBoard };
    pos = withPieceInHand(pos, 'fu', 'player1', 'P_test');
    const drops = generateDropMoves(hondou, pos);
    // Board empty count: 9x9 = 81. Initial occupied = 40 - 9 (removed row 6 sente fu) = 31. Empty = 50.
    // But fu cannot go on row 0 (dead_zone). Row 0 has gote back rank (all 9 occupied).
    // So drops = empty squares in rows 1..8 = 50 - 0 (row 0 is occupied, subtracted already)
    // Actually more clearly: drops generated for any empty square. dead_zone filter is applied in isMoveLegal, not generateDropMoves.
    // Total empty squares:
    //   Row 0: 0 empty (9 occupied)
    //   Row 1: 7 empty (2 occupied)
    //   Row 2: 0 empty (9 gote fu)
    //   Rows 3-5: 27 empty
    //   Row 6: 9 empty (we cleared)
    //   Row 7: 7 empty (2 occupied)
    //   Row 8: 0 empty (9 sente back rank)
    // Total = 0 + 7 + 0 + 27 + 9 + 7 + 0 = 50
    expect(drops).toHaveLength(50);
  });
});

describe('suicide filter', () => {
  it('cannot move a pinned piece that would expose own king', () => {
    // Setup: sente 王 at (8, 4), sente 金 at (5, 4) pinned by gote 飛 at (2, 4).
    // Moving the 金 sideways would expose the 王 to the 飛.
    const kingId = 'K';
    const kinId = 'G';
    const hiId = 'r';
    const pos: Position = {
      width: 9,
      height: 9,
      board: (() => {
        const b: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
        b[8][4] = { pieceId: kingId, kind: 'ou', owner: 'player1', initialOwner: 'player1', promoted: false };
        b[5][4] = { pieceId: kinId, kind: 'kin', owner: 'player1', initialOwner: 'player1', promoted: false };
        b[2][4] = { pieceId: hiId, kind: 'hi', owner: 'player2', initialOwner: 'player2', promoted: false };
        return b;
      })(),
      hands: { player1: [], player2: [] },
      sideToMove: 'player1',
      moveNumber: 1,
      history: [],
    };
    // Try moving 金 (5,4) sideways to (5,3) — would expose king to check.
    const suicide = { type: 'move' as const, pieceId: kinId, from: { row: 5, col: 4 }, to: { row: 5, col: 3 }, promote: false };
    expect(isMoveLegal(hondou, pos, suicide)).toBe(false);
    // Moving 金 forward or backward on the same file should NOT be suicide
    const safeMove = { type: 'move' as const, pieceId: kinId, from: { row: 5, col: 4 }, to: { row: 4, col: 4 }, promote: false };
    expect(isMoveLegal(hondou, pos, safeMove)).toBe(true);
  });
});

describe('isCheckmate', () => {
  it('initial position is not checkmate', () => {
    const pos = initPosition(hondou);
    expect(isCheckmate(hondou, pos)).toBe(false);
  });

  it('simple mate: sente 王 on edge, gote 飛 delivers checkmate', () => {
    // 王 at (0, 0) (top-left corner), gote 飛 at (0, 8) attacks along row 0.
    // 王 can escape? To (1, 0), (1, 1), (0, 1). But (0, 1) is on the 飛's line — still attacked.
    // (1, 0) — attacked by 飛? No, 飛 on row 0 only attacks row 0. (1, 0) is safe.
    // So NOT mate. Let me construct a real mate:
    // 王 at (0, 0), gote 金 at (1, 1), gote 銀 at (1, 0)?
    // Actually simpler: 頭金 mate. 王 at (0, 4), sente turn, gote 金 at (1, 4), attacker 金 at (1, 4). 王 can move to?
    // Escape options: (0, 3), (0, 5), (1, 3), (1, 4)[gote 金 here], (1, 5).
    // Gote 金 at (1, 4) attacks (0, 3), (0, 4), (0, 5), (1, 3), (1, 5), (2, 3), (2, 4), (2, 5).
    // 王 can move to (0, 3)? Attacked by 金. (0, 5)? Attacked. (1, 3)? Attacked. (1, 5)? Attacked.
    // 王 can capture 金 at (1, 4)? 金 protected by another gote piece? If no protector, 王 can capture, so not mate.
    // Need protector. Say gote 歩 at (2, 4) protects 金 at (1, 4)? gote 歩's forward move for player2 = row+1. (2, 4) → (3, 4). Doesn't protect (1, 4).
    // Use gote 香 at (3, 4): attacks (2, 4) (blocked by 歩), (1, 4), (0, 4). Hmm 香 for player2 forward = row +1. So from (3, 4) attacks (4, 4), (5, 4), ... NOT (1, 4). Wrong direction.
    // Use gote 香 at (5, 4) attacking upward for player2 = row+1. From (5, 4) attacks (6, 4), (7, 4)... — also wrong.
    // For gote 香 to attack (1, 4), 香 must be on same file, higher row than 1 (i.e., 2-8), and moving toward row+1... no wait, player2 forward = row+1 means moving DOWN. So gote 香 at row R (R>1) can NOT attack row 1 (which is above R).
    // Simpler: use gote 飛 (which is omnidirectional).
    // 王 at (0,4), gote 飛 at (0,8) delivers check along row 0. Gote 金 at (1, 4) covers row 1 near king.
    // Escape (0, 3): attacked by 飛 (row 0). No good.
    // (0, 5): attacked by 飛. No good.
    // (1, 3): attacked by 金 at (1,4). No good.
    // (1, 4): attacked by 金? No, 金 IS at (1, 4). 王 tries capture — but 金 is protected by 飛 (row 0, unable to attack (1, 4) though). Actually 飛 at (0, 8) attacks (0, 4) etc., not (1, 4).
    //   If 金 is UNPROTECTED, 王 captures. So need protector for 金.
    //   Gote 桂 at (3, 5) protects (1, 4)? Player2 knight forward = row +2. From (3, 5), attack (5, 4) and (5, 6). NO, wrong dir.
    //   Player2 桂 from (row, col) attacks (row+2, col-1) and (row+2, col+1). To protect (1, 4), need 桂 at (-1, 3) or (-1, 5). OOB.
    //   Alternative: sente 王 at (0, 4), gote 銀 at (1, 4) covers rows around, gote 金 at (2, 5) or (2, 3) protects 銀?
    //   Gote 銀 at (1, 4) attacks (2, 3), (2, 4), (2, 5), (0, 3), (0, 5), but NOT (0, 4) directly. Wait 銀 for player2 goes forward (row +1), forward_diagonal, backward_diagonal.
    //   forward = (2, 4). fwd_diagonal = (2, 3) and (2, 5). backward_diagonal = (0, 3) and (0, 5).
    //   So gote 銀 at (1, 4) attacks (0, 3), (0, 5), (2, 3), (2, 4), (2, 5). NOT (0, 4).
    //   So 王 at (0, 4) is NOT in check from 銀 at (1, 4). Bad mate.
    // Let me use gote 飛 at (1, 4) to check king at (0, 4) directly. But then 王 can capture 飛 unless protected.
    // Protector: gote 香 at (2, 4)? Player2 香 forward = row +1. From (2, 4), attacks (3, 4), (4, 4)... NOT (1, 4). Wrong dir.
    // Actually player2 香 attacks rows > its row. Not useful for protecting row 1.
    // Use gote 桂 at (3, 3): player2 桂 from (3, 3) attacks (5, 2) and (5, 4). NOT (1, 4).
    // Actually 桂 for player2 = knight direction: forward=row+1 so forward*2 = row+2. Offsets (drow=2, dcol=-1) and (drow=2, dcol=1). From (3, 3): (5, 2) and (5, 4). NOT (1, 4).
    // Hmm.
    // Simpler: 詰将棋 with 飛 back rank check. 王 at (0, 4). Gote 飛 at (0, 4) mate. No — 飛 IS on 王's square. Nonsense.
    // Let me use rook + gold: gote 飛 at (1, 4) delivers check on 王 at (0, 4). Gote 金 at (2, 5) protects the 飛 (attacks (1, 4)+(1, 5)+(1, 6)+(2, 4)+(2, 6)+(3, 5))? Player2 gold: forward, backward, sideways, fwd_diagonal. From (2, 5): (3, 5) fwd, (1, 5) back, (2, 4) sw, (2, 6) sw, (3, 4) fwd_diag, (3, 6) fwd_diag. NOT (1, 4).
    // Use gote 金 at (2, 4): attacks (3, 4), (1, 4), (2, 3), (2, 5), (3, 3), (3, 5). Yes (1, 4). Good.
    // 王 at (0, 4). Sente turn (in check from 飛 at (1, 4)).
    //   Escape (0, 3): attacked? 飛 at (1, 4) doesn't hit (0, 3). Not attacked by other pieces. 王 can go to (0, 3). NOT mate.
    // Need more coverage.
    // Full mate setup: 王 at (0, 4), gote 飛 at (1, 4), gote 金 at (2, 4) protects 飛 and covers (1, 4) and adjacent.
    //   Actually 金 at (2, 4) covers (1, 4), (1, 3), (1, 5), (2, 3), (2, 5), (3, 3), (3, 4), (3, 5) — includes (1, 3), (1, 5).
    //   王 at (0, 4). Escape options: (0, 3), (0, 5), (1, 3)*attacked, (1, 4)*attacked=飛, (1, 5)*attacked.
    //   (0, 3), (0, 5): attacked by 飛 (via row 0 sliding). Wait 飛 at (1, 4) → sideways slides (row 1). Backward = row 0. So 飛 attacks (0, 4). Only column 4 for backward/forward direction. (0, 3) NOT attacked. (0, 5) NOT attacked.
    //   So 王 escapes to (0, 3) or (0, 5). NOT mate.
    // Need coverage of (0, 3) and (0, 5). Add gote 銀 at (1, 3)? 銀 attacks (0, 2), (0, 3), (0, 4) [!] via backward_diagonal & forward = wait player2 銀 fwd = row+1, backward_diag = row-1 col±1. From (1, 3): backward_diag = (0, 2) and (0, 4). Forward = (2, 3). fwd_diag = (2, 2) and (2, 4). Hmm.
    //   So 銀 at (1, 3) attacks (0, 2) and (0, 4). NOT (0, 3).
    // Fine, use gote 香 at (2, 3): player2 香 fwd = row+1. From (2, 3): attacks (3, 3), (4, 3)... NOT (0, 3).
    // Simplest: use a piece that attacks (0, 3) via 王's escape. Gote 桂 at (2, 4) attacks (4, 3) and (4, 5). Not (0, 3).
    // Gote 銀 at (1, 2)? backward_diag = (0, 1), (0, 3). Yes (0, 3) attacked. But then 銀 is unprotected, 王 can move (0, 3) still — wait, if attacked, 王 can't move there.
    // OK 王 at (0, 4). Gote pieces: 飛 at (1, 4), 金 at (2, 4), 銀 at (1, 2). Now 王 escape options:
    //   (0, 3): attacked by 銀 at (1, 2) (backward_diag (0, 3) yes). Blocked.
    //   (0, 5): not attacked (checking pieces: 飛 covers col 4 not 5, 金 at (2, 4) covers row 1 & 3, 銀 covers (0, 1)(0, 3) not (0, 5)). Escape.
    //   → still not mate.
    // Symmetrical: add 銀 at (1, 6) attacks (0, 5), (0, 7) via backward_diag. But 銀 at (1, 6)'s backward_diag for player2 = row-1 col±1 = (0, 5) and (0, 7).
    //   Now (0, 5) attacked. 王 has no escape at row 0.
    // 王 at (0, 4) also cannot capture 飛 at (1, 4) — 飛 protected by 金 at (2, 4). Actually wait, 金 attacks (1, 4)? From (2, 4) player2 金: fwd=row+1 = (3, 4). Not (1, 4). backward = (1, 4). Yes, (1, 4) attacked by 金 backward.
    //   So 飛 at (1, 4) is protected by 金. 王 cannot capture.
    // What about intermediate coverage? 王 escape (1, 3)? Attacked by 金 at (2, 4) (fwd_diagonal = (3, 3), (3, 5); backward_diag not exists; sideways = (2, 3), (2, 5)). Hmm 金 doesn't cover (1, 3). But 銀 at (1, 2) covers (1, 3)? No, 銀 doesn't have sideways.
    //   From (1, 3) — is it attacked by anyone?
    //   - 飛 at (1, 4) — 飛 attacks (1, 3) via sideways slide. YES.
    //   So (1, 3) attacked. Good.
    //   (1, 5) attacked by 飛 (sideways). Good.
    //   (1, 4): the 飛 itself. Capturing? 飛 protected by 金 at (2, 4) (backward). So cannot capture.
    // So mate. Let me use this setup.
    const buildSquare = (kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance => ({
      pieceId: `${owner}_${kind}`,
      kind,
      owner,
      initialOwner: owner,
      promoted,
    });
    const pos: Position = {
      width: 9,
      height: 9,
      board: (() => {
        const b: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
        b[0][4] = buildSquare('ou', 'player1');
        b[1][4] = buildSquare('hi', 'player2');
        b[2][4] = buildSquare('kin', 'player2');
        b[1][2] = buildSquare('gin', 'player2');
        b[1][6] = buildSquare('gin', 'player2');
        return b;
      })(),
      hands: { player1: [], player2: [] },
      sideToMove: 'player1',
      moveNumber: 1,
      history: [],
    };
    expect(isCheckmate(hondou, pos)).toBe(true);
  });
});
