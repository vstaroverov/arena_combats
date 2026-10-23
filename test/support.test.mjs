import test from 'node:test';
import assert from 'node:assert/strict';
import {bracket} from '../dist/league.js';

async function harness(round=1,elapsed=0,options={}){
  const now=Date.now(),elements=new Map(),handlers=new Map();let advance,saved,profileId;
  const fighters=Array.from({length:3},(_,i)=>({id:'f'+i,name:'Боец '+i,region:'Москва',seed:i,stats:[60,60,60],wins:0,losses:0,rating:1000,injuries:[],fatigue:0,restAt:now,readyAt:now,total:0,awards:[]}));
  const initial=options.saved||{version:1,now,balance:15000,started:true,cup:0,history:[],champions:[],fighters,tournament:{name:'Тест',number:1,matches:Array.from({length:7},()=>({ids:['f0','f1'],winner:null})),index:0,phase:'live',waitUntil:now,points:[0,0],logs:[],round,elapsed,stats:[{hp:100,energy:100,damage:0},{hp:100,energy:100,damage:0}]}};
  if(options.betting)initial.tournament=bracket(['f0','f1'],{id:'bet-ui',name:'Кубок ставок'},now);
  // Изменения тестового активного боя синхронизируются с сохранённым календарём.
  if(initial.league)initial.league.events=initial.league.events.map(t=>t.id===initial.tournament.id?initial.tournament:t);
  const el=s=>{if(!elements.has(s))elements.set(s,{dataset:{},style:{},value:s==='#sort'?'rating':'',innerHTML:'',textContent:'',disabled:false,open:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(s);};
  const packages=[1,2,3].map(v=>({dataset:{package:String(v)}}));
  const original={document:global.document,window:global.window,localStorage:global.localStorage,setInterval:global.setInterval,setTimeout:global.setTimeout};
  global.document={querySelector:el,querySelectorAll:s=>s==='[data-package]'?packages:[],addEventListener:(name,fn)=>handlers.set(name,fn)};
  global.window={addEventListener:(name,fn)=>handlers.set(name,fn)};
  global.localStorage={getItem:()=>JSON.stringify(initial),setItem:(k,v)=>saved=JSON.parse(v)};
  global.setInterval=fn=>{advance=fn;};global.setTimeout=()=>0;
  await import('../dist/app.js?test='+Math.random());
  return {el,packages,advance:()=>advance(),snapshot:()=>{handlers.get('pagehide')();return saved;},saved:()=>saved,click:(selector,dataset)=>handlers.get('click')({target:{closest:s=>s===selector?{dataset}:null}}),profile:id=>{profileId=id;handlers.get('click')({target:{closest:s=>s==='[data-profile]'?{dataset:{profile:id}}:null}});},support:()=>handlers.get('click')({target:{closest:s=>s==='[data-support-fighter]'?{dataset:{supportFighter:profileId}}:null}}),restore:()=>Object.assign(global,original)};
}

test('карточка участника открывает пакеты, покупка добавляет поддержку только ему',async()=>{
  const h=await harness();try{
    h.profile('f0');assert.equal(h.el('#profile-support').disabled,false);
    h.el('#modal').scrollTop=700;h.support();assert.equal(h.el('#modal').scrollTop,0);assert.match(h.el('#modal-content').innerHTML,/data-package="3"/);
    h.packages[1].onclick();
    assert.deepEqual(h.saved().tournament.points,[2,0]);assert.equal(h.saved().balance,14000);assert.equal(h.saved().fighters[0].total,1);assert.equal(h.el('#modal').open,false);
    assert.equal(h.saved().fighters[0].economy.donationTotal,1000);
    assert.equal(h.saved().fighters[0].economy.coins,800);
    assert.equal(h.saved().arena.supportIncome,200);
    h.profile('f2');assert.equal(h.el('#profile-support').disabled,false);assert.equal(h.el('#profile-support').textContent,'Поддержать');
  }finally{h.restore();}
});
test('при начале третьего раунда профиль предлагает подготовку к следующему бою',async()=>{
  const h=await harness(2,59);try{
    h.profile('f0');assert.equal(h.el('#profile-support').disabled,false);
    h.advance();assert.equal(h.el('#profile-support').disabled,false);assert.equal(h.el('#profile-support').textContent,'Поддержать');
  }finally{h.restore();}
});
test('пакет, открытый до закрытия приёма, не списывает деньги после закрытия',async()=>{
  const h=await harness(2,59);try{
    h.profile('f0');h.support();h.advance();h.packages[0].onclick();
    assert.equal(h.el('#modal').open,false);assert.match(h.el('#toast').textContent,/Списания нет/);
    h.el('#topup').onclick();assert.equal(h.saved().balance,25000);assert.deepEqual(h.saved().tournament.points,[0,0]);
  }finally{h.restore();}
});

test('подготовка сохраняется, применяется один раз и принимает поддержку свыше 9 очков',async()=>{
  let snapshot;
  let h=await harness();try{
    h.profile('f2');h.support();h.packages[2].onclick();
    assert.equal(h.saved().fighters[2].preparedSupport,3);
    assert.equal(h.saved().balance,13500);assert.deepEqual(h.saved().tournament.points,[0,0]);
    assert.match(h.el('#support-status').textContent,/Собрано 3 очков/);
    assert.match(h.el('#modal-content').innerHTML,/<b>64<\/b>/);
    snapshot=h.snapshot();
  }finally{h.restore();}
  h=await harness(1,0,{saved:snapshot});try{
    h.profile('f2');assert.match(h.el('#support-status').textContent,/Собрано 3 очков/);
    snapshot=h.snapshot();
  }finally{h.restore();}
  snapshot.tournament.matches[0].ids=['f2','f1'];snapshot.tournament.phase='waiting';snapshot.tournament.waitUntil=snapshot.now+1000;
  h=await harness(1,0,{saved:snapshot});try{
    h.profile('f2');h.support();h.packages[2].onclick();
    // Ещё 3 очка на текущий бой добавляются к сохранённым 3, не заменяя их.
    assert.equal(h.saved().tournament.points[0],3);assert.equal(h.saved().fighters[2].preparedSupport,3);
    h.advance();assert.deepEqual(h.snapshot().tournament.points,[6,0]);assert.equal(h.saved().fighters[2].preparedSupport,0);
    h.advance();assert.deepEqual(h.snapshot().tournament.points,[6,0]);
    h.profile('f2');h.support();h.packages[2].onclick();
    assert.equal(h.saved().tournament.points[0],9);
    h.profile('f2');assert.equal(h.el('#profile-support').disabled,false);h.support();h.packages[2].onclick();assert.equal(h.saved().tournament.points[0],12);
    snapshot=h.snapshot();
  }finally{h.restore();}
  snapshot.tournament.round=3;snapshot.tournament.elapsed=59;snapshot.tournament.phase='live';
  snapshot.tournament.stats[0].damage=1000;
  h=await harness(1,0,{saved:snapshot});try{
    h.advance();assert.equal(h.snapshot().tournament.phase,'result');
    h.profile('f2');assert.match(h.el('#support-status').textContent,/Собрано 0 очков/);
    assert.equal(h.saved().fighters[2].preparedSupport,0);
  }finally{h.restore();}
});

test('подготовка не теряется при медицинском недопуске и не усиливает текущий закрытый бой',async()=>{
  let h=await harness(3,0),snapshot;
  try{
    h.profile('f0');h.support();h.packages[0].onclick();
    assert.deepEqual(h.saved().tournament.points,[0,0]);assert.equal(h.saved().fighters[0].preparedSupport,1);
    snapshot=h.snapshot();
  }finally{h.restore();}
  snapshot.tournament.round=1;snapshot.tournament.phase='waiting';snapshot.tournament.waitUntil=snapshot.now+1000;
  snapshot.fighters[0].injuries=[{stat:0,penalty:.2,until:snapshot.now+3600000,severity:'Тяжёлая'}];
  h=await harness(1,0,{saved:snapshot});try{
    h.advance();assert.equal(h.snapshot().tournament.phase,'result');assert.equal(h.saved().fighters[0].preparedSupport,1);
  }finally{h.restore();}
});

test('ставка через сетку проходит от купона до выплаты и отображается в истории',async()=>{
  let h=await harness(1,0,{betting:true}),snapshot;
  try{
    const id=h.snapshot().tournament.id;
    h.click('[data-ticket]',{tournament:id,ticket:'f0'});
    assert.match(h.el('#modal-content').innerHTML,/ИГРОВОЕ ПАРИ/);
    h.el('#bet-amount').value='500';h.el('#bet-amount').oninput();
    assert.equal(h.el('#bet-submit').disabled,false);
    const submit=h.el('#bet-form').onsubmit;
    submit({preventDefault(){}});assert.equal(h.saved().bets.length,1);assert.equal(h.saved().balance,14500);
    submit({preventDefault(){}});assert.equal(h.saved().bets.length,1,'повторное событие не создаёт вторую ставку');
    h.el('#my-bets').onclick();assert.match(h.el('#modal-content').innerHTML,/Ожидает финала/);
    snapshot=h.snapshot();
  }finally{h.restore();}
  snapshot.tournament.phase='live';snapshot.tournament.startedAt=snapshot.now;snapshot.tournament.round=3;snapshot.tournament.elapsed=59;snapshot.tournament.stats[0].damage=1000;
  h=await harness(1,0,{saved:snapshot});const random=Math.random;
  try{
    Math.random=()=>.5;h.advance();assert.equal(h.snapshot().bets[0].status,'won');assert.equal(h.saved().balance,15500);
    assert.equal(h.saved().fighters[0].economy.prizeTotal,1300);assert.equal(h.saved().arena.prizesPaid,1400);
    h.el('#my-bets').onclick();assert.match(h.el('#modal-content').innerHTML,/Выигрыш/);
    h.profile('f0');assert.match(h.el('#modal-content').innerHTML,/Призовые за карьеру/);
    
  }finally{Math.random=random;h.restore();}
});

test('купон закрывает приём при первом гонге без списания средств',async()=>{
  const h=await harness(1,0,{betting:true});try{
    h.click('[data-ticket]',{tournament:h.snapshot().tournament.id,ticket:'f0'});
    h.el('#bet-amount').value='500';for(let i=0;i<15;i++)h.advance();
    assert.equal(h.el('#bet-submit').disabled,true);
    assert.match(h.el('#bet-error').textContent,/закрыт/);
    h.el('#bet-form').onsubmit({preventDefault(){}});
    assert.equal(h.snapshot().balance,15000);assert.equal(h.saved().bets.length,0);
  }finally{h.restore();}
});

test('лайк сохраняется, отображается в профиле и списке, повторное нажатие снимает его',async()=>{
  let h=await harness(),snapshot;
  try{
    h.click('[data-like]',{like:'f2'});
    assert.equal(h.saved().fighters[2].likes,1);assert.deepEqual(h.saved().likedFighters,['f2']);
    assert.equal(h.saved().balance,15000);assert.equal(h.saved().fighters[2].total,0);
    assert.equal(h.el('#modal').open,false,'лайк в списке не открывает карточку');
    h.profile('f2');assert.match(h.el('#modal-content').innerHTML,/Лайки бойца/);
    assert.match(h.el('#modal-content').innerHTML,/aria-pressed="true"/);snapshot=h.snapshot();
  }finally{h.restore();}
  h=await harness(1,0,{saved:snapshot});try{
    h.profile('f2');assert.match(h.el('#modal-content').innerHTML,/aria-pressed="true"/);
    h.click('[data-like]',{like:'f2'});assert.equal(h.saved().fighters[2].likes,0);
    assert.deepEqual(h.saved().likedFighters,[]);assert.equal(h.saved().balance,15000);
    assert.match(h.el('#profile-likes').innerHTML,/aria-pressed="false"/);
  }finally{h.restore();}
});

test('подготовка свыше 9 очков сохраняется после перезагрузки и целиком переносится в бой',async()=>{
  let h=await harness(),snapshot;
  try{
    for(let i=0;i<4;i++){h.profile('f2');h.support();h.packages[2].onclick();}
    assert.equal(h.saved().fighters[2].preparedSupport,12);assert.equal(h.saved().balance,9000);
    snapshot=h.snapshot();
  }finally{h.restore();}
  snapshot.tournament.matches[0].ids=['f2','f1'];snapshot.tournament.points=[3,0];snapshot.tournament.phase='waiting';snapshot.tournament.round=1;snapshot.tournament.waitUntil=snapshot.now+1000;
  h=await harness(1,0,{saved:snapshot});try{
    assert.equal(h.snapshot().fighters[2].preparedSupport,12);
    h.advance();assert.deepEqual(h.snapshot().tournament.points,[15,0]);assert.equal(h.saved().fighters[2].preparedSupport,0);
  }finally{h.restore();}
});
