// 无头冒烟测试：在 Node 中用 DOM 桩运行游戏脚本，验证经济/战斗/超武/占领/存档
'use strict';
const fs=require('fs');
const file=process.argv[2];
const html=fs.readFileSync(file,'utf8');
const m=html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
if(!m){ console.error('FAIL: script block not found'); process.exit(1); }
const code=m[1];

const ctxStub=new Proxy({},{
  get(t,p){
    if(p==='createRadialGradient') return ()=>({addColorStop(){}});
    if(p==='createLinearGradient') return ()=>({addColorStop(){}});
    if(p==='createImageData') return (w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
    if(p==='measureText') return ()=>({width:10});
    if(p in t) return t[p];
    return ()=>{};
  },
  set(t,p,v){ t[p]=v; return true; }
});
const els={};
function makeEl(id){
  return {
    id, style:{}, classList:{add(){},remove(){},toggle(){}},
    children:[], innerHTML:'', textContent:'', disabled:false, value:'valley', width:0, height:0,
    appendChild(c){ this.children.push(c); },
    addEventListener(){}, remove(){},
    getContext(){ return ctxStub; },
    getBoundingClientRect(){ return {left:0,top:0,width:190,height:190}; },
    onclick:null
  };
}
globalThis.document={
  getElementById:id=>(els[id]||(els[id]=makeEl(id))),
  createElement:()=>makeEl('gen'+Math.random()),
  readyState:'complete'
};
globalThis.window={
  addEventListener(){}, innerWidth:1280, innerHeight:800, devicePixelRatio:1, AudioContext:undefined
};
globalThis.localStorage={ getItem(){return null}, setItem(){}, _store:{}, 
  setItem(k,v){ this._store[k]=v; }, getItem(k){ return this._store[k]===undefined?null:this._store[k]; } };
globalThis.requestAnimationFrame=()=>{};

eval(code);

const G=(globalThis.window&&globalThis.window.__game)||globalThis.__game;
if(!G){ console.error('FAIL: no __game hook'); process.exit(1); }
const f=G.f, dt=1/60;

function sim(seconds, label){
  for(let i=0;i<seconds*60;i++){
    G.update(dt);
    if(i%300===0){ try{ G.render(); }catch(e){ throw new Error('['+label+'] render error: '+e.message); } }
  }
}
function check(cond, msg){
  if(!cond) throw new Error('ASSERT FAIL: '+msg);
}

/* ---- 1. 基础模拟三阵营 ---- */
function run(setup, seconds, label){
  G.startSkirmish(setup);
  sim(seconds, label);
  console.log('OK ['+label+'] t='+G.W.time.toFixed(1)+' units='+G.W.units.length+' buildings='+G.W.buildings.length
    +' Pcredits='+Math.round(G.W.players[0].credits)+' AIcreds='+Math.round(G.W.players[1].credits));
  check(G.W.units.length>=2, label+' units vanished');
}
run({faction:'allied', ai:'soviet', mapId:'valley', diff:1}, 150, '盟军 vs 苏军·山谷');
run({faction:'soviet', ai:'yuri',   mapId:'snowy',  diff:2}, 90,  '苏军 vs 尤里·冰天');
run({faction:'yuri',   ai:'allied', mapId:'deathvalley', diff:0}, 90, '尤里 vs 盟军·死亡谷');

/* ---- 2. 经济闭环：部署→电厂→精炼厂→矿车采矿→资金增长 ---- */
G.startSkirmish({faction:'soviet', ai:'allied', mapId:'valley', diff:1});
const W=G.W;
const mcv=W.units.find(u=>u.owner===0&&u.def.mcv);
check(mcv, 'player MCV exists');
const cy=f.deployMcu(mcv);
check(cy && W.buildings.some(b=>b.owner===0&&b.key==='conyard'), 'MCV deploys to conyard');
const dims={pow:{w:2,h:2},ref:{w:3,h:2},bar:{w:2,h:2},fac:{w:3,h:3}};
function placeNear(key){
  const def=dims[key];
  for(let r=3;r<18;r++){
    for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const X=cy.tx+1+dx-Math.floor(def.w/2), Y=cy.ty+1+dy-Math.floor(def.h/2);
      if(f.canPlace(X,Y,def) && f.tryPlaceBuilding(0,key,X,Y)) return true;
    }
  }
  return false;
}
check(placeNear('pow'), 'place power plant');
check(placeNear('ref'), 'place refinery');
const creditsAfterBuild=W.players[0].credits;
sim(100, 'economy');
const miner=W.units.find(u=>u.owner===0&&u.def.miner);
check(W.players[0].credits>creditsAfterBuild, 'credits increased by mining (got '+Math.round(W.players[0].credits)+' vs '+Math.round(creditsAfterBuild)+')');
check(W.players[0].powerProd>0, 'power production counted');
console.log('OK [经济闭环] 矿车采矿 +'+Math.round(W.players[0].credits-creditsAfterBuild)+' 资金, 电力='+W.players[0].powerProd+'/'+W.players[0].powerUse+(miner?'':'（矿车已在战斗中牺牲）'));

