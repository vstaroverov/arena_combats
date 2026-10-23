import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Game} from '../game.mjs';

test('интерфейс отправляет поддержку, лайк, ставку и создание на сервер; обновления общие',async()=>{
  const game=new Game(),elements=new Map(),handlers=new Map(),intervals=[],requests=[];
  const original=Object.fromEntries(['document','window','fetch','setInterval','setTimeout','sessionStorage','FormData'].map(k=>[k,globalThis[k]]));
  const el=s=>{if(!elements.has(s))elements.set(s,{value:s==='#sort'?'rating':'',dataset:{},style:{},innerHTML:'',textContent:'',open:false,classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(s);};
  const packages=[1,2,3].map(v=>({dataset:{package:String(v)}}));
  globalThis.document={querySelector:el,querySelectorAll:s=>s==='[data-package]'?packages:[],addEventListener:(name,fn)=>handlers.set(name,fn)};
  globalThis.window={};globalThis.sessionStorage={getItem(){return null;},setItem(){}};
  globalThis.setInterval=fn=>{intervals.push(fn);};globalThis.setTimeout=()=>0;
  let offline=false;
  globalThis.fetch=async(url,options={})=>{
    if(offline)throw Error('offline');
    if(url==='/api/state')return {ok:true,json:async()=>structuredClone(game.view('a'))};
    const a=JSON.parse(options.body);requests.push(a);
    try{const result=game.action('a',a);return {ok:true,json:async()=>({result,state:structuredClone(game.view('a'))})};}
    catch(error){return {ok:false,status:400,json:async()=>({error:error.message})};}
  };
  const click=(selector,dataset)=>handlers.get('click')({target:{closest:s=>s===selector?{dataset}:null}});
  try{
    await import('../dist/app.js?ui='+randomUUID());assert.equal(intervals.length,1);
    const id=game.state.tournament.matches[game.state.tournament.index].ids[0];
    click('[data-profile]',{profile:id});assert.match(el('#modal-content').innerHTML,/КАРТОЧКА БОЙЦА/);
    click('[data-support-fighter]',{supportFighter:id});await packages[1].onclick();
    assert.equal(requests.at(-1).type,'support');assert.equal(game.player('a').balance,14000);
    assert.deepEqual(game.state.tournament.points,[2,0]);
    click('[data-like]',{like:id});await new Promise(setImmediate);assert.equal(game.world.fighter(id).likes,1);
    game.action('b',{type:'support',requestId:randomUUID(),fighterId:id,points:3,expected:game.world.supportStatus(id).key});
    await intervals[0]();assert.match(el('#fight-bars').innerHTML,/5 очк/);
    const before=game.state.now;await intervals[0]();assert.equal(game.state.now,before,'браузер не запускает симуляцию');
    click('[data-ticket]',{ticket:id,tournament:game.state.tournament.id});el('#bet-amount').value='500';await el('#bet-form').onsubmit({preventDefault(){}});
    assert.equal(game.player('a').bets.length,1);assert.equal(requests.at(-1).type,'bet');
    el('#add').onclick();const fields=new Map([['name','Новый участник'],['description','История'],['region','Москва']]);
    globalThis.FormData=class{get(k){return fields.get(k);}};
    await el('#create-form').onsubmit({preventDefault(){},currentTarget:{querySelector:()=>({disabled:false})}});
    assert.equal(requests.at(-1).type,'create');assert.equal(game.view('b').fighters.at(-1).name,'Новый участник');
    offline=true;await intervals[0]();assert.match(el('#connection-state').textContent,/Связь потеряна/);assert.equal(game.state.now,before);
    offline=false;await intervals[0]();assert.match(el('#connection-state').textContent,/подключено/);
  }finally{Object.assign(globalThis,original);}
});
