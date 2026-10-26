import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {Game} from './game.mjs';

// One transaction persists the world, wallets and action receipts together.
export class GameStore {
  constructor(filename,now=Date.now()){
    if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0)');
    this.db.exec('PRAGMA wal_autocheckpoint=1000; PRAGMA journal_size_limit=8388608');
    const saved=this.db.prepare('SELECT data,generation FROM world WHERE id=1').get();
    this.generation=saved?.generation||0;
    if(saved){
      const data=JSON.parse(saved.data);if(![2,3].includes(data.schemaVersion))throw Error('Unsupported world schema');
      const migrate=data.schemaVersion===2;
      this.game=new Game(data,now);
      if(migrate)this.transaction(()=>{});
    }
    else{this.game=new Game(null,now);this.persist();}
  }
  persist(){this.db.prepare('INSERT INTO world(id,data,generation) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,generation=excluded.generation').run(JSON.stringify(this.game.state),this.generation);}
  transaction(fn){
    const before=JSON.stringify(this.game.state),generation=this.generation;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(this.db.prepare('SELECT generation FROM world WHERE id=1').get().generation!==this.generation)throw Error('Другой процесс изменил мир. Запускайте только один сервер на базу.');
      const result=fn(this.game);this.generation++;this.persist();this.db.exec('COMMIT');return result;
    }
    catch(error){this.db.exec('ROLLBACK');this.generation=generation;this.game=new Game(JSON.parse(before));throw error;}
  }
  backup(filename){
    // VACUUM INTO creates a consistent standalone copy, including WAL changes.
    this.db.prepare('VACUUM INTO ?').run(filename);
  }
  compact(){
    const pages=this.db.prepare('PRAGMA page_count').get().page_count;
    const free=this.db.prepare('PRAGMA freelist_count').get().freelist_count;
    const size=this.db.prepare('PRAGMA page_size').get().page_size;
    this.db.exec('PRAGMA busy_timeout=250');
    try{
      if(free*size>=8*1024*1024&&free/pages>=.2)this.db.exec('VACUUM');
      const checkpoint=this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();this.db.exec('PRAGMA optimize');
      return {pages,free,pageSize:size,deferred:!!checkpoint.busy};
    }catch(error){if(/locked|busy/i.test(error.message))return {pages,free,pageSize:size,deferred:true};throw error;}
    finally{this.db.exec('PRAGMA busy_timeout=5000');}
  }
  close(){this.db.close();}
}
