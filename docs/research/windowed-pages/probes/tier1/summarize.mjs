// Summarises the JSON files of run-matrix.sh into one table (median over runs). usage: node summarize.mjs <dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] ?? '.';
const med = (a) => { a = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const f = (x, d = 0) => (x == null ? '-' : Number(x).toFixed(d));
const rows = [];
for (const file of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const { meta, runs } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const ok = runs.filter((r) => !r.error);
  const g = (fn) => med(ok.map(fn));
  rows.push({ file: file.replace('.json', ''), v: meta.version, n: `${ok.length}/${runs.length}`,
    first: g((r) => r.open?.firstTextMs), cc: g((r) => r.open?.contentCompleteMs), done: g((r) => r.settle?.typesetDoneMs), doneAll: ok.every((r) => r.settle?.done),
    work: g((r) => r.settle?.work), cdp: g((r) => r.settle?.cdp?.taskMs), lay: g((r) => r.settle?.cdp?.layoutMs), set: g((r) => r.settle?.set), par: g((r) => r.settle?.paragraphs),
    sm: g((r) => r.scrollMid?.medianWallMs), smS: g((r) => r.scrollMid?.medianScriptMs), smC: g((r) => r.scrollMid?.medianCdpTaskMs), se: g((r) => r.scrollEnd?.medianWallMs), seC: g((r) => r.scrollEnd?.medianCdpTaskMs),
    key: g((r) => r.key?.medianWallMs), keyC: g((r) => r.key?.medianCdpTaskMs), rel: g((r) => r.relayoutMs?.median),
    find: ok.map((r) => r.find?.count).filter(Boolean)[0] ?? '-', findMs: g((r) => r.find?.wallMs), findC: g((r) => r.find?.cdpTaskMs), step: g((r) => r.findStep?.scriptMs),
    sh: g((r) => r.settle?.scrollHeight), ev: ok[0]?.events ? `${ok[0].events.skipped}/${ok[0].events.shown}` : '-', off: g((r) => r.geometry?.offGridTops), blocks: g((r) => r.geometry?.blocks), errs: runs.filter((r) => r.error).map((r) => r.error).join('; ') });
}
console.log('| config | engine | runs | first text ms | content complete ms | typeset_done ms (all done?) | script ms to done | CDP task ms to done (layout) | paragraphs set / total | scroll mid ms wall (script, CDP) | scroll end ms wall (CDP) | key ms wall (CDP) | forced relayout ms | find count, wall ms (CDP task) | find step script ms | scrollHeight at done | cv events skipped/shown | off-grid tops / blocks | errors |');
console.log('|' + ' --- |'.repeat(19));
for (const r of rows) console.log(`| ${r.file} | ${r.v} | ${r.n} | ${f(r.first)} | ${f(r.cc)} | ${f(r.done)}${r.doneAll ? '' : ' (cap)'} | ${f(r.work)} | ${f(r.cdp)} (${f(r.lay)}) | ${f(r.set)} / ${f(r.par)} | ${f(r.sm)} (${f(r.smS)}, ${f(r.smC, 1)}) | ${f(r.se)} (${f(r.seC, 1)}) | ${f(r.key)} (${f(r.keyC, 1)}) | ${f(r.rel, 1)} | ${r.find}, ${f(r.findMs)} (${f(r.findC)}) | ${f(r.step, 1)} | ${f(r.sh)} | ${r.ev} | ${f(r.off)} / ${f(r.blocks)} | ${r.errs} |`);
