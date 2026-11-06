// Presentation helpers never modify full-rate samples or the HR input.
export class SampleRing {
 constructor(capacity=15000){this.capacity=capacity;this.items=new Array(capacity);this.clear();}
 clear(){this.start=0;this.length=0;}
 push(sample){const at=(this.start+this.length)%this.capacity;this.items[at]=sample;if(this.length<this.capacity)this.length++;else this.start=(this.start+1)%this.capacity;}
 at(index){if(index<0)index+=this.length;return index>=0&&index<this.length?this.items[(this.start+index)%this.capacity]:undefined;}
 toArray(){return Array.from({length:this.length},(_,i)=>this.at(i));}
 between(from,to){const result=[];for(let i=this.length-1;i>=0;i--){const s=this.at(i);if(s.n<from)break;if(s.n<=to)result.push(s);}return result.reverse();}
}

export class ScrollClock {
 constructor(fs=500,delayMs=100){this.fs=fs;this.lag=fs*delayMs/1000;this.reset();}
 reset(){this.end=null;this.time=null;}
 next(latest,now){
  const target=Math.max(0,latest-this.lag);
  if(this.end===null||latest<this.end||target-this.end>this.fs){this.end=target;this.time=now;return this.end;}
  const dt=Math.max(0,Math.min(.1,(now-this.time)/1000));this.time=now;
  // A small playback buffer absorbs USB batches. Never draw beyond data.
  const speed=this.fs*Math.max(.8,Math.min(1.2,1+(target-this.end)/this.fs));
  this.end=Math.min(latest,this.end+dt*speed);
  return this.end;
 }
}

export class StableScale {
 constructor(){this.reset();}
 reset(){this.range=null;this.key=null;this.time=null;}
 next(low,high,key,now){
  if(this.key!==key||!this.range){this.range=[low,high];this.key=key;this.time=now;return this.range;}
  const alpha=1-Math.exp(-Math.max(0,now-this.time)/2500);this.time=now;
  // Expand immediately to retain peaks, release slowly to prevent pumping.
  this.range=[low<this.range[0]?low:this.range[0]+(low-this.range[0])*alpha,
   high>this.range[1]?high:this.range[1]+(high-this.range[1])*alpha];
  return this.range;
 }
}

export function peakEnvelope(samples,field,pixels){
 if(samples.length<=pixels*2)return samples;
 const size=Math.max(1,Math.ceil(samples.length/pixels)),result=[];
 let a=0;
 while(a<samples.length){
  let b=a+1;while(b<samples.length&&b<a+size&&samples[b].segment===samples[a].segment)b++;
  let min=a,max=a;
  for(let i=a+1;i<b;i++){if(samples[i][field]<samples[min][field])min=i;if(samples[i][field]>samples[max][field])max=i;}
  for(const i of [...new Set([a,min,max,b-1])].sort((x,y)=>x-y))result.push(samples[i]);
  a=b;
 }
 return result;
}
