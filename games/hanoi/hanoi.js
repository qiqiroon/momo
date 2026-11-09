const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const DIFF_CONFIG = {
  easy:       {discs:4,ufoCount:2,ufoSpeed:0.6,ufoFireRate:180,bombSpeed:1.2,bombDmg:0.4,scoreMult:1,label:'EASY'},
  hard:       {discs:6,ufoCount:3,ufoSpeed:1.0,ufoFireRate:120,bombSpeed:1.8,bombDmg:0.6,scoreMult:2,label:'HARD'},
  apocalypse: {discs:8,ufoCount:5,ufoSpeed:1.6,ufoFireRate:70, bombSpeed:2.6,bombDmg:0.9,scoreMult:3,label:'APOCALYPSE'},
};

let difficulty='easy', cfg=DIFF_CONFIG['easy'];

// ── LAYOUT ──
const CW=()=>canvas.width, CH=()=>canvas.height;
const GROUND_Y=()=>CH()-55;
const POLE_X=i=>CW()*(0.2+i*0.3);
const DISC_H=14, DISC_GAP=2, DISC_STEP=()=>DISC_H+DISC_GAP;
const UFO_MIN_Y=24;
const UFO_MAX_Y=()=>CH()*0.20;
const POLE_H=()=>GROUND_Y()-UFO_MAX_Y()-30;
const TRANSIT_Y=()=>UFO_MAX_Y()+14;
const POLE_W=8;
const MAX_DISC_W=()=>CW()*0.16, MIN_DISC_W=28;
const SHELL_EXPLODE_Y=()=>(UFO_MIN_Y+UFO_MAX_Y())/2;

function discWidth(size){return MIN_DISC_W+(MAX_DISC_W()-MIN_DISC_W)*(size/cfg.discs);}
function discStackY(pi,si){return GROUND_Y()-DISC_STEP()*si-DISC_H/2;}
function discColor(size){
  const t=size/cfg.discs;
  return `rgb(${Math.round(180+t*60)},${Math.round(65*(1-t*0.5))},${Math.round(12*(1-t*0.4))})`;
}

// ── STATE ──
let gameState='title';
let poles, animDiscs, shells, explosions, ufos, bombs;
let hp, maxHp, score, kills, startTime, elapsed;
let selectedPole=-1, goalPole=2;
let frameId, lastTime=0;

// ── RULE HELPERS ──

// Is any non-error anim disc currently heading TO this pole?
function poleIsTarget(poleIdx){
  return animDiscs.some(a=>!a.isError && a.toPole===poleIdx);
}

// Swap check: is there a disc going from toPole to fromPole?
// A→B中にB→Aは禁止（swap）
function isSwap(fromPole, toPole){
  return animDiscs.some(a=>!a.isError && a.fromPole===toPole && a.toPole===fromPole);
}

// Estimate arrival order score (lower = arrives sooner).
// We use phase priority + remaining distance to target.
function arrivalScore(a){
  const phaseOrder={up:0,across:1,down:2};
  const p=phaseOrder[a.phase]??0;
  const distDown=Math.abs(discStackY(a.toPole, 0)-a.y); // rough remaining
  return p*10000+distDown;
}

// For a given toPole, return the ordered list of incoming discs by arrival order (earliest first).
function incomingDiscs(toPoleIdx){
  return animDiscs
    .filter(a=>!a.isError && a.toPole===toPoleIdx)
    .sort((a,b)=>arrivalScore(a)-arrivalScore(b));
}

// Full rule check for placing `disc` on `toPoleIdx`.
// Considers settled stack AND ordered incoming discs.
// Returns true if placement is legal.
function canPlaceDisc(disc, toPoleIdx){
  // build effective stack: settled + incoming in arrival order
  const settled = poles[toPoleIdx].length>0 ? poles[toPoleIdx].at(-1) : Infinity;
  const incoming = incomingDiscs(toPoleIdx);
  // effective top = smallest of settled top + all incoming
  // because incoming will stack one on top of another in arrival order
  // the last incoming must be < the one before it, etc.
  // for a new disc: it will arrive AFTER all current incoming,
  // so it must be smaller than the last (latest-arriving) incoming,
  // which must itself be smaller than the second-to-last, etc.
  // Simplification: new disc must be < min(settled, all incoming discs)
  const minExisting = Math.min(settled, ...incoming.map(a=>a.disc));
  return disc < minExisting;
}

// Check if a newly dispatched disc to toPole violates order with existing incomings.
// Returns true if it's a rule violation (should be error anim).
function checkOrderViolation(disc, toPoleIdx){
  return !canPlaceDisc(disc, toPoleIdx);
}

