(() => {
  'use strict';
  const KEY = 'option-log-v1';
  const defaults = {version:1,settings:{startingCapital:0,currency:'USD',multiplier:100},positions:[]};
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const today = () => new Date().toLocaleDateString('en-CA');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let data = load();
  let currentView = 'dashboard', filter = 'all', entryMode = 'open', planMode = 'long', activePositionId = null, toastTimer;

  function load(){
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.version === 1 && saved.settings && Array.isArray(saved.positions)) return saved;
    } catch (_) {}
    return clone(defaults);
  }
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (_) { toast('儲存失敗：請檢查瀏覽器儲存空間'); return false; }
  }
  function money(value, digits=2){return new Intl.NumberFormat('en-US',{style:'currency',currency:data.settings.currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value || 0)}
  function signedMoney(value){return `${value>0?'+':''}${money(value)}`}
  function number(value){const n=Number(value);return Number.isFinite(n)?n:0}
  function pct(value){return Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(1)}%`:'—'}
  function isWhole(n){return Number.isInteger(n) && n>0}
  function isSpread(pos){return pos.strategy==='bullCallSpread'}
  function spreadDebit(pos){return Number.isFinite(pos.debit)?pos.debit:pos.longPremium-pos.shortPremium}
  function spreadCloseCredit(close){return Number.isFinite(close.credit)?close.credit:close.longPremium-close.shortPremium}
  function remaining(pos){return pos.contracts-pos.closings.reduce((s,c)=>s+c.contracts,0)}
  function closedCount(pos){return pos.contracts-remaining(pos)}
  function realized(pos){
    const mult=data.settings.multiplier;
    return pos.closings.reduce((sum,c)=>{
      const change=isSpread(pos)?spreadCloseCredit(c)-spreadDebit(pos):(pos.side==='long'?c.premium-pos.premium:pos.premium-c.premium);
      return sum+change*mult*c.contracts-(pos.fee*c.contracts/pos.contracts)-c.fee;
    },0);
  }
  function realizedPercent(pos){const basis=(isSpread(pos)?spreadDebit(pos):pos.premium)*data.settings.multiplier*closedCount(pos);return basis>0?realized(pos)/basis*100:NaN}
  function totals(){
    const realizedTotal=data.positions.reduce((s,p)=>s+realized(p),0);
    const openFees=data.positions.reduce((s,p)=>s+p.fee*remaining(p)/p.contracts,0);
    const asset=number(data.settings.startingCapital)+realizedTotal-openFees;
    let cash=number(data.settings.startingCapital);
    for(const p of data.positions){
      if(isSpread(p)){
        cash-=spreadDebit(p)*data.settings.multiplier*p.contracts+p.fee;
        for(const c of p.closings) cash+=spreadCloseCredit(c)*data.settings.multiplier*c.contracts-c.fee;
      }else{
        const sign=p.side==='long'?-1:1;
        cash+=sign*p.premium*data.settings.multiplier*p.contracts-p.fee;
        for(const c of p.closings) cash-=sign*c.premium*data.settings.multiplier*c.contracts+c.fee;
      }
    }
    return {asset,cash,realized:realizedTotal,allocation:Math.max(0,asset*.25),risk:Math.max(0,asset*.03)};
  }
  function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}
  function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal()}
  function closeDialog(id){const dialog=$(id);if(dialog.open)dialog.close()}
  function showView(view){
    currentView=view;
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`${view}-view`));
    document.querySelectorAll('.nav-item[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    render();window.scrollTo({top:0,behavior:'instant'});
  }
  function render(){
    const t=totals();
    $('asset-value').textContent=money(t.asset);
    $('realized-value').textContent=signedMoney(t.realized);
    $('realized-value').className=t.realized>0?'positive':t.realized<0?'negative':'';
    $('cash-value').textContent=money(t.cash);
    $('allocation-value').textContent=money(t.allocation);
    $('risk-value').textContent=money(t.risk);
    $('planner-allocation').textContent=money(t.allocation);
    $('planner-risk-limit').textContent=money(t.risk);
    const sorted=[...data.positions].sort((a,b)=>(b.closings.at(-1)?.date||b.date).localeCompare(a.closings.at(-1)?.date||a.date));
    $('recent-list').innerHTML=sorted.length?sorted.slice(0,3).map(card).join(''):emptyState();
    const shown=sorted.filter(p=>filter==='all'||(filter==='open'?remaining(p)>0:remaining(p)===0));
    $('all-list').innerHTML=shown.length?shown.map(card).join(''):emptyState(filter);
    document.querySelectorAll('.segmented [data-filter]').forEach(el=>{el.classList.toggle('selected',el.dataset.filter===filter);el.setAttribute('aria-selected',String(el.dataset.filter===filter))});
    $('starting-capital').value=String(data.settings.startingCapital);
    $('currency').value=data.settings.currency;
    $('multiplier').value=String(data.settings.multiplier);
    renderCloseOptions();renderPlanner();
    let banner=$('setup-banner');
    if(!data.settings.startingCapital){
      if(!banner){banner=document.createElement('button');banner.id='setup-banner';banner.className='setup-banner';banner.innerHTML='<b>先設定起始資金</b><span>設定後即可計算下一筆交易額度 →</span>';banner.addEventListener('click',()=>showView('settings'));document.querySelector('.hero-card').after(banner)}
    } else if(banner) banner.remove();
  }
  function emptyState(type='all'){
    const title=type==='open'?'暫時沒有持倉':type==='closed'?'暫時沒有已平倉交易':'開始記錄第一筆交易';
    const desc=type==='all'?'開倉後，交易詳情及盈虧會顯示在這裏。':'你的交易記錄會按狀態顯示在這裏。';
    return `<div class="empty-state"><div class="empty-icon">⌁</div><strong>${title}</strong><p>${desc}</p>${type==='all'?'<button type="button" class="empty-add">＋ 新增交易</button>':''}</div>`;
  }
  function card(p){
    const rem=remaining(p), pl=realized(p), unit=isSpread(p)?'組':'張', label=rem===0?'已平倉':closedCount(p)?`尚餘 ${rem} ${unit}`:`持倉中 · ${rem} ${unit}`;
    const right=closedCount(p)?`<strong class="${pl>0?'positive':pl<0?'negative':''}">${signedMoney(pl)}</strong><small>${pct(realizedPercent(p))} · ${label}</small>`:`<strong class="status-open">持倉中</strong><small>${rem} ${unit} · ${isSpread(p)?'買入價差':p.side==='long'?'買入':'賣出'}</small>`;
    const title=isSpread(p)?'Bull Call Spread':p.type==='CALL'?'Call':'Put';
    const summary=isSpread(p)?`${esc(p.expiry)} · ${money(p.longStrike)} / ${money(p.shortStrike)} Call`: `${esc(p.expiry)} · ${money(p.strike)} · ${p.side==='long'?'買入':'賣出'}開倉`;
    return `<button class="trade-card ${isSpread(p)?'spread':p.side==='short'?'short':''}" data-position="${esc(p.id)}"><span class="trade-symbol-icon">${isSpread(p)?'↗':p.type==='CALL'?'C':'P'}</span><span class="trade-main"><strong>${esc(p.symbol)} <span style="font-weight:500;color:#8d9b99">${title}</span></strong><small>${summary}</small></span><span class="trade-right">${right}</span></button>`;
  }
  function renderCloseOptions(){
    const current=$('close-position').value;
    const open=data.positions.filter(p=>remaining(p)>0);
    $('close-position').innerHTML=open.length?open.map(p=>`<option value="${esc(p.id)}">${esc(p.symbol)} ${isSpread(p)?`Bull Call ${p.longStrike}/${p.shortStrike}`:`${p.type} ${p.strike}`} · ${p.expiry} · 餘 ${remaining(p)} ${isSpread(p)?'組':'張'}</option>`).join(''):'<option value="">暫時沒有持倉</option>';
    if(open.some(p=>p.id===current))$('close-position').value=current;
    renderCloseSummary();
  }
  function updateTradeFields(){
    const pos=entryMode==='close'?data.positions.find(p=>p.id===$('close-position').value):null;
    const spread=entryMode==='open'?$('strategy').value==='bullCallSpread':!!pos&&isSpread(pos);
    $('strategy-chooser').hidden=entryMode!=='open';
    $('single-open-fields').hidden=entryMode!=='open'||spread;
    $('spread-open-fields').hidden=entryMode!=='open'||!spread;
    $('single-premium-field').hidden=spread;
    $('spread-close-fields').hidden=entryMode!=='close'||!spread;
    $('contracts-field').firstChild.textContent=spread?'價差組數':'合約數量';
    $('fee-hint').hidden=!spread;
  }
  function renderCloseSummary(){
    const pos=data.positions.find(p=>p.id===$('close-position').value);
    $('close-summary').textContent=pos?(isSpread(pos)?`買入 ${money(pos.longStrike)} Call、賣出 ${money(pos.shortStrike)} Call · 開倉淨成本 ${money(spreadDebit(pos))}／股 · 尚餘 ${remaining(pos)} 組`:`開倉權利金 ${money(pos.premium)}／股 · 尚餘 ${remaining(pos)} 張`):'請先新增開倉交易。';
    $('save-trade').disabled=entryMode==='close'&&!pos;
    updateTradeFields();
    renderTradePreview();
  }
  function setEntryMode(mode){
    entryMode=mode;$('open-fields').hidden=mode!=='open';$('close-fields').hidden=mode!=='close';
    document.querySelectorAll('[data-entry-mode]').forEach(el=>el.classList.toggle('selected',el.dataset.entryMode===mode));
    $('trade-dialog-title').textContent=mode==='open'?'新增開倉':'記錄平倉';$('save-trade').textContent=mode==='open'?'儲存開倉':'儲存平倉';
    $('trade-error').textContent='';renderCloseSummary();
  }
  function resetTradeForm(){
    $('trade-form').reset();$('fee').value='0';$('trade-date').value=today();$('trade-error').textContent='';
  }
  function renderTradePreview(){
    const qty=number($('contracts').value),fee=number($('fee').value),mult=data.settings.multiplier;
    if(!isWhole(qty)){$('trade-preview').textContent='';return}
    if(entryMode==='open'){
      if($('strategy').value==='bullCallSpread'){
        if($('spread-debit').value===''){$('trade-preview').textContent='';return}
        const debit=Number($('spread-debit').value),width=Number($('short-strike').value)-Number($('long-strike').value);
        if(!Number.isFinite(debit)||debit<=0){$('trade-preview').textContent='買入價差須有正數淨成本。';return}
        const cost=debit*mult*qty+fee;
        $('trade-preview').textContent=`淨買入成本 ${money(debit)}／股 · 現金減少 ${money(cost)} · 預計最大虧損 ${money(cost)}${width>0?` · 到期最大盈利 ${money((width-debit)*mult*qty-fee)}`:''}`;
      }else{
        if($('premium').value===''){$('trade-preview').textContent='';return}
        const price=Number($('premium').value),isLong=$('side').value==='long';
        if(!Number.isFinite(price)||price<0){$('trade-preview').textContent='';return}
        $('trade-preview').textContent=`${isLong?'買入成本':'賣出收到權利金'} ${money(price*qty*mult)} · 手續費 ${money(fee)} · 現金${isLong?'減少':'增加'} ${money(Math.abs((isLong?-1:1)*price*qty*mult-fee))}`;
      }
    }else{
      const p=data.positions.find(x=>x.id===$('close-position').value);
      if(!p){$('trade-preview').textContent='';return}
      let change;
      if(isSpread(p)){
        if($('spread-credit').value===''){$('trade-preview').textContent='';return}
        const credit=Number($('spread-credit').value);
        if(!Number.isFinite(credit)||credit<0){$('trade-preview').textContent='Net credit 不能少於 0。';return}
        change=credit-spreadDebit(p);
      }else{
        if($('premium').value===''){$('trade-preview').textContent='';return}
        const price=Number($('premium').value);
        change=p.side==='long'?price-p.premium:p.premium-price;
      }
      if(!Number.isFinite(change)){$('trade-preview').textContent='';return}
      const pl=change*qty*mult-p.fee*qty/p.contracts-fee;
      $('trade-preview').textContent=`這次平倉預計盈虧：${signedMoney(pl)}（已扣開倉分攤費用及平倉費用）`;
    }
  }
  function addTrade(event){
    event.preventDefault();$('trade-error').textContent='';
    const qty=Number($('contracts').value),fee=Number($('fee').value),date=$('trade-date').value,notes=$('notes').value.trim();
    if(!isWhole(qty)||$('fee').value===''||!Number.isFinite(fee)||fee<0||!date){$('trade-error').textContent='請填寫有效的數量、日期及手續費。';return}
    if(entryMode==='open'){
      const symbol=$('symbol').value.trim().toUpperCase(),expiry=$('expiry').value;
      if(!/^[A-Z0-9.\-]{1,12}$/.test(symbol)||!expiry){$('trade-error').textContent='請填寫股票代號及到期日。';return}
      if(date>expiry){$('trade-error').textContent='交易日期不能遲於到期日。';return}
      if($('strategy').value==='bullCallSpread'){
        const longStrike=Number($('long-strike').value),shortStrike=Number($('short-strike').value),debit=Number($('spread-debit').value);
        if([$('long-strike'),$('short-strike'),$('spread-debit')].some(el=>el.value==='')||!Number.isFinite(longStrike)||!Number.isFinite(shortStrike)||!Number.isFinite(debit)||longStrike<=0||shortStrike<=longStrike||debit<=0){$('trade-error').textContent='請輸入有效的兩腳行使價及正數 net debit；賣出 Call 行使價須較高。';return}
        data.positions.push({id:uid(),strategy:'bullCallSpread',symbol,type:'CALL',expiry,longStrike,shortStrike,debit,contracts:qty,fee,date,notes,closings:[]});
      }else{
        const strike=Number($('strike').value),premium=Number($('premium').value);
        if($('strike').value===''||$('premium').value===''||!Number.isFinite(strike)||strike<=0||!Number.isFinite(premium)||premium<0){$('trade-error').textContent='請填寫有效行使價及權利金。';return}
        data.positions.push({id:uid(),strategy:'single',symbol,type:$('option-type').value,expiry,strike,side:$('side').value,contracts:qty,premium,fee,date,notes,closings:[]});
      }
    }else{
      const pos=data.positions.find(p=>p.id===$('close-position').value);
      if(!pos){$('trade-error').textContent='請先選擇持倉。';return}
      if(qty>remaining(pos)){$('trade-error').textContent=`平倉數量不能多於尚餘 ${remaining(pos)} ${isSpread(pos)?'組':'張'}。`;return}
      if(date<pos.date){$('trade-error').textContent='平倉日期不能早於開倉日期。';return}
      if(isSpread(pos)){
        const credit=Number($('spread-credit').value);
        if($('spread-credit').value===''||!Number.isFinite(credit)||credit<0){$('trade-error').textContent='請填寫有效的 net credit（可為 0）。';return}
        pos.closings.push({id:uid(),contracts:qty,credit,fee,date,notes});
      }else{
        const premium=Number($('premium').value);
        if($('premium').value===''||!Number.isFinite(premium)||premium<0){$('trade-error').textContent='請填寫有效的平倉權利金。';return}
        pos.closings.push({id:uid(),contracts:qty,premium,fee,date,notes});
      }
    }
    if(!save())return;
    const result=entryMode==='open'?'已記錄開倉':'已記錄平倉，結餘已更新';
    closeDialog('trade-dialog');resetTradeForm();showView('trades');toast(result);
  }
  function showDetail(id){
    const p=data.positions.find(x=>x.id===id);if(!p)return;
    if(isSpread(p)){showSpreadDetail(p);return}
    activePositionId=id;const rem=remaining(p),pl=realized(p),openValue=p.premium*data.settings.multiplier*p.contracts;
    $('detail-title').textContent=`${p.symbol} ${p.type} ${p.strike}`;
    const closings=p.closings.map(c=>`<div class="fill-row"><div><b>${p.side==='long'?'賣出平倉':'買入平倉'} · ${c.contracts} 張</b><small>${esc(c.date)}${c.notes?` · ${esc(c.notes)}`:''}</small></div><div><b>${money(c.premium)}／股</b><small>費用 ${money(c.fee)}</small><button data-delete-close="${esc(c.id)}">刪除</button></div></div>`).join('');
    $('detail-content').innerHTML=`<div class="detail-stat"><span>已實現盈虧 · ${closedCount(p)?(rem?'部分平倉':'全部平倉'):'尚未平倉'}</span><strong class="${pl>0?'positive':pl<0?'negative':''}">${closedCount(p)?signedMoney(pl):'—'}</strong><small>${closedCount(p)?`${pct(realizedPercent(p))} · 以開倉權利金計算`:'尚未平倉，未有已實現盈虧'}</small></div><div class="detail-grid"><div><span>狀態</span><strong>${rem?`持倉中 · 餘 ${rem} 張`:'已平倉'}</strong></div><div><span>方向</span><strong>${p.side==='long'?'買入開倉':'賣出開倉'}</strong></div><div><span>到期日</span><strong>${esc(p.expiry)}</strong></div><div><span>開倉總額</span><strong>${money(openValue)}</strong></div></div><h3 class="detail-section-title">開倉記錄</h3><div class="fill-row"><div><b>${p.side==='long'?'買入':'賣出'} · ${p.contracts} 張</b><small>${esc(p.date)}${p.notes?` · ${esc(p.notes)}`:''}</small></div><div><b>${money(p.premium)}／股</b><small>費用 ${money(p.fee)}</small></div></div>${p.closings.length?`<h3 class="detail-section-title">平倉記錄</h3>${closings}`:''}${rem?'<div class="detail-actions"><button class="primary-button" id="detail-close-position">記錄平倉</button><button class="outline-button" id="delete-position">刪除整筆</button></div>':'<div class="detail-actions"><button class="outline-button" id="delete-position">刪除整筆</button></div>'}`;
    openDialog('detail-dialog');
  }
  function showSpreadDetail(p){
    activePositionId=p.id;
    const rem=remaining(p),pl=realized(p),mult=data.settings.multiplier,debit=spreadDebit(p),width=p.shortStrike-p.longStrike;
    const openCost=debit*mult*p.contracts,maxLoss=openCost+p.fee,maxGain=(width-debit)*mult*p.contracts-p.fee;
    $('detail-title').textContent=`${p.symbol} Bull Call Spread`;
    const closings=p.closings.map(c=>`<div class="fill-row"><div><b>賣出價差 · ${c.contracts} 組</b><small>${esc(c.date)}${c.notes?` · ${esc(c.notes)}`:''}</small>${Number.isFinite(c.credit)?'':`<small>低價 Call 賣出 ${money(c.longPremium)} · 高價 Call 買回 ${money(c.shortPremium)}</small>`}</div><div><b>淨收 ${money(spreadCloseCredit(c))}／股</b><small>費用 ${money(c.fee)}</small><button data-delete-close="${esc(c.id)}">刪除</button></div></div>`).join('');
    $('detail-content').innerHTML=`<div class="detail-stat"><span>已實現盈虧 · ${closedCount(p)?(rem?'部分平倉':'全部平倉'):'尚未平倉'}</span><strong class="${pl>0?'positive':pl<0?'negative':''}">${closedCount(p)?signedMoney(pl):'—'}</strong><small>${closedCount(p)?`${pct(realizedPercent(p))} · 以開倉淨權利金計算`:'尚未平倉，未有已實現盈虧'}</small></div><div class="detail-grid"><div><span>狀態</span><strong>${rem?`持倉中 · 餘 ${rem} 組`:'已平倉'}</strong></div><div><span>到期日</span><strong>${esc(p.expiry)}</strong></div><div><span>買入 Call</span><strong>${money(p.longStrike)} 行使價</strong></div><div><span>賣出 Call</span><strong>${money(p.shortStrike)} 行使價</strong></div><div><span>開倉淨成本</span><strong>${money(openCost)}</strong></div><div><span>開倉手續費</span><strong>${money(p.fee)}</strong></div><div><span>原倉最大虧損</span><strong>${money(maxLoss)}</strong></div><div><span>原倉最大盈利</span><strong>${money(maxGain)}</strong></div></div><h3 class="detail-section-title">買入價差</h3><div class="fill-row"><div><b>${p.contracts} 組 · 買入 ${money(p.longStrike)} Call</b><small>${esc(p.date)} · Net debit ${money(debit)}／股</small></div><div><b>賣出 ${money(p.shortStrike)} Call</b>${Number.isFinite(p.debit)?'':`<small>買入權利金 ${money(p.longPremium)} · 賣出權利金 ${money(p.shortPremium)}／股</small>`}</div></div>${p.notes?`<p class="detail-notes">${esc(p.notes)}</p>`:''}${p.closings.length?`<h3 class="detail-section-title">賣出價差／平倉</h3>${closings}`:''}<p class="subtle-note">原倉最大盈虧以開倉時全部組數保持至到期估算，已計開倉費用；行權、指派及其他費用不在記錄內。</p>${rem?'<div class="detail-actions"><button class="primary-button" id="detail-close-position">記錄賣出／平倉</button><button class="outline-button" id="delete-position">刪除整筆</button></div>':'<div class="detail-actions"><button class="outline-button" id="delete-position">刪除整筆</button></div>'}`;
    openDialog('detail-dialog');
  }
  function renderPlanner(){
    const t=totals(),result=$('planner-result'),strong=result.querySelector('strong'),small=result.querySelector('small');
    let capital,risk;
    if(planMode==='long'){
      const entry=Number($('plan-entry').value),stop=$('plan-stop').value===''?0:Number($('plan-stop').value);
      if($('plan-entry').value===''||!Number.isFinite(entry)||entry<=0){strong.textContent='—';small.textContent='輸入權利金後即時試算';return}
      if(!Number.isFinite(stop)||stop<0||stop>=entry){strong.textContent='—';small.textContent='止損價須低於買入權利金';return}
      capital=entry*data.settings.multiplier;risk=(entry-stop)*data.settings.multiplier;
    }else if(planMode==='spread'){
      const debit=Number($('plan-spread-debit').value),fee=Number($('plan-spread-fee').value);
      if($('plan-spread-debit').value===''||$('plan-spread-fee').value===''||!Number.isFinite(debit)||!Number.isFinite(fee)||debit<=0||fee<0){strong.textContent='—';small.textContent='輸入正數 net debit 及有效手續費';return}
      capital=debit*data.settings.multiplier+fee;risk=capital;
    }else{
      capital=Number($('plan-capital').value);risk=Number($('plan-risk').value);
      if($('plan-capital').value===''||$('plan-risk').value===''||!Number.isFinite(capital)||!Number.isFinite(risk)||capital<=0||risk<=0){strong.textContent='—';small.textContent='輸入每張佔用資金及最大虧損';return}
    }
    const byCapital=Math.floor(t.allocation/capital),byRisk=Math.floor(t.risk/risk),qty=Math.max(0,Math.min(byCapital,byRisk));
    const unit=planMode==='spread'?'組':'張';
    strong.textContent=`${qty} ${unit}`;
    small.textContent=qty?`每${unit}佔用 ${money(capital)} · 計劃風險 ${money(risk)} · ${byCapital<byRisk?'資金':'風險'}上限約束`:`目前額度不足以開 1 ${unit}；可調整資金或風險計劃`;
  }
  function exportData(){const blob=new Blob([JSON.stringify({...data,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`option-log-backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('備份檔案已匯出')}
  function validImport(x){
    if(!x||x.version!==1||!x.settings||!Array.isArray(x.positions))return false;
    if(!Number.isFinite(Number(x.settings.startingCapital))||Number(x.settings.startingCapital)<0||!['USD','HKD'].includes(x.settings.currency)||!isWhole(Number(x.settings.multiplier)))return false;
    return x.positions.every(p=>{
      if(!p||typeof p.id!=='string'||typeof p.symbol!=='string'||!isWhole(p.contracts)||!Number.isFinite(p.fee)||p.fee<0||typeof p.date!=='string'||typeof p.expiry!=='string'||!Array.isArray(p.closings)||!p.closings.every(c=>c&&isWhole(c.contracts))||p.closings.reduce((s,c)=>s+c.contracts,0)>p.contracts)return false;
      if(isSpread(p))return p.type==='CALL'&&Number.isFinite(p.longStrike)&&Number.isFinite(p.shortStrike)&&p.longStrike>0&&p.shortStrike>p.longStrike&&((Number.isFinite(p.debit)&&p.debit>0)||(Number.isFinite(p.longPremium)&&Number.isFinite(p.shortPremium)&&p.longPremium>p.shortPremium&&p.shortPremium>=0))&&p.closings.every(c=>c&&typeof c.id==='string'&&isWhole(c.contracts)&&((Number.isFinite(c.credit)&&c.credit>=0)||(Number.isFinite(c.longPremium)&&c.longPremium>=0&&Number.isFinite(c.shortPremium)&&c.shortPremium>=0))&&Number.isFinite(c.fee)&&c.fee>=0&&typeof c.date==='string');
      return (!p.strategy||p.strategy==='single')&&['CALL','PUT'].includes(p.type)&&['long','short'].includes(p.side)&&Number.isFinite(p.premium)&&p.premium>=0&&Number.isFinite(p.strike)&&p.strike>0&&p.closings.every(c=>c&&typeof c.id==='string'&&isWhole(c.contracts)&&Number.isFinite(c.premium)&&c.premium>=0&&Number.isFinite(c.fee)&&c.fee>=0&&typeof c.date==='string');
    });
  }
  async function importData(event){
    const file=event.target.files?.[0];if(!file)return;
    try {const parsed=JSON.parse(await file.text());if(!validImport(parsed))throw new Error('invalid');if(!confirm('匯入會覆蓋目前所有設定及交易記錄。確定繼續？'))return;data={version:1,settings:parsed.settings,positions:parsed.positions};if(save()){render();toast('已匯入備份')}}
    catch(_){toast('匯入失敗：檔案格式不正確')}finally{event.target.value=''}
  }

  document.querySelectorAll('.nav-item[data-view]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view)));
  $('settings-button').addEventListener('click',()=>showView('settings'));
  $('see-all').addEventListener('click',()=>showView('trades'));
  $('add-button').addEventListener('click',()=>{resetTradeForm();setEntryMode('open');openDialog('trade-dialog')});
  $('open-planner').addEventListener('click',()=>{renderPlanner();openDialog('planner-dialog')});
  $('asset-info').addEventListener('click',()=>toast('總資產 = 起始資金 + 已實現盈虧 − 未平倉開倉費用；不含持倉市價變動'));
  document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>closeDialog(el.dataset.close)));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()}));
  document.querySelectorAll('[data-entry-mode]').forEach(el=>el.addEventListener('click',()=>setEntryMode(el.dataset.entryMode)));
  document.querySelectorAll('[data-plan-mode]').forEach(el=>el.addEventListener('click',()=>{planMode=el.dataset.planMode;document.querySelectorAll('[data-plan-mode]').forEach(b=>b.classList.toggle('selected',b===el));$('long-planner').hidden=planMode!=='long';$('spread-planner').hidden=planMode!=='spread';$('short-planner').hidden=planMode!=='short';renderPlanner()}));
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>{filter=el.dataset.filter;render()}));
  $('close-position').addEventListener('change',renderCloseSummary);
  $('strategy').addEventListener('change',()=>{updateTradeFields();renderTradePreview()});
  ['contracts','premium','fee','side','long-strike','short-strike','spread-debit','spread-credit'].forEach(id=>$(id).addEventListener('input',renderTradePreview));
  ['plan-entry','plan-stop','plan-capital','plan-risk','plan-spread-debit','plan-spread-fee'].forEach(id=>$(id).addEventListener('input',renderPlanner));
  $('trade-form').addEventListener('submit',addTrade);
  $('settings-form').addEventListener('submit',event=>{event.preventDefault();const capital=Number($('starting-capital').value),mult=Number($('multiplier').value);if(!Number.isFinite(capital)||capital<0||!isWhole(mult)){toast('請輸入有效起始資金及合約乘數');return}if(data.positions.length&&mult!==data.settings.multiplier&&!confirm('更改合約乘數會重新計算過往全部交易盈虧。確定繼續？'))return;data.settings={startingCapital:capital,currency:$('currency').value,multiplier:mult};if(save()){render();toast('設定已儲存')}});
  $('export-button').addEventListener('click',exportData);$('import-file').addEventListener('change',importData);
  $('reset-button').addEventListener('click',()=>{if(!data.positions.length){toast('暫時沒有交易記錄');return}if(!confirm('確定清除所有交易記錄？此操作無法復原，建議先匯出備份。'))return;data.positions=[];if(save()){render();toast('交易記錄已清除')}});
  document.addEventListener('click',event=>{
    const positionButton=event.target.closest('[data-position]');if(positionButton){showDetail(positionButton.dataset.position);return}
    if(event.target.closest('.empty-add')){resetTradeForm();setEntryMode('open');openDialog('trade-dialog');return}
    const delClose=event.target.closest('[data-delete-close]');if(delClose){const p=data.positions.find(x=>x.id===activePositionId);if(p&&confirm('確定刪除這筆平倉記錄？')){p.closings=p.closings.filter(c=>c.id!==delClose.dataset.deleteClose);if(save()){render();showDetail(p.id);toast('平倉記錄已刪除')}}return}
    if(event.target.id==='delete-position'){const p=data.positions.find(x=>x.id===activePositionId);if(p&&confirm(`確定刪除 ${p.symbol} 整筆交易及所有平倉記錄？`)){data.positions=data.positions.filter(x=>x.id!==p.id);if(save()){closeDialog('detail-dialog');render();toast('交易已刪除')}}return}
    if(event.target.id==='detail-close-position'){const id=activePositionId;closeDialog('detail-dialog');resetTradeForm();setEntryMode('close');renderCloseOptions();$('close-position').value=id;$('contracts').value=String(remaining(data.positions.find(p=>p.id===id)));renderCloseSummary();openDialog('trade-dialog')}
  });
  render();
})();

