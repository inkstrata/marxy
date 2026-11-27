// node tomd.mjs a.json b.json ... > matrix.md body: one row per shape and size, numbers per action, ratio per doubling.
import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const f = (x) => (!x ? '-' : x.err ? 'ERR' : `${(x.taskMs / 1000).toFixed(2)}${x.neverQuiet ? '!' : ''}`);
const L = (x) => (!x || x.err ? '-' : (x.longestMs / 1000).toFixed(2));
console.log('| shape | MB | first text s | open busy s | open task s | longest s | nodes | key | scroll mid | scroll end | to Source | to Read | edit | undo | reload | find (task s) | find longest s |');
console.log('|' + '---|'.repeat(17));
const order=[...new Set(rows.map(r=>r.kind))];rows.sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||a.bytes-b.bytes);
const by = {};
for (const r of rows) {
  if (r.fatal) { console.log(`| ${r.kind} | ${(r.bytes / 1e6).toFixed(1)} | FATAL: ${r.fatal} |`); continue; }
  const s = r.steps, o = s.open;
  (by[r.kind] ??= []).push(r);
  console.log(`| ${r.kind} | ${(r.bytes / 1e6).toFixed(2)} | ${o.err ? o.err : (o.firstMs / 1000).toFixed(2)} | ${o.busyUntilIdleMs ? (o.busyUntilIdleMs / 1000).toFixed(1) + (o.neverQuiet ? '!' : '') : '-'} | ${o.taskMs ? (o.taskMs / 1000).toFixed(1) : '-'} | ${o.longestMs ? (o.longestMs / 1000).toFixed(2) : '-'} | ${o.nodes ?? '-'} | ${f(s.key)} | ${f(s.scrollMid)} | ${f(s.scrollEnd)} | ${f(s.toSource)} | ${f(s.toRead)} | ${f(s.editUndo?.edit)} | ${f(s.editUndo?.undo)} | ${f(s.reload)} | ${f(s.find)} | ${L(s.find)} |`);
}
console.log('\nGrowth per size step (ratio of task seconds; open uses busy-until-idle seconds), by shape. Above 2.5 per doubling is super-linear.\n');
console.log('| shape | step | open | key | scroll mid | to Source | to Read | edit | undo | reload | find |');
console.log('|' + '---|'.repeat(11));
const rat = (a, b) => (!a || !b || a.err || b.err || !a.taskMs ? '-' : (b.taskMs / a.taskMs).toFixed(1));
for (const [k, rs] of Object.entries(by)) for (let i = 1; i < rs.length; i++) {
  const a = rs[i - 1].steps, b = rs[i].steps; const sz = `${(rs[i - 1].bytes / 1e6).toFixed(1)} to ${(rs[i].bytes / 1e6).toFixed(1)} MB (x${(rs[i].bytes / rs[i - 1].bytes).toFixed(1)})`;
  const op = a.open.busyUntilIdleMs && b.open.busyUntilIdleMs ? (b.open.busyUntilIdleMs / a.open.busyUntilIdleMs).toFixed(1) : '-';
  console.log(`| ${k} | ${sz} | ${op} | ${rat(a.key, b.key)} | ${rat(a.scrollMid, b.scrollMid)} | ${rat(a.toSource, b.toSource)} | ${rat(a.toRead, b.toRead)} | ${rat(a.editUndo?.edit, b.editUndo?.edit)} | ${rat(a.editUndo?.undo, b.editUndo?.undo)} | ${rat(a.reload, b.reload)} | ${rat(a.find, b.find)} |`);
}
