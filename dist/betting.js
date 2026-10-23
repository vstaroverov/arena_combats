import {effective,clamp} from './engine.js';
export function bettingOpen(t){return !t.done&&!t.startedAt&&!['live','break','result'].includes(t.phase)&&!t.matches.some(m=>m.complete&&!m.bye);}
export function entrants(t){return [...new Set(t.matches.filter(m=>!m.feed).flatMap(m=>m.ids).filter(Boolean))];}
function duel(a,b){
  const chance=(x,y)=>clamp(.6+.003*(x[1]-y[1]),.35,.8);
  const score=(x,y)=>Math.max(.01,x[0]*x[1]*chance(x,y)*(.8+.2*x[2]/60));
  const x=score(a,b),y=score(b,a);
  return clamp(1/(1+Math.exp(-5*Math.log(x/y))),.02,.98);
}
// Вероятности суммируются по реальным ветвям сетки, включая свободные проходы.
export function quoteTournament(t,fighters,now){
  const snapshot={};
  for(const id of entrants(t)){
    const f=fighters.find(f=>f.id===id);if(!f)throw Error('Участник не найден');
    const side=t.matches[t.index].ids.indexOf(id);
    const points=(f.preparedSupport||0)+(side>=0&&t.phase==='waiting'?t.points[side]:0);
    snapshot[id]=[effective(f,points,now),effective(f,0,now)];
  }
  const distributions=t.matches.map(m=>{
    if(!m.feed)return m.ids.map(id=>id?new Map([[id,{p:1,fights:0}]]):new Map());
    return null;
  });
  const winners=[];
  t.matches.forEach((m,index)=>{
    const [left,right]=m.feed?m.feed.map(i=>winners[i]):distributions[index];
    if(!left.size||!right.size){winners[index]=new Map(left.size?left:right);return;}
    const out=new Map();
    for(const [a,sa] of left)for(const [b,sb] of right){
      const p=duel(snapshot[a][sa.fights?1:0],snapshot[b][sb.fights?1:0]),mass=sa.p*sb.p;
      for(const [id,s,weight] of [[a,sa,p],[b,sb,1-p]])out.set(id,{p:(out.get(id)?.p||0)+mass*weight,fights:s.fights+1});
    }
    winners[index]=out;
  });
  const byId=Object.fromEntries([...winners.at(-1)].map(([id,s])=>[id,{probability:s.p,odds:Math.floor(clamp(1/s.p,1.01,100)*100)/100}]));
  return {byId,fingerprint:JSON.stringify(snapshot)};
}
export function placeBet(state,t,fighterId,stake,quote){
  if(!bettingOpen(t))throw Error('Турнир уже начался. Приём ставок закрыт.');
  if(!Number.isSafeInteger(stake)||stake<100)throw Error('Минимальная ставка — 100 ₽, целым числом.');
  if(!Number.isFinite(state.balance)||stake>state.balance)throw Error('Недостаточно средств на игровом балансе.');
  const current=quoteTournament(t,state.fighters,state.now);
  if(current.fingerprint!==quote.fingerprint)throw Error('Состояние бойцов изменилось. Обнови коэффициент перед ставкой.');
  const selection=current.byId[fighterId];if(!selection)throw Error('Боец не участвует в этом турнире.');
  const bet={id:'bet-'+((state.betSerial||0)+1),tournamentId:t.id,tournamentName:t.name,fighterId,fighterName:state.fighters.find(f=>f.id===fighterId).name,stake,odds:selection.odds,probability:selection.probability,status:'open',placedAt:state.now,payout:0};
  state.betSerial=(state.betSerial||0)+1;state.bets??=[];state.bets.push(bet);state.balance=Math.round((state.balance-stake)*100)/100;
  return bet;
}
export function settleBets(state,t){
  if(!t.done)return 0;let total=0;
  for(const bet of state.bets||[]){
    if(bet.tournamentId!==t.id||bet.status!=='open')continue;
    bet.status=!t.champion?'refunded':bet.fighterId===t.champion?'won':'lost';
    bet.payout=bet.status==='refunded'?bet.stake:bet.status==='won'?Math.round(bet.stake*bet.odds*100)/100:0;
    bet.settledAt=state.now;total+=bet.payout;
  }
  state.balance=Math.round((state.balance+total)*100)/100;return total;
}
