import fs from 'node:fs/promises';
import {regions} from '../dist/regions.js';
let html;
try{html=await fs.readFile(new URL('../flags-gallery.tmp.html',import.meta.url),'utf8');}
catch{const response=await fetch('https://commons.wikimedia.org/wiki/Flags_of_Russian_federal_subjects');if(!response.ok)throw Error('Gallery: '+response.status);html=await response.text();}
const entries=[...html.matchAll(/<a href="(\/wiki\/File:[^"]+)"[^>]*title="([^"]+)"><img[^>]*src="([^"]+)"/g)].map(m=>({page:'https://commons.wikimedia.org'+m[1],title:m[2],src:m[3].replaceAll('&amp;','&')}));
if(process.argv.includes('--list')){console.log(entries.map(e=>e.title).join('\n'));process.exit();}
const labels=`Adygea|Altai Republic|Bashkortostan|Buryatia|Dagestan|Ingushetia|Kabardino-Balkaria|Kalmykia|Karachay-Cherkessia|Republic of Karelia|Komi Republic|Mari El|Mordovia|Sakha|North Ossetia–Alania|Tatarstan|Tuva|Udmurtia|Khakassia|Chechnya|Chuvashia|Altai Krai|Zabaykalsky Krai|Kamchatka Krai|Krasnodar Krai|Krasnoyarsk Krai|Perm Krai|Primorsky Krai|Stavropol Krai|Khabarovsk Krai|Amur Oblast|Arkhangelsk Oblast|Astrakhan Oblast|Belgorod Oblast|Bryansk Oblast|Vladimir Oblast|Volgograd Oblast|Vologda Oblast|Voronezh Oblast|Ivanovo Oblast|Irkutsk Oblast|Kaliningrad Oblast|Kaluga Oblast|Kemerovo Oblast|Kirov Oblast|Kostroma Oblast|Kurgan Oblast|Kursk Oblast|Leningrad Oblast|Lipetsk Oblast|Magadan Oblast|Moscow Oblast|Murmansk Oblast|Nizhny Novgorod Oblast|Novgorod Oblast|Novosibirsk Oblast|Omsk Oblast|Orenburg Oblast|Oryol Oblast|Penza Oblast|Pskov Oblast|Rostov Oblast|Ryazan Oblast|Samara Oblast|Saratov Oblast|Sakhalin Oblast|Sverdlovsk Oblast|Smolensk Oblast|Tambov Oblast|Tver Oblast|Tomsk Oblast|Tula Oblast|Tyumen Oblast|Ulyanovsk Oblast|Chelyabinsk Oblast|Yaroslavl Oblast|Moscow|Saint Petersburg|Jewish Autonomous Oblast|Nenets Autonomous Okrug|Khanty-Mansi Autonomous Okrug|Chukotka Autonomous Okrug|Yamalo-Nenets Autonomous Okrug|Republic of Crimea|Sevastopol|Donetsk People's Republic|Luhansk People's Republic|Zaporozhye Oblast|Kherson Oblast`.split('|');
const normal=s=>s.replace(/\[Note \d+\]/g,'').replace(/&#0?39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/[–—]/g,'-').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
const chosen=labels.map((label,i)=>{const entry=entries.find(e=>normal(e.title)===normal(label));if(!entry)throw Error('Missing flag: '+label);return {...entry,region:regions[i],index:i};});
await fs.mkdir(new URL('../dist/assets/flags/',import.meta.url),{recursive:true});
const result={};
for(let offset=0;offset<chosen.length;offset++){await Promise.all(chosen.slice(offset,offset+1).map(async e=>{
  const part=new URL(e.src).pathname.match(/\/thumb\/(.+)\/[^/]+$/)?.[1];if(!part)throw Error('Unexpected URL '+e.src);
  const url='https://upload.wikimedia.org/wikipedia/commons/'+part;
  const extension=part.split('.').pop().toLowerCase(),name=`flag-${String(e.index).padStart(2,'0')}.${extension}`;
  const destination=new URL('../dist/assets/flags/'+name,import.meta.url);
  try{await fs.access(destination);}catch{let response;for(let attempt=0;attempt<4;attempt++){response=await fetch(url);if(response.status!==429)break;await new Promise(r=>setTimeout(r,5000*(attempt+1)));}if(!response.ok)throw Error(`${e.title}: ${response.status}`);const bytes=new Uint8Array(await response.arrayBuffer());if(extension==='svg'&&!new TextDecoder().decode(bytes).includes('<svg'))throw Error('Invalid SVG');await fs.writeFile(destination,bytes);await new Promise(r=>setTimeout(r,1500));}
  result[e.region]={src:'assets/flags/'+name,source:e.page,title:e.title};
}));if(offset%10===0||offset===chosen.length-1)console.log(`Flags: ${offset+1}/${chosen.length}`);}
await fs.writeFile(new URL('../dist/flags.js',import.meta.url),'// Regional flag images from Wikimedia Commons. See FLAG_SOURCES.md.\nexport const flags='+JSON.stringify(result,null,2)+';\n');
await fs.writeFile(new URL('../FLAG_SOURCES.md',import.meta.url),'# Источники флагов\n\nИзображения взяты из Wikimedia Commons. Страницы ниже содержат авторство, правовой статус и сведения о лицензировании каждого файла. Флаги используются как символы регионов игрового набора, без утверждения о территориальной принадлежности.\n\n'+chosen.map(e=>`- ${e.region}: [${e.title}](${e.page})`).join('\n')+'\n');
