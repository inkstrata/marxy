// Cold-start measurement of the packaged desktop app over the corpus's long document, 8 launches,
// writes results/perf.json for gate-perf. Mirrors the spike's startup.mjs. Requires the app to print
// MARK lines (see apps/desktop). Skips gracefully when the binary is missing unless MARXY_PERF_REQUIRED=1.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
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
writeFileSync(`${root}results/perf.json`, JSON.stringify({ cold_start_first_text_ms: median, runs, platform: process.platform }, null, 2));
console.log(`cold start median ${median} ms over ${runs.length} runs`);
