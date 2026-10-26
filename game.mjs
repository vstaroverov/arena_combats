import {randomUUID} from 'node:crypto';
import {createWorld} from './world.mjs';
import {regions} from './dist/regions.js';
import {cities} from './dist/cities.js';
import {placeBet} from './dist/betting.js';
import {creditSupport,creditCreation,trainOutsideBout} from './dist/economy.js';
import {prunePlayer} from './retention.mjs';

const validRegions=new Set([...regions,...cities.map(c=>c.name)]);
function image(value){
  if(value==null)return null;
  if(typeof value!=='string'||value.length>200000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Некорректное изображение.');
  return value;
}
export class Game {
  constructor(saved,now=Date.now()){
    this.world=createWorld(saved,now);
    this.world.state.schemaVersion=3;
    this.world.state.revision??=0;
  }
  get state(){return this.world.state;}
  player(id){
    const p=this.state.players[id]??= {balance:15000,bets:[],betSerial:0,likedFighters:[],receipts:[],lastTopup:0};
    p.paidBalanceMinor??=0;p.paidTotalInMinor??=0;p.paidSpentMinor??=0;p.testPaidBalanceMinor??=0;p.testPaidTotalInMinor??=0;return p;
  }
  view(id){
    const p=this.player(id),{players,balance,bets,likedFighters,...publicWorld}=this.state;
    return {...publicWorld,balance:p.balance,paidBalance:p.paidBalanceMinor/100,testPaidBalance:p.testPaidBalanceMinor/100,bets:p.bets,likedFighters:p.likedFighters,archivedBets:p.archivedBets||null,
      fighters:this.state.fighters.map(({ownerId,...f})=>({...f,own:ownerId===id})),
      serverTime:Date.now(),sharedWorld:true,viewerId:id};
  }
  tick(){this.world.tick();this.state.revision++;}
  action(id,request){
    if(!request||typeof request.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(request.requestId))throw Error('Некорректный идентификатор действия.');
    const p=this.player(id);
    const previous=p.receipts.find(r=>r.id===request.requestId);
    if(previous)return previous.result;
    const a=request,world=this.world,s=this.state;let result={message:'Готово'};
    if(a.type==='support'){
      const f=world.fighter(a.fighterId);if(!f)throw Error('Боец не найден.');
      if(![1,2,3].includes(a.points))throw Error('Выбери пакет поддержки.');
      const current=world.supportStatus(f.id);
      if(a.expected!==current.key)throw Error('Бой изменился или приём уже закрыт. Списания нет.');
      const cost=a.points*500;if(p.paidBalanceMinor<cost*100)throw Error('Недостаточно средств на платном балансе. Пополни его через ЮKassa.');
      p.paidBalanceMinor-=cost*100;p.paidSpentMinor+=cost*100;f.total++;creditSupport(s,f,cost,true);
      if(current.mode==='future')f.preparedSupport+=a.points;
      else{s.tournament.points[current.side]+=a.points;world.log(`Команда ${f.name}: +${a.points} очк. поддержки. Боец усилен.`,true);}
      trainOutsideBout(s);result.message='Поддержка принята';
    }else if(a.type==='like'){
      const f=world.fighter(a.fighterId);if(!f)throw Error('Боец не найден.');
      if(typeof a.liked!=='boolean')throw Error('Некорректная отметка.');
      const liked=p.likedFighters.includes(f.id);
      if(a.liked!==liked){
        if(a.liked){p.likedFighters.push(f.id);f.likes++;}
        else{p.likedFighters=p.likedFighters.filter(v=>v!==f.id);f.likes=Math.max(0,f.likes-1);}
      }
    }else if(a.type==='topup'){
      if(s.now-p.lastTopup<1000)throw Error('Баланс уже пополнен. Подожди секунду.');
      if(p.balance>1000000)throw Error('На балансе достаточно игровых средств.');
      p.balance+=10000;p.lastTopup=s.now;result.message='Добавлено 10 000 игровых ₽';
    }else if(a.type==='bet'){
      if(p.bets.filter(b=>b.status==='open').length>=500)throw Error('У тебя уже 500 открытых ставок. Дождись результатов турниров.');
      const t=s.league.events.find(t=>t.id===a.tournamentId);
      if(!t)throw Error('Турнир недоступен.');
      const wallet={...p,fighters:s.fighters,now:s.now};
      const bet=placeBet(wallet,t,a.fighterId,a.stake,{fingerprint:a.fingerprint});
      p.balance=wallet.balance;p.bets=wallet.bets;p.betSerial=wallet.betSerial;
      result={message:'Ставка принята',bet};
    }else if(a.type==='create'){
      const name=typeof a.name==='string'?a.name.trim():'';
      const description=typeof a.description==='string'?a.description.trim():'';
      if(name.length<2||name.length>35||description.length>240)throw Error('Проверь имя и описание.');
      if(!validRegions.has(a.region))throw Error('Выбери регион или город из списка.');
      if(p.paidBalanceMinor<550000)throw Error('Недостаточно средств на платном балансе. Пополни его через ЮKassa.');
      if(s.fighters.filter(f=>f.ownerId===id).length>=10)throw Error('Можно создать до 10 бойцов на посетителя.');
      const avatar=image(a.avatar),flag=image(a.flag),fighterId=randomUUID();
      s.fighters.push({id:fighterId,name,description,region:a.region,avatar,flag,seed:Math.floor(Math.random()*500),stats:[60,60,60],wins:0,losses:0,rating:1000,injuries:[],fatigue:0,restAt:s.now,readyAt:s.now,total:0,awards:[],ownerId:id,preparedSupport:0,likes:0});
      p.paidBalanceMinor-=550000;p.paidSpentMinor+=550000;creditCreation(s,5500);result={message:'Боец создан и включён в состав лиги',fighterId};
    }else throw Error('Неизвестное действие.');
    p.receipts.push({id:a.requestId,result,at:s.now});prunePlayer(p,s.now);
    s.revision++;return result;
  }
}
