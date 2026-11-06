import test from 'node:test';
import assert from 'node:assert/strict';
import {SignalProcessor,estimate} from '../processing.mjs';
import config from '../filter-config.mjs';

function samples(bpm=75,transform=(p,e)=>[p,e]) {
 const proc=new SignalProcessor(config),rows=[];
 for(let n=0;n<15000;n++) {
  const t=n/500,phase=(t*bpm/60)%1,g=(m,s)=>Math.exp(-.5*((phase-m)/s)**2);
  let p=450+50*g(.43,.085)+8*Math.sin(2*Math.PI*50*t);
  let e=512+150*g(.15,.018)-70*g(.19,.022)+40*Math.sin(2*Math.PI*50*t);
  [p,e]=transform(p,e);const v=proc.next(p,e);if(v.warm)rows.push({p,e,...v});
 }
 return rows.slice(-5000);
}
for(const bpm of [45,60,75,100,140,170])test(`clean synthetic ${bpm} bpm`,()=>{
 const r=estimate(samples(bpm));assert.equal(r.valid,true);assert.ok(Math.abs(r.hr-bpm)<1);
});
for(const [name,transform] of [
 ['PPG upper clipping',(p,e)=>[Math.min(1023,1000+4*(p-450)),e]],
 ['PPG lower clipping',(p,e)=>[Math.max(0,23-4*(p-450)),e]]
])test(name,()=>{
 const r=estimate(samples(75,transform));assert.equal(r.valid,false);assert.equal(r.hr,null);assert.equal(r.ppg,null);assert.ok(r.ecg);assert.equal(r.reason,'PPG 触底或饱和');
});
test('PPG threshold boundary and recovery preserve clean estimates',()=>{
 const clean=samples(),original=estimate(clean);
 for(const rail of [0,2,1021,1023]) {
  // Isolate raw-sample quality gating from the already-validated beat detector.
  const rows=clean.map(r=>({...r}));
  for(let i=0;i<50;i++)rows[i].p=rail;
  assert.equal(estimate(rows).valid,true);
  rows[50].p=rail;assert.equal(estimate(rows).valid,false);
 }
 assert.deepEqual(estimate(clean),original);
});
test('flat PPG and ECG rail remain rejected',()=>{
 assert.equal(estimate(samples(75,(p,e)=>[450,e])).valid,false);
 assert.equal(estimate(samples(75,(p,e)=>[p,0])).reason,'ECG 触底或饱和');
});
