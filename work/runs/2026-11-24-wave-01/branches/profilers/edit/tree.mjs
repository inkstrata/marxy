// usage: node tree.mjs file.cpuprofile [rootRegex] [minMs] [maxDepth]
import { readFileSync } from 'node:fs';
const [, , file, rootRe, minArg, depthArg] = process.argv;
const prof = JSON.parse(readFileSync(file, 'utf8'));
const min = +(minArg || 3), maxDepth = +(depthArg || 14);
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const selfMs = new Map();
for (let i = 0; i < prof.samples.length; i++) selfMs.set(prof.samples[i], (selfMs.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0) / 1000);
const incl = new Map();
const calc = (id) => { const n = nodes.get(id); let t = selfMs.get(id) || 0; for (const c of n.children || []) t += calc(c); incl.set(id, t); return t; };
calc(prof.nodes[0].id);
const lab = (n) => { const cf = n.callFrame; let u = cf.url || ''; const m = u.match(/\/src\/(.*?)(\?|$)/); if (m) u = m[1]; else { const nm = u.match(/node_modules\/(?:\.vite\/deps\/)?([^?]*)/); u = nm ? nm[1] : u.replace(/^https?:\/\/[^/]+/, ''); } return `${cf.functionName || '(anon)'} ${u}:${cf.lineNumber + 1}`; };
const re = rootRe && rootRe !== '-' ? new RegExp(rootRe) : null;
function show(id, d) {
  const n = nodes.get(id); const t = incl.get(id);
  if (t < min || d > maxDepth) return;
  console.log(`${' '.repeat(d)}${t.toFixed(1)} (self ${(selfMs.get(id) || 0).toFixed(1)}) ${lab(n)}`);
  for (const c of [...(n.children || [])].sort((a, b) => incl.get(b) - incl.get(a))) show(c, d + 1);
}
if (!re) show(prof.nodes[0].id, 0);
else {
  // aggregate: for every node matching, print subtree (merge by walking only first-level matches not nested in another match)
  const seen = new Set();
  const walk = (id, inside) => {
    const n = nodes.get(id);
    const hit = re.test(lab(n));
    if (hit && !inside) { show(id, 0); }
    for (const c of n.children || []) walk(c, inside || hit);
  };
  walk(prof.nodes[0].id, false);
}
