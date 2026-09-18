// Performance budgets as hard failures (ADR-0013). Reads fixtures/perf-budgets.json and results/perf.json
// (written by scripts/measure-startup.mjs on the packaged app). Missing results fail when MARXY_PERF_REQUIRED=1.
import { readFileSync, existsSync } from 'node:fs';
const budgets = JSON.parse(readFileSync(new URL('../fixtures/perf-budgets.json', import.meta.url), 'utf8'));
const p = new URL('../results/perf.json', import.meta.url);
if (!existsSync(p)) { if (process.env.MARXY_PERF_REQUIRED === '1') { console.error('perf gate: results/perf.json missing'); process.exit(1); } console.log('perf gate: no results yet (app not built); budgets loaded'); process.exit(0); }
const r = JSON.parse(readFileSync(p, 'utf8')); const fails = [];
const check = (k, v) => { if (v == null) return; if (v > budgets[k]) fails.push(`${k}: ${v} ms > ${budgets[k]} ms`); else console.log(`${k}: ${v} ms ≤ ${budgets[k]} ms`); };
check('cold_start_first_text_ms', r.cold_start_first_text_ms);
for (const k of ['open_indexed_document_ms', 'palette_keystroke_ms', 'typeset_viewport_ms', 'live_reload_ms', 'find_first_match_ms']) check(k, r[k]);
if (fails.length) { console.error('perf gate failed:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('perf gate ok');
