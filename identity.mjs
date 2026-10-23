import {randomUUID,randomBytes,createHash} from 'node:crypto';

export const hash=value=>createHash('sha256').update(value).digest('hex');
const DAY=24*60*60*1000;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class IdentityStore {
  constructor(store){
    this.store=store;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS accounts(player_id TEXT PRIMARY KEY, guid TEXT NOT NULL UNIQUE, saved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS retired_sessions(token_hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS login_blocks(block_key TEXT PRIMARY KEY, until_ms INTEGER NOT NULL);`);
    // Upgrade existing guest wallets without changing their owner IDs or cookies.
    const missing=Object.keys(store.game.state.players).filter(id=>!this.accountRow(id));
    if(missing.length)store.transaction(()=>{for(const id of missing){
      this.db.prepare('INSERT INTO accounts VALUES(?,?,0,?)').run(id,randomUUID(),Date.now());
      if(/^[a-f0-9]{64}$/.test(id))this.db.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?)').run(id,id);
    }});
  }
  accountRow(id){return this.db.prepare('SELECT * FROM accounts WHERE player_id=?').get(id);}
  resolve(tokenHash){return this.db.prepare('SELECT player_id FROM sessions WHERE token_hash=?').get(tokenHash)?.player_id||null;}
  retired(tokenHash){return !!this.db.prepare('SELECT 1 FROM retired_sessions WHERE token_hash=?').get(tokenHash);}
  create(now){
    const token=randomBytes(32).toString('hex'),id=randomUUID();
    this.store.transaction(game=>{
      game.player(id);this.db.prepare('INSERT INTO accounts VALUES(?,?,0,?)').run(id,randomUUID(),now);
      this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),id);
    });
    return {token,id};
  }
  keys(tokenHash,address){return ['device:'+tokenHash,'ip:'+hash(address)];}
  blockedUntil(tokenHash,address,now){
    const until=Math.max(0,...this.keys(tokenHash,address).map(key=>this.db.prepare('SELECT until_ms FROM login_blocks WHERE block_key=?').get(key)?.until_ms||0));
    return until>now?until:0;
  }
  info(id,tokenHash,address,now){
    const a=this.accountRow(id);if(!a)throw Error('Посетитель не найден.');
    return {code:a.guid,saved:!!a.saved,blockedUntil:this.blockedUntil(tokenHash,address,now),serverTime:now};
  }
  markSaved(id){this.store.transaction(()=>this.db.prepare('UPDATE accounts SET saved=1 WHERE player_id=?').run(id));}
  login(tokenHash,address,input,now){
    return this.store.transaction(game=>{
      const blockedUntil=this.blockedUntil(tokenHash,address,now);
      if(blockedUntil)return {ok:false,status:429,blockedUntil};
      const code=typeof input==='string'?input.trim().toLowerCase():'';
      const account=GUID.test(code)?this.db.prepare('SELECT player_id FROM accounts WHERE guid=?').get(code):null;
      if(!account){
        const until=now+DAY;
        for(const key of this.keys(tokenHash,address))this.db.prepare('INSERT INTO login_blocks VALUES(?,?) ON CONFLICT(block_key) DO UPDATE SET until_ms=excluded.until_ms').run(key,until);
        return {ok:false,status:401,blockedUntil:until};
      }
      const token=randomBytes(32).toString('hex');
      this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),account.player_id);
      this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
      this.db.prepare('INSERT OR IGNORE INTO retired_sessions VALUES(?)').run(tokenHash);
      game.state.revision++;
      return {ok:true,token,id:account.player_id};
    });
  }
}
