import {pruneWorld,emptyPlayer,RETENTION,DAY} from './retention.mjs';

const formatDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
export class Maintenance {
  constructor(store){
    this.store=store;
    store.db.exec('CREATE TABLE IF NOT EXISTS maintenance (id INTEGER PRIMARY KEY CHECK(id=1), day TEXT NOT NULL, completed_at INTEGER NOT NULL, result TEXT NOT NULL)');
    this.lastDay=store.db.prepare('SELECT day FROM maintenance WHERE id=1').get()?.day;
  }
  run(now,force=false){
    const day=formatDay.format(now);if(!force&&day===this.lastDay)return null;
    const counts=this.store.transaction(game=>{
      const result=pruneWorld(game.state,now),db=this.store.db;
      result.sessions=Number(db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now).changes);
      result.retiredSessions=Number(db.prepare('DELETE FROM retired_sessions WHERE expires_at<=?').run(now).changes);
      result.blocks=Number(db.prepare('DELETE FROM login_blocks WHERE until_ms<=?').run(now).changes);
      const owners=new Set(game.state.fighters.map(f=>f.ownerId).filter(Boolean));result.emptyPlayers=0;
      for(const {player_id:id} of db.prepare('SELECT player_id FROM accounts WHERE last_seen_at<?').all(now-RETENTION.emptyGuestDays*DAY)){
        const p=game.state.players[id];
        if(p&&!owners.has(id)&&emptyPlayer(p)){delete game.state.players[id];result.emptyPlayers++;}
      }
      game.state.revision++;
      db.prepare('INSERT INTO maintenance VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,completed_at=excluded.completed_at,result=excluded.result').run(day,now,JSON.stringify(result));
      return result;
    });
    this.lastDay=day;
    // Reuse freed pages; compact only if a meaningful part of the DB is empty.
    counts.storage=this.store.compact();
    this.store.db.prepare('UPDATE maintenance SET result=? WHERE id=1').run(JSON.stringify(counts));return counts;
  }
}
