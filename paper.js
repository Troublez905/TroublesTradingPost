/* Local USDT perpetual simulator. All balances and fills are virtual. */
(() => {
  "use strict";
  const STORAGE = "ttp.paper.account.v1";
  const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const FEE = 0.0005;
  const MAINTENANCE = 0.005;
  const FUNDING = 0.0001;
  const EIGHT_HOURS = 28800000;
  const research = typeof module !== "undefined" && module.exports ? require("./paper-tools.js") : window.PaperTools;
  const validNumber = n => typeof n === "number" && Number.isFinite(n);
  const positive = n => validNumber(n) && n > 0;
  const sideSign = side => side === "Long" ? 1 : -1;
  const format = n => new Intl.NumberFormat("en-US", {minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const money = n => "$" + format(n);
  const escape = str => String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const when = ms => new Date(ms).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",timeZone:"UTC"}) + " UTC";
  const account = (name, cash, now) => {
    if (!validNumber(cash) || cash < 1 || cash > 100000000 || !name.trim() || name.trim().length > 32) throw new Error("Choose a name and a starting balance from 1 to 100,000,000 USDT.");
    return {version:1,name:name.trim(),startingCash:cash,cash,positions:[],orders:[],journal:[],updatedAt:now};
  };
  function funding(position, now) {
    const periods = Math.max(0, Math.floor(now / EIGHT_HOURS) - Math.floor(position.openedAt / EIGHT_HOURS));
    return periods * position.qty * position.entry * FUNDING * sideSign(position.side);
  }
  function positionValue(p, mark, now) {
    const pnl = (mark - p.entry) * p.qty * sideSign(p.side);
    return p.margin + pnl - funding(p, now);
  }
  function liquidationPrice(p, now) {
    const sign = sideSign(p.side);
    return Math.max(0, (p.entry * p.qty * sign - p.margin + funding(p,now)) / (p.qty * (sign - MAINTENANCE - FEE)));
  }
  function reserve(order) {
    return order.margin + order.margin * order.leverage * FEE;
  }
  function fill(a, o, price, now) {
    const notional = o.targetQty ? o.targetQty*price : o.margin*o.leverage;
    const margin=notional/o.leverage;
    const stop=o.plan?.invalidation;
    const qty=o.targetQty??notional/price;
    const initialRisk=positive(stop) && (price-stop)*sideSign(o.side)>0 ? qty*research.unitRisk(o.side,price,stop,o.slippage??0) : null;
    if(o.targetQty && (!initialRisk || initialRisk>o.budget+1e-8 || margin+notional*FEE>a.cash+reserve(o)+1e-8)) return false;
    a.cash+=reserve(o)-margin-notional*FEE;
    const position = {...o,margin,qty,initialRisk,entry:price,openedAt:now,entryFee:notional * FEE,mark:price,markTime:now};
    a.positions.push(position);
    return true;
  }
  // Quote-sized entry orders and base-sized exits both walk displayed liquidity.
  function depthPrice(levels, target, quoteSized, boundary, buy) {
    let left=target, quantity=0, value=0;
    for (const [price,size] of levels) {
      if (boundary && (buy ? price>boundary : price<boundary)) break;
      const take=Math.min(size,quoteSized ? left/price : left);
      quantity+=take;
      value+=take*price;
      left-=quoteSized ? take*price : take;
      if (left<=target*1e-12) return value/quantity;
    }
    return null;
  }
  function entryPrice(order,quote) {
    const buy=order.side==="Long";
    return depthPrice(buy?quote.asks:quote.bids,order.targetQty??order.margin*order.leverage,!order.targetQty,order.type==="Limit" && order.limit,buy);
  }
  function place(a, order, quote, now) {
    if (!["Long","Short"].includes(order.side) || !SYMBOLS.includes(order.symbol) ||
        !positive(order.margin) || !Number.isInteger(order.leverage) || order.leverage < 1 || order.leverage > 20 ||
        !["Market","Limit"].includes(order.type) || (order.type === "Limit" && !positive(order.limit)))
      throw new Error("Choose a valid contract, margin, leverage (1-20), and order price.");
    if (!quote || !positive(quote.price) || quote.symbol !== order.symbol || now - quote.asOf > 30000 || now < quote.asOf)
      throw new Error("Wait for a fresh exchange quote before placing an order.");
    if (reserve(order) > a.cash) throw new Error("Available cash must cover isolated margin and the opening fee.");
    const capacity=research.limits(a,summary(a,now).equity,now);
    if(capacity.lossLeft<=0 || capacity.exposureLeft<order.margin*order.leverage) throw new Error("Session loss or gross exposure limit reached. Reduce exposure or cancel a pending order.");
    const o = {...order,placedAt:now};
    const executable=entryPrice(o,quote);
    if (!executable && o.type==="Market") throw new Error("Insufficient displayed depth for this order. Reduce size.");
    a.cash -= reserve(order);
    if (executable) {
      if ((o.targetQty && o.targetQty*executable>capacity.exposureLeft) || !fill(a,o,executable,now)) {
        a.cash+=reserve(order);
        throw new Error("Executable price exceeds your risk, exposure or margin budget. Recalculate the size.");
      }
    }
    else a.orders.push(o);
  }
  function close(a, id, price, now, reason, fraction=1) {
    const original = a.positions.find(item => item.id === id);
    if (!original || !positive(price) || !(fraction>0 && fraction<=1)) throw new Error("Position or closing quote unavailable.");
    const p={...original};
    if(fraction<1){
      p.id=crypto.randomUUID();
      for(const k of ["qty","margin","entryFee","initialRisk"]) if(validNumber(p[k])) {
        p[k]*=fraction; original[k]-=p[k];
      }
    }
    const fee = price * p.qty * FEE;
    const released = Math.max(0,positionValue(p,price,now) - fee);
    a.cash += released;
    a.journal.unshift({...p,exit:price,closedAt:now,exitFee:fee,funding:funding(p,now),net:released - p.margin - p.entryFee,reason});
    if(fraction===1) a.positions = a.positions.filter(item => item.id !== id);
  }
  function settle(a, quote, now) {
    for (const p of a.positions.filter(item=>item.symbol===quote.symbol && item.exchange===quote.source)) {
      p.mark=quote.price; p.markTime=quote.asOf;
    }
    for (const o of a.orders.filter(item => item.symbol === quote.symbol && item.exchange === quote.source)) {
      const executable=entryPrice(o,quote);
      if (!executable) continue;
      const capacity=research.limits(a,summary(a,now).equity,now);
      const added=o.targetQty?o.targetQty*executable:o.margin*o.leverage;
      if(capacity.lossLeft<=0 || added>capacity.exposureLeft+o.margin*o.leverage+1e-8 || !fill(a,o,executable,now)) continue;
      a.orders = a.orders.filter(item => item.id !== o.id);
    }
    for (const p of a.positions.filter(item => item.symbol === quote.symbol && item.exchange === quote.source)) {
      p.mark = quote.price;
      p.markTime = quote.asOf;
      if (positionValue(p,p.mark,now) <= p.qty * p.mark * (MAINTENANCE + FEE)) close(a,p.id,p.mark,now,"Liquidated");
    }
  }
  function summary(a, now) {
    const equity = a.cash + a.orders.reduce((sum,o) => sum + reserve(o),0) +
      a.positions.reduce((sum,p) => sum + Math.max(0,positionValue(p,p.mark,now)),0);
    return {name:a.name,startingCash:a.startingCash,equity,realizedPnl:a.journal.reduce((sum,p)=>sum+p.net,0),
      closedTrades:a.journal.length,returnPct:(equity/a.startingCash - 1)*100,updatedAt:a.updatedAt};
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {account,place,settle,close,reserve,summary,funding,liquidationPrice,depthPrice};
    return;
  }

  let panel, state, timer, sequence = 0, selected = SYMBOLS[0], idea, notice = "";
  const quotes = new Map(), issues = new Map();
  const metadata = new Map();
  async function loadMetadata(q) {
    const key=q.source+"/"+q.symbol;
    const info=metadata.get(key)||{};
    if(info.loading || Date.now()-(info.updated??0)<30000) return;
    info.loading=true; metadata.set(key,info);
    const results=await Promise.allSettled([research.contractInfo(q.symbol,q.source),research.calendar(q.symbol,q.source)]);
    for(const [i,k] of ["rules","calendar"].entries()) {
      info[k]=results[i].status==="fulfilled"?results[i].value:null;
      info[k+"Error"]=results[i].status==="rejected"?results[i].reason.message:"";
    }
    info.updated=Date.now();info.loading=false;
    if(!panel.hidden && selected===q.symbol) estimate();
  }
  function read() {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (a.version !== 1 || !positive(a.startingCash) || !validNumber(a.cash) ||
        !Array.isArray(a.positions) || !Array.isArray(a.orders) || !Array.isArray(a.journal))
      throw new Error("Saved account format is unreadable.");
    return a;
  }
  window.paperLeaderboardEntry = () => {
    try { const a = read(); return a && summary(a,Date.now()); }
    catch { return null; }
  };
  async function mutate(change) {
    const commit = () => {
      const latest = read();
      const next = change(latest);
      if (!next) return;
      next.updatedAt = Date.now();
      localStorage.setItem(STORAGE,JSON.stringify(next));
      state = next;
      window.dispatchEvent(new CustomEvent("paper-account-change"));
    };
    if (navigator.locks) await navigator.locks.request(STORAGE,commit);
    else commit();
  }
  async function fetchQuote(symbol, pinnedSource) {
    const errors = [];
    const sources = [
      ["Binance USD-M","https://fapi.binance.com/fapi/v1/klines?symbol="+symbol+"&interval=1m&limit=61"],
      ["Bybit Linear","https://api.bybit.com/v5/market/kline?category=linear&symbol="+symbol+"&interval=1&limit=61"]
    ];
    for (const [source,url] of sources) {
      if (pinnedSource && pinnedSource !== source) continue;
      const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),5500);
      try {
        const binance=source==="Binance USD-M";
        const depth=binance?"https://fapi.binance.com/fapi/v1/depth?limit=100&symbol="+symbol:
          "https://api.bybit.com/v5/market/orderbook?category=linear&limit=50&symbol="+symbol;
        const [data,book]=await Promise.all([url,depth].map(async endpoint=>{
          const r=await fetch(endpoint,{cache:"no-store",signal:controller.signal});
          if (!r.ok) throw new Error("HTTP "+r.status);
          return r.json();
        }));
        const rows = Array.isArray(data) ? data : data.retCode === 0 && data.result.symbol === symbol && data.result.category === "linear" && data.result.list;
        if (!Array.isArray(rows)) throw new Error("Invalid exchange response");
        const bars = rows.map(row => row.slice(0,5).map(Number)).sort((a,b)=>a[0]-b[0]).slice(-60);
        const now = Date.now(), last = bars.at(-1);
        if (bars.length !== 60 || bars.some(([t,o,h,l,c],i) => !Number.isInteger(t) || t%60000 || ![o,h,l,c].every(positive) ||
          h<Math.max(o,c) || l>Math.min(o,c) || (i && t-bars[i-1][0]!==60000)) ||
          last[0]>now || now-last[0]>=60000) throw new Error("Missing current candles");
        const asOf=Number(binance?book.T:book.result?.ts);
        const levels=rows=>Array.isArray(rows)?rows.map(level=>level.slice(0,2).map(Number)):[];
        const asks=levels(binance?book.asks:book.result?.a).sort((a,b)=>a[0]-b[0]);
        const bids=levels(binance?book.bids:book.result?.b).sort((a,b)=>b[0]-a[0]);
        if (!positive(asOf) || now-asOf>30000 || asOf-now>5000 || !asks.length || !bids.length ||
          [...asks,...bids].some(level=>level.length!==2 || !level.every(positive)) || bids[0][0]>=asks[0][0] ||
          (!binance && (book.retCode!==0 || book.result.s!==symbol))) throw new Error("Order book unavailable or stale");
        return {symbol,source,bars,price:last[4],asOf:Math.min(now,asOf),asks,bids};
      } catch (e) { errors.push(source+" ("+e.message+")"); }
      finally { clearTimeout(timeout); }
    }
    throw new Error(errors.join(", "));
  }
  function fresh(symbol, source) {
    const key = source ? symbol+"/"+source : symbol;
    const q = quotes.get(key);
    if (issues.has(key) || !q || Date.now()-q.asOf>30000) throw new Error("A fresh "+key+" quote is required. Refresh prices.");
    return q;
  }
  async function refresh() {
    if (panel.hidden || document.hidden) return;
    const ticket = ++sequence;
    const contracts = new Set([selected,...[...(state?.positions||[]),...(state?.orders||[])].map(p=>p.symbol+"/"+p.exchange)]);
    const fetched = await Promise.all([...contracts].map(async key => {
      const [symbol, source] = key.split("/");
      try { return {key,quote:await fetchQuote(symbol,source)}; }
      catch(e) { return {key,error:e.message}; }
    }));
    if (ticket !== sequence || panel.hidden) return;
    for (const {key,quote,error} of fetched) {
      if (error) issues.set(key,error);
      else {
        quotes.set(key,quote); issues.delete(key);
        quotes.set(quote.symbol+"/"+quote.source,quote);
      }
    }
    try {
      await mutate(a=>{
        if (!a || !(a.orders.length || a.positions.length)) return;
        for (const {quote} of fetched) if (quote && Date.now()-quote.asOf<30000) settle(a,quote,Date.now());
        return a;
      });
      render();
      if(quotes.has(selected) && !issues.has(selected)) loadMetadata(quotes.get(selected));
    } catch(e) { showError(e); }
  }
  function candles(q) {
    const first=q.bars[0][0],last=q.bars.at(-1)[0]+60000;
    const trades=[...(state?.positions||[]),...(state?.journal||[])].filter(p=>p.symbol===q.symbol && p.exchange===q.source);
    const events=trades.flatMap(p=>[
      {time:p.openedAt,price:p.entry,label:"Entry"},{time:p.closedAt,price:p.exit,label:"Exit"}
    ]).filter(e=>e.time>=first && e.time<last && positive(e.price));
    const low = Math.min(...q.bars.map(b=>b[3]),...events.map(e=>e.price)), high = Math.max(...q.bars.map(b=>b[2]),...events.map(e=>e.price));
    const y = value => high===low ? 72 : 138-132*(value-low)/(high-low);
    const marks = q.bars.map(([,o,h,l,c],i)=>{
      const x=8+i*9.8, color=c>=o?"#4be0e2":"#ff7187";
      return `<path stroke="${color}" d="M${x} ${y(h)}V${y(l)}"/><rect fill="${color}" x="${x-3}" y="${Math.min(y(o),y(c))}" width="6" height="${Math.max(1,Math.abs(y(o)-y(c)))}"/>`;
    }).join("");
    const markers=events.map(e=>{
      const x=8+(e.time-first)/60000*9.8,cy=y(e.price);
      return `<circle cx="${x}" cy="${cy}" r="4" stroke="#fff" fill="${e.label==="Entry"?"#118598":"#ac4059"}"><title>${e.label} ${money(e.price)} at ${when(e.time)}</title></circle>`;
    }).join("");
    return `<div class="paper-chart-head"><strong>${money(q.price)}</strong><span>${q.source} &middot; ${when(q.asOf)}</span></div>
      <svg viewBox="0 0 600 146" role="img" aria-label="60 one-minute candles for ${q.symbol}, range ${format(low)} to ${format(high)} USDT"><path d="M0 6H600 M0 72H600 M0 138H600" stroke="currentColor" opacity=".15"/>${marks}${markers}</svg>
      <div class="paper-chart-head"><span>${when(q.bars[0][0])}</span><span>1m candles &middot; latest candle forming</span><span>${when(q.bars.at(-1)[0])}</span></div>
      <div class="paper-book"><h3>Order book</h3><table><caption>Top five levels &middot; sizes in ${q.symbol.replace("USDT","")}</caption>
      <thead><tr><th>Bid size</th><th>Bid (USDT)</th><th>Ask (USDT)</th><th>Ask size</th></tr></thead><tbody>
      ${Array.from({length:Math.min(5,Math.max(q.bids.length,q.asks.length))},(_,i)=>{
        const bid=q.bids[i], ask=q.asks[i];
        const size=level=>level?level[1].toLocaleString("en-US",{maximumFractionDigits:8}):"&mdash;";
        return `<tr><td>${size(bid)}</td><td>${bid?format(bid[0]):"&mdash;"}</td><td>${ask?format(ask[0]):"&mdash;"}</td><td>${size(ask)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function mount() {
    panel.innerHTML = `<small>VIRTUAL USDT ACCOUNT</small><h2>Paper exchange</h2>
      <div class="paper-account"></div><div class="paper-market">
      <article class="paper-card"><div class="paper-controls"><label>Contract <select data-field="symbol">${SYMBOLS.map(s=>'<option>'+s+'</option>').join("")}</select></label>
      <button type="button" data-action="refresh">Refresh prices</button></div><div class="paper-chart"></div>
      <h3>Funding calendar</h3><div class="paper-funding"></div><h3>Liquidity stress test</h3>
      <label>Scenario quantity (base units) <input data-field="stress-size" type="number" min="0" step="any" value="1"></label>
      <label>Scenario side <select data-field="stress-side"><option>Long</option><option>Short</option></select></label><div class="paper-stress"></div></article>
      <form class="paper-card paper-ticket"><h3>Order ticket</h3><label>Direction <select name="side"><option>Long</option><option>Short</option></select></label>
      <label>Order type <select name="type"><option>Market</option><option>Limit</option></select></label>
      <label class="paper-limit" hidden>Limit price (USDT) <input type="number" step="any" min="0.000001" name="limit"></label>
      <label>Isolated margin (USDT) <input name="margin" type="number" step="0.01" min="0.01" value="100" required></label>
      <label>Leverage <select name="leverage">${[1,2,3,5,10,20].map(n=>'<option value="'+n+'">'+n+'x</option>').join("")}</select></label>
      <label>Signal attribution <select name="attribution"><option>Own idea</option></select></label>
      <label>Position sizing <select name="sizing"><option>Margin</option><option>Stop risk</option></select></label>
      <label class="paper-sizing" hidden>Planned entry (USDT) <input name="entry" type="number" step="any" min="0" placeholder="Best ask or bid"></label>
      <label class="paper-sizing" hidden>Maximum loss (USDT) <input name="budget" type="number" step="any" min="0" value="10"></label>
      <label class="paper-sizing" hidden>Estimated exit slippage (bps) <input name="slippage" type="number" step="any" min="0" max="9999" value="5"></label>
      <label>Stop / invalidation (USDT) <input name="stop" type="number" step="any" min="0"></label>
      <label>Planned exit (USDT) <input name="plannedExit" type="number" step="any" min="0"></label>
      <label>Setup tag <input name="setup" maxlength="64"></label><label>Entry thesis <input name="thesis" maxlength="500"></label>
      <p class="paper-plan-note">Stop and target are planning levels only. Closing a position requires a separate order. Actual loss can exceed the estimated stop loss.</p>
      <div class="paper-estimate"></div><button type="submit">Place paper order</button></form></div>
      <p class="paper-notice" role="status"></p>
      <form class="paper-guard" hidden><h3>Session limits</h3><label>UTC loss limit (USDT) <input type="number" min="0" step="any" name="loss" placeholder="Unlimited"></label>
      <label>Maximum gross exposure (USDT) <input type="number" min="0" step="any" name="gross" placeholder="Unlimited"></label><button>Save limits</button>
      <p>UTC sessions count today's realized P&amp;L and all open P&amp;L, including overnight positions. Pending entries reserve exposure. Blank limits are unlimited.</p></form>
      <div class="paper-ledger"></div><form class="paper-review" hidden><h3>Review a closed trade</h3><label>Trade <select name="trade"></select></label>
      <label>Post-trade review <textarea name="review" maxlength="2000"></textarea></label><button>Save review</button>
      <button type="button" data-action="export">Export journal CSV</button></form>
      <details><summary>Execution model</summary><p>Exchange candles and displayed order-book depth refresh about every 15 seconds while this desk is visible. Buys consume asks and sells consume bids in a simulated full-size fill at the volume-weighted price. Limits fill only when the sampled book covers the full order within its price. Each order uses an independent book snapshot. Queue position, partial fills and market impact are omitted. Orders and positions stay on their entry venue.</p>
      <p>Pending orders reserve margin plus a 0.05% opening fee. Closing costs 0.05%. Liquidation uses the sampled last price, 0.5% maintenance margin and the estimated closing fee. Losses are capped at isolated margin plus the opening fee. Fixed simulated funding of 0.01% of entry notional transfers from longs to shorts every eight hours at 00:00, 08:00 and 16:00 UTC. Orders and liquidation checks resume at the next observed quote after an interruption.</p></details>
      <p><a href="#leaderboard">Open the competition leaderboard &#8599;</a></p>`;
    panel.onchange = e => {
      if (e.target.dataset.field === "symbol") { selected=e.target.value; idea=null; renderAttribution(); render(); refresh(); }
      if (e.target.name==="type") { const row=panel.querySelector(".paper-limit"); row.hidden=e.target.value!=="Limit"; row.querySelector("input").required=!row.hidden; }
      if (e.target.name==="side") renderAttribution();
      if (e.target.name==="trade") panel.querySelector(".paper-review textarea").value=state?.journal.find(p=>p.id===e.target.value)?.review??"";
      estimate();
    };
    panel.oninput=estimate;
    panel.onsubmit = async e => {
      e.preventDefault();
      const form=e.target, f=new FormData(form);
      try {
        if (form.classList.contains("paper-setup")) {
          await mutate(a=>{ if (a) throw new Error("An account already exists."); return account(String(f.get("name")),Number(f.get("start")),Date.now()); });
          notice="Practice account opened.";
        } else if (form.classList.contains("paper-guard")) {
          await mutate(a=>{
            const riskLimits={};
            for(const k of ["loss","gross"]) if(f.get(k)!==""){
              const v=Number(f.get(k)); if(!Number.isFinite(v)||v<0) throw new Error("Limits must be nonnegative.");
              riskLimits[k]=v;
            }
            a.riskLimits=riskLimits;return a;
          }); notice="Session limits saved.";
        } else if(form.classList.contains("paper-review")) {
          await mutate(a=>{
            const p=a.journal.find(t=>t.id===f.get("trade"));if(!p)throw new Error("Closed trade unavailable.");
            p.review=String(f.get("review")).slice(0,2000);return a;
          }); notice="Review saved.";
        } else {
          await mutate(a=>{
            if (!a) throw new Error("Open a paper account first.");
            const side=f.get("side");
            const signal=f.get("attribution")==="Desk signal" && idea?.symbol===selected && idea.bias===side;
            const q=fresh(selected);
            const sizing=f.get("sizing")==="Stop risk"?ticketSize(a,q):null;
            place(a,{id:crypto.randomUUID(),symbol:selected,side,type:f.get("type"),margin:sizing?.margin??Number(f.get("margin")),
              targetQty:sizing?.qty,budget:Number(f.get("budget")),slippage:Number(f.get("slippage")),
              plan:{thesis:String(f.get("thesis")),setup:String(f.get("setup")),invalidation:Number(f.get("stop"))||null,plannedExit:Number(f.get("plannedExit"))||null},
              leverage:Number(f.get("leverage")),limit:Number(f.get("limit")),origin:signal?"Desk signal":"Own idea",
              signal:signal?{...idea}:null,exchange:q.source},q,Date.now());
            return a;
          }); notice="Paper order recorded.";
        }
        render();
      } catch(err) { showError(err); }
    };
    panel.onclick=async e=>{
      const btn=e.target.closest("button[data-action]");
      if (!btn) return;
      const action=btn.dataset.action,id=btn.dataset.id;
      if (action==="refresh") { await refresh(); return; }
      if(action==="export"){
        const url=URL.createObjectURL(new Blob([research.journalCsv(state.journal)],{type:"text/csv;charset=utf-8"}));
        const link=document.createElement("a");link.href=url;link.download="paper-trade-journal.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);return;
      }
      try {
        await mutate(a=>{
          if (!a) throw new Error("Account unavailable.");
          if (action==="cancel") {
            const o=a.orders.find(o=>o.id===id);
            if (!o) throw new Error("Order already processed.");
            a.cash+=reserve(o); a.orders=a.orders.filter(o=>o.id!==id);
          } else if (action==="close" || action==="reduce") {
            const p=a.positions.find(p=>p.id===id);
            if (!p) throw new Error("Position already closed.");
            const q=fresh(p.symbol,p.exchange); settle(a,q,Date.now());
            if (a.positions.some(p=>p.id===id)) {
              const buy=p.side==="Short";
              const fraction=action==="reduce"?0.5:1;
              const exit=depthPrice(buy?q.asks:q.bids,p.qty*fraction,false,0,buy);
              if (!exit) throw new Error("Insufficient displayed liquidity to close this position. Refresh the book.");
              close(a,id,exit,Date.now(),fraction===1?"Manual close":"50% reduction",fraction);
            }
          }
          return a;
        });
        notice=action==="cancel"?"Order canceled. Reserved funds released.":"Position settled."; render();
      } catch(err) { showError(err); }
    };
  }
  function showError(e) { notice=e.message; panel.querySelector(".paper-notice").textContent=notice; }
  function ticketSize(a,q) {
    const f=panel.querySelector(".paper-ticket").elements;
    const rules=metadata.get(q.source+"/"+q.symbol)?.rules?.[f.type.value];
    if(!rules) throw new Error("Venue quantity rules unavailable.");
    const entry=Number(f.entry.value)||(f.type.value==="Limit"?Number(f.limit.value):
      (f.side.value==="Long"?q.asks:q.bids)[0][0]);
    return research.sizeTrade({...rules,entry,side:f.side.value,stop:Number(f.stop.value),bps:Number(f.slippage.value),
      budget:Number(f.budget.value),cash:a.cash,leverage:Number(f.leverage.value)});
  }
  function estimate() {
    const f=panel.querySelector(".paper-ticket").elements;
    const q=quotes.get(selected),sizing=f.sizing.value==="Stop risk";
    panel.querySelectorAll(".paper-sizing").forEach(el=>el.hidden=!sizing);
    f.margin.disabled=sizing;
    let value=Number(f.margin.value)*Number(f.leverage.value), detail="";
    const equity=state?summary(state,Date.now()).equity:0;
    if(sizing && q && state){
      try {
        const sized=ticketSize(state,q); value=sized.margin*Number(f.leverage.value);
        detail=sized.qty+" units / margin "+money(sized.margin)+" / estimated stop loss "+money(sized.loss)+" ("+(sized.loss/equity*100).toFixed(2)+"% of equity). ";
      } catch(e) {value=0; detail=e.message+" ";}
    }
    if(state){
      const r=research.limits(state,equity,Date.now());
      const left=n=>Number.isFinite(n)?money(Math.max(0,n)):"Unlimited";
      detail+="Loss budget remaining "+left(r.lossLeft)+" / gross capacity "+left(r.exposureLeft)+". ";
    }
    panel.querySelector(".paper-estimate").textContent=detail+(positive(value)?"Notional "+money(value)+" / opening fee "+money(value*FEE):"");
    const info=q&&metadata.get(q.source+"/"+q.symbol);
    const fundingBox=panel.querySelector(".paper-funding");
    const c=info?.calendar,positions=(state?.positions||[]).filter(p=>p.symbol===selected && p.exchange===q?.source);
    if(c && c.next>Date.now() && !issues.has(selected)){
      const impact=research.fundingImpact(c.rate,c.mark,positions);
      fundingBox.textContent=selected+" / "+q.source+" / "+c.interval+"h interval. Next settlement "+new Date(c.next).toLocaleString()+" local ("+new Date(c.next).toISOString().replace("T"," ").slice(0,16)+" UTC). Projected rate "+(100*c.rate).toFixed(4)+"%, estimated position cash impact "+(impact>=0?"+":"")+money(impact)+". Last settled "+(100*c.settled).toFixed(4)+"% at "+new Date(c.previous).toISOString()+". The ledger uses the fixed practice funding model.";
    } else fundingBox.textContent=info?.calendarError?"Funding projection unavailable ("+info.calendarError+").":"Awaiting current funding data.";
    const qty=Number(panel.querySelector('[data-field="stress-size"]').value);
    const side=panel.querySelector('[data-field="stress-side"]').value;
    const stressBox=panel.querySelector(".paper-stress");
    if(q && !issues.has(selected) && Date.now()-q.asOf<=30000 && positive(qty)){
      stressBox.innerHTML='<table><caption>Simulated displayed size cuts / '+escape(selected)+'</caption><thead><tr><th>Cut</th><th>Fill qty</th><th>VWAP</th><th>Slip (bps)</th></tr></thead><tbody>'+
        [.25,.5,.75].map(cut=>{const s=research.stress(q,side,qty,cut);
          return '<tr><td>'+cut*100+'%</td><td>'+Number(s.executable.toPrecision(8))+'</td><td>'+format(s.vwap)+'</td><td>'+s.bps.toFixed(2)+'</td></tr>';
        }).join("")+'</tbody></table>';
    } else stressBox.textContent="Enter a positive scenario quantity and load a fresh book.";
  }
  function renderAttribution() {
    const f=panel.querySelector(".paper-ticket").elements;
    const eligible=idea?.symbol===selected && idea.bias===f.side.value;
    f.attribution.innerHTML="<option>Own idea</option>"+(eligible?"<option>Desk signal</option>":"");
    if (eligible) f.attribution.value="Desk signal";
  }
  function list(title,items,empty,markup) {
    return "<h3>"+title+"</h3>"+(items.length?items.map(markup).join(""):'<p class="paper-empty">'+empty+"</p>");
  }
  function stats(rows) {
    return ["Desk signal","Own idea"].map(origin=>{
      const r=rows.filter(p=>p.origin===origin), wins=r.filter(p=>p.net>0).length;
      return `<div class="paper-row"><strong>${origin}</strong><span>${r.length} closed</span><span>${wins} wins</span><span>Net ${money(r.reduce((s,p)=>s+p.net,0))}</span></div>`;
    }).join("");
  }
  function render() {
    const q=quotes.get(selected), error=issues.get(selected);
    const chart=panel.querySelector(".paper-chart");
    chart.innerHTML=(q?candles(q):"")+(error?'<p>Quote unavailable. '+escape(error)+'</p>':q?"":"<p>Fetching exchange candles...</p>");
    const box=panel.querySelector(".paper-account");
    if (!state && !box.querySelector("form")) box.innerHTML=`<form class="paper-setup"><label>Practice name <input name="name" maxlength="32" placeholder="Trader name" required></label>
      <label>Starting USDT <input type="number" name="start" min="1" max="100000000" step="0.01" value="10000" required></label><button>Open paper account</button></form>`;
    if (state) {
      const s=summary(state,Date.now());
      box.innerHTML=`<div class="paper-balances"><strong>${escape(state.name)}</strong><span>Cash <b>${money(state.cash)}</b></span><span>Equity <b>${money(s.equity)}</b></span><span>Realized <b>${money(s.realizedPnl)}</b></span></div>`;
    }
    panel.querySelector(".paper-ticket button").disabled=!state||!q||Boolean(error)||Date.now()-q.asOf>30000;
    panel.querySelector(".paper-notice").textContent=notice;
    const ledger=panel.querySelector(".paper-ledger");
    const guard=panel.querySelector(".paper-guard"),review=panel.querySelector(".paper-review");
    guard.hidden=!state;review.hidden=!state?.journal.length;
    if(state && guard.dataset.saved!==JSON.stringify(state.riskLimits||{})){
      guard.dataset.saved=JSON.stringify(state.riskLimits||{});
      for(const key of ["loss","gross"]) guard.elements[key].value=state.riskLimits?.[key]??"";
    }
    if(state?.journal.length){
      const select=review.elements.trade,previous=select.value;
      const options=state.journal.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.symbol)+" / "+escape(p.reason)+" / "+new Date(p.closedAt).toISOString()+'</option>').join("");
      if(review.dataset.keys!==options){
        review.dataset.keys=options;select.innerHTML=options;
        if(state.journal.some(t=>t.id===previous)) select.value=previous;
        else review.elements.review.value=state.journal.find(p=>p.id===select.value)?.review??"";
      }
    }
    if (!state) { ledger.innerHTML=""; estimate(); return; }
    const row=(label,body,button="")=>'<div class="paper-row"><strong>'+label+"</strong>"+body+button+"</div>";
    const act=(key,id,text)=>`<button type="button" data-action="${key}" data-id="${escape(id)}">${text}</button>`;
    const title=p=>escape(p.symbol)+" / "+escape(p.side)+" "+p.leverage+"x";
    ledger.innerHTML=list("Open positions",state.positions,"No open positions.",p=>row(title(p),`<span>Entry ${money(p.entry)} / mark ${money(p.mark)} at ${when(p.markTime)}</span><span>Margin ${money(p.margin)} / est. liq. ${money(liquidationPrice(p,Date.now()))}</span><span>Open P&amp;L after funding ${money(positionValue(p,p.mark,Date.now())-p.margin)}</span>`,act("reduce",p.id,"Reduce 50%")+act("close",p.id,"Close")))+
      list("Pending limits",state.orders,"No pending limits.",o=>row(title(o),`<span>Limit ${money(o.limit)} / reserved ${money(reserve(o))}</span>`,act("cancel",o.id,"Cancel")))+
      "<h3>Thesis performance</h3>"+stats(state.journal)+list("Trade journal",state.journal,"Closed trades appear here.",p=>{
        const r=research.multiple(p),plan=p.plan||{};
        return row(title(p),`<span>${escape(p.origin)} / ${escape(p.reason)} / ${new Date(p.closedAt).toISOString().slice(0,16).replace("T"," ")} UTC</span><span class="paper-markers"><b>Entry</b> ${money(p.entry)} &rarr; <b>Exit</b> ${money(p.exit)} / ${Math.round((p.closedAt-p.openedAt)/1000)}s held</span><span>Fees ${money(p.entryFee+p.exitFee)} / funding ${money(p.funding)} / net ${money(p.net)} / ${r===null?"R unavailable":r.toFixed(2)+"R"}</span>
        <span>Setup: ${escape(plan.setup||"Unrecorded")} / Thesis: ${escape(plan.thesis||"Unrecorded")} / Invalidation: ${plan.invalidation?money(plan.invalidation):"Unrecorded"} / Target: ${plan.plannedExit?money(plan.plannedExit):"Unrecorded"}</span><span>Review: ${escape(p.review||"Awaiting review")}</span>`);
      });
    estimate();
  }
  function openDesk() {
    panel=document.getElementById("paper");
    if (!panel) return;
    if (!panel.querySelector(".paper-ticket")) mount();
    try { state=read(); } catch(e) { showError(e); return; }
    const incoming=window.paperIdea;
    if (incoming) {
      window.paperIdea=null;
      if (SYMBOLS.includes(incoming.symbol) && ["Long","Short"].includes(incoming.bias)) {
        idea={symbol:incoming.symbol,bias:incoming.bias,source:String(incoming.source||"Futures desk"),observedAt:incoming.observedAt};
        selected=idea.symbol;
        panel.querySelector(".paper-ticket").elements.side.value=idea.bias;
        renderAttribution();
      }
    }
    panel.querySelector('[data-field="symbol"]').value=selected;
    render(); refresh();
    clearInterval(timer);
    timer=setInterval(()=>{ if(panel.hidden){clearInterval(timer);return;} refresh(); },15000);
  }
  window.addEventListener("storage",event=>{ if(event.key===STORAGE && panel && !panel.hidden) {
    try { state=read(); render(); } catch(e) { showError(e); }
  }});
  document.addEventListener("visibilitychange",()=>{ if(panel && !panel.hidden && !document.hidden) refresh(); });
  window.openPaperDesk=openDesk;
})();
