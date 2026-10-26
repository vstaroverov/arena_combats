import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.mjs';
import {virtualSupportPlan} from '../world.mjs';
import {simulatedPresence} from '../presence.mjs';
import {startServer} from '../server.mjs';

test('virtual audience schedules 2–5 spaced supports within each round',()=>{
  for(const value of [0,.25,.5,.999999]){
    const plan=virtualSupportPlan(2,()=>value);
    assert.equal(plan.events.length,2+Math.floor(value*4));
    assert.equal(plan.round,2);assert.equal(plan.cursor,0);
    assert.equal(new Set(plan.events.map(e=>e.at)).size,plan.events.length);
    assert.ok(plan.events.every(e=>e.at>=5&&e.at<=54&&[0,1].includes(e.side)));
  }
});

test('virtual supports persist across reload, affect combat, and never credit donations or wallets',()=>{
  const previousRandom=Math.random;Math.random=()=>.5;
  try{
    let g=new Game(null,1700000000000);const p=g.player('viewer');p.paidBalanceMinor=12300;
    const wallet=JSON.stringify(p),arena=JSON.stringify(g.state.arena);
    const tour=()=>g.state.tournament;
    tour().phase='live';tour().stats.forEach(s=>s.hp=10000);
    const ids=tour().matches[tour().index].ids;
    for(let round=1;round<=3;round++){
      tour().round=round;tour().elapsed=0;tour().phase='live';
      for(let i=0;i<30;i++)g.tick();
      const savedPlan=structuredClone(tour().virtualRound);
      g=new Game(JSON.parse(JSON.stringify(g.state)));
      assert.deepEqual(tour().virtualRound,savedPlan);
      for(let i=30;i<59;i++)g.tick();
      assert.equal(tour().virtualRound.cursor,4);
      assert.equal(tour().simulatedPoints.reduce((a,b)=>a+b,0),round*4);
      assert.equal(tour().points.reduce((a,b)=>a+b,0),round*4);
    }
    assert.equal(JSON.stringify(g.player('viewer')),wallet);
    assert.equal(JSON.stringify(g.state.arena),arena);
    assert.equal(ids.reduce((n,id)=>n+(g.world.fighter(id).simulatedSupportCount||0),0),12);
    for(const id of ids){assert.equal(g.world.fighter(id).total,0);assert.equal(g.world.fighter(id).economy.donationTotal,0);}
    assert.ok(tour().logs.some(e=>e.text.includes('симуляция')));
    const before=structuredClone(tour().simulatedPoints);tour().phase='result';tour().waitUntil=g.state.now+10000;
    g.tick();assert.deepEqual(tour().simulatedPoints,before);
  }finally{Math.random=previousRandom;}
});

test('presence API reports virtual spectators separately from measured visitors',async()=>{
  const now=Date.parse('2026-10-26T08:00:00+03:00');
  const app=startServer({port:0,dbPath:':memory:',autoTick:false,clock:()=>now});
  await new Promise(r=>app.server.once('listening',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  try{
    const response=await fetch(base+'/api/state'),state=await response.json();
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const count=async()=>{
      const r=await fetch(base+'/api/presence',{method:'POST',headers:{cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({tabId:'virtual-test-tab',visitorId:'test-visitor',online:true,watching:true,fightId:state.tournament.id+':'+state.tournament.index})});
      assert.equal(r.status,200);return r.json();
    };
    const waiting=await count();assert.equal(waiting.online,1);assert.deepEqual(waiting.simulation,simulatedPresence(now,'waiting'));assert.equal(waiting.simulation.watching,0);
    app.store.transaction(g=>{g.state.tournament.phase='live';});
    const live=await count();assert.equal(live.online,1);assert.equal(live.watching,1);assert.deepEqual(live.simulation,simulatedPresence(now,'live'));
  }finally{await app.close();}
});

test('simulated likes accumulate once, survive reload and stay separate from user likes',()=>{
  const previousRandom=Math.random;Math.random=()=>.5;
  try{
    let g=new Game(null,1700000000000);const tour=()=>g.state.tournament;
    tour().phase='live';tour().stats.forEach(s=>s.hp=10000);
    const id=tour().matches[tour().index].ids[1];g.world.fighter(id).likes=1;
    const beforePlayers=JSON.stringify(g.state.players);
    for(let i=0;i<15;i++)g.tick();
    assert.equal(g.world.fighter(id).simulatedLikes,2);
    const next=tour().virtualLikeAt;
    g=new Game(JSON.parse(JSON.stringify(g.state)));
    assert.equal(tour().virtualLikeAt,next);g.tick();assert.equal(g.world.fighter(id).simulatedLikes,2);
    while(g.state.now<next)g.tick();assert.equal(g.world.fighter(id).simulatedLikes,4);
    assert.equal(g.world.fighter(id).likes,1);assert.equal(JSON.stringify(g.state.players),beforePlayers);
    tour().phase='result';tour().waitUntil=g.state.now+30000;
    for(let i=0;i<20;i++)g.tick();assert.equal(g.world.fighter(id).simulatedLikes,4);
  }finally{Math.random=previousRandom;}
});