// ── RANKING ──
function getRanking(){try{return JSON.parse(localStorage.getItem('momoHanoiRanking')||'[]');}catch(e){return[];}}
function saveRanking(r){localStorage.setItem('momoHanoiRanking',JSON.stringify(r));}
function addRanking(name,sc,diff){
  const r=getRanking();
  r.push({name,score:sc,diff,date:new Date().toLocaleDateString('ja-JP')});
  r.sort((a,b)=>b.score-a.score);
  saveRanking(r.slice(0,10));
}
function renderRanking(el){
  const r=getRanking();
  if(!r.length){el.innerHTML='<div class="ranking-header">🏆 Hall of Fame</div><div class="ranking-empty">'+t('rankingEmpty')+'</div>';return;}
  let html='<div class="ranking-header">🏆 Hall of Fame</div>';
  r.slice(0,8).forEach((row,i)=>{
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1+'';
    const cls=i<3?'rank-num gold':'rank-num';
    html+=`<div class="ranking-row"><div class="${cls}">${medal}</div><div>${row.name}</div><div class="rank-score">${row.score.toLocaleString()}</div><div class="rank-diff">${row.diff}</div></div>`;
  });
  el.innerHTML=html;
}

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById('screen-'+id).classList.add('active');document.body.classList.toggle('in-game', id==='game');}

// ── INIT ──
function initGame(){
  cfg=DIFF_CONFIG[difficulty];
  poles=[[],[],[]];
  for(let i=cfg.discs;i>=1;i--)poles[0].push(i);
  animDiscs=[];shells=[];explosions=[];ufos=[];bombs=[];
  hp=100;maxHp=100;score=0;kills=0;
  startTime=performance.now();elapsed=0;
  selectedPole=-1;
  goalPole=2;
  for(let i=0;i<cfg.ufoCount;i++)spawnUFO(i);
  document.getElementById('hudDiff').textContent=cfg.label;
  updateHUD();
}

function spawnUFO(idx){
  ufos[idx]={
    x:CW()*(0.1+Math.random()*0.8),
    y:UFO_MIN_Y+Math.random()*(UFO_MAX_Y()-UFO_MIN_Y),
    vx:(Math.random()<0.5?1:-1)*cfg.ufoSpeed,
    wt:Math.random()*Math.PI*2,
    fireTimer:Math.floor(Math.random()*cfg.ufoFireRate),
    w:54,h:22,dead:false,
  };
}

function updateHUD(){
  document.getElementById('hudScore').textContent=score.toLocaleString();
  document.getElementById('hudKills').textContent=kills;
  const pct=Math.max(0,hp/maxHp*100);
  document.getElementById('hpBar').style.width=pct+'%';
  document.getElementById('hpText').textContent=Math.ceil(hp);
  const t=Math.floor(elapsed/1000),m=Math.floor(t/60),s=t%60;
  document.getElementById('hudTime').textContent=m+':'+(s<10?'0':'')+s;
}

function updateHint(){
  const el=document.getElementById('moveHint');
  if(selectedPole===-1){el.innerHTML=t('moveHint');return;}
  const top=poles[selectedPole].at(-1);
  if(top!==undefined)
    el.innerHTML=t('moveHintSelected',{pole:selectedPole+1,disc:top});
  else{selectedPole=-1;el.innerHTML=t('moveHint');}
}

// ── MOVE ──
function tryMove(fromPole, toPole){
  if(fromPole===toPole)return;
  if(poles[fromPole].length===0)return;

  // RULE: swap禁止 A→B中にB→Aは不可
  if(isSwap(fromPole, toPole)){
    flashHint(t('swapBan'));
    selectedPole=-1; updateHint(); return;
  }

  const disc=poles[fromPole].at(-1);
  const isError=checkOrderViolation(disc, toPole);

  poles[fromPole].pop();
  animDiscs.push({
    disc, fromPole, toPole,
    originPole:fromPole,
    phase:isError?'error_up':'up',
    x:POLE_X(fromPole),
    y:discStackY(fromPole,poles[fromPole].length),
    pauseTimer:0,
    isError,
  });
  selectedPole=-1; updateHint();
}

let hintOverride='', hintTimer=0;
function flashHint(msg){hintOverride=msg;hintTimer=90;}

// ── SHELL ──
function fireShell(poleIdx){
  const disc=poles[poleIdx].at(-1)||1;
  shells.push({x:POLE_X(poleIdx),y:GROUND_Y()-POLE_H()-10,vy:-3.5,disc,done:false});
}

