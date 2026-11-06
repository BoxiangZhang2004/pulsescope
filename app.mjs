import {FrameParser} from './protocol.mjs';
import {SignalProcessor,estimate} from './processing.mjs?v=20261106-v3';
import {SampleRing,ScrollClock,StableScale,peakEnvelope} from './display.mjs?v=20261106-v3';
import config from './filter-config.mjs?v=20261106-v3';

const VERSION='20261106-v3';
const $=id=>document.getElementById(id);
const processor=new SignalProcessor(config),data=new SampleRing(),scroll=new ScrollClock();
const scales={p:new StableScale(),e:new StableScale()};
let hrBuffer=[],hrResult={valid:false,reason:'等待 13 秒信号'},signalSegment=0;
let mode='idle',port=null,reader=null,readTask=null,closing=false,connecting=false;
let paused=false,recording=false,total=0,started=0,lastReceived=0,rateBase=0,rateTime=0,rate=0;
let records=[],recordSource='',frozen=[],timer=null,parser,sessionOrigin='',demoN=0,lastDiscarded=0;

function notice(text,warn=false){$('notice').textContent=text;$('notice').className='notice'+(warn?' warn':'');}
function format(sec){return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;}
function newParser(){parser=new FrameParser(accept);lastDiscarded=0;}
function newSegment(reason){
 processor.reset();hrBuffer=[];hrResult={valid:false,reason};signalSegment++;
 scroll.reset();scales.p.reset();scales.e.reset();
}
function accept(p,e){
 const received=performance.now();
 if(lastReceived&&received-lastReceived>1000)newSegment('信号中断，重新积累');
 if(parser.discarded!==lastDiscarded){lastDiscarded=parser.discarded;newSegment('数据重新同步，重新积累');}
 const v=processor.next(p,e);total++;lastReceived=received;
 const sample={n:total-1,p,e,...v,segment:signalSegment};data.push(sample);
 // HR stays on the standard path, independent of the selected display.
 if(v.warm){hrBuffer.push(sample);if(hrBuffer.length>5000)hrBuffer.shift();}
 if(total%500===0)hrResult=estimate(hrBuffer);
 if(recording){
  records.push([total-1,((total-1)/500).toFixed(3),((received-started)/1000).toFixed(6),p,e,
   v.pf.toFixed(6),v.ef.toFixed(6),v.warm?1:0,hrResult.valid?hrResult.hr.toFixed(2):'',hrResult.valid?1:0,
   v.pfHigh.toFixed(6),v.efHigh.toFixed(6),$('filterView').value,signalSegment,VERSION]);
  if(records.length>=900000){recording=false;notice('已达到 900,000 帧记录上限。采集继续，请导出 CSV。',true);}
 }
}
function reset(){
 newSegment('等待 13 秒信号');total=0;data.clear();frozen=[];records=[];
 recording=false;paused=false;demoN=0;started=performance.now();rateTime=started;
 rateBase=0;rate=0;lastReceived=0;sessionOrigin=new Date().toISOString();newParser();
}
function confirmReset(){return !records.length||confirm('切换或清空会丢弃尚保留的记录。请先导出 CSV。继续清空？');}
function activate(next){reset();mode=next;recordSource=next;$('device').textContent=next==='demo'?'合成信号发生器 / 演示':'Arduino / USB 串口';}
function stopDemo(){if(timer){clearInterval(timer);timer=null;}}
async function disconnect(){
 if(closing)return;closing=true;
 try{await reader?.cancel();await readTask;}catch{}
 finally{try{await port?.close();}catch{}reader=null;port=null;readTask=null;mode='idle';recording=false;closing=false;notice('串口已断开。已有记录仍可导出。');renderUI();}
}
async function readLoop(){
 try{
  reader=port.readable.getReader();
  while(true){const {value,done}=await reader.read();if(done)break;if(value)parser.push(value);}
 }catch(e){if(!closing)notice('串口读取中断：'+e.message+'。已有记录仍可导出。',true);}
 finally{
  reader?.releaseLock();reader=null;
  if(!closing){try{await port?.close();}catch{}port=null;mode='idle';recording=false;renderUI();}
 }
}
$('connect').onclick=async()=>{
 if(port){await disconnect();return;}if(connecting)return;
 if(!('serial' in navigator)||!isSecureContext){notice('当前浏览器未提供 Web Serial。请用桌面版 Chrome 在 HTTPS 页面或 localhost 打开；仍可使用演示模式。',true);return;}
 if(!confirmReset())return;connecting=true;renderUI();
 try{
  const selected=await navigator.serial.requestPort();
  await selected.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:65536});
  stopDemo();port=selected;activate('serial');notice('串口已连接，等待 AA BB 二进制帧。开发板连接后可能自动复位，请稍候。');readTask=readLoop();
 }catch(e){
  if(e.name!=='NotFoundError')notice('连接失败：'+e.message+'。请关闭其他占用串口的软件。',true);
  else notice('未选择串口，当前会话继续。');
 }finally{connecting=false;renderUI();}
};
$('demo').onclick=()=>{
 if(port||connecting||closing)return;
 if(mode==='demo'){stopDemo();mode='idle';recording=false;notice('演示已停止。演示记录仍可导出。');renderUI();return;}
 if(!confirmReset())return;activate('demo');let prev=performance.now(),fraction=0;
 timer=setInterval(()=>{
  const now=performance.now();fraction+=(now-prev)*.5;prev=now;
  const count=Math.min(250,Math.floor(fraction));fraction-=Math.floor(fraction);const bytes=new Uint8Array(count*6);
  for(let i=0;i<count;i++){
   const t=demoN++/500,phase=t%(.84),g=(m,s)=>Math.exp(-(((phase-m)/s)**2)/2);
   const ecg=Math.round(505+24*g(.13,.025)-42*g(.25,.009)+320*g(.275,.009)-75*g(.30,.013)+66*g(.47,.05)+9*Math.sin(t*.8));
   const pulse=Math.round(420+260*g(.45,.068)+65*g(.61,.055)+14*Math.sin(t*.7));
   bytes.set([170,187,pulse>>8,pulse&255,ecg>>8,ecg&255],i*6);
  }
  parser.push(bytes);
 },20);
 notice('演示模式：当前波形、心率及导出均来自合成信号，可切换标准 / 高阶 / 双线对比。',true);renderUI();
};
$('pause').onclick=()=>{paused=!paused;if(paused)frozen=data.toArray();else scroll.reset();renderUI();};
$('record').onclick=()=>{
 if(recording){recording=false;notice('记录已停止，共 '+records.length.toLocaleString()+' 帧。可导出 CSV，或继续追加记录。');}
 else if(mode!=='idle'){
  if(records.length>=900000){notice('记录已满，请导出后清空会话。',true);return;}
  recording=true;notice((mode==='demo'?'正在记录合成演示数据':'正在记录真实串口数据')+'；切换显示与冻结画面均不影响记录。',mode==='demo');
 }
 renderUI();
};
$('export').onclick=()=>{
 if(!records.length)return;
 // Original 12 columns retain their names and positions; append new fields.
 const header='source,session_start_utc,sample_index,nominal_time_s,host_receive_elapsed_s,ppg_adc,ecg_adc,ppg_filtered_causal,ecg_filtered_causal,filter_warm,hr_cross_checked_bpm,hr_valid,ppg_high_order_causal,ecg_high_order_causal,display_profile,signal_segment,algorithm_version';
 const csv='\uFEFF'+header+'\r\n'+records.map(r=>`${recordSource},${sessionOrigin},${r.join(',')}`).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');
 a.href=url;a.download=`PulseScope_${recordSource}_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);notice('已导出 '+records.length.toLocaleString()+' 帧'+(recordSource==='demo'?'合成演示数据，':'串口数据，')+'包含原始值、两套滤波值及质量标记。');
};
$('clear').onclick=()=>{if(!confirmReset())return;reset();notice(mode==='demo'?'演示会话已清空，继续显示合成数据。':'当前会话已清空。',mode==='demo');renderUI();};
$('helpBtn').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();
$('filterView').onchange=()=>{scales.p.reset();scales.e.reset();renderUI();};
$('auto').onchange=()=>{scales.p.reset();scales.e.reset();};

function renderUI(){
 const active=mode!=='idle',fresh=active&&lastReceived&&performance.now()-lastReceived<1500,good=fresh&&hrResult.valid;
 $('heartRate').textContent=good?hrResult.hr.toFixed(1):'—';$('heartQuality').textContent=!fresh?'等待连续信号':hrResult.reason;
 $('ecgHR').textContent=fresh&&hrResult.ecg?hrResult.ecg.toFixed(1):'—';$('ppgHR').textContent=fresh&&hrResult.ppg?hrResult.ppg.toFixed(1):'—';
 $('heartCard').classList.toggle('accepted',!!good);
 $('modeBadge').textContent=mode==='demo'?'● 演示数据':mode==='serial'?'● 设备已连接':'○ 未连接';$('modeBadge').className='badge '+mode;
 $('clock').textContent=active?'SESSION '+new Date(sessionOrigin).toLocaleTimeString('zh-CN',{hour12:false}):'SESSION —';
 $('demo').textContent=mode==='demo'?'□ 停止演示':'▷ 演示模式';$('demo').disabled=!!port||connecting||closing;
 $('connect').textContent=connecting?'正在连接…':closing?'断开中…':port?'断开连接':'＋ 连接设备';$('connect').disabled=connecting||closing;
 $('record').disabled=!active||closing;$('record').textContent=recording?'■ 停止记录':records.length?'● 继续记录':'● 开始记录';
 $('export').disabled=!records.length;$('records').textContent=records.length.toLocaleString();
 $('recordState').textContent=recording?'● 记录中 · '+(recordSource==='demo'?'合成数据':'串口数据'):records.length?'已保留 · '+(recordSource==='demo'?'合成数据':'串口数据'):'未开始记录';
 $('pause').textContent=paused?'▷ 恢复显示':'Ⅱ 冻结显示';$('liveDot').className='live-dot'+(fresh&&!paused?' active':'');
 $('plotState').textContent=paused?'显示已冻结，接收继续':mode==='demo'?'合成信号':mode==='serial'?(fresh?'串口数据':'等待有效帧'):'等待数据';
 $('frames').textContent=total.toLocaleString();$('rate').textContent=active?rate:'—';$('discard').textContent=parser.discarded.toLocaleString();
 $('duration').textContent='名义样本时长 '+format(total/500);const last=(paused?frozen.at(-1):data.at(-1));
 $('ppg').textContent=last?.p??'—';$('ecg').textContent=last?.e??'—';
 const profile=$('filterView').value,labels={filtered:'标准滤波',high:'高阶滤波',compare:'标准 + 高阶对比',raw:'原始 ADC'};
 $('profileLabel').textContent=labels[profile];$('compareLegend').hidden=profile!=='compare';$('rawLegend').hidden=!$('overlay').checked||profile==='raw';
 $('filterInfo').textContent=profile==='raw'?'原始采样 · 不去除直流基线':profile==='high'?'ECG 0.5–40.5 Hz · PPG 0.5–8 Hz · 双通道 50 Hz 陷波':profile==='compare'?'两套滤波同时运行 · 切换不中断采集':'ECG 0.5–40 Hz + 50 Hz 陷波 · PPG 0.5–8 Hz';
}

function draw(id,key,color,visible,start,end,now){
 const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,w=rect.width,h=rect.height;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const left=43,right=w-15,top=19,bottom=h-27,profile=$('filterView').value,isRaw=profile==='raw';
 const base=key==='p'?'pf':'ef',high=key==='p'?'pfHigh':'efHigh';
 const fields=isRaw?[key]:profile==='compare'?[base,high]:[profile==='high'?high:base];
 let low=isRaw?0:-250,upper=isRaw?1023:250,rawMean=0;
 const overlay=!isRaw&&$('overlay').checked;
 if(overlay&&visible.length)rawMean=visible.reduce((s,d)=>s+d[key],0)/visible.length;
 if($('auto').checked&&visible.length){
  let min=Infinity,max=-Infinity;
  for(const d of visible){for(const f of fields){min=Math.min(min,d[f]);max=Math.max(max,d[f]);}if(overlay){min=Math.min(min,d[key]-rawMean);max=Math.max(max,d[key]-rawMean);}}
  if(isRaw){const pad=Math.max(10,(max-min)*.15);low=Math.max(0,min-pad);upper=Math.min(1023,max+pad);}
  else{upper=Math.max(10,Math.max(Math.abs(min),Math.abs(max))*1.18);low=-upper;}
  [low,upper]=scales[key].next(low,upper,profile+':'+overlay,now);
 }
 ctx.font='10px -apple-system, sans-serif';ctx.lineWidth=1;
 for(let j=0;j<=4;j++){
  const y=top+(bottom-top)*j/4,value=upper-(upper-low)*j/4;
  ctx.strokeStyle=Math.abs(value)<.01?'#d4e4df':'#edf2ef';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  ctx.fillStyle='#809793';ctx.fillText(Math.round(value),3,y+3);
 }
 const seconds=(end-start)/500,tick=seconds<=5?1:seconds<=10?2:5;
 for(let sec=Math.ceil(start/500/tick)*tick;sec<=end/500;sec+=tick){
  const x=left+(sec*500-start)/(end-start)*(right-left);ctx.strokeStyle='#edf2ef';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
  ctx.fillStyle='#809793';ctx.fillText(sec.toFixed(0)+'s',Math.min(right-15,Math.max(left,x-7)),h-8);
 }
 if(!visible.length){ctx.fillStyle='#90a8a0';ctx.textAlign='center';ctx.font='12px sans-serif';ctx.fillText('连接设备，或开启演示模式',w/2,h/2);ctx.textAlign='left';return;}
 ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
 function trace(field,stroke,width,offset=0){
  const samples=peakEnvelope(visible,field,Math.max(1,Math.floor(right-left)));
  ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.lineJoin='round';ctx.beginPath();
  samples.forEach((d,i)=>{
   const x=left+(d.n-start)/(end-start)*(right-left),y=bottom-(d[field]-offset-low)/(upper-low)*(bottom-top);
   i&&samples[i-1].segment===d.segment?ctx.lineTo(x,y):ctx.moveTo(x,y);
  });ctx.stroke();
 }
 if(overlay)trace(key,'#93a9a05c',.8,rawMean);
 fields.forEach((f,i)=>trace(f,profile==='compare'&&i===1?'#d78346':color,profile==='compare'?1.35:1.6));
 const last=visible.at(-1),x=left+(last.n-start)/(end-start)*(right-left),y=bottom-(last[fields.at(-1)]-low)/(upper-low)*(bottom-top);
 ctx.fillStyle=profile==='compare'?'#d78346':color;ctx.beginPath();ctx.arc(x,y,2.5,0,2*Math.PI);ctx.fill();ctx.restore();
}

newParser();let lastPaint=0;
function paint(t){
 if(t-lastPaint>=1000/60-.5){
  const last=paused?frozen.at(-1):data.at(-1),seconds=+$('window').value;
  const head=last?(paused?last.n:scroll.next(last.n,t)):0;
  const end=Math.max(seconds*500,head),start=end-seconds*500;
  const visible=paused?frozen.filter(d=>d.n>=start&&d.n<=head):data.between(start,head);
  draw('ppgCanvas','p','#199880',visible,start,end,t);draw('ecgCanvas','e','#638cc7',visible,start,end,t);lastPaint=t;
 }
 requestAnimationFrame(paint);
}
requestAnimationFrame(paint);
setInterval(()=>{
 const now=performance.now();
 if(mode!=='idle'&&now-rateTime>=1000){rate=Math.round((total-rateBase)*1000/(now-rateTime));rateBase=total;rateTime=now;}
 renderUI();
},250);
renderUI();
if(!('serial' in navigator))notice('当前浏览器暂不支持串口连接。可先查看演示；真实采集请用桌面版 Chrome 打开。',true);
window.addEventListener('beforeunload',e=>{if(recording||records.length){e.preventDefault();e.returnValue='';}});
