// Cold-start measurement of the packaged desktop app over the corpus's long document, 8 launches,
// writes results/perf.json for gate-perf. Mirrors the spike's startup.mjs. Requires the app to print
// MARK lines (see apps/desktop). Skips gracefully when the binary is missing unless MARXY_PERF_REQUIRED=1.
// Records which tier the measurement belongs to (ADR-0022) so gate-perf can never compare a number
// taken on a rented runner against a product budget.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const envClass = process.env.MARXY_PERF_ENV ?? (process.env.CI ? 'ci' : 'reference');
const runnerClass = process.env.MARXY_RUNNER_CLASS || null;
const perfRecord = (median, runs) => ({ cold_start_first_text_ms: median, runs, platform: process.platform, env_class: envClass, runner_class: runnerClass });

// `--selftest` checks the two things about this script that gate-perf depends on, without launching
// the app: the record carries the tier fields, and a required run with no runner class fails.
if (process.argv.includes('--selftest')) {
  const bad = [];
  const record = perfRecord(123, [123]);
  for (const k of ['cold_start_first_text_ms', 'runs', 'platform', 'env_class', 'runner_class']) {
    if (!(k in record)) bad.push(`results/perf.json record is missing ${k}`);
  }
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, MARXY_PERF_REQUIRED: '1', MARXY_RUNNER_CLASS: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(r => child.on('exit', r));
  if (code !== 1 || !/MARXY_RUNNER_CLASS/.test(stderr)) bad.push(`MARXY_PERF_REQUIRED=1 with no MARXY_RUNNER_CLASS exited ${code} (want 1) saying ${JSON.stringify(stderr.trim())}`);
  if (bad.length) { console.error('measure-startup selftest failed:\n - ' + bad.join('\n - ')); process.exit(1); }
  console.log('measure-startup selftest ok: record carries env_class and runner_class; a required run without MARXY_RUNNER_CLASS exits 1');
  process.exit(0);
}

if (!runnerClass && process.env.MARXY_PERF_REQUIRED === '1') { console.error('measure-startup: MARXY_RUNNER_CLASS is unset; set it to a runner class from fixtures/perf-budgets.json'); process.exit(1); }
const candidates = [`${root}apps/desktop/src-tauri/target/release/marxy`, `${root}apps/desktop/src-tauri/target/release/marxy.exe`];
const bin = candidates.find(existsSync);
if (!bin) { if (process.env.MARXY_PERF_REQUIRED === '1') { console.error('measure-startup: no binary'); process.exit(1); } console.log('measure-startup: no binary; skipping'); process.exit(0); }
const doc = `${root}fixtures/corpus/01-long-technical.md`; const runs = [];
const env = { ...process.env, MARXY_QUIT_AFTER_PAINT: '1' };
const prefix = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a'] : [];
for (let i = 0; i < 8; i++) {
  const t0 = Date.now(); const marks = {};
  const [cmd, ...pre] = prefix.length ? prefix : [bin];
  const child = spawn(cmd, prefix.length ? [...pre, bin, doc] : [doc], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', d => { buf += d; for (const line of buf.split('\n')) { const m = /^MARK (\S+) (\S+)/.exec(line); if (m) marks[m[1]] = +m[2]; } });
  await new Promise(r => { child.on('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 15000); });
  if (marks.first_text) runs.push(marks.first_text - t0);
  await new Promise(r => setTimeout(r, 2000));
}
runs.sort((a, b) => a - b);
const median = runs[Math.floor(runs.length / 2)] ?? null;
mkdirSync(`${root}results`, { recursive: true });
writeFileSync(`${root}results/perf.json`, JSON.stringify(perfRecord(median, runs), null, 2));
console.log(`cold start median ${median} ms over ${runs.length} runs (${envClass} mode${runnerClass ? `, ${runnerClass}` : ''})`);
