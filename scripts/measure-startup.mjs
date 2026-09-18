// Cold-start measurement of the packaged desktop app: 12 launches per round, the first discarded as
// warm-up, writing results/perf.json for gate-perf. The gated statistic in CI is the floor — the
// minimum of the post-warm-up launches (ADR-0022 Amendment 1) — which is only meaningful if every
// launch is cold, so each launch drops the page cache and gets an unused per-user cache, and a round
// whose floor sits implausibly far below its median is rejected rather than adopted. Requires the app
// to print MARK lines (see apps/desktop). Skips when the binary is missing unless MARXY_PERF_REQUIRED=1.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUNS_N = 12; // launches per round, the first of them the discarded warm-up
export const MIN_USABLE_RUNS = 8; // below this a round has not measured the thing it claims to
export const COLD_FLOOR_RATIO_MAX = 3; // median / floor above this means the launches were not alike
export const LAUNCH_TIMEOUT_MS = 45_000; // above the 31.6 s WebKitGTK warm-up seen on ubuntu-latest
export const SETTLE_MS = 2000;

const root = new URL('../', import.meta.url).pathname;
const isMain = process.argv[1] && process.argv[1].endsWith('measure-startup.mjs');
const round1 = n => (n == null ? null : Math.round(n * 10) / 10);

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : round1((s[mid - 1] + s[mid]) / 2);
}

// `launches` is every launch of a round in launch order, the warm-up first, `null` where the launch
// produced no first_text mark. Every statistic below is over the post-warm-up launches only.
export function summarise(launches, runsN = RUNS_N) {
  const [warmup = null, ...rest] = launches;
  const usable = rest.filter(v => typeof v === 'number');
  const floor_ms = usable.length ? Math.min(...usable) : null;
  const median_ms = median(usable);
  const cold_ratio = floor_ms ? round1(median_ms / floor_ms) : null;
  return {
    runs: rest,
    warmup_ms: warmup,
    floor_ms,
    median_ms,
    runs_n: runsN,
    usable_runs: usable.length,
    cold_ratio,
    cold_plausible: cold_ratio != null && cold_ratio <= COLD_FLOOR_RATIO_MAX,
  };
}

// The reasons a round is not a measurement at all, as opposed to a measurement the gate dislikes.
export function summaryProblems(summary) {
  const problems = [];
  if (summary.usable_runs < MIN_USABLE_RUNS) problems.push(`only ${summary.usable_runs} of ${summary.runs_n - 1} post-warm-up launches produced a first_text mark (need at least ${MIN_USABLE_RUNS})`);
  if (summary.usable_runs && !summary.cold_plausible) problems.push(`floor ${summary.floor_ms} ms is ${summary.cold_ratio}× below the round's median ${summary.median_ms} ms (limit ${COLD_FLOOR_RATIO_MAX}×): the launches were not alike, so the minimum is not a cold floor`);
  return problems;
}

export function perfRecord(summary, { envClass, runnerClass, rounds, coldProtocol }) {
  return {
    floor_ms: summary.floor_ms,
    median_ms: summary.median_ms,
    runs: summary.runs,
    warmup_ms: summary.warmup_ms,
    runs_n: summary.runs_n,
    usable_runs: summary.usable_runs,
    cold_ratio: summary.cold_ratio,
    cold_plausible: summary.cold_plausible,
    cold_protocol: coldProtocol,
    rounds: rounds ?? [],
    platform: process.platform,
    env_class: envClass,
    runner_class: runnerClass,
  };
}

// What makes a launch cold. Whatever the platform allows: the file-system cache that holds the
// binary and its libraries is dropped, and the app gets a per-user cache directory it has never
// seen, so no webview, icon or font cache survives from the previous launch. What is recorded is
// what actually happened — an unavailable eviction is written down, never assumed away.
function dropPageCache() {
  if (process.platform === 'darwin') return spawnSync('sudo', ['-n', 'purge'], { stdio: 'ignore', timeout: 120_000 }).status === 0 ? 'purge' : 'unavailable';
  if (process.platform === 'linux') return spawnSync('sudo', ['-n', 'sh', '-c', 'sync; echo 3 > /proc/sys/vm/drop_caches'], { stdio: 'ignore', timeout: 120_000 }).status === 0 ? 'drop_caches' : 'unavailable';
  return 'unavailable';
}

