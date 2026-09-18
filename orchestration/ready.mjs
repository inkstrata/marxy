// Stories that can start now: deps done, paths disjoint from in-progress work.
// A positive `lanes` cap is honoured; null / 0 means uncapped (path overlap is the only limit).
import { state, stories, deps, pathsOf, overlap, laneBudget } from './lib.mjs';
const s = state(), d = deps(), all = stories();
const done = k => s.stories[k]?.status === 'done';
const busy = all.filter(st => s.stories[st.Key]?.status === 'in_progress');
const busyPaths = busy.flatMap(pathsOf);
const cap = laneBudget();
const uncapped = !Number.isFinite(cap);
const free = uncapped ? Infinity : Math.max(0, cap - busy.length);
const candidates = all.filter(st => { const cur = s.stories[st.Key]?.status ?? 'todo'; if (cur !== 'todo') return false; return (d.deps[st.Key] ?? []).every(done); })
  .filter(st => !overlap(pathsOf(st), busyPaths));
const picked = []; const pickedPaths = [];
for (const st of candidates) { if (picked.length >= free) break; if (overlap(pathsOf(st), pickedPaths)) continue; picked.push(st); pickedPaths.push(...pathsOf(st)); }
console.log(JSON.stringify({ lanes: uncapped ? 'uncapped' : cap, lanesFree: uncapped ? null : free, inProgress: busy.map(b => b.Key), ready: picked.map(p => ({ key: p.Key, summary: p.Summary, paths: p.Paths })), waitingOnDeps: candidates.length - picked.length }, null, 2));
