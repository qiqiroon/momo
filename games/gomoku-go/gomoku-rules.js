/**
 * gomoku-rules.js  v1.1
 * 五目並べルールエンジン
 *
 * 段階2: 自由ルールのみ（5連以上で勝ち、禁じ手なし）
 * 段階3で正規ルール（連珠）の禁じ手判定を追加予定
 */

const GomokuRules = (() => {

  /**
   * 直前に置かれた石を起点に、4方向で5連以上ができたか判定する。
   * 自由ルール: 黒白ともに5連以上で勝ち（長連も勝ちと判定）。
   *
   * @param {Array<Array<string|null>>} board - 盤面 [y][x]
   * @param {number} x - 着手の x（0..size-1）
   * @param {number} y - 着手の y（0..size-1）
   * @param {string} color - 'black' or 'white'
   * @param {number} size - 盤面サイズ（19）
   * @returns {Array<{x:number,y:number}>|null} 5連の座標配列（同色で連続する全石）。勝ちなしなら null
   */
  function checkWin(board, x, y, color, size) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]; // 横、縦、右下、右上
    for (const [dx, dy] of dirs) {
      const line = [{ x, y }];
      // 正方向
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        line.push({ x: nx, y: ny });
        nx += dx; ny += dy;
      }
      // 逆方向
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        line.push({ x: nx, y: ny });
        nx -= dx; ny -= dy;
      }
      if (line.length >= 5) return line;
    }
    return null;
  }

  return { checkWin };
})();
