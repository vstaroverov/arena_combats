export function createChannel(onState,onStatus){
  let revision=-1,busy=false,polling=false,epoch=0;
  const status=(ok,text)=>onStatus(ok,text);
  function adopt(state){
    if(!state?.sharedWorld||!Number.isSafeInteger(state.revision))throw Error('Сервер арены недоступен.');
    if(state.revision>=revision){revision=state.revision;onState(state);}
    status(true,'Единая арена · подключено');return state;
  }
  async function request(url,options={}){
    const r=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
    const body=await r.json();if(!r.ok){const e=Error(body.error||'Арена временно недоступна.');e.status=r.status;e.blockedUntil=body.blockedUntil;e.serverTime=body.serverTime;throw e;}return body;
  }
  async function refresh(){
    if(polling||busy)return;polling=true;const started=epoch;
    try{const state=await request('/api/state');if(started===epoch)adopt(state);}
    catch{if(started===epoch)status(false,'Связь потеряна · переподключение…');}
    finally{polling=false;}
  }
  return {
    async initial(){
      // There is deliberately no local-world fallback.
      for(;;){try{return adopt(await request('/api/state'));}catch{status(false,'Не удалось подключиться к арене · повторяем…');await new Promise(r=>setTimeout(r,3000));}}
    },
    start(){setInterval(refresh,1000);},
    account(){return request('/api/account');},
    saved(){return request('/api/account/saved',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});},
    async login(code){
      if(busy)throw Error('Дождись завершения предыдущего действия.');
      busy=true;epoch++;
      try{
        const result=await request('/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
        adopt(result.state);return result.account;
      }catch(error){
        if(!error.status)throw Error('Не удалось подтвердить вход. Соединение восстановится автоматически; проверь свой код в личном меню.');
        throw error;
      }finally{busy=false;}
    },
    async send(action){
      if(busy)throw Error('Дождись завершения предыдущего действия.');
      busy=true;const payload={...action,requestId:crypto.randomUUID()};
      try{
        let body;
        for(let attempt=0;attempt<3;attempt++){
          try{body=await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});break;}
          catch(error){if(error.status||attempt===2)throw error;status(false,'Проверяем результат действия…');}
        }
        adopt(body.state);return body.result;
      }catch(error){
        if(!error.status){status(false,'Связь потеряна · результат уточняется');throw Error('Не удалось подтвердить действие. После подключения проверь баланс и результат перед повтором.');}
        throw error;
      }finally{busy=false;}
    }
  };
}
