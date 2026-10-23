import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=process.env.WORLD_DB||fileURLToPath(new URL('../data/world.sqlite',import.meta.url));
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const target=path.resolve(process.argv[2]||`backups/world-${stamp}.sqlite`);
if(!existsSync(source))throw Error('База мира не найдена. Проверь WORLD_DB.');
if(existsSync(target))throw Error('Файл резервной копии уже существует. Выбери новое имя.');
mkdirSync(path.dirname(target),{recursive:true});
const db=new DatabaseSync(source,{readOnly:true});
try{db.exec('PRAGMA busy_timeout=10000');db.prepare('VACUUM INTO ?').run(target);console.log('Резервная копия: '+target);}
finally{db.close();}
