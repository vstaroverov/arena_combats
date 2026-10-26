import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Payments,paymentConfig} from '../payments.mjs';
import {GameStore} from '../store.mjs';
import {startServer} from '../server.mjs';
import {quoteTournament} from '../dist/betting.js';
import {pruneWorld} from '../retention.mjs';

function config(mode='live'){
  return paymentConfig({YOOKASSA_ENABLED:'1',YOOKASSA_MODE:mode,YOOKASSA_SHOP_ID:'12345',YOOKASSA_SECRET_KEY:'fixture-not-a-real-key',YOOKASSA_RECEIPT_MODE:'payment',YOOKASSA_VAT_CODE:'1',YOOKASSA_PAYMENT_SUBJECT:'service',YOOKASSA_PAYMENT_MODE:'full_payment'},'https://arena.example');
}
function provider(isTest=false){
  const records=new Map(),keys=new Map(),calls=[];let failAfterCreate=false;
  const fetcher=async(url,options)=>{
    calls.push({url,options});let record;
    if(options.method==='POST'){
      const body=JSON.parse(options.body),key=options.headers['Idempotence-Key'];
      if(!keys.has(key)){
        record={id:randomUUID(),status:'pending',paid:false,test:isTest,amount:body.amount,metadata:body.metadata,recipient:{account_id:'12345'},confirmation:{confirmation_url:'https://yoomoney.ru/checkout/fixture'}};
        records.set(record.id,record);keys.set(key,record.id);
      }
      record=records.get(keys.get(key));if(failAfterCreate){failAfterCreate=false;throw Error('network interrupted');}
    }else record=records.get(url.split('/').at(-1));
    return {ok:!!record,status:record?200:404,json:async()=>structuredClone(record)};
  };
  return {records,keys,calls,fetcher,interruptNext(){failAfterCreate=true;}};
}
const payload=(amount=1000)=>({amount,email:'receipt@example.com',requestId:randomUUID()});
function fixture(mode='live'){
  const store=new GameStore(':memory:'),fake=provider(mode==='test'),payments=new Payments(store,config(mode),{fetcher:fake.fetcher});
  return {store,fake,payments};
}

test('ЮKassa: только проверенный succeeded зачисляется один раз; платный и игровой балансы разделены',async()=>{
  const {store,fake,payments}=fixture();
  try{
    const input=payload(),order=await payments.create('a',input),remote=[...fake.records.values()][0];
    assert.equal(store.game.player('a').paidBalanceMinor,0);assert.equal(store.game.player('a').balance,15000);
    await payments.webhook({event:'payment.succeeded',object:{id:remote.id,status:'succeeded',paid:true,amount:{value:'99999.00',currency:'RUB'}}});
    assert.equal(store.game.player('a').paidBalanceMinor,0,'поддельное содержимое уведомления не используется');
    remote.status='succeeded';remote.paid=true;
    await Promise.all([payments.webhook({event:'payment.succeeded',object:{id:remote.id}}),payments.sync(order.id,true),payments.webhook({event:'payment.succeeded',object:{id:remote.id}})]);
    assert.equal(store.game.player('a').paidBalanceMinor,100000);assert.equal(store.game.player('a').balance,15000);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM paid_ledger WHERE kind='credit'").get().n,1);
    await payments.create('a',input);assert.equal(fake.calls.filter(c=>c.options.method==='POST').length,1);
    const body=JSON.parse(fake.calls[0].options.body);assert.equal(body.receipt.customer.email,'receipt@example.com');assert.match(body.confirmation.return_url,/^https:\/\/arena\.example\/\?payment_return=/);
    assert.equal(fake.calls[0].options.redirect,'error');
    assert.equal(payments.info('b').orders.length,0);await assert.rejects(payments.check('b',order.id),/не найден/);
  }finally{store.close();}
});

