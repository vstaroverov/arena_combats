import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handlePaymentReturn} from '../dist/payment-ui.js';

function fixture(responses){
  const calls=[],messages=[];let home=false,done=0;
  const options={id:randomUUID(),onHome(){home=true;},onStatus:s=>messages.push(s),onDone(){done++;},sleep:async()=>{},
    channel:{async checkPayment(id){assert.equal(home,true,'arena opens before payment check');calls.push(id);const response=responses.shift();if(response instanceof Error)throw response;return response;}}};
  return {options,calls,messages,get done(){return done;}};
}
test('payment return opens arena and waits for verified success without reopening checkout',async()=>{
  const f=fixture([{status:'pending'},{status:'succeeded',test:false}]);
  const result=await handlePaymentReturn(f.options);
  assert.equal(result.status,'succeeded');assert.equal(f.calls.length,2);assert.equal(f.done,1);assert.match(f.messages.at(-1),/Платный баланс обновлён/);
});
test('test payment return explains separate sandbox credit',async()=>{
  const f=fixture([{status:'succeeded',test:true}]);await handlePaymentReturn(f.options);
  assert.equal(f.done,1);assert.match(f.messages.at(-1),/Тестовый баланс обновлён/);assert.match(f.messages.at(-1),/Боевой баланс не меняется/);
});
test('canceled and pending payment returns never report credit',async()=>{
  const canceled=fixture([{status:'canceled'}]);await handlePaymentReturn(canceled.options);assert.equal(canceled.done,1);assert.match(canceled.messages.at(-1),/Зачисления нет/);
  const pending=fixture(Array.from({length:6},()=>({status:'pending'})));await handlePaymentReturn(pending.options);
  assert.equal(pending.calls.length,6);assert.equal(pending.done,0,'keep return URL for refresh');assert.match(pending.messages.at(-1),/пока обрабатывает/);
});
test('payment return retries network errors and preserves recovery on failure',async()=>{
  const recovery=fixture([Error('offline'),{status:'succeeded'}]);await handlePaymentReturn(recovery.options);assert.equal(recovery.done,1);
  const failure=fixture(Array.from({length:6},()=>Error('offline')));await handlePaymentReturn(failure.options);
  assert.equal(failure.done,0);assert.match(failure.messages.at(-1),/временно недоступна/);
});
test('payment return rejects invalid IDs and stops after profile change',async()=>{
  const invalid=fixture([]);invalid.options.id='spoofed-success';await handlePaymentReturn(invalid.options);assert.equal(invalid.calls.length,0);assert.equal(invalid.done,0);
  const switched=fixture([{status:'pending'},{status:'succeeded'}]);let current=true;
  switched.options.isCurrent=()=>current;switched.options.sleep=async()=>{current=false;};
  await handlePaymentReturn(switched.options);assert.equal(switched.calls.length,1);assert.equal(switched.done,0);
});
