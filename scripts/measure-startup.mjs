// Startup measurement of the packaged desktop app, writing results/perf.json for gate-perf. Two
// quantities under two names (ADR-0022 Amendment 1): `cold_start_first_text_ms` is launch 1 and only
// launch 1, `warm_start_first_text_ms` is the median of launches 2..N. The raw sample is never
// sorted, because every statement about which launch is which depends on launch order surviving.
// Each launch records its own exit code and stderr so a launch that produces no mark can be
// diagnosed instead of dropped. Skips when the binary is missing unless MARXY_PERF_REQUIRED=1.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export const RUNS_N = 9; // one cold launch and eight warm ones: the warm median needs at least 8
export const MIN_WARM_RUNS = 8;
// WebKitGTK's first run under Xvfb was measured at 30.7 s between main_start and script_start
// (MARXY-13); the old 15 s cap killed every launch that paid it and silently dropped the sample.
export const LAUNCH_TIMEOUT_MS = 60_000;
export const SETTLE_MS = 2000;
// What "cold" actually means here, recorded rather than implied — and stated no more strongly than
// the procedure earns. Nothing evicts the page cache: a drop-caches launch would be colder than any
// reader's, which is a third quantity to misname. Nor does this script own the whole job: the
// desktop build step runs the CLI smoke check, which launches the app several times seconds before
// launch 1, so on CI the webview framework is warm before the "cold" launch starts. When that
// happens `cold_warm_ratio` falls below 1 and the number is not a cold start at all. A genuinely
// cold round is MARXY-69's reference procedure; this string exists so no reader of the record has to
// guess which of the two they are holding.
export const COLD_PROCEDURE = 'process-cold only: launch 1 is the first launch of this binary by this script, with no marxy process running when it starts. Earlier steps in the same job may have launched the app already — the desktop build step runs the CLI smoke check — so the webview framework may be warm; cold_warm_ratio below 1 means it was. The runner\'s page, dyld and font caches are left as they are, so this is neither a reader\'s cold start nor a drop-caches one.';

const root = new URL('../', import.meta.url).pathname;
const isMain = process.argv[1]?.endsWith('measure-startup.mjs') ?? false;
const RECORD_KEYS = ['cold_start_first_text_ms', 'warm_start_first_text_ms', 'warm_runs', 'warm_runs_n', 'runs_n', 'usable_runs', 'cold_warm_ratio', 'cold_procedure', 'env_class', 'runner_class'];

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); // a copy: the sample itself keeps launch order
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

// `launches` is every attempted launch in launch order. Launch 1 is the only cold one; the median
// of the rest is the change detector. Neither statistic is allowed to borrow from the other.
export function summarise(launches, runsN = RUNS_N) {
  const runs = launches.map(l => l.ms);
  const warm_runs = runs.slice(1).filter(v => typeof v === 'number');
  const cold = typeof runs[0] === 'number' ? runs[0] : null;
  const warm = median(warm_runs);
  return {
    runs,
    cold_start_first_text_ms: cold,
    warm_start_first_text_ms: warm,
    warm_runs,
    warm_runs_n: warm_runs.length,
    runs_n: runsN,
    usable_runs: runs.filter(v => typeof v === 'number').length,
    cold_warm_ratio: cold != null && warm ? Math.round((cold / warm) * 100) / 100 : null,
  };
}

export function perfRecord(summary, { envClass, runnerClass, coldProcedure = COLD_PROCEDURE, launches = [] }) {
  return {
    cold_start_first_text_ms: summary.cold_start_first_text_ms,
    warm_start_first_text_ms: summary.warm_start_first_text_ms,
    cold_warm_ratio: summary.cold_warm_ratio,
    cold_procedure: coldProcedure,
    runs: summary.runs,
    warm_runs: summary.warm_runs,
    warm_runs_n: summary.warm_runs_n,
    runs_n: summary.runs_n,
    usable_runs: summary.usable_runs,
    launches,
    platform: process.platform,
    env_class: envClass,
    runner_class: runnerClass,
  };
}

