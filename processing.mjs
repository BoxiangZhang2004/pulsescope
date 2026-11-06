export class SOSFilter {
 constructor(sos){this.sos=sos;this.z=sos.map(()=>[0,0]);}
 next(x){for(let i=0;i<this.sos.length;i++){const [b0,b1,b2,a0,a1,a2]=this.sos[i],z=this.z[i],y=b0/a0*x+z[0];z[0]=b1/a0*x-a1/a0*y+z[1];z[1]=b2/a0*x-a2/a0*y;x=y;}return x;}
}
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const median=x=>{const a=x.slice().sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:0;};
function beatEstimate(x,type){const m=mean(x),sd=Math.sqrt(mean(x.map(v=>(v-m)**2)));if(sd<.1)return {hr:null,cv:99,peaks:[],reason:'振幅不足'};
 const threshold=median(x)+sd*(type==='ppg'?.7:.65),peaks=[];
 for(let i=1;i<x.length-1;i++){if(x[i]>threshold&&x[i]>=x[i-1]&&x[i]>x[i+1]){const last=peaks.at(-1);if(last!==undefined&&i-last<150){if(x[i]>x[last])peaks[peaks.length-1]=i;}else peaks.push(i);}}
 const rr=peaks.slice(1).map((v,i)=>(v-peaks[i])/500),med=median(rr),cv=rr.length?Math.sqrt(mean(rr.map(v=>(v-mean(rr))**2)))/mean(rr):99,hr=med?60/med:null;
 return {hr,cv,peaks,reason:peaks.length<5?'有效心搏不足':cv>.2?'节律检测不稳定':hr<40||hr>180?'超出研究范围':'ok'};
}
function periodicity(x){const m=mean(x),a=x.map(v=>v-m),energy=a.reduce((s,v)=>s+v*v,0);let best=-1,lag=0;for(let k=167;k<=750;k++){let v=0;for(let i=k;i<a.length;i+=4)v+=a[i]*a[i-k];v=v*4/energy;if(v>best){best=v;lag=k;}}return {hr:30000/lag,score:best};}
export function estimate(samples){if(samples.length<5000)return {valid:false,reason:'等待 10 秒有效信号',ecg:null,ppg:null};const s=samples.slice(-5000),p=beatEstimate(s.map(v=>v.pf),'ppg');const q=s.map(v=>v.q*v.q);let sum=0;const envelope=q.map((v,i)=>{sum+=v;if(i>=40)sum-=q[i-40];return sum/40;});const e=beatEstimate(envelope,'ecg'),ac=periodicity(s.map(v=>v.pf)),rail=s.filter(v=>v.e<=2||v.e>=1021).length/s.length,flatP=Math.max(...s.map(v=>v.p))-Math.min(...s.map(v=>v.p))<5;
 const ppgRail=s.filter(v=>v.p<=2||v.p>=1021).length/s.length;
 const pOK=ppgRail<=.01&&p.reason==='ok'&&ac.score>=.45&&Math.abs(p.hr-ac.hr)<=5&&!flatP;
 const eOK=e.reason==='ok'&&rail<=.01;
 const agree=pOK&&eOK&&Math.abs(p.hr-e.hr)<=5;
 return {valid:agree,hr:agree?(p.hr+e.hr)/2:null,ecg:eOK?e.hr:null,ppg:pOK?p.hr:null,ecgCandidate:e.hr,ppgCandidate:p.hr,ecgCV:e.cv,ppgCV:p.cv,ac,rail,ppgRail,pPeaks:p.peaks,ePeaks:e.peaks,reason:agree?'双通道一致 · 研究估计':rail>.01?'ECG 触底或饱和':ppgRail>.01?'PPG 触底或饱和':!pOK?'PPG 质量不足':!eOK?'ECG 质量不足':'两通道心率不一致'};
}
export class SignalProcessor {
 constructor(config){this.config=config;this.reset();}
 reset(){this.p=new SOSFilter(this.config.ppg);this.e=new SOSFilter(this.config.ecg);this.q=new SOSFilter(this.config.qrs);this.count=0;}
 next(p,e){const pf=this.p.next(p),ef=this.e.next(e),q=this.q.next(e);this.count++;return {pf,ef,q,warm:this.count>1500};}
}
