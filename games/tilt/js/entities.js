// Entity data structures

const BALL_COLORS = ['#ff4455', '#4488ff', '#44dd77', '#ffcc22', '#cc44ff'];
const BALL_NAMES  = ['赤', '青', '緑', '黄', '紫'];

class Ball {
    constructor(id, body, c, r) {
        this.id = id;
        this.body = body;
        this.c = c;
        this.r = r;
        this.color = BALL_COLORS[id % BALL_COLORS.length];
        this.inGoal = false;       // currently inside its goal
        this.sizeScale = 1.0;      // shrinks when in goal
        this.invincible = 0;       // frames of invincibility after respawn
        this.frozen = 0;           // frames remaining of freeze effect
    }
    get radius() { return this.body.circleRadius; }
    get x() { return this.body.position.x; }
    get y() { return this.body.position.y; }
}

class Goal {
    constructor(id, ballId, c, r, maze) {
        this.id = id;
        this.ballId = ballId;
        this.c = c;
        this.r = r;
        this.color = BALL_COLORS[ballId % BALL_COLORS.length];
        this.locked = false;
        this.hasBall = false;
        const pos = MazeGenerator.cellCenter(c, r, maze);
        this.x = pos.x;
        this.y = pos.y;
        this.radius = maze.corridorWidth * 0.42;
    }
}

class Key {
    constructor(id, goalId, c, r, maze) {
        this.id = id;
        this.goalId = goalId;
        this.c = c;
        this.r = r;
        this.color = BALL_COLORS[goalId % BALL_COLORS.length];
        this.collected = false;
        const pos = MazeGenerator.cellCenter(c, r, maze);
        this.x = pos.x;
        this.y = pos.y;
        this.radius = 8;
    }
}

const ITEM_TYPES = {
    LIFE:    {label: '❤', color: '#ff4455', effect: 'life'},
    SCORE:   {label: '⭐', color: '#ffcc22', effect: 'score'},
    FREEZE:  {label: '❄', color: '#88ddff', effect: 'freeze'},
    SHIELD:  {label: '🛡', color: '#aaffaa', effect: 'shield'},
};

class Item {
    constructor(id, type, c, r, maze) {
        this.id = id;
        this.type = type;
        this.c = c;
        this.r = r;
        this.collected = false;
        const pos = MazeGenerator.cellCenter(c, r, maze);
        this.x = pos.x;
        this.y = pos.y;
        this.radius = 9;
    }
    get info() { return ITEM_TYPES[this.type]; }
}

class Pit {
    constructor(id, c, r, maze) {
        this.id = id;
        this.c = c;
        this.r = r;
        const pos = MazeGenerator.cellCenter(c, r, maze);
        this.x = pos.x;
        this.y = pos.y;
        this.radius = maze.corridorWidth * 0.36;
    }
}

const ENEMY_TYPES = {
    PATROL:  {color: '#ff8844', speed: 0.8, label: 'パトロール'},
    TRACKER: {color: '#ff2244', speed: 0.6, label: '追跡'},
    SLOW:    {color: '#aaaaff', speed: 0.7, label: 'スロー'},
};

class Enemy {
    constructor(id, type, c, r, maze) {
        this.id = id;
        this.type = type;
        this.c = c;
        this.r = r;
        const pos = MazeGenerator.cellCenter(c, r, maze);
        this.x = pos.x;
        this.y = pos.y;
        this.vx = 0;
        this.vy = 0;
        this.radius = 8;
        this.animTime = Math.random() * Math.PI * 2;
        this.disabled = 0;       // frames remaining while disabled
        this.dirTimer = 0;       // frames until next direction decision
        this.dir = {x: 0, y: 0};
        this.maze = maze;        // reference for wall checks
    }
    get info() { return ENEMY_TYPES[this.type] || ENEMY_TYPES.PATROL; }
    get speed() { return this.info.speed; }
    get color() { return this.info.color; }
}
