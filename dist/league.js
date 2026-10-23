import {cityRegions} from './cities.js';
export const stages=['Городские отборы','Региональные чемпионаты','Межрегиональные кубки','Кубок мира','Суперфинал сезона'];
export const regionOf=f=>cityRegions[f.region]||f.region;

export function upgradeBracket(t){
  if(t.bracketVersion)return t;
  let width=(t.matches.length+1)/2,start=0,round=0;
  while(width>=1){
    for(let i=0;i<width;i++){
      const m=t.matches[start+i];m.complete=!!m.winner;m.roundSize=width*2;
      m.feed=round===0?null:[start-width*2+i*2,start-width*2+i*2+1];
    }
    start+=width;width/=2;round++;
  }
  t.bracketVersion=1;settle(t);return t;
}
export function settle(t){
  for(const m of t.matches){
    if(m.complete)continue;
    if(m.feed){if(!m.feed.every(i=>t.matches[i].complete))continue;m.ids=m.feed.map(i=>t.matches[i].winner);}
    if(m.ids.filter(Boolean).length<2){m.winner=m.ids.find(Boolean)||null;m.complete=true;m.bye=true;}
  }
  const final=t.matches.at(-1);
  if(final.complete){t.done=true;t.champion=final.winner;}
}
export function nextMatch(t){settle(t);return t.matches.findIndex(m=>!m.complete&&m.ids.every(Boolean)&&(!m.feed||m.feed.every(i=>t.matches[i].complete)));}
export function completeMatch(t,winner){const m=t.matches[t.index];m.winner=winner;m.complete=true;settle(t);}
export function bracket(ids,meta,now){
  const unique=[...new Set(ids)];let size=2;while(size<unique.length)size*=2;
  const half=size/2,matches=[];
  for(let i=0;i<half;i++)matches.push({ids:[unique[i]||null,unique[i+half]||null],winner:null});
  for(let i=half;i<size-1;i++)matches.push({ids:[null,null],winner:null});
  const t=upgradeBracket({...meta,matches,index:0,phase:'waiting',waitUntil:now+15000,points:[0,0],logs:[],round:1,elapsed:0,stats:[{hp:100,energy:100,damage:0},{hp:100,energy:100,damage:0}],champion:null,lastPlayed:0});
  t.index=Math.max(0,nextMatch(t));return t;
}
function groups(ids,fighters,key){const map=new Map();for(const id of ids){const f=fighters.find(f=>f.id===id);if(!f)continue;const name=key(f);if(!map.has(name))map.set(name,[]);map.get(name).push(id);}return [...map].sort((a,b)=>a[0].localeCompare(b[0],'ru'));}
function makeEvents(s,entries,now){return entries.map(([name,ids],i)=>bracket(ids,{id:`s${s.season}-${s.stage}-${i}`,name,stage:s.stage,season:s.season,number:i+1},now));}
export function startSeason(fighters,season,now){
  const league={season,stage:0,roster: fighters.map(f=>f.id),events:[],sequence:0,archive:[]};
  const local=fighters.filter(f=>cityRegions[f.region]);
  league.events=makeEvents(league,groups(local.map(f=>f.id),fighters,f=>f.region).map(([name,ids])=>['Отбор · '+name,ids]),now);
  return league;
}
export function advanceStage(s,fighters,now){
  const previous=s.events,champions=previous.map(t=>t.champion).filter(Boolean);
  s.archive.push({stage:s.stage,events:previous.length,champions:[...champions]});s.stage++;
  if(s.stage===1){
    const regional=s.roster.filter(id=>{const f=fighters.find(f=>f.id===id);return f&&!cityRegions[f.region];});
    // Новый созданный боец включается на ближайшей ещё доступной ступени.
    const newcomers=fighters.filter(f=>!s.roster.includes(f.id)).map(f=>f.id);
    s.events=makeEvents(s,groups([...new Set([...regional,...champions,...newcomers])],fighters,regionOf).map(([name,ids])=>['Чемпионат · '+name,ids]),now);
  }else if(s.stage===2){
    const entries=[];for(let i=0;i<champions.length;i+=8)entries.push(['Межрегиональный кубок · '+(i/8+1),champions.slice(i,i+8)]);
    s.events=makeEvents(s,entries,now);
  }else if(s.stage===3){s.events=makeEvents(s,[['Кубок мира · сезон '+s.season,champions]],now);}
  else if(s.stage===4){
    const world=previous[0];const top=world.matches.filter(m=>m.roundSize===4).flatMap(m=>m.ids);
    const ids=[...new Set((top.length?top:world.matches.at(-1).ids).filter(Boolean))];
    s.events=makeEvents(s,[['Суперфинал · сезон '+s.season,ids]],now);
  }else return false;
  return true;
}
export function readyAt(t,index,fighters,now){return Math.max(now,...t.matches[index].ids.map(id=>{
  const f=fighters.find(f=>f.id===id);
  return Math.max(f.readyAt||0,...(f.injuries||[]).filter(i=>i.severity==='Тяжёлая').map(i=>i.until));
}));}
export function selectEvent(s,fighters,now){
  for(let guard=0;guard<6;guard++){
    s.events.forEach(settle);
    const options=s.events.flatMap(t=>t.matches.map((m,index)=>({t,m,index})).filter(o=>!o.m.complete&&o.m.ids.every(Boolean)&&(!o.m.feed||o.m.feed.every(i=>t.matches[i].complete))));
    if(options.length){
      options.forEach(o=>o.at=readyAt(o.t,o.index,fighters,now));
      options.sort((a,b)=>a.at-b.at||a.t.lastPlayed-b.t.lastPlayed);
      const o=options[0];o.t.index=o.index;o.t.lastPlayed=++s.sequence;return o;
    }
    if(!advanceStage(s,fighters,now))return null;
  }
  return null;
}
export function roundLabel(m){return m.roundSize===2?'ФИНАЛ':m.roundSize===4?'½ ФИНАЛА':m.roundSize===8?'¼ ФИНАЛА':'1/'+(m.roundSize/2)+' ФИНАЛА';}
