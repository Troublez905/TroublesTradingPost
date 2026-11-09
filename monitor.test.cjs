const assert = require("node:assert/strict");
const test = require("node:test");
const {crossing,eventsFor} = require("./monitor.js");

const now = 1800000000000;
const rule = {kind:"Mark price",direction:"Above",level:100,lastFire:0,cooldown:60000,expires:now+60000};
const prev = {time:now-15000,value:95};
const cur = {time:now,value:101};
test("crossings require adjacent, fresh, distinct observations",()=>{
  assert.ok(crossing(rule,prev,cur,now));
  assert.equal(crossing(rule,null,cur,now),false);
  assert.equal(crossing(rule,{...prev,time:now},cur,now),false);
  assert.equal(crossing(rule,{...prev,time:now-60000},cur,now),false);
  assert.equal(crossing(rule,prev,cur,now+46000),false);
});
test("negative funding crosses below and bias enters the selected state",()=>{
  assert.ok(crossing({...rule,kind:"Funding %",direction:"Below",level:-0.01},
    {...prev,value:0},{...cur,value:-0.02},now));
  assert.ok(crossing({...rule,kind:"Bias",direction:"Short"},{...prev,value:"Long"},{...cur,value:"Short"},now));
  assert.equal(crossing({...rule,lastFire:now-3000},prev,cur,now),false);
  assert.equal(crossing({...rule,expires:now},prev,cur,now),false);
});
test("postponement crosses a UTC date boundary and retains the original schedule",()=>{
  const event={symbols:["ETHUSDT"],revisions:[{at:"2026-11-09T23:59:00Z"},{at:"2026-11-10T00:01:00Z"}]};
  assert.deepEqual(eventsFor([event],"ETHUSDT","2026-11-09"),[]);
  assert.deepEqual(eventsFor([event],"ETHUSDT","2026-11-10")[0].revisions,event.revisions);
  assert.deepEqual(eventsFor([event],"BTCUSDT","2026-11-10"),[]);
});