// What has to be true of a record for its two names to mean what they say. The gate has its own,
// separate question — whether the record is sufficient to gate on — and asks it in gate-perf.
export function recordProblems(record) {
  const problems = [];
  for (const k of RECORD_KEYS) if (!(k in record)) problems.push(`the record is missing ${k}`);
  const runs = record.runs;
  if (!Array.isArray(runs)) return [...problems, 'the record carries no runs array'];
  const marked = runs.filter(v => typeof v === 'number');
  // The launches array is the evidence that runs is launch order: a sorted sample no longer matches
  // the launches it claims to be, and the cold/warm split is meaningless once order is lost.
  if (Array.isArray(record.launches) && record.launches.length && !runsMatchLaunchOrder(record, record.launches)) {
    problems.push(`runs ${JSON.stringify(runs)} is not the launches in launch order ${JSON.stringify(record.launches.map(l => l.ms))}; the raw sample must never be sorted`);
  }
  if (record.cold_start_first_text_ms !== (typeof runs[0] === 'number' ? runs[0] : null)) problems.push(`cold_start_first_text_ms ${record.cold_start_first_text_ms} is not launch 1 (${runs[0]}); the cold metric may never hold a statistic over more than launch 1`);
  const warmOnly = median(runs.slice(1).filter(v => typeof v === 'number'));
  const withCold = median(marked);
  if (record.warm_start_first_text_ms !== warmOnly) {
    problems.push(record.warm_start_first_text_ms === withCold && withCold !== warmOnly
      ? `warm_start_first_text_ms ${record.warm_start_first_text_ms} is the median of every launch including launch 1; it is the median of launches 2..N (${warmOnly})`
      : `warm_start_first_text_ms ${record.warm_start_first_text_ms} is not the median of launches 2..N (${warmOnly})`);
  }
  if (record.warm_runs_n !== record.warm_runs?.length) problems.push(`warm_runs_n ${record.warm_runs_n} does not count warm_runs (${record.warm_runs?.length})`);
  if (record.usable_runs !== marked.length) problems.push(`usable_runs ${record.usable_runs} does not count the launches that produced a mark (${marked.length})`);
  if (record.usable_runs < record.runs_n) problems.push(`${record.usable_runs} of ${record.runs_n} launches produced a first_text mark; the launches that did not are in the launches array with their exit code and stderr`);
  if (!record.cold_procedure) problems.push('cold_procedure is empty; a record must say what made launch 1 cold, and "process-cold only" is a legitimate answer');
  return problems;
}

// A launch order that has been sorted is undetectable after the fact, so the check is made where the
// evidence still exists: the runs array must be the launches array's ms values, in order.
export function runsMatchLaunchOrder(record, launches) {
  const inOrder = launches.map(l => l.ms);
  return record.runs.length === inOrder.length && record.runs.every((v, i) => v === inOrder[i]);
}

export function findBinary() {
  // MARXY_BIN names the binary explicitly (CI builds with `--profile ci`, docs/hygiene.md §CI); the
  // release path stays the default for a person running this by hand.
  return [process.env.MARXY_BIN, `${root}apps/desktop/src-tauri/target/ci/marxy`, `${root}apps/desktop/src-tauri/target/release/marxy`, `${root}apps/desktop/src-tauri/target/release/marxy.exe`].filter(Boolean).find(existsSync);
}

const hasDbusRunSession = () => process.platform === 'linux' && spawnSync('sh', ['-c', 'command -v dbus-run-session'], { stdio: 'ignore' }).status === 0;

// A headless Linux launch needs three things it does not get for free, and the third is why seven
// launches in eight used to be thrown away. A virtual display: xvfb-run's own default screen is
// 8-bit, and WebKitGTK wants 24-bit colour with its DMABUF and compositing paths off — the same
// switches the MARXY-13 smoke check uses. And **a D-Bus session bus**: without one, the GTK/WebKit
// startup path blocks for about 30 s before the webview runs a single line of script (measured:
// 30.9 s with no bus, 0.9 s with one, on the same runner and commit). Every reader's desktop has a
// session bus, so a measurement taken without one is mostly a timeout, not this application.
export function linuxLaunch(bin, doc, { dbus = hasDbusRunSession(), platform = process.platform, display = process.env.DISPLAY || process.env.WAYLAND_DISPLAY } = {}) {
  const headless = platform === 'linux' && !display;
  if (!headless) return { cmd: bin, args: [doc], env: {} };
  const app = dbus ? ['dbus-run-session', '--', bin, doc] : [bin, doc];
  return {
    cmd: 'xvfb-run',
    args: ['-a', '--server-args=-screen 0 1280x1024x24', ...app],
    env: { WEBKIT_DISABLE_DMABUF_RENDERER: '1', WEBKIT_DISABLE_COMPOSITING_MODE: '1', LIBGL_ALWAYS_SOFTWARE: '1' },
  };
}

