// Main game loop and state machine

const STATE = {TITLE: 'title', PLAYING: 'playing', CLEAR: 'clear', OVER: 'over'};

class Game {
    constructor() {
        this.canvas   = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.input    = new InputHandler();
        this.physics  = new PhysicsEngine();
        this.gs       = new GameState();
        this.mazeGen  = new MazeGenerator();
        this.maze     = null;
        this.state    = STATE.TITLE;
        this.lastTime = 0;
        this.time     = 0;
        this.clearCountdown = 0;

        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.renderer.resize(w, h);
        this.screenW = w;
        this.screenH = h;
    }

    async startGame() {
        document.getElementById('titleOverlay').style.display = 'none';
        await this.input.start();
        this.gs = new GameState();
        this._loadStage();
        this.state = STATE.PLAYING;
        requestAnimationFrame(t => this._loop(t));
    }

    _loadStage() {
        const difficulty = Math.min(0.3 + this.gs.stage * 0.04, 0.75);
        this.maze = this.mazeGen.generate({
            screenWidth:    this.screenW,
            screenHeight:   this.screenH,
            hudHeight:      this.renderer.HUD_H,
            corridorWidth:  20,
            wallThickness:  8,
            wallBlockDensity: difficulty,
            warpCount:      this.gs.stage >= 3 ? 1 : 0,
            seed:           this.gs.stage * 7919
        });

        this.physics.setupMaze(this.maze);
        this.gs.setupStage(this.maze, this.physics);
        this.clearCountdown = 0;
    }

    _loop(timestamp) {
        const dt = Math.min(timestamp - this.lastTime, 50);
        this.lastTime = timestamp;
        this.time += dt;

        if (this.state === STATE.PLAYING) {
            this._update(dt);
        }
        this._draw();

        requestAnimationFrame(t => this._loop(t));
    }

    _update(dt) {
        const gs   = this.gs;
        const maze = this.maze;

        // Physics step
        const tilt = this.input.getTilt();
        const frozenIds = gs.balls.filter(b => b.frozen > 0).map(b => b.id);
        this.physics.applyTilt(tilt.x, tilt.y, frozenIds);
        this.physics.applyGoalForces(gs.balls, gs.goals);
        this.physics.applyWarps(gs.balls, maze);
        this.physics.step(dt);

        // Update ball sizeScale (shrink when in goal)
        for (const ball of gs.balls) {
            const target = ball.inGoal ? 0.7 : 1.0;
            ball.sizeScale += (target - ball.sizeScale) * 0.12;
        }

        // Update goal hasBall status
        for (const goal of gs.goals) {
            const ball = gs.balls.find(b => b.id === goal.ballId);
            goal.hasBall = !goal.locked && ball && ball.inGoal;
            if (goal.hasBall && ball && !ball._wasInGoal) {
                gs.addScore(100);
            }
            if (ball) ball._wasInGoal = goal.hasBall;
        }

        // Pickups / collisions
        const events = gs.update(maze, dt);
        for (const ev of events) {
            if (ev.type === 'enemy') {
                const ball = gs.balls.find(b => b.id === ev.ballId);
                if (ball && ball.needsRespawn) {
                    ball.needsRespawn = false;
                    ball.inGoal = false;
                    this.physics.respawnBall(ball, ball.startC, ball.startR, maze);
                }
                if (gs.lives <= 0) {
                    this.state = STATE.OVER;
                    return;
                }
            }
        }

        // Check clear
        if (gs.isClear()) {
            this.clearCountdown += dt;
            if (this.clearCountdown > 1200) {
                gs.addScore(500 + gs.stage * 100);
                gs.nextStage();
                this.state = STATE.CLEAR;
                setTimeout(() => {
                    this._loadStage();
                    this.state = STATE.PLAYING;
                }, 2000);
            }
        } else {
            this.clearCountdown = 0;
        }
    }

    _draw() {
        const {renderer: r, gs, maze, state, time} = this;

        r.clear(maze);

        if (state === STATE.TITLE) return; // title is HTML overlay

        if (maze) {
            r.drawMaze(maze);

            for (const goal  of gs.goals)   r.drawGoal(goal);
            for (const key   of gs.keys)    r.drawKey(key);
            for (const item  of gs.items)   r.drawItem(item, time);
            for (const enemy of gs.enemies) r.drawEnemy(enemy, time);
            for (const ball  of gs.balls)   r.drawBall(ball, time);

            r.drawHUD(gs);
        }

        if (state === STATE.CLEAR) {
            r.drawMessage('🎉 クリア！', `ステージ ${gs.stage} へ...`);
        }
        if (state === STATE.OVER) {
            r.drawMessage('💀 ゲームオーバー', 'タップして再スタート');
        }
    }

    restart() {
        this.gs = new GameState();
        this._loadStage();
        this.state = STATE.PLAYING;
    }
}

// Bootstrap
let game;
window.addEventListener('DOMContentLoaded', () => {
    game = new Game();
    game._draw(); // draw initial black screen

    document.getElementById('startBtn').addEventListener('click', () => game.startGame());

    // Restart on game over tap
    document.getElementById('gameCanvas').addEventListener('click', () => {
        if (game.state === STATE.OVER) game.restart();
    });
    document.getElementById('gameCanvas').addEventListener('touchend', () => {
        if (game.state === STATE.OVER) game.restart();
    });
});
