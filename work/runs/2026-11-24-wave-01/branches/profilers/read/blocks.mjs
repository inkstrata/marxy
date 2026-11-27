import fs from 'node:fs';
const [file, minBusy = '40', gapMs = '1', maxOut = '40'] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(file));
const nodes = new Map(); const parent = new Map();
for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children || []) parent.set(c, n.id); }
const reduce = (u) => { u = (u || '').replace(/\?.*$/, ''); let m; if ((m = u.match(/(apps\/desktop\/src\/.+)$/))) return m[1]; if ((m = u.match(/(packages\/[^/]+\/src\/.+)$/))) return m[1]; if ((m = u.match(/localhost:1420(\/src\/.+)$/))) return 'apps/desktop' + m[1]; if ((m = u.match(/node_modules\/(?:\.vite\/deps\/)?([^/]+)/))) return 'pkg:' + m[1]; return u; };
const key = (id) => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'} @ ${reduce(cf.url)}:${cf.lineNumber + 1}`; };
const kc = new Map(); const K = (id) => { let k = kc.get(id); if (!k) { k = key(id); kc.set(id, k); } return k; };
let t = 0; const blocks = []; let cur = null; let idle = 0;
const appRe = /@ (apps\/desktop\/src|packages\/)/;
for (let i = 0; i < profile.samples.length; i++) {
  t += profile.timeDeltas[i]; const dt = (profile.timeDeltas[i + 1] ?? 200) / 1000; const id = profile.samples[i]; const k = K(id);
  if (k.startsWith('(idle)')) { idle += dt; if (cur && idle >= Number(gapMs)) { blocks.push(cur); cur = null; } continue; }
  idle = 0;
  if (!cur) cur = { start: t / 1000, end: t / 1000, busy: 0, self: new Map(), incl: new Map() };
  cur.end = t / 1000; cur.busy += dt;
  cur.self.set(k, (cur.self.get(k) || 0) + dt);
  const seen = new Set(); for (let c = id; c !== undefined; c = parent.get(c)) { const kk = K(c); if (seen.has(kk)) continue; seen.add(kk); cur.incl.set(kk, (cur.incl.get(kk) || 0) + dt); }
}
if (cur) blocks.push(cur);
const top = (m, n, f) => [...m].filter(([k]) => !f || f(k)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
let out = 0;
for (const b of blocks) {
  if (b.busy < Number(minBusy)) continue; if (out++ >= Number(maxOut)) break;
  console.log(`BLOCK at ${b.start.toFixed(0)}ms len ${(b.end - b.start).toFixed(0)} busy ${b.busy.toFixed(0)}`);
  console.log('   self: ' + top(b.self, 5).join(' | '));
  console.log('   incl: ' + top(b.incl, 8, (k) => appRe.test(k)).join(' | '));
}
console.log('blocks total', blocks.length, 'over min', blocks.filter((b) => b.busy >= Number(minBusy)).length);