/* ---- 3. 战斗：坦克对轰 / 光棱光束 / 特斯拉 / 基洛夫炸弹 ---- */
G.startSkirmish({faction:'soviet', ai:'allied', mapId:'valley', diff:1});
const a1=f.addUnit(0,'rhino',400,400), a2=f.addUnit(1,'griz',520,400);
f.orderAttack(a1,a2); f.orderAttack(a2,a1);
const b1=f.addUnit(1,'prism',300,300), b2=f.addUnit(0,'rhino',450,300);
f.orderAttack(b1,b2); f.orderAttack(b2,b1);
const c1=f.addUnit(0,'teslat',300,560), c2=f.addUnit(1,'griz',450,560);
f.orderAttack(c1,c2);
const d1=f.addUnit(1,'rock',700,700), d2=f.addUnit(0,'kirov',780,700);
f.orderAttack(d1,d2);
sim(25, 'combat');
check(a2.hp<a2.maxHp || a1.hp<a1.maxHp, 'tank duel deals damage');
check(b2.hp<b2.maxHp, 'prism beam damages rhino');
check(c2.hp<c2.maxHp, 'tesla zap damages grizzly');
check(d1.hp<d1.maxHp || d2.hp<d2.maxHp, 'rocketeer vs kirov exchange');
console.log('OK [战斗] 炮弹/光束/特斯拉/空战 均生效');

/* ---- 4. 心灵控制：心灵专家 + 心灵控制塔 + 支配仪 ---- */
G.startSkirmish({faction:'yuri', ai:'soviet', mapId:'valley', diff:1});
const m1=f.addUnit(0,'master',600,600);
const v1=f.addUnit(1,'rhino',650,600);
// 隔离测试：清除 AI 其他散兵，避免干扰
for(const u of [...W.units]) if(u.owner===1 && u!==v1) f.removeUnit(u);
sim(8, 'mind');
check(v1.mindOf===m1.id && v1.owner===0, 'mastermind controls rhino (owner='+v1.owner+')');
// 心灵控制塔（需要电力）
const mcv2=W.units.find(u=>u.owner===0&&u.def.mcv);
const cy2=f.deployMcu(mcv2);
check(!!cy2, 'yuri conyard deployed');
function placeNearCy(key){
  const def=dims[key]||{w:1,h:1};
  for(let r=3;r<16;r++){
    for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const X=cy2.tx+1+dx-Math.floor(def.w/2), Y=cy2.ty+1+dy-Math.floor(def.h/2);
      if(f.canPlace(X,Y,def)&&f.tryPlaceBuilding(0,key,X,Y)) return true;
    }
  }
  return false;
}
check(placeNearCy('pow'), 'power plant placed for tower');
check(placeNearCy('psychic'), 'psychic tower placed');
const pt=W.buildings.find(b=>b.owner===0&&b.key==='psychic');
const ptc={x:(pt.tx+0.5)*20, y:(pt.ty+0.5)*20};
const vic=f.addUnit(1,'apoc', ptc.x+40, ptc.y+20);
sim(22, 'tower');
check(vic.mindOf===pt.id && vic.owner===0, 'psychic tower controls unit (owner='+vic.owner+')');
// 支配仪
const p0=W.players[0];
const vic2=f.addUnit(1,'rhino', vic.x+60, vic.y);
p0.super.ready=true;
G.launchSuper(p0, vic.x, vic.y);
sim(1, 'dom');
check(vic2.mindOf==='dom' && vic2.owner===0, 'dominator converts units');
console.log('OK [心灵控制] 专家/控制塔/支配仪 均生效');

