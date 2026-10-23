import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Game} from '../game.mjs';
import {GameStore} from '../store.mjs';
import {IdentityStore,hash} from '../identity.mjs';
import {Maintenance} from '../maintenance.mjs';
import {DAY,prunePlayer,pruneWorld} from '../retention.mjs';

test('история ставок ограничена, открытые пари и деньги не удаляются; архив считается один раз',()=>{
  const now=Date.now(),g=new Game(),p=g.player('a');p.balance=12345;
  p.bets=[{id:'open-old',status:'open',placedAt:now-90*DAY,stake:100}];
  for(let i=0;i<150;i++)p.bets.push({id:'b'+i,status:'won',placedAt:now-i*1000,settledAt:now-i*1000,stake:100,payout:200});
  p.bets.push({id:'too-old',status:'lost',placedAt:now-40*DAY,settledAt:now-31*DAY,stake:300,payout:0});
  const first=prunePlayer(p,now);assert.equal(first.bets,51);assert.equal(p.bets.length,101);assert.equal(p.bets[0].id,'open-old');
  assert.deepEqual(p.archivedBets,{count:51,stake:5300,payout:10000,won:50,lost:1,refunded:0});assert.equal(p.balance,12345);
  prunePlayer(p,now);assert.equal(p.archivedBets.count,51);assert.equal(p.balance,12345);
  prunePlayer(p,now+40*DAY);assert.equal(p.bets.length,1);assert.equal(p.bets[0].status,'open');
});

test('квитанции истекают, недавний повтор действия остаётся идемпотентным',()=>{
  const now=Date.now(),g=new Game(null,now),p=g.player('a');
  p.receipts=[{id:'expired',at:now-8*DAY,result:{}},{id:'legacy',result:{}}];
  prunePlayer(p,now);assert.deepEqual(p.receipts.map(r=>r.id),['legacy']);assert.equal(p.receipts[0].at,now);
  const request={type:'topup',requestId:randomUUID()};g.action('a',request);prunePlayer(p,now+DAY);g.action('a',request);assert.equal(p.balance,25000);
  for(let i=0;i<300;i++)p.receipts.push({id:'recent'+i,at:now,result:{}});
  prunePlayer(p,now);assert.equal(p.receipts.length,200);
});

test('суточная очистка сохраняет прогресс и GUID, удаляет только истёкшие служебные записи',()=>{
  const now=Date.now(),store=new GameStore(':memory:',now),auth=new IdentityStore(store,now),maintenance=new Maintenance(store);
  try{
    const empty=auth.create(now-400*DAY),progress=auth.create(now-400*DAY),active=auth.create(now);
    const emptyCode=auth.accountRow(empty.id).guid,progressCode=auth.accountRow(progress.id).guid;
    store.transaction(g=>{g.player(progress.id).balance=1000;});
    store.db.prepare('INSERT INTO retired_sessions VALUES(?,?)').run('old-retired',now-1);
    store.db.prepare('INSERT INTO retired_sessions VALUES(?,?)').run('live-retired',now+DAY);
    store.db.prepare('INSERT INTO login_blocks VALUES(?,?)').run('old-block',now-1);
    store.db.prepare('INSERT INTO login_blocks VALUES(?,?)').run('live-block',now+DAY);
    const result=maintenance.run(now);assert.equal(result.sessions,2);assert.equal(result.blocks,1);assert.equal(result.retiredSessions,1);assert.equal(result.emptyPlayers,1);
    assert.equal(store.game.state.players[empty.id],undefined);assert.equal(store.game.player(progress.id).balance,1000);
    assert.equal(auth.accountRow(empty.id).guid,emptyCode);assert.equal(auth.accountRow(progress.id).guid,progressCode);
    assert.equal(auth.resolve(hash(active.token),now),active.id);
    const restored=auth.login(hash(active.token),'new-ip',emptyCode,now);assert.equal(restored.ok,true);assert.equal(store.game.player(empty.id).balance,15000);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM login_blocks').get().n,1);
  }finally{store.close();}
});

test('очистка запускается по московской полуночи и хранит один отчёт вместо растущего лога',()=>{
  const now=Date.parse('2026-10-23T20:59:00Z'),store=new GameStore(':memory:',now);new IdentityStore(store,now);const maintenance=new Maintenance(store);
  try{
    assert.ok(maintenance.run(now));assert.equal(maintenance.run(now+30000),null);assert.ok(maintenance.run(now+60000));
    assert.equal(store.db.prepare('SELECT day FROM maintenance').get().day,'2026-10-24');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM maintenance').get().n,1);
    assert.equal(new Maintenance(store).run(now+120000),null);
  }finally{store.close();}
});

test('старые хроники и награды ограничены, текущий бой и общий счёт наград сохраняются',()=>{
  const g=new Game(),s=g.state,f=s.fighters[0];
  f.awards=Array.from({length:200},(_,i)=>'Награда '+i);
  s.tournament.logs=Array.from({length:80},(_,i)=>({text:'Текущий '+i}));
  const other=s.league.events.find(t=>t!==s.tournament);other.logs=[{text:'Старый бой'}];
  pruneWorld(s,s.now);assert.equal(f.awards.length,50);assert.equal(f.awardCount,200);assert.equal(f.awards[0],'Награда 150');
  assert.equal(s.tournament.logs.length,50);assert.equal(other.logs.length,0);
  pruneWorld(s,s.now);assert.equal(f.awardCount,200);
});

test('SQLite освобождает удалённые страницы и WAL без потери баланса и GUID',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-vacuum-')),filename=path.join(dir,'world.sqlite'),store=new GameStore(filename),auth=new IdentityStore(store),guest=auth.create(Date.now());
  try{
    const code=auth.accountRow(guest.id).guid;store.transaction(g=>{g.player(guest.id).balance=7777;});
    store.db.exec('CREATE TABLE vacuum_fixture(payload BLOB); INSERT INTO vacuum_fixture VALUES(zeroblob(12582912)); PRAGMA wal_checkpoint(TRUNCATE)');
    const before=statSync(filename).size;store.db.exec('DROP TABLE vacuum_fixture');store.compact();const after=statSync(filename).size;
    assert.ok(after<before/2);assert.equal(store.game.player(guest.id).balance,7777);assert.equal(auth.accountRow(guest.id).guid,code);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{
    store.close();for(const file of readdirSync(dir))if(/\.sqlite(?:-wal|-shm)?$/i.test(file)){try{unlinkSync(path.join(dir,file));}catch(e){if(e.code!=='ENOENT')throw e;}}
    try{rmdirSync(dir);}catch(e){if(e.code!=='ENOTEMPTY')throw e;}
  }
});
