import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureEconomy,creditSupport,creditCreation,awardBout,trainingCost,trainFighter,trainOutsideBout} from '../dist/economy.js';
import {bracket,completeMatch} from '../dist/league.js';
const fixture=()=>{const state={now:100,balance:10000,fighters:['a','b'].map(id=>({id,name:id,stats:[60,60,60],total:0}))};ensureEconomy(state);return state;};
test('поддержка делится 80/20, сумма донатов считается отдельно от монет',()=>{
  const s=fixture();creditSupport(s,s.fighters[0],1500);
  const e=s.fighters[0].economy;assert.equal(e.coins,1200);assert.equal(e.donationTotal,1500);assert.equal(s.arena.coins,300);assert.equal(s.arena.supportIncome,300);
  assert.equal(s.balance,10000,'списание пользовательского баланса остаётся обязанностью операции поддержки');
});
test('призовые поступают бойцам, казна сохраняет награду арены; повторная выплата исключена',()=>{
  const s=fixture(),t=bracket(['a','b'],{id:'t',stage:0,name:'Кубок'},100);completeMatch(t,'a');
  const result=awardBout(s,t,...s.fighters);assert.deepEqual(result,{winner:1300,loser:100,arena:100});
  assert.equal(s.fighters[0].economy.prizeTotal,1300);assert.equal(s.arena.prizesPaid,1400);assert.equal(s.arena.income,1500);assert.equal(s.arena.coins,100);
  assert.equal(awardBout(s,t,...s.fighters),null);assert.equal(s.arena.prizesPaid,1400);
});
test('монеты превращаются в навыки по растущей цене и не выходят за предел развития',()=>{
  const s=fixture(),f=s.fighters[0];f.economy.coins=6000;assert.equal(trainFighter(f,100),3);
  assert.deepEqual(f.stats,[61,61,61]);assert.equal(f.economy.trainingSpent,6000);assert.equal(f.economy.coins,0);assert.equal(trainingCost(f),4000);
  f.economy.coins=1000000;trainFighter(f,200);assert.deepEqual(f.stats,[70,70,70]);assert.equal(f.economy.gains.reduce((a,b)=>a+b,0),30);
  const balance=f.economy.coins;assert.equal(trainFighter(f,300),0);assert.equal(f.economy.coins,balance);
});
test('во время боя навыки не меняются, после боя накопленное конвертируется',()=>{
  const s=fixture();s.fighters[0].economy.coins=1000;s.tournament={phase:'live',index:0,matches:[{ids:['a','b']}]};
  trainOutsideBout(s);assert.deepEqual(s.fighters[0].stats,[60,60,60]);
  s.tournament.phase='result';trainOutsideBout(s);assert.deepEqual(s.fighters[0].stats,[61,60,60]);
});
test('казна сохраняет равенство поступления минус призовые и не меняет старые достижения',()=>{
  const s=fixture();s.fighters[0].total=10;ensureEconomy(s);creditCreation(s,5500);creditSupport(s,s.fighters[0],500);
  assert.equal(s.arena.coins,s.arena.income-s.arena.prizesPaid);assert.equal(s.arena.creationIncome,5500);assert.equal(s.fighters[0].total,10);
  const copy=JSON.parse(JSON.stringify(s));ensureEconomy(copy);assert.deepEqual(copy.arena,s.arena);assert.deepEqual(copy.fighters[0].economy,s.fighters[0].economy);
});
test('технический проход без боя не создаёт призовых или доход арене',()=>{
  const s=fixture(),t=bracket(['a','b'],{id:'t',stage:0,name:'Кубок'},100);t.matches[0].reason='Техническое решение: медицинский недопуск';completeMatch(t,'b');
  assert.equal(awardBout(s,t,s.fighters[1],s.fighters[0]),null);assert.equal(s.arena.coins,0);assert.equal(s.fighters[1].economy.prizeTotal,0);
});
