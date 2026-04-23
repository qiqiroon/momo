// Game state management: stage setup, entity placement, logic updates

class GameState {
    constructor() {
        this.stage    = 1;
        this.score    = 0;
        this.lives    = 3;
        this.balls    = [];
        this.goals    = [];
        this.keys     = [];
        this.items    = [];
        this.enemies  = [];
        this.pits     = [];
        this.clearTimer = 0;
        this.rng      = null;
        this.gameSeed = Math.floor(Math.random() * 1000000);
    }

    // Build a stage given a maze
    setupStage(maze, physics) {
        this.balls   = [];
        this.goals   = [];
        this.keys    = [];
        this.items   = [];
        this.enemies = [];
        this.pits    = [];

        const s = this.stage;
        // Stage 1 = 1 ball, each clear adds 1 ball (max 5)
        const ballCount    = Math.min(s, 5);
        const lockedGoals  = ballCount >= 2 && s >= 2 ? Math.min(Math.floor(s / 3), ballCount - 1) : 0;
        const keyCount     = lockedGoals;
        const itemCount    = Math.min(1 + Math.floor(s / 2), 4);
        const enemyCount   = s >= 3 ? Math.min(Math.floor((s - 2) / 2), 4) : 0;

        this.rng = this._makeRng(this.stage * 137 + 31 + this.gameSeed);

        // Place balls (full maze): spread them as far apart as possible
        const allBallCands = MazeGenerator.pickCells(maze, maze.rows * maze.cols, this.rng, [], null);
        const ballCells = this._pickFarthest(allBallCands, ballCount);
        for (let i = 0; i < ballCount; i++) {
            const cell = ballCells[i] || {c: 1 + i, r: 1};
            const body = physics.addBall(cell.c, cell.r, maze);
            const ball = new Ball(i, body, cell.c, cell.r);
            ball.startC = cell.c;
            ball.startR = cell.r;
            this.balls.push(ball);
        }

        // Place goals: random position near the point-symmetric of ball, not adjacent to other goals
        const exclude = [...ballCells];
        const allGoalCands = MazeGenerator.pickCells(maze, maze.rows * maze.cols, this.rng, exclude, null);
        const ctrC = (maze.cols - 1) / 2;
        const ctrR = (maze.rows - 1) / 2;
        const searchR = Math.max(3, Math.floor(Math.min(maze.cols, maze.rows) / 4));

        for (let i = 0; i < ballCount; i++) {
            const ball = ballCells[i] || {c: 1 + i, r: 1};
            const symC = Math.max(1, Math.min(maze.cols - 2, Math.round(2 * ctrC - ball.c)));
            const symR = Math.max(1, Math.min(maze.rows - 2, Math.round(2 * ctrR - ball.r)));

            const placedGoals = this.goals.map(g => ({c: g.c, r: g.r}));
            const notExcluded = c => !exclude.some(e => e.c === c.c && e.r === c.r);
            const notAdjacent = c => !placedGoals.some(g =>
                Math.abs(c.c - g.c) + Math.abs(c.r - g.r) < 2);

            // Try decreasing radii until a valid candidate is found
            let cell = null;
            for (let r = searchR; r <= maze.cols + maze.rows && !cell; r += 2) {
                const pool = allGoalCands.filter(c =>
                    notExcluded(c) && notAdjacent(c) &&
                    Math.sqrt((c.c - symC) ** 2 + (c.r - symR) ** 2) <= r);
                if (pool.length > 0) cell = pool[0];
            }
            if (!cell) {
                const pool = allGoalCands.filter(c => notExcluded(c) && notAdjacent(c));
                cell = pool[0] || allGoalCands.find(notExcluded) || {c: maze.cols - 2 - i, r: maze.rows - 2};
            }
            exclude.push(cell);
            this.goals.push(new Goal(i, i, cell.c, cell.r, maze));
        }

        // Randomly choose which goals are locked (not always goal 0 = red)
        const goalOrder = [...Array(ballCount).keys()];
        for (let i = goalOrder.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [goalOrder[i], goalOrder[j]] = [goalOrder[j], goalOrder[i]];
        }
        for (let i = 0; i < ballCount; i++) {
            this.goals[goalOrder[i]].locked = i < lockedGoals;
        }

        // Place keys — one per locked goal
        const lockedGoalIds = this.goals.filter(g => g.locked).map(g => g.id);
        const keyCells = MazeGenerator.pickCells(maze, keyCount, this.rng, exclude);
        for (let i = 0; i < keyCount; i++) {
            const cell = keyCells[i] || {c: Math.floor(maze.cols/2), r: Math.floor(maze.rows/2)};
            exclude.push(cell);
            this.keys.push(new Key(i, lockedGoalIds[i], cell.c, cell.r, maze));
        }

        // Place items (SHIELD only if enemies are present)
        const itemTypes = Object.keys(ITEM_TYPES).filter(k => {
            if (k === 'SHIELD' && enemyCount === 0) return false;
            if (k === 'FREEZE' && ballCount <= 1) return false;
            return true;
        });
        const itemCells = MazeGenerator.pickCells(maze, itemCount, this.rng, exclude);
        for (let i = 0; i < itemCells.length; i++) {
            const cell = itemCells[i];
            exclude.push(cell);
            const type = itemTypes[Math.floor(this.rng() * itemTypes.length)];
            this.items.push(new Item(i, type, cell.c, cell.r, maze));
        }

        // Place pits (stagger cycle timers so they don't all disappear together)
        const pitCount = s >= 2 ? Math.min(Math.floor((s - 1) / 2), 5) : 0;
        const pitCells = MazeGenerator.pickCells(maze, pitCount, this.rng, exclude);
        for (let i = 0; i < pitCells.length; i++) {
            exclude.push(pitCells[i]);
            const pit = new Pit(i, pitCells[i].c, pitCells[i].r, maze);
            pit.cycleTimer = Math.floor(this.rng() * 15000);
            this.pits.push(pit);
        }

        // Place enemies near maze center
        const centerC = Math.floor(maze.cols / 2);
        const centerR = Math.floor(maze.rows / 2);
        const cRad = Math.max(2, Math.floor(Math.min(maze.cols, maze.rows) / 4));
        const allEnemyCands = MazeGenerator.pickCells(maze, maze.rows * maze.cols, this.rng, exclude, null);
        const centerPool = allEnemyCands.filter(c =>
            Math.abs(c.c - centerC) <= cRad && Math.abs(c.r - centerR) <= cRad);
        const enemyCells = (centerPool.length >= enemyCount ? centerPool : allEnemyCands).slice(0, enemyCount);
        const enemyTypeKeys = Object.keys(ENEMY_TYPES);
        for (let i = 0; i < enemyCells.length; i++) {
            const cell = enemyCells[i];
            const type = i === 0 ? 'PATROL' : enemyTypeKeys[Math.floor(this.rng() * enemyTypeKeys.length)];
            const enemy = new Enemy(i, type, cell.c, cell.r, maze);
            // Give random initial velocity
            const angle = this.rng() * Math.PI * 2;
            enemy.vx = Math.cos(angle) * enemy.speed;
            enemy.vy = Math.sin(angle) * enemy.speed;
            this.enemies.push(enemy);
        }
    }