test('ЮKassa: сумма, валюта, метаданные, магазин и режим проверяются до зачисления',async()=>{
  const {store,fake,payments}=fixture();
  try{
    const order=await payments.create('a',payload(500)),remote=[...fake.records.values()][0],valid={...remote,status:'succeeded',paid:true};
    const invalid=[{amount:{value:'501.00',currency:'RUB'}},{amount:{value:'500.00',currency:'USD'}},{metadata:{order_id:randomUUID()}},{recipient:{account_id:'wrong'}},{test:true},{paid:false},{confirmation:{confirmation_url:'https://evil.example/pay'}}];
    for(const patch of invalid)assert.throws(()=>payments.apply(order.id,{...valid,...patch}));
    assert.equal(store.game.player('a').paidBalanceMinor,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM paid_ledger').get().n,0);
    assert.equal(payments.apply(order.id,valid).status,'succeeded');assert.equal(store.game.player('a').paidBalanceMinor,50000);
  }finally{store.close();}
});

test('ЮKassa: списание за поддержку сохраняется в платёжном учёте после очистки квитанций, возврат не дублируется',async()=>{
  const {store,fake,payments}=fixture();
  try{
    const order=await payments.create('a',payload()),remote=[...fake.records.values()][0];remote.status='succeeded';remote.paid=true;await payments.sync(order.id,true);
    const g=store.game,t=g.state.tournament,id=t.matches[t.index].ids[0],request={type:'support',fighterId:id,points:1,expected:g.world.supportStatus(id).key,requestId:randomUUID()};
    payments.action('a',request);assert.equal(store.game.player('a').paidBalanceMinor,50000);assert.equal(store.game.player('a').balance,15000);
    store.transaction(game=>{game.player('a').receipts=[];pruneWorld(game.state,Date.now()+100*86400000);});
    payments.action('a',request);assert.equal(store.game.player('a').paidBalanceMinor,50000);assert.equal(store.game.world.fighter(id).total,1);
    remote.refunded_amount={value:'1000.00',currency:'RUB'};await payments.webhook({event:'refund.succeeded',object:{payment_id:remote.id}});await payments.webhook({event:'refund.succeeded',object:{payment_id:remote.id}});
    assert.equal(store.game.player('a').paidBalanceMinor,-50000);assert.equal(store.db.prepare("SELECT count(*) AS n FROM paid_ledger WHERE kind='refund'").get().n,1);
    assert.throws(()=>payments.action('a',{...request,requestId:randomUUID()}),/платном балансе/);
    const quote=quoteTournament(t,g.state.fighters,g.state.now);payments.action('a',{type:'bet',tournamentId:t.id,fighterId:id,stake:100,fingerprint:quote.fingerprint,requestId:randomUUID()});assert.equal(store.game.player('a').balance,14900);
  }finally{store.close();}
});

test('ЮKassa: тестовый магазин не создаёт реальные средства',async()=>{
  const {store,fake,payments}=fixture('test');
  try{
    const order=await payments.create('a',payload(500)),remote=[...fake.records.values()][0];remote.status='succeeded';remote.paid=true;await payments.sync(order.id,true);
    assert.equal(store.game.player('a').paidBalanceMinor,0);assert.equal(store.game.player('a').testPaidBalanceMinor,50000);
    const t=store.game.state.tournament,id=t.matches[t.index].ids[0];
    assert.throws(()=>payments.action('a',{type:'support',fighterId:id,points:1,expected:store.game.world.supportStatus(id).key,requestId:randomUUID()}),/платном балансе/);
  }finally{store.close();}
});

test('ЮKassa: сетевой обрыв после создания не создаёт второй платёж; поздний повтор не пересоздаёт заказ',async()=>{
  const store=new GameStore(':memory:'),fake=provider(),now={value:Date.now()},payments=new Payments(store,config(),{fetcher:fake.fetcher,clock:()=>now.value});
  try{
    const input=payload();fake.interruptNext();await assert.rejects(payments.create('a',input),/network interrupted/);
    assert.equal(fake.records.size,1);const order=await payments.create('a',input);assert.equal(fake.records.size,1);assert.equal(order.status,'pending');
    const second=payload(500);fake.interruptNext();await assert.rejects(payments.create('b',second));
    const posts=fake.calls.filter(c=>c.options.method==='POST').length;now.value+=24*3600000;
    const unknown=await payments.create('b',second);assert.equal(unknown.status,'needs_review');assert.equal(fake.calls.filter(c=>c.options.method==='POST').length,posts);
  }finally{store.close();}
});

test('ЮKassa: кредит и защита от повторной обработки переживают перезапуск SQLite',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'yarost-pay-')),file=path.join(dir,'world.sqlite'),fake=provider();let store=new GameStore(file),payments=new Payments(store,config(),{fetcher:fake.fetcher});
  try{
    store.transaction(g=>{g.player('a').balance=12345;g.state.schemaVersion=2;});store.close();store=new GameStore(file);payments=new Payments(store,config(),{fetcher:fake.fetcher});
    assert.equal(store.game.state.schemaVersion,3);assert.equal(JSON.parse(store.db.prepare('SELECT data FROM world WHERE id=1').get().data).schemaVersion,3);assert.equal(store.game.player('a').balance,12345);assert.equal(store.game.player('a').paidBalanceMinor,0);
    const order=await payments.create('a',payload(500)),remote=[...fake.records.values()][0];remote.status='succeeded';remote.paid=true;await payments.sync(order.id,true);
    store.close();store=new GameStore(file);payments=new Payments(store,config(),{fetcher:fake.fetcher});await payments.sync(order.id,true);
    assert.equal(store.game.player('a').paidBalanceMinor,50000);assert.equal(store.game.player('a').balance,12345);assert.equal(store.db.prepare('SELECT count(*) AS n FROM paid_ledger').get().n,1);
  }finally{store.close();for(const name of readdirSync(dir))if(/\.sqlite(?:-wal|-shm)?$/i.test(name)){try{unlinkSync(path.join(dir,name));}catch(e){if(e.code!=='ENOENT')throw e;}}try{rmdirSync(dir);}catch(e){if(e.code!=='ENOTEMPTY')throw e;}}
});

