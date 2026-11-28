// usage: set FILE and ACTION via env-less constants below
export const profile = async (page, fn) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map(); const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + dt[i]));
  const incl = new Map();
  for (const [id, t] of self) { const seen = new Set(); let c = id; while (c !== undefined) { const f = byId.get(c).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); } c = parent.get(c); } }
  return [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !/\(root\)|\(program\)|\(idle\)/.test(k)).slice(0, 70).map(([k, t]) => `${Math.round(t / 1000)}ms ${k}`).join('\n');
};
