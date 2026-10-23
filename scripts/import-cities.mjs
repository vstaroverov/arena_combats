import fs from 'node:fs/promises';
import {regions} from '../dist/regions.js';
const url='https://ru.wikipedia.org/wiki/Список_городов_России_с_населением_более_100_тысяч_человек';
const response=await fetch(url);if(!response.ok)throw Error(String(response.status));
const html=await response.text();
const text=s=>s.replace(/<sup\b[\s\S]*?<\/sup>/g,'').replace(/<[^>]+>/g,'').replace(/&#160;|&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const tables=[...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(m=>m[0]);
const parsed=tables.map(table=>[...table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(m=>[...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c=>text(c[1]))));
const population=parsed.find(rows=>rows.some(row=>row[2]==='Новосибирск'));
const distribution=parsed.find(rows=>rows.some(row=>row.at(-1)?.startsWith('Балашиха, Подольск')));
if(!population||!distribution)throw Error('Source tables not found');
const aliases={'Северная Осетия':'Северная Осетия — Алания','Якутия':'Саха (Якутия)','Ханты-Мансийскийавтономный округ — Югра':'Ханты-Мансийский АО — Югра','Ямало-Ненецкий автономный округ':'Ямало-Ненецкий АО'};
const parents=new Map();
for(const row of distribution){const region=row.map(v=>aliases[v]||v).find(v=>regions.includes(v));if(region)for(const city of row.at(-1).split(',').map(v=>v.trim()))parents.set(city,region);}
const cities=population.filter(row=>/^\d+$/.test(row[0])&&row.length>10&&Number(row.at(-1).replace(',','.'))>=100).map(row=>{const name=row[2],region=parents.get(name);if(!region)throw Error('Missing parent: '+name);return {name,region};}).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
if(cities.length<160||new Set(cities.map(c=>c.name)).size!==cities.length)throw Error('Unexpected city list');
await fs.writeFile(new URL('../dist/cities.js',import.meta.url),'// Cities >=100,000 inhabitants, source estimates for 2025. See CITY_SOURCES.md.\nexport const cities='+JSON.stringify(cities,null,2)+';\nexport const cityRegions=Object.fromEntries(cities.map(c=>[c.name,c.region]));\n');
await fs.writeFile(new URL('../CITY_SOURCES.md',import.meta.url),'# Крупные города\n\nКритерий: население собственно города от 100 тысяч человек по оценке на 1 января 2025 года. '+cities.length+' городов. Москва, Санкт-Петербург и Севастополь уже доступны среди регионов и не дублируются в выборе.\n\nИсточник фактических данных и привязки к субъектам: ['+url+']('+url+'). Список сверён 23 октября 2026 года. Территориальная принадлежность части позиций исходного игрового набора оспаривается.\n\nОбновление: `node --use-system-ca scripts/import-cities.mjs`.\n');
console.log('Imported cities: '+cities.length);