function freshCaches() {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-cold-'));
  for (const sub of ['cache', 'config', 'data']) mkdirSync(join(dir, sub), { recursive: true });
  return {
    dir,
    env: {
      XDG_CACHE_HOME: join(dir, 'cache'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      XDG_DATA_HOME: join(dir, 'data'),
    },
  };
}

function clearAppCaches() {
  if (process.platform !== 'darwin') return;
  const home = process.env.HOME;
  if (!home) return;
  for (const p of [`${home}/Library/Caches/dev.marxy.app`, `${home}/Library/WebKit/dev.marxy.app`, `${home}/Library/Caches/com.apple.WebKit.WebContent`]) {
    rmSync(p, { recursive: true, force: true });
  }
}

export function findBinary() {
  return [`${root}apps/desktop/src-tauri/target/release/marxy`, `${root}apps/desktop/src-tauri/target/release/marxy.exe`].find(existsSync);
}

async function launchOnce(bin, doc) {
  const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  // The same switches the desktop smoke check uses: on a virtual display WebKitGTK needs 24-bit
  // colour and its DMABUF and compositing paths off, or the window stays blank and no script runs.
  const headlessEnv = headless ? { WEBKIT_DISABLE_DMABUF_RENDERER: '1', WEBKIT_DISABLE_COMPOSITING_MODE: '1', LIBGL_ALWAYS_SOFTWARE: '1' } : {};
  const caches = freshCaches();
  clearAppCaches();
  const [cmd, args] = headless ? ['xvfb-run', ['-a', '--server-args=-screen 0 1280x1024x24', bin, doc]] : [bin, [doc]];
  const env = { ...process.env, ...headlessEnv, ...caches.env, MARXY_QUIT_AFTER_PAINT: '1' };
  const t0 = Date.now();
  const marks = {};
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', d => { buf += d; for (const line of buf.split('\n')) { const m = /^MARK (\S+) (\S+)/.exec(line); if (m) marks[m[1]] = +m[2]; } });
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, LAUNCH_TIMEOUT_MS);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  rmSync(caches.dir, { recursive: true, force: true });
  return marks.first_text ? marks.first_text - t0 : null;
}

// One round of RUNS_N launches. Exported so gate-perf can re-measure a breach in the same job.
export async function measureRound({ bin, doc, runsN = RUNS_N, log = console.log } = {}) {
  const binary = bin ?? findBinary();
  const document = doc ?? `${root}fixtures/corpus/01-long-technical.md`;
  const launches = [];
  let pageCache = 'unavailable';
  for (let i = 0; i < runsN; i++) {
    pageCache = dropPageCache();
    launches.push(await launchOnce(binary, document));
    await new Promise(r => setTimeout(r, SETTLE_MS));
  }
  const summary = summarise(launches, runsN);
  log(`round: warm-up ${summary.warmup_ms ?? 'none'} ms, floor ${summary.floor_ms} ms, median ${summary.median_ms} ms over ${summary.usable_runs} of ${runsN - 1} launches [${summary.runs.join(', ')}]`);
  return { ...summary, cold_protocol: { page_cache: pageCache, app_cache: 'fresh per launch', settle_ms: SETTLE_MS, timeout_ms: LAUNCH_TIMEOUT_MS } };
}

const SELFTEST_LAUNCHES = [5000, 900, 1100, 1000, 1200, 950, 1050, 980, 1020, 1010, 990, 1300];

