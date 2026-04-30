// MOMO Go — 囲碁ルールエンジン
// SPEC.md 8章「囲碁仕様」準拠の純粋ロジック。UI と DOM に一切依存しない。
//
// 公開API:
//   GoRules.placeMove(board, x, y, color, prevOwnBoard, size?)
//     着手シミュレーション。返り値は { valid, illegalReason?, newBoard?, captured? }。
//   GoRules.getBlock(board, x, y, size?)
//     (x,y) の同色連結ブロックと呼吸点数を返す。空点・盤外なら null。
//   GoRules.boardEquals(a, b)
//     盤面の構造的等価性チェック（コウ判定の補助）。
//   GoRules.cloneBoard(board)
//     盤面のディープコピー。
//   GoRules.createEmptyBoard(size)
//     空の盤面を生成する。
//
// 盤面表現:
//   board[y][x] = null | 'black' | 'white'
//   座標は (x, y) で 0 始まり、盤面サイズは 19 が既定。

(function (root) {
  const DEFAULT_SIZE = 19;

  function inBounds(x, y, size) {
    return x >= 0 && x < size && y >= 0 && y < size;
  }

  function neighbors(x, y, size) {
    // 4 近傍（盤外は除く）
    const out = [];
    if (x > 0)        out.push({ x: x - 1, y });
    if (x < size - 1) out.push({ x: x + 1, y });
    if (y > 0)        out.push({ x, y: y - 1 });
    if (y < size - 1) out.push({ x, y: y + 1 });
    return out;
  }

  function cloneBoard(board) {
    const out = new Array(board.length);
    for (let y = 0; y < board.length; y++) out[y] = board[y].slice();
    return out;
  }

  function createEmptyBoard(size) {
    size = size || DEFAULT_SIZE;
    const out = new Array(size);
    for (let y = 0; y < size; y++) {
      out[y] = new Array(size).fill(null);
    }
    return out;
  }

  function boardEquals(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let y = 0; y < a.length; y++) {
      const ra = a[y], rb = b[y];
      if (ra.length !== rb.length) return false;
      for (let x = 0; x < ra.length; x++) {
        if (ra[x] !== rb[x]) return false;
      }
    }
    return true;
  }

  // (x,y) を含む同色ブロック（連結成分）の全石と呼吸点数を返す。
  // 空点や盤外は null を返す。
  // 戻り値:  { color, stones: [{x,y}], liberties: number }
  function getBlock(board, x, y, size) {
    size = size || (board && board.length) || DEFAULT_SIZE;
    if (!inBounds(x, y, size)) return null;
    const color = board[y][x];
    if (!color) return null;
    const stones = [];
    const visited = new Set();
    const liberties = new Set();
    const startKey = y * size + x;
    visited.add(startKey);
    const queue = [{ x, y }];
    while (queue.length) {
      const p = queue.shift();
      stones.push(p);
      for (const n of neighbors(p.x, p.y, size)) {
        const k = n.y * size + n.x;
        const c = board[n.y][n.x];
        if (c === null) {
          liberties.add(k);
        } else if (c === color) {
          if (!visited.has(k)) {
            visited.add(k);
            queue.push(n);
          }
        }
      }
    }
    return { color, stones, liberties: liberties.size };
  }

  // 着手シミュレーション。
  // 引数:
  //   board: 現盤面
  //   x, y: 着手位置
  //   color: 'black' | 'white'
  //   prevOwnBoard: コウ判定の参照盤面（null可）
  //                 = 同じプレイヤーが前回着手した直後の盤面
  //                 = 相手が直前手で打つ前の盤面
  //   size: 盤面サイズ（省略時 board.length、既定 19）
  // 戻り値:
  //   成功: { valid: true, newBoard, captured: [{x,y,color}] }
  //   失敗: { valid: false, illegalReason: 'occupied'|'suicide'|'ko' }
  function placeMove(board, x, y, color, prevOwnBoard, size) {
    size = size || (board && board.length) || DEFAULT_SIZE;
    if (!inBounds(x, y, size)) return { valid: false, illegalReason: 'occupied' };
    if (board[y][x] !== null) return { valid: false, illegalReason: 'occupied' };
    if (color !== 'black' && color !== 'white') {
      return { valid: false, illegalReason: 'occupied' };
    }

    // 1. 仮置き（着手位置に石を置く）
    const temp = cloneBoard(board);
    temp[y][x] = color;

    // 2. 隣接する相手のブロックで呼吸点ゼロのものを取り上げる
    const oppColor = (color === 'black') ? 'white' : 'black';
    const captured = [];
    const capturedKeys = new Set();
    for (const n of neighbors(x, y, size)) {
      if (temp[n.y][n.x] !== oppColor) continue;
      const k = n.y * size + n.x;
      if (capturedKeys.has(k)) continue;
      const block = getBlock(temp, n.x, n.y, size);
      if (block && block.liberties === 0) {
        for (const s of block.stones) {
          const sk = s.y * size + s.x;
          if (!capturedKeys.has(sk)) {
            capturedKeys.add(sk);
            captured.push({ x: s.x, y: s.y, color: oppColor });
            temp[s.y][s.x] = null;
          }
        }
      }
    }

    // 3. 自殺手判定: 取り上げ後、自分のブロックの呼吸点が 0 なら無効
    //    （相手を取り上げて呼吸点を確保できた場合は合法）
    const myBlock = getBlock(temp, x, y, size);
    if (!myBlock || myBlock.liberties === 0) {
      return { valid: false, illegalReason: 'suicide' };
    }

    // 4. コウ判定: 取り上げ後の盤面が prevOwnBoard と同一なら無効
    if (prevOwnBoard && boardEquals(temp, prevOwnBoard)) {
      return { valid: false, illegalReason: 'ko' };
    }

    return { valid: true, newBoard: temp, captured };
  }

  const api = {
    placeMove,
    getBlock,
    boardEquals,
    cloneBoard,
    createEmptyBoard,
    DEFAULT_SIZE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GoRules = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
