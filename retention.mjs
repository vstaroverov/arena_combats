export const DAY=86400000;
export const RETENTION={settledBetsDays:30,settledBetsLimit:100,receiptsDays:7,receiptsLimit:200,awardsLimit:50,sessionDays:365,retiredSessionDays:7,emptyGuestDays:30};

export function emptyPlayer(p){
  return p.balance===15000&&!p.bets?.length&&!p.likedFighters?.length&&!p.receipts?.length&&!p.betSerial&&!p.lastTopup&&!p.archivedBets?.count;
}

export function prunePlayer(player,now){
  const open=[],closed=[];
  for(const bet of player.bets||[])(bet.status==='open'?open:closed).push(bet);
  closed.sort((a,b)=>(b.settledAt||b.placedAt||0)-(a.settledAt||a.placedAt||0));
  const keep=[],removed=[];
  for(const bet of closed){
    if(keep.length<RETENTION.settledBetsLimit&&(bet.settledAt||bet.placedAt||now)>now-RETENTION.settledBetsDays*DAY)keep.push(bet);
    else removed.push(bet);
  }
  if(removed.length){
    const totals=player.archivedBets??={count:0,stake:0,payout:0,won:0,lost:0,refunded:0};
    for(const bet of removed){totals.count++;totals.stake+=bet.stake||0;totals.payout+=bet.payout||0;if(bet.status in totals)totals[bet.status]++;}
  }
  player.bets=[...open,...keep].sort((a,b)=>(a.placedAt||0)-(b.placedAt||0));
  const previous=player.receipts||[];
  // Old receipts get one grace period when upgrading, rather than disappearing.
  previous.forEach(r=>r.at??=now);
  player.receipts=previous.filter(r=>r.at>now-RETENTION.receiptsDays*DAY).slice(-RETENTION.receiptsLimit);
  return {bets:removed.length,receipts:previous.length-player.receipts.length};
}

export function pruneAwards(fighter){
  const awards=fighter.awards||[];
  fighter.awardCount=Math.max(fighter.awardCount||0,awards.length);
  const removed=Math.max(0,awards.length-RETENTION.awardsLimit);
  fighter.awards=awards.slice(-RETENTION.awardsLimit);return removed;
}

export function pruneWorld(state,now){
  const counts={bets:0,receipts:0,awards:0,logs:0};
  for(const player of Object.values(state.players)){
    const pruned=prunePlayer(player,now);counts.bets+=pruned.bets;counts.receipts+=pruned.receipts;
  }
  for(const f of state.fighters){
    counts.awards+=pruneAwards(f);
    if(f.economy?.history)f.economy.history=f.economy.history.slice(0,40);
  }
  state.history=state.history.slice(0,30);state.champions=state.champions.slice(0,20);
  if(state.arena?.history)state.arena.history=state.arena.history.slice(0,40);
  for(const t of state.league?.events||[]){
    const previous=t.logs?.length||0;
    t.logs=t===state.tournament?(t.logs||[]).slice(0,50):[];
    counts.logs+=previous-t.logs.length;
  }
  // Previous stages need only their summary; no accumulating match archive.
  if(state.league?.archive)state.league.archive=state.league.archive.slice(-5);
  return counts;
}
