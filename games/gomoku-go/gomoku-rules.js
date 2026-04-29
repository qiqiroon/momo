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
   * 戻り値は **着手位置 (x,y) を含む連続ちょうど5個** の座標配列。
   * 6連以上の場合は着手位置を中心になるべく対称に5個を選ぶ。
   *
   * @param {Array<Array<string|null>>} board - 盤面 [y][x]
   * @param {number} x - 着手の x（0..size-1）
   * @param {number} y - 着手の y（0..size-1）
   * @param {string} color - 'black' or 'white'
   * @param {number} size - 盤面サイズ（19）
   * @returns {Array<{x:number,y:number}>|null} ちょうど5個の座標配列。勝ちなしなら null
   */
  function checkWin(board, x, y, color, size) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]; // 横、縦、右下、右上
    for (const [dx, dy] of dirs) {
      // 着手位置から正方向に何個連続するか
      let posCount = 0;
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        posCount++;
        nx += dx; ny += dy;
      }
      // 着手位置から逆方向に何個連続するか
      let negCount = 0;
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        negCount++;
        nx -= dx; ny -= dy;
      }
      const total = posCount + negCount + 1;
      if (total < 5) continue;

      // 着手を中心になるべく対称に5個取る。
      // b = 負方向に取る数（着手は別、残りを正方向から取る）
      // 制約: 0 <= b <= negCount, 4-b <= posCount → b >= 4 - posCount
      const bMin = Math.max(0, 4 - posCount);
      const bMax = Math.min(negCount, 4);
      let b = 2; // 中央寄せの優先値
      if (b < bMin) b = bMin;
      if (b > bMax) b = bMax;
      const f = 4 - b;

      const line = [];
      // 負方向に b 個（着手から見て遠い順に追加していく）
      for (let i = b; i >= 1; i--) line.push({ x: x - dx * i, y: y - dy * i });
      // 着手位置
      line.push({ x, y });
      // 正方向に f 個
      for (let i = 1; i <= f; i++) line.push({ x: x + dx * i, y: y + dy * i });
      return line;
    }
    return null;
  }

  return { checkWin };
})();
