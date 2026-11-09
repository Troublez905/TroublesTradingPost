(() => {
  "use strict";
  const markets = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const verified = "2026-11-09T06:55:00Z";
  // Append a revision with the issuer's new time and verification timestamp.
  const calendar = [
    ...[["October", "11"], ["November", "12"]].map(([month, release]) => ({
      title: month + " US consumer prices", kind: "Macro release", symbols: markets,
      source: "https://www.bls.gov/schedule/2026/" + release + "_sched_list.htm", zone: "America/New_York",
      revisions: [{at: "2026-" + release + "-10T13:30:00Z", verified}]
    })),
    {title: "Federal Open Market Committee meeting", kind: "Macro meeting", symbols: markets, zone: "America/New_York",
      source: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      revisions: [{at: "2026-12-08", through: "2026-12-09", verified}]},
    {title: "Fusaka mainnet activation", kind: "Protocol upgrade", symbols: ["ETHUSDT"], zone: "UTC",
      source: "https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement",
      revisions: [{at: "2025-12-03T21:49:11Z", verified}]},
    {title: "Optimism first anniversary unlock", kind: "Token unlock", symbols: ["OPUSDT"], zone: "Unspecified",
      source: "https://gov.optimism.io/t/op-unlock-update/5995",
      revisions: [{at: "2023-05-31", estimated: true, verified}]}
  ];
  const last = event => event.revisions.at(-1);
  function eventsFor(events, symbol, date) {
    return events.filter(e => {
      const revision=last(e), start=revision.at.slice(0,10);
      return (!symbol || e.symbols.includes(symbol)) && (!date || (date>=start && date<=(revision.through || start)));
    }).sort((a,b) => last(a).at.localeCompare(last(b).at));
  }
  function crossing(rule, prev, cur, now) {
    const maxGap = rule.kind === "Bias" ? 120000 : 45000;
    if (!prev || !cur || now >= rule.expires || now < cur.time || now-cur.time > maxGap ||
        cur.time <= prev.time || cur.time-prev.time > maxGap || now-rule.lastFire < rule.cooldown) return false;
    if (rule.kind === "Bias") return prev.value !== rule.direction && cur.value === rule.direction;
    return rule.direction === "Above" ? prev.value <= rule.level && cur.value > rule.level :
      prev.value >= rule.level && cur.value < rule.level;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = {crossing, eventsFor};
    return;
  }
  const key = "ttp.monitor.v1";
  const baseline = new Map();
  let busy = false, generation = 0, panel;
  const find = id => panel.querySelector("#mon-" + id);
  const stamp = t => new Date(t).toISOString().replace("T"," ").slice(0,19) + " UTC";
  const opts = list => list.map(v => "<option>"+v+"</option>").join("");
  const node = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
  function state() {
    const raw = localStorage.getItem(key);
    if (raw === null) return {rules:[], history:[]};
    const s = JSON.parse(raw);
    if (!Array.isArray(s.rules) || !Array.isArray(s.history)) throw Error("Invalid monitor storage");
    return s;
  }
  function change(fn) {
    if (!navigator.locks) return Promise.reject(Error("Alerts require HTTPS and browser Web Locks support."));
    return navigator.locks.request(key, () => {
      const s = state();
      const result = fn(s);
      localStorage.setItem(key, JSON.stringify(s));
      return result;
    });
  }
  function renderCalendar() {
    const items = eventsFor(calendar,find("filter").value,find("day").value);
    const currentDay = new Date().toISOString().slice(0,10);
    const shown = items.filter(e => find("past").checked || (last(e).through || last(e).at.slice(0,10)) >= currentDay || find("day").value);
    find("events").replaceChildren(...shown.map(e => {
      const block = node("article",""), revision = last(e);
      block.append(node("small",e.kind),node("h4",e.title));
      const moment = revision.at.length === 10 ? revision.at + (revision.through ? " through " + revision.through : "") +
        " (date only" + (e.zone==="Unspecified" ? ", timezone unspecified" : ", "+e.zone) + ")" :
        stamp(revision.at) + " / " + new Date(revision.at).toLocaleString(undefined,{timeZone:e.zone,timeZoneName:"short"});
      block.append(node("p",(revision.estimated ? "Estimated timing" : "Scheduled") + " · " + moment));
      const link = node("a","Issuer schedule ↗");
      link.href=e.source; link.target="_blank"; link.rel="noopener noreferrer";
      block.append(node("p",e.symbols.join(" · ")),link,node("p","Verified " + stamp(revision.verified)));
      for (const past of e.revisions.slice(0,-1)) block.append(node("p","Previous schedule: " + past.at + " · checked " + stamp(past.verified)));
      return block;
    }));
    if (!shown.length) find("events").textContent="No matching scheduled events. Include past dates to see the archive.";
  }
  function label(rule) {
    return [rule.venue,rule.symbol,rule.kind,rule.direction,rule.kind === "Bias" ? "" : rule.level].join(" ").trim();
  }
  function renderRules() {
    const s = state();
    find("rules").replaceChildren(...s.rules.map(rule => {
      const row=node("article","");
      row.append(node("strong",label(rule)),node("p",(Date.now()>=rule.expires?"Expired ":"Expires ") + stamp(rule.expires) +
        " · cooldown " + rule.cooldown/60000 + " min"));
      const remove=node("button","Remove");
      remove.onclick=() => change(data=>{ data.rules=data.rules.filter(r=>r.id!==rule.id); }).then(renderRules).catch(error);
      row.append(remove); return row;
    }));
    if (!s.rules.length) find("rules").textContent="No monitoring rules yet.";
    find("history").replaceChildren(...s.history.map(h=>node("p",h.label + " · " + h.prev.value + " at " +
      stamp(h.prev.time) + " → " + h.cur.value + " at " + stamp(h.cur.time))));
    if (!s.history.length) find("history").textContent="No crossings recorded.";
  }
  async function observe(rule) {
    const bin = rule.venue === "Binance USD-M";
    const bias = rule.kind === "Bias";
    const symbol = encodeURIComponent(rule.symbol);
    const url = bin ? "https://fapi.binance.com/fapi/v1/" +
      (bias ? "klines?limit=62&interval=1m&symbol=" : "premiumIndex?symbol=") + symbol :
      "https://api.bybit.com/v5/market/" + (bias ? "kline?interval=1&limit=62&" : "tickers?") +
      "category=linear&symbol=" + symbol;
    const res = await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000)});
    if (!res.ok) throw Error(rule.venue+" HTTP "+res.status);
    const data=await res.json();
    if (!bin && (data.retCode!==0 || data.result?.category!=="linear")) throw Error("Invalid Bybit data");
    if (bias) {
      if (!bin && data.result.symbol!==rule.symbol) throw Error("Contract mismatch");
      const bars=window.TTPMomentum.parseRows(bin ? data : data.result.list,Date.now());
      return {time:bars.end,value:window.TTPMomentum.evaluate(bars.completed).bias};
    }
    const ticker=bin ? data : data.result.list[0];
    const raw=rule.kind==="Funding %" ? (bin?ticker?.lastFundingRate:ticker?.fundingRate) : ticker?.markPrice;
    const value=Number(raw)*(rule.kind==="Funding %" ? 100 : 1);
    const time=Number(data.time);
    if (ticker?.symbol!==rule.symbol || raw==null || raw==="" || !Number.isFinite(value) ||
        !Number.isSafeInteger(time) || time>Date.now() || Date.now()-time>45000 ||
        (rule.kind==="Mark price" && value<=0)) throw Error("Missing or stale quote");
    return {time,value};
  }
  function error(e) { find("status").textContent=e.message; }
  async function poll() {
    if (busy || !panel || panel.hidden || document.hidden) return;
    busy=true;
    const run=generation;
    try {
      const rules=state().rules.filter(r=>r.expires>Date.now());
      const samples=new Map(), failures=new Set();
      await Promise.all(rules.map(async rule=>{
        const id=[rule.kind,rule.venue,rule.symbol].join("/");
        if (!samples.has(id)) samples.set(id,observe(rule));
        let cur;
        try {cur=await samples.get(id);} catch(e){failures.add(e.message);baseline.delete(rule.id);return;}
        if (generation!==run || panel.hidden || document.hidden) return;
        const prev=baseline.get(rule.id);
        if (prev && cur.time<=prev.time) return;
        baseline.set(rule.id,cur);
        if (!crossing(rule,prev,cur,Date.now())) return;
        const fired=await change(s=>{
          const live=s.rules.find(r=>r.id===rule.id);
          if (!live || live.lastSample>=cur.time || !crossing(live,prev,cur,Date.now())) return false;
          live.lastFire=Date.now();live.lastSample=cur.time;
          s.history.unshift({label:label(live),prev,cur});
          s.history=s.history.slice(0,200);
          return true;
        });
        if (fired && rule.notify && window.Notification?.permission==="granted") {
          new Notification(label(rule),{body:prev.value+" → "+cur.value+" · "+stamp(cur.time)});
        }
      }));
      if (generation!==run) return;
      find("status").textContent=failures.size ? "Feed unavailable: "+[...failures].join("; ") :
        rules.length ? "Checked "+stamp(Date.now()) : "No active alerts.";
      renderRules();
    } catch(e){error(e);} finally {busy=false;}
  }
  function reset() {generation++;baseline.clear();}
  window.openMonitor = () => {
    panel=document.getElementById("monitor");
    if (!panel || find("form")) {poll();return;}
    panel.innerHTML='<h2>Market monitor</h2><h3>Catalyst calendar</h3><div class="mon-controls"><label>Contract<select id="mon-filter"><option value="">All contracts</option>'+opts([...markets,"OPUSDT"])+'</select></label><label>Date (UTC)<input type="date" id="mon-day"></label><label><input type="checkbox" id="mon-past"> Include past dates</label></div><div id="mon-events"></div><h3>Conditional alerts</h3><p>Keep this monitor visible in an open tab. Active rules check public exchange data every 15 seconds. Monitoring resumes from a new baseline after interruptions.</p><form id="mon-form" class="mon-controls"><label>Venue<select name="venue">'+opts(["Binance USD-M","Bybit Linear"])+'</select></label><label>Contract<select name="symbol">'+opts(markets)+'</select></label><label>Observation<select name="kind">'+opts(["Mark price","Funding %","Bias"])+'</select></label><label>Direction<select name="direction"></select></label><label>Threshold<input type="number" name="level" step="any" required></label><label>Expires in (hours)<input type="number" name="duration" min="1" max="720" value="24" required></label><label>Cooldown (minutes)<input type="number" name="cooldown" min="0" max="1440" value="10" required></label><label><input name="notify" type="checkbox"> Desktop notification</label><button>Add alert</button></form><p id="mon-status" role="status"></p><div id="mon-rules"></div><h3>Trigger history</h3><div id="mon-history"></div>';
    for (const control of ["filter","day","past"]) find(control).onchange=renderCalendar;
    const form=find("form"), f=form.elements;
    f.kind.onchange=()=>{
      const bias=f.kind.value==="Bias";
      f.direction.innerHTML=opts(bias?["Long","Short","Neutral"]:["Above","Below"]);
      f.level.disabled=bias;
    };
    f.kind.onchange();
    form.onsubmit=async e=>{
      e.preventDefault();
      try {
        const notify=f.notify.checked;
        if (notify && (!window.Notification || await Notification.requestPermission()!=="granted"))
          throw Error("Desktop notifications unavailable. Uncheck the option to use in-page history.");
        const r={id:crypto.randomUUID(),venue:f.venue.value,symbol:f.symbol.value,kind:f.kind.value,
          direction:f.direction.value,level:Number(f.level.value),expires:Date.now()+Number(f.duration.value)*3600000,
          cooldown:Number(f.cooldown.value)*60000,notify,lastFire:0,lastSample:0};
        if (r.kind==="Mark price" && r.level<=0) throw Error("Enter a positive mark price.");
        await change(s=>{if(s.rules.length>=50) throw Error("Remove an existing rule before adding another.");s.rules.push(r);});
        renderRules();poll();
      } catch(e){error(e);}
    };
    renderCalendar();
    window.addEventListener("offline",reset);
    window.addEventListener("online",()=>{reset();poll();});
    document.addEventListener("visibilitychange",()=>{reset();poll();});
    new MutationObserver(()=>{reset();poll();}).observe(panel,{attributes:true,attributeFilter:["hidden"]});
    window.addEventListener("storage",e=>{if(e.key===key && !panel.hidden){try{renderRules();}catch(err){error(err);}}});
    setInterval(poll,15000);
    poll();
  };
})();
