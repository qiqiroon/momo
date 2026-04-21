// Game state management: stage setup, entity placement, logic updates

class GameState {
    constructor() {
        this.stage  = 1;
        this.score  = 0;
        this.lives  = 3;
        this.balls  = [];
        this.goals  = [];
        this.keys   = [];
        this.items  = [];
        this.enemies = [];
        this.pits    = [];
        this.clearTimer = 0;
        this.rng = null;
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

        this.rng = this._makeRng(this.stage * 137 + 31);

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

        // Place goals (bottom zone): each goal near the point-symmetric position of its ball
        const exclude = [...ballCells];
        const allGoalCands = MazeGenerator.pickCells(maze, maze.rows * maze.cols, this.rng, exclude, 'bottom');
        for (let i = 0; i < ballCount; i++) {
            const ball = ballCells[i] || {c: 1 + i, r: 1};
            const symC = maze.cols - 1 - ball.c;
            const symR = maze.rows - 1 - ball.r;
            let best = null, bestD = Infinity;
            for (const cand of allGoalCands) {
                if (exclude.some(e => e.c === cand.c && e.r === cand.r)) continue;
                const d = (cand.c - symC) ** 2 + (cand.r - symR) ** 2;
                if (d < bestD) { bestD = d; best = cand; }
            }
            const cell = best || {c: maze.cols - 2 - i, r: maze.rows - 2};
            exclude.push(cell);
            const goal = new Goal(i, i, cell.c, cell.r, maze);
            goal.locked = i < lockedGoals;
            this.goals.push(goal);
        }

        // Place keys for locked goals
        const keyCells = MazeGenerator.pickCells(maze, keyCount, this.rng, exclude);
        for (let i = 0; i < keyCount; i++) {
            const cell = keyCells[i] || {c: Math.floor(maze.cols/2), r: Math.floor(maze.rows/2)};
            exclude.push(cell);
            this.keys.push(new Key(i, i, cell.c, cell.r, maze));
        }

        // Place items
        const itemTypes = Object.keys(ITEM_TYPES);
        const itemCells = MazeGenerator.pickCells(maze, itemCount, this.rng, exclude);
        for (let i = 0; i < itemCells.length; i++) {
            const cell = itemCells[i];
            exclude.push(cell);
            const type = itemTypes[Math.floor(this.rng() * itemTypes.length)];
            this.items.push(new Item(i, type, cell.c, cell.r, maze));
        }

        // Place pits
        const pitCount = s >= 2 ? Math.min(Math.floor((s - 1) / 2), 5) : 0;
        const pitCells = MazeGenerator.pickCells(maze, pitCount, this.rng, exclude);
        for (let i = 0; i < pitCells.length; i++) {
            exclude.push(pitCells[i]);
            this.pits.push(new Pit(i, pitCells[i].c, pitCells[i].r, maze));
        }

        // Place enemies
        const enemyCells = MazeGenerator.pickCells(maze, enemyCount, this.rng, exclude);
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
        for (const enemy of this.enemies) {
            if (enemy.disabled > 0) { enemy.disabled -= dt; continue; }

            enemy.animTime += dt;
            enemy.dirTimer -= dt;

            if (enemy.type === 'TRACKER' && enemy.dirTimer <= 0) {
                // Head toward nearest ball
                let nearestBall = null, nearestDist = Infinity;
                for (const ball of this.balls) {
                    const dx = ball.x - enemy.x;
                    const dy = ball.y - enemy.y;
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
                enemy.dirTimer = 500;
            }

            // Bounce off walls
            const nx = enemy.x + enemy.vx * dt * 0.06;
            const ny = enemy.y + enemy.vy * dt * 0.06;
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

            // Occasional random redirect for patrol
            if (enemy.type === 'PATROL' && enemy.dirTimer <= 0) {
                const angle = this.rng() * Math.PI * 2;
                enemy.vx = Math.cos(angle) * enemy.speed;
                enemy.vy = Math.sin(angle) * enemy.speed;
                enemy.dirTimer = 600 + this.rng() * 800;
            }
        }
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
            if (lx >= cw && ly >= cw) return true; // corner
            if (lx >= cw && c < cols - 1 && !passages[r][c].right) return true;
            if (ly >= cw && r < rows - 1 && !passages[r][c].down) return true;
            if (lx >= cw && c >= cols - 1) return true;
            if (ly >= cw && r >= rows - 1) return true;
        }
        return false;
    }

    // Check pickups and collisions
    update(maze, dt) {
        const collected = [];

        for (const ball of this.balls) {
            if (ball.invincible > 0) ball.invincible -= dt;
            if (ball.frozen > 0) ball.frozen -= dt;

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
                        this._applyItem(item.type);
                        collected.push({type: 'item', id: item.id});
                    }
                }
            }

            // Pit collision (no life loss, just respawn)
            if (ball.invincible <= 0) {
                for (const pit of this.pits) {
                    const dx = ball.x - pit.x, dy = ball.y - pit.y;
                    if (dx*dx + dy*dy < (ball.radius + pit.radius)**2) {
                        ball.needsRespawn = true;
                        ball.invincible = 60 * 16;
                        collected.push({type: 'pit', ballId: ball.id});
                    }
                }
            }

            // Enemy collision
            if (ball.invincible <= 0) {
                for (const enemy of this.enemies) {
                    if (enemy.disabled > 0) continue;
                    const dx = ball.x - enemy.x, dy = ball.y - enemy.y;
                    if (dx * dx + dy * dy < (ball.radius + enemy.radius) ** 2) {
                        this._hitByEnemy(ball, enemy);
                        collected.push({type: 'enemy', ballId: ball.id});
                    }
                }
            }
        }

        this.updateEnemies(maze, dt);

        return collected;
    }

    _applyItem(type) {
        switch (type) {
            case 'LIFE':   this.lives = Math.min(this.lives + 1, 9); break;
            case 'SCORE':  this.score += 200; break;
            case 'FREEZE':
                for (const b of this.balls) b.frozen = Math.max(b.frozen, 3000);
                break;
            case 'SHIELD':
                for (const b of this.balls) b.invincible = Math.max(b.invincible, 5000);
                break;
        }
    }

    _hitByEnemy(ball, enemy) {
        this.lives--;
        ball.invincible = 120 * 16; // ~2 sec at 60fps
        // Will trigger respawn in main loop
        ball.needsRespawn = true;

        if (enemy.type === 'SLOW') {
            // Don't kill ball, just slow it
            ball.needsRespawn = false;
            this.lives++;
        }
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
        const selected = [cands[0]];
        while (selected.length < n) {
            let best = null, bestD = -1;
            for (const c of cands) {
                if (selected.some(s => s.c === c.c && s.r === c.r)) continue;
                const minD = Math.min(...selected.map(s => (c.c - s.c) ** 2 + (c.r - s.r) ** 2));
                if (minD > bestD) { bestD = minD; best = c; }
            }
            if (best) selected.push(best);
            else break;
        }
        return selected;
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