// ── EXPLOSION ──
// 爆発半径：最小円盤(size=1)を基準1倍、円盤サイズごとに倍増
function explosionRadius(discSize){
  return 32 * discSize; // size1=32px, size2=64px, size3=96px ...
}
function spawnExplosion(x,y,disc){
  const radius=explosionRadius(disc);
  const life=50+disc*5;
  explosions.push({x,y,radius,life,maxLife:life});
  ufos.forEach((u,ui)=>{
    if(u.dead)return;
    const dx=u.x-x,dy=u.y-y;
    if(Math.sqrt(dx*dx+dy*dy)<radius)killUFO(ui);
  });
}

function killUFO(ui){
  if(ufos[ui].dead)return;
  ufos[ui].dead=true;kills++;
  score+=Math.round(100*cfg.discs*cfg.scoreMult);
  hp=Math.min(maxHp,hp+cfg.discs*3);
  updateHUD();
  setTimeout(()=>spawnUFO(ui),2500+Math.random()*2000);
}

function checkWin(){
  if(animDiscs.length===0&&poles[goalPole].length===cfg.discs)endGame(true);
}

function endGame(won){
  gameState='result';cancelAnimationFrame(frameId);
  if(window.MomoRating)setTimeout(()=>MomoRating.prompt(),1500);  // 評価の声かけ（lib/momo-rating.js・1端末1回）
  const mult=cfg.scoreMult;
  const timeBonus=won?Math.round(Math.max(0,3000-Math.floor(elapsed/1000))*5*mult):0;
  const hpBonus=Math.round(Math.floor(hp)*20*mult);
  const finalScore=score+timeBonus+hpBonus;
  document.getElementById('resultTitle').textContent=won?t('resultClear'):t('resultGameOver');
  document.getElementById('resultTitle').style.color=won?'#fb923c':'#737373';
  document.getElementById('resultSub').textContent=won?t('endClearMsg'):t('endGameOverMsg');
  document.getElementById('resultScore').textContent=finalScore.toLocaleString();
  const _per=Math.round(cfg.discs*100*mult);
  const _hpLeft=Math.floor(hp);
  const _hpMul=20*mult;
  document.getElementById('resultDetail').textContent=
    t('endKillsTpl',{kills:kills,per:_per})+' + '+t('endHpLeftTpl',{hp:_hpLeft,m:_hpMul})
    +(won?t('endTimeBonusTpl',{n:timeBonus}):'')
    +(mult>1?t('endMultiplierTpl',{n:mult}):'');
  score=finalScore;
  renderRanking(document.getElementById('resultRanking'));
  showScreen('result');
}

