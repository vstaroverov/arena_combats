import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Game} from '../game.mjs';

test('интерфейс отправляет поддержку, лайк, ставку и создание на сервер; обновления общие',async()=>{
  const game=new Game();for(const id of ['a','b'])game.player(id).paidBalanceMinor=1500000;const elements=new Map(),handlers=new Map(),intervals=[],requests=[];
  const original=Object.fromEntries(['document','window','fetch','setInterval','setTimeout','sessionStorage','FormData'].map(k=>[k,globalThis[k]]));
  const el=s=>{if(!elements.has(s))elements.set(s,{value:s==='#sort'?'rating':'',dataset:{},style:{},innerHTML:'',textContent:'',open:false,classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(s);};
  const packages=[1,2,3].map(v=>({dataset:{package:String(v)}}));
  globalThis.document={querySelector:el,querySelectorAll:s=>s==='[data-package]'?packages:[],addEventListener:(name,fn)=>handlers.set(name,fn)};
  let redirected='';const sessionValues=new Map(),checkouts=[];
  globalThis.window={location:{assign(url){redirected=url;}}};globalThis.sessionStorage={getItem(k){return sessionValues.get(k)||null;},setItem(k,v){sessionValues.set(k,v);},removeItem(k){sessionValues.delete(k);}};
  globalThis.setInterval=fn=>{intervals.push(fn);};globalThis.setTimeout=()=>0;
  let offline=false,viewer='a',codeSaved=false;
  const codes={a:randomUUID(),b:randomUUID()};
  globalThis.fetch=async(url,options={})=>{
    if(offline)throw Error('offline');
    if(url==='/api/state')return {ok:true,json:async()=>structuredClone(game.view(viewer))};
    if(url==='/api/account')return {ok:true,json:async()=>({code:codes[viewer],saved:codeSaved,blockedUntil:0,serverTime:Date.now()})};
    if(url==='/api/account/saved'){codeSaved=true;return {ok:true,json:async()=>({ok:true})};}
    if(url==='/api/account/login'){
      if(JSON.parse(options.body).code!==codes.b)return {ok:false,status:401,json:async()=>({error:'Неверный код',blockedUntil:Date.now()+86400000,serverTime:Date.now()})};
      viewer='b';return {ok:true,json:async()=>({state:structuredClone(game.view(viewer)),account:{code:codes.b,saved:true,blockedUntil:0,serverTime:Date.now()}})};
    }
    if(url==='/api/payments'){
      if(!options.body)return {ok:true,json:async()=>({enabled:true,test:false,receiptEmailRequired:true,min:100,max:50000,orders:[]})};
      checkouts.push(JSON.parse(options.body));return {ok:true,json:async()=>({order:{id:'order-fixture',status:'pending',confirmationUrl:'https://yoomoney.ru/checkout/fixture'},state:structuredClone(game.view(viewer))})};
    }
    const a=JSON.parse(options.body);requests.push(a);
    try{const result=game.action(viewer,a);return {ok:true,json:async()=>({result,state:structuredClone(game.view(viewer))})};}
    catch(error){return {ok:false,status:400,json:async()=>({error:error.message})};}
  };
  const click=(selector,dataset)=>handlers.get('click')({target:{closest:s=>s===selector?{dataset}:null}});
  try{
    await import('../dist/app.js?ui='+randomUUID());assert.equal(intervals.length,1);
    const id=game.state.tournament.matches[game.state.tournament.index].ids[0];
    click('[data-profile]',{profile:id});assert.match(el('#modal-content').innerHTML,/КАРТОЧКА БОЙЦА/);
    click('[data-support-fighter]',{supportFighter:id});await packages[1].onclick();
    assert.equal(requests.at(-1).type,'support');assert.equal(game.player('a').paidBalanceMinor,1400000);
    assert.deepEqual(game.state.tournament.points,[2,0]);
    assert.ok(el('#fight-bars').innerHTML.includes(`data-like="${id}"`),'current fight has like buttons');
    click('[data-like]',{like:id});await new Promise(setImmediate);assert.equal(game.world.fighter(id).likes,1);
    assert.ok(el('#fight-bars').innerHTML.includes(`data-like="${id}" aria-pressed="true"`));
    click('[data-like]',{like:id});await new Promise(setImmediate);assert.equal(game.world.fighter(id).likes,0);
    assert.ok(el('#fight-bars').innerHTML.includes(`data-like="${id}" aria-pressed="false"`));
    click('[data-like]',{like:id});await new Promise(setImmediate);assert.equal(game.world.fighter(id).likes,1);
    game.world.fighter(id).simulatedLikes=7;await intervals[0]();
    assert.match(el('#fight-bars').innerHTML,/Симуляция: ♥ 7/);assert.equal(game.world.fighter(id).likes,1);
    game.action('b',{type:'support',requestId:randomUUID(),fighterId:id,points:3,expected:game.world.supportStatus(id).key});
    await intervals[0]();assert.match(el('#fight-bars').innerHTML,/5 очк/);
    const before=game.state.now;await intervals[0]();assert.equal(game.state.now,before,'браузер не запускает симуляцию');
    click('[data-ticket]',{ticket:id,tournament:game.state.tournament.id});el('#bet-amount').value='500';await el('#bet-form').onsubmit({preventDefault(){}});
    assert.equal(game.player('a').bets.length,1);assert.equal(requests.at(-1).type,'bet');
    el('#add').onclick();
    el('#region-search').value='каз';el('#region-search').oninput();assert.match(el('#region-select').innerHTML,/Казань/);assert.doesNotMatch(el('#region-select').innerHTML,/Абакан/);
    el('#region-search').value='ТАТАРСТАН';el('#region-search').oninput();assert.match(el('#region-select').innerHTML,/Казань/);assert.match(el('#region-select').innerHTML,/Альметьевск/);
    el('#region-search').value='неизвестный город 12345';el('#region-search').oninput();assert.match(el('#region-results').textContent,/Ничего не найдено/);assert.equal(el('#region-select').value,'');
    el('#region-search').value='моск';el('#region-search').oninput();assert.match(el('#region-select').innerHTML,/Московская область/);
    el('#region-select').value='Москва';el('#region-select').onchange();assert.match(el('#region-flag-preview').innerHTML,/Флаг: Москва/);
    const fields=new Map([['name','Новый участник'],['description','История'],['region','Москва']]);
    globalThis.FormData=class{get(k){return fields.get(k);}};
    await el('#create-form').onsubmit({preventDefault(){},currentTarget:{querySelector:()=>({disabled:false})}});
    assert.equal(requests.at(-1).type,'create');assert.equal(game.view('b').fighters.at(-1).name,'Новый участник');
    offline=true;await intervals[0]();assert.match(el('#connection-state').textContent,/Связь потеряна/);assert.equal(game.state.now,before);
    offline=false;await intervals[0]();assert.match(el('#connection-state').textContent,/подключено/);
    await el('#account').onclick();assert.ok(el('#modal-content').innerHTML.includes(codes.a));
    await el('#save-code').onclick();assert.equal(codeSaved,true);
    el('#guid-login-code').value=codes.b;await el('#guid-login-form').onsubmit({preventDefault(){}});
    assert.equal(viewer,'b');assert.ok(el('#modal-content').innerHTML.includes(codes.b));assert.match(el('#paid-balance').textContent,/13.?500/);
    el('#guid-login-code').value='wrong';await el('#guid-login-form').onsubmit({preventDefault(){}});
    assert.match(el('#guid-login-error').textContent,/заблокирован/);assert.equal(el('#guid-login-submit').disabled,true);assert.equal(el('#guid-login-code').disabled,true);
    const paidBefore=game.player(viewer).paidBalanceMinor;
    await el('#free-topup').onclick();assert.equal(game.player(viewer).balance,25000);assert.equal(game.player(viewer).paidBalanceMinor,paidBefore);
    await el('#topup').onclick();assert.match(el('#modal-content').innerHTML,/Пополнение через ЮKassa/);
    el('#payment-amount').value='500';el('#payment-email').value='receipt@example.com';
    await el('#payment-form').onsubmit({preventDefault(){}});assert.equal(checkouts.length,1);assert.equal(checkouts[0].amount,500);assert.equal(redirected,'https://yoomoney.ru/checkout/fixture');
    await el('#payment-form').onsubmit({preventDefault(){}});assert.equal(checkouts[0].requestId,checkouts[1].requestId);assert.equal(game.player(viewer).paidBalanceMinor,paidBefore);
  }finally{Object.assign(globalThis,original);}
});
