import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {PresenceStore,simulatedPresence} from './presence.mjs';
import {GameStore} from './store.mjs';
import {IdentityStore,hash} from './identity.mjs';
import {Maintenance} from './maintenance.mjs';
import {Payments,paymentConfig} from './payments.mjs';

const root=path.resolve(fileURLToPath(new URL('./dist/',import.meta.url)));
export function startServer({port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1',origin=process.env.PUBLIC_ORIGIN,dbPath=process.env.WORLD_DB||fileURLToPath(new URL('./data/world.sqlite',import.meta.url)),clock=()=>Date.now(),autoTick=true,trustProxy=process.env.TRUST_PROXY==='1',paymentsConfig,paymentFetch=fetch}={}){
  const publicOrigin=origin?new URL(origin).origin:null;
  const store=new GameStore(dbPath,clock()),accounts=new IdentityStore(store,clock()),maintenance=new Maintenance(store),presence=new PresenceStore();let closing=false;
  maintenance.run(clock(),true);let nextMaintenanceCheck=clock()+60000;
  const payments=new Payments(store,paymentsConfig||paymentConfig(process.env,publicOrigin),{fetcher:paymentFetch,clock});
  let reconciliation=false;
  const paymentInterval=autoTick?setInterval(async()=>{if(reconciliation||closing)return;reconciliation=true;try{await payments.reconcile();if(!payments.closed)payments.redact(clock());}catch{/* Durable payment orders will be retried on the next pass. */}finally{reconciliation=false;}},60000):null;
  function advance(){
    if(clock()>=nextMaintenanceCheck){maintenance.run(clock());nextMaintenanceCheck=clock()+60000;}
    // Bounded catch-up after a restart; no open browser is required.
    if(store.game.state.now+1000>clock())return;
    store.transaction(game=>{for(let i=0;i<10&&game.state.now+1000<=clock();i++)game.tick();});
  }
  const interval=autoTick?setInterval(()=>{try{advance();}catch(error){console.error('World persistence failed:',error.message);closing=true;server.close();clearInterval(interval);}},100):null;
  const json=(req,res,status,value)=>{
    res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Accept-Encoding');
    let body=Buffer.from(JSON.stringify(value));
    if(body.length>2048&&/\bgzip\b/.test(req.headers['accept-encoding']||'')){body=gzipSync(body);res.setHeader('Content-Encoding','gzip');}res.end(body);
  };
  function setCookie(res,token){
    res.setHeader('Set-Cookie',`yarost_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${publicOrigin?.startsWith('https:')?'; Secure':''}`);
  }
  function tokenHash(req){
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('yarost_session='))?.slice(15);
    return /^[a-f0-9]{64}$/.test(token||'')?hash(token):null;
  }
  function identity(req,res,create=false){
    const digest=tokenHash(req),id=digest&&accounts.resolve(digest,clock());
    if(id)return id;if(!create)return null;
    if(digest&&accounts.retired(digest,clock()))return null;
    const guest=accounts.create(clock());setCookie(res,guest.token);return guest.id;
  }
  function address(req){
    // Trust only a single controlled reverse proxy; use the last appended hop.
    return trustProxy&&req.headers['x-forwarded-for']?String(req.headers['x-forwarded-for']).split(',').at(-1).trim():req.socket.remoteAddress;
  }
  async function readJSON(req,max=450000){
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('Ожидается JSON.');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Слишком большой запрос.');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400);res.end();return;}
    if(url.pathname==='/api/payments/webhook'){
      if(req.method!=='POST'){json(req,res,405,{});return;}
      try{await payments.webhook(await readJSON(req,16384));json(req,res,200,{ok:true});}
      catch{json(req,res,503,{error:'Не удалось подтвердить уведомление. Повторите позже.'});}return;
    }
    const allowedOrigin=req.headers.origin===`http://${req.headers.host}`||Boolean(publicOrigin&&req.headers.origin===publicOrigin);
    if(req.method==='POST'&&!allowedOrigin){json(req,res,403,{error:'Недопустимый источник запроса.'});return;}
    if(url.pathname==='/api/health'){json(req,res,closing?503:200,{ok:!closing,version:'2.3.6',revision:store.game.state.revision,catchingUp:clock()-store.game.state.now>2000});return;}
    if(url.pathname==='/api/payments'||/^\/api\/payments\/[a-f0-9-]{36}\/check$/i.test(url.pathname)){
      const id=identity(req,res);if(!id){json(req,res,401,{error:'Войди в свой профиль.'});return;}
      if(closing){json(req,res,503,{error:'Сервер перезапускается.'});return;}
      try{
        if(url.pathname==='/api/payments'&&req.method==='GET'){json(req,res,200,payments.info(id));return;}
        if(req.method!=='POST'){json(req,res,405,{});return;}
        const order=url.pathname==='/api/payments'?await payments.create(id,await readJSON(req,2048)):await payments.check(id,url.pathname.split('/')[3]);
        json(req,res,200,{order,state:store.game.view(id)});
      }catch(error){json(req,res,400,{error:error.message});}return;
    }
    if(['/api/account','/api/account/saved','/api/account/login'].includes(url.pathname)){
      const method=url.pathname==='/api/account'?'GET':'POST';
      if(req.method!==method){json(req,res,405,{});return;}
      const id=identity(req,res);if(!id){json(req,res,401,{error:'Сначала подключись к арене.'});return;}
      if(closing){json(req,res,503,{error:'Арена временно недоступна.'});return;}
      try{
        if(url.pathname==='/api/account'){json(req,res,200,accounts.info(id,tokenHash(req),address(req),clock()));return;}
        if(url.pathname==='/api/account/saved'){accounts.markSaved(id);json(req,res,200,{ok:true});return;}
        const body=await readJSON(req,2048),result=accounts.login(tokenHash(req),address(req),body.code,clock());
        if(!result.ok){res.setHeader('Retry-After',String(Math.ceil((result.blockedUntil-clock())/1000)));json(req,res,result.status,{error:result.status===401?'Неверный GUID-код. Вход по коду заблокирован на 24 часа.':'Вход по GUID-коду временно заблокирован.',blockedUntil:result.blockedUntil,serverTime:clock()});return;}
        setCookie(res,result.token);json(req,res,200,{state:store.game.view(result.id),account:accounts.info(result.id,hash(result.token),address(req),clock())});
      }catch(error){json(req,res,400,{error:error.message});}return;
    }
    if(url.pathname==='/api/state'){
      if(req.method!=='GET'){json(req,res,405,{});return;}
      if(closing){json(req,res,503,{error:'Арена временно недоступна.'});return;}
      try{const id=identity(req,res,true);if(!id){json(req,res,409,{error:'Сессия изменилась. Обнови страницу.'});return;}if(!store.game.state.players[id])store.transaction(game=>game.player(id));json(req,res,200,store.game.view(id));}
      catch(error){console.error('State failed:',error.message);json(req,res,503,{error:'Не удалось загрузить арену.'});}return;
    }
    if(url.pathname==='/api/action'){
      if(req.method!=='POST'){json(req,res,405,{});return;}
      const id=identity(req,res);if(!id||!store.game.state.players[id]){json(req,res,401,{error:'Сначала подключись к арене.'});return;}
      if(closing||clock()-store.game.state.now>2000){json(req,res,503,{error:'Арена синхронизируется. Попробуй чуть позже.'});return;}
      try{const action=await readJSON(req);const result=payments.action(id,action);json(req,res,200,{result,state:store.game.view(id)});}
      catch(error){json(req,res,400,{error:error.message});}return;
    }
    if(url.pathname==='/api/presence'){
      if(req.method!=='POST'){json(req,res,405,{});return;}
      try{const body=await readJSON(req,2048),id=identity(req,res);if(!id)throw Error('Нет сессии');const t=store.game.state.tournament,fightId=t.id+':'+t.index;json(req,res,200,{...presence.update({...body,visitorId:id,watching:body.watching&&body.fightId===fightId}),simulation:simulatedPresence(clock(),t.phase)});}
      catch{json(req,res,400,{});}return;
    }
    if(url.pathname.startsWith('/api/')){json(req,res,404,{});return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    try{
      const p=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!p.startsWith(root+path.sep)&&p!==root)throw Error();
      const file=p===root?path.join(root,'index.html'):p,body=await readFile(file);res.setHeader('Cache-Control','no-cache');
      res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','svg':'image/svg+xml','png':'image/png','jpg':'image/jpeg','webp':'image/webp','ico':'image/x-icon','webmanifest':'application/manifest+json','txt':'text/plain; charset=utf-8'})[file.split('.').pop()]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.requestTimeout=15000;
  server.on('close',()=>{if(interval)clearInterval(interval);if(paymentInterval)clearInterval(paymentInterval);payments.closed=true;store.close();});server.listen(port,host);
  return {server,store,payments,advance,close:()=>new Promise(resolve=>{closing=true;payments.closed=true;server.close(resolve);})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=startServer();app.server.on('listening',()=>console.log(`ЯРОСТЬ: http://${app.server.address().address}:${app.server.address().port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
