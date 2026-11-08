/* Local USDT perpetual simulator. All balances and fills are virtual. */
(() => {
  "use strict";
  const STORAGE = "ttp.paper.account.v1";
  const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const FEE = 0.0005;
  const MAINTENANCE = 0.005;
  const FUNDING = 0.0001;
  const EIGHT_HOURS = 28800000;
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
    const notional = o.margin * o.leverage;
    const position = {...o,qty:notional / price,entry:price,openedAt:now,entryFee:notional * FEE,mark:price,markTime:now};
    a.positions.push(position);
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
    return depthPrice(buy?quote.asks:quote.bids,order.margin*order.leverage,true,order.type==="Limit" && order.limit,buy);
  }
  function place(a, order, quote, now) {
    if (!["Long","Short"].includes(order.side) || !SYMBOLS.includes(order.symbol) ||
        !positive(order.margin) || !Number.isInteger(order.leverage) || order.leverage < 1 || order.leverage > 20 ||
        !["Market","Limit"].includes(order.type) || (order.type === "Limit" && !positive(order.limit)))
      throw new Error("Choose a valid contract, margin, leverage (1-20), and order price.");
    if (!quote || !positive(quote.price) || quote.symbol !== order.symbol || now - quote.asOf > 30000 || now < quote.asOf)
      throw new Error("Wait for a fresh exchange quote before placing an order.");
    if (reserve(order) > a.cash) throw new Error("Available cash must cover isolated margin and the opening fee.");
    const o = {...order,placedAt:now};
    const executable=entryPrice(o,quote);
    if (!executable && o.type==="Market") throw new Error("Insufficient displayed depth for this order. Reduce size.");
    a.cash -= reserve(order);
    if (executable) fill(a, o, executable, now);
    else a.orders.push(o);
  }
  function close(a, id, price, now, reason) {
    const p = a.positions.find(item => item.id === id);
    if (!p || !positive(price)) throw new Error("Position or closing quote unavailable.");
    const fee = price * p.qty * FEE;
    const released = Math.max(0,positionValue(p,price,now) - fee);
    a.cash += released;
    a.journal.unshift({...p,exit:price,closedAt:now,exitFee:fee,funding:funding(p,now),net:released - p.margin - p.entryFee,reason});
    a.positions = a.positions.filter(item => item.id !== id);
  }
  function settle(a, quote, now) {
    for (const o of a.orders.filter(item => item.symbol === quote.symbol && item.exchange === quote.source)) {
      const executable=entryPrice(o,quote);
      if (!executable) continue;
      fill(a,o,executable,now);
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
    } catch(e) { showError(e); }
  }
  function candles(q) {
    const low = Math.min(...q.bars.map(b=>b[3])), high = Math.max(...q.bars.map(b=>b[2]));
    const y = value => high===low ? 72 : 138-132*(value-low)/(high-low);
    const marks = q.bars.map(([,o,h,l,c],i)=>{
      const x=8+i*9.8, color=c>=o?"#4be0e2":"#ff7187";
      return `<path stroke="${color}" d="M${x} ${y(h)}V${y(l)}"/><rect fill="${color}" x="${x-3}" y="${Math.min(y(o),y(c))}" width="6" height="${Math.max(1,Math.abs(y(o)-y(c)))}"/>`;
    }).join("");
    return `<div class="paper-chart-head"><strong>${money(q.price)}</strong><span>${q.source} &middot; ${when(q.asOf)}</span></div>
      <svg viewBox="0 0 600 146" role="img" aria-label="60 one-minute candles for ${q.symbol}, range ${format(low)} to ${format(high)} USDT"><path d="M0 6H600 M0 72H600 M0 138H600" stroke="currentColor" opacity=".15"/>${marks}</svg>
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
      <button type="button" data-action="refresh">Refresh prices</button></div><div class="paper-chart"></div></article>
      <form class="paper-card paper-ticket"><h3>Order ticket</h3><label>Direction <select name="side"><option>Long</option><option>Short</option></select></label>
      <label>Order type <select name="type"><option>Market</option><option>Limit</option></select></label>
      <label class="paper-limit" hidden>Limit price (USDT) <input type="number" step="any" min="0.000001" name="limit"></label>
      <label>Isolated margin (USDT) <input name="margin" type="number" step="0.01" min="0.01" value="100" required></label>
      <label>Leverage <select name="leverage">${[1,2,3,5,10,20].map(n=>'<option value="'+n+'">'+n+'x</option>').join("")}</select></label>
      <label>Trade thesis <select name="attribution"><option>Own idea</option></select></label><div class="paper-estimate"></div><button type="submit">Place paper order</button></form></div>
      <p class="paper-notice" role="status"></p><div class="paper-ledger"></div>
      <details><summary>Execution model</summary><p>Exchange candles and displayed order-book depth refresh about every 15 seconds while this desk is visible. Buys consume asks and sells consume bids in a simulated full-size fill at the volume-weighted price. Limits fill only when the sampled book covers the full order within its price. Each order uses an independent book snapshot. Queue position, partial fills and market impact are omitted. Orders and positions stay on their entry venue.</p>
      <p>Pending orders reserve margin plus a 0.05% opening fee. Closing costs 0.05%. Liquidation uses the sampled last price, 0.5% maintenance margin and the estimated closing fee. Losses are capped at isolated margin plus the opening fee. Fixed simulated funding of 0.01% of entry notional transfers from longs to shorts every eight hours at 00:00, 08:00 and 16:00 UTC. Orders and liquidation checks resume at the next observed quote after an interruption.</p></details>
      <p><a href="#leaderboard">Open the competition leaderboard &#8599;</a></p>`;
    panel.onchange = e => {
      if (e.target.dataset.field === "symbol") { selected=e.target.value; idea=null; renderAttribution(); render(); refresh(); }
      if (e.target.name==="type") { const row=panel.querySelector(".paper-limit"); row.hidden=e.target.value!=="Limit"; row.querySelector("input").required=!row.hidden; }
      if (e.target.name==="side") renderAttribution();
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
        } else {
          await mutate(a=>{
            if (!a) throw new Error("Open a paper account first.");
            const side=f.get("side");
            const signal=f.get("attribution")==="Desk signal" && idea?.symbol===selected && idea.bias===side;
            const q=fresh(selected);
            place(a,{id:crypto.randomUUID(),symbol:selected,side,type:f.get("type"),margin:Number(f.get("margin")),
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
      try {
        await mutate(a=>{
          if (!a) throw new Error("Account unavailable.");
          if (action==="cancel") {
            const o=a.orders.find(o=>o.id===id);
            if (!o) throw new Error("Order already processed.");
            a.cash+=reserve(o); a.orders=a.orders.filter(o=>o.id!==id);
          } else if (action==="close") {
            const p=a.positions.find(p=>p.id===id);
            if (!p) throw new Error("Position already closed.");
            const q=fresh(p.symbol,p.exchange); settle(a,q,Date.now());
            if (a.positions.some(p=>p.id===id)) {
              const buy=p.side==="Short";
              const exit=depthPrice(buy?q.asks:q.bids,p.qty,false,0,buy);
              if (!exit) throw new Error("Insufficient displayed liquidity to close this position. Refresh the book.");
              close(a,id,exit,Date.now(),"Manual close");
            }
          }
          return a;
        });
        notice=action==="cancel"?"Order canceled. Reserved funds released.":"Position settled."; render();
      } catch(err) { showError(err); }
    };
  }
  function showError(e) { notice=e.message; panel.querySelector(".paper-notice").textContent=notice; }
  function estimate() {
    const f=panel.querySelector(".paper-ticket").elements;
    const value=Number(f.margin.value)*Number(f.leverage.value);
    panel.querySelector(".paper-estimate").textContent=positive(value)?"Notional "+money(value)+" / opening fee "+money(value*FEE):"Enter a margin amount.";
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
    if (!state) { ledger.innerHTML=""; estimate(); return; }
    const row=(label,body,button="")=>'<div class="paper-row"><strong>'+label+"</strong>"+body+button+"</div>";
    const act=(key,id,text)=>`<button type="button" data-action="${key}" data-id="${escape(id)}">${text}</button>`;
    const title=p=>escape(p.symbol)+" / "+escape(p.side)+" "+p.leverage+"x";
    ledger.innerHTML=list("Open positions",state.positions,"No open positions.",p=>row(title(p),`<span>Entry ${money(p.entry)} / mark ${money(p.mark)} at ${when(p.markTime)}</span><span>Margin ${money(p.margin)} / est. liq. ${money(liquidationPrice(p,Date.now()))}</span><span>Open P&amp;L after funding ${money(positionValue(p,p.mark,Date.now())-p.margin)}</span>`,act("close",p.id,"Close")))+
      list("Pending limits",state.orders,"No pending limits.",o=>row(title(o),`<span>Limit ${money(o.limit)} / reserved ${money(reserve(o))}</span>`,act("cancel",o.id,"Cancel")))+
      "<h3>Thesis performance</h3>"+stats(state.journal)+list("Trade journal",state.journal,"Closed trades appear here.",p=>row(title(p),`<span>${escape(p.origin)} / ${escape(p.reason)} / ${new Date(p.closedAt).toISOString().slice(0,16).replace("T"," ")} UTC</span><span>${money(p.entry)} &rarr; ${money(p.exit)}</span><span>Fees ${money(p.entryFee+p.exitFee)} / funding ${money(p.funding)} / net ${money(p.net)}</span>`));
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
