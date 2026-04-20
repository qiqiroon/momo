// Maze generation module
// Produces a loop maze with no dead ends using DFS + dead-end removal

class MazeGenerator {
    generate(config) {
        const {
            screenWidth, screenHeight, hudHeight = 60,
            corridorWidth = 20, wallThickness = 8,
            wallBlockDensity = 0.5, warpCount = 1, seed = null
        } = config;

        this.cw = corridorWidth;
        this.wt = wallThickness;
        this.cs = corridorWidth + wallThickness;
        this.rng = this._makeRng(seed);

        const availH = screenHeight - hudHeight;
        const cols = Math.max(7, Math.floor((screenWidth - this.wt) / this.cs));
        const rows = Math.max(7, Math.floor((availH - this.wt) / this.cs));

        const mazeW = cols * this.cs + this.wt;
        const mazeH = rows * this.cs + this.wt;
        const offsetX = Math.floor((screenWidth - mazeW) / 2);
        const offsetY = hudHeight + Math.floor((availH - mazeH) / 2);

        // passages[r][c] = {right: bool, down: bool}
        const passages = Array.from({length: rows}, () =>
            Array.from({length: cols}, () => ({right: false, down: false}))
        );

        // Phase 1: spanning tree via DFS
        const visited = Array.from({length: rows}, () => new Array(cols).fill(false));
        this._dfs(passages, visited, 0, 0, cols, rows);

        // Phase 2: remove dead ends
        this._fixDeadEnds(passages, cols, rows);

        // Phase 3: add extra loops (inverse of wall density)
        const maxExtra = (cols - 1) * rows + cols * (rows - 1) - this._countPassages(passages, cols, rows);
        const extraCount = Math.floor((1 - wallBlockDensity) * maxExtra * 0.35);
        this._addExtraPassages(passages, cols, rows, extraCount);

        // Phase 4: warps on left/right edges
        const warps = this._placeWarps(rows, warpCount);

        return {
            cols, rows,
            cellSize: this.cs,
            corridorWidth: this.cw,
            wallThickness: this.wt,
            passages, warps,
            offsetX, offsetY,
            mazeW, mazeH
        };
    }

    _dfs(passages, visited, c, r, cols, rows) {
        visited[r][c] = true;
        const dirs = this._shuffle([[1,0],[-1,0],[0,1],[0,-1]]);
        for (const [dc, dr] of dirs) {
            const nc = c + dc, nr = r + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc]) {
                this._openPassage(passages, c, r, dc, dr, cols, rows);
                this._dfs(passages, visited, nc, nr, cols, rows);
            }
        }
    }

    _openPassage(passages, c, r, dc, dr, cols, rows) {
        if (dc === 1 && c < cols - 1) passages[r][c].right = true;
        else if (dc === -1 && c > 0) passages[r][c - 1].right = true;
        else if (dr === 1 && r < rows - 1) passages[r][c].down = true;
        else if (dr === -1 && r > 0) passages[r - 1][c].down = true;
    }

    _getConnections(passages, c, r, cols, rows) {
        let n = 0;
        if (c < cols - 1 && passages[r][c].right) n++;
        if (c > 0 && passages[r][c - 1].right) n++;
        if (r < rows - 1 && passages[r][c].down) n++;
        if (r > 0 && passages[r - 1][c].down) n++;
        return n;
    }

    _fixDeadEnds(passages, cols, rows) {
        let changed = true;
        let guard = 0;
        while (changed && guard++ < 30) {
            changed = false;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (this._getConnections(passages, c, r, cols, rows) < 2) {
                        const opts = [];
                        if (c < cols - 1 && !passages[r][c].right) opts.push([1, 0]);
                        if (c > 0 && !passages[r][c - 1].right) opts.push([-1, 0]);
                        if (r < rows - 1 && !passages[r][c].down) opts.push([0, 1]);
                        if (r > 0 && !passages[r - 1][c].down) opts.push([0, -1]);
                        if (opts.length > 0) {
                            const [dc, dr] = opts[Math.floor(this.rng() * opts.length)];
                            this._openPassage(passages, c, r, dc, dr, cols, rows);
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    _addExtraPassages(passages, cols, rows, count) {
        for (let i = 0; i < count; i++) {
            const c = Math.floor(this.rng() * cols);
            const r = Math.floor(this.rng() * rows);
            if (this.rng() < 0.5) {
                if (c < cols - 1) passages[r][c].right = true;
            } else {
                if (r < rows - 1) passages[r][c].down = true;
            }
        }
    }

    _countPassages(passages, cols, rows) {
        let n = 0;
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (passages[r][c].right) n++;
                if (passages[r][c].down) n++;
            }
        return n;
    }

    _placeWarps(rows, count) {
        const warps = [];
        const used = new Set();
        for (let i = 0; i < count; i++) {
            let row, tries = 0;
            do { row = 2 + Math.floor(this.rng() * (rows - 4)); } while (used.has(row) && ++tries < 50);
            if (!used.has(row)) {
                used.add(row);
                warps.push({row, side: 'left', pairId: i});
                warps.push({row, side: 'right', pairId: i});
            }
        }
        return warps;
    }

    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    _makeRng(seed) {
        let s = (seed == null ? (Math.random() * 2 ** 32) : seed) >>> 0;
        return () => {
            s += 0x6D2B79F5;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Pixel center of cell (c, r)
    static cellCenter(c, r, maze) {
        return {
            x: maze.offsetX + maze.wallThickness + c * maze.cellSize + maze.corridorWidth / 2,
            y: maze.offsetY + maze.wallThickness + r * maze.cellSize + maze.corridorWidth / 2
        };
    }

    // Pick n random cells with minimum row/col margin from edges
    static pickCells(maze, n, rng, exclude = [], topHalf = null, bottomHalf = null) {
        const candidates = [];
        const m = 1;
        const rMin = topHalf === 'top' ? m : (topHalf === 'bottom' ? Math.floor(maze.rows * 0.6) : m);
        const rMax = topHalf === 'top' ? Math.floor(maze.rows * 0.4) : (topHalf === 'bottom' ? maze.rows - m : maze.rows - m);
        for (let r = rMin; r < rMax; r++) {
            for (let c = m; c < maze.cols - m; c++) {
                if (!exclude.some(e => e.c === c && e.r === r)) {
                    candidates.push({c, r});
                }
            }
        }
        const result = [];
        for (let i = 0; i < n && i < candidates.length; i++) {
            const j = i + Math.floor(rng() * (candidates.length - i));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            result.push(candidates[i]);
        }
        return result;
    }
}
