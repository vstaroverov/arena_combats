import test from 'node:test';
import assert from 'node:assert/strict';
import {PresenceStore,simulatedPresence} from '../presence.mjs';
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

test('simulated audience peaks morning and evening by Moscow time, with shared smooth variation',()=>{
  const at=hour=>Date.parse(`2026-10-26T${String(hour).padStart(2,'0')}:00:00+03:00`);
  const night=simulatedPresence(at(4)).online,day=simulatedPresence(at(13)).online;
  for(const hour of [8,21]){
    assert.ok(simulatedPresence(at(hour)).online>night*3);
    assert.ok(simulatedPresence(at(hour)).online>day*1.7);
  }
  const first=at(0);let previous=simulatedPresence(first,'live'),changed=false;
  for(let offset=5000;offset<=86400000;offset+=5000){
    const now=first+offset,current=simulatedPresence(now,'live');
    assert.deepEqual(current,simulatedPresence(now,'live'));
    assert.ok(current.online>=1500&&current.online<10000);
    assert.ok(current.watching>0&&current.watching<current.online);
    assert.ok(Math.abs(current.online-previous.online)<200,'no abrupt five-second jumps');
    changed ||= current.online!==previous.online;previous=current;
  }
  assert.ok(changed);
  for(const phase of ['waiting','result'])assert.equal(simulatedPresence(first,phase).watching,0);
  assert.ok(simulatedPresence(first,'break').watching<simulatedPresence(first,'live').watching);
  assert.ok(Math.abs(simulatedPresence(first-1).online-simulatedPresence(first).online)<=1,'continuous across midnight');
});
