// Main: TITLE -> PREVIEW -> CALIBRATE -> PLAYING -> CLEAR/OVER

const STATE = {TITLE:'title', PREVIEW:'preview', CALIBRATE:'calibrate',
               PLAYING:'playing', CLEAR:'clear', OVER:'over'};

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
        this._loopRunning = false;

        this._resize();
        window.addEventListener('resize', () => this._resize());
        this._bindUI();
    }

    _resize() {
        this.screenW = window.innerWidth;
        this.screenH = window.innerHeight;
        this.renderer.resize(this.screenW, this.screenH);
    }

    _bindUI() {
        document.getElementById('titleBtn').addEventListener('click', () => {
            document.getElementById('titleOverlay').classList.add('hidden');
            this._buildMaze();
            this._showPreview();
            this.state = STATE.PREVIEW;
            this._startLoop();
        });

        // iOS: must call requestPermission DIRECTLY from click, no prior await
        document.getElementById('sensorBtn').addEventListener('click', () => {
            this.input.requestGyroPermission(
                () => this._enterCalibrate(),
                () => this._enterCalibrate()
            );
        });

        document.getElementById('skipSensorBtn').addEventListener('click', () => {
            this._enterCalibrate();
        });

        document.getElementById('startBtn').addEventListener('click', () => {
            this._startPlaying();
        });
        document.getElementById('skipCalibBtn').addEventListener('click', () => {
            this._startPlaying();
        });

        this.canvas.addEventListener('click',    () => { if (this.state === STATE.OVER) this._restartGame(); });
        this.canvas.addEventListener('touchend', () => { if (this.state === STATE.OVER) this._restartGame(); });
    }

    _buildMaze() {
        const density = Math.min(0.3 + this.gs.stage * 0.04, 0.75);
        this.maze = this.mazeGen.generate({
            screenWidth:     this.screenW,
            screenHeight:    this.screenH,
            hudHeight:       this.renderer.HUD_H,
            corridorWidth:   20,
            wallThickness:   8,
            wallBlockDensity: density,
            warpCount:       this.gs.stage >= 3 ? 1 : 0,
            seed:            this.gs.stage * 7919
        });
    }

    _showPreview() {
        document.getElementById('previewStage').textContent = this.gs.stage;
        document.getElementById('previewBar').classList.remove('hidden');
    }

    _enterCalibrate() {
        document.getElementById('previewBar').classList.add('hidden');
        document.getElementById('calibOverlay').classList.remove('hidden');
        this.state = STATE.CALIBRATE;
        this._calibLoop();
    }

    _calibLoop() {
        if (this.state !== STATE.CALIBRATE) return;
        const dot  = document.getElementById('levelDot');
        const stat = document.getElementById('calibStatus');
        const btn  = document.getElementById('startBtn');
        const ring = document.getElementById('levelRing');
        const W = ring.offsetWidth || 140, H = ring.offsetHeight || 140;
        const MAX = W / 2 - 12;

        const gx = Math.max(-MAX, Math.min(MAX, this.input.gamma / 45 * MAX));
        const gy = Math.max(-MAX, Math.min(MAX, this.input.beta  / 45 * MAX));
        dot.style.left = (W / 2 + gx) + 'px';
        dot.style.top  = (H / 2 + gy) + 'px';

        const isPC    = !this.input._gyroActive;
        const isLevel = isPC || this.input.isLevel(20);

        stat.textContent = isPC ? 'キーボードモード (矢印/WASD)' : (isLevel ? '水平です ✓' : '傾いています…');
        stat.className   = isLevel ? 'ok' : 'ng';
        btn.disabled     = !isLevel;

        requestAnimationFrame(() => this._calibLoop());
    }

    _startPlaying() {
        document.getElementById('calibOverlay').classList.add('hidden');
        this.physics.setupMaze(this.maze);
        this.gs.setupStage(this.maze, this.physics);
        this.clearCountdown = 0;
        this.state = STATE.PLAYING;
    }

    _startLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;
        requestAnimationFrame(t => this._loop(t));
    }

    _loop(ts) {
        const dt = Math.min(ts - (this.lastTime || ts), 50);
        this.lastTime = ts;
        this.time += dt;
        if (this.state === STATE.PLAYING) this._update(dt);
        this._draw();
        requestAnimationFrame(t => this._loop(t));
    }

    _update(dt) {
        const gs = this.gs, maze = this.maze;
        const tilt = this.input.getTilt();
        const frozenIds = gs.balls.filter(b => b.frozen > 0).map(b => b.id);

        this.physics.applyTilt(tilt.x, tilt.y, frozenIds);
        this.physics.applyGoalForces(gs.balls, gs.goals);
        this.physics.applyWarps(gs.balls, maze);
        this.physics.step(dt);

        for (const b of gs.balls)
            b.sizeScale += ((b.inGoal ? 0.7 : 1.0) - b.sizeScale) * 0.12;

        for (const goal of gs.goals) {
            const ball = gs.balls.find(b => b.id === goal.ballId);
            const has  = !goal.locked && !!ball && ball.inGoal;
            if (has && ball && !ball._wasInGoal) gs.addScore(100);
            goal.hasBall = has;
            if (ball) ball._wasInGoal = has;
        }

        for (const ev of gs.update(maze, dt)) {
            if (ev.type === 'enemy') {
                const ball = gs.balls.find(b => b.id === ev.ballId);
                if (ball && ball.needsRespawn) {
                    ball.needsRespawn = false;
                    ball.inGoal = false;
                    this.physics.respawnBall(ball, ball.startC, ball.startR, maze);
                }
                if (gs.lives <= 0) { this.state = STATE.OVER; return; }
            }
        }

        if (gs.isClear()) {
            this.clearCountdown += dt;
            if (this.clearCountdown > 1200) {
                gs.addScore(500 + gs.stage * 100);
                gs.nextStage();
                this.state = STATE.CLEAR;
                setTimeout(() => this._nextStage(), 2000);
            }
        } else {
            this.clearCountdown = 0;
        }
    }

    _nextStage() {
        this._buildMaze();
        this.physics.setupMaze(this.maze);
        this.gs.setupStage(this.maze, this.physics);
        this.clearCountdown = 0;
        this.state = STATE.PLAYING;
    }

    _restartGame() {
        this.gs = new GameState();
        this._buildMaze();
        this.physics.setupMaze(this.maze);
        this.gs.setupStage(this.maze, this.physics);
        this.clearCountdown = 0;
        this.state = STATE.PLAYING;
    }

    _draw() {
        const r = this.renderer, {gs, maze, state, time} = this;
        r.clear(maze);
        if (state === STATE.TITLE) return;
        if (maze) {
            r.drawMaze(maze);
            if (state !== STATE.PREVIEW && state !== STATE.CALIBRATE) {
                for (const g of gs.goals)   r.drawGoal(g);
                for (const k of gs.keys)    r.drawKey(k);
                for (const i of gs.items)   r.drawItem(i, time);
                for (const e of gs.enemies) r.drawEnemy(e, time);
                for (const b of gs.balls)   r.drawBall(b, time);
            }
            r.drawHUD(gs);
        }
        if (state === STATE.CLEAR) r.drawMessage('🎉 クリア！', 'ステージ ' + gs.stage + ' へ…');
        if (state === STATE.OVER)  r.drawMessage('💀 ゲームオーバー', 'タップして再スタート');
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