// ── DRAW ──
function draw(){
  ctx.clearRect(0,0,CW(),CH());
  ctx.fillStyle='#000';ctx.fillRect(0,0,CW(),CH());

  // stars
  ctx.fillStyle='rgba(255,255,255,0.35)';
  for(let i=0;i<60;i++)ctx.fillRect((i*137.5+11)%CW(),(i*97.3+7)%(GROUND_Y()-20),1,1);

  // UFO zone divider
  ctx.strokeStyle='rgba(194,65,12,0.12)';ctx.lineWidth=1;ctx.setLineDash([6,8]);
  ctx.beginPath();ctx.moveTo(0,UFO_MAX_Y());ctx.lineTo(CW(),UFO_MAX_Y());ctx.stroke();
  ctx.setLineDash([]);

  // ground
  ctx.fillStyle='#1a1a1a';ctx.fillRect(0,GROUND_Y(),CW(),CH()-GROUND_Y());
  ctx.strokeStyle='#2a2a2a';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,GROUND_Y());ctx.lineTo(CW(),GROUND_Y());ctx.stroke();

  // goal highlight
  const gx=POLE_X(goalPole),poleTopY=GROUND_Y()-POLE_H();
  ctx.fillStyle='rgba(194,65,12,0.07)';
  ctx.fillRect(gx-MAX_DISC_W()/2-10,poleTopY-4,MAX_DISC_W()+20,GROUND_Y()-poleTopY+4);
  ctx.strokeStyle='rgba(194,65,12,0.3)';ctx.lineWidth=1;
  ctx.strokeRect(gx-MAX_DISC_W()/2-10,poleTopY-4,MAX_DISC_W()+20,GROUND_Y()-poleTopY+4);
  ctx.fillStyle='#c2410c';ctx.font='10px Noto Sans JP';ctx.textAlign='center';
  ctx.fillText('GOAL',gx,poleTopY-8);

  // poles
  for(let i=0;i<3;i++){
    const px=POLE_X(i),py=GROUND_Y(),ptop=py-POLE_H();

    // target-locked indicator (disc heading here)
    if(poleIsTarget(i)){
      ctx.strokeStyle='rgba(251,146,60,0.25)';ctx.lineWidth=2;ctx.setLineDash([3,6]);
      ctx.strokeRect(px-MAX_DISC_W()/2-6,ptop-4,MAX_DISC_W()+12,GROUND_Y()-ptop+4);
      ctx.setLineDash([]);
    }
    // selected
    if(selectedPole===i){
      ctx.strokeStyle='rgba(251,146,60,0.75)';ctx.lineWidth=2;ctx.setLineDash([4,4]);
      ctx.strokeRect(px-MAX_DISC_W()/2-6,ptop-4,MAX_DISC_W()+12,GROUND_Y()-ptop+4);
      ctx.setLineDash([]);
    }
    // shaft
    ctx.fillStyle='#525252';ctx.fillRect(px-POLE_W/2,ptop,POLE_W,POLE_H());
    ctx.fillStyle='#737373';ctx.beginPath();ctx.arc(px,ptop,POLE_W*0.8,0,Math.PI*2);ctx.fill();
    // label
    ctx.fillStyle='#a3a3a3';ctx.font='11px Noto Sans JP';ctx.textAlign='center';
    ctx.fillText(t('poleLabel',{n:i+1}),px,py+20);
    if(i===goalPole){
      ctx.fillStyle='#ea580c';
      ctx.font='bold 18px Fredoka One, cursive';
      ctx.fillText('★ GOAL ★',px,py+40);
    }
    // settled discs
    poles[i].forEach((disc,si)=>drawDisc(disc,px,discStackY(i,si)));
  }

  // anim discs
  animDiscs.forEach(a=>drawDisc(a.disc,a.x,a.y,a.isError));

  // shells
  shells.forEach(s=>{
    if(s.done)return;
    ctx.fillStyle='#fb923c';ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(251,146,60,0.25)';ctx.beginPath();ctx.arc(s.x,s.y,8,0,Math.PI*2);ctx.fill();
  });

  // explosions
  explosions.forEach(e=>{
    if(e.life<=0)return;
    const t=1-e.life/e.maxLife,r=e.radius*Math.min(1,t*2),alpha=e.life/e.maxLife;
    const g=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,r);
    g.addColorStop(0,`rgba(251,146,60,${alpha})`);
    g.addColorStop(0.5,`rgba(194,65,12,${alpha*0.6})`);
    g.addColorStop(1,`rgba(124,45,18,0)`);
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=`rgba(251,146,60,${alpha*0.4})`;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.stroke();
  });

  // UFOs
  ufos.forEach(u=>{
    if(u.dead)return;
    const{x:ux,y:uy,w:uw,h:uh}=u;
    ctx.shadowColor='rgba(251,146,60,0.5)';ctx.shadowBlur=14;
    ctx.fillStyle='#a3a3a3';ctx.beginPath();ctx.ellipse(ux,uy,uw/2,uh/2,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#d4d4d4';ctx.beginPath();ctx.ellipse(ux,uy-uh*0.25,uw*0.32,uh*0.5,0,Math.PI,0);ctx.fill();
    ctx.fillStyle='#c2410c';ctx.beginPath();ctx.ellipse(ux,uy+uh*0.1,uw*0.4,uh*0.17,0,0,Math.PI*2);ctx.fill();
    [-uw*0.22,0,uw*0.22].forEach(ox=>{ctx.fillStyle='#fb923c';ctx.beginPath();ctx.arc(ux+ox,uy+uh*0.1,2.5,0,Math.PI*2);ctx.fill();});
    ctx.shadowBlur=0;ctx.shadowColor='transparent';
  });

  // bombs
  bombs.forEach(b=>{
    if(b.done)return;
    ctx.fillStyle='#737373';ctx.beginPath();ctx.arc(b.x,b.y,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(251,146,60,0.3)';ctx.beginPath();ctx.arc(b.x,b.y,9,0,Math.PI*2);ctx.fill();
  });
}

function drawDisc(size,cx,cy,isError=false){
  const w=discWidth(size),h=DISC_H-2;
  ctx.fillStyle=isError?'#7c2d12':discColor(size);
  ctx.beginPath();ctx.roundRect(cx-w/2,cy-h/2,w,h,4);ctx.fill();
  ctx.strokeStyle=isError?'rgba(255,100,100,0.5)':'rgba(255,255,255,0.15)';
  ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)';
  ctx.font=`bold ${Math.min(10,h-2)}px Noto Sans JP`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(size,cx,cy);ctx.textBaseline='alphabetic';
}

// ── ANIM UPDATE ──
const SPEED=0.36;

