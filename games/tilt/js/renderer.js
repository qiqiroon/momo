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

        // Pac-Man style wall glow.
        // Each wall's two inner faces (one per adjacent corridor) are drawn as merged
        // continuous segments. Each segment is shortened at its ends by `cr` pixels
        // where a perpendicular face exists, and quarter-circle arcs fill the corners —
        // creating smooth rounded joints with no overlapping / dark crossing.
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2a5da8';
        ctx.shadowColor = '#5599ff';
        ctx.shadowBlur = 7;

        const cr = Math.max(2, wt / 2); // corner arc radius

        // Vertical face segment at x covering rows rS..rE for corridor column col.
        // Shortened at ends where a perpendicular (horizontal) face also exists.
        const vSeg = (x, rS, rE, col) => {
            const yS = offsetY + wt + rS * cs;
            const yE = offsetY + wt + rE * cs + cw;
            const a0 = (rS === 0      || !passages[rS-1][col].down)  ? cr : 0;
            const a1 = (rE === rows-1 || !passages[rE][col].down)    ? cr : 0;
            ctx.moveTo(x, yS + a0); ctx.lineTo(x, yE - a1);
        };

        // Horizontal face segment at y covering cols cS..cE for corridor row row.
        const hSeg = (y, cS, cE, row) => {
            const xS = offsetX + wt + cS * cs;
            const xE = offsetX + wt + cE * cs + cw;
            const a0 = (cS === 0      || !passages[row][cS-1].right) ? cr : 0;
            const a1 = (cE === cols-1 || !passages[row][cE].right)   ? cr : 0;
            ctx.moveTo(xS + a0, y); ctx.lineTo(xE - a1, y);
        };

        ctx.beginPath();

        // Merged vertical segments (right face and left face of each corridor column)
        for (let c = 0; c < cols; c++) {
            let s = -1;
            for (let ri = 0; ri <= rows; ri++) {
                const has = ri < rows && (c === cols-1 || !passages[ri][c].right);
                if (has) { if (s < 0) s = ri; }
                else if (s >= 0) { vSeg(offsetX + wt + c * cs + cw, s, ri-1, c); s = -1; }
            }
            s = -1;
            for (let ri = 0; ri <= rows; ri++) {
                const has = ri < rows && (c === 0 || !passages[ri][c-1].right);
                if (has) { if (s < 0) s = ri; }
                else if (s >= 0) { vSeg(offsetX + wt + c * cs, s, ri-1, c); s = -1; }
            }
        }

        // Merged horizontal segments (bottom face and top face of each corridor row)
        for (let r = 0; r < rows; r++) {
            let s = -1;
            for (let ci = 0; ci <= cols; ci++) {
                const has = ci < cols && (r === rows-1 || !passages[r][ci].down);
                if (has) { if (s < 0) s = ci; }
                else if (s >= 0) { hSeg(offsetY + wt + r * cs + cw, s, ci-1, r); s = -1; }
            }
            s = -1;
            for (let ci = 0; ci <= cols; ci++) {
                const has = ci < cols && (r === 0 || !passages[r-1][ci].down);
                if (has) { if (s < 0) s = ci; }
                else if (s >= 0) { hSeg(offsetY + wt + r * cs, s, ci-1, r); s = -1; }
            }
        }

        // Quarter-circle arcs at every corridor corner where two wall faces meet.
        // Each arc smoothly connects the shortened ends of the two perpendicular segments.
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;
                const T = r === 0      || !passages[r-1][c].down;
                const B = r === rows-1 || !passages[r][c].down;
                const L = c === 0      || !passages[r][c-1].right;
                const R = c === cols-1 || !passages[r][c].right;
                // Top-left: arc from left face (x0, y0+cr) around to top face (x0+cr, y0)
                if (T && L) { ctx.moveTo(x0, y0+cr); ctx.arc(x0+cr, y0+cr, cr, Math.PI, 3*Math.PI/2, false); }
                // Top-right: arc from top face (x0+cw-cr, y0) around to right face (x0+cw, y0+cr)
                if (T && R) { ctx.moveTo(x0+cw, y0+cr); ctx.arc(x0+cw-cr, y0+cr, cr, 0, 3*Math.PI/2, true); }
                // Bottom-left: arc from left face (x0, y0+cw-cr) around to bottom face (x0+cr, y0+cw)
                if (B && L) { ctx.moveTo(x0, y0+cw-cr); ctx.arc(x0+cr, y0+cw-cr, cr, Math.PI, Math.PI/2, true); }
                // Bottom-right: arc from bottom face (x0+cw-cr, y0+cw) around to right face (x0+cw, y0+cw-cr)
                if (B && R) { ctx.moveTo(x0+cw-cr, y0+cw); ctx.arc(x0+cw-cr, y0+cw-cr, cr, Math.PI/2, 0, true); }
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

        // Frozen overlay
        if (ball.frozen > 0) {
            ctx.fillStyle = 'rgba(136,221,255,0.4)';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = `${Math.max(8, r * 1.0)}px sans-serif`;
            ctx.shadowColor = '#88ddff';
            ctx.shadowBlur = 6;
            ctx.fillText('❄', x, y + 1);
        }

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
        grad.addColorStop(0.55, '#050505');
        grad.addColorStop(1, '#1a1a1a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Swirling danger ring
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.shadowColor = '#666';
        ctx.shadowBlur = 5;
        for (let i = 0; i < 3; i++) {
            const r2 = radius * (0.3 + i * 0.22);
            const a0 = t * (2 + i * 0.7) + i * 1.1;
            ctx.beginPath();
            ctx.arc(x, y, r2, a0, a0 + Math.PI * 1.35);
            ctx.stroke();
        }

        // Outer dark rim
        ctx.shadowBlur = 6;
        ctx.strokeStyle = '#444';
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

        // MOMO Tilt title: MOMO=orange, Tilt=white
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ea580c';
        ctx.fillText('🐱 MOMO', 10, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(' Tilt', 10 + ctx.measureText('🐱 MOMO').width, 6);

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
