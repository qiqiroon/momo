// Maze: top-bottom symmetric, main-street corridors, no dead ends

class MazeGenerator {
    generate(config) {
        const {
            screenWidth, screenHeight, hudHeight = 60,
            corridorWidth = 20, wallThickness = 8,
            wallBlockDensity = 0.5, warpCount = 0, seed = null
        } = config;
        this.cw = corridorWidth; this.wt = wallThickness;
        this.cs = corridorWidth + wallThickness;
        this.rng = this._makeRng(seed);

        const availH = screenHeight - hudHeight;
        let cols = Math.max(7, Math.floor((screenWidth - this.wt) / this.cs));
        let rows = Math.max(8, Math.floor((availH - this.wt) / this.cs));
        if (rows % 2 !== 0) rows--;

        const mazeW = cols * this.cs + this.wt;
        const mazeH = rows * this.cs + this.wt;
        const offsetX = Math.floor((screenWidth - mazeW) / 2);
        const offsetY = hudHeight + Math.floor((availH - mazeH) / 2);
        const halfRows = rows / 2;

        const passages = Array.from({length: rows}, () =>
            Array.from({length: cols}, () => ({right: false, down: false})));

        // Phase 1: main street rows (full horizontal corridors)
        const mainRows = this._pickMainStreets(halfRows, wallBlockDensity);
        for (const r of mainRows)
            for (let c = 0; c < cols - 1; c++) passages[r][c].right = true;

        // Phase 2: DFS spanning tree (top half only)
        const vis = Array.from({length: halfRows}, () => new Array(cols).fill(false));
        for (const r of mainRows) for (let c = 0; c < cols; c++) vis[r][c] = true;
        for (const r of mainRows) for (let c = 0; c < cols; c++) this._dfs(passages, vis, c, r, cols, halfRows);
        for (let r = 0; r < halfRows; r++) for (let c = 0; c < cols; c++)
            if (!vis[r][c]) this._dfs(passages, vis, c, r, cols, halfRows);

        // Phase 3: fix dead ends in top half
        this._fixDeadEnds(passages, cols, halfRows);

        // Phase 4: extra loops
        const maxEx = (cols-1)*halfRows + cols*(halfRows-1) - this._countPass(passages, cols, halfRows);
        this._addExtra(passages, cols, halfRows, Math.floor((1 - wallBlockDensity) * maxEx * 0.3));

        // Phase 4.5: wall islands (placed after dead-end fix so they don't get undone)
        this._addIslands(passages, cols, halfRows, Math.max(2, Math.floor(cols * halfRows / 30)));

        // Phase 5: mirror top -> bottom
        for (let r = 0; r < halfRows; r++) {
            for (let c = 0; c < cols; c++) {
                passages[rows - 1 - r][c].right = passages[r][c].right;
                if (r < halfRows - 1)
                    passages[rows - 2 - r][c].down = passages[r][c].down;
                // r == halfRows-1: center seam kept as DFS set it
            }
        }

        // Force several evenly-spaced center-seam passages so top/bottom halves connect
        const seamStep = Math.max(2, Math.floor(cols / 4));
        for (let c = 1; c < cols - 1; c += seamStep) passages[halfRows - 1][c].down = true;

        // Phase 6: fix seam dead ends
        this._fixDeadEnds(passages, cols, rows);

        const warps = this._placeWarps(rows, warpCount);
        return { cols, rows, cellSize: this.cs, corridorWidth: this.cw, wallThickness: this.wt,
                 passages, warps, offsetX, offsetY, mazeW, mazeH };
    }

    _addIslands(passages, cols, rows, count) {
        for (let i = 0; i < count; i++) {
            const c = 1 + Math.floor(this.rng() * (cols - 2));
            const r = 1 + Math.floor(this.rng() * (rows - 2));
            // Seal cell (c,r) on all 4 sides
            passages[r][c].right = false;
            if (c > 0) passages[r][c-1].right = false;
            passages[r][c].down = false;
            if (r > 0) passages[r-1][c].down = false;
        }
    }

    _pickMainStreets(halfRows, density) {
        const count = density < 0.5 ? 3 : 2;
        const step  = Math.floor(halfRows / (count + 1));
        const out = new Set();
        for (let i = 1; i <= count; i++) {
            const base = i * step;
            out.add(Math.max(1, Math.min(halfRows - 2, base + Math.floor(this.rng() * 3) - 1)));
        }
        return [...out];
    }

