const arena=document.querySelector('#arena');
const onlineCount=document.querySelector('#viewer-count'),fightCount=document.querySelector('#fight-viewer-count');
const tabId=crypto.randomUUID();let visitorId;
try{visitorId=localStorage.getItem('yarost-viewer-id');if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem('yarost-viewer-id',visitorId);}}catch{visitorId=tabId;}
let inView=true,busy=false;
function currentPresence(){
  const online=document.visibilityState==='visible'&&document.querySelector('#welcome').classList.contains('hidden');
  return {tabId,visitorId,online,watching:online&&inView&&!document.querySelector('#modal').open&&['live','break'].includes(arena.dataset.phase),fightId:arena.dataset.matchKey||''};
}
async function heartbeat(){
  if(busy)return;busy=true;
  try{
    const response=await fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(currentPresence()),cache:'no-store'});
    if(!response.ok)throw Error();const counts=await response.json();
    onlineCount.textContent=counts.online;fightCount.textContent=counts.watching;
    document.querySelector('#viewers-state').textContent='Обновляется онлайн';
  }catch{
    onlineCount.textContent='—';fightCount.textContent='—';
    document.querySelector('#viewers-state').textContent='Счётчик временно недоступен';
  }finally{busy=false;}
}
if('IntersectionObserver' in window){new IntersectionObserver(([entry])=>{inView=entry.isIntersecting&&entry.intersectionRatio>=.1;heartbeat();},{threshold:.1}).observe(arena);}
document.addEventListener('visibilitychange',heartbeat);
document.addEventListener('click',()=>setTimeout(heartbeat,0));
window.addEventListener('pagehide',()=>{navigator.sendBeacon('/api/presence',JSON.stringify({...currentPresence(),online:false,watching:false}));});
setInterval(heartbeat,5000);heartbeat();
