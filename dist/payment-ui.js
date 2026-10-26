export async function paymentMenu({channel,open,toast,esc,money,getState,accountMenu,checkId}){
  const $=s=>document.querySelector(s);
  try{
    if(checkId){
      try{const result=await channel.checkPayment(checkId);toast(result.status==='succeeded'?'Оплата подтверждена.':'Текущий статус платежа обновлён.');}
      catch(error){toast(error.message);}
    }
    const info=await channel.paymentInfo(),state=getState();
    const labels={creating:'Создаётся',pending:'Ожидает оплаты',waiting_for_capture:'Ожидает подтверждения',succeeded:'Оплачен',canceled:'Отменён',needs_review:'Проверяется администратором'};
    open(`<span class="eyebrow">ПЛАТНЫЙ БАЛАНС</span><h2>Пополнение через ЮKassa</h2><p>Доступно: <b>${money(state.paidBalance)}</b>. Платный баланс расходуется на поддержку и создание бойцов. В бесплатных пари он не участвует, выигрыши на него не зачисляются.</p>${info.enabled&&info.test?'<p class="notice">Тестовый магазин: реальные деньги не списываются. Тестовые зачисления изолированы и не пополняют боевой баланс.</p>':''}${info.enabled?`<form id="payment-form"><label class="form-field">Сумма пополнения, ₽<input id="payment-amount" type="number" min="${info.min}" max="${info.max}" step="1" required value="500"></label>${info.receiptEmailRequired?'<label class="form-field">Email для чека<input id="payment-email" type="email" maxlength="254" autocomplete="email" required></label>':''}<p>1 ₽ = 1 единица платного баланса. После подтверждения ЮKassa зачислим оплату автоматически.</p><p id="payment-error" class="injury" role="status"></p><button class="primary" id="payment-submit" type="submit">Перейти к оплате 500 ₽</button></form>`:'<p class="notice">Пополнение пока недоступно. Существующий платный баланс сохраняется.</p>'}<p class="notice">Сохрани GUID перед оплатой: он нужен для доступа к профилю после смены устройства или очистки cookie. Данные карты вводятся на странице ЮKassa.</p><button id="payment-account" type="button" class="bet-refresh">Открыть мой GUID</button><h3>Последние пополнения</h3>${info.orders.length?info.orders.map(o=>`<div class="bet-record"><b>${money(o.amount)}${o.test?' · тест':''}</b><p>${labels[o.status]||esc(o.status)}${o.refunded?' · Возвращено '+money(o.refunded):''}</p>${o.confirmationUrl&&['pending','creating'].includes(o.status)?`<a class="bet-refresh" href="${esc(o.confirmationUrl)}" rel="noreferrer">Продолжить оплату ↗</a>`:''}<button type="button" class="bet-refresh" data-payment-check="${esc(o.id)}">Проверить статус</button></div>`).join(''):'<p>Пополнений пока нет.</p>'}`);
    $('#payment-account').onclick=()=>accountMenu();
    document.querySelectorAll('[data-payment-check]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;await paymentMenu({channel,open,toast,esc,money,getState,accountMenu,checkId:button.dataset.paymentCheck});
    });
    if(!info.enabled)return;
    $('#payment-amount').oninput=()=>{$('#payment-submit').textContent='Перейти к оплате '+money(Number($('#payment-amount').value)||0);};
    $('#payment-form').onsubmit=async e=>{
      e.preventDefault();const button=$('#payment-submit');button.disabled=true;$('#payment-error').textContent='';
      try{
        const amount=Number($('#payment-amount').value),email=info.receiptEmailRequired?$('#payment-email').value:'';
        let draft;try{draft=JSON.parse(sessionStorage.getItem('yarost-checkout'));}catch{}
        if(!draft||draft.amount!==amount||draft.test!==info.test)draft={amount,test:info.test,id:crypto.randomUUID()};
        try{sessionStorage.setItem('yarost-checkout',JSON.stringify(draft));}catch{}
        const order=await channel.checkout(amount,email,draft.id);
        if(order.status==='canceled'){try{sessionStorage.removeItem('yarost-checkout');}catch{}throw Error('Платёж отменён. Можно создать новое пополнение.');}
        if(order.status==='succeeded'){try{sessionStorage.removeItem('yarost-checkout');}catch{}toast('Оплата уже подтверждена.');await paymentMenu({channel,open,toast,esc,money,getState,accountMenu});return;}
        if(!order.confirmationUrl)throw Error('Платёж проверяется. Нажми «Проверить статус» перед повторной оплатой.');
        window.location.assign(order.confirmationUrl);
      }catch(error){$('#payment-error').textContent=error.message;button.disabled=false;}
    };
  }catch(error){toast(error.message);}
}
