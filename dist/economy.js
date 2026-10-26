export const skillNames=['Сила','Ловкость','Выносливость'];
export function ensureFighterEconomy(f){
  f.economy??={coins:0,prizeTotal:0,donationTotal:0,trainingSpent:0,gains:[0,0,0],originStats:[...f.stats],history:[],legacySupportCount:f.total||0};
  return f.economy;
}
export function ensureEconomy(state){
  state.arena??={coins:0,income:0,prizesPaid:0,supportIncome:0,creationIncome:0,leagueIncome:0,history:[]};
  state.fighters.forEach(ensureFighterEconomy);return state.arena;
}
function entry(account,now,text,amount){account.history.unshift({now,text,amount});account.history=account.history.slice(0,40);}
function arenaCredit(state,amount,type,text){const a=state.arena;a.coins+=amount;a.income+=amount;a[type]+=amount;entry(a,state.now,text,amount);}
export function creditSupport(state,f,amount,paid=false){
  ensureEconomy(state);if(!Number.isSafeInteger(amount)||amount<=0)throw Error('Некорректная сумма поддержки');
  const share=Math.floor(amount*.8),fee=amount-share,e=ensureFighterEconomy(f);
  e.coins+=share;e.donationTotal+=amount;
  if(paid)e.paidDonationTotal=(e.paidDonationTotal||0)+amount;
  entry(e,state.now,'Поддержка команды: '+amount+' ₽',share);
  arenaCredit(state,fee,'supportIncome','Доля поддержки · '+f.name);return {fighterCoins:share,arenaCoins:fee};
}
export function creditCreation(state,amount){ensureEconomy(state);arenaCredit(state,amount,'creationIncome','Заявка нового бойца');}
export function awardBout(state,t,winner,loser){
  ensureEconomy(state);const m=t.matches[t.index];if(m.economyPaid)return null;m.economyPaid=true;
  if(m.bye||m.reason?.startsWith('Техническое решение'))return null;
  const stage=Math.max(0,Math.min(4,t.stage||0)),scale=2**stage;
  const champion=t.done&&t.champion===winner.id?[1000,2500,5000,12000,25000][stage]:0;
  const win=300*scale+champion,loss=100*scale,fee=100*scale;
  arenaCredit(state,win+loss+fee,'leagueIncome','Награда лиги · '+t.name);
  for(const [f,amount] of [[winner,win],[loser,loss]]){
    const e=ensureFighterEconomy(f);e.coins+=amount;e.prizeTotal+=amount;
    state.arena.coins-=amount;state.arena.prizesPaid+=amount;
    entry(e,state.now,'Призовые · '+t.name,amount);entry(state.arena,state.now,'Призовые · '+f.name,-amount);
  }
  return {winner:win,loser:loss,arena:fee};
}
export function trainingCost(f){const e=ensureFighterEconomy(f);return 1000*(1+e.gains.reduce((a,b)=>a+b,0));}
export function trainFighter(f,now){
  const e=ensureFighterEconomy(f);let improvements=0;
  if(e.coins<trainingCost(f))return 0;
  for(let guard=0;guard<30;guard++){
    const eligible=f.stats.map((v,i)=>({v,i})).filter(({v,i})=>e.gains[i]<10&&v<Math.min(100,e.originStats[i]+10)).sort((a,b)=>a.v-b.v||a.i-b.i);
    if(!eligible.length)break;
    const cost=trainingCost(f);if(e.coins<cost)break;
    const i=eligible[0].i;e.coins-=cost;e.trainingSpent+=cost;e.gains[i]++;f.stats[i]++;improvements++;
    entry(e,now,'Тренировка: '+skillNames[i]+' +1',-cost);
  }
  return improvements;
}
export function trainOutsideBout(state){
  const t=state.tournament;
  const busy=t&&['live','break'].includes(t.phase)?t.matches[t.index].ids:[];
  for(const f of state.fighters)if(!busy.includes(f.id))trainFighter(f,state.now);
}
