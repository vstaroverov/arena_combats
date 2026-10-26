import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,unlinkSync,rmdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Game} from '../game.mjs';
import {GameStore} from '../store.mjs';
import {startServer} from '../server.mjs';
import {quoteTournament} from '../dist/betting.js';

function fundedGame(){const g=new Game();for(const id of ['a','b'])g.player(id).paidBalanceMinor=1500000;return g;}
const action=(g,id,a)=>g.action(id,{requestId:randomUUID(),...a});
const current=g=>g.state.tournament.matches[g.state.tournament.index].ids;
function cleanup(dir){
  for(const file of readdirSync(dir))if(/\.sqlite(?:-wal|-shm)?$/i.test(file)){
    try{unlinkSync(path.join(dir,file));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  try{rmdirSync(dir);}catch(error){if(error.code!=='ENOTEMPTY')throw error;}
}

test('один серверный цикл ведёт мир без браузеров и сохраняет корректную сетку',()=>{
  const g=new Game(null,1700000000000),start=g.state.now;
  for(let i=0;i<4000;i++)g.tick();
  assert.equal(g.state.now-start,4000000);assert.equal(g.state.fighters.length,429);
  assert.ok(g.state.cup>=2);assert.ok(g.state.history.length);
  assert.equal(g.state.fighters.reduce((n,f)=>n+f.wins,0),g.state.fighters.reduce((n,f)=>n+f.losses,0));
  for(const m of g.state.tournament.matches)if(m.winner)assert.ok(m.ids.includes(m.winner));
});

test('поддержка общая, баланс личный; повтор запроса не списывает ещё раз',()=>{
  const g=fundedGame(),id=current(g)[0],expected=g.world.supportStatus(id).key;
  const request={requestId:randomUUID(),type:'support',fighterId:id,points:3,expected};
  const result=g.action('a',request);assert.deepEqual(g.action('a',request),result);
  assert.equal(g.view('a').paidBalance,13500);assert.equal(g.view('b').balance,15000);
  assert.deepEqual(g.view('a').tournament,g.view('b').tournament);
  assert.deepEqual(g.state.tournament.points,[3,0]);
  assert.equal(g.world.fighter(id).economy.donationTotal,1500);
  assert.equal(g.state.arena.supportIncome,300);
  assert.equal('players' in g.view('b'),false);assert.equal('ownerId' in g.view('b').fighters[0],false);
});

test('подготовка будущего бойца общая и переносится ровно на одно выступление',()=>{
  const g=fundedGame(),id=g.state.fighters.find(f=>!current(g).includes(f.id)&&f.id.startsWith('city-')).id;
  const expected=g.world.supportStatus(id).key;
  for(let i=0;i<4;i++)action(g,'a',{type:'support',fighterId:id,points:3,expected});
  assert.equal(g.world.fighter(id).preparedSupport,12);
  const m=g.state.tournament.matches[g.state.tournament.index];m.ids[0]=id;
  while(g.state.tournament.phase==='waiting')g.tick();
  assert.equal(g.world.fighter(id).preparedSupport,0);assert.equal(g.state.tournament.points[0],12);
  g.tick();assert.equal(g.state.tournament.points[0],12);
});

test('сервер отклоняет устаревшую поддержку и пакеты с поддельной суммой',()=>{
  const g=fundedGame(),id=current(g)[0],expected=g.world.supportStatus(id).key;
  g.state.tournament.phase='break';g.state.tournament.round=3;
  assert.throws(()=>action(g,'a',{type:'support',fighterId:id,points:3,expected}),/изменился/);
  assert.throws(()=>action(g,'a',{type:'support',fighterId:id,points:-100,expected}),/пакет/);
  assert.equal(g.view('a').balance,15000);
});

test('лайки и бойцы общие, отметки лайка и владения личные',()=>{
  const g=fundedGame(),id=current(g)[0];
  action(g,'a',{type:'like',fighterId:id,liked:true});action(g,'a',{type:'like',fighterId:id,liked:true});
  action(g,'b',{type:'like',fighterId:id,liked:true});assert.equal(g.world.fighter(id).likes,2);
  action(g,'a',{type:'like',fighterId:id,liked:false});assert.equal(g.world.fighter(id).likes,1);
  const {fighterId}=action(g,'a',{type:'create',name:'Новый боец',description:'История',region:'Москва'});
  assert.equal(g.view('a').fighters.find(f=>f.id===fighterId).own,true);
  assert.equal(g.view('b').fighters.find(f=>f.id===fighterId).own,false);
  assert.equal(g.view('a').paidBalance,9500);assert.equal(g.view('b').balance,15000);
  assert.throws(()=>action(g,'a',{type:'create',name:'Плохой флаг',region:'Москва',flag:'https://example.com/x.svg'}),/изображение/);
});

test('ставки личные, общий результат выплачивает каждому игроку один раз',()=>{
  const g=fundedGame(),t=g.state.tournament,[a,b]=current(g),quote=quoteTournament(t,g.state.fighters,g.state.now);
  action(g,'a',{type:'bet',tournamentId:t.id,fighterId:a,stake:500,fingerprint:quote.fingerprint});
  action(g,'b',{type:'bet',tournamentId:t.id,fighterId:b,stake:1000,fingerprint:quote.fingerprint});
  assert.equal(g.view('a').bets.length,1);assert.equal(g.view('b').bets.length,1);
  for(let i=0;i<1000&&!t.done;i++)g.tick();assert.equal(t.done,true);
  for(const id of ['a','b']){
    const p=g.player(id),bet=p.bets[0];assert.ok(['won','lost'].includes(bet.status));
    assert.equal(p.balance,15000-bet.stake+bet.payout);
  }
  const balances=['a','b'].map(id=>g.player(id).balance);
  g.tick();assert.deepEqual(['a','b'].map(id=>g.player(id).balance),balances);
});

test('SQLite сохраняет мир, сессии и идемпотентность; ошибка откатывает всё',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-test-')),db=path.join(dir,'world.sqlite'),copy=path.join(dir,'backup.sqlite');
  let store=new GameStore(db);
  try{
    store.transaction(g=>{g.player('a').paidBalanceMinor=1500000;});const id=current(store.game)[0],req={requestId:randomUUID(),type:'support',fighterId:id,points:2,expected:store.game.world.supportStatus(id).key};
    store.transaction(g=>g.action('a',req));store.transaction(g=>g.tick());
    const before=JSON.stringify(store.game.state);
    assert.throws(()=>store.transaction(g=>{g.player('a').balance=0;throw Error('failure');}),/failure/);
    assert.equal(JSON.stringify(store.game.state),before);
    store.backup(copy);store.close();store=new GameStore(db);
    assert.equal(JSON.stringify(store.game.state),before);
    store.transaction(g=>g.action('a',req));assert.equal(store.game.player('a').paidBalanceMinor,1400000);
    const backup=new GameStore(copy);assert.equal(JSON.stringify(backup.game.state),before);backup.close();
  }finally{store.close();cleanup(dir);}
});

test('HTTP: два посетителя видят один бой, действия серверные и нет локального мира',async()=>{
  let now=Date.now();const app=startServer({port:0,dbPath:':memory:',clock:()=>now,autoTick:false});
  await new Promise(r=>app.server.once('listening',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  async function client(){const response=await fetch(base+'/api/state');return {cookie:response.headers.get('set-cookie').split(';')[0],state:await response.json()};}
  const get=async c=>(await fetch(base+'/api/state',{headers:{cookie:c.cookie}})).json();
  const send=(c,a,origin=base)=>fetch(base+'/api/action',{method:'POST',headers:{cookie:c.cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...a})});
  try{
    const a=await client(),b=await client();app.store.transaction(g=>{g.player(a.state.viewerId).paidBalanceMinor=1500000;});assert.notEqual(a.cookie,b.cookie);assert.deepEqual(a.state.tournament,b.state.tournament);
    const id=a.state.tournament.matches[a.state.tournament.index].ids[0];
    const response=await send(a,{type:'support',fighterId:id,points:2,expected:app.store.game.world.supportStatus(id).key});assert.equal(response.status,200);
    const bv=await get(b);assert.deepEqual(bv.tournament.points,[2,0]);assert.equal(bv.balance,15000);
    const bad=await send(b,{type:'topup'},'https://evil.example');assert.equal(bad.status,403);
    const before=await get(a);now+=2000;app.advance();const after=await get(a);assert.equal(after.now-before.now,2000);
    assert.deepEqual(after.tournament,(await get(b)).tournament);
    assert.match((await fetch(base+'/')).headers.get('cache-control'),/no-cache/);
    assert.equal((await fetch(base+'/api/state',{headers:{cookie:a.cookie}})).headers.get('cache-control'),'no-store');
    assert.equal((await fetch(base+'/data/world.sqlite')).status,404);
  }finally{await app.close();}
});

test('второй процесс не перезаписывает мир устаревшим снимком',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-lock-')),db=path.join(dir,'world.sqlite');
  const a=new GameStore(db),b=new GameStore(db);
  try{
    a.transaction(g=>g.tick());
    assert.throws(()=>b.transaction(g=>g.tick()),/Другой процесс/);
    assert.throws(()=>b.transaction(g=>g.tick()),/Другой процесс/);
    a.transaction(g=>g.tick());
  }finally{a.close();b.close();cleanup(dir);}
});

test('после перезапуска сервер догоняет простой без клиентов',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-resume-')),db=path.join(dir,'world.sqlite');let now=Date.now();
  let app=startServer({port:0,dbPath:db,clock:()=>now,autoTick:false});await new Promise(r=>app.server.once('listening',r));
  const start=app.store.game.state.now;await app.close();now+=30000;
  app=startServer({port:0,dbPath:db,clock:()=>now,autoTick:false});await new Promise(r=>app.server.once('listening',r));
  try{app.advance();assert.equal(app.store.game.state.now,start+10000);app.advance();app.advance();assert.equal(app.store.game.state.now,now);assert.equal(app.store.game.state.tournament.phase,'live');}
  finally{await app.close();cleanup(dir);}
});
