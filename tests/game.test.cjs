// 无第三方依赖的逻辑回归测试：node tests/game.test.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const noop=()=>{};
const ctx=new Proxy({}, {get:(o,k)=>k==='createLinearGradient'?()=>({addColorStop:noop}):noop,set:()=>true});
const els=new Map();
function element(){return {style:{},classList:{add:noop,remove:noop},setAttribute:noop,addEventListener:noop,focus:noop,querySelector:()=>element(),querySelectorAll:()=>[],getContext:()=>ctx};}
const sandbox={console,Math,Set,document:{getElementById:id=>{if(!els.has(id))els.set(id,element());return els.get(id);},querySelectorAll:()=>[],addEventListener:noop},window:{addEventListener:noop},requestAnimationFrame:noop,setTimeout:noop,clearTimeout:noop};
let source=fs.readFileSync('game.js','utf8');source=source.replace('loadLevel(0,true);showModal', 'globalThis.testAPI={state,loadLevel,collect,walk,neighbors,pathStep,hit,play,update,render,steer,moveEntity,getPlayer:()=>player,setPlayer:p=>player=p,entity};loadLevel(0,true);showModal');
vm.createContext(sandbox);vm.runInContext(source,sandbox);const a=sandbox.testAPI;
for(let level=0;level<3;level++){
 a.loadLevel(level,true);a.play();
 const visited=new Set(['1,15']),queue=[{x:1,y:15}];for(let i=0;i<queue.length;i++)for(const p of a.neighbors(queue[i].x,queue[i].y)){const k=`${p.x},${p.y}`;if(!visited.has(k)){visited.add(k);queue.push(p);}}
 for(const item of a.state.items)assert(visited.has(`${item.x},${item.y}`),'物品必须可达');
 assert(a.state.items.filter(x=>x.type==='chip').length>=[20,30,40][level]);
 assert.equal(a.state.items.filter(x=>x.type==='cargo').length,[0,4,6][level]);
 a.render();
 a.steer('up');const startY=a.getPlayer().y;for(let i=0;i<25;i++)a.update(.02);assert(a.getPlayer().y<startY,'输入应驱动无人船');
 a.loadLevel(level,true);a.play();
 for(const item of [...a.state.items].filter(x=>x.type==='cargo')){a.setPlayer(a.entity(item.x,item.y,'player'));a.collect();}
 assert.equal(a.state.carried,[0,4,6][level]);assert.equal(a.state.delivered,0);
 a.setPlayer(a.entity(1,15,'player'));a.collect();assert.equal(a.state.delivered,[0,4,6][level]);assert.equal(a.state.carried,0);
 for(const item of [...a.state.items].filter(x=>x.type==='chip').slice(0,[20,30,40][level])){a.setPlayer(a.entity(item.x,item.y,'player'));a.collect();}
 assert.equal(a.state.mode,level===2?'complete':'win');
 console.log(`PASS 航段 ${level+1}: ${visited.size} 个连通水道格、物品可达、移动、交付与通关`);
}
a.loadLevel(0,true);a.play();const battery=a.state.items.find(x=>x.type==='battery');a.setPlayer(a.entity(battery.x,battery.y,'player'));a.collect();assert.equal(a.state.boost,6);a.update(.1);assert(a.state.boost<6);a.hit();assert.equal(a.state.lives,2);assert.equal(a.getPlayer().x,1);assert.equal(a.state.invincible,3);a.hit();a.hit();assert.equal(a.state.mode,'over');
a.loadLevel(0,true);a.play();a.state.mode='paused';const elapsed=a.state.elapsed;a.update(1);assert.equal(a.state.elapsed,elapsed);
console.log('PASS 电池倒计时、碰撞扣血、回港保护、失败弹窗、暂停计时');
