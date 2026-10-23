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