async function launchOnce(bin, doc, index) {
  const { cmd, args, env: launchEnv } = linuxLaunch(bin, doc);
  const t0 = Date.now();
  const marks = {};
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...launchEnv, MARXY_QUIT_AFTER_PAINT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  let timedOut = false;
  const exit_code = await new Promise(resolve => {
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, LAUNCH_TIMEOUT_MS);
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  for (const line of out.split('\n')) { const m = /^MARK (\S+) (\S+)/.exec(line); if (m) marks[m[1]] = Number(m[2]); }
  const ms = marks.first_text ? marks.first_text - t0 : null;
  return {
    index,
    ms,
    ok: ms != null,
    exit_code: timedOut ? null : exit_code,
    stderr_tail: err.trim().split('\n').slice(-3).join(' | ').slice(-400),
    elapsed_ms: Date.now() - t0,
    timed_out: timedOut,
    // How long the webview took to run any script at all: the quantity that made the old 15 s cap
    // drop seven launches in eight on ubuntu-latest.
    webview_start_ms: marks.main_start && marks.script_start ? Math.round(marks.script_start - marks.main_start) : null,
  };
}

export async function measureLaunches({ bin, doc, runsN = RUNS_N, log = console.log } = {}) {
  const binary = bin ?? findBinary();
  const document = doc ?? `${root}fixtures/corpus/01-long-technical.md`;
  const launches = [];
  for (let i = 0; i < runsN; i++) {
    const launch = await launchOnce(binary, document, i + 1);
    log(`launch ${launch.index}${launch.index === 1 ? ' (cold)' : ''}: ${launch.ok ? `${launch.ms} ms` : 'no first_text mark'}, exit ${launch.timed_out ? `killed after ${LAUNCH_TIMEOUT_MS} ms` : launch.exit_code}, webview start ${launch.webview_start_ms ?? '?'} ms${launch.stderr_tail ? `, stderr: ${launch.stderr_tail}` : ''}`);
    launches.push(launch);
    if (i + 1 < runsN) await new Promise(r => setTimeout(r, SETTLE_MS));
  }
  return launches;
}

// One synthetic round in launch order: launch 1 slow and cold, the warm cluster unsorted after it.
const SYNTHETIC = [2400, 900, 1100, 1000, 1200, 950, 1050, 980, 1020].map((ms, i) => ({ index: i + 1, ms, ok: true, exit_code: 0, stderr_tail: '' }));

export const SELFTEST_CASE_NAMES = [
  'record: a record missing any required key is rejected',
  'warm: warm_start_first_text_ms is the median of launches 2..N',
  'warm: launch 1 inside the warm statistic is rejected',
  'cold: cold_start_first_text_ms is launch 1 and only launch 1',
  'order: a runs array written in sorted order is rejected',
  'usable_runs: fewer marks than launches is rejected',
  'launches: every attempted launch is recorded with its exit code and stderr',
  'linux: a headless launch gets a 24-bit screen, the WebKit switches and a session bus',
  'required: a required run with no MARXY_RUNNER_CLASS exits 1',
];

async function selftest() {
  let bad = 0;
  const report = (ok, name, detail) => { if (ok) console.log(`selftest ok: ${name}`); else { bad++; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); } };
  const base = () => perfRecord(summarise(SYNTHETIC), { envClass: 'ci', runnerClass: 'ubuntu-latest', launches: SYNTHETIC });

  const missing = RECORD_KEYS.map(k => { const r = base(); delete r[k]; return [k, recordProblems(r).some(p => p.includes(k))]; });
  report(missing.every(([, caught]) => caught), SELFTEST_CASE_NAMES[0], missing.filter(([, c]) => !c).map(([k]) => k).join(', '));

  const good = base();
  // The warm median of 900, 1100, 1000, 1200, 950, 1050, 980, 1020 is 1010; including launch 1
  // would make it 1020, which is the mistake the previous script made under a different name.
  report(good.warm_start_first_text_ms === 1010 && recordProblems(good).length === 0, SELFTEST_CASE_NAMES[1], `warm ${good.warm_start_first_text_ms}, problems ${recordProblems(good).join('; ')}`);

  const warmWithCold = { ...base(), warm_start_first_text_ms: median(SYNTHETIC.map(l => l.ms)) };
  report(recordProblems(warmWithCold).some(p => /including launch 1/.test(p)), SELFTEST_CASE_NAMES[2], `median including launch 1 is ${warmWithCold.warm_start_first_text_ms}`);

  const coldOk = base().cold_start_first_text_ms === 2400;
  const coldWrong = recordProblems({ ...base(), cold_start_first_text_ms: 1010 }).some(p => /is not launch 1/.test(p));
  report(coldOk && coldWrong, SELFTEST_CASE_NAMES[3], `cold ${base().cold_start_first_text_ms}, a median passed as cold was ${coldWrong ? 'caught' : 'accepted'}`);

  const sorted = { ...base(), runs: [...SYNTHETIC.map(l => l.ms)].sort((a, b) => a - b) };
  report(recordProblems(sorted).some(p => /must never be sorted/.test(p)) && runsMatchLaunchOrder(base(), SYNTHETIC), SELFTEST_CASE_NAMES[4], 'a sorted runs array was accepted as launch order');

  const dropped = SYNTHETIC.map((l, i) => (i > 5 ? { ...l, ms: null, ok: false, exit_code: null, stderr_tail: 'killed' } : l));
  const thin = perfRecord(summarise(dropped), { envClass: 'ci', runnerClass: 'ubuntu-latest', launches: dropped });
  report(recordProblems(thin).some(p => /launches produced a first_text mark/.test(p)), SELFTEST_CASE_NAMES[5], `usable ${thin.usable_runs} of ${thin.runs_n}`);

  const recorded = thin.launches.every(l => 'index' in l && 'ms' in l && 'ok' in l && 'exit_code' in l && 'stderr_tail' in l) && thin.launches.length === SYNTHETIC.length;
  report(recorded, SELFTEST_CASE_NAMES[6], 'a launch that produced no mark is missing from the launches array');

  // The launch that used to be thrown away: without a session bus the webview stalls ~30 s, which
  // the old 15 s kill turned into "no mark", so the composition of this command line is a check.
  const headlessArgs = linuxLaunch('/bin/marxy', '/doc.md', { platform: 'linux', display: undefined, dbus: true });
  const desktopArgs = linuxLaunch('/bin/marxy', '/doc.md', { platform: 'linux', display: ':0', dbus: true });
  const noBus = linuxLaunch('/bin/marxy', '/doc.md', { platform: 'linux', display: undefined, dbus: false });
  report(
    headlessArgs.cmd === 'xvfb-run'
      && headlessArgs.args.join(' ') === '-a --server-args=-screen 0 1280x1024x24 dbus-run-session -- /bin/marxy /doc.md'
      && Object.keys(headlessArgs.env).sort().join() === 'LIBGL_ALWAYS_SOFTWARE,WEBKIT_DISABLE_COMPOSITING_MODE,WEBKIT_DISABLE_DMABUF_RENDERER'
      && desktopArgs.cmd === '/bin/marxy'
      && !noBus.args.includes('dbus-run-session'),
    SELFTEST_CASE_NAMES[7],
    `headless launch was ${headlessArgs.cmd} ${headlessArgs.args.join(' ')}`,
  );

  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, MARXY_PERF_REQUIRED: '1', MARXY_PERF_ENV: 'ci', MARXY_RUNNER_CLASS: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(r => child.on('exit', r));
  report(code === 1 && /MARXY_RUNNER_CLASS/.test(stderr), SELFTEST_CASE_NAMES[8], `exited ${code} saying ${JSON.stringify(stderr.trim())}`);

  if (bad) { console.error(`measure-startup selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`measure-startup selftest ok: ${SELFTEST_CASE_NAMES.length} named cases`);
  process.exit(0);
}

if (isMain && process.argv.includes('--selftest')) await selftest();

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
  const launches = await measureLaunches({ bin });
  const record = perfRecord(summarise(launches), { envClass, runnerClass, launches });
  mkdirSync(`${root}results`, { recursive: true });
  writeFileSync(`${root}results/perf.json`, JSON.stringify(record, null, 2));
  console.log(`cold start (launch 1) ${record.cold_start_first_text_ms} ms; warm start (median of launches 2..${record.runs_n}) ${record.warm_start_first_text_ms} ms over ${record.warm_runs_n} launches; cold/warm ${record.cold_warm_ratio}× (${envClass} mode${runnerClass ? `, ${runnerClass}` : ''})`);
  console.log(`cold procedure: ${record.cold_procedure}`);
  const problems = recordProblems(record);
  // A round that measured less than it claims is a failure here as well as at the gate: a script
  // that exits 0 having written an empty sample is how a measurement disappears unnoticed.
  if (problems.length) { console.error('measure-startup failed:\n - ' + problems.join('\n - ')); process.exit(1); }
}
