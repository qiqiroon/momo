// Canvas 2D renderer

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.HUD_H  = 60;
    }

    resize(w, h) {
        this.canvas.width  = w;
        this.canvas.height = h;
    }

    clear(maze) {
        const ctx = this.ctx;
        // Background
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        // Maze floor area
        if (maze) {
            ctx.fillStyle = '#161b22';
            ctx.fillRect(maze.offsetX, maze.offsetY, maze.mazeW, maze.mazeH);
        }
    }

    drawMaze(maze) {
        const ctx = this.ctx;
        const {cols, rows, cellSize: cs, corridorWidth: cw, wallThickness: wt,
               offsetX, offsetY, passages} = maze;

        // Dark maze background; corridor cells slightly lighter to show open paths
        ctx.fillStyle = '#0b0f16';
        ctx.fillRect(offsetX, offsetY, maze.mazeW, maze.mazeH);
        ctx.fillStyle = '#111825';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;
                ctx.fillRect(x0, y0, cw, cw);
                if (c < cols-1 && passages[r][c].right) ctx.fillRect(x0 + cw, y0, wt, cw);
                if (r < rows-1 && passages[r][c].down)  ctx.fillRect(x0, y0 + cw, cw, wt);
            }
        }

        // Pac-Man style double wall lines:
        // Each cell draws a glowing line on each closed edge (inner face of the wall).
        // The adjacent cell draws the same line on its own edge (outer face of the same wall).
        // Result: two parallel lines wt pixels apart — a double line — for every wall.
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2a5da8';
        ctx.shadowColor = '#5599ff';
        ctx.shadowBlur = 7;
        ctx.beginPath();

        // Each cell draws lines on its closed edges, extended by wt/2 into the adjacent
        // pillar area so that consecutive wall segments of the same wall connect smoothly.
        const ext = wt / 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;

                // Top edge (wall above)
                if (r === 0 || !passages[r-1][c].down) {
                    ctx.moveTo(x0 - ext, y0); ctx.lineTo(x0 + cw + ext, y0);
                }
                // Left edge (wall to left)
                if (c === 0 || !passages[r][c-1].right) {
                    ctx.moveTo(x0, y0 - ext); ctx.lineTo(x0, y0 + cw + ext);
                }
                // Bottom edge (wall below)
                if (r === rows-1 || !passages[r][c].down) {
                    ctx.moveTo(x0 - ext, y0 + cw); ctx.lineTo(x0 + cw + ext, y0 + cw);
                }
                // Right edge (wall to right)
                if (c === cols-1 || !passages[r][c].right) {
                    ctx.moveTo(x0 + cw, y0 - ext); ctx.lineTo(x0 + cw, y0 + cw + ext);
                }
            }
        }
        ctx.stroke();

        // Outer boundary outer faces
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);                    ctx.lineTo(offsetX + maze.mazeW, offsetY);
        ctx.moveTo(offsetX, offsetY + maze.mazeH);       ctx.lineTo(offsetX + maze.mazeW, offsetY + maze.mazeH);
        ctx.moveTo(offsetX, offsetY);                    ctx.lineTo(offsetX, offsetY + maze.mazeH);
        ctx.moveTo(offsetX + maze.mazeW, offsetY);       ctx.lineTo(offsetX + maze.mazeW, offsetY + maze.mazeH);
        ctx.stroke();

        ctx.restore();

        // Warp portals
        if (maze.warps) {
            for (const warp of maze.warps) {
                const wy = offsetY + wt + warp.row * cs + cw / 2;
                const wx = warp.side === 'left' ? offsetX : offsetX + maze.mazeW;
                const grad = ctx.createRadialGradient(wx, wy, 0, wx, wy, cw / 2);
                grad.addColorStop(0, 'rgba(100,200,255,0.9)');
                grad.addColorStop(1, 'rgba(50,100,200,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(wx, wy, cw / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    drawGoal(goal) {
        const ctx = this.ctx;
        const {x, y, radius, color, locked, hasBall} = goal;

        // Outer shadow ring
        const shadowGrad = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 1.3);
        shadowGrad.addColorStop(0, 'rgba(0,0,0,0.7)');
        shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.3, 0, Math.PI * 2);
        ctx.fill();

        if (locked) {
            // Locked: flat surface
            ctx.fillStyle = '#445';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#667';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Lock icon
            ctx.fillStyle = '#aaa';
            ctx.font = `${radius}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔒', x, y);
            return;
        }

        // Hole depth gradient
        const holeGrad = ctx.createRadialGradient(x + radius * 0.15, y + radius * 0.15, 0, x, y, radius);
        holeGrad.addColorStop(0, hasBall ? '#111' : '#050508');
        holeGrad.addColorStop(0.6, hasBall ? '#111' : '#0a0a10');
        holeGrad.addColorStop(1, color + '88');
        ctx.fillStyle = holeGrad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Color rim
        ctx.strokeStyle = hasBall ? color : color + 'aa';
        ctx.lineWidth = hasBall ? 2.5 : 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur  = hasBall ? 8 : 3;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Number label (white for visibility; rim keeps goal color)
        ctx.fillStyle = hasBall ? '#fff' : 'rgba(255,255,255,0.55)';
        ctx.font = `bold ${radius * 0.85}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(goal.ballId + 1, x, y);
    }

    drawKey(key) {
        if (key.collected) return;
        const ctx = this.ctx;
        const {x, y, radius, color} = key;

        ctx.save();
        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        // Key body (gold circle + stem)
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(x, y - radius * 0.3, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#aa8800';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Stem
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(x - radius * 0.15, y - radius * 0.3, radius * 0.3, radius * 0.8);
        ctx.fillRect(x + radius * 0.15 - radius * 0.25, y + radius * 0.3, radius * 0.25, radius * 0.18);
        // Color dot on head
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y - radius * 0.3, radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawItem(item, time) {
        if (item.collected) return;
        const ctx = this.ctx;
        const {x, y, radius} = item;
        const info = item.info;

        const pulse = 1 + 0.12 * Math.sin(time * 0.003 + item.id);
        ctx.save();
        ctx.shadowColor = info.color;
        ctx.shadowBlur  = 10;
        ctx.fillStyle = info.color + '33';
        ctx.beginPath();
        ctx.arc(x, y, radius * pulse * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = info.color;
        ctx.font = `${radius * 1.3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.label, x, y);
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawEnemy(enemy, time) {
        if (enemy.disabled > 0) return;
        const ctx = this.ctx;
        const {x, y, radius, color} = enemy;
        const t = time * 0.004;
        const w = 0.15 * Math.sin(t * 3 + enemy.id);

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;

        if (enemy.type === 'TRACKER') {
            // Spiky red blob
            ctx.fillStyle = color;
            ctx.beginPath();
            const spikes = 7;
            for (let i = 0; i < spikes * 2; i++) {
                const a = (i / (spikes * 2)) * Math.PI * 2 + t;
                const r2 = i % 2 === 0 ? radius * (1.25 + w) : radius * 0.65;
                if (i === 0) ctx.moveTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
                else ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
            }
            ctx.closePath();
            ctx.fill();
        } else if (enemy.type === 'SLOW') {
            // Blue blob
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                const r2 = radius * (1 + 0.2 * Math.sin(a * 3 + t * 2));
                if (i === 0) ctx.moveTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
                else ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
            }
            ctx.closePath();
            ctx.fill();
        } else {
            // Patrol: ghost-like
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y - radius * 0.1, radius, Math.PI, 0);
            // Wavy bottom
            const steps = 5;
            for (let i = 0; i <= steps; i++) {
                const px = (x + radius) - i * (radius * 2 / steps);
                const dir = i % 2 === 0 ? 1 : -1;
                const py = y + radius * (0.8 + 0.25 * dir * Math.sin(t * 4));
                ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Eye
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - radius * 0.25, y - radius * 0.2, radius * 0.25, 0, Math.PI * 2);
        ctx.arc(x + radius * 0.25, y - radius * 0.2, radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(x - radius * 0.22, y - radius * 0.15, radius * 0.12, 0, Math.PI * 2);
        ctx.arc(x + radius * 0.22, y - radius * 0.15, radius * 0.12, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawBall(ball, time) {
        const ctx = this.ctx;
        const r = ball.radius * ball.sizeScale;
        const x = ball.x;
        const y = ball.y;
        const col = ball.color;

        // Invincibility flash
        if (ball.invincible > 0 && Math.floor(ball.invincible / 4) % 2 === 0) return;

        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur  = ball.inGoal ? 4 : 10;

        // Metallic gradient
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.25, col);
        grad.addColorStop(0.7, this._darken(col, 0.5));
        grad.addColorStop(1, this._darken(col, 0.2));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.28, 0, Math.PI * 2);
        ctx.fill();

        // Number label
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(7, r * 0.9)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ball.id + 1, x, y + 1);

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawPit(pit, time) {
        const ctx = this.ctx;
        const {x, y, radius} = pit;
        const t = time * 0.0008;

        ctx.save();
        // Deep dark hole
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, '#000000');
        grad.addColorStop(0.55, '#0d0005');
        grad.addColorStop(1, '#2a0010');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Swirling danger ring
        ctx.strokeStyle = '#660022';
        ctx.lineWidth = 1;
        ctx.shadowColor = '#ff0044';
        ctx.shadowBlur = 5;
        for (let i = 0; i < 3; i++) {
            const r2 = radius * (0.3 + i * 0.22);
            const a0 = t * (2 + i * 0.7) + i * 1.1;
            ctx.beginPath();
            ctx.arc(x, y, r2, a0, a0 + Math.PI * 1.35);
            ctx.stroke();
        }

        // Outer red rim
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#cc0033';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawHUD(gs) {
        const ctx = this.ctx;
        const w = this.canvas.width;

        // HUD bar
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, w, this.HUD_H);
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.HUD_H);
        ctx.lineTo(w, this.HUD_H);
        ctx.stroke();

        // MOMO Tilt title (small)
        ctx.fillStyle = '#ff8844';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('🐱 MOMO Tilt', 10, 6);

        // Stage
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.fillText(`St.${gs.stage}`, 10, 26);

        // Score
        ctx.fillStyle = '#ffcc22';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`⭐ ${gs.score}`, w / 2, 8);

        // Lives
        ctx.fillStyle = '#ff4455';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'right';
        let livesStr = '';
        for (let i = 0; i < Math.min(gs.lives, 5); i++) livesStr += '❤';
        if (gs.lives > 5) livesStr += `×${gs.lives}`;
        ctx.fillText(livesStr, w - 8, 8);

        // Ball status (small colored circles)
        const balls = gs.balls || [];
        const bx = w / 2 - balls.length * 14 / 2;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            ctx.fillStyle = b.inGoal ? b.color : b.color + '55';
            ctx.beginPath();
            ctx.arc(bx + i * 16 + 8, 46, 6, 0, Math.PI * 2);
            ctx.fill();
            if (b.inGoal) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    drawMessage(text, subText = '') {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 - 20);
        if (subText) {
            ctx.font = '18px sans-serif';
            ctx.fillStyle = '#ccc';
            ctx.fillText(subText, w / 2, h / 2 + 20);
        }
    }

    _darken(hex, factor) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.floor(r*factor)},${Math.floor(g*factor)},${Math.floor(b*factor)})`;
    }
}
