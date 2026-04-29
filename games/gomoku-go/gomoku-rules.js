/**
 * gomoku-rules.js  v1.2 (段階3-3: RIF 厳密判定)
 * 五目並べルールエンジン
 *
 * 公開API:
 *   GomokuRules.checkWin(board, x, y, color, size)
 *     - 自由ルール用（後方互換）。5連以上で勝ち、ちょうど5個の座標配列を返す。
 *
 *   GomokuRules.checkWinByPreset(board, x, y, color, preset, size?)
 *     - プリセット別の勝ち判定。preset='normal'|'casual'|'free'
 *     - 戻り値: { result:'win', line:[5個], reason:'five'|'overline' } | null
 *     - 正規ルールの黒は ちょうど5連 のみ勝ち（長連は勝ちと判定しない、別途 isForbidden で禁手敗北）
 *
 *   GomokuRules.isForbidden(board, x, y, color, ruleSet, size?)
 *     - ruleSet = { overline:bool, fortyFour:bool, thirtyThree:bool }
 *     - 5連を作る手は禁手にならない（連珠の "五優先" 規則）
 *     - board は呼び出し時 (x,y)=null で渡し、関数内で一時的に置いて判定し戻す
 *
 *   GomokuRules.detectFours(board, x, y, color, size?)         -> 0..4 (方向別の四の本数)
 *   GomokuRules.detectOpenThrees(board, x, y, color, size?)    -> 0..4 (方向別の活三の本数)
 *
 *   GomokuRules.PRESET_RULESETS  -> プリセット別の禁手フラグ（黒のみ/両者/なし）
 *
 * 用語（RIF 連珠協会公式準拠）:
 *   - 連 (five):       ちょうど5連
 *   - 長連 (overline): 6連以上
 *   - 四 (four):       一手で 連 (ちょうど5連) を作れる位置を ≥1個 持つ形（達四・剣先四含む）
 *   - 達四 (open four):一手で 連 を作れる位置を ≥2個 持つ形
 *   - 活三 (open three): 一手で 達四 になれる三
 *   - 三三 (double three): 同時に2方向以上で活三が成立
 *   - 四四 (double four):  同時に2方向以上で四が成立
 */