    _dfs(passages, vis, c, r, cols, rows) {
        vis[r][c] = true;
        for (const [dc,dr] of this._shuffle([[1,0],[-1,0],[0,1],[0,-1]])) {
            const nc=c+dc, nr=r+dr;
            if (nc>=0&&nc<cols&&nr>=0&&nr<rows&&!vis[nr][nc]) {
                this._open(passages,c,r,dc,dr,cols,rows);
                this._dfs(passages,vis,nc,nr,cols,rows);
            }
        }
    }

    _open(passages,c,r,dc,dr,cols,rows) {
        if (dc=== 1&&c<cols-1)  passages[r][c].right    = true;
        else if(dc===-1&&c>0)   passages[r][c-1].right  = true;
        else if(dr=== 1&&r<rows-1) passages[r][c].down  = true;
        else if(dr===-1&&r>0)      passages[r-1][c].down= true;
    }

    _conn(passages,c,r,cols,rows){
        let n=0;
        if(c<cols-1&&passages[r][c].right)     n++;
        if(c>0      &&passages[r][c-1].right)  n++;
        if(r<rows-1 &&passages[r][c].down)     n++;
        if(r>0      &&passages[r-1][c].down)   n++;
        return n;
    }

    _fixDeadEnds(passages,cols,rows){
        let ch=true,g=0;
        while(ch&&g++<40){
            ch=false;
            for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
                if(this._conn(passages,c,r,cols,rows)<2){
                    const o=[];
                    if(c<cols-1&&!passages[r][c].right)   o.push([1,0]);
                    if(c>0     &&!passages[r][c-1].right) o.push([-1,0]);
                    if(r<rows-1&&!passages[r][c].down)    o.push([0,1]);
                    if(r>0     &&!passages[r-1][c].down)  o.push([0,-1]);
                    if(o.length){
                        const[dc,dr]=o[Math.floor(this.rng()*o.length)];
                        this._open(passages,c,r,dc,dr,cols,rows);
                        ch=true;
                    }
                }
            }
        }
    }

    _addExtra(passages,cols,rows,n){
        for(let i=0;i<n;i++){
            const c=Math.floor(this.rng()*cols),r=Math.floor(this.rng()*rows);
            if(this.rng()<0.5){if(c<cols-1)passages[r][c].right=true;}
            else{if(r<rows-1)passages[r][c].down=true;}
        }
    }

    _countPass(passages,cols,rows){
        let n=0;
        for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
            if(passages[r][c].right)n++; if(passages[r][c].down)n++;
        }
        return n;
    }

    _placeWarps(rows,count){
        const w=[],used=new Set();
        for(let i=0;i<count;i++){
            let row,t=0;
            do{row=2+Math.floor(this.rng()*(rows-4));}while(used.has(row)&&++t<50);
            if(!used.has(row)){used.add(row);w.push({row,side:'left',pairId:i});w.push({row,side:'right',pairId:i});}
        }
        return w;
    }

    _shuffle(arr){
        const a=[...arr];
        for(let i=a.length-1;i>0;i--){const j=Math.floor(this.rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
        return a;
    }

    _makeRng(seed){
        let s=(seed==null?Math.random()*2**32:seed)>>>0;
        return()=>{
            s+=0x6D2B79F5;let t=Math.imul(s^(s>>>15),1|s);
            t=t+Math.imul(t^(t>>>7),61|t)^t;return((t^(t>>>14))>>>0)/4294967296;
        };
    }

    static cellCenter(c,r,maze){
        return{x:maze.offsetX+maze.wallThickness+c*maze.cellSize+maze.corridorWidth/2,
               y:maze.offsetY+maze.wallThickness+r*maze.cellSize+maze.corridorWidth/2};
    }

    static pickCells(maze,n,rng,exclude=[],zone=null){
        const m=1;
        const rMin=zone==='bottom'?Math.ceil(maze.rows*0.6):m;
        const rMax=zone==='top'?Math.floor(maze.rows*0.4):maze.rows-m;
        const cands=[];
        for(let r=rMin;r<rMax;r++) for(let c=m;c<maze.cols-m;c++)
            if(!exclude.some(e=>e.c===c&&e.r===r)) cands.push({c,r});
        const out=[];
        for(let i=0;i<n&&i<cands.length;i++){
            const j=i+Math.floor(rng()*(cands.length-i));
            [cands[i],cands[j]]=[cands[j],cands[i]];out.push(cands[i]);
        }
        return out;
    }
}
