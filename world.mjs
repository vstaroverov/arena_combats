import {regions} from './dist/regions.js';
import {cities} from './dist/cities.js';
import {startSeason,selectEvent,upgradeBracket,completeMatch,nextMatch,readyAt} from './dist/league.js';
import {event,recover,healthy,clamp} from './dist/engine.js';
import {settleBets} from './dist/betting.js';
import {ensureEconomy,awardBout,trainOutsideBout} from './dist/economy.js';
import {prunePlayer,pruneAwards} from './retention.mjs';
const names=['Артём','Тимур','Руслан','Марат','Александр','Денис','Алан','Роман','Дамир','Максим','Сергей','Адам','Виктор','Илья','Михаил','Андрей'];
const surnames=['Соколов','Волков','Громов','Орлов','Морозов','Белов','Северин','Титов','Миронов','Лебедев','Савин','Ковалёв','Крылов'];
const nicknames=['Шторм','Север','Барс','Гранит','Искра','Титан','Вихрь','Сокол'];

function fresh(){const now=Date.now();return {version:1,now,balance:15000,started:false,season:1,cup:0,history:[],champions:[],fighters:regions.map((region,i)=>{const a=45+i*7%31,b=Math.max(100-a,Math.min(140-a,50+i*11%21));return {id:'r'+i,name:names[i%names.length]+' '+surnames[(i*3+Math.floor(i/16))%surnames.length],nickname:nicknames[i%8],region,seed:i,stats:[a,b,180-a-b],wins:0,losses:0,rating:1000,injuries:[],fatigue:0,restAt:now,readyAt:now,total:0,awards:[],own:false};}),tournament:null};}

