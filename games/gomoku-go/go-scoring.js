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

  // 領域（地）を計算する。死石を除去した盤面で、空点の連結成分ごとに
  // 隣接する石の色を集めて、単色なら territory、複数色なら neutral とする。
  // 戻り値:
  //   territoryMap[y][x] = 'black'|'white'|'neutral'|null  (null は石の位置)
  //   blackTerritory, whiteTerritory: 各色の地の合計目数
  //   neutralPoints: ダメ（中立点）の総数
  function computeTerritory(board, deadStones, size) {
    size = size || (board && board.length) || DEFAULT_SIZE;
    deadStones = deadStones || [];
    const effectiveBoard = applyDeadStones(board, deadStones, size);
    const territoryMap = new Array(size);
    for (let y = 0; y < size; y++) territoryMap[y] = new Array(size).fill(null);

    let blackTerritory = 0, whiteTerritory = 0, neutralPoints = 0;
    const visited = new Array(size * size).fill(false);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (visited[y * size + x]) continue;
        if (effectiveBoard[y][x] !== null) continue;

        // 空点の連結領域を BFS で抽出し、隣接する石の色を集める
        const region = [];
        const bordering = new Set();
        const queue = [{ x, y }];
        visited[y * size + x] = true;
        while (queue.length) {
          const p = queue.shift();
          region.push(p);
          for (const n of neighbors(p.x, p.y, size)) {
            const k = n.y * size + n.x;
            const c = effectiveBoard[n.y][n.x];
            if (c === null) {
              if (!visited[k]) {
                visited[k] = true;
                queue.push(n);
              }
            } else {
              bordering.add(c);
            }
          }
        }

        // 帰属判定
        let owner;
        if (bordering.size === 1) {
          owner = bordering.has('black') ? 'black' : 'white';
        } else {
          owner = 'neutral';
        }

        for (const p of region) {
          territoryMap[p.y][p.x] = owner;
        }
        if (owner === 'black') blackTerritory += region.length;
        else if (owner === 'white') whiteTerritory += region.length;
        else neutralPoints += region.length;
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
