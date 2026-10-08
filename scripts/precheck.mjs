// One command before a PR: CI's `fast` job, for what you touched. Maps the changed paths to steps
// (typecheck/lint/test per package, the node-only gates, `pnpm check`), runs them in parallel with a
// timeout each, writes each step's output to results/precheck/<step>.log, and prints one timed summary
// on every way out: completion, SIGINT, SIGTERM, an uncaught error.
//
// No browser by default: package tests run with PLAYWRIGHT_BROWSERS_PATH pointing at an empty directory,
// so the `!existsSync(webkit.executablePath())` skip in the browser tests triggers exactly as it does in
// CI's `fast`. `--browser` turns the browsers back on; `--all` is the slow path (every package, browsers,
// every gate).
//
// usage: pnpm precheck [--all] [--browser] [--timeout <seconds>] [--jobs <n>] [--files <a,b,...>]
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { createWriteStream, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, changedFiles } from './lib/repo.mjs';
import { failingTests } from './lib/failing-tests.mjs';

export const PACKAGES = ['packages/core', 'packages/theme', 'packages/typeset', 'packages/shell-api', 'apps/desktop'];
export const DEFAULT_TIMEOUT_S = 5 * 60;
export const BROWSER_TIMEOUT_S = 30 * 60; // the full desktop suite in WebKit takes about eleven minutes
const KILL_GRACE_MS = 2000;

// Gates are `pnpm -s <name>` unless named here.
const GATE_COMMANDS = {
  'fmt:rust': { cmd: 'cargo', args: ['fmt', '--check'], cwd: 'apps/desktop/src-tauri' },
  'clippy:rust': { cmd: 'cargo', args: ['clippy', '--locked', '--quiet', '--', '-D', 'warnings'], cwd: 'apps/desktop/src-tauri' },
  'scripts:test': { cmd: 'sh', args: ['-c', 'node --test scripts/lib/*.test.mjs scripts/*.test.mjs'] },
};

const DOCS_ONLY = /^(docs\/|changelog\.d\/|.*\.md$)/;
// A change to one of these can move any package, so every package runs.
const EVERY_PACKAGE = /^(package\.json|pnpm-workspace\.yaml|tsconfig[^/]*|biome\.jsonc?)$/;
const SPECIAL_KEYS = new Set(['always', 'all']);

const matchesKey = (f, key) => key.startsWith('**/')
  ? f === key.slice(3) || f.endsWith(key.slice(2))
  : f === key || f.startsWith(key.replace(/\/$/, '') + '/');

/**
 * The steps a change calls for. Pure: files in, steps out.
 * `map` is scripts/gates-by-path.json: path prefix (or `**` + basename) to gate names, plus `always` and
 * `all` (the extra slow gates only `--all` runs). A step is { name, cmd, args, cwd?, browsers? }, and
 * `browsers: true` marks a package test that would launch WebKit if it were installed.
 */
export function planSteps(files, { all = false, packages = PACKAGES, map = {} } = {}) {
  const pkgs = new Set();
  const gates = new Set(map.always ?? ['check']);
  let scripts = false;
  let code = false; // anything that is not prose
  let fleet = false;
  if (all) {
    packages.forEach(p => pkgs.add(p));
    for (const v of Object.values(map)) if (Array.isArray(v)) v.forEach(g => gates.add(g));
    scripts = true; code = true;
  } else {
    for (const f of files) {
      if (!DOCS_ONLY.test(f)) code = true;
      const p = /^(packages\/[^/]+|apps\/[^/]+)/.exec(f);
      // the Rust crate is not a pnpm package: it has its own gates, not the desktop app's tests
      if (p && packages.includes(p[1]) && !f.startsWith('apps/desktop/src-tauri/')) pkgs.add(p[1]);
      if (EVERY_PACKAGE.test(f)) packages.forEach(x => pkgs.add(x));
      if (f.startsWith('scripts/')) scripts = true;
      if (f.startsWith('orchestration/')) fleet = true;
      for (const [key, g] of Object.entries(map)) if (!key.startsWith('_') && !SPECIAL_KEYS.has(key) && matchesKey(f, key)) g.forEach(x => gates.add(x));
    }
  }
  if (fleet) gates.add('test:fleet');
  if (scripts) gates.add('scripts:test');

  const steps = [];
  const order = packages.filter(p => pkgs.has(p));
  // slowest first, so the long pole starts at once: package tests, then gates, then the quick static steps
  for (const p of [...order].reverse()) {
    steps.push({ name: `${p} test`, cmd: 'pnpm', args: ['--filter', `./${p}`, 'test'], browsers: true });
    if (p === 'apps/desktop') steps.push({ name: `${p} test:mutations`, cmd: 'pnpm', args: ['--filter', `./${p}`, 'test:mutations'] });
  }
  for (const g of gates) if (g !== 'check') steps.push({ name: g, ...(GATE_COMMANDS[g] ?? { cmd: 'pnpm', args: ['-s', g] }) });
  for (const p of order) {
    steps.push({ name: `${p} typecheck`, cmd: 'pnpm', args: ['--filter', `./${p}`, 'typecheck'] });
    steps.push({ name: `${p} lint`, cmd: 'pnpm', args: ['--filter', `./${p}`, 'lint'] });
  }
  if (code) steps.push({ name: 'biome (root)', cmd: 'pnpm', args: ['exec', 'biome', 'check', '.'] });
  if (gates.has('check')) steps.push({ name: 'check', cmd: 'pnpm', args: ['-s', 'check'] });
  return steps;
}

