import type { Mgf } from '../mgf/types';
import type { BoardCell, Move, MoveStep, PieceInstance, Position } from './types';
import { sandwichCaptures } from '../moves/sandwich';
import { buildInitialKindMap, displayKindsFor } from '../candidate-kinds';
import {
  capturedGoesToHand,
  promotionChoicesOf,
  promotionTypeOf,
  unpromotedKindOf,
} from '../piece-rules';

/**
 * Position に Move を適用して新しい Position を返す (immutable)。
 * 合法性チェックは行わない (呼び出し側の責務)。
 */
export function applyMove(mgf: Mgf, position: Position, move: Move): Position {
  const newBoard: BoardCell[][] = position.board.map((row) => row.slice());
  const newHands = {
    player1: position.hands.player1.slice(),
    player2: position.hands.player2.slice(),
  };

  // ★v1.55: 感想戦の自由な手（親 v1.49 §9.4.2.1）。**合法性を一切見ない**のはこの
  // 関数の元からの約束（呼び出し側の責務）だが、こちらは**駒台へ移す・消す**という
  // 行き先を持つので別に扱う。**対局では絶対に生まれない**。
  if (move.type === 'free') {
    return applyFree(mgf, position, move, newBoard, newHands);
  }

  if (move.type === 'move') {
    const piece = newBoard[move.from.row][move.from.col];
    if (!piece) throw new Error(`No piece at from (${move.from.row}, ${move.from.col})`);
    if (piece.pieceId !== move.pieceId) {
      throw new Error(`Piece ID mismatch at from: expected ${move.pieceId}, got ${piece.pieceId}`);
    }

    const captured = newBoard[move.to.row][move.to.col];
    if (captured) {
      // 【v1.65 §5.5.8 / §3.6】**取った駒が駒台へ入るかは駒ごとの欄で決まる**。
      // 以前はここが無条件だったので、駒台を持たないルール (チェスの捕獲＝盤から
      // 取り除く) を書いても駒が駒台へ溜まった。**判定は「戻したあとの駒種」で行う**
      // ので、将棋の と金 は元の 歩 として従来どおり駒台へ入る (piece-rules 参照)。
      const kinds = displayKindsFor(mgf, captured, buildInitialKindMap(position));
      if (capturedGoesToHand(mgf, kinds)) {
        const handPiece: PieceInstance = {
          pieceId: captured.pieceId,
          kind: captured.promoted ? unpromotedKindOf(mgf, captured.kind) : captured.kind,
          owner: piece.owner,
          initialOwner: captured.initialOwner,
          initialKind: captured.initialKind,
          initialSquare: captured.initialSquare,
          promoted: false,
          ...(captured.candidates !== undefined ? { candidates: captured.candidates } : {}),
          ...(captured.confirmed !== undefined ? { confirmed: captured.confirmed } : {}),
        };
        newHands[piece.owner].push(handPiece);
      }
      // 駒台へ入らない駒は**盤から取り除かれる**だけ (行き先を持たない)。
      // 盤から消す処理はこの下の「移動元・移動先の書き換え」が兼ねている。
    }

    let newKind = piece.kind;
    let newPromoted = piece.promoted;
    if (move.promote && !piece.promoted) {
      const def = mgf.pieces.find((p) => p.id === piece.kind);
      if (def && promotionTypeOf(def) === 'replace') {
        // 【v1.65 §3.6.2】**入れ替わる昇格**＝昇格した駒は昇格先の駒そのもので、
        // それ以上でも以下でもない。**元が何だったかを覚えておく理由が無い**
        // (取られて駒台へ戻ることが無いので) ため、**成り駒の印は立てない**＝
        // 裏返る成りの赤も付かない (先後を文字の色で表すルールで 3 色目にしない)。
        newKind = move.promoteTo ?? promotionChoicesOf(def)[0] ?? piece.kind;
        newPromoted = false;
      } else if (def?.promoted_id) {
        newKind = def.promoted_id;
        newPromoted = true;
      } else if (piece.candidates !== undefined) {
        // v1.48 (ユーザー報告 2026-08-18・量子分冊 §Q11.3):
        // **成るかどうかは piece.kind で決めてはいけない**。量子モードの piece.kind は
        // 「対局開始時にその位置に置かれていた駒種」であって正体ではないので、金・王の
        // マスから来た駒は正体が桂でも成れなかった (成った姿を持たない駒種のため)。
        // 実害は 2 つ:
        //   - 成りが必須の位置 (後手の桂が 8 段目など) へ跳ぶと、成らないまま着地する
        //     → 行き所のない駒 (C-104) / 強制成り (C-105) が候補を全部落とし、候補が空
        //       になって量子異常になっていた (今回の報告そのもの)
        //   - 成りが任意の位置では、「成る」を選んでも黙って成らなかった
        // 分冊 §Q11.3 は「成ることを選択した場合、駒は成駒となる」と無条件に定めており、
        // 名札は条件に入っていない。候補側の整合は C-101/C-105/C-109 が引き受ける
        // (成れない駒種=王・金 の候補は成った時点で落ちる・§Q11.4)。
        // **kind は名札のまま据え置く** (成った姿を持たないので置き換える先が無い)。
        // 盤の顔も棋譜の駒名も候補から作る (candidate-kinds.ts) ので表示は変わらない。
        // 通常将棋モード (candidates undefined) はこの枝に入らず従来どおり。
        newPromoted = true;
      }
    }
    newBoard[move.from.row][move.from.col] = null;
    newBoard[move.to.row][move.to.col] = {
      ...piece,
      kind: newKind,
      promoted: newPromoted,
    };
  } else {
    const player = position.sideToMove;
    const handIdx = newHands[player].findIndex((p) => p.pieceId === move.pieceId);
    if (handIdx < 0) throw new Error(`Piece ${move.pieceId} not in hand for ${player}`);
    if (newBoard[move.to.row][move.to.col]) {
      throw new Error(`Drop target (${move.to.row}, ${move.to.col}) is occupied`);
    }
    const dropped = newHands[player][handIdx];
    newHands[player].splice(handIdx, 1);
    newBoard[move.to.row][move.to.col] = { ...dropped };
  }


/**
 * ★v1.55: 感想戦の自由な手を適用する（親 v1.49 §9.4.2.1）。
 *
 * **ここでは何も検めない**＝王手も二歩も行き所のない駒も見ない（感想戦には
 * 不可操作が無い）。**量子の候補も触らない**（量子分冊 §Q22＝自由な手は正体に
 * ついて何も語っていないので、絞ると嘘の絞り込みになる）。**駒は無から作らない**
 * （§Q22.3）ので、動かすのは既に在る駒だけである。
 *
 * **はさみの「挟んで取る」も走らせない**＝ルールを外して並べているのに、
 * ルールの一部だけが働くと、何が起きたのか読めなくなる。
 */
function applyFree(
  mgf: Mgf,
  position: Position,
  move: Extract<Move, { type: 'free' }>,
  newBoard: BoardCell[][],
  newHands: { player1: PieceInstance[]; player2: PieceInstance[] },
): Position {
  // 掴んだ駒を、元の場所から外す。
  let piece: PieceInstance | null = null;
  if (move.from) {
    piece = newBoard[move.from.row][move.from.col];
    if (!piece) throw new Error(`No piece at from (${move.from.row}, ${move.from.col})`);
    newBoard[move.from.row][move.from.col] = null;
  } else {
    for (const owner of ['player1', 'player2'] as const) {
      const idx = newHands[owner].findIndex((p) => p.pieceId === move.pieceId);
      if (idx >= 0) {
        piece = newHands[owner][idx];
        newHands[owner].splice(idx, 1);
        break;
      }
    }
    if (!piece) throw new Error(`Piece ${move.pieceId} not found in hands`);
  }
  if (piece.pieceId !== move.pieceId) {
    throw new Error(`Piece ID mismatch: expected ${move.pieceId}, got ${piece.pieceId}`);
  }

  // 成り・不成の切り替え（省略＝いまのまま）。**成った姿を持たない駒種でも
  // `promoted` だけは切り替える**＝候補から顔を作るので表示は候補側が決める
  // （§Q11.3 と同じ考え方）。
  let placed: PieceInstance = piece;
  if (move.promote !== undefined && move.promote !== piece.promoted) {
    const def = mgf.pieces.find((p) => p.id === piece!.kind);
    if (move.promote && def?.promoted_id) {
      placed = { ...piece, kind: def.promoted_id, promoted: true };
    } else if (!move.promote && !def?.promoted_id) {
      // いま成駒の名前なら、元の名前へ戻す。
      placed = { ...piece, kind: getUnpromotedKind(mgf, piece.kind), promoted: false };
    } else {
      placed = { ...piece, promoted: move.promote };
    }
  }

  if (move.dest.kind === 'discard') {
    // どこにも行かない（盤からも駒台からも消える）。
    return { ...position, board: newBoard, hands: newHands, history: position.history };
  }

  if (move.dest.kind === 'hand') {
    // **どちらの駒台へでも移せる**（自分の駒でも相手の駒でも）。
    // **成りは落とす**＝駒台の駒は成っていない姿で持つ（対局の捕獲と同じ）。
    const owner = move.dest.owner;
    newHands[owner].push({
      ...placed,
      kind: placed.promoted ? getUnpromotedKind(mgf, placed.kind) : placed.kind,
      owner,
      promoted: false,
    });
    return { ...position, board: newBoard, hands: newHands, history: position.history };
  }

  // 盤のマスへ。**そこに駒があれば取る**（取った駒は動かした側の駒台へ）。
  const sq = move.dest.square;
  const captured = newBoard[sq.row][sq.col];
  if (captured) {
    newHands[placed.owner].push({
      ...captured,
      kind: captured.promoted ? getUnpromotedKind(mgf, captured.kind) : captured.kind,
      owner: placed.owner,
      promoted: false,
    });
  }
  newBoard[sq.row][sq.col] = placed;
  return { ...position, board: newBoard, hands: newHands, history: position.history };
}

  // 【v1.65 §3.7.1】続けて起きる動きの並び。本体の手を運んだあと、書かれた順に適用する。
  // **省略＝並び無し**＝将棋・はさみの手は素通りする。並びを持つのはキャスリング・
  // アンパッサン・獅子の 2 回行動のような複合の手だけ (手の種類は増やしていない)。
  if (move.type === 'move' && move.extra_steps) {
    for (const step of move.extra_steps) {
      applyStepInPlace(mgf, newBoard, newHands, step);
    }
  }

  // はさみ将棋の「挟んで取る」(親 §3.8 `post_move_topology`)。挟みの決まりを持たない
  // ルールでは何も起きないので、本将棋・トーラス・量子の各モードは素通りする。
  // **取った駒は持ち駒にならない**＝挟みで取るルールは駒台を持たない (§5.3)。
  const moved: Position = { ...position, board: newBoard };
  const takenIds = new Set(sandwichCaptures(mgf, moved, move.to));
  if (takenIds.size > 0) {
    for (let row = 0; row < moved.height; row++) {
      for (let col = 0; col < moved.width; col++) {
        const cell = newBoard[row][col];
        if (cell && takenIds.has(cell.pieceId)) newBoard[row][col] = null;
      }
    }
  }

  return {
    ...position,
    board: newBoard,
    hands: newHands,
    sideToMove: position.sideToMove === 'player1' ? 'player2' : 'player1',
    moveNumber: position.moveNumber + 1,
    history: [...position.history, move],
  };
}

