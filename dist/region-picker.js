import {regions} from './regions.js';
import {cities} from './cities.js';

const normalize=value=>String(value).toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const locations=[...regions.map(name=>({name,region:'',type:'region'})),...cities.filter(c=>!regions.includes(c.name)).map(c=>({...c,type:'city'}))];
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function filterLocations(query){
  const text=normalize(query),words=text.split(' ').filter(Boolean);
  const score=l=>normalize(l.name).startsWith(text)?0:words.every(w=>normalize(l.name).includes(w))?1:2;
  return locations.filter(l=>words.every(w=>normalize(l.name+' '+l.region).includes(w)))
    .sort((a,b)=>score(a)-score(b)||a.name.localeCompare(b.name,'ru'));
}

export function mountRegionPicker(doc,flagHTML){
  const search=doc.querySelector('#region-search'),select=doc.querySelector('#region-select'),status=doc.querySelector('#region-results'),preview=doc.querySelector('#region-flag-preview');
  let visible=[];
  function selected(){return visible.some(l=>l.name===select.value)?select.value:'';}
  function previewFlag(){const value=selected();preview.innerHTML=value?flagHTML(value):'';}
  function update(){
    const previous=select.value;visible=filterLocations(search.value);
    select.innerHTML='<option value="" disabled>Выбери регион или город</option>'+[
      ['region','Республики и регионы'],['city','Города']
    ].map(([type,label])=>{
      const matches=visible.filter(l=>l.type===type);
      return matches.length?`<optgroup label="${label}">${matches.map(l=>`<option value="${esc(l.name)}">${esc(l.name)}${l.region?' — '+esc(l.region):''}</option>`).join('')}</optgroup>`:'';
    }).join('');
    select.value=visible.some(l=>l.name===previous)?previous:'';
    status.textContent=visible.length?`Найдено: ${visible.length}. Выбери вариант из списка.`:'Ничего не найдено. Попробуй другое название города или региона.';
    previewFlag();
  }
  search.oninput=update;select.onchange=previewFlag;update();
  return {value:selected};
}
