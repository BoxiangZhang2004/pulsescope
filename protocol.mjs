export class FrameParser {
  constructor(onFrame) { this.onFrame=onFrame; this.pending=[]; this.discarded=0; this.invalid=0; }
  push(chunk) {
    this.pending.push(...chunk); let i=0;
    while(i+1<this.pending.length){
      if(this.pending[i]!==170||this.pending[i+1]!==187){i++;this.discarded++;continue;}
      if(i+6>this.pending.length)break;
      const p=this.pending[i+2]*256+this.pending[i+3],e=this.pending[i+4]*256+this.pending[i+5];
      if(p>1023||e>1023){i++;this.discarded++;this.invalid++;continue;}
      this.onFrame(p,e);i+=6;
    }
    this.pending=this.pending.slice(i);
  }
}
