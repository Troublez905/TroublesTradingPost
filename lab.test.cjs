'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const E=require('./lab-engine.js'), M=require('./momentum.js');
const day='2026-11-07',start=Date.parse(day+'T00:00:00Z')-60*E.MINUTE;
const make=(price=i=>100+i*.1)=>({day,start,funding:[],bars:Array.from({length:1560},(_,i)=>{const p=price(i);return [p,p,p,p];})});

test('Every minute reconstructed exactly once, including neutral, without trading input',()=>{
  const d=make(), out=E.record(d); assert.equal(out.length,1440);
  assert.equal(out[0][0],M.evaluate(E.barsOf(d).slice(0,60)).bias);
  assert.deepEqual(E.record(d),out);
});
test('Fill uses next open and reacts only to subsequent prices',()=>{
  const d=make();d.bars[60]=[200,200,200,200];
  const a=E.record(d)[0];
  assert.equal(a[0],'Long'); assert.ok(a[1]<-40);
  d.bars[70]=[10,10,10,10];assert.equal(E.record(d)[0][1],a[1]);
  d.bars[62]=null;assert.equal(E.record(d)[0][1],null);
  d.bars[50]=null;assert.equal(E.record(d)[0][0],null);
});
test('Funding sign, fees and settlement boundary',()=>{
  const d=make(()=>100), b=E.barsOf(d);
  const plain=E.outcome(b,60,5,'Long',d);
  assert.ok(plain<0);d.funding=[[start+60*E.MINUTE,.01]];
  assert.equal(E.outcome(b,60,5,'Long',d),plain);
  d.funding=[[start+61*E.MINUTE,.01]];
  assert.ok(E.outcome(b,60,5,'Long',d)<plain);
  assert.ok(E.outcome(b,60,5,'Short',d)>0);
});
test('Walk-forward training frozen when every future candle is replaced',()=>{
  const d=make(), before=E.walk(d);
  for(let i=780;i<1560;i++)d.bars[i]=[1,1,1,1];
  assert.deepEqual(E.walk(d).trained,before.trained);
  const empty=E.walk(make(()=>100));assert.equal(empty.test.trades,0);assert.equal(empty.test.total,0);
  d.bars[790]=null;assert.equal(E.walk(d).benchmark,null);
});
test('Playback cadence preserves fills; stop wins ties and adverse gaps',()=>{
  const initial={index:0,fills:[],position:null,pending:{side:1,stop:2,target:3}};
  const bars=[{open:100,high:101,low:99,close:100},{open:100,high:110,low:95,close:105}];
  function simulate(groups){let s=initial;for(const tick of groups)for(const b of tick)s=E.advance(s,b);return s;}
  const s=simulate([bars]);assert.deepEqual(s,simulate([[bars[0]],[bars[1]]]));
  assert.equal(s.fills[0].reason,'Stop');assert.equal(s.fills[0].price,98);
  const open=E.advance(initial,bars[0]),gap=E.advance(open,{open:95,high:98,low:90,close:97});
  assert.equal(gap.fills[0].price,95);
});
test('Published archive integrity and stored rule parity',()=>{
  const manifest=JSON.parse(fs.readFileSync('assets/lab/index.json'));
  for(const [date,profiles] of Object.entries(manifest.days)){
    assert.equal(profiles.length,6);
    for(const p of profiles){
      const bytes=fs.readFileSync('assets/lab/'+p.file);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.sha256);
      const d=JSON.parse(zlib.gunzipSync(bytes));assert.equal(d.day,date);
      assert.deepEqual(E.record(d),d.signals);
    }
  }
});