/* ---- 5. 三种超级武器 ---- */
// 核弹
G.startSkirmish({faction:'soviet', ai:'allied', mapId:'valley', diff:1});
const nVic=f.addUnit(1,'griz', 900, 300);
const nPl=W.players[0];
nPl.super.ready=true;
G.launchSuper(nPl, nVic.x, nVic.y);
sim(6, 'nuke');
check(nVic.hp<=0 || !W.units.includes(nVic), 'nuke destroys target');
// 闪电风暴
G.startSkirmish({faction:'allied', ai:'soviet', mapId:'valley', diff:1});
const sVic=f.addUnit(1,'rhino', 900, 300);
const sPl=W.players[0];
sPl.super.ready=true;
G.launchSuper(sPl, sVic.x, sVic.y);
sim(8, 'storm');
check(sVic.hp<sVic.maxHp, 'weather storm damages units');
console.log('OK [超级武器] 核弹/闪电风暴/心灵支配 均生效');

/* ---- 6. 工程师占领敌方建造场 ---- */
G.startSkirmish({faction:'allied', ai:'soviet', mapId:'valley', diff:1});
sim(10, 'capture-prep'); // 等 AI 部署基地车
// 隔离测试：清掉 AI 散兵，只留下建造场供占领
for(const u of [...W.units]) if(u.owner===1) f.removeUnit(u);
const targetCy=W.buildings.find(b=>b.owner===1&&b.key==='conyard');
check(targetCy,'AI conyard for capture');
const tc=unitCenterOf(targetCy);
const eng=f.addUnit(0,'eng', tc.x-40, tc.y);
eng.mode='capture'; eng.targetId=targetCy.id;
eng.tx=tc.x; eng.ty=tc.y;
eng.path=null; eng.pathIdx=0; eng.repath=0;
function unitCenterOf(b){ return {x:(b.tx+b.w/2)*20, y:(b.ty+b.h/2)*20}; }
sim(5, 'capture');
if(targetCy.owner!==0){
  console.log('  [diag] eng alive='+W.units.includes(eng)+' hp='+(eng.hp)+' mode='+eng.mode+' pos='+eng.x.toFixed(0)+','+eng.y.toFixed(0)+' path='+(eng.path?eng.path.length-eng.pathIdx:'null')+' targetId='+eng.targetId);
}
check(targetCy.owner===0, 'engineer captured enemy conyard (owner='+targetCy.owner+')');
console.log('OK [工程师] 成功占领敌方建造场');

/* ---- 7. 存档/读档往返 ---- */
G.saveGame();
const savedCredits=W.players[0].credits;
G.loadGame();
check(W.units.length>0 && W.buildings.length>0, 'loadGame restores entities');
check(Math.abs(W.players[0].credits-savedCredits)<0.01, 'credits preserved through save/load');
sim(5, 'post-load');
console.log('OK [存档] 实体与资金完整恢复');

console.log('ALL EXTENDED SMOKE TESTS PASSED');
