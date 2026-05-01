// MOMO Go — 囲碁の地計算・終局スコア（日本ルール）モジュール
// SPEC.md 8章「囲碁仕様」終局フェーズ。UI/DOMには一切依存しない純粋ロジック。
//
// 公開API:
//   GoScoring.computeTerritory(board, deadStones, size?)
//     → { territoryMap, blackTerritory, whiteTerritory, neutralPoints }
//   GoScoring.computeScore(board, deadStones, captures, komi, size?)
//     → { black, white, winner, margin, territoryMap, neutralPoints }
//   GoScoring.DEFAULT_KOMI = 6.5
//
// 盤面表現:
//   board[y][x] = null | 'black' | 'white'
//   deadStones = [{ x, y }, ...]
//   captures   = { black: N, white: N }（対局中に取った石数）

(function (root) {
  const DEFAULT_SIZE = 19;
  const DEFAULT_KOMI = 6.5;

  function inBounds(x, y, size) {
    return x >= 0 && x < size && y >= 0 && y < size;
  }

  function neighbors(x, y, size) {
    const out = [];
    if (x > 0)        out.push({ x: x - 1, y });
    if (x < size - 1) out.push({ x: x + 1, y });
    if (y > 0)        out.push({ x, y: y - 1 });
    if (y < size - 1) out.push({ x, y: y + 1 });
    return out;
  }

  // 死石を除去した盤面を返す（深いコピー）
  function applyDeadStones(board, deadStones, size) {
    const out = new Array(board.length);
    for (let y = 0; y < board.length; y++) out[y] = board[y].slice();
    for (const ds of deadStones) {
      if (inBounds(ds.x, ds.y, size)) {
        out[ds.y][ds.x] = null;
      }
    }
    return out;
  }

  // 領域（地）を計算する（Voronoi 方式: 多源BFS）。
  // 死石を除去した盤面で、各空点について「最も近い石の色」を帰属とする。
  // 同距離で異色が到達したら contested = neutral。
  // 強制的な囲い込みより寛容で、囲碁の影響圏（influence）に近い直感的判定を返す。
  // 戻り値:
  //   territoryMap[y][x] = 'black'|'white'|'neutral'|null  (null は石の位置)
  //   blackTerritory, whiteTerritory: 各色の地の合計目数
  //   neutralPoints: ダメ（中立点）の総数
  function computeTerritory(board, deadStones, size) {
    size = size || (board && board.length) || DEFAULT_SIZE;
    deadStones = deadStones || [];
    const effectiveBoard = applyDeadStones(board, deadStones, size);

    // 多源BFS用の距離・帰属マップ
    const dist = new Array(size);
    const owner = new Array(size);
    for (let y = 0; y < size; y++) {
      dist[y] = new Array(size).fill(Infinity);
      owner[y] = new Array(size).fill(null);
    }

    // 全ての（生存）石を距離0で seed
    const queue = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (effectiveBoard[y][x]) {
          dist[y][x] = 0;
          owner[y][x] = effectiveBoard[y][x];
          queue.push({ x, y });
        }
      }
    }

    // FIFO でBFS。空点に到達したら所有者を伝搬。
    // 同距離で異色到達なら contested。contested セルは伝搬しない。
    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      const d = dist[p.y][p.x];
      const c = owner[p.y][p.x];
      if (c === 'contested') continue;
      for (const n of neighbors(p.x, p.y, size)) {
        if (effectiveBoard[n.y][n.x] !== null) continue; // 石は通過しない
        const nd = d + 1;
        if (nd < dist[n.y][n.x]) {
          dist[n.y][n.x] = nd;
          owner[n.y][n.x] = c;
          queue.push(n);
        } else if (nd === dist[n.y][n.x] && owner[n.y][n.x] !== c && owner[n.y][n.x] !== 'contested') {
          owner[n.y][n.x] = 'contested';
        }
      }
    }

    // territoryMap 構築 + 集計
    const territoryMap = new Array(size);
    for (let y = 0; y < size; y++) territoryMap[y] = new Array(size).fill(null);
    let blackTerritory = 0, whiteTerritory = 0, neutralPoints = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (effectiveBoard[y][x] !== null) {
          territoryMap[y][x] = null;
          continue;
        }
        const o = owner[y][x];
        if (o === 'black') {
          territoryMap[y][x] = 'black';
          blackTerritory++;
        } else if (o === 'white') {
          territoryMap[y][x] = 'white';
          whiteTerritory++;
        } else {
          // contested、または到達不可（石が一切ない場合）
          territoryMap[y][x] = 'neutral';
          neutralPoints++;
        }
      }
    }

    return { territoryMap, blackTerritory, whiteTerritory, neutralPoints };
  }

  // 最終スコアを計算する（日本ルール）。
  // 黒の合計 = 黒地 + 対局中に黒が取った白石数 + 死んだ白石（取り上げ扱い）
  // 白の合計 = 白地 + 対局中に白が取った黒石数 + 死んだ黒石 + コミ
  // コミ既定 6.5（半目あり、引分なし想定）
  function computeScore(board, deadStones, captures, komi, size) {
    size = size || (board && board.length) || DEFAULT_SIZE;
    captures = captures || { black: 0, white: 0 };
    if (komi == null) komi = DEFAULT_KOMI;
    deadStones = deadStones || [];

    let deadBlack = 0, deadWhite = 0;
    for (const ds of deadStones) {
      if (!inBounds(ds.x, ds.y, size)) continue;
      const c = board[ds.y][ds.x];
      if (c === 'black') deadBlack++;
      else if (c === 'white') deadWhite++;
    }

    const tr = computeTerritory(board, deadStones, size);

    const black = {
      territory: tr.blackTerritory,
      captures: captures.black || 0,
      deadOpp: deadWhite,
      komi: 0,
      total: tr.blackTerritory + (captures.black || 0) + deadWhite
    };
    const white = {
      territory: tr.whiteTerritory,
      captures: captures.white || 0,
      deadOpp: deadBlack,
      komi: komi,
      total: tr.whiteTerritory + (captures.white || 0) + deadBlack + komi
    };

    let winner, margin;
    if (black.total > white.total) {
      winner = 'black';
      margin = black.total - white.total;
    } else if (white.total > black.total) {
      winner = 'white';
      margin = white.total - black.total;
    } else {
      winner = 'draw';
      margin = 0;
    }

    return {
      black, white, winner, margin,
      territoryMap: tr.territoryMap,
      neutralPoints: tr.neutralPoints
    };
  }

  const api = {
    computeTerritory,
    computeScore,
    DEFAULT_KOMI
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GoScoring = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
