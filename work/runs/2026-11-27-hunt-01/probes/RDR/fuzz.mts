import { parseMarkdown, checkInvariants, reparseMarkdown } from '/Users/<user>/Dev/marxy-wt/hunt-01/packages/core/src/index.ts';
const enc = new TextEncoder();
const pieces = ['a','\r','\n','\r\n','\t','    ','- ','1. ','> ','# ','```','~~~','| a | b |\n|---|---|\n','[x]','- [ ] ','😀','é','\u0000','\u2028','\ufeff','$$','$x$','<div>','</div>','<!--','-->','[a]: http://x\n','[a]','[^1]','[^1]: n\n','***','---','===','\\','*','_','~~','`','<','&amp;','http://a.b','\u00a0','>','|',':::','+++\n'];
let seed=1; const r=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
let bad=0, thrown=0;
for(let i=0;i<4000;i++){
  let s=''; const n=1+Math.floor(r()*25); for(let j=0;j<n;j++) s+=pieces[Math.floor(r()*pieces.length)];
  try{
    const bytes=enc.encode(s);
    const d=parseMarkdown(bytes);
    const v=checkInvariants(d,bytes);
    if(v.length){ if(bad++<6) console.log('INV',JSON.stringify(s),JSON.stringify(v[0])); }
    // reparse
    let t=s.slice(0,Math.floor(r()*s.length))+pieces[Math.floor(r()*pieces.length)]+s.slice(Math.floor(r()*s.length));
    const nb=enc.encode(t);
  } catch(e){ if(thrown++<6) console.log('THROW',JSON.stringify(s),String(e).slice(0,120)); }
}
console.log({bad,thrown});
