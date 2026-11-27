// own text: plain prose, no trailing spaces; node timing per transform
import { groupsFor } from '../../../../../apps/desktop/src/left/transforms-model.ts';
const mk = (n) => { let s=''; for (let h=0;h<n;h++) s+=`## Heading ${h}\n\nSome plain prose for section ${h}, with a [link](https://e.com/${h}).\n\n1. one\n2. two\n\n- [ ] task\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`; return s; };
for (const n of [500,1500,3000]) { const t=mk(n); console.log(`== ${n} sections, ${(t.length/1e6).toFixed(2)} MB`);
 for (const g of groupsFor('markdown')) for (const it of g.items) { const a=performance.now(); try{it.fx(t,null);}catch{} const ms=performance.now()-a; if(ms>100) console.log(`  ${it.id.padEnd(15)} ${ms.toFixed(0)} ms`); } }
