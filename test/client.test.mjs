import test from 'node:test';
import assert from 'node:assert/strict';
import {createChannel} from '../dist/client.js';

test('запоздалый ответ опроса не возвращает старый профиль после входа по GUID',async()=>{
  const original={fetch:global.fetch,setInterval:global.setInterval};let poll,resolveOld,calls=0;const displayed=[];
  const a={sharedWorld:true,revision:1,balance:15000},b={sharedWorld:true,revision:2,balance:7000};
  const response=state=>({ok:true,json:async()=>state});
  global.setInterval=fn=>{poll=fn;};
  global.fetch=async url=>{
    if(url==='/api/account/login')return response({state:b,account:{saved:true}});
    if(calls++===0)return response(a);
    return new Promise(r=>{resolveOld=r;});
  };
  try{
    const channel=createChannel(s=>displayed.push(s),()=>{});await channel.initial();channel.start();
    const pending=poll();await channel.login('test-code');
    resolveOld(response({...a,revision:999}));await pending;
    assert.equal(displayed.at(-1).balance,7000);assert.equal(displayed.length,2);
  }finally{Object.assign(global,original);}
});