export function parseArgs(argv) {
  const opt = { all: false, browser: false, timeoutS: null, jobs: null, files: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opt.all = true;
    else if (a === '--browser') opt.browser = true;
    else if (a === '--timeout') opt.timeoutS = Number(argv[++i]);
    else if (a === '--jobs') opt.jobs = Number(argv[++i]);
    else if (a === '--files') opt.files = String(argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  if (opt.timeoutS !== null && !(opt.timeoutS > 0)) throw new Error('--timeout takes a number of seconds');
  if (opt.jobs !== null && !(opt.jobs >= 1)) throw new Error('--jobs takes a number of at least 1');
  return opt;
}

const fmtSecs = ms => `${(ms / 1000).toFixed(1)}s`;
const MARK = { ok: '✓', failed: '✗', timeout: '✗', killed: '✗', 'not run': '✗' };
const LABEL = { ok: '', failed: '', timeout: ' timed out', killed: ' killed', 'not run': ' not run' };

/** The one summary. `rows` are { name, status, ms, tail }; it is called on every exit path. */
export function formatSummary(rows, { wallMs, browsers = false, interrupted = null, logDir = 'results/precheck' } = {}) {
  const out = [''];
  const width = Math.max(0, ...rows.map(r => r.name.length));
  for (const r of rows) {
    const time = r.status === 'not run' ? '' : fmtSecs(r.ms ?? 0);
    out.push(`${MARK[r.status]} ${r.name.padEnd(width)}  ${time}${LABEL[r.status]}`.trimEnd());
  }
  for (const r of rows.filter(x => x.status === 'failed' && x.tail)) out.push('', `${r.name}:`, `      ${r.tail}`);
  const bad = rows.filter(r => r.status !== 'ok');
  out.push('');
  if (interrupted) out.push(`precheck: interrupted by ${interrupted}; ${rows.filter(r => r.status === 'killed').length} step(s) killed`);
  out.push(`precheck: ${rows.length - bad.length}/${rows.length} passed in ${fmtSecs(wallMs)}`);
  if (!browsers) out.push('WebKit tests were skipped (as in CI\'s `fast`); `pnpm precheck --browser` runs them for the packages you touched.');
  if (bad.length) out.push(`output of each step: ${logDir}/<step>.log; run a failing step alone for full output`);
  return out.join('\n');
}

const slug = name => name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The real step runner: its own process group (so a signal reaches everything the step started, not just
 * pnpm), output to a log file, abort kills the group. Resolves, never rejects: { code, output }.
 */
export function spawnStep(step, { signal, cwd = ROOT, env = process.env, logFile = null }) {
  return new Promise(resolve => {
    let output = '';
    const log = logFile ? createWriteStream(logFile) : null;
    const child = spawn(step.cmd, step.args, { cwd: step.cwd ? join(cwd, step.cwd) : cwd, env: { ...env, ...step.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = d => { log?.write(d); output = (output + d).slice(-400_000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const killGroup = sig => { try { process.kill(-child.pid, sig); } catch { /* group already gone */ } };
    const onAbort = () => { killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS).unref(); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', e => { output += String(e); });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      killGroup('SIGKILL'); // anything the step left behind in its group
      log?.end();
      resolve({ code: code ?? 1, output });
    });
  });
}

/**
 * Runs the plan and returns the exit code. `runner(step, { signal, logFile })` resolves { code, output }
 * and must stop the step when `signal` aborts; the timeout, the signal handling and the summary live here,
 * not in the runner, so a stub runner exercises them. `proc` is where signals arrive.
 */
export async function runPrecheck(steps, {
  runner = spawnStep, proc = process, out = s => console.log(s), now = Date.now,
  jobs = availableParallelism(), timeoutMs = DEFAULT_TIMEOUT_S * 1000, browsers = false,
  noBrowsersDir = join(tmpdir(), 'marxy-precheck-no-browsers'), logDir = join(ROOT, 'results/precheck'), graceMs = 3000,
} = {}) {
  const t0 = now();
  const rows = steps.map(s => ({ name: s.name, status: 'not run', ms: 0, tail: '' }));
  let interrupted = null;
  const running = new Set(); // { controller, reason }
  if (!browsers) mkdirSync(noBrowsersDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  out(`precheck: ${steps.length} step(s), ${Math.max(1, Math.min(jobs, steps.length))} at a time, ${fmtSecs(timeoutMs)} timeout each, logs in results/precheck/`);

  const runOne = async i => {
    const step = steps[i];
    const entry = { controller: new AbortController(), reason: null };
    running.add(entry);
    const env = { ...step.env };
    if (step.browsers && !browsers) { env.PLAYWRIGHT_BROWSERS_PATH = noBrowsersDir; env.MARXY_BROWSER_TESTS_REQUIRED = '0'; }
    const start = now();
    rows[i].status = 'killed'; // until it says otherwise: a kill from outside leaves it so
    const timer = setTimeout(() => { entry.reason ??= 'timeout'; entry.controller.abort(); }, timeoutMs);
    timer.unref();
    let result;
    try {
      const run = runner({ ...step, env }, { signal: entry.controller.signal, logFile: join(logDir, `${slug(step.name)}.log`) });
      // a runner that ignores the abort must not hold the summary hostage
      const grace = new Promise(res => entry.controller.signal.addEventListener('abort', () => setTimeout(() => res(null), graceMs).unref(), { once: true }));
      result = await Promise.race([run, grace]);
    } catch (e) {
      result = { code: 1, output: String(e?.stack ?? e) };
    }
    clearTimeout(timer);
    running.delete(entry);
    rows[i].ms = now() - start;
    if (entry.reason === 'timeout') rows[i].status = 'timeout';
    else if (interrupted || result === null || entry.controller.signal.aborted) rows[i].status = 'killed';
    else if (result.code === 0) rows[i].status = 'ok';
    else {
      rows[i].status = 'failed';
      const named = failingTests(result.output ?? '');
      rows[i].tail = (named.length ? named.map(n => `✖ ${n}`) : String(result.output ?? '').trim().split('\n').filter(Boolean).slice(-6)).join('\n      ');
    }
    if (!interrupted) out(`${MARK[rows[i].status]} ${step.name}  ${fmtSecs(rows[i].ms)}${LABEL[rows[i].status]}`);
  };

  const queue = steps.map((_, i) => i);
  const worker = async () => { while (queue.length && !interrupted) await runOne(queue.shift()); };
  const pool = Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, steps.length)) }, worker));

  let finish;
  const interruptedRun = new Promise(r => { finish = r; });
  const stopEverything = why => {
    if (interrupted) return;
    interrupted = why;
    for (const e of running) { e.reason ??= 'signal'; e.controller.abort(); }
    // wait for the killed steps to settle (bounded), then report
    Promise.race([pool, new Promise(r => setTimeout(r, graceMs + 500).unref())]).then(() => finish());
  };
  const onUncaught = e => { out(`precheck: uncaught error: ${e?.stack ?? e}`); stopEverything('an uncaught error'); };
  const handlers = [['SIGINT', () => stopEverything('SIGINT')], ['SIGTERM', () => stopEverything('SIGTERM')], ['uncaughtException', onUncaught], ['unhandledRejection', onUncaught]];
  for (const [ev, h] of handlers) proc.on(ev, h);
  try {
    await Promise.race([pool, interruptedRun]);
  } finally {
    for (const [ev, h] of handlers) proc.off(ev, h);
  }
  out(formatSummary(rows, { wallMs: now() - t0, browsers, interrupted }));
  if (interrupted === 'SIGINT') return 130;
  if (interrupted === 'SIGTERM') return 143;
  return interrupted || rows.some(r => r.status !== 'ok') ? 1 : 0;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  let opt;
  try { opt = parseArgs(argv); } catch (e) { console.error(`precheck: ${e.message}`); return 2; }
  const map = JSON.parse(readFileSync(join(ROOT, 'scripts/gates-by-path.json'), 'utf8'));
  const files = opt.all ? [] : opt.files ?? changedFiles();
  const browsers = opt.all || opt.browser;
  const steps = planSteps(files, { all: opt.all, map });
  const timeoutS = opt.timeoutS ?? (browsers ? BROWSER_TIMEOUT_S : DEFAULT_TIMEOUT_S);
  return runPrecheck(steps, { browsers, timeoutMs: timeoutS * 1000, ...(opt.jobs ? { jobs: opt.jobs } : {}), ...deps });
}

const invoked = process.argv[1] && (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })();
if (invoked === import.meta.url) {
  process.exitCode = await main();
  // a step that leaked a handle must not keep the process alive after the summary
  setTimeout(() => process.exit(process.exitCode), 100).unref();
}
