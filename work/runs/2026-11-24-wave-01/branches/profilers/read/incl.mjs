import fs from 'node:fs';
const [file, ...pats] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(file));
const nodes = new Map(); const parent = new Map();
for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children || []) parent.set(c, n.id); }
const reduce = (u) => { u = (u || '').replace(/\?.*$/, ''); let m; if ((m = u.match(/(apps\/desktop\/src\/.+)$/))) return m[1]; if ((m = u.match(/(packages\/[^/]+\/src\/.+)$/))) return m[1]; if ((m = u.match(/localhost:1420(\/src\/.+)$/))) return 'apps/desktop' + m[1]; if ((m = u.match(/node_modules\/(?:\.vite\/deps\/)?([^/]+)/))) return 'pkg:' + m[1]; return u; };
const key = (id) => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'} @ ${reduce(cf.url)}:${cf.lineNumber + 1}`; };
const kc = new Map(); const K = (id) => kc.get(id) ?? (kc.set(id, key(id)), kc.get(id));
const incl = new Map(); let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i + 1] ?? 200) / 1000; const id = profile.samples[i];
  if (K(id).startsWith('(idle)')) continue; total += dt;
  const seen = new Set(); for (let c = id; c !== undefined; c = parent.get(c)) { const k = K(c); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); }
}
console.log('busy', total.toFixed(0));
for (const p of pats) for (const [k, v] of [...incl].filter(([k]) => k.includes(p)).sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(v.toFixed(0) + 'ms', k);