function updateAnimDisc(a,dt){
  const sp=SPEED*dt;
  if(a.isError){
    if(a.phase==='error_up'){
      a.y-=sp;if(a.y<=TRANSIT_Y()){a.y=TRANSIT_Y();a.phase='error_across';}
    }else if(a.phase==='error_across'){
      const tx=POLE_X(a.toPole),dx=tx-a.x;
      a.x+=Math.sign(dx)*sp*0.9;
      if(Math.abs(a.x-tx)<2){a.x=tx;a.pauseTimer=28;a.phase='error_pause';}
    }else if(a.phase==='error_pause'){
      a.pauseTimer--;if(a.pauseTimer<=0)a.phase='error_return';
    }else if(a.phase==='error_return'){
      const tx=POLE_X(a.originPole),dx=tx-a.x;
      a.x+=Math.sign(dx)*sp*0.9;
      if(Math.abs(a.x-tx)<2){a.x=tx;a.targetY=discStackY(a.originPole,poles[a.originPole].length);a.phase='error_down';}
    }else if(a.phase==='error_down'){
      const ty=a.targetY;
      a.y+=sp;
      if(a.y>=ty){a.y=ty;poles[a.originPole].push(a.disc);return true;}
    }
    return false;
  }
  // normal
  if(a.phase==='up'){
    a.y-=sp;if(a.y<=TRANSIT_Y()){a.y=TRANSIT_Y();a.phase='across';}
  }else if(a.phase==='across'){
    const tx=POLE_X(a.toPole),dx=tx-a.x;
    a.x+=Math.sign(dx)*sp*0.9;
    if(Math.abs(a.x-tx)<2){a.x=tx;a.targetY=discStackY(a.toPole,poles[a.toPole].length);a.phase='down';}
  }else if(a.phase==='down'){
    const ty=a.targetY;
    a.y+=sp;
    if(a.y>=ty){
      a.y=ty;poles[a.toPole].push(a.disc);
      fireShell(a.toPole);return true;
    }
  }
  return false;
}

// ── UPDATE ──
function update(dt){
  if(gameState!=='game')return;
  elapsed=performance.now()-startTime;
  if(hintTimer>0)hintTimer--;

  // anim discs
  const doneIdx=[];
  animDiscs.forEach((a,i)=>{if(updateAnimDisc(a,dt))doneIdx.push(i);});
  for(let i=doneIdx.length-1;i>=0;i--)animDiscs.splice(doneIdx[i],1);
  if(doneIdx.length>0)checkWin();

  // shells — hit moving discs
  shells.forEach(s=>{
    if(s.done)return;
    s.y+=s.vy*(dt*0.05);
    for(let ai=animDiscs.length-1;ai>=0;ai--){
      const a=animDiscs[ai];if(s.done)break;
      const dx=a.x-s.x,dy=a.y-s.y;
      if(Math.sqrt(dx*dx+dy*dy)<discWidth(a.disc)/2+6){
        spawnExplosion(s.x,s.y,s.disc);s.done=true;
        const ret={
          disc:a.disc,fromPole:a.fromPole,toPole:a.originPole,
          originPole:a.originPole,phase:'error_return',
          x:a.x,y:a.y,pauseTimer:0,isError:true,
        };
        animDiscs.splice(ai,1);animDiscs.push(ret);break;
      }
    }
    if(!s.done&&s.y<=SHELL_EXPLODE_Y()){spawnExplosion(s.x,s.y,s.disc);s.done=true;}
  });
  shells=shells.filter(s=>!s.done);

  explosions.forEach(e=>{e.life-=1;});
  explosions=explosions.filter(e=>e.life>0);

  // UFOs
  ufos.forEach(u=>{
    if(u.dead)return;
    u.x+=u.vx*(dt*0.05);u.wt+=dt*0.0025;
    const midY=(UFO_MIN_Y+UFO_MAX_Y())/2,amp=(UFO_MAX_Y()-UFO_MIN_Y)*0.35;
    u.y=midY+Math.sin(u.wt)*amp;
    if(u.x<u.w/2){u.x=u.w/2;u.vx*=-1;}
    if(u.x>CW()-u.w/2){u.x=CW()-u.w/2;u.vx*=-1;}
    u.fireTimer--;
    if(u.fireTimer<=0){
      u.fireTimer=cfg.ufoFireRate+Math.floor(Math.random()*60);
      bombs.push({x:u.x,y:u.y+u.h/2,vy:cfg.bombSpeed,done:false});
    }
  });

  // bombs
  bombs.forEach(b=>{
    if(b.done)return;
    b.y+=b.vy*(dt*0.05);
    if(b.y>GROUND_Y()){
      b.done=true;
      explosions.push({x:b.x,y:GROUND_Y(),radius:32,life:35,maxLife:35});
      hp-=cfg.bombDmg;updateHUD();
      if(hp<=0){hp=0;updateHUD();endGame(false);}
    }
  });
  bombs=bombs.filter(b=>!b.done);
  updateHUD();
}

