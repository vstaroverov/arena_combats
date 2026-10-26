import {paymentMenu} from './payment-ui.js';
import {mountRegionPicker} from './region-picker.js';
import {createChannel} from './client.js';
import {cityRegions} from './cities.js';
import {flags} from './flags.js';
import {stages,nextMatch,readyAt,roundLabel} from './league.js';
import {effective} from './engine.js';
import {bettingOpen,entrants,quoteTournament} from './betting.js';
import {ensureFighterEconomy,trainingCost} from './economy.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
const points=n=>new Intl.NumberFormat('ru-RU').format(n)+' очк.';
const coins=n=>new Intl.NumberFormat('ru-RU').format(n)+' ◈';
const statNames=['Сила','Ловкость','Выносливость'];
let state,toastTimer,activeProfile=null,activeBet=null;
let ready=false,lastAnimation=null;
const channel=createChannel(next=>{const switched=state?.viewerId&&state.viewerId!==next.viewerId;state=next;if(ready){if(switched){activeProfile=null;activeBet=null;$('#modal').close();}render();animateEvent();updateBetForm();if(activeProfile&&$('#modal').open)$('#profile-likes').innerHTML=likeButton(fighter(activeProfile),'profile-like');}},(ok,text)=>{const el=$('#connection-state');el.textContent=text;el.dataset.online=String(ok);$('#welcome-status').textContent='2.3.2 · '+text;});
$('#start').disabled=true;
await channel.initial();
$('#start').disabled=false;
const fighter=id=>state.fighters.find(f=>f.id===id);
const t=()=>state.tournament;
const match=()=>t().matches[t().index];
const pair=()=>match().ids.map(fighter);
function animateEvent(){
  const e=t().lastEvent;if(!e||e.key===lastAnimation||t().phase!=='live')return;
  lastAnimation=e.key;const cs=$$('.combatant');cs.forEach(el=>el.classList.remove('attack','hit'));
  void $('#combatants').offsetWidth;cs[e.side]?.classList.add('attack');if(e.hit)cs[1-e.side]?.classList.add('hit');
}
function portrait(f,large=false){if(f.avatar)return `<div class="portrait"><img src="${esc(f.avatar)}" alt="Аватар ${esc(f.name)}"></div>`;const n=f.seed||0,skin=['#bd8866','#d3a17c','#9c6d4e','#e2b18d'][n%4],shirt=['#b6cf79','#70918b','#c38266','#8e8ba1'][n%4],hair=['#27221e','#4e3729','#1f211e'][n%3];return `<div class="portrait"><svg viewBox="0 0 100 120" role="img" aria-label="Аватар ${esc(f.name)}"><path d="M4 120V102Q7 87 31 85L38 76H62L69 85Q93 87 96 102V120" fill="${shirt}"/><path d="M38 72V88L50 98L62 88V72" fill="${skin}"/><path d="M25 40Q21 15 48 13Q77 13 76 40L72 65Q64 83 50 84Q33 80 28 65Z" fill="${skin}"/><path d="M25 45L22 33Q21 6 53 7Q79 9 78 35L74 48L70 29Q48 35 32 28Z" fill="${hair}"/><path d="M31 48L42 47M58 47L69 48" stroke="${hair}" stroke-width="3"/><path d="M35 52H39M61 52H65" stroke="#171d19" stroke-width="2.7"/><path d="M50 53L47 65H53M42 73Q50 76 59 72" stroke="#734d3c" fill="none" stroke-width="2"/>${n%3===0?`<path d="M30 62Q32 83 50 85Q68 82 71 62L62 70L50 74L38 70Z" fill="${hair}" opacity=".7"/>`:''}<path d="M31 88L21 120M69 88L79 120" stroke="#0002" stroke-width="3"/><path d="M37 100H63" stroke="#182315" stroke-width="2"/><text x="50" y="112" text-anchor="middle" fill="#182315" font-size="9" font-family="sans-serif" font-weight="bold">YAROST</text></svg></div>`;}
function flag(f){const region=cityRegions[f.region]||f.region,src=f.flag||flags[region]?.src;return src?`<img class="flag" src="${esc(src)}" alt="Флаг: ${esc(region)}" title="${esc(region)}">`:`<span class="flag" title="Флаг не указан">—</span>`;}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function open(html){activeProfile=null;activeBet=null;$('#modal-content').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();$('#modal').scrollTop=0;$('#modal-content').scrollTop=0;}
async function accountMenu(){
  try{
    const info=await channel.account();
    showAccount(info);
  }catch(error){toast(error.message);}
}
function blockMessage(until,serverTime=Date.now()){
  const minutes=Math.max(1,Math.ceil((until-serverTime)/60000));
  return `Вход по GUID заблокирован до ${new Date(until).toLocaleString('ru-RU')} (осталось около ${minutes} мин.). Просмотр арены и текущий профиль доступны.`;
}
function showAccount(info){
  const blocked=info.blockedUntil>info.serverTime;
  open(`<span class="eyebrow">ЛИЧНЫЙ ПРОФИЛЬ</span><h2>Твой GUID-код</h2><p>Сохрани этот код: он вернёт доступ к твоему балансу, ставкам и бойцам с другого устройства или после очистки cookie.</p><label class="form-field">Код доступа<input id="account-code" class="guid-code" readonly value="${esc(info.code)}" autocomplete="off" spellcheck="false"></label><div class="account-actions"><button type="button" id="copy-code" class="primary">Скопировать код</button><button type="button" id="save-code" class="bet-refresh">Я сохранил код</button></div><p class="notice">Код — ключ от профиля. Не передавай его другим и не публикуй: любой, кто его знает, сможет войти от твоего имени.</p><hr><h3>Войти с другого устройства</h3><p>Вставь ранее сохранённый GUID. Текущий профиль останется отдельным: балансы и бойцы не объединяются. Сначала сохрани текущий код, если хочешь вернуться к этому профилю.</p><p class="injury">Один неверный код блокирует вход по GUID на 24 часа для этого браузера и IP. Блокировка действует и после очистки cookie. Просмотр арены остаётся доступен.</p><form id="guid-login-form"><label class="form-field">Сохранённый GUID<input id="guid-login-code" required maxlength="80" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" autocapitalize="none" spellcheck="false" ${blocked?'disabled':''}></label><p id="guid-login-error" role="status">${blocked?esc(blockMessage(info.blockedUntil,info.serverTime)):''}</p><button id="guid-login-submit" class="primary" type="submit" ${blocked?'disabled':''}>Войти по коду</button></form>`);
  $('#copy-code').onclick=async()=>{
    try{await navigator.clipboard.writeText(info.code);toast('GUID скопирован. Сохрани его в надёжном месте.');}
    catch{$('#account-code').focus();$('#account-code').select();toast('Выдели и скопируй код вручную.');}
  };
  $('#save-code').onclick=async()=>{try{await channel.saved();$('#save-code').textContent='Код сохранён';toast('Код всегда можно посмотреть в меню «Мой GUID».');}catch(error){toast(error.message);}};
  $('#guid-login-form').onsubmit=async e=>{
    e.preventDefault();const button=$('#guid-login-submit');button.disabled=true;
    try{const account=await channel.login($('#guid-login-code').value);showAccount(account);toast('Вход выполнен. Баланс и бойцы восстановлены.');}
    catch(error){
      $('#guid-login-error').textContent=error.blockedUntil?blockMessage(error.blockedUntil,error.serverTime):error.message;
      if(error.blockedUntil)$('#guid-login-code').disabled=true;else button.disabled=false;
    }
  };
}
function supportStatus(id){
  const side=match().ids.indexOf(id);
  const mode=side>=0&&t().phase!=='result'&&t().round<3?'current':'future';
  const prepared=fighter(id).preparedSupport||0;
  const points=mode==='current'?t().points[side]+(t().phase==='waiting'?prepared:0):prepared;
  return {side,mode,points,key:mode==='current'?`${t().id||t().number}:${t().index}:current`:`future:${id}`,reason:''};
}
function updateProfileSupport(){
  if(!activeProfile||!$('#modal').open)return;
  const status=supportStatus(activeProfile),button=$('#profile-support');
  button.disabled=false;
  button.textContent='Поддержать';
  $('#support-status').textContent=(status.reason|| (status.mode==='future'?'Поддержка сохранится до следующего выступления бойца.':'Поддержка на текущий бой.'))+` Собрано ${status.points} очков · ${status.points>0?'Усилен':'Без поддержки'}.`;
  const stats=effective(fighter(activeProfile),status.points,state.now);
  $$('#modal-content .stat-card b').forEach((el,i)=>{el.textContent=Math.round(stats[i]);});
  $('#fighter-economy').innerHTML=fighterEconomyHTML(fighter(activeProfile));
}
function remaining(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;}
function likeButton(f,extra=''){
  const liked=state.likedFighters.includes(f.id);
  return `<button type="button" class="fighter-like ${extra} ${liked?'liked':''}" data-like="${esc(f.id)}" aria-pressed="${liked}" aria-label="${liked?'Убрать лайк':'Поставить лайк'}: ${esc(f.name)}"><span>${liked?'♥':'♡'}</span> <b>${f.likes||0}</b></button>`;
}
async function toggleLike(id){
  try{await channel.send({type:'like',fighterId:id,liked:!state.likedFighters.includes(id)});}catch(error){toast(error.message);}
}
function renderRoster(){
  const search=$('#search').value.toLowerCase(),sort=$('#sort').value;
  const fs=state.fighters.filter(f=>(f.name+' '+f.region).toLowerCase().includes(search));
  fs.sort((a,b)=>sort==='likes'?(b.likes||0)-(a.likes||0)||b.rating-a.rating:sort==='wins'?b.wins-a.wins:sort==='own'?Number(b.own)-Number(a.own)||b.rating-a.rating:b.rating-a.rating);
  $('#count').textContent=state.fighters.length;
  $('#fighters').innerHTML=fs.length?fs.map((f,i)=>`<div class="fighter-row"><button type="button" class="fighter-open" data-profile="${f.id}"><span class="rank">${i+1<10?'0':''}${i+1}</span>${portrait(f)}<span class="fighter-meta"><b>${esc(f.name)}</b><small>${flag(f)}${esc(f.region)}</small><small>${f.wins+f.losses} боёв · <em>${f.wins} W</em> / ${f.losses} L ${f.own?' · МОЙ':''}${f.injuries.length?' · ✚':''}</small></span><span class="rating">${f.rating}<small>РЕЙТИНГ</small></span></button>${likeButton(f)}</div>`).join(''):'<p class="empty">Бойцы не найдены.</p>';
}
function renderFight(){const tour=t(),fs=pair();$('#arena').dataset.phase=tour.phase;$('#arena').dataset.matchKey=(tour.id||tour.number)+':'+tour.index;$('#phase-label').textContent=({waiting:'СКОРО НА АРЕНЕ',live:'В ПРЯМОМ ЭФИРЕ',break:'ПЕРЕРЫВ',result:'БОЙ ЗАВЕРШЁН'})[tour.phase];$('#match-title').textContent=roundLabel(match())+' / БОЙ '+(tour.index+1);$('#round-label').textContent=tour.phase==='waiting'?'ДО НАЧАЛА':tour.phase==='result'?'РЕЗУЛЬТАТ':tour.phase==='break'?'ПЕРЕРЫВ':`РАУНД ${tour.round} / ${tour.round===4?'ДО ПОПАДАНИЯ':'3'}`;$('#clock').textContent=['waiting','break','result'].includes(tour.phase)?remaining(tour.waitUntil-state.now):remaining((60-tour.elapsed)*1000);const stamp=fs.map(f=>f.id).join();if($('#combatants').dataset.stamp!==stamp){$('#combatants').dataset.stamp=stamp;$('#combatants').innerHTML=fs.map(f=>`<div class="combatant">${portrait(f,true)}<b>${esc(f.name)}</b><small>${flag(f)}${esc(f.region)}</small></div>`).join('');}$('#announcement').textContent=tour.phase==='result'?`${fighter(match().winner).name} — ${tour.champion?'чемпион турнира!':'победитель'}`:tour.phase==='waiting'?'Собираем команды поддержки · отдых и подготовка бойцов':'';$('#fight-bars').innerHTML=fs.map((f,i)=>{const s=tour.stats[i],virtual=tour.simulatedPoints?.[i]||0,p=tour.points[i]+(tour.phase==='waiting'?(f.preparedSupport||0):0),disabled=tour.phase==='result'||tour.round>=3;return `<div class="corner"><div class="bar-label"><span>ЗДОРОВЬЕ</span><b>${Math.ceil(s.hp)} / 100</b></div><div class="bar hp"><i style="width:${s.hp}%"></i></div><div class="bar-label"><span>ЭНЕРГИЯ</span><span>${Math.round(s.energy)}%</span></div><div class="bar energy"><i style="width:${s.energy}%"></i></div><button class="support-button" data-support="${i}" ${disabled?'disabled':''}><span>↑ Поддержать</span><small>${p} очк. · ${p>0?'Усилен':'Без поддержки'}${virtual?' · '+virtual+' от виртуальных зрителей (симуляция)':''}</small></button></div>`;}).join('');$('#events').innerHTML=tour.logs.length?tour.logs.slice(0,12).map(e=>`<div class="event ${e.highlight?'highlight':''}"><time>${e.time}</time><span>${esc(e.text.replace(/Усиление \+\d+(?:[.,]\d+)?%\./gi,'Боец усилен.'))}</span></div>`).join(''):'<p class="empty">Арена готова. Здесь появятся события боя.</p>';renderBracket();updateProfileSupport();renderArenaSummary();}
function renderBracket(){
  $('#tournament-name').textContent=t().name;
  const sizes=[...new Set(t().matches.map(m=>m.roundSize))],market=bettingOpen(t())?quoteTournament(t(),state.fighters,state.now).byId:null;
  $('#bracket').style.gridTemplateColumns=`repeat(${sizes.length},minmax(125px,1fr))`;
  $('#bracket').innerHTML=sizes.map(size=>`<div class="bracket-column"><small>${roundLabel({roundSize:size})}</small>${t().matches.map((m,i)=>({m,i})).filter(({m})=>m.roundSize===size).map(({m,i})=>`<div class="bracket-match ${i===t().index?'live':''}">${m.ids.map(id=>id?`<button class="bracket-entry ${m.winner===id?'winner':''}" data-ticket="${esc(id)}" data-tournament="${esc(t().id)}" ${!market?'disabled':''}><span>${esc(fighter(id).name)}</span><b>${market?market[id].odds.toFixed(2):m.winner===id?'✓':''}</b></button>`:`<div class="bracket-entry"><span>${m.bye?'Свободный проход':'Ожидает победителя'}</span></div>`).join('')}</div>`).join('')}</div>`).join('');
  $('#betting-hint').textContent=market?'Нажми на бойца в сетке, чтобы поставить на его победу в турнире.':'Турнир начался — приём ставок закрыт. Для следующих турниров открой календарь.';
}
let calendarLimit=8;
function renderCalendar(){
  const league=state.league;
  const pending=league?[t(),...league.events.filter(e=>!e.done&&e!==t())]:[t()];
  const stage=league?.stage??0;
  const path=stages.map((name,i)=>`<div class="season-step ${i===stage?'current':i<stage?'passed':''}"><b>${i<stage?'✓':i+1}</b><span>${name}</span></div>`).join('');
  const entries=pending.slice(0,calendarLimit).map(e=>{
    const i=nextMatch(e),m=i>=0?e.matches[i]:null;
    const at=m?readyAt(e,i,state.fighters,state.now):state.now;
    const active=e===t();
    return `<div class="calendar-item ${active?'active':''}"><small>${active?'● НА АРЕНЕ':at>state.now?'ОТДЫХ · '+remaining(at-state.now):'В ОЧЕРЕДИ АРЕНЫ'}</small><h3>${esc(e.name)}</h3><p>${e.matches.filter(m=>!m.bye).length} боёв · ${e.matches.filter(m=>m.complete&&!m.bye).length} завершено</p>${m?`<p>${m.ids.map(id=>esc(fighter(id).name)).join(' / ')}</p>`:''}<span class="tag">${stages[e.stage??0]}</span>${bettingOpen(e)?`<button class="calendar-bet" data-market="${esc(e.id)}">Ставки на победителя ↗</button>`:``}</div>`;
  }).join('');
  $('#schedule').innerHTML=`<div class="season-path"><span class="eyebrow">СЕЗОН ${league?.season||state.season||1}</span>${path}<p>${pending.length} турниров в очереди этой ступени</p></div>${entries}${pending.length>calendarLimit?'<button class="calendar-more" id="calendar-more">Показать ещё турниры ↓</button>':''}`;
  const more=$('#calendar-more');if(more)more.onclick=()=>{calendarLimit+=8;renderCalendar();};
}
function render(){
  renderRoster();renderFight();renderCalendar();$('#balance').textContent=points(state.balance);$('#paid-balance').textContent=money(state.paidBalance);
  const season=state.league?.season||state.season||1;
  $('#season-label').innerHTML='<i class="live-dot"></i> СЕЗОН '+season+' / АРЕНА ОНЛАЙН';
  $('#calendar-season').textContent='СЕЗОН '+season;
  $('#history').innerHTML=state.history.length?state.history.slice(0,5).map(h=>`<div class="history-item"><b>${esc(h.winner)}</b> победил<br>${esc(h.loser)}<small>${esc(h.reason)} · ${esc(h.cup)}</small></div>`).join(''):'<p class="empty">Первый бой сезона ещё впереди.</p>';
}
function findTournament(id){return state.league?.events.find(e=>e.id===id)||(t().id===id?t():null);}
function tournamentMarket(id){
  const tour=findTournament(id);
  if(!tour||!bettingOpen(tour)){open('<h2>Приём ставок закрыт</h2><p>Ставки принимаются до первого боя турнира.</p>');return;}
  const market=quoteTournament(tour,state.fighters,state.now).byId;
  open(`<span class="eyebrow">ПОБЕДИТЕЛЬ ТУРНИРА</span><h2>${esc(tour.name)}</h2><p>Выбери бойца. Коэффициент фиксируется при ставке.</p><div class="market-list">${entrants(tour).sort((a,b)=>market[b].probability-market[a].probability).map(id=>`<button class="market-fighter" data-ticket="${esc(id)}" data-tournament="${esc(tour.id)}">${portrait(fighter(id))}<span><b>${esc(fighter(id).name)}</b><small>${esc(fighter(id).region)} · шанс ${(market[id].probability*100).toFixed(1)}%</small></span><strong>${market[id].odds.toFixed(2)}</strong></button>`).join('')}</div><p class="notice">Ставки игровым балансом, без вывода денег. Шансы рассчитаны по текущим характеристикам и сетке; травмы и дальнейшая поддержка могут изменить исход.</p>`);
}
function openBet(tournamentId,fighterId,amount=500){
  const tour=findTournament(tournamentId);
  if(!tour||!bettingOpen(tour)){tournamentMarket(tournamentId);return;}
  const quote=quoteTournament(tour,state.fighters,state.now),selection=quote.byId[fighterId];if(!selection)return;
  const f=fighter(fighterId);
  open(`<span class="eyebrow">ИГРОВОЕ ПАРИ / ПОБЕДИТЕЛЬ ТУРНИРА</span><h2>${esc(f.name)}</h2><p>${esc(tour.name)}</p><div class="bet-quote"><div><span>ШАНС НА ТИТУЛ</span><b>${(selection.probability*100).toFixed(1)}%</b></div><div><span>КОЭФФИЦИЕНТ</span><b>×${selection.odds.toFixed(2)}</b></div></div><form id="bet-form"><label class="form-field">Сумма с игрового баланса<input id="bet-amount" type="number" min="100" step="1" max="${state.balance}" value="${Math.min(amount,Math.floor(state.balance))}" required></label><div class="bet-presets">${[100,500,1000].map(v=>`<button type="button" data-bet-amount="${v}">${points(v)}</button>`).join('')}</div><div class="profile-detail"><span>Общая выплата при победе</span><b id="bet-return"></b></div><div class="profile-detail"><span>Чистая прибыль при победе</span><b id="bet-profit"></b></div><p id="bet-error" role="status"></p><button type="button" class="bet-refresh" id="bet-refresh">Обновить коэффициент ↻</button><button class="primary" id="bet-submit" type="submit">Поставить на титул ↗</button></form><p class="notice">Баланс: ${points(state.balance)}. При проигрыше теряется сумма ставки. Выплата включает поставленную сумму. Это виртуальные средства без вывода денег.</p>`);
  const ticket={tournamentId,fighterId,quote,odds:selection.odds};activeBet=ticket;
  $('#bet-amount').oninput=updateBetForm;
  $('#bet-refresh').onclick=()=>openBet(tournamentId,fighterId,Number($('#bet-amount').value)||500);
  $('#bet-form').onsubmit=async e=>{
    e.preventDefault();if(activeBet!==ticket)return;
    try{
      const current=findTournament(tournamentId);if(!current)throw Error('Турнир недоступен.');
      const {bet}=await channel.send({type:'bet',tournamentId,fighterId,stake:Number($('#bet-amount').value),fingerprint:quote.fingerprint});
      activeBet=null;render();$('#modal').close();toast('Ставка принята: '+points(bet.stake)+' × '+bet.odds.toFixed(2));
    }catch(error){$('#bet-error').textContent=error.message;}
  };
  updateBetForm();
}
function updateBetForm(){
  if(!activeBet||!$('#modal').open)return;
  const tour=findTournament(activeBet.tournamentId),amount=Number($('#bet-amount').value);
  const payout=Math.round(amount*activeBet.odds*100)/100;
  $('#bet-return').textContent=Number.isFinite(payout)?points(payout):'—';
  $('#bet-profit').textContent=Number.isFinite(payout)?points(payout-amount):'—';
  let reason='';
  if(!tour||!bettingOpen(tour))reason='Турнир начался. Приём ставок закрыт.';
  else if(quoteTournament(tour,state.fighters,state.now).fingerprint!==activeBet.quote.fingerprint)reason='Характеристики изменились. Обнови коэффициент.';
  else if(!Number.isSafeInteger(amount)||amount<100)reason='Укажи целую сумму от 100 очк..';
  else if(amount>state.balance)reason='Недостаточно средств на игровом балансе.';
  $('#bet-error').textContent=reason;$('#bet-submit').disabled=!!reason;
}
function myBets(){
  const labels={open:'Ожидает финала',won:'Выигрыш',lost:'Проигрыш',refunded:'Возврат'};
  open(`<span class="eyebrow">ИГРОВЫЕ СТАВКИ</span><h2>Мои ставки</h2><p>Баланс: ${points(state.balance)} · ${state.bets.filter(b=>b.status==='open').length} ожидают результата.</p>${state.bets.length?[...state.bets].reverse().map(b=>`<div class="bet-record ${b.status}"><span>${labels[b.status]}</span><h3>${esc(b.fighterName)}</h3><p>${esc(b.tournamentName)}</p><div><b>${points(b.stake)} × ${b.odds.toFixed(2)}</b><strong>${b.status==='open'?'Возможная выплата '+points(Math.round(b.stake*b.odds*100)/100):'Зачислено '+points(b.payout)}</strong></div></div>`).join(''):'<p class="empty">Пока ставок нет. Выбери бойца в сетке или открой турнир в календаре до его начала.</p>'}${state.archivedBets?.count?`<p class="notice">В архиве ${state.archivedBets.count} завершённых ставок. Сумма выплат по ним: ${points(state.archivedBets.payout)}. Эти средства уже учтены в балансе.</p>`:""}<p class="notice">История: до 100 завершённых ставок за 30 дней. Открытые сохраняются до расчёта. Коэффициент сохраняется при ставке. Выплаты поступают на игровой баланс после определения чемпиона. Вывода денег нет.</p>`);
}
function renderArenaSummary(){
  $('#arena-coins').textContent=coins(state.arena.coins);
  $('#arena-prizes').textContent=coins(state.arena.prizesPaid);
}
function fighterEconomyHTML(f){
  const e=ensureFighterEconomy(f),gains=e.gains.reduce((a,b)=>a+b,0),cost=trainingCost(f);
  const capped=e.gains.every((g,i)=>g>=10||f.stats[i]>=100);
  return `<h3>Кошелёк и развитие</h3><div class="fighter-money-grid"><div><span>Призовые за карьеру</span><b>${coins(e.prizeTotal)}</b></div><div><span>Оплаченная поддержка</span><b>${money(e.paidDonationTotal||0)}</b></div><div><span>Монеты бойца</span><b>${coins(e.coins)}</b></div><div><span>Рост навыков</span><b>+${gains}</b></div></div><div class="profile-detail"><span>Улучшения: сила / ловкость / выносливость</span><b>+${e.gains.join(' / +')}</b></div><div class="profile-detail"><span>Потрачено на тренировки</span><b>${coins(e.trainingSpent)}</b></div><p class="training-caption">${capped?'Предел развития достигнут: до +10 на каждую характеристику.':`Следующее улучшение +1 стоит ${coins(cost)}. Не хватает ${coins(Math.max(0,cost-e.coins))}. Монеты конвертируются в навыки автоматически между боями.`}</p>${!capped?`<div class="training-meter"><i style="width:${Math.min(100,e.coins/cost*100)}%"></i></div>`:''}${e.legacySupportCount?'<p class="training-caption">Суммы поддержки и призовые учитываются с момента появления кошелька. Старый счётчик поддержек сохранён.</p>':''}${e.history.length?`<div class="fighter-money-history">${e.history.slice(0,5).map(h=>`<div><span>${esc(h.text)}</span><b>${h.amount>0?'+':''}${coins(h.amount)}</b></div>`).join('')}</div>`:''}`;
}
function arenaWallet(){
  const a=state.arena;
  open(`<span class="eyebrow">МОНЕТЫ АРЕНЫ</span><h2>Казна арены</h2><div class="bet-quote"><div><span>НАКОПЛЕНО</span><b>${coins(a.coins)}</b></div><div><span>ПРИЗОВЫЕ БОЙЦАМ</span><b>${coins(a.prizesPaid)}</b></div></div><div class="profile-detail"><span>Все поступления</span><b>${coins(a.income)}</b></div><div class="profile-detail"><span>Награды лиги</span><b>${coins(a.leagueIncome)}</b></div><div class="profile-detail"><span>Доля поддержки</span><b>${coins(a.supportIncome)}</b></div><div class="profile-detail"><span>Заявки бойцов</span><b>${coins(a.creationIncome)}</b></div><p class="notice">За каждый проведённый бой лига выделяет монеты на призовые и награду арене. 80% поддержки идут бойцу, 20% — арене. Заявка нового бойца пополняет казну. Игровые монеты не выводятся в деньги.</p><h3>Последние операции</h3>${a.history.length?`<div class="fighter-money-history">${a.history.slice(0,15).map(h=>`<div><span>${esc(h.text)}</span><b>${h.amount>0?'+':''}${coins(h.amount)}</b></div>`).join('')}</div>`:'<p>Первые поступления появятся после боёв или поддержки.</p>'}<button class="primary" id="arena-refresh">Обновить данные ↻</button>`);
  $('#arena-refresh').onclick=arenaWallet;
}
function profile(id){const f=fighter(id),stats=effective(f,supportStatus(id).points,state.now);open(`<span class="eyebrow">КАРТОЧКА БОЙЦА ${f.own?' / МОЙ БОЕЦ':''}</span><div class="profile-head">${portrait(f)}<div><h2>${esc(f.name)}</h2><p>«${esc(f.nickname||'Дебютант')}»<br>${flag(f)}${esc(f.region)}</p></div></div><div class="profile-actions"><span>Лайки бойца</span><div id="profile-likes">${likeButton(f,`profile-like`)}</div></div>${f.description?`<p>${esc(f.description)}</p>`:''}<div class="profile-stats">${stats.map((s,i)=>`<div class="stat-card"><span>${statNames[i]}</span><b>${Math.round(s)}</b><small>База ${f.stats[i]} · с учётом поддержки</small></div>`).join('')}</div><section id="fighter-economy">${fighterEconomyHTML(f)}</section><div class="profile-detail"><span>Рейтинг</span><b>${f.rating}</b></div><div class="profile-detail"><span>Бои / победы / поражения</span><b>${f.wins+f.losses} / ${f.wins} / ${f.losses}</b></div><div class="profile-detail"><span>Поддержки пользователей</span><b>${f.total}</b></div><div class="profile-detail"><span>Поддержки виртуальных зрителей (симуляция)</span><b>${f.simulatedSupportCount||0}</b></div><div class="profile-detail"><span>Усталость</span><b>${Math.round(f.fatigue*100)}%</b></div><h3>Травмы</h3>${f.injuries.length?f.injuries.map(v=>`<p class="injury">${v.severity}: ${statNames[v.stat]} −${v.penalty*100}% · восстановление через ${remaining(v.until-state.now)} игрового времени</p>`).join(''):'<p>Нет травм. Готов к выступлениям.</p>'}<h3>Награды (${f.awardCount||f.awards.length})</h3><small class="muted">Показаны последние 50 наград.</small><p>${f.awards.length?f.awards.map(v=>'🏆 '+esc(v)).join('<br>'):'Первые титулы ещё впереди.'}</p><p id="support-status" class="notice" role="status"></p><button class="primary" id="profile-support" type="button" data-support-fighter="${esc(id)}" aria-describedby="support-status">Поддержать</button><p class="notice">Флаг назначается по региону или городу бойца. Загруженный вручную флаг имеет приоритет.</p>`);activeProfile=id;updateProfileSupport();}
function support(side){supportFighter(pair()[side].id);}
function supportFighter(id){
  const f=fighter(id),status=supportStatus(id);

  const p=status.points,future=status.mode==='future',expected=status.key;
  open(`<span class="eyebrow">${future?'ПОДГОТОВКА К СЛЕДУЮЩЕМУ БОЮ':'КОМАНДА ПОДДЕРЖКИ'}</span><h2>В углу ${esc(f.name)}</h2><p>${future?'Очки сохранятся до следующего выступления и усилят бойца с начала боя.':'Усиление действует на текущий бой.'} Собрано: <b>${p} очков</b> · <b>${p>0?'Усилен':'Без поддержки'}</b>.</p><div class="packages">${[1,2,3].map((v,i)=>`<button class="package" data-package="${v}" ${state.paidBalance<v*500?'disabled':''}><span>${['Лёгкая','Средняя','Мощная'][i]}</span><b>${money(v*500)}</b><small>+${v} очк${v===1?'о':'а'} · Усиление</small></button>`).join('')}</div><p class="notice">Списание с платного баланса, пополненного через ЮKassa. ${future?'Подготовка не сгорает в ожидании боя; после выступления временное усиление закончится.':'Бонус применяется со следующего события.'} 80% суммы поступают бойцу в монеты на развитие, 20% — в казну арены (1 ₽ поддержки = 1 ◈). Травмы не лечит. Победа не гарантирована.</p><p>Платный баланс: ${money(state.paidBalance)} · Количество поддержек не ограничено. ${future?'Поддержать можно и во время восстановления бойца.':'Приём на текущий бой закрывается перед третьим раундом.'}</p><button class="primary" id="support-back">← К профилю бойца</button>`);
  $('#support-back').onclick=()=>profile(id);
  $$('[data-package]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{
      await channel.send({type:'support',fighterId:id,points:Number(b.dataset.package),expected});
      $('#modal').close();
      if(future)profile(id);else toast('Поддержка принята. Спасибо команде!');
    }catch(error){b.disabled=false;toast(error.message);}
  });
}
async function readImage(file){if(!file)return null;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('Выбери PNG, JPEG или WebP до 2 МБ.');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;canvas.getContext('2d').drawImage(bitmap,0,0,240,240);bitmap.close();return canvas.toDataURL('image/webp',.8);}
function createFighter(){open(`<span class="eyebrow">ТВОЙ БОЕЦ. ТВОЯ ИСТОРИЯ.</span><h2>Заявка в лигу</h2><form id="create-form"><label class="form-field">Имя бойца<input name="name" required maxlength="35" placeholder="Например, Артур Волков"></label><label class="form-field">Описание<textarea name="description" maxlength="240" placeholder="Характер, история, стиль боя"></textarea></label><div class="form-field region-picker"><label for="region-search">Регион или город</label><input id="region-search" type="search" placeholder="Начни вводить город или регион" autocomplete="off" aria-controls="region-select" aria-describedby="region-results"><small id="region-results" role="status" aria-live="polite"></small><select id="region-select" name="region" size="6" required aria-label="Выбери регион или город из результатов поиска"></select><span id="region-flag-preview"></span></div><label class="form-field">Аватар<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp"><small>PNG, JPEG, WebP до 2 МБ. Без файла — сгенерированный аватар.</small></label><label class="form-field">Свой флаг региона<input type="file" name="flag" accept="image/png,image/jpeg,image/webp"><small>Без файла — флаг региона, к которому относится выбранный город или республика.</small></label><p class="notice">Создание: 5 500 ₽ с платного баланса. Начальные характеристики 60 / 60 / 60. Боец будет включён в ближайший подходящий отбор лиги. Покупка не даёт дополнительных характеристик.</p><p id="form-error" class="injury" role="alert"></p><button class="primary" type="submit">Создать за 5 500 ₽ <span>↗</span></button></form>`);const regionPicker=mountRegionPicker(document,region=>flag({region}));$('#create-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{if(state.paidBalance<5500)throw Error('Недостаточно средств на платном балансе. Пополни его кнопкой «+» в шапке.');const region=regionPicker.value();if(!region)throw Error('Выбери регион или город из результатов поиска.');const fd=new FormData(form),name=String(fd.get('name')).trim();if(name.length<2)throw Error('Введи имя минимум из двух символов.');const avatar=await readImage(fd.get('avatar')?.size?fd.get('avatar'):null),flagImage=await readImage(fd.get('flag')?.size?fd.get('flag'):null);await channel.send({type:'create',name,description:String(fd.get('description')).trim(),region,avatar,flag:flagImage});$('#modal').close();toast('Боец создан и включён в состав лиги.');}catch(err){$('#form-error').textContent=err.message;button.disabled=false;}};}
document.addEventListener('click',e=>{const like=e.target.closest('[data-like]');if(like){toggleLike(like.dataset.like);return;}const supportButton=e.target.closest('[data-support-fighter]');if(supportButton){supportFighter(supportButton.dataset.supportFighter);return;}const market=e.target.closest('[data-market]');if(market)tournamentMarket(market.dataset.market);const ticket=e.target.closest('[data-ticket]');if(ticket)openBet(ticket.dataset.tournament,ticket.dataset.ticket);const preset=e.target.closest('[data-bet-amount]');if(preset){$('#bet-amount').value=preset.dataset.betAmount;updateBetForm();}const p=e.target.closest('[data-profile]');if(p)profile(p.dataset.profile);const s=e.target.closest('[data-support]');if(s)support(Number(s.dataset.support));});

$('#my-bets').onclick=myBets;
$('#close-modal').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#start').onclick=()=>{$('#welcome').classList.add('hidden');try{sessionStorage.setItem('yarost-entered','1');}catch{}};try{if(sessionStorage.getItem('yarost-entered'))$('#welcome').classList.add('hidden');}catch{}
$('#account').onclick=()=>accountMenu();
$('#add').onclick=$('#add-bottom').onclick=createFighter;$('#search').oninput=renderRoster;$('#sort').onchange=renderRoster;$('#topup').onclick=()=>showPayments();$('#free-topup').onclick=async()=>{try{await channel.send({type:'topup'});toast('Добавлено 10 000 бесплатных игровых очков.');}catch(error){toast(error.message);}};$('#speed-label').textContent='СОБЫТИЯ КАЖДЫЕ 3 СЕК';
ready=true;render();channel.start();

function showPayments(checkId){return paymentMenu({channel,open,toast,esc,money,getState:()=>state,accountMenu,checkId});}
if(typeof location!=='undefined'){const id=new URL(location.href).searchParams.get('payment_return');if(id){showPayments(id);history.replaceState(null,'',location.pathname+location.hash);}}
