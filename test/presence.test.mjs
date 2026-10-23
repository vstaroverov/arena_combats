import test from 'node:test';
import assert from 'node:assert/strict';
import {PresenceStore} from '../presence.mjs';
const tab=(id,visitorId='visitor-1',extra={})=>({tabId:id,visitorId,online:true,watching:true,fightId:'fight-1',...extra});
test('счётчик различает онлайн, текущий бой и другой бой, не дублирует браузер',()=>{
  const p=new PresenceStore();p.update(tab('tab-one1'),0);p.update(tab('tab-two2'),0);
  assert.deepEqual(p.count('fight-1',0),{online:1,watching:1});
  p.update(tab('tab-three','visitor-2',{fightId:'fight-2'}),0);
  p.update(tab('tab-four','visitor-3',{watching:false}),0);
  assert.deepEqual(p.count('fight-1',0),{online:3,watching:1});
});
test('скрытые и закрытые вкладки исключаются, пропавший клиент истекает по таймеру',()=>{
  const p=new PresenceStore();p.update(tab('tab-one1'),0);p.update(tab('tab-two2'),0);
  p.update(tab('tab-one1','visitor-1',{online:false}),100);
  assert.deepEqual(p.count('fight-1',100),{online:1,watching:1});
  assert.deepEqual(p.count('fight-1',20000),{online:0,watching:0});
});
test('некорректные данные не добавляют зрителей',()=>{
  const p=new PresenceStore();assert.throws(()=>p.update({}));assert.deepEqual(p.count('fight-1'),{online:0,watching:0});
});