// ── LOOP ──
function loop(ts){
  const dt=Math.min(ts-lastTime,50);lastTime=ts;
  update(dt);

  // hint display
  const hintEl=document.getElementById('moveHint');
  if(hintTimer>0) hintEl.innerHTML=`<span style="color:#f87171">${hintOverride}</span>`;
  else updateHint();

  draw();
  if(gameState==='game')frameId=requestAnimationFrame(loop);
}
function startLoop(){lastTime=performance.now();frameId=requestAnimationFrame(loop);}

// ── INPUT ──
canvas.addEventListener('click',e=>{
  if(gameState!=='game')return;
  const rect=canvas.getBoundingClientRect();
  const scaleX=CW()/rect.width;
  const mx=(e.clientX-rect.left)*scaleX;
  let clicked=-1;
  for(let i=0;i<3;i++){if(Math.abs(mx-POLE_X(i))<MAX_DISC_W()/2+14){clicked=i;break;}}
  if(clicked===-1)return;

  if(selectedPole===-1){
    if(poles[clicked].length===0)return;
    selectedPole=clicked;
  }else{
    if(selectedPole===clicked){selectedPole=-1;updateHint();return;}
    tryMove(selectedPole,clicked);
  }
  updateHint();
});

document.querySelectorAll('.diff-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');difficulty=btn.dataset.diff;
  });
});
document.getElementById('startBtn').addEventListener('click',()=>{
  initGame();showScreen('game');gameState='game';startLoop();
});
document.getElementById('retryBtn').addEventListener('click',()=>{
  showScreen('title');gameState='title';
  renderRanking(document.getElementById('titleRanking'));
  document.getElementById('saveBtn').textContent=t('saveBtn');
  document.getElementById('saveBtn').disabled=false;
});
document.getElementById('saveBtn').addEventListener('click',()=>{
  const name=document.getElementById('nameInput').value.trim()||t('nameDefault');
  addRanking(name,score,cfg.label);
  renderRanking(document.getElementById('resultRanking'));
  document.getElementById('saveBtn').textContent=t('saveBtnDone');
  document.getElementById('saveBtn').disabled=true;
});