/**
 * 【v1.65 §3.7.1】続きの動き 1 段を、その場で盤・駒台に反映する。
 *
 * 行き先は感想戦の自由な手 (applyFree) と同じ 3 種類で、扱いも揃える
 * (マスへ＝そこに駒があれば動かした側の駒台へ／駒台へ＝成りを落とす／取り除く＝消す)。
 * ここでは合法性を見ない (呼び出し側が組み立て済みの手を運ぶだけ・§3.7.1)。
 */
function applyStepInPlace(
  mgf: Mgf,
  board: BoardCell[][],
  hands: { player1: PieceInstance[]; player2: PieceInstance[] },
  step: MoveStep,
): void {
  // 動かす駒を、元の場所 (盤 or 駒台) から外す。
  let piece: PieceInstance | null = null;
  if (step.from) {
    piece = board[step.from.row][step.from.col];
    if (!piece) throw new Error(`No piece at step.from (${step.from.row}, ${step.from.col})`);
    board[step.from.row][step.from.col] = null;
  } else {
    for (const owner of ['player1', 'player2'] as const) {
      const idx = hands[owner].findIndex((p) => p.pieceId === step.pieceId);
      if (idx >= 0) {
        piece = hands[owner][idx];
        hands[owner].splice(idx, 1);
        break;
      }
    }
    if (!piece) throw new Error(`Step piece ${step.pieceId} not found in hands`);
  }
  if (piece.pieceId !== step.pieceId) {
    throw new Error(`Step piece ID mismatch: expected ${step.pieceId}, got ${piece.pieceId}`);
  }

  let placed: PieceInstance = piece;
  if (step.promote !== undefined && step.promote !== piece.promoted) {
    const def = mgf.pieces.find((p) => p.id === piece!.kind);
    if (step.promote && def?.promoted_id) {
      placed = { ...piece, kind: def.promoted_id, promoted: true };
    } else if (!step.promote && !def?.promoted_id) {
      placed = { ...piece, kind: unpromotedKindOf(mgf, piece.kind), promoted: false };
    } else {
      placed = { ...piece, promoted: step.promote };
    }
  }

  if (step.dest.kind === 'discard') return; // 盤からも駒台からも消える (アンパッサン)。

  if (step.dest.kind === 'hand') {
    const owner = step.dest.owner;
    hands[owner].push({
      ...placed,
      kind: placed.promoted ? unpromotedKindOf(mgf, placed.kind) : placed.kind,
      owner,
      promoted: false,
    });
    return;
  }

  // 盤のマスへ。そこに駒があれば、その駒が駒台へ入るかを駒ごとの欄で決める (§5.5.8)。
  const sq = step.dest.square;
  const captured = board[sq.row][sq.col];
  if (captured) {
    let kinds = [captured.kind];
    if (captured.candidates) {
      // 量子モードでは正体が候補集合。**盤と駒台から身元表を組み立てて**顔を出す
      // (buildInitialKindMap と同じ読み方だが、ここでは局面ではなく手中の盤・駒台を見る)。
      const kindMap = new Map<string, string>();
      for (const r of board) for (const c of r) if (c) kindMap.set(c.pieceId, c.initialKind);
      for (const owner of ['player1', 'player2'] as const) {
        for (const h of hands[owner]) kindMap.set(h.pieceId, h.initialKind);
      }
      kinds = displayKindsFor(mgf, captured, kindMap);
    }
    if (capturedGoesToHand(mgf, kinds)) {
      hands[placed.owner].push({
        ...captured,
        kind: captured.promoted ? unpromotedKindOf(mgf, captured.kind) : captured.kind,
        owner: placed.owner,
        promoted: false,
      });
    }
  }
  board[sq.row][sq.col] = placed;
}

function getUnpromotedKind(mgf: Mgf, kind: string): string {
  return unpromotedKindOf(mgf, kind);
}
