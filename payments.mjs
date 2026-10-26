import {randomUUID} from 'node:crypto';

const HOUR=3600000;
const providerId=/^[a-f0-9-]{36}$/i;
const requestId=/^[a-f0-9-]{36}$/i;
const amountText=minor=>(minor/100).toFixed(2);
function minorAmount(amount){
  if(!amount||amount.currency!=='RUB'||typeof amount.value!=='string'||!/^\d{1,10}\.\d{2}$/.test(amount.value))throw Error('Некорректная сумма платежа.');
  const [r,k]=amount.value.split('.'),n=Number(r)*100+Number(k);
  if(!Number.isSafeInteger(n))throw Error('Некорректная сумма платежа.');return n;
}
export function paymentConfig(env=process.env,origin){
  const config={enabled:env.YOOKASSA_ENABLED==='1',mode:env.YOOKASSA_MODE||'test',shopId:env.YOOKASSA_SHOP_ID||'',secret:env.YOOKASSA_SECRET_KEY||'',origin,
    receipts:env.YOOKASSA_RECEIPT_MODE||'payment',vatCode:Number(env.YOOKASSA_VAT_CODE),subject:env.YOOKASSA_PAYMENT_SUBJECT||'',paymentMode:env.YOOKASSA_PAYMENT_MODE||'',taxSystem:env.YOOKASSA_TAX_SYSTEM_CODE?Number(env.YOOKASSA_TAX_SYSTEM_CODE):undefined,
    externalReceipts:env.YOOKASSA_EXTERNAL_RECEIPTS_CONFIRMED==='1'};
  const fiscal=config.receipts==='payment'?Number.isInteger(config.vatCode)&&config.vatCode>=1&&config.vatCode<=12&&['service','intellectual_activity','payment'].includes(config.subject)&&config.paymentMode==='full_payment':config.receipts==='external'&&config.externalReceipts;
  const https=origin&&/^https:\/\//.test(origin);
  config.ready=!!(config.enabled&&['test','live'].includes(config.mode)&&/^\d+$/.test(config.shopId)&&config.secret&&https&&fiscal&&(config.taxSystem===undefined||(Number.isInteger(config.taxSystem)&&config.taxSystem>=1&&config.taxSystem<=6)));
  return config;
}