// ── 多言語対応 (ja/en/zh/cat) + 共通ライブラリ momo-lang 連携 ──
const I18N_HANOI = {
  ja: {
    subtitleText: 'Tower Defence of Hanoi',
    diffLabel: '難易度を選択',
    startBtn: 'START GAME',
    ruleTitle: 'ルール',
    rule1: '・左の柱からゴール柱へ全円盤を移動させよ',
    rule2: '・柱をクリックして移動元→移動先を選択（複数同時移動OK）',
    rule3: '・小さい円盤の上に大きい円盤は置けない',
    rule4: '・移動中の円盤がある柱へは別の円盤を発進できない',
    rule5: '・着地で砲弾発射 → UFOを撃墜！',
    rule6: '・砲弾が移動中の円盤に当たると爆発、円盤は出発地点へ戻る',
    rule7: '・UFOの爆弾が地面HPを削る。0でゲームオーバー',
    rankingEmpty: 'まだ記録がありません',
    moveHint: '柱をクリックして<span>移動元</span>を選択',
    nameInputPlaceholder: '名前を入力してランキング登録',
    saveBtn: '登録', saveBtnDone: '登録済み',
    retryBtn: 'もう一度',
    footAbout: 'MOMO Hanoi について',
    footDesc: 'MOMO Hanoi は、ブラウザで遊べる無料のハノイの塔パズルです。円盤の枚数を選び、すべての円盤を別の杭へ移して最少手数を目指します。アカウント登録もインストールも不要で、ブラウザだけですぐに遊べます。',
    footTop: 'MOMO Works トップ',
    footGames: 'ゲーム一覧',
    footTools: 'ツール一覧',
    poleLabel: '柱{n}',
    moveHintSelected: '柱{pole}の円盤<span>{disc}</span>を選択中 → <span>移動先の柱</span>をクリック',
    swapBan: 'その方向はスワップ禁止です',
    resultClear: 'CLEAR!',
    resultGameOver: 'GAME OVER',
    endClearMsg: '全円盤をゴール柱へ移動完了！',
    endGameOverMsg: 'HPが0になりました。',
    endKillsTpl: '撃墜 {kills} × {per}',
    endHpLeftTpl: 'HP残{hp} × {m}',
    endTimeBonusTpl: ' + タイムボーナス {n}',
    endMultiplierTpl: ' [×{n}倍]',
    nameDefault: '名無し',
  },
  en: {
    subtitleText: 'Tower Defence of Hanoi',
    diffLabel: 'Select Difficulty',
    startBtn: 'START GAME',
    ruleTitle: 'Rules',
    rule1: '· Move all discs from the left pole to the GOAL pole',
    rule2: '· Click a pole to select source → destination (multi-move OK)',
    rule3: '· You cannot place a larger disc on a smaller one',
    rule4: '· You cannot launch a disc to a pole that already has one incoming',
    rule5: '· Landing fires a shell → shoot down UFOs!',
    rule6: '· If a shell hits a moving disc, it explodes and returns to origin',
    rule7: '· UFO bombs drain Ground HP. Game over at 0',
    rankingEmpty: 'No records yet',
    moveHint: 'Click a pole to select <span>source</span>',
    nameInputPlaceholder: 'Enter name to register score',
    saveBtn: 'Register', saveBtnDone: 'Registered',
    retryBtn: 'Play Again',
    footAbout: 'About MOMO Hanoi',
    footDesc: 'MOMO Hanoi is a free Tower of Hanoi puzzle you can play in your browser. Choose the number of disks and move them all to another peg, aiming for the fewest moves. No account or installation required — just play instantly in your browser.',
    footTop: 'MOMO Works Home',
    footGames: 'Games',
    footTools: 'Tools',
    poleLabel: 'Pole {n}',
    moveHintSelected: 'Pole {pole} disc <span>{disc}</span> selected → click <span>destination</span>',
    swapBan: 'Swap in that direction is forbidden',
    resultClear: 'CLEAR!',
    resultGameOver: 'GAME OVER',
    endClearMsg: 'All discs moved to the goal pole!',
    endGameOverMsg: 'HP reached 0.',
    endKillsTpl: 'Kills {kills} × {per}',
    endHpLeftTpl: 'HP {hp} × {m}',
    endTimeBonusTpl: ' + Time Bonus {n}',
    endMultiplierTpl: ' [×{n}]',
    nameDefault: 'Anonymous',
  },
  zh: {
    subtitleText: '汉诺塔防',
    diffLabel: '选择难度',
    startBtn: 'START GAME',
    ruleTitle: '游戏规则',
    rule1: '・将左柱的所有圆盘移动到目标柱',
    rule2: '・点击柱子选择出发地→目的地（可同时移动多个）',
    rule3: '・不能将大圆盘放在小圆盘上',
    rule4: '・有圆盘正在移动的柱子不能再发出新的圆盘',
    rule5: '・圆盘落地时发射炮弹 → 击落UFO！',
    rule6: '・炮弹击中移动中的圆盘会爆炸，圆盘返回出发地',
    rule7: '・UFO炸弹会削减地面HP，降到0则游戏结束',
    rankingEmpty: '暂无记录',
    moveHint: '点击柱子选择<span>出发地</span>',
    nameInputPlaceholder: '输入名字以注册分数',
    saveBtn: '注册', saveBtnDone: '已注册',
    retryBtn: '再玩一次',
    footAbout: '关于 MOMO Hanoi',
    footDesc: 'MOMO Hanoi 是一款可在浏览器中免费游玩的汉诺塔益智游戏。选择圆盘数量，将所有圆盘移动到另一根柱子上，挑战最少步数。无需注册账号或安装，在浏览器中即可立即游玩。',
    footTop: 'MOMO Works 首页',
    footGames: '游戏列表',
    footTools: '工具列表',
    poleLabel: '{n}号柱',
    moveHintSelected: '柱{pole}的圆盘<span>{disc}</span>已选 → 点击<span>目标柱</span>',
    swapBan: '该方向禁止换位',
    resultClear: 'CLEAR!',
    resultGameOver: 'GAME OVER',
    endClearMsg: '所有圆盘已移至目标柱！',
    endGameOverMsg: 'HP已降为0。',
    endKillsTpl: '击落 {kills} × {per}',
    endHpLeftTpl: '剩余HP{hp} × {m}',
    endTimeBonusTpl: ' + 时间奖励 {n}',
    endMultiplierTpl: ' [×{n}倍]',
    nameDefault: '无名',
  },
};

