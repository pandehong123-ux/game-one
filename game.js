/* 运河智运大冒险 — 无依赖 Canvas 2D 游戏。
 * 扩展关卡：在 LEVELS 中添加配置；地图、实体、绘制和界面分别管理。
 * 所有时间基于秒，逻辑不依赖屏幕刷新率；文件协议下无需 fetch。
 */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
const W=950,H=750,T=38,OX=38,OY=57,COLS=23,ROWS=17;
const DIRS={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
const LEVELS=[
 {name:'古运河启航',city:'杭州运河区域',code:'HANGZHOU',goal:20,cargo:0,reward:200,bots:['patrol'],title:'让智慧点亮运河',text:'沿运河航行，收集散落在水道中的智慧物流芯片。',fact:'京杭大运河全长约 1,800 公里，是世界上里程最长的古代运河。'},
 {name:'智慧港调度',city:'苏州智慧港区域',code:'SUZHOU',goal:30,cargo:4,reward:350,bots:['patrol','chase'],title:'每一份货物，聪明抵达',text:'收集30个芯片，拾取4箱货物并返回左下角智慧港交付。',fact:'古代运河上的漕运将粮食运往各地，今天的 AI 调度让运输路线更加高效。'},
 {name:'未来物流港',city:'北京未来港区域',code:'BEIJING',goal:40,cargo:6,reward:500,bots:['patrol','chase','random'],title:'连接未来智慧物流',text:'收集40个芯片，将6箱货物送回智慧港，完成最终航段。',fact:'智慧港利用人工智能、自动机械臂和绿色能源，减少等待时间与运输能耗。'}
];
const COLORS={patrol:'#f0bc7b',chase:'#ed95aa',random:'#b9a4ed'};
const state={mode:'intro',level:0,score:0,totalDelivered:0,lives:3,elapsed:0,time:0,boost:0,invincible:0,chips:0,carried:0,delivered:0,sound:false,particles:[],items:[],bots:[],checkpoint:null};
let grid=[],player,queued=null,lastTime=0,toastTimer,audio=null,previousMode='intro';
const base={x:1,y:15};
const key=(x,y)=>`${x},${y}`;
const center=(x,y)=>({x:OX+(x+.5)*T,y:OY+(y+.5)*T});
const walk=(x,y)=>!!grid[y]?.[x];
const neighbors=(x,y)=>Object.values(DIRS).map(d=>({x:x+d.x,y:y+d.y})).filter(p=>walk(p.x,p.y));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function makeMap(level){
 grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
 for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++){
  if([1,5,9,13,15].includes(y)||[1,5,9,13,17,21].includes(x))grid[y][x]=1;
 }
 // 新航段打开支流，保留可预测的主干水网。
 if(level>=1)for(let x=5;x<=13;x++)grid[3][x]=1;
 if(level>=2)for(let x=13;x<=21;x++)grid[7][x]=1;
}
function entity(x,y,type){return {x,y,fromX:x,fromY:y,toX:x,toY:y,progress:1,dir:'right',type,prev:null};}
function loadLevel(index,reset=false){
 state.level=index;makeMap(index);
 if(reset){state.score=0;state.totalDelivered=0;state.lives=3;state.elapsed=0;}
 state.checkpoint={score:state.score,totalDelivered:state.totalDelivered,lives:state.lives,elapsed:state.elapsed};
 state.chips=0;state.carried=0;state.delivered=0;state.boost=0;state.invincible=3;state.particles=[];queued=null;
 player=entity(base.x,base.y,'player');state.items=[];
 const cells=[];
 for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++)if(walk(x,y)&&key(x,y)!==key(base.x,base.y))cells.push({x,y});
 const batteries=[{x:1,y:1},{x:21,y:13},{x:9,y:5}];
 const cargo=[{x:21,y:1},{x:13,y:5},{x:5,y:1},{x:21,y:9},{x:9,y:13},{x:17,y:1}].slice(0,LEVELS[index].cargo);
 const special=new Set([...batteries,...cargo].map(p=>key(p.x,p.y)));
 cells.forEach((p,i)=>{if(!special.has(key(p.x,p.y))&&i%2===0)state.items.push({...p,type:'chip',seed:i*.83});});
 batteries.forEach(p=>state.items.push({...p,type:'battery',seed:p.x}));cargo.forEach(p=>state.items.push({...p,type:'cargo',seed:p.x}));
 const spawns=[{x:21,y:1},{x:17,y:9},{x:9,y:1}];
 state.bots=LEVELS[index].bots.map((type,i)=>({...entity(spawns[i].x,spawns[i].y,type),routeIndex:0,route:[{x:21,y:1},{x:21,y:13},{x:13,y:13},{x:13,y:1}]}));
 updateUI();
}
function updateUI(){
 const level=LEVELS[state.level];
 $('score').textContent=state.score.toLocaleString('zh-CN');$('delivered').textContent=state.totalDelivered;
 $('lives').textContent='♥ '.repeat(state.lives)+'♡ '.repeat(3-state.lives);$('lives').setAttribute('aria-label',`${state.lives}条生命`);
 $('objectiveCount').textContent=`${Math.min(state.chips,level.goal)} / ${level.goal}`;$('missionProgress').style.width=Math.min(100,state.chips/level.goal*100)+'%';
 $('missionTitle').textContent=level.title;$('missionDescription').textContent=level.text;$('missionNumber').textContent=`0${state.level+1} / 03`;$('rewardLabel').textContent=level.reward;
 $('mapName').textContent=level.city;$('mapCode').textContent=`${level.code} / SECTOR 0${state.level+1}`;$('cultureText').textContent=level.fact;
 $('cargoLabel').textContent=`${state.carried} 箱`;$('deliveryObjective').hidden=!level.cargo;$('deliveryObjective').textContent=`▣ 已交付 ${state.delivered} / ${level.cargo} 箱 · 船载 ${state.carried}`;
 document.querySelectorAll('.level-card').forEach((el,i)=>{el.className='level-card '+(i===state.level?'active':i>state.level?'locked':'complete');el.querySelector('small').innerHTML=i===state.level?'当前航段 <b>●</b>':i<state.level?'航段已完成 <b>✓</b>':'完成上一航段解锁 <b>⌑</b>';});
 $('pauseButton').disabled=!['playing','paused'].includes(state.mode);$('pauseButton').textContent=state.mode==='paused'?'▷':'Ⅱ';
}
function showModal(kind){
 const level=LEVELS[state.level];let content='';
 if(kind==='intro')content=`<div class="modal-kicker">WELCOME ABOARD / 01</div><div class="modal-emblem">⌁</div><h2>少年指挥官，请登舰</h2><p>千年运河，一场新的冒险。<br>驾驶「运小智」，开启你的智慧物流航程。</p><div class="briefing"><div><strong>03</strong><span>探索航段</span></div><div><strong>20</strong><span>首关芯片目标</span></div><div><strong>♥ ♥ ♥</strong><span>船体生命</span></div></div><button class="primary-button" data-action="start">开启航程　 →</button><div class="modal-hint">方向键 / WASD 驾驶 · 空格暂停 · 支持触屏</div>`;
 if(kind==='paused')content=`<div class="modal-kicker">NAVIGATION PAUSED</div><div class="modal-emblem">Ⅱ</div><h2>靠岸休息片刻</h2><p>航程已暂停，所有船只和计时均已停止。<br>准备好继续探索了吗？</p><button class="primary-button" data-action="resume">继续航行　 →</button><button class="secondary-button" data-action="restart">重新挑战本航段</button>`;
 if(kind==='help')content=`<div class="modal-kicker">CAPTAIN'S HANDBOOK</div><h2>无人船航行指南</h2><ul class="help-list"><li>方向键 / WASD / 屏幕按钮驾驶；提前按键可预约转弯，船会持续航行。</li><li>芯片每枚 +10 智慧值；三关目标分别为20、30、40枚。</li><li>第二关交付4箱，第三关交付6箱。货箱拾取后需回到左下角「智慧港」。</li><li>能量电池加速6秒；加速不等于无敌。</li><li>黄色机器人定线巡逻，粉色追踪，紫色随机巡航。碰撞扣1条生命，回港后保护3秒。</li><li>空格 / P 暂停；生命耗尽可重试当前关。</li></ul><button class="primary-button" data-action="closeHelp">明白，指挥官已就位</button>`;
 if(kind==='over')content=`<div class="modal-kicker">MISSION INTERRUPTED</div><div class="modal-emblem">⚑</div><h2>无人船需要检修</h2><p>别气馁，优秀的指挥官也需要练习。<br>重试将恢复本航段初始积分和3条生命。</p><div class="briefing"><div><strong>${state.score}</strong><span>本次智慧值</span></div><div><strong>${state.chips} / ${level.goal}</strong><span>本航段芯片</span></div></div><button class="primary-button" data-action="retry">整装再出发　 ↻</button><button class="secondary-button" data-action="home">返回启航界面</button>`;
 if(kind==='win'||kind==='complete')content=`<div class="modal-kicker">${kind==='complete'?'ALL MISSIONS ACCOMPLISHED':'SECTOR COMPLETE / 0'+(state.level+1)}</div><div class="modal-emblem">✦</div><h2>${kind==='complete'?'未来物流，由你连接':'航段任务圆满完成'}</h2><p>${kind==='complete'?'恭喜获得「AI物流小先锋」称号！<br>10箱货物已送达，千年运河因你焕新。':level.name+' 已完成。<br>下一站，探索更高效的智慧物流网络。'}</p><div class="briefing"><div><strong>${state.score}</strong><span>累计智慧值</span></div><div><strong>+${level.reward}</strong><span>通关奖励已到账</span></div><div><strong>${state.totalDelivered}</strong><span>已交付货物</span></div></div><button class="primary-button" data-action="${kind==='complete'?'again':'next'}">${kind==='complete'?'再启新航程　 ↻':'前往下一航段　 →'}</button>`;
 $('modal').innerHTML=content;$('overlay').hidden=false;
 document.getElementById("modal").querySelector("h2").id="modalTitle";
 requestAnimationFrame(()=>$('modal').querySelector('button')?.focus({preventScroll:true}));
}
function play(){state.mode='playing';$('overlay').hidden=true;updateUI();canvas.focus({preventScroll:true});}
function pause(){if(state.mode==='playing'){state.mode='paused';showModal('paused');updateUI();}else if(state.mode==='paused')play();}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function beep(freq=650,duration=.07){if(!state.sound)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.type='sine';o.frequency.setValueAtTime(freq,audio.currentTime);g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.start();o.stop(audio.currentTime+duration);}catch{}}
function burst(x,y,color,count=12){const p=center(x,y);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=20+Math.random()*85;state.particles.push({x:p.x,y:p.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,max:1,color});}}
function collect(){
 for(let i=state.items.length-1;i>=0;i--){const item=state.items[i];if(item.x!==player.x||item.y!==player.y)continue;state.items.splice(i,1);
  if(item.type==='chip'){state.chips++;state.score+=10;burst(item.x,item.y,'#82efd0',8);beep(720+state.chips%5*80);}
  if(item.type==='cargo'){state.carried++;burst(item.x,item.y,'#f2c87e',14);toast(`已装载货箱 × ${state.carried} · 返回左下角智慧港交付`);beep(430,.15);}
  if(item.type==='battery'){state.boost=6;burst(item.x,item.y,'#82dfff',18);toast('AI 动力增强 · 6 秒加速，注意避让机器人');beep(980,.15);}
 }
 if(player.x===base.x&&player.y===base.y&&state.carried){const n=state.carried;state.delivered+=n;state.totalDelivered+=n;state.score+=n*50;state.carried=0;burst(base.x,base.y,'#f6d493',30);toast(`交付成功！${n} 箱货物已入库 · +${n*50} 智慧值`);beep(1100,.25);}
 const level=LEVELS[state.level];
 if(state.chips>=level.goal&&state.delivered>=level.cargo){state.score+=level.reward;state.mode=state.level===2?'complete':'win';for(let i=0;i<12;i++)burst(2+Math.random()*19,2+Math.random()*12,['#7af4c4','#e9d09b','#8dcced'][i%3],15);showModal(state.mode);beep(880,.4);}
 updateUI();
}
// 广度优先寻路：机器人不穿墙，追踪目标始终在合法水道上。
function pathStep(start,target){const q=[{x:start.x,y:start.y,first:null}],seen=new Set([key(start.x,start.y)]);for(let i=0;i<q.length;i++){const cur=q[i];if(cur.x===target.x&&cur.y===target.y)return cur.first;for(const n of neighbors(cur.x,cur.y)){const k=key(n.x,n.y);if(!seen.has(k)){seen.add(k);q.push({...n,first:cur.first||n});}}}return null;}
function chooseBot(bot){
 if(bot.type==='chase')return pathStep(bot,{x:player.toX,y:player.toY});
 if(bot.type==='patrol'){let target=bot.route[bot.routeIndex];if(bot.x===target.x&&bot.y===target.y){bot.routeIndex=(bot.routeIndex+1)%bot.route.length;target=bot.route[bot.routeIndex];}return pathStep(bot,target);}
 let options=neighbors(bot.x,bot.y).filter(p=>!bot.prev||p.x!==bot.prev.x||p.y!==bot.prev.y);if(!options.length)options=neighbors(bot.x,bot.y);return options[Math.floor(Math.random()*options.length)];
}
function moveEntity(e,dt,speed,isPlayer=false){
 if(e.progress>=1){
  let next;
  if(isPlayer){if(queued&&walk(e.x+DIRS[queued].x,e.y+DIRS[queued].y)){e.dir=queued;queued=null;}const d=DIRS[e.dir];if(!e.started&&!e.forceStart)return;next={x:e.x+d.x,y:e.y+d.y};if(!walk(next.x,next.y))return;e.started=true;}
  else next=chooseBot(e);
  if(!next)return;e.prev={x:e.x,y:e.y};e.fromX=e.x;e.fromY=e.y;e.toX=next.x;e.toY=next.y;e.progress=0;
  if(!isPlayer)e.dir=next.x>e.x?'right':next.x<e.x?'left':next.y>e.y?'down':'up';
 }
 e.progress=Math.min(1,e.progress+dt*speed);
 if(e.progress>=1){e.x=e.toX;e.y=e.toY;if(isPlayer)collect();}
}
function position(e){return {x:e.fromX+(e.toX-e.fromX)*e.progress,y:e.fromY+(e.toY-e.fromY)*e.progress};}
function hit(){
 state.lives--;state.boost=0;burst(position(player).x,position(player).y,'#f293a2',28);beep(140,.3);
 if(state.lives<=0){state.mode='over';showModal('over');}else{player=entity(base.x,base.y,'player');queued=null;state.invincible=3;toast('船体受损 −1 ♥ · 已回港，获得 3 秒保护（货物保留）');}
 updateUI();
}
function update(dt){
 state.time+=dt;
 if(state.mode==='playing'){
  state.elapsed+=dt;state.boost=Math.max(0,state.boost-dt);state.invincible=Math.max(0,state.invincible-dt);
  moveEntity(player,dt,state.boost>0?6.3:4.1,true);
  if(state.mode==='playing'){
   state.bots.forEach(b=>moveEntity(b,dt,b.type==='chase'?2.25:b.type==='random'?2.05:2.5));
   if(!state.invincible&&state.bots.some(b=>distance(position(player),position(b))<.62))hit();
  }
 }
 // 庆祝粒子在通关对话框背后继续播放；暂停时动画冻结。
 if(!['paused','help'].includes(state.mode))state.particles=state.particles.filter(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=18*dt;return p.life>0;});
 $('speedLabel').textContent=state.boost>0?`加速 ${state.boost.toFixed(1)}s`:'标准巡航';$('boostBar').style.width=state.boost>0?`${state.boost/6*100}%`:'35%';
 $('clock').textContent=`${String(Math.floor(state.elapsed/60)).padStart(2,'0')}:${String(Math.floor(state.elapsed%60)).padStart(2,'0')}`;
}
// ─── Canvas 美术：水道 / 城市 / 古桥 / 机械臂 / 无人船 ───
function rect(x,y,w,h,fill,r=0,stroke=null){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function line(points,color,width=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function polygon(points,fill,stroke){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function text(str,x,y,size=10,color='#9bbab8',align='center'){ctx.font=`${size}px "Microsoft YaHei", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(str,x,y);}
function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function building(x,y,w,h,type,seed){
 // 伪等距屋顶搭配立面，避免单一方块建筑。
 ctx.save();ctx.translate(x,y);const ht=10+(seed%3)*4;
 rect(-w/2-4,-h/2+3,w+9,h+ht+5,'#06182070',5);
 polygon([[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]],type==='old'?'#8b8b79':'#527177','#6b8986');
 polygon([[-w/2,h/2],[w/2,h/2],[w/2,h/2+ht],[-w/2,h/2+ht]],'#304c52','#47646a');
 for(let i=0;i<Math.floor(w/9);i++)rect(-w/2+4+i*9,h/2+3,4,4,seed%2?'#7bbba688':'#d5ba7788',1);
 if(type==='old'){
  polygon([[-w/2-5,-h/2+2],[0,-h/2-12],[w/2+5,-h/2+2],[w/2-1,h/2-2],[-w/2+1,h/2-2]],'#627b78','#91a291');
  line([[-w/2-5,-h/2+2],[0,-h/2-12],[w/2+5,-h/2+2]],'#b2b29a',2);
  for(let i=1;i<5;i++)line([[-w/2+3,-h/2+i*4],[w/2-3,-h/2+i*4]],'#425e6088');
 }else if(type==='solar'){
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){rect(-w/2+3+i*(w-6)/3,-h/2+3+j*(h-6)/2,(w-9)/3,(h-9)/2,'#24536a',1,'#6ba2ad');}
 }else{
  rect(-w/2+5,-h/2+4,w-10,h-8,'#233e4a',2,'#829b96');
  for(let i=0;i<3;i++)line([[-w/2+9,-h/2+8+i*6],[w/2-9,-h/2+8+i*6]],'#5b8b91',2);
  if(type==='ai'){rect(-12,-10,24,20,'#346e71',4,'#80dbbd');text('AI',0,4,12,'#9ceacc');line([[0,-11],[0,-23]],'#88bcb2',2);circle(0,-24,3,'#7de4b5');}
 }
 ctx.restore();
}
function tree(x,y,seed){rect(x-1,y,3,8,'#6e7660');circle(x,y-2,7,'#2d5650');circle(x-2,y-4,5,seed%2?'#486b57':'#3c6c5b');circle(x+3,y-3,3,'#64816a');}
function crane(x,y,time){ctx.save();ctx.translate(x,y);rect(-8,2,16,10,'#45666b',3,'#71958d');line([[0,3],[0,-23],[21,-36],[39,-22]],'#d0b980',5);line([[0,3],[0,-23],[21,-36],[39,-22]],'#8b886b',2);const sway=Math.sin(time*1.5)*4;line([[39,-22],[39+sway,-5]],'#91bab0',1.5);line([[34+sway,-5],[34+sway,0],[44+sway,0],[44+sway,-5]],'#d4c28a',2);circle(0,-23,4,'#658a7d','#c9c890');circle(21,-36,4,'#658a7d','#c9c890');ctx.restore();}
function drawMap(t){
 const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#102c34');bg.addColorStop(1,'#0a222b');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
 ctx.strokeStyle='#5c96800a';ctx.lineWidth=1;for(let x=0;x<W;x+=19){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}for(let y=0;y<H;y+=19){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
 rect(OX-5,OY-5,COLS*T+10,ROWS*T+10,'#1c3b3d',13,'#48635c');
 for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
  const px=OX+x*T,py=OY+y*T;
  if(walk(x,y)){
   rect(px,py,T,T,'#123e47');
   const d=ctx.createLinearGradient(px,py,px+T,py+T);d.addColorStop(0,'#1d566055');d.addColorStop(1,'#14374122');rect(px,py,T,T,d);
   for(const dir of Object.values(DIRS))if(!walk(x+dir.x,y+dir.y)){
    if(dir.x){const xx=px+(dir.x>0?T-1:1);line([[xx,py],[xx,py+T]],'#76927b',2);line([[xx-dir.x*3,py],[xx-dir.x*3,py+T]],'#2c5e59',2);}
    else{const yy=py+(dir.y>0?T-1:1);line([[px,yy],[px+T,yy]],'#76927b',2);line([[px,yy-dir.y*3],[px+T,yy-dir.y*3]],'#2c5e59',2);}
   }
   const wave=(t*9+x*13+y*7)%28;line([[px+5,py+wave+3],[px+12,py+wave+2],[px+19,py+wave+3]],'#6aada21b');
  }else{
   rect(px,py,T,T,((x+y)%3===0)?'#254340':'#223f3d');
   if((x*3+y*7)%11===0)tree(px+18,py+19,x+y);
  }
 }
 // 航线数据脉冲沿主河道流动。
 ctx.save();ctx.setLineDash([3,14]);ctx.lineDashOffset=-t*15;[1,9,15].forEach(y=>{const a=center(1,y),b=center(21,y);line([[a.x,a.y],[b.x,b.y]],'#72c7b523',1);});ctx.restore();
 // 岛状城市街区：每个街区都有不同的立体设施。
 const cityRows=[3,7,11];
 cityRows.forEach((gy,ri)=>[3,7,11,15,19].forEach((gx,ci)=>{
  if(walk(gx,gy))return;
  const p=center(gx,gy),seed=ri*5+ci,type=ci===0?'old':ci===2?'ai':ci===3?'solar':'modern';
  rect(p.x-49,p.y-42,98,89,'#304c4540',8,'#3d5b4b');
  if(type==='ai'){building(p.x,p.y-7,53,39,'ai',seed);circle(p.x,p.y+13,38,'#81eac405','#609f7633');}
  else{building(p.x-15,p.y-14,42,30,type,seed);building(p.x+20,p.y+14,35,27,type,seed+1);}
  tree(p.x-37,p.y+23,ci);tree(p.x+35,p.y-28,ri);
  const labels=[['拱宸桥街区','杭州仓储','AI 物流中心','绿色能源站','城市配送站'],['运河人家','数字仓库','航运数据站','光伏社区','智能制造'],['古埠码头','港口仓储','物流云中心','绿色动力','未来智造']];
  text(labels[ri][ci],p.x,p.y+45,9,'#a9b9a1');
  if((ci===4&&ri>0)||state.level===2&&ci===1)crane(p.x+24,p.y+6,t+ci);
 }));
 // 古桥只跨越水面，不阻挡船舶。栏杆留出中央透明空间。
 [{x:5,y:7},{x:17,y:3},{x:9,y:11}].forEach(({x,y},i)=>{
  const p=center(x,y);rect(p.x-27,p.y-11,54,22,'#b7ad8930',3);line([[p.x-29,p.y-13],[p.x-20,p.y-17],[p.x+20,p.y-17],[p.x+29,p.y-13]],'#a7a78b',3);line([[p.x-29,p.y+13],[p.x-20,p.y+17],[p.x+20,p.y+17],[p.x+29,p.y+13]],'#a7a78b',3);
  for(let k=-24;k<=24;k+=8){line([[p.x+k,p.y-16],[p.x+k,p.y-9]],'#c3b994',2);line([[p.x+k,p.y+9],[p.x+k,p.y+16]],'#c3b994',2);}if(i===0)text('拱宸桥',p.x,p.y-23,8,'#c4b990');
 });
 const bp=center(base.x,base.y);circle(bp.x,bp.y,23+Math.sin(t*2)*2,'#81d6b51a','#7bdcaa77');
 rect(bp.x-19,bp.y+20,80,15,'#375952',3,'#9ba681');for(let i=0;i<5;i++)line([[bp.x-15+i*16,bp.y+22],[bp.x-15+i*16,bp.y+32]],'#8f9c76');text('智慧港 · 交付区',bp.x+72,bp.y+31,11,'#b3dfb2','left');
 text('京 杭 大 运 河',center(11,15).x,center(11,15).y+29,13,'#7bad9b');
 text('N',W-24,83,10,'#98b8ae');line([[W-24,93],[W-24,122]],'#87a898');polygon([[W-24,93],[W-29,104],[W-24,102],[W-19,104]],'#87a898');
 // 最后一关远端无人船队作为背景装饰，不参与碰撞。
 if(state.level===2)for(let i=0;i<3;i++){const x=310+((t*16+i*90)%350);ctx.globalAlpha=.6;drawShip(x,OY+14*T+T/2,'right',t,false,.45);ctx.globalAlpha=1;}
}
function drawItem(item,t){const p=center(item.x,item.y),pulse=.6+Math.sin(t*3+item.seed)*.25;ctx.save();ctx.translate(p.x,p.y);ctx.shadowBlur=10;ctx.shadowColor=item.type==='chip'?'#77f2cb':item.type==='cargo'?'#d6b575':'#6dbbe1';
 if(item.type==='chip'){circle(0,0,6+pulse*2,'#7aead318');polygon([[0,-5],[5,0],[0,5],[-5,0]],'#99e8c2','#d5f9cb');circle(0,0,1.5,'#ecffe7');}
 else if(item.type==='cargo'){ctx.shadowBlur=6;polygon([[-9,-5],[0,-10],[9,-5],[9,6],[0,11],[-9,6]],'#bd9561','#f1d090');polygon([[-9,-5],[0,0],[9,-5],[0,-10]],'#e8c68b');line([[0,0],[0,11]],'#7e633e');line([[-4,-8],[5,-3],[5,2]],'#f4dfae',2);}
 else{rect(-7,-10,14,21,'#1e5c69',3,'#96e6eb');rect(-3,-13,6,3,'#9ae3dc',1);polygon([[2,-7],[-4,1],[0,1],[-2,7],[5,-2],[1,-2]],'#baf1cf');}
 ctx.restore();}
function drawShip(x,y,dir,t,protectedShip=false,scale=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.rotate({right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2}[dir]);
 ctx.shadowBlur=12;ctx.shadowColor='#7ef6d855';
 for(let i=0;i<3;i++){const length=10+((t*35+i*7)%23);line([[-16,-5+i*5],[-16-length,-5+i*5]],'#74dbc1'+(i===1?'88':'44'),2);}
 ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(0,3,24,15,0,0,Math.PI*2);ctx.fillStyle='#031c2855';ctx.fill();
 polygon([[-19,-11],[10,-11],[23,0],[10,11],[-19,11],[-22,6],[-22,-6]],'#357a90','#95e5e3');
 polygon([[-15,-8],[9,-8],[18,0],[9,8],[-15,8]],'#bbe2db');rect(-9,-6,16,12,'#214958',3,'#51c5ca');rect(-5,-4,8,8,'#4a95ac',2);line([[-17,-11],[9,-11],[19,-3]],'#9efbdf',2);rect(-20,-7,3,14,'#72d6c3',1);circle(11,0,2,'#efffdc');
 if(protectedShip){ctx.setLineDash([4,4]);circle(0,0,28,'#a1f1da09','#a1f1da99');ctx.setLineDash([]);}ctx.restore();}
function drawRobot(bot,t){const p=position(bot),c=center(p.x,p.y),col=COLORS[bot.type];ctx.save();ctx.translate(c.x,c.y+Math.sin(t*4+p.x)*1.5);circle(0,2,19,'#06192366');ctx.shadowColor=col;ctx.shadowBlur=8;rect(-12,-10,24,20,'#34454e',7,col);ctx.shadowBlur=0;rect(-8,-5,16,7,'#14232e',3);circle(-4,-2,2,col);circle(4,-2,2,col);line([[0,-10],[0,-16]],col,1);circle(0,-17,2,col);rect(-16,-3,4,10,col,2);rect(12,-3,4,10,col,2);line([[-5,7],[5,7]],col,2);ctx.strokeStyle=col+'33';ctx.beginPath();ctx.ellipse(0,15,16+Math.sin(t*3)*2,4,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
function render(){ctx.clearRect(0,0,W,H);const t=['paused','help'].includes(state.mode)?frozenTime:state.time;drawMap(t);state.items.forEach(item=>drawItem(item,t));state.bots.forEach(b=>drawRobot(b,t));const p=position(player),c=center(p.x,p.y);if(!state.invincible||Math.floor(t*8)%2===0||state.mode!=='playing')drawShip(c.x,c.y,player.dir,t,state.invincible>0);state.particles.forEach(p=>{ctx.globalAlpha=p.life/p.max;circle(p.x,p.y,2,p.color);});ctx.globalAlpha=1;}
let frozenTime=0;
function frame(now){const dt=Math.min((now-lastTime)/1000||0,.04);lastTime=now;if(['paused','help'].includes(state.mode)){}else frozenTime=state.time;update(dt);render();requestAnimationFrame(frame);}
function steer(dir){if(state.mode!=='playing')return;queued=dir;player.forceStart=true;beep(250,.025);}
$('modal').addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
 if(action==='start'){play();toast('启航！收集20枚芯片 · 留意黄色巡逻机器人');}
 if(action==='resume')play();
 if(action==='next'){loadLevel(state.level+1);play();toast('新航段已开启 · 拾取货物后记得返回智慧港');}
 if(action==='again'){loadLevel(0,true);play();}
 if(action==='retry'||action==='restart'){const checkpoint={...state.checkpoint};state.score=checkpoint.score;state.totalDelivered=checkpoint.totalDelivered;state.lives=action==='retry'?3:checkpoint.lives;state.elapsed=checkpoint.elapsed;loadLevel(state.level);play();}
 if(action==='home'){loadLevel(0,true);state.mode='intro';showModal('intro');updateUI();}
 if(action==='closeHelp'){state.mode=previousMode;if(state.mode==='playing')play();else showModal(state.mode);updateUI();}
});
$('pauseButton').addEventListener('click',pause);
$('helpButton').addEventListener('click',()=>{if(state.mode==='help')return;previousMode=state.mode;frozenTime=state.time;state.mode='help';showModal('help');updateUI();});
$('soundButton').addEventListener('click',()=>{state.sound=!state.sound;$('soundButton').textContent=state.sound?'♫ 音效开':'♫ 音效关';$('soundButton').setAttribute('aria-pressed',String(state.sound));beep();});
window.addEventListener('keydown',e=>{const dir={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right'}[e.key]||{w:'up',s:'down',a:'left',d:'right'}[e.key.toLowerCase()];if(dir&&state.mode==='playing'){e.preventDefault();steer(dir);}if((e.code==='Space'||e.code==='KeyP')&&['playing','paused'].includes(state.mode)&&!e.repeat){e.preventDefault();frozenTime=state.time;pause();}if(e.key==='Escape'&&state.mode==='playing')pause();});
// 模态框焦点循环，键盘用户不会误操作背景控件。
$('overlay').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const buttons=[...$('modal').querySelectorAll('button')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
document.querySelectorAll('[data-dir]').forEach(button=>button.addEventListener('pointerdown',e=>{e.preventDefault();steer(button.dataset.dir);}));
let touchStart=null;canvas.addEventListener('pointerdown',e=>{touchStart={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointerup',e=>{if(!touchStart)return;const dx=e.clientX-touchStart.x,dy=e.clientY-touchStart.y;if(Math.hypot(dx,dy)>10)steer(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');touchStart=null;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing'){frozenTime=state.time;pause();}});
window.addEventListener('blur',()=>{if(state.mode==='playing'){frozenTime=state.time;pause();}});
loadLevel(0,true);showModal('intro');requestAnimationFrame(frame);
})();



// 全屏必须由用户点击触发；不支持时保留铺满浏览器的自适应布局。
(() => {
 const button=document.getElementById('fullscreenButton');
 button.addEventListener('click',async()=>{
  try{
   if(document.fullscreenElement)await document.exitFullscreen();
   else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
   else{button.textContent='请使用浏览器全屏';return;}
  }catch{button.textContent='请按 F11 全屏';}
 });
 document.addEventListener('fullscreenchange',()=>{
  const active=!!document.fullscreenElement;
  button.textContent=active?'⛶ 退出全屏':'⛶ 全屏';
  button.setAttribute('aria-pressed',String(active));
 });
})();
