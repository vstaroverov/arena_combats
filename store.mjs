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
    const saved=this.db.prepare('SELECT data,generation FROM world WHERE id=1').get();
    this.generation=saved?.generation||0;
    if(saved){const data=JSON.parse(saved.data);if(data.schemaVersion!==2)throw Error('Unsupported world schema');this.game=new Game(data,now);}
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
  close(){this.db.close();}
}
