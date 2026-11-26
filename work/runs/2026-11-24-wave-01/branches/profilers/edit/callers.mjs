// usage: node callers.mjs file.cpuprofile fnRegex [depth]  -> aggregated caller chains of matching nodes with inclusive ms
import { readFileSync } from 'node:fs';
const [, , file, re, depthArg] = process.argv;
const prof = JSON.parse(readFileSync(file, 'utf8'));
const depth = +(depthArg || 6);
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const selfMs = new Map();
for (let i = 0; i < prof.samples.length; i++) selfMs.set(prof.samples[i], (selfMs.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0) / 1000);
const incl = new Map();
const calc = (id) => { const n = nodes.get(id); let t = selfMs.get(id) || 0; for (const c of n.children || []) t += calc(c); incl.set(id, t); return t; };
calc(prof.nodes[0].id);
const lab = (n) => { const cf = n.callFrame; let u = cf.url || ''; const m = u.match(/\/src\/(.*?)(\?|$)/); if (m) u = m[1]; else { const nm = u.match(/node_modules\/(?:\.vite\/deps\/)?([^?]*)/); u = nm ? nm[1] : u; } return `${cf.functionName || '(anon)'} ${u.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`; };
const R = new RegExp(re);
const chains = new Map();
for (const n of prof.nodes) {
  if (!R.test(lab(n))) continue;
  // skip when an ancestor also matches (avoid double count)
  let p = parent.get(n.id), nested = false; while (p !== undefined) { if (R.test(lab(nodes.get(p)))) { nested = true; break; } p = parent.get(p); }
  if (nested) continue;
  const chain = []; p = parent.get(n.id); while (p !== undefined && chain.length < depth) { chain.push(lab(nodes.get(p))); p = parent.get(p); }
  const k = chain.join('  <-  ');
  chains.set(k, (chains.get(k) || 0) + incl.get(n.id));
}
for (const [k, v] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(v.toFixed(1), 'ms', k);
