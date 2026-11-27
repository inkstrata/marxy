import { createBuffer, foldSlice, sourceTextOfRange, splice, sourceTextOf, byteToSourceOffset } from '/Users/<user>/Dev/marxy-wt/hunt-01/packages/core/src/index.ts';
let seed=7; const r=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
const parts=[[0x61],[0x0a],[0x0d,0x0a],[0x0d],[0xf0,0x9f,0x98,0x80],[0xc3,0xa9],[0xff],[0xc3],[0xef,0xbb,0xbf],[0x20],[0xed,0xa0,0x80],[0xe2,0x80,0xa8],[0xef,0xbf,0xbd]];
let bad=0, n=0;
for(let i=0;i<20000;i++){
  const bytes:number[]=[]; const k=1+Math.floor(r()*14); for(let j=0;j<k;j++) bytes.push(...parts[Math.floor(r()*parts.length)]);
  const u=new Uint8Array(bytes); const buf=createBuffer('x.md',u);
  const a=Math.floor(r()*(u.length+1)), b=a+Math.floor(r()*(u.length-a+1));
  const slice={file:'x.md',start:a,end:b};
  let text:string; try{ text=sourceTextOfRange(buf,slice);}catch{continue}
  n++;
  try{
    if(foldSlice(buf,slice,text)!==null){ if(bad++<8) console.log('NONNULL on unchanged',bytes.map(x=>x.toString(16)).join(' '),a,b); continue; }
    const at=Math.floor(r()*(text.length+1)); const cc=(x:number)=>text.charCodeAt(x); if(at>0&&at<text.length&&((cc(at-1)>=0xd800&&cc(at-1)<0xdc00&&cc(at)>=0xdc00&&cc(at)<0xe000)||(text[at-1]==='\r'&&text[at]==='\n'))) continue;
    const ins=['x','é','😀','\n'][Math.floor(r()*4)];
    const t2=text.slice(0,at)+ins+text.slice(at);
    const f=foldSlice(buf,slice,t2);
    if(!f){ if(bad++<8) console.log('NULL on insert',bytes.map(x=>x.toString(16)).join(' '),a,b,at,JSON.stringify(ins)); continue;}
    // outside range preserved
    const nb=splice(buf,f.range,f.replacement);
    if(ins!=='\n'){ const whole=sourceTextOf(buf).text; const base=byteToSourceOffset(buf,a); const want=whole.slice(0,base+at)+ins+whole.slice(base+at); const got=sourceTextOf(nb).text; if(got!==want && bad++<10) console.log('MISMATCH',bytes.map(x=>x.toString(16)).join(' '),a,b,at,JSON.stringify(ins),JSON.stringify(want),JSON.stringify(got)); }
  }catch(e){ if(bad++<8) console.log('THROW',bytes.map(x=>x.toString(16)).join(' '),a,b,String(e).slice(0,80)); }
}
console.log({n,bad});