// 案件⑦: 言語の「判定 / モード取得 / 切替(保存ルール)」は共通ルーチン MomoLang(/momo/lib/momo-lang/momo-lang.js)に集約。
//  ここはその呼び出し側。MomoLang未ロード時(file:// やネット不通)に備え最小限のfallbackだけ持つ。
//  catBase / applyLangHanoi / catSpeak はアプリ固有なのでここで保持。
const SUPPORTED_LANGS = ['ja','en','zh','cat'];
const LANG_APP_ID = 'hanoi';
function _langDetectFallback(){
  try{ const list=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||'en'];
    for(let i=0;i<list.length;i++){ const l=(list[i]||'').toLowerCase();
      if(l.indexOf('ja')===0)return'ja'; if(l.indexOf('zh')===0)return'zh'; if(l.indexOf('en')===0)return'en'; }
    return'en';
  }catch(e){return'ja';}
}
let catBase = 'ja';
let langMode    = window.MomoLang ? MomoLang.getMode(LANG_APP_ID) : 'auto';
let currentLang = window.MomoLang ? MomoLang.resolve(LANG_APP_ID)
                : (langMode==='auto' ? _langDetectFallback()
                   : (SUPPORTED_LANGS.includes(langMode) ? langMode : _langDetectFallback()));

// CAT (猫語) - キー種別ごとに語彙を切り替え。catBase=直前の言語で語彙を選ぶ。
function catSpeak(key) {
  const errorKeys = ['swapBan','endGameOverMsg','resultGameOver'];
  const calmKeys  = ['rankingEmpty','moveHint'];
  let vocab;
  if (catBase === 'en') {
    if (errorKeys.includes(key)) vocab = ['HISS!','SPIT!','FSSST!'];
    else if (calmKeys.includes(key)) vocab = ['purrrr...','mrrr...','prrr...'];
    else vocab = ['MEOW','meow','mrrrow','mew','NYA!'];
  } else if (catBase === 'zh') {
    if (errorKeys.includes(key)) vocab = ['嘶！','呸！','嘶嘶！'];
    else if (calmKeys.includes(key)) vocab = ['呼噜…','咕噜…','喵呼…'];
    else vocab = ['喵','喵喵','喵！','喵喵喵'];
  } else {
    if (errorKeys.includes(key)) vocab = ['シャー！','フーッ！','シャシャシャ！'];
    else if (calmKeys.includes(key)) vocab = ['ごろごろ…','にゃ…','むーにゃ…'];
    else vocab = ['にゃ','にゃー','にゃ！','みゃ','にゃにゃ！'];
  }
  return vocab[Math.floor(Math.random() * vocab.length)];
}

function t(key, params) {
  let s;
  if (currentLang === 'cat') s = catSpeak(key);
  else s = (I18N_HANOI[currentLang] || I18N_HANOI.ja)[key] ?? I18N_HANOI.ja[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] !== undefined ? params[k] : m);
  return s;
}

function applyLangHanoi() {
  const subEl = document.getElementById('subtitle');
  if (subEl) {
    // subtitle はブランド表記なので CAT 時も catBase の本来テキストを出す (Tilt の実装パターンに合わせる)
    const sLang = currentLang === 'cat' ? catBase : currentLang;
    const subMap = { ja:'Tower Defence of Hanoi', en:'Tower Defence of Hanoi', zh:'汉诺塔防' };
    subEl.textContent = subMap[sLang] || subMap.ja;
    subEl.classList.toggle('zh', sLang === 'zh');
  }
  document.getElementById('diff-label').textContent = t('diffLabel');
  document.getElementById('startBtn').textContent = t('startBtn');
  document.getElementById('rule-title').textContent = t('ruleTitle');
  for (let i = 1; i <= 7; i++) document.getElementById('rule'+i).textContent = t('rule'+i);
  document.querySelectorAll('.ranking-empty').forEach(el => el.textContent = t('rankingEmpty'));
  updateHint();
  document.getElementById('nameInput').placeholder = t('nameInputPlaceholder');
  const sb = document.getElementById('saveBtn');
  if (!sb.disabled) sb.textContent = t('saveBtn');
  document.getElementById('retryBtn').textContent = t('retryBtn');
  if (window.MomoAbout) MomoAbout.apply(currentLang);  // 説明欄（lib/momo-about.js）
  // ドロップダウンは langMode を表示 (auto を「Auto」として見せる)
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = langMode;
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hans'
    : (currentLang === 'cat' ? (catBase === 'zh' ? 'zh-Hans' : catBase) : currentLang);
}

function onLangChange(mode) {
  if (mode === 'cat' && currentLang !== 'cat') catBase = currentLang;
  langMode = mode;
  currentLang = window.MomoLang ? MomoLang.setMode(LANG_APP_ID, mode)
              : (mode === 'auto' ? _langDetectFallback()
                 : (SUPPORTED_LANGS.includes(mode) ? mode : _langDetectFallback()));
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = mode;
  applyLangHanoi();
}

applyLangHanoi();
// 初回ランキング描画は currentLang 初期化後に行う (renderRanking → t() → currentLang 参照のため)
renderRanking(document.getElementById('titleRanking'));
