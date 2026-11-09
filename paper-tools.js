(() => {
  "use strict";
  const fee = 0.0005;
  const sign = side => side === "Long" ? 1 : -1;
  const positive = n => Number.isFinite(n) && n > 0;
  function unitRisk(side, entry, stop, bps) {
    if (![entry,stop].every(positive) || (entry-stop)*sign(side)<=0) throw new Error("Place the stop below a long entry or above a short entry.");
    if (!Number.isFinite(bps) || bps<0 || bps>=10000) throw new Error("Exit slippage must be between 0 and 9,999 bps.");
    const exit = stop*(1-sign(side)*bps/10000);
    return Math.abs(entry-exit)+fee*(entry+exit);
  }
  function sizeTrade({side,entry,stop,bps,budget,step,min,minValue=0,max=Infinity,cash,leverage}) {
    if (![budget,step,min,cash,leverage].every(positive)) throw new Error("Enter a positive loss budget and wait for the venue quantity rules.");
    const perUnit=unitRisk(side,entry,stop,bps);
    const cap=Math.min(budget/perUnit,cash/(entry*(1/leverage+fee)),max);
    const qty=Number((Math.floor(cap/step+1e-12)*step).toPrecision(14));
    if (qty<min || qty*entry<minValue) throw new Error("Sized quantity is below the venue minimum.");
    return {qty,loss:qty*perUnit,margin:qty*entry/leverage};
  }
  function stress(book,side,quantity,reduction) {
    const levels=side==="Long"?book.asks:book.bids;
    const midpoint=(book.asks[0][0]+book.bids[0][0])/2;
    let executable=0,value=0;
    for (const [price,size] of levels) {
      const take=Math.min(Math.max(0,quantity-executable),size*(1-reduction));
      executable+=take; value+=take*price;
      if (executable>=quantity) break;
    }
    const vwap=executable?value/executable:null;
    return {executable,vwap,bps:vwap===null?null:(vwap/midpoint-1)*10000*sign(side)};
  }
  function limits(a,equity,now) {
    const midnight=new Date(now).setUTCHours(0,0,0,0);
    const baseline=a.startingCash+a.journal.filter(t=>t.closedAt<midnight).reduce((s,t)=>s+t.net,0);
    const loss=Math.max(0,baseline-equity);
    const exposure=a.positions.reduce((s,p)=>s+p.qty*p.mark,0)+a.orders.reduce((s,o)=>s+o.margin*o.leverage,0);
    return {loss,exposure,lossLeft:(a.riskLimits?.loss??Infinity)-loss,exposureLeft:(a.riskLimits?.gross??Infinity)-exposure};
  }
  function fundingImpact(rate,mark,positions) {
    return positions.reduce((cash,p)=>cash-rate*mark*p.qty*sign(p.side),0);
  }
  const multiple=p=>positive(p.initialRisk)?p.net/p.initialRisk:null;
  function journalCsv(rows) {
    const columns=["id","symbol","side","exchange","openedAt","closedAt","entry","exit","qty","entryFee","exitFee","funding","net","initialRisk","R","thesis","invalidation","plannedExit","setup","review"];
    const cell=value=>{
      let s=String(value??"");
      if(typeof value==="string" && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s)) s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    return [columns,...rows.map(p=>columns.map(k=>({...p,...p.plan,R:multiple(p)})[k]))].map(row=>row.map(cell).join(",")).join("\r\n");
  }
  const cache = new Map();
  async function json(url,ttl) {
    const old=cache.get(url);
    if(old && Date.now()<old.until) return old.value;
    const value=fetch(url,{signal:AbortSignal.timeout(6500),cache:"no-store"}).then(async r=>{
      if(!r.ok) throw new Error("HTTP "+r.status);
      const data=await r.json();
      if(data.retCode!==undefined && data.retCode!==0) throw new Error("Venue rejected market data request");
      return data;
    });
    cache.set(url,{value,until:Date.now()+ttl});
    try {return await value;} catch(e){cache.delete(url);throw e;}
  }
  async function contractInfo(symbol,source) {
    if(source==="Binance USD-M"){
      const base="https://fapi.binance.com/fapi/v1/";
      const data=await json(base+"exchangeInfo",3600000);
      const contract=data.symbols.find(s=>s.symbol===symbol);
      const filters=contract.filters;
      const lot=filters.find(f=>f.filterType==="LOT_SIZE"),market=filters.find(f=>f.filterType==="MARKET_LOT_SIZE")||lot;
      const minValue=Number(filters.find(f=>f.filterType==="MIN_NOTIONAL")?.notional||0);
      const rule=f=>({step:Number(f.stepSize),min:Number(f.minQty),max:Number(f.maxQty),minValue});
      return {Market:rule(market),Limit:rule(lot)};
    }
    const row=(await json("https://api.bybit.com/v5/market/instruments-info?category=linear&symbol="+symbol,300000)).result.list[0];
    const lot=row.lotSizeFilter;
    const rule={step:Number(lot.qtyStep),min:Number(lot.minOrderQty),minValue:Number(lot.minNotionalValue||0)};
    return {interval:Number(row.fundingInterval)/60,Market:{...rule,max:Number(lot.maxMktOrderQty)},Limit:{...rule,max:Number(lot.maxOrderQty)}};
  }
  async function calendar(symbol,source) {
    let rate,settled,next,interval,mark,previous;
    if(source==="Binance USD-M"){
      const base="https://fapi.binance.com/fapi/v1/";
      const [ticker,adjustments,history]=await Promise.all([json(base+"premiumIndex?symbol="+symbol,15000),
        json(base+"fundingInfo",300000),json(base+"fundingRate?symbol="+symbol+"&limit=1",60000)]);
      rate=Number(ticker.lastFundingRate); next=Number(ticker.nextFundingTime); mark=Number(ticker.markPrice);
      interval=Number(adjustments.find(a=>a.symbol===symbol)?.fundingIntervalHours??8);
      settled=Number(history[0]?.fundingRate);previous=Number(history[0]?.fundingTime);
    } else {
      const base="https://api.bybit.com/v5/market/";
      const [t,h,c]=await Promise.all([json(base+"tickers?category=linear&symbol="+symbol,15000),
        json(base+"funding/history?category=linear&symbol="+symbol+"&limit=1",60000),contractInfo(symbol,source)]);
      const ticker=t.result.list[0],last=h.result.list[0];
      rate=Number(ticker.fundingRate);next=Number(ticker.nextFundingTime);mark=Number(ticker.markPrice);
      settled=Number(last?.fundingRate);previous=Number(last?.fundingRateTimestamp);
      interval=Number(ticker.fundingIntervalHour)||c.interval;
    }
    if (![rate,settled].every(Number.isFinite)||![mark,next,previous,interval].every(positive)||next<=Date.now()) throw new Error("Funding window unavailable");
    return {rate,next,mark,interval,settled,previous};
  }
  const api={sizeTrade,unitRisk,stress,limits,fundingImpact,multiple,journalCsv,contractInfo,calendar};
  if(typeof module!=="undefined" && module.exports) module.exports=api; else window.PaperTools=api;
})();