test('HTTP ЮKassa: уведомления принимаются без Origin, начисление защищено, чужие заказы недоступны',async()=>{
  const fake=provider(),app=startServer({port:0,dbPath:':memory:',autoTick:false,paymentsConfig:config(),paymentFetch:fake.fetcher});await new Promise(r=>app.server.once('listening',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const req=(url,cookie,body,origin=base)=>fetch(base+url,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',...(origin?{Origin:origin}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const guest=async()=>{const r=await req('/api/state');return r.headers.get('set-cookie').split(';')[0];};
  try{
    const a=await guest(),b=await guest();assert.equal((await req('/api/payments',null,payload())).status,401);
    assert.equal((await req('/api/payments',a,payload(),'https://evil.example')).status,403);
    const r=await req('/api/payments',a,payload()),body=await r.json();assert.equal(r.status,200);assert.equal(body.state.paidBalance,0);
    assert.equal((await req('/api/payments/'+body.order.id+'/check',b,{})).status,400);
    const remote=[...fake.records.values()][0];remote.status='succeeded';remote.paid=true;
    const callback=await req('/api/payments/webhook',null,{event:'payment.succeeded',object:{id:remote.id}},null);assert.equal(callback.status,200);
    const state=await(await req('/api/state',a)).json();assert.equal(state.paidBalance,1000);assert.equal(state.balance,15000);
    assert.equal((await(await req('/api/payments',b)).json()).orders.length,0);
  }finally{await app.close();}
});

test('ЮKassa выключена без магазина, HTTPS и согласованных настроек чеков; бесплатные очки не конвертируются',async()=>{
  assert.equal(paymentConfig({},'https://arena.example').ready,false);
  const c=config();c.ready=false;const store=new GameStore(':memory:'),payments=new Payments(store,c,{fetcher:()=>{throw Error('must not call provider');}});
  try{
    await assert.rejects(payments.create('a',payload()),/не подключено/);
    payments.action('a',{type:'topup',requestId:randomUUID()});assert.equal(store.game.player('a').balance,25000);assert.equal(store.game.player('a').paidBalanceMinor,0);
  }finally{store.close();}
});
