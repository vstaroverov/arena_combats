const audienceCurve=[[0,.5],[4,.22],[6,.45],[8,1.1],[10,.9],[13,.55],[16,.6],[19,1.05],[21,1.15],[24,.5]];
const smooth=x=>x*x*(3-2*x);
function noiseAt(bucket,salt){
  let value=(bucket^salt)>>>0;
  value=Math.imul(value^(value>>>16),0x45d9f3b);
  value=Math.imul(value^(value>>>16),0x45d9f3b);
  return ((value^(value>>>16))>>>0)/4294967296*2-1;
}
function audienceNoise(now,salt){
  const slot=now/30000,index=Math.floor(slot),mix=smooth(slot-index);
  return noiseAt(index,salt)*(1-mix)+noiseAt(index+1,salt)*mix;
}
export function simulatedPresence(now=Date.now(),phase='waiting'){
  const hour=((now/3600000+3)%24+24)%24; // Moscow UTC+3, independent of server timezone.
  const right=audienceCurve.findIndex(([h])=>h>hour),[from,a]=audienceCurve[right-1],[to,b]=audienceCurve[right];
  const baseline=a+(b-a)*smooth((hour-from)/(to-from));
  // Shared time-based noise keeps all visitors and server restarts consistent.
  const online=Math.round(7856*baseline*(1+.035*audienceNoise(now,0x5a71)));
  const share=(phase==='live'?.72:phase==='break'?.58:0);
  const watching=share?Math.round(online*(share+.04*audienceNoise(now,0x6b82))):0;
  return {online,watching};
}

export class PresenceStore{
  constructor(ttl=20000){this.ttl=ttl;this.tabs=new Map();}
  update(data,now=Date.now()){
    const {tabId,visitorId,online,watching,fightId}=data;
    if(typeof tabId!=='string'||!/^[-\w]{8,80}$/.test(tabId)||typeof visitorId!=='string'||!/^[-\w]{8,80}$/.test(visitorId)||typeof online!=='boolean'||typeof watching!=='boolean'||typeof fightId!=='string'||fightId.length>160)throw Error('Invalid presence');
    if(online)this.tabs.set(tabId,{visitorId,watching,fightId,seenAt:now});else this.tabs.delete(tabId);
    return this.count(fightId,now);
  }
  count(fightId,now=Date.now()){
    for(const [id,tab] of this.tabs)if(now-tab.seenAt>=this.ttl)this.tabs.delete(id);
    const viewers=new Set(),fightViewers=new Set();
    for(const tab of this.tabs.values()){viewers.add(tab.visitorId);if(fightId&&tab.watching&&tab.fightId===fightId)fightViewers.add(tab.visitorId);}
    return {online:viewers.size,watching:fightViewers.size};
  }
}