export function createWorld(saved,now=Date.now()){
  let state=saved||fresh();
  if(!saved){state.now=now;state.fighters.forEach(f=>{f.restAt=now;f.readyAt=now;});}
  state.players??={};state.started=true;
  const fighter=id=>state.fighters.find(f=>f.id===id);
  const statNames=['Сила','Ловкость','Выносливость'];
  const coins=n=>n+' ◈';
  state.bets??=[];
  // По два участника на город дают реальные местные отборы.
  cities.forEach((city,i)=>{for(let j=0;j<2;j++){
    const id=`city-${i}-${j}`;if(state.fighters.some(f=>f.id===id))continue;
    const seed=1000+i*2+j,a=50+seed%21;
    state.fighters.push({id,name:names[seed%names.length]+' '+surnames[Math.floor(seed/names.length)%surnames.length],nickname:nicknames[seed%8],region:city.name,seed,stats:[a,60,120-a],wins:0,losses:0,rating:1000,injuries:[],fatigue:0,restAt:state.now,readyAt:state.now,total:0,awards:[],own:false,preparedSupport:0});
  }});
  if(!state.league&&state.tournament){
    state.league=startSeason(state.fighters,state.season||1,state.now);
    state.tournament.id='legacy-'+(state.tournament.number||0);state.tournament.stage=0;
    state.tournament.season=state.season||1;state.tournament.lastPlayed=0;
    state.league.events.unshift(state.tournament);
  }
  if(state.league&&state.tournament?.id){state.tournament=state.league.events.find(t=>t.id===state.tournament.id)||state.tournament;}
  if(state.tournament)upgradeBracket(state.tournament);
  // Старые сохранения получают пустой запас подготовки без сброса прогресса.
  state.likedFighters??=[];
  state.fighters.forEach(f=>{f.preparedSupport=Math.max(0,Number(f.preparedSupport)||0);f.likes=Math.max(0,Number(f.likes)||0);});
  ensureEconomy(state);
  function remaining(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
  function supportStatus(id){
    const side=match().ids.indexOf(id);
    const mode=side>=0&&t().phase!=='result'&&t().round<3?'current':'future';
    const prepared=fighter(id).preparedSupport||0;
    const points=mode==='current'?t().points[side]+(t().phase==='waiting'?prepared:0):prepared;
    return {side,mode,points,key:mode==='current'?`${t().id||t().number}:${t().index}:current`:`future:${id}`,reason:''};
  }
  function activatePreparedSupport(){
    pair().forEach((f,i)=>{t().points[i]+=(f.preparedSupport||0);f.preparedSupport=0;});
  }
  function createTournament(){
    if(!state.league)state.league=startSeason(state.fighters,state.season||1,state.now);
    let selection=selectEvent(state.league,state.fighters,state.now);
    if(!selection){state.season=(state.league.season||1)+1;state.league=startSeason(state.fighters,state.season,state.now);selection=selectEvent(state.league,state.fighters,state.now);}
    state.tournament=selection.t;resetBout(selection.at);
  }
  function resetBout(at){const tour=state.tournament;tour.points=[0,0];tour.round=1;tour.elapsed=0;tour.stats=[{hp:100,energy:100,damage:0},{hp:100,energy:100,damage:0}];tour.logs=[];tour.phase='waiting';tour.waitUntil=Math.max(state.now+15000,at);}
  if(!state.tournament)createTournament();
  const t=()=>state.tournament;
  const match=()=>t().matches[t().index];
  const pair=()=>match().ids.map(fighter);
  function log(text,highlight=false){t().logs.unshift({text,highlight,time:`${t().round}.${remaining(t().elapsed*1000)}`});t().logs=t().logs.slice(0,50);}
  function finish(winnerIndex,reason){
    const tour=t(),m=match(),[a,b]=pair(),winner=winnerIndex===0?a:b,loser=winnerIndex===0?b:a;
    m.reason=reason;winner.wins++;loser.losses++;
    const change=Math.round(28*(1-1/(1+10**((loser.rating-winner.rating)/400))));
    winner.rating+=change;loser.rating=Math.max(100,loser.rating-change);
    for(const f of [a,b]){f.fatigue=Math.min(.15,f.fatigue+.05);f.restAt=state.now;f.readyAt=state.now+600000;}
    completeMatch(tour,winner.id);
    Object.values(state.players).forEach(p=>{p.now=state.now;settleBets(p,tour);prunePlayer(p,state.now);});
    if(tour.done){
      state.cup++;winner.awardCount=(winner.awardCount||winner.awards.length)+1;winner.awards.push(tour.name+' · сезон '+(tour.season||state.season||1));pruneAwards(winner);
      state.champions.unshift({name:winner.name,cup:tour.name});state.champions=state.champions.slice(0,20);
    }
    state.history.unshift({winner:winner.name,loser:loser.name,reason,cup:tour.name});state.history=state.history.slice(0,30);
    tour.phase='result';tour.waitUntil=state.now+24000;
    const prizes=awardBout(state,tour,winner,loser);trainOutsideBout(state);
    log(`${winner.name} побеждает! ${reason}. Поддержка этого боя завершена.${prizes?' Призовые: '+coins(prizes.winner)+' победителю, '+coins(prizes.loser)+' сопернику.':''}`,true);
  }
  function prepareNext(){
    const tour=t();
    if(!state.league&&!tour.done){tour.index=nextMatch(tour);resetBout(readyAt(tour,tour.index,state.fighters,state.now));}
    else createTournament();

  }
  function tick(){
    if(!state.started)return;
    state.now+=1000;
    state.fighters.forEach(f=>recover(f,state.now));
    trainOutsideBout(state);
    const tour=t();
    if(tour.phase==='result'){
      if(state.now>=tour.waitUntil)prepareNext();
    }else if(tour.phase==='waiting'){
      if(state.now>=tour.waitUntil){
        tour.startedAt??=state.now;
        const fs=pair();
        if(fs.some(f=>!healthy(f,state.now))){
          const unavailable=fs.findIndex(f=>!healthy(f,state.now));
          finish(1-unavailable,'Техническое решение: медицинский недопуск');
        }else{
          activatePreparedSupport();tour.phase='live';log('Гонг! Бой начался.',true);
        }
      }
    }else if(tour.phase==='break'){
      if(state.now>=tour.waitUntil){
        tour.phase='live';
        tour.stats.forEach(s=>s.energy=clamp(s.energy+15,0,100));
        log('Начался следующий раунд.',true);
      }
    }else{
      tour.elapsed++;
      // Таймер обновляется каждую секунду, события — только раз в три секунды.
      if(tour.elapsed%3===0){
        const [a,b]=pair(),e=event(a,b,...tour.stats,...tour.points,state.now);
        const atk=e.side===0?a:b,def=e.side===0?b:a;
        tour.lastEvent={key:state.now,side:e.side,hit:e.hit};
        log(e.hit?`${atk.name}: попадание −${e.damage.toFixed(1)} HP.${e.injury?' '+e.injury.severity+' травма у '+def.name+' ('+statNames[e.injury.stat]+').':''}`:`${def.name} уходит от атаки ${atk.name}.`,!!e.injury);
        if(e.stopped){finish(e.side,e.injury?.severity==='Тяжёлая'?'Остановка из-за травмы':'Технический нокаут');return;}
        if(tour.round===4&&e.hit){finish(e.side,'Дополнительный раунд');return;}
      }
      if(tour.elapsed>=60){
        if(tour.round>=3){
          const diff=tour.stats[0].damage-tour.stats[1].damage;
          if(Math.abs(diff)<.00001){tour.round=4;tour.elapsed=0;log('Равный счёт. Дополнительный раунд до первого попадания.',true);}
          else{finish(diff>0?0:1,'Решение по нанесённому урону');return;}
        }else{
          tour.round++;tour.elapsed=0;tour.phase='break';tour.waitUntil=state.now+10000;log('Перерыв между раундами.');
        }
      }
    }



  }

  return {state,tick,supportStatus,fighter,log};
}
