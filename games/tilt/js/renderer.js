// Canvas 2D renderer

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.HUD_H  = 90;
        // Pre-render the cat SVG for HUD use
        this._catImg = null;
        this._loadCatIcon();
    }

    _loadCatIcon() {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-46 -50 92 80">
<g transform="rotate(-12,-12,8.3)"><path d="M-21.6,-14.94 L-14.549,-35.916 Q-12,-43.5 -9.451,-35.916 L-2.4,-14.94 Z" fill="#c2410c"/></g>
<g transform="rotate(12,12,8.3)"><path d="M2.4,-14.94 L9.451,-35.916 Q12,-43.5 14.549,-35.916 L21.6,-14.94 Z" fill="#c2410c"/></g>
<ellipse cx="0" cy="1.3" rx="34" ry="26" fill="#c2410c"/>
<line x1="-14" y1="1.00" x2="-33.68" y2="-2.28" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<line x1="-14" y1="6.0" x2="-33.44" y2="6.0" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<line x1="-14" y1="10.59" x2="-29.58" y2="14.26" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<line x1="14" y1="1.00" x2="33.68" y2="-2.28" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<line x1="14" y1="6.0" x2="33.44" y2="6.0" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<line x1="14" y1="10.59" x2="29.58" y2="14.26" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>
<ellipse cx="-12" cy="-3.7" rx="4.2" ry="5.6" fill="#1a0800"/>
<ellipse cx="12" cy="-3.7" rx="4.2" ry="5.6" fill="#1a0800"/>
<ellipse cx="-12" cy="-3.7" rx="2.4" ry="3.5" fill="#000"/>
<ellipse cx="12" cy="-3.7" rx="2.4" ry="3.5" fill="#000"/>
<circle cx="-10.5" cy="-5.2" r="1.0" fill="#c2410c"/>
<circle cx="13.5" cy="-5.2" r="1.0" fill="#c2410c"/>
<path d="M0,6.3 C-0.8,4.8 -3.5,4.8 -3.5,7.3 C-3.5,9.3 0,11.3 0,11.3 C0,11.3 3.5,9.3 3.5,7.3 C3.5,4.8 0.8,4.8 0,6.3 Z" fill="#000"/>
<line x1="0" y1="11.3" x2="0" y2="13.3" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
<path d="M0,13.3 Q-5,17.3 -8,15.3" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
<path d="M0,13.3 Q5,17.3 8,15.3" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
        const blob = new Blob([svg], {type: 'image/svg+xml'});
        const url  = URL.createObjectURL(blob);
        const img  = new Image();
        img.onload = () => { this._catImg = img; URL.revokeObjectURL(url); };
        img.src = url;
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
        const floorColor = '#111825';
        ctx.fillStyle = floorColor;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;
                ctx.fillRect(x0, y0, cw, cw);
                if (c < cols-1 && passages[r][c].right) ctx.fillRect(x0 + cw, y0, wt, cw);
                if (r < rows-1 && passages[r][c].down)  ctx.fillRect(x0, y0 + cw, cw, wt);
            }
        }

        // Fill pillar corners with floor color (removes black squares at corners)
        ctx.fillStyle = floorColor;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const passR = c < cols-1 && passages[r][c].right;
                const passD = r < rows-1 && passages[r][c].down;
                const passRD = c < cols-1 && r < rows-1 && passages[r+1][c].right;
                const passDR = c < cols-1 && r < rows-1 && passages[r][c+1].down;
                // Pillar at bottom-right corner of cell (c,r), only if all 4 adjacent corridors are open
                if (c < cols-1 && r < rows-1 && passR && passD && passRD && passDR) {
                    const px = offsetX + wt + c * cs + cw;
                    const py = offsetY + wt + r * cs + cw;
                    ctx.fillRect(px, py, wt, wt);
                }
            }
        }

        // Wall rendering: per-cell Pac-Man style with inner + outer concentric arcs,
        // end caps at wall terminations, and T-junction handling.
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2a5da8';
        ctx.shadowColor = '#5599ff';
        ctx.shadowBlur = 7;

        const cr = Math.max(2, wt / 2); // inner arc radius (= 4)
        const or = cr + wt;             // outer arc radius (= 12), concentric

        // Helper: is there a wall on the given side of cell (c,r)?
        const hasWall = (c, r, side) => {
            if (side === 'T') return r === 0      || !passages[r-1][c].down;
            if (side === 'B') return r === rows-1 || !passages[r][c].down;
            if (side === 'L') return c === 0      || !passages[r][c-1].right;
            if (side === 'R') return c === cols-1 || !passages[r][c].right;
        };

        ctx.beginPath();

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs; // corridor left
                const y0 = offsetY + wt + r * cs; // corridor top
                const T = hasWall(c, r, 'T');
                const B = hasWall(c, r, 'B');
                const L = hasWall(c, r, 'L');
                const R = hasWall(c, r, 'R');

                // Inner face lines (inside corridor): shortened by cr at each end where corner arc exists
                // Top face (y = y0), runs left→right
                if (T) {
                    const x1 = x0 + (L ? cr : 0);
                    const x2 = x0 + cw - (R ? cr : 0);
                    if (x2 > x1) { ctx.moveTo(x1, y0); ctx.lineTo(x2, y0); }
                }
                // Bottom face (y = y0+cw)
                if (B) {
                    const x1 = x0 + (L ? cr : 0);
                    const x2 = x0 + cw - (R ? cr : 0);
                    if (x2 > x1) { ctx.moveTo(x1, y0 + cw); ctx.lineTo(x2, y0 + cw); }
                }
                // Left face (x = x0)
                if (L) {
                    const y1 = y0 + (T ? cr : 0);
                    const y2 = y0 + cw - (B ? cr : 0);
                    if (y2 > y1) { ctx.moveTo(x0, y1); ctx.lineTo(x0, y2); }
                }
                // Right face (x = x0+cw)
                if (R) {
                    const y1 = y0 + (T ? cr : 0);
                    const y2 = y0 + cw - (B ? cr : 0);
                    if (y2 > y1) { ctx.moveTo(x0 + cw, y1); ctx.lineTo(x0 + cw, y2); }
                }

                // Inner corner arcs (radius cr, inside corridor corners)
                if (T && L) { ctx.moveTo(x0, y0+cr); ctx.arc(x0+cr, y0+cr, cr, Math.PI, 3*Math.PI/2, false); }
                if (T && R) { ctx.moveTo(x0+cw-cr, y0); ctx.arc(x0+cw-cr, y0+cr, cr, 3*Math.PI/2, 0, false); }
                if (B && L) { ctx.moveTo(x0, y0+cw-cr); ctx.arc(x0+cr, y0+cw-cr, cr, Math.PI, Math.PI/2, true); }
                if (B && R) { ctx.moveTo(x0+cw-cr, y0+cw); ctx.arc(x0+cw-cr, y0+cw-cr, cr, Math.PI/2, 0, true); }
            }
        }

        ctx.stroke();

        // Outer concentric arcs (radius or, same centers as inner arcs — drawn in wall space)
        ctx.beginPath();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;
                const T = hasWall(c, r, 'T');
                const B = hasWall(c, r, 'B');
                const L = hasWall(c, r, 'L');
                const R = hasWall(c, r, 'R');
                // Outer arcs: same centers, radius or, in the wall region outside corridor
                if (T && L) { ctx.moveTo(x0-wt, y0+cr); ctx.arc(x0+cr, y0+cr, or, Math.PI, 3*Math.PI/2, false); }
                if (T && R) { ctx.moveTo(x0+cw-cr, y0-wt); ctx.arc(x0+cw-cr, y0+cr, or, 3*Math.PI/2, 0, false); }
                if (B && L) { ctx.moveTo(x0-wt, y0+cw-cr); ctx.arc(x0+cr, y0+cw-cr, or, Math.PI, Math.PI/2, true); }
                if (B && R) { ctx.moveTo(x0+cw-cr, y0+cw+wt); ctx.arc(x0+cw-cr, y0+cw-cr, or, Math.PI/2, 0, true); }
            }
        }
        ctx.stroke();

        // End caps: semicircle connecting two parallel line ends at wall termination
        // A wall segment "terminates" where it ends without a perpendicular wall.
        // For each cell face that has a wall but no corner arc at an end, draw semicap.
        ctx.beginPath();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x0 = offsetX + wt + c * cs;
                const y0 = offsetY + wt + r * cs;
                const T = hasWall(c, r, 'T');
                const B = hasWall(c, r, 'B');
                const L = hasWall(c, r, 'L');
                const R = hasWall(c, r, 'R');

                // Top face end caps: left end (if no L wall), right end (if no R wall)
                if (T && !L) {
                    // Check no cell to the left also has T wall (i.e., this is the start of a segment)
                    const prevHasT = c > 0 && hasWall(c-1, r, 'T');
                    if (!prevHasT) {
                        // Left cap at x0: semicircle from (x0, y0) curving left into wall
                        ctx.moveTo(x0, y0 - wt/2);
                        ctx.arc(x0, y0, wt/2, 3*Math.PI/2, Math.PI/2, true);
                    }
                }
                if (T && !R) {
                    const nextHasT = c < cols-1 && hasWall(c+1, r, 'T');
                    if (!nextHasT) {
                        ctx.moveTo(x0 + cw, y0 - wt/2);
                        ctx.arc(x0 + cw, y0, wt/2, 3*Math.PI/2, Math.PI/2, false);
                    }
                }
                // Bottom face
                if (B && !L) {
                    const prevHasB = c > 0 && hasWall(c-1, r, 'B');
                    if (!prevHasB) {
                        ctx.moveTo(x0, y0+cw - wt/2);
                        ctx.arc(x0, y0+cw, wt/2, 3*Math.PI/2, Math.PI/2, true);
                    }
                }
                if (B && !R) {
                    const nextHasB = c < cols-1 && hasWall(c+1, r, 'B');
                    if (!nextHasB) {
                        ctx.moveTo(x0+cw, y0+cw + wt/2);
                        ctx.arc(x0+cw, y0+cw, wt/2, Math.PI/2, 3*Math.PI/2, false);
                    }
                }
                // Left face
                if (L && !T) {
                    const prevHasL = r > 0 && hasWall(c, r-1, 'L');
                    if (!prevHasL) {
                        ctx.moveTo(x0 - wt/2, y0);
                        ctx.arc(x0, y0, wt/2, Math.PI, 0, false);
                    }
                }
                if (L && !B) {
                    const nextHasL = r < rows-1 && hasWall(c, r+1, 'L');
                    if (!nextHasL) {
                        ctx.moveTo(x0 + wt/2, y0+cw);
                        ctx.arc(x0, y0+cw, wt/2, 0, Math.PI, false);
                    }
                }
                // Right face
                if (R && !T) {
                    const prevHasR = r > 0 && hasWall(c, r-1, 'R');
                    if (!prevHasR) {
                        ctx.moveTo(x0+cw + wt/2, y0);
                        ctx.arc(x0+cw, y0, wt/2, 0, Math.PI, true);
                    }
                }
                if (R && !B) {
                    const nextHasR = r < rows-1 && hasWall(c, r+1, 'R');
                    if (!nextHasR) {
                        ctx.moveTo(x0+cw - wt/2, y0+cw);
                        ctx.arc(x0+cw, y0+cw, wt/2, Math.PI, 0, true);
                    }
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
        const {x, y, radius, color, goalId} = key;

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur  = 10;
        // Ball-colored circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Number label
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(7, radius * 0.9)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(goalId + 1, x, y + 1);
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
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, w, this.HUD_H);
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.HUD_H);
        ctx.lineTo(w, this.HUD_H);
        ctx.stroke();

        // Row 1 (y≈8): cat icon + "MOMO Tilt" on left; gear & lang buttons handled by HTML overlay
        const iconH = 28, iconW = 32;
        if (this._catImg) {
            ctx.drawImage(this._catImg, 6, 4, iconW, iconH);
        }
        const titleX = 6 + iconW + 4;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('MOMO', titleX, 18);
        ctx.fillStyle = '#ea580c';
        ctx.fillText(' Tilt', titleX + ctx.measureText('MOMO').width, 18);

        // Row 2 (y≈42): Stage | ⭐ score | ❤ lives
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillStyle = '#ccddff';
        ctx.textAlign = 'left';
        ctx.fillText(`St.${gs.stage}`, 10, 50);

        ctx.fillStyle = '#ffcc22';
        ctx.textAlign = 'center';
        ctx.fillText(`⭐ ${gs.score}`, w / 2, 50);

        ctx.fillStyle = '#ff4455';
        ctx.textAlign = 'right';
        let livesStr = '';
        for (let i = 0; i < Math.min(gs.lives, 5); i++) livesStr += '❤';
        if (gs.lives > 5) livesStr += `×${gs.lives}`;
        ctx.fillText(livesStr, w - 10, 50);

        // Row 3 (y≈74): ball color dots
        const balls = gs.balls || [];
        const dotR = 6;
        const totalW = balls.length * (dotR * 2 + 4) - 4;
        let bx = w / 2 - totalW / 2 + dotR;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            ctx.fillStyle = b.inGoal ? b.color : b.color + '55';
            ctx.beginPath();
            ctx.arc(bx, 75, dotR, 0, Math.PI * 2);
            ctx.fill();
            if (b.inGoal) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            bx += dotR * 2 + 4;
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
