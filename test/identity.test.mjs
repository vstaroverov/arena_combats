import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
import {GameStore} from '../store.mjs';
import {IdentityStore,hash} from '../identity.mjs';
import {quoteTournament} from '../dist/betting.js';

async function boot(options={}){
  const app=startServer({port:0,dbPath:':memory:',autoTick:false,...options});
  await new Promise(r=>app.server.once('listening',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(route,cookie,body,headers={})=>fetch(base+route,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{Origin:base,'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const guest=async()=>{const r=await request('/api/state');return {cookie:r.headers.get('set-cookie').split(';')[0],state:await r.json()};};
  return {...app,request,guest};
}
const code=async(app,cookie)=>(await(await app.request('/api/account',cookie)).json()).code;
function clean(dir){
  // Windows scanners may create and hold sibling .tmp files; those are not ours.
  for(const file of readdirSync(dir))if(/\.sqlite(?:-wal|-shm)?$/i.test(file)){
    try{unlinkSync(path.join(dir,file));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  try{rmdirSync(dir);}catch(e){if(e.code!=='ENOTEMPTY')throw e;}
}

test('новым cookie выдаются разные GUID; обновление страницы сохраняет код, чужой код не раскрывается',async()=>{
  const app=await boot();
  try{
    const a=await app.guest(),b=await app.guest(),ca=await code(app,a.cookie),cb=await code(app,b.cookie);
    assert.match(ca,/^[0-9a-f-]{36}$/);assert.notEqual(ca,cb);assert.equal(await code(app,a.cookie),ca);
    assert.ok(!JSON.stringify(b.state).includes(ca));assert.ok(!JSON.stringify(a.state).includes(ca));
    const saved=await app.request('/api/account/saved',a.cookie,{});assert.equal(saved.status,200);
    assert.equal((await(await app.request('/api/account',a.cookie)).json()).saved,true);
    assert.equal((await app.request('/api/account')).status,401);
  }finally{await app.close();}
});

test('GUID восстанавливает баланс, ставки и своих бойцов на втором устройстве без объединения профилей',async()=>{
  const app=await boot();
  try{
    const a=await app.guest(),b=await app.guest(),ca=await code(app,a.cookie);
    const created=await(await app.request('/api/action',a.cookie,{type:'create',requestId:randomUUID(),name:'Личный боец',region:'Москва'})).json();
    const id=created.result.fighterId;
    const snapshot=created.state,t=snapshot.tournament,fighterId=t.matches[t.index].ids[0];
    const quote=quoteTournament(t,snapshot.fighters,snapshot.now);
    const bet=await app.request('/api/action',a.cookie,{type:'bet',requestId:randomUUID(),tournamentId:t.id,fighterId,stake:500,fingerprint:quote.fingerprint});assert.equal(bet.status,200);
    const logged=await app.request('/api/account/login',b.cookie,{code:'  '+ca.toUpperCase()+'  '});assert.equal(logged.status,200);
    const newCookie=logged.headers.get('set-cookie').split(';')[0];assert.notEqual(newCookie,b.cookie);
    const result=await logged.json();assert.equal(result.account.code,ca);assert.equal(result.state.balance,9000);assert.equal(result.state.bets.length,1);
    assert.equal(result.state.fighters.find(f=>f.id===id).own,true);
    assert.equal((await(await app.request('/api/state',a.cookie)).json()).balance,9000);
    assert.equal(await code(app,newCookie),ca);
    const latePoll=await app.request('/api/state',b.cookie);assert.equal(latePoll.status,409);assert.equal(latePoll.headers.get('set-cookie'),null,'старый запрос не перезаписывает новую cookie');
  }finally{await app.close();}
});

test('ошибка блокирует только вход по GUID на 24 часа; очистка cookie и подмена XFF не обходят блок',async()=>{
  let now=Date.now();const app=await boot({clock:()=>now});
  try{
    const a=await app.guest(),b=await app.guest(),ca=await code(app,a.cookie);
    const failed=await app.request('/api/account/login',b.cookie,{code:randomUUID()});assert.equal(failed.status,401);
    const {blockedUntil}=await failed.json();assert.equal(blockedUntil,now+86400000);
    const valid=await app.request('/api/account/login',b.cookie,{code:ca});assert.equal(valid.status,429);
    assert.equal(valid.headers.get('retry-after'),'86400');
    const c=await app.guest();assert.equal(c.state.sharedWorld,true);
    const bypass=await app.request('/api/account/login',c.cookie,{code:ca},{'X-Forwarded-For':'203.0.113.111'});assert.equal(bypass.status,429);
    assert.equal((await app.request('/api/action',b.cookie,{type:'topup',requestId:randomUUID()})).status,200);
    assert.equal((await app.request('/api/state',a.cookie)).status,200);
    now+=86400000;
    const retry=await app.request('/api/account/login',c.cookie,{code:ca});assert.equal(retry.status,200);
  }finally{await app.close();}
});

test('GUID, блокировка и сессии переживают рестарт; старые гостевые кошельки мигрируют без потерь',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-auth-')),file=path.join(dir,'world.sqlite'),oldToken=randomBytes(32).toString('hex'),id=hash(oldToken);let store=new GameStore(file);
  try{
    store.transaction(game=>{game.player(id).balance=12345;});
    let auth=new IdentityStore(store),guid=auth.accountRow(id).guid;
    assert.equal(auth.resolve(hash(oldToken)),id);assert.equal(store.game.player(id).balance,12345);
    const guest=auth.create(100000),digest=hash(guest.token);
    const failure=auth.login(digest,'203.0.113.10','invalid',100000);assert.equal(failure.status,401);
    store.close();store=new GameStore(file);auth=new IdentityStore(store);
    assert.equal(auth.accountRow(id).guid,guid);assert.equal(auth.resolve(hash(oldToken)),id);
    assert.equal(auth.login(digest,'203.0.113.10',guid,101000).status,429);
    const recovered=auth.login(digest,'203.0.113.10',guid,100000+86400000);assert.equal(recovered.ok,true);
    assert.equal(auth.resolve(hash(recovered.token),100000+86400000),id);assert.equal(store.game.player(id).balance,12345);
  }finally{store.close();clean(dir);}
});

test('блок действует на браузер при смене IP, но не блокирует целевой профиль на другом устройстве',()=>{
  const store=new GameStore(':memory:'),auth=new IdentityStore(store),a=auth.create(100),b=auth.create(100),c=auth.create(100),guid=auth.accountRow(a.id).guid;
  try{
    auth.login(hash(b.token),'ip-one',randomUUID(),100);
    assert.equal(auth.login(hash(b.token),'ip-two',guid,101).status,429);
    assert.equal(auth.login(hash(c.token),'ip-three',guid,101).ok,true);
  }finally{store.close();}
});
