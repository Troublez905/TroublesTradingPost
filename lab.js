(() => {
  'use strict';
  const E=window.TTPLabEngine, local='assets/lab/', archiveKey='ttp.blind-replay.v1';
  const remote='https://raw.githubusercontent.com/'+(location.hostname.endsWith('.github.io') ?
    location.hostname.split('.')[0]+'/'+location.pathname.split('/')[1] : 'Troublez905/TroublesTradingPost')+'/lab-data/assets/lab/';
  const usd=n=>n.toLocaleString(undefined,{maximumFractionDigits:4});
  const pct=n=>n===null?'Unavailable':n.toFixed(3)+'%';
  const clock=t=>new Date(t).toISOString().slice(11,16);
  let panel, data, manifest, base, bars, state, timer, generation=0, mode='Replay', savedMessage='';
  const q=s=>panel.querySelector(s);
  const text=(el,s)=>{el.textContent=s;};
  const optionList=(select,list)=>select.replaceChildren(...list.map(v=>new Option(v,v)));
  const get=async(url)=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw Error('HTTP '+response.status);
    return response;
  };
  function mount() {
    panel=document.getElementById('lab');
    panel.innerHTML=`<small>HISTORICAL RESEARCH</small><h2>Strategy lab</h2>
      <div class="lab-tabs"></div><div class="lab-select">
      <label>UTC session <select class="lab-day"></select></label><label>Venue <select class="lab-venue"></select></label>
      <label>Contract <select class="lab-symbol"></select></label></div>
      <p class="lab-status" role="status">Loading market archive...</p><div class="lab-view"></div>
      <details><summary>Market data sources</summary><ul class="lab-sources"></ul></details>`;
    for (const name of ['Replay','Scorecard','Walk-forward']) {
      const button=document.createElement('button'); text(button,name);
      button.onclick=()=>{ mode=name; pause(); show(); };
      q('.lab-tabs').append(button);
    }
    q('.lab-day').onchange=()=>{selectors();load();};
    q('.lab-venue').onchange=()=>{symbols();load();};
    q('.lab-symbol').onchange=load;
  }
  function selectors() {
    const list=manifest.days[q('.lab-day').value];
    optionList(q('.lab-venue'),[...new Set(list.map(p=>p.venue))]); symbols();
  }
  function symbols() {
    optionList(q('.lab-symbol'),manifest.days[q('.lab-day').value].filter(p=>p.venue===q('.lab-venue').value).map(p=>p.symbol));
  }
  async function boot() {
    const bundled=await (await get(local+'index.json')).json();
    base=local; manifest=bundled;
    try {
      const latest=await (await get(remote+'index.json')).json();
      if (latest.schema===1 && Object.keys(latest.days).length && Object.keys(latest.days).sort().at(-1)>Object.keys(bundled.days).sort().at(-1)) {
        base=remote; manifest=latest;
      }
    } catch { /* The bundled, dated archive remains available offline from the remote branch. */ }
    optionList(q('.lab-day'),Object.keys(manifest.days).sort().reverse());
    selectors(); await load();
  }
  async function load() {
    const seq=++generation;
    pause(); data=null; q('.lab-view').replaceChildren(); text(q('.lab-status'),'Loading historical minute bars...');
    const day=q('.lab-day').value;
    const p=manifest.days[day].find(x=>x.venue===q('.lab-venue').value && x.symbol===q('.lab-symbol').value);
    try {
      const bytes=await (await get(base+p.file)).arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if (hash!==p.sha256) throw Error('Dataset integrity check failed');
      const content=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
      if (seq!==generation) return;
      if (content.rule!==E.version || content.schema!==1 || content.signals.length!==1440) throw Error('Incompatible archive');
      data=content; bars=E.barsOf(data); resetReplay(0);
      const provenance=q('.lab-sources');provenance.replaceChildren();
      for(const raw of data.sources){
        const url=new URL(raw),li=document.createElement('li'),a=document.createElement('a');
        a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';text(a,url.hostname+' / '+(url.searchParams.get('start')||url.searchParams.get('startTime')||url.pathname.split('/').at(-1)));
        li.append(a);provenance.append(li);
      }
      text(q('.lab-status'),day+' UTC / '+p.venue+' / '+p.symbol+' / '+content.rule+' / dataset '+hash.slice(0,10));
      show();
    } catch(err) {
      if (seq!==generation) return;
      errorView(err);
    }
  }
  function errorView(err) {
    text(q('.lab-status'),'Cannot open the market archive: '+err.message+'.');
    const retry=document.createElement('button'); text(retry,'Retry archive'); retry.onclick=()=>boot().catch(errorView);
    q('.lab-view').replaceChildren(retry);
  }
  function pause() {clearInterval(timer);timer=null;}
  function show() {
    for (const b of q('.lab-tabs').children) b.setAttribute('aria-pressed',String(b.textContent===mode));
    if (!data) return;
    if (mode==='Replay') replayView();
    else if (mode==='Scorecard') scoreView();
    else walkView();
  }
  function resetReplay(hour) {
    pause(); state={hour,index:0,position:null,pending:null,fills:[],saved:false}; savedMessage='';
  }
  function replayView() {
    const view=q('.lab-view');
    view.innerHTML=`<h3>Blind candle replay</h3><p>Queue a simulated order at the next candle's open. Stops win an intrabar tie. Gap stops fill at the open. Replay charges 5 bps in fees and 2 bps in slippage per side and excludes funding.</p>
      <div class="lab-select"><label>Start hour (UTC)<select class="lab-hour"></select></label>
      <label>Playback speed<select class="lab-speed"><option value="1000">1 candle / second</option><option value="250">4 candles / second</option></select></label>
      <button class="lab-step">Next candle</button><button class="lab-play">Play</button><button class="lab-reset">Restart hour</button></div>
      <canvas class="lab-chart" width="780" height="200" role="img" aria-label="Revealed one-minute candles"></canvas><p class="lab-now" role="status"></p>
      <form class="lab-order"><label>Stop distance (%)<input name="stop" type="number" min=".01" max="99" step="any" value=".5" required></label>
      <label>Target distance (%)<input name="target" type="number" min=".01" max="99" step="any" value="1" required></label>
      <button value="1">Queue long</button><button value="-1">Queue short</button><button type="button" class="lab-close">Queue close</button></form>
      <p class="lab-trade"></p><p class="lab-fills"></p><details><summary>Completed replays on this device</summary><ul class="lab-history"></ul></details>`;
    optionList(q('.lab-hour'),Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+':00'));
    q('.lab-hour').selectedIndex=state.hour;
    q('.lab-hour').onchange=()=>{ resetReplay(q('.lab-hour').selectedIndex); paint(); };
    q('.lab-step').onclick=step;
    q('.lab-play').onclick=()=>{ if(timer) pause(); else play(); paint(); };
    q('.lab-speed').onchange=()=>{if(timer)play();};
    q('.lab-reset').onclick=()=>{resetReplay(state.hour);paint();};
    q('.lab-close').onclick=()=>{state.pending={close:true};paint();};
    q('.lab-order').onsubmit=e=>{
      e.preventDefault();
      if(state.pending||state.position||state.index>=59)return;
      const f=e.currentTarget.elements;
      state.pending={side:Number(e.submitter.value),stop:f.stop.valueAsNumber,target:f.target.valueAsNumber}; paint();
    };
    paint(); historyView();
  }
  function play(){pause();timer=setInterval(()=>{if(location.hash!=='#lab'||document.hidden){pause();paint();}else step();},Number(q('.lab-speed').value));}
  function offset(){return (Date.parse(data.day+'T00:00:00Z')-data.start)/E.MINUTE+state.hour*60;}
  function step(){
    if(state.index>=59 || !bars[offset()+state.index+1]){pause();paint();return;}
    state=E.advance(state,bars[offset()+state.index+1],state.index===58);
    if(state.index===59){
      pause();
      try {
        const previous=JSON.parse(localStorage.getItem(archiveKey)||'[]');
        previous.unshift({day:data.day,hour:state.hour,symbol:data.symbol,venue:data.venue,rule:data.rule,fills:state.fills});
        localStorage.setItem(archiveKey,JSON.stringify(previous.slice(0,100))); savedMessage='Session saved.';
      } catch {savedMessage='Session complete. Device storage unavailable.';}
      historyView();
    }
    paint();
  }
  function historyView(){
    let list;
    try {list=JSON.parse(localStorage.getItem(archiveKey)||'[]');} catch {list=[];}
    const out=q('.lab-history'); out.replaceChildren();
    if(!Array.isArray(list)||!list.length){text(out,'No completed sessions saved.');return;}
    for(const item of list.slice(0,12)){
      const li=document.createElement('li');text(li,item.day+' '+String(item.hour).padStart(2,'0')+':00 UTC / '+item.venue+' '+item.symbol+' / '+item.fills.length+' closes / '+pct(item.fills.reduce((sum,f)=>sum+f.pnl,0)));out.append(li);
    }
  }
  function paint(){
    if(mode!=='Replay'||!q('.lab-chart'))return;
    const o=offset(), shown=bars.slice(o,o+state.index+1), here=shown.at(-1);
    const ok=shown.every(Boolean), ended=state.index>=59, missing=!ok||(!ended&&!bars[o+state.index+1]);
    q('.lab-step').disabled=q('.lab-play').disabled=ended||missing;text(q('.lab-play'),timer?'Pause':'Play');
    const f=q('.lab-order');for(const el of f.elements) el.disabled=ended||missing||Boolean(state.pending)||Boolean(state.position);
    q('.lab-close').disabled=!state.position||!!state.pending||ended||missing;
    text(q('.lab-now'),clock(data.start+(o+state.index)*E.MINUTE)+' UTC / '+shown.length+' of 60 candles'+(here?' / Close '+usd(here.close):'')+(missing?' / Session interrupted by missing candle.':'')+' '+savedMessage);
    text(q('.lab-trade'),state.pending?'Order queued for next open.':state.position?(state.position.side===1?'Long':'Short')+' from '+usd(state.position.entry)+' / Stop '+usd(state.position.stop)+' / Target '+usd(state.position.target):'No open replay position.');
    text(q('.lab-fills'),state.fills.map(f=>'Minute '+(f.index+1)+' '+f.reason+' at '+usd(f.price)+' ('+pct(f.pnl)+')').join(' / '));
    const canvas=q('.lab-chart'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,780,200); if(!ok)return;
    const low=Math.min(...shown.map(b=>b.low)),high=Math.max(...shown.map(b=>b.high)),y=p=>188-176*(p-low)/(high-low||1);
    shown.forEach((b,i)=>{const x=8+i*12.7;ctx.strokeStyle=ctx.fillStyle=b.close>=b.open?'#a3c9ad':'#f4ac78';
      ctx.beginPath();ctx.moveTo(x,y(b.high));ctx.lineTo(x,y(b.low));ctx.stroke();ctx.fillRect(x-3.5,Math.min(y(b.open),y(b.close)),7,Math.max(1,Math.abs(y(b.open)-y(b.close))));});
  }
  function table(headers,rows) {
    const t=document.createElement('table');const h=t.createTHead().insertRow();
    headers.forEach(s=>{const cell=document.createElement('th');cell.scope='col';text(cell,s);h.append(cell);});
    const b=t.createTBody();rows.forEach(row=>{const r=b.insertRow();row.forEach(s=>text(r.insertCell(),s));});return t;
  }
  function costs(){
    return '5 bps fee and 2 bps adverse slippage per side. '+(data.funding===null?'Historical funding unavailable; returns exclude funding.':'Settled funding included using the opening price of the settlement minute as a mark approximation.');
  }
  function scoreView(){
    const v=q('.lab-view');v.innerHTML=`<h3>Signal scorecard</h3><label>Forward horizon <select class="lab-horizon"><option>5</option><option>15</option><option>60</option></select> min</label><div class="lab-table"></div><p class="lab-explain"></p><button class="lab-export">Export all observations (CSV)</button>`;
    const render=()=>{
      const col=E.horizons.indexOf(Number(q('.lab-horizon').value))+1;
      const rows=['Long','Short','Neutral'].map(side=>{
        const group=data.signals.filter(r=>r[0]===side), s=E.stats(group.map(r=>r[col]).filter(x=>x!==null));
        return [side,s.n,group.length-s.n,pct(s.median),side==='Neutral'?'Flat':pct(s.win),s.dd===null?'Unavailable':s.dd.toFixed(3)+' pp'];
      });
      q('.lab-table').replaceChildren(table(['Direction','Evaluated','Incomplete','Median net','Win rate','Drawdown'],rows));
      text(q('.lab-explain'),'The archive reconstructs every minute reading after the UTC day closes, including untraded signals. '+data.signals.filter(r=>!r[0]).length+' readings have incomplete lookbacks. Entry uses the first subsequent open; exit uses the final close in the horizon. Drawdown measures the peak-to-trough decline in cumulative percentage points at fixed notional. Overlapping signals are scored independently. '+costs());
    };
    q('.lab-horizon').onchange=render;render();
    q('.lab-export').onclick=()=>{
      const lines=['venue,symbol,rule,signal_time_utc,last_completed_candle_open_utc,direction,return_5m_pct,return_15m_pct,return_60m_pct'];
      const midnight=Date.parse(data.day+'T00:00:00Z');
      data.signals.forEach((r,i)=>lines.push([data.venue,data.symbol,data.rule,new Date(midnight+i*E.MINUTE).toISOString(),
        new Date(midnight+(i-1)*E.MINUTE).toISOString(),r[0]||'Incomplete',...r.slice(1).map(x=>x===null?'Incomplete':x)].join(',')));
      const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));
      const a=document.createElement('a');a.href=url;a.download=data.day+'-'+data.symbol+'-signals.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  function walkView(){
    const v=q('.lab-view');v.innerHTML=`<h3>Walk-forward evaluator</h3><div class="lab-select">
      <label>Training window (UTC)<select class="lab-split"><option value="12">00:00 to 12:00</option><option value="8">00:00 to 08:00</option><option value="16">00:00 to 16:00</option></select></label>
      <label>Hold horizon (minutes)<select class="lab-hold"><option>15</option><option>5</option><option>60</option></select></label></div>
      <div class="lab-table"></div><p class="lab-walk-result"></p><p class="lab-method"></p>`;
    const render=()=>{
      const hour=Number(q('.lab-split').value),hold=Number(q('.lab-hold').value),w=E.walk(data,hour,hold);
      q('.lab-table').replaceChildren(table(['Training threshold','Trades','Net return, fixed size','Incomplete setups'],w.trained.map(t=>[t.threshold.toFixed(2)+'%',t.trades,pct(t.total),t.gaps])));
      text(q('.lab-walk-result'),'Frozen threshold '+w.chosen.threshold.toFixed(2)+'% / test '+String(hour).padStart(2,'0')+':00 to 24:00 UTC / '+w.test.trades+' trades / '+pct(w.test.total)+' net / '+w.test.gaps+' incomplete setups. Long buy-and-hold benchmark '+pct(w.benchmark)+'.');
      text(q('.lab-method'),'Training selects the highest total fixed-notional return; ties use the lowest threshold. The test starts flat, enters after signal formation, holds one position at a time and rejects trades crossing a window boundary. Pre-session candles warm the rule. Changing a window after inspecting the test makes that comparison exploratory. Model wf-v1. '+costs());
    };
    q('.lab-split').onchange=q('.lab-hold').onchange=render;render();
  }
  window.addEventListener('hashchange',()=>{if(location.hash!=='#lab')pause();});
  window.openLab=()=>{
    if (!panel){mount();boot().catch(errorView);}
    else if (data) show();
  };
})();
