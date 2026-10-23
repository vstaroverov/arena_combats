import test from 'node:test';
import assert from 'node:assert/strict';
import {regions} from '../dist/regions.js';
import {cities} from '../dist/cities.js';
import {startSeason,selectEvent,completeMatch,bracket,nextMatch,readyAt} from '../dist/league.js';
const roster=()=>[...regions.map((region,i)=>({id:'r'+i,region})),...cities.flatMap((c,i)=>[0,1].map(j=>({id:`c${i}-${j}`,region:c.name})))].map(f=>({...f,readyAt:0,injuries:[]}));

test('полный сезон проводит всех бойцов через отборы к Кубку мира и суперфиналу',()=>{
  const fighters=roster(),league=startSeason(fighters,1,0),played=new Set(),stages=new Set();let now=0,count=0;
  for(let guard=0;guard<1500;guard++){
    const selected=selectEvent(league,fighters,now);if(!selected)break;
    const {t,index,at}=selected;assert.equal(t.index,index);now=at;stages.add(t.stage);
    const ids=t.matches[index].ids;assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
    for(const id of ids){played.add(id);const f=fighters.find(f=>f.id===id);assert.ok(now>=f.readyAt);f.readyAt=now+600000;}
    completeMatch(t,ids[count++%2]);now+=180000;
  }
  assert.deepEqual([...stages],[0,1,2,3,4]);
  assert.equal(played.size,fighters.length,'все бойцы реально выступили, включая получавших свободный проход');
  assert.equal(league.stage,5);assert.ok(count>400);assert.ok(league.events[0].champion);
  assert.equal(league.archive[0].events,170);
});

test('пока один турнир ждёт восстановления, выбирается готовый бой другого',()=>{
  const fighters=roster(),s=startSeason(fighters,1,0),first=selectEvent(s,fighters,0);
  for(const id of first.t.matches[first.index].ids)fighters.find(f=>f.id===id).readyAt=600000;
  const other=selectEvent(s,fighters,0);assert.notEqual(other.t.id,first.t.id);assert.equal(other.at,0);
});

test('сетки разных размеров продвигают победителей, свободные проходы не создают фиктивных боёв',()=>{
  for(const n of [2,3,5,8,12,22,32]){
    const ids=Array.from({length:n},(_,i)=>String(i)),t=bracket(ids,{name:'Тест'},0);let fights=0;
    while(!t.done){const i=nextMatch(t);assert.ok(i>=0);t.index=i;assert.ok(t.matches[i].ids.every(Boolean));completeMatch(t,t.matches[i].ids[0]);fights++;}
    assert.equal(fights,n-1);assert.ok(ids.includes(t.champion));
  }
});

test('победители предыдущей ступени — единственные участники следующих кубков',()=>{
  const fighters=roster(),s=startSeason(fighters,1,0);let now=0;
  while(s.stage<3){const selected=selectEvent(s,fighters,now);if(s.stage===3)break;completeMatch(selected.t,selected.t.matches[selected.index].ids[0]);now+=600000;}
  const qualifiers=new Set(s.archive.find(a=>a.stage===2).champions);
  const worldIds=new Set(s.events[0].matches.filter(m=>!m.feed).flatMap(m=>m.ids).filter(Boolean));
  assert.deepEqual(worldIds,qualifiers);
});
