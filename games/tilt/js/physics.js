// Physics engine using Matter.js

class PhysicsEngine {
    constructor() {
        const {Engine, World, Bodies, Body, Events, Composite} = Matter;
        this.engine  = Engine.create({gravity: {x: 0, y: 0}});
        this.world   = this.engine.world;
        this.Bodies  = Bodies;
        this.Body    = Body;
        this.World   = World;
        this.Composite = Composite;
        this.wallBodies = [];
        this.ballBodies = [];
        this.BALL_RADIUS    = 7;
        this.FRICTION       = 0;
        this.RESTITUTION    = 0.55;
        this.WALL_REPULSION = 0.005;
    }

    // Build static wall bodies from maze data
    setupMaze(maze) {
        const {cols, rows, cellSize: cs, corridorWidth: cw, wallThickness: wt, offsetX, offsetY, passages} = maze;

        Matter.World.clear(this.world);
        Matter.Engine.clear(this.engine);
        this.wallBodies = [];
        this.ballBodies = [];

        const opts      = {isStatic: true, restitution: 0.5, friction: 0, frictionStatic: 0, label: 'wall'};
        // Interior wall segments use chamfered (stadium/capsule) shape to eliminate sharp-corner catching
        const innerOpts = {...opts, chamfer: {radius: wt / 2}};
        const bodies = [];

        // Outer walls (plain rectangles — corners are at maze edge, unreachable)
        const totalW = cols * cs + wt;
        const totalH = rows * cs + wt;
        const cx = offsetX + totalW / 2;
        const cy = offsetY + totalH / 2;
        bodies.push(this.Bodies.rectangle(cx, offsetY + wt / 2,                 totalW, wt,     opts)); // top
        bodies.push(this.Bodies.rectangle(cx, offsetY + totalH - wt / 2,        totalW, wt,     opts)); // bottom
        bodies.push(this.Bodies.rectangle(offsetX + wt / 2,           cy, wt,   totalH,         opts)); // left
        bodies.push(this.Bodies.rectangle(offsetX + totalW - wt / 2,  cy, wt,   totalH,         opts)); // right

        // Interior walls — chamfered capsules; no corner pillars
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs; // corridor left
                const y0 = offsetY + wt + r * cs; // corridor top

                // Right wall between (c,r) and (c+1,r)
                if (c < cols - 1 && !passages[r][c].right) {
                    const wx = x0 + cw + wt / 2;
                    const wy = y0 + cw / 2;
                    bodies.push(this.Bodies.rectangle(wx, wy, wt, cw, innerOpts));
                }
                // Bottom wall between (c,r) and (c,r+1)
                if (r < rows - 1 && !passages[r][c].down) {
                    const wx = x0 + cw / 2;
                    const wy = y0 + cw + wt / 2;
                    bodies.push(this.Bodies.rectangle(wx, wy, cw, wt, innerOpts));
                }
                // No gap-fill bodies — enclosed cross bodies are unreachable;
                // T/straight-through bodies cause corner catching in corridors
            }
        }

        this.wallBodies = bodies;
        Matter.World.add(this.world, bodies);
    }

    // Create a ball body at cell (c, r) and add to world
    addBall(c, r, maze) {
        const pos = MazeGenerator.cellCenter(c, r, maze);
        const body = this.Bodies.circle(pos.x, pos.y, this.BALL_RADIUS, {
            restitution:    this.RESTITUTION,
            friction:       0,
            frictionStatic: 0,
            frictionAir:    0.015,
            label: 'ball',
            density: 0.002
        });
        Matter.World.add(this.world, body);
        this.ballBodies.push(body);
        return body;
    }

    removeBall(body) {
        Matter.World.remove(this.world, body);
        this.ballBodies = this.ballBodies.filter(b => b !== body);
    }

    // Apply global gravity based on tilt
    applyTilt(tiltX, tiltY, frozenIds = []) {
        const scale = 0.00055;
        for (const body of this.ballBodies) {
            const ballId = this.ballBodies.indexOf(body);
            if (frozenIds.includes(ballId)) continue;
            Matter.Body.applyForce(body, body.position, {
                x: tiltX * scale * body.mass,
                y: tiltY * scale * body.mass
            });
        }
    }

    // Apply goal attraction/damping each frame — any ball can fall into any unlocked goal
    applyGoalForces(balls, goals) {
        const K_SPRING  = 0.0018;
        const K_DAMPING = 0.06;

        for (const ball of balls) {
            // Find nearest unlocked goal within attract radius
            let nearest = null, nearestDist = Infinity;
            for (const goal of goals) {
                if (goal.locked) continue;
                const dx = goal.x - ball.x;
                const dy = goal.y - ball.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < goal.radius * 1.5 && dist < nearestDist) {
                    nearestDist = dist;
                    nearest = goal;
                }
            }

            if (nearest) {
                const dx = nearest.x - ball.x;
                const dy = nearest.y - ball.y;
                Matter.Body.applyForce(ball.body, ball.body.position, {
                    x: dx * K_SPRING * ball.body.mass,
                    y: dy * K_SPRING * ball.body.mass
                });
                const vel = ball.body.velocity;
                Matter.Body.setVelocity(ball.body, {
                    x: vel.x * (1 - K_DAMPING),
                    y: vel.y * (1 - K_DAMPING)
                });
                ball.inGoal = nearestDist < nearest.radius * 0.9;
                ball.currentGoalId = nearest.id;
            } else {
                ball.inGoal = false;
                ball.currentGoalId = -1;
            }
        }
    }

    // Check and apply warp teleportation
    applyWarps(balls, maze) {
        if (!maze.warps || maze.warps.length === 0) return;

        const wt = maze.wallThickness;
        const leftX  = maze.offsetX + wt;
        const rightX = maze.offsetX + maze.mazeW - wt;

        for (const ball of balls) {
            for (let i = 0; i < maze.warps.length; i += 2) {
                const warpL = maze.warps[i];
                const warpR = maze.warps[i + 1];
                if (!warpL || !warpR) continue;

                const warpY = MazeGenerator.cellCenter(0, warpL.row, maze).y;
                const band  = maze.corridorWidth / 2;

                if (Math.abs(ball.y - warpY) < band) {
                    if (ball.x < leftX + 2) {
                        Matter.Body.setPosition(ball.body, {x: rightX - 4, y: ball.y});
                    } else if (ball.x > rightX - 2) {
                        Matter.Body.setPosition(ball.body, {x: leftX + 4, y: ball.y});
                    }
                }
            }
        }
    }

    // 3 substeps per frame to reduce tunneling; cap velocity
    step(delta, maxSpeed = 10) {
        const SUB = 3;
        const subDt = delta / SUB;
        for (let i = 0; i < SUB; i++) {
            Matter.Engine.update(this.engine, subDt);
        }
        // Velocity cap
        for (const body of this.ballBodies) {
            const v = body.velocity;
            const speed = Math.sqrt(v.x * v.x + v.y * v.y);
            if (speed > maxSpeed) {
                Matter.Body.setVelocity(body, {
                    x: v.x / speed * maxSpeed,
                    y: v.y / speed * maxSpeed
                });
            }
        }
    }

    // If a ball escapes the maze, return it to the nearest boundary point
    checkBounds(balls, maze) {
        const {offsetX, offsetY, mazeW, mazeH, wallThickness: wt} = maze;
        const r = this.BALL_RADIUS;
        const minX = offsetX + wt + r;
        const maxX = offsetX + mazeW - wt - r;
        const minY = offsetY + wt + r;
        const maxY = offsetY + mazeH - wt - r;

        for (const ball of balls) {
            const x = ball.x, y = ball.y;
            if (x < minX || x > maxX || y < minY || y > maxY) {
                Matter.Body.setPosition(ball.body, {
                    x: Math.max(minX, Math.min(maxX, x)),
                    y: Math.max(minY, Math.min(maxY, y))
                });
                const v = ball.body.velocity;
                Matter.Body.setVelocity(ball.body, {
                    x: (x < minX && v.x < 0) ? -v.x : (x > maxX && v.x > 0) ? -v.x : v.x,
                    y: (y < minY && v.y < 0) ? -v.y : (y > maxY && v.y > 0) ? -v.y : v.y
                });
            }
        }
    }

    // Push any ball that is inside a wall back to free space.
    // isWall: broad check with ball-radius expansion (for safe-position lookup)
    // isWallStrict: single-point check (no radius) — teleport only when ball center itself is inside a wall
    unstuckBalls(balls, maze, isWall, isWallStrict) {
        if (!isWallStrict) isWallStrict = isWall;
        const r = this.BALL_RADIUS;
        for (const ball of balls) {
            // Teleport only when ball center is truly inside a wall
            if (isWallStrict(ball.x, ball.y)) {
                let freed = false;
                for (let d = 2; d <= 28 && !freed; d += 2) {
                    for (const [dx, dy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
                        if (!isWall(ball.x + dx, ball.y + dy)) {
                            Matter.Body.setPosition(ball.body, {x: ball.x + dx, y: ball.y + dy});
                            Matter.Body.setVelocity(ball.body, {x: 0, y: 0});
                            freed = true;
                            break;
                        }
                    }
                }
                continue;
            }
            // Apply perpendicular force when ball edge closely approaches a wall
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                if (isWall(ball.x + dx * (r + 1), ball.y + dy * (r + 1))) {
                    Matter.Body.applyForce(ball.body, ball.body.position, {
                        x: -dx * this.WALL_REPULSION * ball.body.mass,
                        y: -dy * this.WALL_REPULSION * ball.body.mass
                    });
                }
            }
        }
    }

    // Apply repulsion force between balls that are close or overlapping
    applyBallRepulsion(balls) {
        const repulseRange = this.BALL_RADIUS * 2;
        const K = 0.012;
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const a = balls[i], b = balls[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist2 = dx * dx + dy * dy;
                if (dist2 >= repulseRange * repulseRange || dist2 === 0) continue;
                const dist = Math.sqrt(dist2);
                const overlap = repulseRange - dist;
                const nx = dx / dist, ny = dy / dist;
                const f = K * overlap;
                Matter.Body.applyForce(a.body, a.body.position, {x: -nx * f * a.body.mass, y: -ny * f * a.body.mass});
                Matter.Body.applyForce(b.body, b.body.position, {x:  nx * f * b.body.mass, y:  ny * f * b.body.mass});
            }
        }
    }

    respawnBall(ball, c, r, maze) {
        const pos = MazeGenerator.cellCenter(c, r, maze);
        Matter.Body.setPosition(ball.body, pos);
        Matter.Body.setVelocity(ball.body, {x: 0, y: 0});
        ball.inGoal = false;
        ball.currentGoalId = -1;
    }
}
