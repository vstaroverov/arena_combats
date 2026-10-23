import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PresenceStore} from './presence.mjs';
const root=path.resolve(fileURLToPath(new URL('./dist/',import.meta.url)));
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const publicOrigin=process.env.PUBLIC_ORIGIN?new URL(process.env.PUBLIC_ORIGIN).origin:null;
const presence=new PresenceStore();
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/presence'){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(req.method!=='POST'){res.writeHead(405);res.end('{}');return;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==publicOrigin){res.writeHead(403);res.end('{}');return;}
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error();}
      res.end(JSON.stringify(presence.update(JSON.parse(body))));
    }catch{res.writeHead(400);res.end('{}');}
    return;
  }
  try{
    const p=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!p.startsWith(root+path.sep)&&p!==root)throw Error();
    const file=p===root?path.join(root,'index.html'):p,body=await readFile(file);
    res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','svg':'image/svg+xml','png':'image/png','jpg':'image/jpeg','webp':'image/webp','ico':'image/x-icon','webmanifest':'application/manifest+json','txt':'text/plain; charset=utf-8'})[file.split('.').pop()]||'application/octet-stream');res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,host,()=>console.log(`http://${host}:${port}`));
