const {test} = require("node:test");
const assert = require("node:assert/strict");
const tools = require("./paper-tools.js");
const {account,place,settle,close,reserve,summary,funding,depthPrice,liquidationPrice} = require("./paper.js");
const now = 1000;
const order = {id:"p1",side:"Long",symbol:"BTCUSDT",margin:100,leverage:2,type:"Market",exchange:"Binance USD-M",origin:"Own idea"};
const book = {symbol:"BTCUSDT",source:"Binance USD-M",price:100,asOf:now,asks:[[101,1],[102,10]],bids:[[99,10],[98,5]]};
const approx = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-8,`${actual} vs ${expected}`);

test("custom starting cash and volume-weighted market fill with capped isolated losses",()=>{
  const a=account("Guest",4321.55,now);
  place(a,order,book,now);
  const [p]=a.positions;
  approx(p.entry,200/(1+99/102));
  approx(a.cash,4321.55-100.1);
  approx(summary(a,now).equity,4321.45);
  assert.ok(liquidationPrice(p,now)>50);
  settle(a,{...book,price:1},now);
  assert.equal(a.positions.length,0);
  assert.equal(a.journal[0].reason,"Liquidated");
  approx(a.journal[0].net,-100.1);
});
test("limit reservation, venue pin, full-size fill and net cash after costs",()=>{
  const a=account("Tester",1000,now), o={...order,type:"Limit",limit:98};
  place(a,o,book,now);
  assert.equal(a.orders.length,1);
  approx(a.cash+reserve(o),1000);
  const cheaper={...book,price:97,asks:[[97,20]],bids:[[96,20]]};
  settle(a,{...cheaper,source:"Bybit Linear"},now);
  assert.equal(a.positions.length,0);
  settle(a,cheaper,now);
  assert.equal(a.orders.length,0);
  const p=a.positions[0];
  assert.equal(p.entry,97);
  const afterFunding=28800001;
  approx(funding(p,afterFunding),0.02);
  close(a,p.id,100,afterFunding,"Manual close");
  approx(a.journal[0].net,(100-97)*p.qty-p.entryFee-0.02-100*p.qty*0.0005);
  approx(summary(a,afterFunding).equity,1000+a.journal[0].net);
});
test("short entry sells bids, short funding credit, stale/depth/margin rejection is atomic",()=>{
  const a=account("Tester",1000,now), o={...order,side:"Short"};
  place(a,o,book,now);
  approx(a.positions[0].entry,99);
  assert.ok(funding(a.positions[0],28800001)<0);
  assert.ok(liquidationPrice(a.positions[0],now)>99);
  const before=JSON.stringify(a);
  assert.throws(()=>place(a,o,book,now+31000),/fresh/);
  assert.throws(()=>place(a,{...o,margin:1000},book,now),/cash/);
  assert.throws(()=>place(a,o,{...book,bids:[[100,0.5]]},now),/depth/);
  assert.equal(JSON.stringify(a),before);
  approx(depthPrice([[101,1],[103,2]],2,false,0,true),102);
});
test("short stop size rounds down and respects fees, slippage, cash and contract minimum",()=>{
  const inputs={side:"Short",entry:100,stop:105,bps:10,budget:10,step:0.1,min:0.1,leverage:2,cash:1000};
  const size=tools.sizeTrade(inputs);
  approx(size.qty,1.9);assert.ok(size.loss<=10);assert.ok(size.loss>9.8);
  assert.throws(()=>tools.sizeTrade({...inputs,stop:100}),/stop/);
  assert.throws(()=>tools.sizeTrade({...inputs,budget:0.01}),/minimum/);
  assert.ok(tools.sizeTrade({...inputs,cash:40}).margin<40);
});
test("negative funding, variable venue intervals and signed long/short impacts",async()=>{
  approx(tools.fundingImpact(-0.001,100,[{side:"Long",qty:3},{side:"Short",qty:1}]),0.2);
  const original=global.fetch;
  global.fetch=async input=>{
    const u=new URL(input), interval=u.searchParams.get("symbol")==="SOLUSDT"?4:2;
    const row=u.pathname.endsWith("tickers")?{fundingRate:"-0.001",nextFundingTime:Date.now()+3600000,markPrice:100,fundingIntervalHour:interval}:
      u.pathname.endsWith("history")?{fundingRate:"0.0002",fundingRateTimestamp:Date.now()-300000}:
      {fundingInterval:interval*60,lotSizeFilter:{qtyStep:".1",minOrderQty:".1",maxMktOrderQty:"1000",maxOrderQty:"1000"}};
    return {ok:true,json:async()=>({retCode:0,result:{list:[row]}})};
  };
  try {
    const a=await tools.calendar("SOLUSDT","Bybit Linear"),b=await tools.calendar("ETHUSDT","Bybit Linear");
    assert.equal(a.interval,4);assert.equal(b.interval,2);assert.equal(a.rate,-.001);assert.equal(a.settled,.0002);
  } finally {global.fetch=original;}
});
test("depth stress caps both sides at reduced liquidity and retains the input book",()=>{
  const book={asks:[[101,1],[103,1]],bids:[[99,1],[97,1]]}, original=JSON.stringify(book);
  for(const side of ["Long","Short"]){
    const s=tools.stress(book,side,5,.75);approx(s.executable,.5);approx(s.vwap,side==="Long"?102:98);approx(s.bps,200);
  }
  assert.equal(JSON.stringify(book),original);
});
test("UTC rollover resets prior realized losses and carries open losses; closing remains possible",()=>{
  const midnight=Date.UTC(2026,10,10), a=account("Tester",1000,midnight-100000);
  a.cash-=30;a.journal.push({net:-30,closedAt:midnight-5000});
  a.riskLimits={loss:40,gross:1000};
  const quote={...book,asOf:midnight-2000};place(a,order,quote,midnight-2000);
  const p=a.positions[0];p.mark=p.entry-10;
  const before=tools.limits(a,summary(a,midnight-1).equity,midnight-1);
  const after=tools.limits(a,summary(a,midnight).equity,midnight);
  assert.ok(before.lossLeft<0);assert.ok(after.loss>0 && after.lossLeft>0);
  assert.throws(()=>place(a,{...order,id:"b"},quote,midnight-1),/Session loss/);
  close(a,p.id,p.mark,midnight,"Reduce",.5);assert.equal(a.positions.length,1);
  close(a,p.id,p.mark,midnight,"Close");assert.equal(a.positions.length,0);
});
test("scratch trade exports zero R, missing historic risk stays blank, formulas are quoted safely",()=>{
  const scratch={net:0,initialRisk:10,plan:{setup:'  =HYPERLINK("test")'},review:"+1"},historic={net:1};
  assert.equal(tools.multiple(scratch),0);assert.equal(tools.multiple(historic),null);
  const csv=tools.journalCsv([scratch,historic]);assert.match(csv,/'  =HYPERLINK/);assert.match(csv,/'\+1/);
});
test("adverse executable price rejects a sized short atomically; loss guard holds reserved limits",()=>{
  const a=account("Tester",1000,now), before=a.cash;
  const sized={...order,side:"Short",margin:100,leverage:1,targetQty:1,budget:5,slippage:0,plan:{invalidation:104}};
  assert.throws(()=>place(a,sized,{...book,bids:[[95,10]]},now),/risk/);
  assert.equal(a.cash,before);assert.equal(a.positions.length,0);
  place(a,{...order,type:"Limit",limit:95},book,now);
  a.riskLimits={loss:0};
  settle(a,{...book,asks:[[94,100]]},now);
  assert.equal(a.orders.length,1);assert.equal(a.positions.length,0);
});