    // Update enemy movement (pixel-space, maze-aware)
    updateEnemies(maze, dt) {
        const cs = maze.cellSize, wt = maze.wallThickness;

        for (const enemy of this.enemies) {
            if (enemy.disabled > 0) { enemy.disabled -= dt; continue; }
            enemy.eating = false;

            enemy.animTime += dt;
            enemy.dirTimer -= dt;

            // Balls that can be targeted (not in goal, not hidden, not being eaten)
            const activeBalls = this.balls.filter(b => !b.inGoal && !b.hidden && b.eatTimer === 0);

            // Current enemy cell
            const ec = Math.max(0, Math.min(maze.cols - 1, Math.floor((enemy.x - maze.offsetX - wt) / cs)));
            const er = Math.max(0, Math.min(maze.rows - 1, Math.floor((enemy.y - maze.offsetY - wt) / cs)));

            // 2x speed when any active ball is within 3 directly-connected cells
            const nearbyCells = this._cellsWithin(ec, er, 3, maze);
            const speedMult = activeBalls.some(ball => {
                const bc = Math.max(0, Math.min(maze.cols - 1, Math.floor((ball.x - maze.offsetX - wt) / cs)));
                const br = Math.max(0, Math.min(maze.rows - 1, Math.floor((ball.y - maze.offsetY - wt) / cs)));
                return nearbyCells.has(`${bc},${br}`);
            }) ? 2 : 1;

            // When within 3 cells: ALL enemy types chase the nearest ball
            if (speedMult === 2 || (enemy.type === 'TRACKER' && enemy.dirTimer <= 0)) {
                let nearestBall = null, nearestDist = Infinity;
                for (const ball of activeBalls) {
                    const dx = ball.x - enemy.x, dy = ball.y - enemy.y;
                    const d = dx * dx + dy * dy;
                    if (d < nearestDist) { nearestDist = d; nearestBall = ball; }
                }
                if (nearestBall) {
                    const dx = nearestBall.x - enemy.x;
                    const dy = nearestBall.y - enemy.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    enemy.vx = (dx / len) * enemy.speed;
                    enemy.vy = (dy / len) * enemy.speed;
                }
                if (enemy.type === 'TRACKER') enemy.dirTimer = 500;
            }

            // Bounce off walls, apply speed multiplier
            const nx = enemy.x + enemy.vx * speedMult * dt * 0.06;
            const ny = enemy.y + enemy.vy * speedMult * dt * 0.06;
            const hitX = this._isWall(nx, enemy.y, maze, enemy.radius);
            const hitY = this._isWall(enemy.x, ny, maze, enemy.radius);

            if (hitX) {
                enemy.vx = -enemy.vx;
                if (enemy.dirTimer <= 0 || enemy.type === 'PATROL') enemy.dirTimer = 300 + this.rng() * 500;
            } else {
                enemy.x = nx;
            }
            if (hitY) {
                enemy.vy = -enemy.vy;
                if (enemy.dirTimer <= 0 || enemy.type === 'PATROL') enemy.dirTimer = 300 + this.rng() * 500;
            } else {
                enemy.y = ny;
            }

            if (enemy.type === 'PATROL' && enemy.dirTimer <= 0) {
                const angle = this.rng() * Math.PI * 2;
                enemy.vx = Math.cos(angle) * enemy.speed;
                enemy.vy = Math.sin(angle) * enemy.speed;
                enemy.dirTimer = 600 + this.rng() * 800;
            }
        }
    }

