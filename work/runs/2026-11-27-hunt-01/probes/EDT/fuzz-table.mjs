import * as T from '../../../../../packages/core/src/source-edit/table.ts';
let seed = 777; const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const toks = ['| a ', '|', '| b |', '\n', '\r\n', '| --- ', '|---|---|', ':--:', '\\|', '`x|y`', '> ', '  ', 'é', '😀', '\t', '| c', '\r', '- '];
const bad = new Map(); let applied = 0;
const note = (k, d) => { if (!bad.has(k)) bad.set(k, d); };
for (let it = 0; it < 6000; it++) {
  let text = '| h1 | h2 |\n|---|---|\n'; for (let i = rnd(25); i > 0; i--) text += toks[rnd(toks.length)];
  for (let caret = 0; caret <= text.length; caret += 1 + rnd(5)) {
    for (const [name, fn] of [['align', T.alignTable], ['row', T.addTableRow], ['col', T.addTableColumn], ['sort', T.sortTableRows]]) {
      let out; try { out = fn(text, caret); } catch (e) { note(name + ':throw', { text, caret, e: String(e).slice(0, 200) }); continue; }
      if (!out) continue; applied++;
      for (const c of out.changes) if (c.from < 0 || c.to > text.length || c.from > c.to) note(name + ':range', { text, caret, c });
    }
  }
}
for (const [k, d] of bad) console.log(k, JSON.stringify(d));
console.log('applied', applied, 'problems', bad.size);
