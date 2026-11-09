(function (root) {
  'use strict';
  const momentum = typeof module === 'object' ? require('./momentum.js') : root.TTPMomentum;
  const FEE = 0.0005, SLIP = 0.0002, MINUTE = 60000;
  const horizons = [5, 15, 60];
  const sides = {Long:1, Short:-1, Neutral:0};
  function barsOf(data) {
    return data.bars.map(row => row && ({open:row[0], high:row[1], low:row[2], close:row[3]}));
  }
  function signal(bars, entry, threshold = 0.1) {
    const lookback = bars.slice(Math.max(0,entry-60),entry);
    return lookback.length === 60 && lookback.every(Boolean) ? momentum.evaluate(lookback,threshold).bias : null;
  }
  function net(entry, exit, side, funding = 0) {
    const a = entry * (1 + side*SLIP), b = exit * (1 - side*SLIP);
    return 100 * (side*(b-a) - FEE*(a+b) - side*funding) / a;
  }
  function outcome(bars, i, hold, direction, data) {
    const window = bars.slice(i,i+hold);
    if (!direction || window.length !== hold || !window.every(Boolean)) return null;
    const side = sides[direction];
    if (!side) return 0;
    let funding = 0;
    // A fill at the settlement instant opens after that settlement. The exit is the last candle's close.
    for (const [timestamp,rate] of data.funding || []) {
      const idx = Math.floor((timestamp-data.start)/MINUTE);
      if (timestamp > data.start+i*MINUTE && timestamp < data.start+(i+hold)*MINUTE)
        funding += rate*bars[idx].open;
    }
    return net(window[0].open,window.at(-1).close,side,funding);
  }
  function record(data) {
    const bars = barsOf(data);
    const first = (Date.parse(data.day+'T00:00:00Z')-data.start)/MINUTE;
    return Array.from({length:1440},(_,minute) => {
      const i = first+minute, bias = signal(bars,i);
      return [bias,...horizons.map(h => {
        const r = outcome(bars,i,h,bias,data);
        return r === null ? null : Number(r.toFixed(6));
      })];
    });
  }
  function stats(values) {
    if (!values.length) return {n:0,median:null,win:null,dd:null};
    const sorted = [...values].sort((a,b)=>a-b);
    const mid = Math.floor(sorted.length/2);
    let running = 0, peak = 0, dd = 0;
    for (const v of values) {
      running += v; peak = Math.max(peak,running); dd = Math.max(dd,peak-running);
    }
    return {n:values.length,median:sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2,
      win:100*values.filter(x=>x>0).length/values.length,dd};
  }
  function strategy(data,bars,from,until,threshold,hold) {
    let total = 0, trades = 0, gaps = 0;
    for (let i=from; i+hold<=until;) {
      const bias = signal(bars,i,threshold);
      if (bias === null) { gaps++; i++; continue; }
      if (bias === 'Neutral') { i++; continue; }
      const r = outcome(bars,i,hold,bias,data);
      if (r === null) gaps++;
      else { total += r; trades++; }
      i += hold;
    }
    return {total,trades,gaps};
  }
  function walk(data,splitHour=12,hold=15) {
    const bars=barsOf(data), from=(Date.parse(data.day+'T00:00:00Z')-data.start)/MINUTE;
    const split=from+splitHour*60, end=from+1440;
    const trained=[0.10,0.20,0.30].map(threshold=>({threshold,...strategy(data,bars,from,split,threshold,hold)}));
    const chosen=trained.reduce((a,b)=>b.total>a.total ? b : a);
    return {trained,chosen,test:strategy(data,bars,split,end,chosen.threshold,hold),
      benchmark:outcome(bars,split,end-split,'Long',data)};
  }
  // Pending orders execute on the next bar. Adverse gaps fill at the open and intrabar ties hit the stop.
  function advance(state, bar, final = false) {
    const s = {...state, position:state.position && {...state.position}, fills:[...state.fills]};
    const close = (price,reason) => {
      const pnl = net(s.position.entry,price,s.position.side);
      s.fills.push({index:s.index+1,reason,pnl,price,entry:s.position.entry,side:s.position.side});
      s.position = null;
    };
    if (s.position && s.pending?.close) close(bar.open,'Manual close');
    if (!s.position && s.pending?.side) {
      const {side,stop,target} = s.pending;
      s.position={entry:bar.open,side,stop:bar.open*(1-side*stop/100),target:bar.open*(1+side*target/100)};
    }
    const p=s.position;
    if(p) {
      const long=p.side===1;
      if (long ? bar.open<=p.stop : bar.open>=p.stop) close(bar.open,'Gap through stop');
      else if (long ? bar.open>=p.target : bar.open<=p.target) close(p.target,'Target');
      else if (long ? bar.low<=p.stop : bar.high>=p.stop) close(p.stop,'Stop');
      else if (long ? bar.high>=p.target : bar.low<=p.target) close(p.target,'Target');
      else if (final) close(bar.close,'End of hour');
    }
    s.pending=null; s.index++;
    return s;
  }
  const api={version:momentum.version,MINUTE,horizons,barsOf,signal,record,outcome,stats,walk,advance};
  if (typeof module==='object') module.exports=api; else root.TTPLabEngine=api;
})(globalThis);
