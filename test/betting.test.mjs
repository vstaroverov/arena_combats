import test from 'node:test';
import assert from 'node:assert/strict';
import {bracket,completeMatch,nextMatch} from '../dist/league.js';
import {bettingOpen,quoteTournament,placeBet,settleBets} from '../dist/betting.js';
const f=(id,stats=[60,60,60])=>({id,name:id,stats,injuries:[],fatigue:0,preparedSupport:0});
function fixture(fighters=[f('a'),f('b')]){const state={now:100,balance:10000,fighters,bets:[]};const t=bracket(fighters.map(f=>f.id),{id:'test',name:'Тест'},100);return {state,t};}

test('коэффициент фаворита ниже, вероятности участников в сумме дают 100%',()=>{
  const {state,t}=fixture([f('a',[80,80,80]),f('b',[40,40,40])]);
  const q=quoteTournament(t,state.fighters,state.now);
  assert.ok(q.byId.a.probability>q.byId.b.probability);assert.ok(q.byId.a.odds<q.byId.b.odds);
  assert.ok(Math.abs(Object.values(q.byId).reduce((sum,o)=>sum+o.probability,0)-1)<1e-12);
});
test('сетка и свободные проходы учитываются в шансах на титул',()=>{
  const {state,t}=fixture([f('a'),f('b'),f('c')]);const q=quoteTournament(t,state.fighters,state.now);
  assert.equal(q.byId.b.probability,.5);assert.equal(q.byId.a.probability,.25);assert.equal(q.byId.c.probability,.25);
  assert.equal(q.byId.b.odds,2);assert.equal(q.byId.a.odds,4);
});
test('поддержка повышает шанс, травмы и усталость снижают его',()=>{
  const {state,t}=fixture();const initial=quoteTournament(t,state.fighters,state.now).byId.a.probability;
  state.fighters[0].preparedSupport=9;assert.ok(quoteTournament(t,state.fighters,state.now).byId.a.probability>initial);
  const nine=quoteTournament(t,state.fighters,state.now).byId.a.probability;
  state.fighters[0].preparedSupport=30;assert.ok(quoteTournament(t,state.fighters,state.now).byId.a.probability>nine);
  state.fighters[0].preparedSupport=0;state.fighters[0].injuries=[{stat:1,penalty:.2,until:1000}];state.fighters[0].fatigue=.1;
  assert.ok(quoteTournament(t,state.fighters,state.now).byId.a.probability<initial);
});
test('ставка списывается, коэффициент фиксируется, выплата начисляется один раз с учётом суммы ставки',()=>{
  const {state,t}=fixture(),q=quoteTournament(t,state.fighters,state.now),bet=placeBet(state,t,'a',500,q);
  assert.equal(state.balance,9500);assert.equal(bet.odds,2);t.startedAt=state.now;
  state.fighters[0].stats=[80,80,80];completeMatch(t,'a');
  assert.equal(settleBets(state,t),1000);assert.equal(state.balance,10500);assert.equal(bet.status,'won');
  assert.equal(settleBets(state,t),0);assert.equal(state.balance,10500);
});
test('проигрыш не возвращает ставку; отмена без чемпиона возвращает её ровно один раз',()=>{
  const {state,t}=fixture();placeBet(state,t,'b',500,quoteTournament(t,state.fighters,state.now));completeMatch(t,'a');
  assert.equal(settleBets(state,t),0);assert.equal(state.balance,9500);assert.equal(state.bets[0].status,'lost');
  const second=fixture();placeBet(second.state,second.t,'a',500,quoteTournament(second.t,second.state.fighters,100));second.t.done=true;second.t.champion=null;
  assert.equal(settleBets(second.state,second.t),500);assert.equal(second.state.balance,10000);assert.equal(settleBets(second.state,second.t),0);
});
test('невалидные суммы, устаревший коэффициент и начавшийся турнир не списывают баланс',()=>{
  const {state,t}=fixture();const q=quoteTournament(t,state.fighters,state.now);
  for(const amount of [-500,0,99,100.5,NaN,Infinity,10001])assert.throws(()=>placeBet(state,t,'a',amount,q));
  state.fighters[0].preparedSupport=1;assert.throws(()=>placeBet(state,t,'a',500,q),/изменилось/);
  t.startedAt=100;assert.equal(bettingOpen(t),false);assert.throws(()=>placeBet(state,t,'a',500,q),/закрыт/);
  assert.equal(state.balance,10000);assert.equal(state.bets.length,0);
});
test('приём закрыт после первого боя, даже когда турнир ждёт следующий матч',()=>{
  const {state,t}=fixture([f('a'),f('b'),f('c'),f('d')]);t.index=nextMatch(t);completeMatch(t,t.matches[t.index].ids[0]);
  t.phase='waiting';assert.equal(bettingOpen(t),false);assert.throws(()=>placeBet(state,t,'c',500,quoteTournament(t,state.fighters,100)));
});
