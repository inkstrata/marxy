// Appends a perf summary table to the GitHub job summary so a person reads the numbers without opening logs.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
const p = new URL('../results/perf.json', import.meta.url);
if (!existsSync(p) || !process.env.GITHUB_STEP_SUMMARY) process.exit(0);
const r = JSON.parse(readFileSync(p, 'utf8'));
const rows = [['cold (launch 1)', r.cold_start_first_text_ms], ['warm median (2..N)', r.warm_start_first_text_ms], ['cold/warm', r.cold_warm_ratio], ['usable launches', `${r.usable_runs}/${r.runs_n}`], ['runner class', r.runner_class]];
appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Startup (${r.env_class})\n\n| metric | value |\n| --- | --- |\n${rows.map(([k, v]) => `| ${k} | ${v ?? '—'} |`).join('\n')}\n\nLaunches: ${(r.runs || []).map(v => v ?? '×').join(', ')} ms\n\n`);