    // BFS: returns Set of "c,r" strings reachable within maxDist steps through open passages
    _cellsWithin(c, r, maxDist, maze) {
        const {cols, rows, passages} = maze;
        const visited = new Set();
        const queue = [{c, r, d: 0}];
        visited.add(`${c},${r}`);
        while (queue.length) {
            const {c: cc, r: cr, d} = queue.shift();
            if (d >= maxDist) continue;
            const moves = [];
            if (cr > 0       && passages[cr - 1][cc].down)  moves.push({c: cc,     r: cr - 1});
            if (cr < rows-1  && passages[cr][cc].down)       moves.push({c: cc,     r: cr + 1});
            if (cc > 0       && passages[cr][cc - 1].right)  moves.push({c: cc - 1, r: cr});
            if (cc < cols-1  && passages[cr][cc].right)      moves.push({c: cc + 1, r: cr});
            for (const m of moves) {
                const k = `${m.c},${m.r}`;
                if (!visited.has(k)) { visited.add(k); queue.push({...m, d: d + 1}); }
            }
        }
        return visited;
    }

    // Check if pixel position is in a wall
    _isWall(px, py, maze, radius = 0) {
        const {corridorWidth: cw, wallThickness: wt, cellSize: cs, offsetX, offsetY, cols, rows, passages} = maze;
        // Check multiple points around the radius
        for (const [ox, oy] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]) {
            const x = px + ox, y = py + oy;
            const relX = x - offsetX - wt;
            const relY = y - offsetY - wt;
            const c = Math.floor(relX / cs);
            const r = Math.floor(relY / cs);
            if (c < 0 || c >= cols || r < 0 || r >= rows) return true;
            const lx = relX - c * cs;
            const ly = relY - r * cs;
            if (lx < 0 || ly < 0) return true;
            if (lx >= cw && ly < cw) {
                // right-wall strip
                if (c >= cols - 1 || !passages[r][c].right) return true;
            } else if (ly >= cw && lx < cw) {
                // bottom-wall strip
                if (r >= rows - 1 || !passages[r][c].down) return true;
            } else if (lx >= cw && ly >= cw) {
                // junction square — no physics body here
                if (c >= cols - 1 || r >= rows - 1) return true;
                // interior junction: passable (open space between walls)
            }
        }
        return false;
    }

    // Check pickups and collisions
    update(maze, dt) {
        const collected = [];

        // Pit cycle: 15s total — 12s active, 0.5s shrink, 2s hidden, 0.5s grow
        const PC = 15000, PA = 12000, PS = 500, PH = 14500;
        for (const pit of this.pits) {
            pit.cycleTimer = (pit.cycleTimer + dt) % PC;
            const t = pit.cycleTimer;
            if (t < PA)       { pit.scale = 1;                        pit.active = true; }
            else if (t < PA+PS){ pit.scale = 1 - (t - PA) / PS;       pit.active = false; }
            else if (t < PH)  { pit.scale = 0;                        pit.active = false; }
            else              { pit.scale = (t - PH) / (PC - PH);     pit.active = false; }
        }

        for (const ball of this.balls) {
            if (ball.invincible > 0) ball.invincible -= dt;
            if (ball.frozen > 0) ball.frozen -= dt;

            // Eat animation: ball frozen/hidden until timer expires, then respawn
            if (ball.eatTimer > 0) {
                ball.eatTimer -= dt;
                if (ball.eatTimer <= 0) {
                    ball.eatTimer = 0;
                    ball.hidden = false;
                    ball.needsRespawn = true;
                    ball.invincible = 60 * 16;
                    collected.push({type: 'enemy_respawn', ballId: ball.id});
                } else {
                    ball.hidden = ball.eatTimer <= 1000; // invisible after 0.5s freeze
                }
                continue; // skip all other checks while being eaten
            }
            ball.hidden = false;

            // Key pickup
            for (const key of this.keys) {
                if (!key.collected) {
                    const dx = ball.x - key.x, dy = ball.y - key.y;
                    if (dx * dx + dy * dy < (ball.radius + key.radius) ** 2) {
                        key.collected = true;
                        const goal = this.goals.find(g => g.id === key.goalId);
                        if (goal) goal.locked = false;
                        this.score += 50;
                        collected.push({type: 'key', id: key.id});
                    }
                }
            }

            // Item pickup
            for (const item of this.items) {
                if (!item.collected) {
                    const dx = ball.x - item.x, dy = ball.y - item.y;
                    if (dx * dx + dy * dy < (ball.radius + item.radius) ** 2) {
                        item.collected = true;
                        this._applyItem(item.type, ball);
                        collected.push({type: 'item', id: item.id});
                    }
                }
            }

            // Pit collision — only when pit is active
            if (ball.invincible <= 0) {
                for (const pit of this.pits) {
                    if (!pit.active) continue;
                    const dx = ball.x - pit.x, dy = ball.y - pit.y;
                    if (dx*dx + dy*dy < (ball.radius + pit.radius * pit.scale)**2) {
                        ball.needsRespawn = true;
                        ball.invincible = 60 * 16;
                        collected.push({type: 'pit', ballId: ball.id});
                    }
                }
            }

            // Enemy collision — ignore balls in goals
            if (ball.invincible <= 0 && !ball.inGoal) {
                for (const enemy of this.enemies) {
                    if (enemy.disabled > 0) continue;
                    const dx = ball.x - enemy.x, dy = ball.y - enemy.y;
                    if (dx * dx + dy * dy < (ball.radius + enemy.radius) ** 2) {
                        this._hitByEnemy(ball, enemy);
                        if (enemy.type !== 'SLOW') {
                            collected.push({type: 'enemy', ballId: ball.id});
                        }
                    }
                }
            }
        }

        this.updateEnemies(maze, dt);

        return collected;
    }

    _applyItem(type, pickerBall) {
        switch (type) {
            case 'LIFE':   this.lives = Math.min(this.lives + 1, 9); break;
            case 'SCORE':  this.score += 200; break;
            case 'FREEZE':
                for (const b of this.balls) {
                    if (b !== pickerBall) b.frozen = Math.max(b.frozen, 10000);
                }
                break;
            case 'SHIELD':
                for (const b of this.balls) b.invincible = Math.max(b.invincible, 5000);
                break;
        }
    }

    _hitByEnemy(ball, enemy) {
        if (enemy.type === 'SLOW') {
            ball.invincible = 1000; // brief grace, no life loss
            return;
        }
        // Start eat animation: both freeze 0.5s, then ball hides for 1s, then respawns
        this.lives--;
        ball.eatTimer = 1500;
        ball.frozen = 500;
        ball.invincible = 99999;
        enemy.disabled = 500;
        enemy.eating = true;
    }

    isClear() {
        return this.goals.length > 0 && this.goals.every(g => g.hasBall);
    }

    addScore(n) {
        this.score += n;
        // Life bonus every 2000 points
        const threshold = Math.floor(this.score / 2000);
        if (!this._lastLifeThreshold) this._lastLifeThreshold = 0;
        if (threshold > this._lastLifeThreshold) {
            this.lives++;
            this._lastLifeThreshold = threshold;
        }
    }

    nextStage() {
        this.stage++;
        this.clearTimer = 0;
    }

    _pickFarthest(cands, n) {
        if (n <= 1 || cands.length <= n) return cands.slice(0, n);
        // Try several starting points and keep the arrangement with maximum min-pairwise-distance
        let bestSelected = null, bestScore = -1;
        const tryCount = Math.min(6, cands.length);
        for (let t = 0; t < tryCount; t++) {
            const startIdx = Math.floor(t * cands.length / tryCount);
            const sel = [cands[startIdx]];
            while (sel.length < n) {
                let best = null, bestD = -1;
                for (const c of cands) {
                    if (sel.some(s => s.c === c.c && s.r === c.r)) continue;
                    const minD = Math.min(...sel.map(s => (c.c - s.c) ** 2 + (c.r - s.r) ** 2));
                    if (minD > bestD) { bestD = minD; best = c; }
                }
                if (best) sel.push(best); else break;
            }
            if (sel.length < n) continue;
            let score = Infinity;
            for (let i = 0; i < sel.length; i++)
                for (let j = i + 1; j < sel.length; j++) {
                    const d = (sel[i].c - sel[j].c) ** 2 + (sel[i].r - sel[j].r) ** 2;
                    if (d < score) score = d;
                }
            if (score > bestScore) { bestScore = score; bestSelected = [...sel]; }
        }
        return bestSelected || cands.slice(0, n);
    }

    _makeRng(seed) {
        let s = seed >>> 0;
        return () => {
            s += 0x6D2B79F5;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}
