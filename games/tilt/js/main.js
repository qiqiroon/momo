// Main: TITLE -> PREVIEW -> CALIBRATE -> INTRO -> PLAYING -> CLEAR/OVER

const STATE = {TITLE:'title', PREVIEW:'preview', CALIBRATE:'calibrate',
               INTRO:'intro', PLAYING:'playing', CLEAR:'clear', OVER:'over'};

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

        document.getElementById('calibrateBtn').addEventListener('click', () => {
            this.input.calibrate();
            const btn = document.getElementById('calibrateBtn');
            btn.textContent = t('calibrateUpdated');
            setTimeout(() => { btn.textContent = t('calibrateBtnText'); }, 1500);
        });

        document.getElementById('startBtn').addEventListener('click', () => {
            this._startPlaying();
        });
        document.getElementById('skipCalibBtn').addEventListener('click', () => {
            this._startPlaying();
        });

        document.getElementById('stageIntroBtn').addEventListener('click', () => {
            document.getElementById('stageIntroOverlay').classList.add('hidden');
            this.state = STATE.PLAYING;
        });

        // Settings panel
        document.getElementById('gearBtn').addEventListener('click', () => {
            this._openSettings();
        });
        document.getElementById('settingsCloseBtn').addEventListener('click', () => {
            this._closeSettings();
        });
        const sensSlider = document.getElementById('sensSlider');
        const spdSlider  = document.getElementById('spdSlider');
        sensSlider.value = this.input.sensitivity;
        spdSlider.value  = this.input.maxSpeed;
        document.getElementById('sensVal').textContent = this.input.sensitivity.toFixed(1);
        document.getElementById('spdVal').textContent  = Math.round(this.input.maxSpeed);
        sensSlider.addEventListener('input', () => {
            this.input.sensitivity = parseFloat(sensSlider.value);
            document.getElementById('sensVal').textContent = this.input.sensitivity.toFixed(1);
        });
        spdSlider.addEventListener('input', () => {
            this.input.maxSpeed = parseFloat(spdSlider.value);
            document.getElementById('spdVal').textContent = Math.round(this.input.maxSpeed);
        });

        this.canvas.addEventListener('click',    () => { if (this.state === STATE.OVER) this._restartGame(); });
        this.canvas.addEventListener('touchend', () => { if (this.state === STATE.OVER) this._restartGame(); });
    }

    _openSettings() {
        document.getElementById('settingsOverlay').classList.remove('hidden');
        this._prevState = this.state;
        if (this.state === STATE.PLAYING) this.state = STATE.CALIBRATE;
    }

    _closeSettings() {
        document.getElementById('settingsOverlay').classList.add('hidden');
        this.input.saveSettings();
        if (this._prevState) { this.state = this._prevState; this._prevState = null; }
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
        const el = document.getElementById('previewStageText');
        if (el) el.textContent =
            t('previewStageLabel') + ' ' + this.gs.stage + ' ' + t('previewSuffix');
        document.getElementById('previewBar').classList.remove('hidden');
    }

    _enterCalibrate() {
        document.getElementById('previewBar').classList.add('hidden');
        document.getElementById('calibOverlay').classList.remove('hidden');
        this.state = STATE.CALIBRATE;
        this._calibLoop();
    }

    _calibLoop() {
        if (this.state !== STATE.CALIBRATE && this.state !== STATE.INTRO) return;
        const dot  = document.getElementById('levelDot');
        const stat = document.getElementById('calibStatus');
        const btn  = document.getElementById('startBtn');
        const ring = document.getElementById('levelRing');
        const W = ring.offsetWidth || 140, H = ring.offsetHeight || 140;
        const MAX = W / 2 - 12;

        const rel = this.input.getRelative();
        const gx = Math.max(-MAX, Math.min(MAX, rel.gamma / 30 * MAX));
        const gy = Math.max(-MAX, Math.min(MAX, rel.beta  / 30 * MAX));
        dot.style.left = (W / 2 + gx) + 'px';
        dot.style.top  = (H / 2 + gy) + 'px';

        const isPC    = !this.input._gyroActive;
        const isLevel = isPC || this.input.isLevel(15);

        stat.textContent = isPC ? t('kbdMode') : (isLevel ? t('calibOk') : t('calibNg'));
        stat.className   = isLevel ? 'ok' : 'ng';
        btn.disabled     = !isLevel;

        requestAnimationFrame(() => this._calibLoop());
    }

    _startPlaying() {
        document.getElementById('calibOverlay').classList.add('hidden');
        this.physics.setupMaze(this.maze);
        this.gs.setupStage(this.maze, this.physics);
        this.clearCountdown = 0;
        document.getElementById('gearBtn').classList.remove('hidden');

        const hasIntro = this.gs.enemies.length > 0 || this.gs.pits.length > 0 || this.gs.items.length > 0;
        if (hasIntro) {
            this._showStageIntro();
        } else {
            this.state = STATE.PLAYING;
        }
    }

    _showStageIntro() {
        this.state = STATE.INTRO;
        const gs = this.gs;

        // Title
        document.getElementById('stageIntroTitle').textContent =
            t('stageLabel') + ' ' + gs.stage;

        const content = document.getElementById('stageIntroContent');
        content.innerHTML = '';

        const makeSection = (header, items) => {
            if (!items.length) return;
            const h = document.createElement('div');
            h.className = 'intro-section-header';
            h.textContent = header;
            content.appendChild(h);
            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'intro-row';
                row.innerHTML = `<span class="intro-icon">${item.icon}</span>
                    <span class="intro-name">${item.name}</span>
                    <span class="intro-desc">${item.desc}</span>`;
                content.appendChild(row);
            });
        };

        // Enemies
        const enemyNameMap = {
            PATROL:  {icon:'👻', nameKey:'enemyPatrolName',  descKey:'enemyPatrolDesc'},
            TRACKER: {icon:'🔴', nameKey:'enemyTrackerName', descKey:'enemyTrackerDesc'},
            SLOW:    {icon:'🔵', nameKey:'enemySlowName',    descKey:'enemySlowDesc'},
        };
        const seenEnemyTypes = [...new Set(gs.enemies.map(e => e.type))];
        makeSection(t('stageIntroEnemies'), seenEnemyTypes.map(type => {
            const m = enemyNameMap[type] || {icon:'❓', nameKey: type, descKey: type};
            return {icon: m.icon, name: t(m.nameKey), desc: t(m.descKey)};
        }));

        // Items
        const itemDescMap = {
            LIFE:'itemLifeDesc', SCORE:'itemScoreDesc', FREEZE:'itemFreezeDesc', SHIELD:'itemShieldDesc'
        };
        const seenItemTypes = [...new Set(gs.items.map(i => i.type))];
        makeSection(t('stageIntroItems'), seenItemTypes.map(type => {
            const info = ITEM_TYPES[type];
            return {icon: info.label, name: '', desc: t(itemDescMap[type] || type)};
        }));

        // Pits
        if (gs.pits.length > 0) {
            makeSection(t('stageIntroPits'), [{
                icon: '⚫', name: t('pitName'), desc: t('pitDesc')
            }]);
        }

        // Locked goals
        if (gs.goals.some(g => g.locked)) {
            makeSection(t('stageIntroLocks'), [{
                icon: '🔒', name: t('lockName'), desc: t('lockDesc')
            }]);
        }

        document.getElementById('stageIntroBtn').textContent = t('stageIntroOk');
        document.getElementById('stageIntroOverlay').classList.remove('hidden');
    }

    _startLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;
        requestAnimationFrame(ts => this._loop(ts));
    }

    _loop(ts) {
        const dt = Math.min(ts - (this.lastTime || ts), 50);
        this.lastTime = ts;
        this.time += dt;
        if (this.state === STATE.PLAYING) this._update(dt);
        this._draw();
        requestAnimationFrame(ts => this._loop(ts));
    }

    _update(dt) {
        const gs = this.gs, maze = this.maze;
        const tilt = this.input.getTilt();
        const frozenIds = gs.balls.filter(b => b.frozen > 0).map(b => b.id);

        this.physics.applyTilt(tilt.x, tilt.y, frozenIds);
        this.physics.applyGoalForces(gs.balls, gs.goals);
        this.physics.applyWarps(gs.balls, maze);
        this.physics.step(dt, this.input.maxSpeed);
        this.physics.checkBounds(gs.balls, maze);
        this.physics.unstuckBalls(gs.balls, maze, (x, y) => gs._isWall(x, y, maze, this.physics.BALL_RADIUS * 0.9));

        for (const b of gs.balls)
            b.sizeScale += ((b.inGoal ? 0.7 : 1.0) - b.sizeScale) * 0.12;

        for (const goal of gs.goals) {
            // Only the matching ball in this specific goal counts as cleared
            const ball = gs.balls.find(b => b.id === goal.ballId && b.currentGoalId === goal.id);
            const has  = !goal.locked && !!ball && ball.inGoal;
            if (has && ball && !ball._wasInGoal) gs.addScore(100);
            goal.hasBall = has;
            if (ball) ball._wasInGoal = has;
            else {
                const anyBall = gs.balls.find(b => b.id === goal.ballId);
                if (anyBall) anyBall._wasInGoal = false;
            }
        }

        for (const ev of gs.update(maze, dt)) {
            if (ev.type === 'enemy' || ev.type === 'pit') {
                const ball = gs.balls.find(b => b.id === ev.ballId);
                if (ball && ball.needsRespawn) {
                    ball.needsRespawn = false;
                    ball.inGoal = false;
                    this.physics.respawnBall(ball, ball.startC, ball.startR, maze);
                }
                if (ev.type === 'enemy' && gs.lives <= 0) { this.state = STATE.OVER; return; }
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
        const hasIntro = this.gs.enemies.length > 0 || this.gs.pits.length > 0;
        if (hasIntro) {
            this._showStageIntro();
        } else {
            this.state = STATE.PLAYING;
        }
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
                for (const p of gs.pits)    r.drawPit(p, time);
                for (const g of gs.goals)   r.drawGoal(g);
                for (const k of gs.keys)    r.drawKey(k);
                for (const i of gs.items)   r.drawItem(i, time);
                for (const e of gs.enemies) r.drawEnemy(e, time);
                for (const b of gs.balls)   r.drawBall(b, time);
            }
            r.drawHUD(gs);
        }
        if (state === STATE.CLEAR)
            r.drawMessage(t('clearMsg'), t('clearSub').replace('{N}', gs.stage));
        if (state === STATE.OVER)
            r.drawMessage(t('overMsg'), t('overSub'));
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