export class Payments {
  constructor(store,config,{fetcher=fetch,clock=()=>Date.now()}={}){
    this.store=store;this.db=store.db;this.config=config;this.fetcher=fetcher;this.clock=clock;this.inflight=new Map();this.webhookInFlight=0;this.closed=false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS payment_orders(
      id TEXT PRIMARY KEY,player_id TEXT NOT NULL,request_id TEXT NOT NULL,amount_minor INTEGER NOT NULL,is_test INTEGER NOT NULL,
      request_body TEXT,status TEXT NOT NULL,provider_id TEXT UNIQUE,confirmation_url TEXT,
      credited_minor INTEGER NOT NULL DEFAULT 0,refunded_minor INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0,UNIQUE(player_id,request_id));
      CREATE INDEX IF NOT EXISTS payment_orders_player ON payment_orders(player_id,created_at);
      CREATE INDEX IF NOT EXISTS payment_orders_pending ON payment_orders(is_test,status,checked_at);
      CREATE TABLE IF NOT EXISTS paid_actions(player_id TEXT NOT NULL,request_id TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,request_id));
      CREATE TABLE IF NOT EXISTS paid_ledger(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,order_id TEXT,kind TEXT NOT NULL,delta_minor INTEGER NOT NULL,balance_minor INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
  }
  info(id){
    return {enabled:this.config.ready,test:this.config.mode==='test',receiptEmailRequired:this.config.receipts==='payment',min:100,max:50000,
      orders:this.db.prepare('SELECT * FROM payment_orders WHERE player_id=? ORDER BY created_at DESC LIMIT 10').all(id).map(o=>this.publicOrder(o))};
  }
  publicOrder(o){return {id:o.id,amount:o.amount_minor/100,test:!!o.is_test,status:o.status,confirmationUrl:o.confirmation_url,credited:o.credited_minor/100,refunded:o.refunded_minor/100,createdAt:o.created_at};}
  requireReady(){if(!this.config.ready)throw Error('Пополнение пока не подключено.');if(this.closed)throw Error('Сервер перезапускается.');}
  async api(method,route,body,key){
    this.requireReady();
    const response=await this.fetcher('https://api.yookassa.ru/v3'+route,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(this.config.shopId+':'+this.config.secret).toString('base64'),'Content-Type':'application/json',...(key?{'Idempotence-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){const error=Error(response.status>=500?'ЮKassa временно недоступна. Статус будет проверен автоматически.':'ЮKassa отклонила запрос. Обратись к администратору.');error.providerStatus=response.status;throw error;}
    return response.json();
  }
  async create(id,{amount,email,requestId:key}){
    this.requireReady();
    if(!requestId.test(key||''))throw Error('Некорректный номер запроса.');
    if(!Number.isSafeInteger(amount)||amount<100||amount>50000)throw Error('Сумма пополнения — от 100 до 50 000 ₽, целым числом.');
    const contact=this.config.receipts==='payment'?String(email||'').trim():'';
    if(this.config.receipts==='payment'&&(contact.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)))throw Error('Укажи email для чека.');
    let order=this.db.prepare('SELECT * FROM payment_orders WHERE player_id=? AND request_id=?').get(id,key);
    if(order){if(order.amount_minor!==amount*100||!!order.is_test!==(this.config.mode==='test'))throw Error('Номер запроса уже использован для другой суммы или режима.');return this.sync(order.id);}
    order=this.store.transaction(game=>{
      if(this.db.prepare('SELECT count(*) AS n FROM payment_orders WHERE player_id=? AND created_at>?').get(id,this.clock()-HOUR).n>=5)throw Error('Не больше пяти новых платежей в час. Открой уже созданный платёж.');
      const orderId=randomUUID(),body={amount:{value:amountText(amount*100),currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:this.config.origin+'/?payment_return='+orderId},description:'ЯРОСТЬ: '+amount+' единиц платного баланса',metadata:{order_id:orderId,player_id:id,kind:'yarost_paid_topup_v1'}};
      if(this.config.receipts==='payment')body.receipt={customer:{email:contact},items:[{description:'ЯРОСТЬ: платный баланс для поддержки и создания бойцов',quantity:'1.00',amount:body.amount,vat_code:this.config.vatCode,payment_subject:this.config.subject,payment_mode:this.config.paymentMode}],...(this.config.taxSystem?{tax_system_code:this.config.taxSystem}:{})};
      game.player(id);this.db.prepare('INSERT INTO payment_orders(id,player_id,request_id,amount_minor,is_test,request_body,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(orderId,id,key,amount*100,Number(this.config.mode==='test'),JSON.stringify(body),'creating',this.clock());
      return this.db.prepare('SELECT * FROM payment_orders WHERE id=?').get(orderId);
    });
    return this.sync(order.id);
  }
  async sync(id,force=false){
    this.requireReady();if(this.inflight.has(id))return this.inflight.get(id);
    const task=this.syncOnce(id,force);this.inflight.set(id,task);
    try{return await task;}finally{this.inflight.delete(id);}
  }
  async syncOnce(id,force){
    const order=this.db.prepare('SELECT * FROM payment_orders WHERE id=?').get(id);if(!order)throw Error('Платёж не найден.');
    if(!force&&order.provider_id&&order.checked_at>this.clock()-3000)return this.publicOrder(order);
    if(!order.provider_id&&this.clock()-order.created_at>23*HOUR){
      this.db.prepare("UPDATE payment_orders SET status='needs_review' WHERE id=?").run(id);
      return this.publicOrder({...order,status:'needs_review'});
    }
    let remote;
    try{remote=order.provider_id?await this.api('GET','/payments/'+order.provider_id):await this.api('POST','/payments',JSON.parse(order.request_body),order.id);}
    catch(error){
      if(!this.closed)this.db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=?').run(this.clock(),id);
      throw error;
    }
    if(this.closed)throw Error('Сервер перезапускается.');
    return this.apply(order.id,remote);
  }
  apply(id,remote){
    return this.store.transaction(game=>{
      const order=this.db.prepare('SELECT * FROM payment_orders WHERE id=?').get(id);
      if(!order||!providerId.test(remote.id||'')||(order.provider_id&&order.provider_id!==remote.id)||remote.metadata?.order_id!==id||remote.metadata?.player_id!==order.player_id||remote.metadata?.kind!=='yarost_paid_topup_v1'||minorAmount(remote.amount)!==order.amount_minor||remote.test!==!!order.is_test||remote.test!==(this.config.mode==='test'))throw Error('Данные платежа не совпадают с заказом.');
      if(remote.recipient?.account_id&&String(remote.recipient.account_id)!==this.config.shopId)throw Error('Платёж другого магазина.');
      if(!['pending','waiting_for_capture','succeeded','canceled'].includes(remote.status))throw Error('Неизвестный статус платежа.');
      let url=remote.confirmation?.confirmation_url||order.confirmation_url;
      if(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['yoomoney.ru','yookassa.ru'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))throw Error('Некорректная ссылка оплаты.');}
      let credited=order.credited_minor,refunded=order.refunded_minor;
      const p=game.player(order.player_id);
      const wallet=order.is_test?'testPaidBalanceMinor':'paidBalanceMinor',totalIn=order.is_test?'testPaidTotalInMinor':'paidTotalInMinor';
      const entry=(kind,delta)=>{
        if(!Number.isSafeInteger(p[wallet]+delta))throw Error('Превышен предел баланса.');
        p[wallet]+=delta;
        this.db.prepare('INSERT INTO paid_ledger VALUES(?,?,?,?,?,?,?)').run(randomUUID(),order.player_id,id,(order.is_test?'test_':'')+kind,delta,p[wallet],this.clock());
      };
      if(remote.status==='succeeded'){
        if(remote.paid!==true)throw Error('Платёж не оплачен.');
        if(!credited){entry('credit',order.amount_minor);p[totalIn]+=order.amount_minor;credited=order.amount_minor;}
        const returned=remote.refunded_amount?minorAmount(remote.refunded_amount):0;
        if(returned<refunded||returned>credited)throw Error('Некорректная сумма возврата.');
        if(returned>refunded){entry('refund',-(returned-refunded));refunded=returned;}
      }else if(credited)throw Error('Нельзя отменить уже зачисленный платёж этим статусом.');
      this.db.prepare('UPDATE payment_orders SET status=?,provider_id=?,confirmation_url=?,credited_minor=?,refunded_minor=?,checked_at=? WHERE id=?').run(remote.status,remote.id,url||null,credited,refunded,this.clock(),id);
      game.state.revision++;return this.publicOrder({...order,status:remote.status,provider_id:remote.id,confirmation_url:url,credited_minor:credited,refunded_minor:refunded});
    });
  }
  action(id,request){
    return this.store.transaction(game=>{
      if(!['support','create'].includes(request?.type))return game.action(id,request);
      const previous=this.db.prepare('SELECT result FROM paid_actions WHERE player_id=? AND request_id=?').get(id,String(request.requestId||''));
      if(previous)return JSON.parse(previous.result);
      const p=game.player(id),before=p.paidBalanceMinor,result=game.action(id,request),spent=before-p.paidBalanceMinor;
      this.db.prepare('INSERT INTO paid_actions VALUES(?,?,?,?)').run(id,request.requestId,JSON.stringify(result),this.clock());
      if(spent)this.db.prepare('INSERT INTO paid_ledger VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,null,'spend',-spent,p.paidBalanceMinor,this.clock());
      return result;
    });
  }
  async check(id,orderId){
    const row=this.db.prepare('SELECT player_id FROM payment_orders WHERE id=?').get(orderId);if(!row||row.player_id!==id)throw Error('Платёж не найден.');
    return this.sync(orderId,true);
  }
  async webhook(body){
    this.requireReady();
    if(!['payment.succeeded','payment.canceled','refund.succeeded'].includes(body?.event))return;
    const id=body.event==='refund.succeeded'?body.object?.payment_id:body.object?.id;
    if(!providerId.test(id||''))throw Error('Некорректное уведомление.');
    // Never credit from webhook fields: re-fetch the object using merchant credentials.
    if(this.webhookInFlight>=8)throw Error('Слишком много уведомлений. Повторите позже.');
    this.webhookInFlight++;
    try{
      const remote=await this.api('GET','/payments/'+id);if(this.closed)throw Error('Сервер перезапускается.');
      const row=this.db.prepare('SELECT id FROM payment_orders WHERE id=?').get(String(remote.metadata?.order_id||''));
      if(row)this.apply(row.id,remote);
      else if(remote.metadata?.kind==='yarost_paid_topup_v1')throw Error('Заказ отсутствует в базе. Нужна сверка с платёжным реестром.');
    }finally{this.webhookInFlight--;}
  }
  async reconcile(){
    if(!this.config.ready||this.closed)return;
    const rows=this.db.prepare("SELECT id FROM payment_orders WHERE is_test=? AND status IN ('creating','pending','waiting_for_capture') AND checked_at<? ORDER BY checked_at LIMIT 10").all(Number(this.config.mode==='test'),this.clock()-60000);
    for(const row of rows){if(this.closed)return;try{await this.sync(row.id);}catch{/* Keep the durable order for the next retry; do not log PII/provider bodies. */}}
  }
  redact(now){this.db.prepare("UPDATE payment_orders SET request_body=NULL WHERE status IN ('succeeded','canceled') AND created_at<?").run(now-30*86400000);}
}
