// node --experimental-strip-types tx-time.mjs  (from apps/desktop)
import { groupsFor, changedOld } from '/Users/<user>/Dev/marxy-wt/hunt-02/apps/desktop/src/left/transforms-model.ts';
const mk = (mb, heads) => { const per = Math.floor(mb*1e6/heads); const parts=[]; for (let h=0;h<heads;h++){ let b=`## Heading ${h} about things\n\n`; while(b.length<per-40) b+=`Paragraph with a [link](https://example.com/${h}) and *emphasis*  and trailing spaces   \n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`; parts.push(b);} return parts.join(''); };
for (const mb of (process.env.SIZES||'0.25,0.5,1,2').split(',').map(Number)) {
  const text = mk(mb, 3000); console.log(`== ${mb} MB (${text.length} chars)`);
  let total = 0;
  for (const g of groupsFor('markdown')) for (const it of g.items) {
    const t = performance.now(); let e; try { e = it.fx(text, null); } catch (x) { e = {text, c:-1}; }
    const ms = performance.now() - t; total += ms;
    let ms2 = 0; if (e.c > 0) { const t2 = performance.now(); try { changedOld(text, e.text); } catch {} ms2 = performance.now() - t2; }
    if (ms > 100 || ms2 > 100) console.log(`  ${it.id.padEnd(16)} fx ${ms.toFixed(0)} ms  changedOld(wash) ${ms2.toFixed(0)} ms  c=${e.c}`);
  }
  console.log(`  all counts: ${total.toFixed(0)} ms`);
}