const GomokuRules = (() => {

  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]; // 横、縦、右下、右上

  const PRESET_RULESETS = {
    normal: {
      black: { overline: true,  fortyFour: true,  thirtyThree: true  },
      white: { overline: false, fortyFour: false, thirtyThree: false }
    },
    casual: {
      black: { overline: false, fortyFour: false, thirtyThree: true  },
      white: { overline: false, fortyFour: false, thirtyThree: true  }
    },
    free: {
      black: { overline: false, fortyFour: false, thirtyThree: false },
      white: { overline: false, fortyFour: false, thirtyThree: false }
    }
  };

  // ---- 内部ヘルパー ----

  function getCell(board, x, y, size) {
    if (x < 0 || x >= size || y < 0 || y >= size) return 'OFF';
    return board[y][x] || null;
  }

  /**
   * (x,y) が color として置かれている前提で、方向 (dx,dy) の連続同色長を返す。
   * (x,y) を中心に両側に伸ばす。
   */
  function lineLength(board, x, y, dx, dy, color, size) {
    let count = 1;
    let i = 1;
    while (getCell(board, x + dx * i, y + dy * i, size) === color) { count++; i++; }
    i = 1;
    while (getCell(board, x - dx * i, y - dy * i, size) === color) { count++; i++; }
    return count;
  }

  /**
   * (x,y) を起点に、方向 (dx,dy) で連続する color の "セグメント" を返す。
   * 戻り値: { start: i_min, end: i_max } で、i は (x+i*dx, y+i*dy) のオフセット。
   * (x,y) は包含、両端は同色のまま、その外は同色でない（空・OFF・敵色）。
   */
  function segmentRange(board, x, y, dx, dy, color, size) {
    let lo = 0;
    while (getCell(board, x + dx * (lo - 1), y + dy * (lo - 1), size) === color) lo--;
    let hi = 0;
    while (getCell(board, x + dx * (hi + 1), y + dy * (hi + 1), size) === color) hi++;
    return { lo, hi };
  }

  // ---- 五連 / 長連 ----

  /**
   * (x,y)=color として、方向ごとに連続長を見て、ちょうど5連の方向があれば 5個分の座標を返す。
   * 6連以上の方向のみが存在する場合は null（長連は5連扱いしない）。
   */
  function findExactFive(board, x, y, color, size) {
    for (const [dx, dy] of DIRS) {
      const len = lineLength(board, x, y, dx, dy, color, size);
      if (len === 5) {
        const { lo, hi } = segmentRange(board, x, y, dx, dy, color, size);
        const line = [];
        for (let i = lo; i <= hi; i++) line.push({ x: x + dx * i, y: y + dy * i });
        return line;
      }
    }
    return null;
  }

  function hasExactFive(board, x, y, color, size) {
    for (const [dx, dy] of DIRS) {
      if (lineLength(board, x, y, dx, dy, color, size) === 5) return true;
    }
    return false;
  }

  /**
   * 6連以上の方向があれば、その方向の連続石座標を返す（5個に丸めず生で返す）。
   */
  function findOverlineRaw(board, x, y, color, size) {
    for (const [dx, dy] of DIRS) {
      const len = lineLength(board, x, y, dx, dy, color, size);
      if (len >= 6) {
        const { lo, hi } = segmentRange(board, x, y, dx, dy, color, size);
        const line = [];
        for (let i = lo; i <= hi; i++) line.push({ x: x + dx * i, y: y + dy * i });
        return line;
      }
    }
    return null;
  }

  function hasOverline(board, x, y, color, size) {
    for (const [dx, dy] of DIRS) {
      if (lineLength(board, x, y, dx, dy, color, size) >= 6) return true;
    }
    return false;
  }

  // ---- 「四」と「達四」の方向別判定 ----

  /**
   * (x,y)=color として、方向 (dx,dy) のラインで「四」を成立させる空点（=もう1手でちょうど5連を作る空点）を列挙する。
   * 6連になる空点は除外（連珠では四の "5を作る" は厳密にちょうど5）。
   */
  function fiveMakersInDir(board, x, y, dx, dy, color, size) {
    const makers = [];
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const px = x + dx * i;
      const py = y + dy * i;
      if (getCell(board, px, py, size) !== null) continue;
      // (px,py) に color を仮置きして、(px,py) を中心とした方向 (dx,dy) の連続長を見る
      board[py][px] = color;
      const len = lineLength(board, px, py, dx, dy, color, size);
      board[py][px] = null;
      if (len === 5) makers.push({ x: px, y: py });
    }
    return makers;
  }

  function isFourInDir(board, x, y, dx, dy, color, size) {
    return fiveMakersInDir(board, x, y, dx, dy, color, size).length >= 1;
  }

  function isOpenFourInDir(board, x, y, dx, dy, color, size) {
    return fiveMakersInDir(board, x, y, dx, dy, color, size).length >= 2;
  }

  // ---- 「活三」の方向別判定 ----

  /**
   * (x,y)=color として、方向 (dx,dy) のラインで活三が成立するか。
   * 定義: 一手で「達四 (open four)」になれる三。
   * 各空点に color を仮置きしてみて、その方向で達四ができれば活三。
   *
   * RIF 標準実装: 仮想着手後の達四判定では「その仮想手が黒の禁手か」までは再帰的に見ない。
   */
  function isOpenThreeInDir(board, x, y, dx, dy, color, size) {
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const px = x + dx * i;
      const py = y + dy * i;
      if (getCell(board, px, py, size) !== null) continue;
      board[py][px] = color;
      const opens = isOpenFourInDir(board, px, py, dx, dy, color, size);
      board[py][px] = null;
      if (opens) return true;
    }
    return false;
  }

  // ---- 集計 ----

  function detectFours(board, x, y, color, size) {
    if (size == null) size = board.length;
    let n = 0;
    for (const [dx, dy] of DIRS) {
      if (isFourInDir(board, x, y, dx, dy, color, size)) n++;
    }
    return n;
  }

  function detectOpenThrees(board, x, y, color, size) {
    if (size == null) size = board.length;
    let n = 0;
    for (const [dx, dy] of DIRS) {
      if (isOpenThreeInDir(board, x, y, dx, dy, color, size)) n++;
    }
    return n;
  }

  // ---- 禁手判定 ----

  /**
   * isForbidden(board, x, y, color, ruleSet, size?)
   *
   * board[y][x] は呼び出し時 null（空）であること。関数内で color を一時配置して判定後に戻す。
   * ruleSet = { overline:bool, fortyFour:bool, thirtyThree:bool }（その手番に適用するフラグ）
   *
   * 「五を作る手は禁手にならない」を最優先。
   */
  function isForbidden(board, x, y, color, ruleSet, size) {
    if (size == null) size = board.length;
    if (board[y][x] !== null && board[y][x] !== undefined) return false;
    board[y][x] = color;
    try {
      if (hasExactFive(board, x, y, color, size)) return false;
      if (ruleSet.overline && hasOverline(board, x, y, color, size)) return true;
      if (ruleSet.fortyFour) {
        let fours = 0;
        for (const [dx, dy] of DIRS) {
          if (isFourInDir(board, x, y, dx, dy, color, size)) fours++;
        }
        if (fours >= 2) return true;
      }
      if (ruleSet.thirtyThree) {
        let threes = 0;
        for (const [dx, dy] of DIRS) {
          if (isOpenThreeInDir(board, x, y, dx, dy, color, size)) threes++;
        }
        if (threes >= 2) return true;
      }
      return false;
    } finally {
      board[y][x] = null;
    }
  }

  // ---- プリセット別 勝ち判定 ----

  /**
   * 着手 (x,y)=color の確定後に呼ぶ。
   * preset: 'normal' | 'casual' | 'free'
   *
   * 戻り値:
   *   { result:'win', line:[5座標], reason:'five'|'overline' }
   *   null （勝ち未確定）
   *
   * 正規(normal)の黒は ちょうど5連 のみ勝ち。長連は勝ちにせず null を返す（外側で禁手敗北として扱う）。
   * カジュアル/自由は5連以上ならいずれも勝ち。長連の場合は中央寄せ5個をハイライトとして返す。
   */
  function checkWinByPreset(board, x, y, color, preset, size) {
    if (size == null) size = board.length;
    const five = findExactFive(board, x, y, color, size);
    if (five) return { result: 'win', line: five, reason: 'five' };

    if (preset === 'normal' && color === 'black') {
      return null;
    }
    // カジュアル/自由 または 正規の白
    const overline = findOverlineRaw(board, x, y, color, size);
    if (overline) {
      // 着手位置を中心に5個を選ぶ（既存 checkWin と同じ方針）
      const line = pickCentered5(overline, x, y);
      return { result: 'win', line, reason: 'overline' };
    }
    return null;
  }

  function pickCentered5(segment, cx, cy) {
    const idx = segment.findIndex(p => p.x === cx && p.y === cy);
    const total = segment.length;
    // idx を中心に5個切り出す。両端を超えない範囲で。
    let start = idx - 2;
    if (start < 0) start = 0;
    if (start + 5 > total) start = total - 5;
    return segment.slice(start, start + 5);
  }

  // ---- 既存 checkWin（自由ルール、後方互換） ----

  /**
   * 直前に置かれた石を起点に、4方向で5連以上ができたか判定する。
   * 自由ルール: 黒白ともに5連以上で勝ち（長連も勝ち）。
   * 6連以上の場合は着手位置を中心になるべく対称に5個を選ぶ。
   */
  function checkWin(board, x, y, color, size) {
    for (const [dx, dy] of DIRS) {
      let posCount = 0;
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        posCount++; nx += dx; ny += dy;
      }
      let negCount = 0;
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        negCount++; nx -= dx; ny -= dy;
      }
      const total = posCount + negCount + 1;
      if (total < 5) continue;

      const bMin = Math.max(0, 4 - posCount);
      const bMax = Math.min(negCount, 4);
      let b = 2;
      if (b < bMin) b = bMin;
      if (b > bMax) b = bMax;
      const f = 4 - b;

      const line = [];
      for (let i = b; i >= 1; i--) line.push({ x: x - dx * i, y: y - dy * i });
      line.push({ x, y });
      for (let i = 1; i <= f; i++) line.push({ x: x + dx * i, y: y + dy * i });
      return line;
    }
    return null;
  }

  return {
    PRESET_RULESETS,
    checkWin,
    checkWinByPreset,
    isForbidden,
    detectFours,
    detectOpenThrees,
    // 内部関数もテスト用に公開
    _internal: {
      lineLength,
      hasExactFive,
      hasOverline,
      findExactFive,
      findOverlineRaw,
      fiveMakersInDir,
      isFourInDir,
      isOpenFourInDir,
      isOpenThreeInDir
    }
  };
})();
