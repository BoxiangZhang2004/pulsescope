import test from 'node:test';
import assert from 'node:assert/strict';
import {SOSFilter,SignalProcessor,estimate} from '../processing.mjs';
import config from '../filter-config.mjs';
import {SampleRing,ScrollClock,StableScale,peakEnvelope} from '../display.mjs';

test('constant ADC startup has no DC step in either display or detection',()=>{
 const p=new SignalProcessor(config);
 for(let i=0;i<5000;i++){
  const r=p.next(450,512);
  for(const k of ['pf','ef','q','pfHigh','efHigh'])assert.ok(Math.abs(r[k])<1e-7,`${k} ${r[k]}`);
 }
});
test('reusing and resetting a stream is identical to a fresh processor',()=>{
 const reused=new SignalProcessor(config);
 for(let i=0;i<8000;i++)reused.next(450+30*Math.sin(i/30),512+60*Math.sin(i/17));
 reused.reset();const fresh=new SignalProcessor(config);
 for(let i=0;i<2500;i++)assert.deepEqual(reused.next(700+Math.sin(i/3),300+Math.cos(i/7)),fresh.next(700+Math.sin(i/3),300+Math.cos(i/7)));
});
test('display-only high-order coefficients cannot change HR or its quality checks',()=>{
 const alternate={...config,highOrder:{ppg:[[1,0,0,1,0,0]],ecg:[[1,0,0,1,0,0]]}};
 const a=new SignalProcessor(config),b=new SignalProcessor(alternate),ra=[],rb=[];
 let different=false;
 for(let i=0;i<15000;i++){
  const phase=(i/500*75/60)%1,g=(m,s)=>Math.exp(-.5*((phase-m)/s)**2),p=450+50*g(.43,.085),e=512+150*g(.15,.018)-70*g(.19,.022);
  const va=a.next(p,e),vb=b.next(p,e);
  for(const k of ['pf','ef','q','warm'])assert.equal(va[k],vb[k]);
  different ||= Math.abs(va.pfHigh-vb.pfHigh)>1;
  if(va.warm){ra.push({p,e,...va});rb.push({p,e,...vb});}
 }
 assert.ok(different);assert.deepEqual(estimate(ra),estimate(rb));
});
test('SOS reset clears both initial state and previous signal',()=>{
 const f=new SOSFilter(config.highOrder.ppg);for(let i=0;i<6000;i++)f.next(300+100*Math.sin(i/30));
 f.reset();assert.ok(Math.abs(f.next(900))<1e-8);
});
test('ring overwrite preserves ordered full-rate samples and frozen snapshots',()=>{
 const ring=new SampleRing(8);for(let n=0;n<10;n++)ring.push({n,segment:0});
 const frozen=ring.toArray();assert.deepEqual(ring.between(3,7).map(r=>r.n),[3,4,5,6,7]);
 for(let n=10;n<20;n++)ring.push({n,segment:1});
 assert.deepEqual(frozen.map(r=>r.n),[2,3,4,5,6,7,8,9]);assert.equal(ring.at(-1).n,19);
 ring.clear();assert.equal(ring.length,0);assert.equal(ring.at(-1),undefined);
});
test('drawing reduction retains a one-sample QRS spike and gap boundaries',()=>{
 const rows=Array.from({length:5000},(_,n)=>({n,y:n===1251?1000:n===1252?-500:0,segment:n<2500?0:1}));
 const compressed=peakEnvelope(rows,'y',300);
 assert.ok(compressed.length<rows.length);assert.ok(compressed.some(r=>r.n===1251));assert.ok(compressed.some(r=>r.n===1252));
 assert.ok(compressed.some(r=>r.n===2499));assert.ok(compressed.some(r=>r.n===2500));
 for(let i=1;i<compressed.length;i++)assert.ok(compressed[i].n>compressed[i-1].n);
});
test('scroll clock advances smoothly on batched arrivals without future samples',()=>{
 const clock=new ScrollClock();let prev=-1,maxStep=0;
 for(let t=0;t<10000;t+=10){
  const latest=Math.floor(t/50)*25+24,end=clock.next(latest,t);
  assert.ok(end<=latest);assert.ok(end>=prev);if(prev>=0)maxStep=Math.max(maxStep,end-prev);prev=end;
 }
 assert.ok(maxStep<10);const stopped=clock.next(4999,12000);assert.ok(stopped<=4999);
 clock.reset();assert.equal(clock.next(0,13000),0);
});
test('vertical scale retains peaks and releases slowly',()=>{
 const scale=new StableScale();assert.deepEqual(scale.next(-10,10,'a',0),[-10,10]);
 assert.deepEqual(scale.next(-100,100,'a',16),[-100,100]);
 const slow=scale.next(-10,10,'a',32);assert.ok(slow[1]>90);assert.ok(slow[0]<-90);
 assert.deepEqual(scale.next(0,1023,'raw',40),[0,1023]);
});