function selftest() {
  const bad = [];
  const s = summarise(SELFTEST_LAUNCHES);
  const record = perfRecord(s, { envClass: 'ci', runnerClass: 'ubuntu-latest', rounds: [], coldProtocol: {} });
  for (const k of ['runs', 'warmup_ms', 'floor_ms', 'median_ms', 'runs_n', 'usable_runs', 'rounds', 'env_class', 'runner_class']) {
    if (!(k in record)) bad.push(`results/perf.json record is missing ${k}`);
  }
  if (s.floor_ms !== 900) bad.push(`floor over the fixed run list is ${s.floor_ms}, want 900`);
  if (s.median_ms !== 1010) bad.push(`median over the fixed run list is ${s.median_ms}, want 1010`);
  if (s.warmup_ms !== 5000) bad.push(`warm-up is ${s.warmup_ms}, want 5000`);
  if (s.runs.includes(5000)) bad.push('the discarded warm-up launch appears in the recorded runs');
  if (s.runs.join() !== SELFTEST_LAUNCHES.slice(1).join()) bad.push('runs are not in launch order');
  if (s.usable_runs !== 11) bad.push(`usable_runs is ${s.usable_runs}, want 11`);

  // A warm-up that is the fastest launch of the round must not become the floor, and one that is the
  // slowest must not move the median: including it is the bias this round discipline exists to remove.
  const fastWarmup = summarise([100, 900, 1100, 1000, 1200, 950, 1050, 980, 1020, 1010, 990, 1300]);
  if (fastWarmup.floor_ms !== 900) bad.push(`a warm-up faster than every launch became the floor (${fastWarmup.floor_ms})`);
  const slowWarmup = summarise([99_000, 900, 1100, 1000, 1200, 950, 1050, 980, 1020, 1010, 990, 1300]);
  if (slowWarmup.median_ms !== 1010) bad.push(`a warm-up slower than every launch moved the median (${slowWarmup.median_ms})`);

  const thin = summarise([5000, 900, 1000, 1100, 1200, 950, 1050, null, null, null, null, null]);
  if (!summaryProblems(thin).some(p => /post-warm-up launches/.test(p))) bad.push('a round with 6 marked launches was not rejected');
  if (summaryProblems(s).length) bad.push(`the fixed run list was rejected: ${summaryProblems(s).join('; ')}`);

  // The PR #7 shape: one launch 5.3× faster than the rest is not a cold floor, it is a warm launch.
  const warmOutlier = summarise([5000, 2448, 2300, 2500, 2400, 2350, 463, 2420, 2380, 2450, 2410, 2390]);
  if (warmOutlier.cold_plausible) bad.push(`a floor ${warmOutlier.cold_ratio}× below the median was accepted as cold`);
  if (!summaryProblems(warmOutlier).some(p => /not a cold floor/.test(p))) bad.push('an implausibly low floor was not reported as a problem');

  if (median([1, 2, 3, 4]) !== 2.5) bad.push('median of an even list is wrong');

  if (bad.length) { console.error('measure-startup selftest failed:\n - ' + bad.join('\n - ')); process.exit(1); }
  console.log(`measure-startup selftest ok: ${RUNS_N}-launch round, warm-up discarded, floor ${s.floor_ms} ms and median ${s.median_ms} ms over the fixed run list, thin and warm rounds rejected`);
  process.exit(0);
}

if (isMain && process.argv.includes('--selftest')) selftest();

if (isMain) {
  const envClass = process.env.MARXY_PERF_ENV ?? (process.env.CI ? 'ci' : 'reference');
  const runnerClass = process.env.MARXY_RUNNER_CLASS || null;
  const required = process.env.MARXY_PERF_REQUIRED === '1';
  if (!runnerClass && required && envClass === 'ci') { console.error('measure-startup: MARXY_RUNNER_CLASS is unset; set it to a runner class from fixtures/perf-budgets.json'); process.exit(1); }
  const bin = findBinary();
  if (!bin) {
    if (required) { console.error('measure-startup: no binary'); process.exit(1); }
    console.log('measure-startup: no binary; skipping');
    process.exit(0);
  }
  // More than one round is how a baseline's observed_floors_ms are derived on `main`; the gate reads
  // the first round and re-measures for itself when it needs to.
  const roundCount = Math.max(1, Number(process.env.MARXY_PERF_ROUNDS ?? 1));
  const rounds = [];
  for (let i = 0; i < roundCount; i++) {
    process.stdout.write(`round ${i + 1} of ${roundCount}: `);
    rounds.push(await measureRound({ bin }));
  }
  const first = rounds[0];
  const record = perfRecord(first, { envClass, runnerClass, rounds, coldProtocol: first.cold_protocol });
  mkdirSync(`${root}results`, { recursive: true });
  writeFileSync(`${root}results/perf.json`, JSON.stringify(record, null, 2));
  console.log(`observed floors: ${rounds.map(r => r.floor_ms).join(', ')} ms (medians ${rounds.map(r => r.median_ms).join(', ')} ms) over ${roundCount} round(s) of ${RUNS_N} launches (${envClass} mode${runnerClass ? `, ${runnerClass}` : ''}); page cache ${first.cold_protocol.page_cache}`);
  const problems = rounds.flatMap((r, i) => summaryProblems(r).map(p => `round ${i + 1}: ${p}`));
  if (problems.length) { console.error('measure-startup failed:\n - ' + problems.join('\n - ')); process.exit(1); }
}
