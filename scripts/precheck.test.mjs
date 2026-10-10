// G-02: precheck is CI's `fast` job for what you touched, runs in parallel, and always reports.
// The planner is pure; the runner is stubbed except where the test is about the real process group or the real signals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/repo.mjs';
import { planSteps, runPrecheck, spawnStep, parseArgs, formatSummary, PACKAGES } from './precheck.mjs';

const map = JSON.parse(readFileSync(join(ROOT, 'scripts/gates-by-path.json'), 'utf8'));
const names = files => planSteps(files, { map }).map(s => s.name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = () => mkdtempSync(join(tmpdir(), 'marxy-precheck-test-'));

/** A runner that finishes each step as the test says, and stops when aborted. */
const stubRunner = (behaviour = () => ({ code: 0, output: '' })) => {
  const calls = [];
  const runner = (step, { signal }) => new Promise(resolve => {
    calls.push(step);
    const b = behaviour(step);
    if (b === 'hang') { signal.addEventListener('abort', () => resolve({ code: 1, output: '' }), { once: true }); return; }
    setTimeout(() => resolve(b), b.delayMs ?? 0);
  });
  runner.calls = calls;
  return runner;
};
const run = (steps, opts = {}) => {
  const lines = [];
  const dir = tmp();
  const p = runPrecheck(steps, { out: l => lines.push(l), logDir: join(dir, 'logs'), noBrowsersDir: join(dir, 'nb'), graceMs: 200, ...opts })
    .finally(() => rmSync(dir, { recursive: true, force: true }));
  return { p, lines, text: () => lines.join('\n') };
};

test('G-02: a desktop-only change runs the desktop package, the bundle gate and the hygiene checks, and no browser gate', () => {
  const n = names(['apps/desktop/src/app.ts']);
  assert.deepEqual(n.filter(x => x.startsWith('apps/desktop')).sort(), [
    'apps/desktop lint', 'apps/desktop test', 'apps/desktop test:mutations', 'apps/desktop typecheck',
  ]);
  for (const want of ['gate:bundle', 'check', 'biome (root)']) assert.ok(n.includes(want), want);
  for (const nope of ['gate:no-network', 'gate:aesthetics', 'lint:theme', 'lint:rust', 'clippy:rust', 'check-cards', 'check:story', 'scripts:test', 'gate:golden']) {
    assert.ok(!n.includes(nope), `${nope} is not part of a desktop change`);
  }
  assert.ok(!n.some(x => x.startsWith('packages/')), 'no other package');
});

test('G-02.1: a core-only change runs core, the golden, fidelity and CommonMark selftest gates, and only typechecks desktop', () => {
  const n = names(['packages/core/src/parse/foo.ts']);
  assert.deepEqual(n.filter(x => x.startsWith('packages/')).sort(), ['packages/core lint', 'packages/core test', 'packages/core typecheck']);
  for (const want of ['gate:golden', 'gate:fidelity', 'commonmark:selftest', 'check']) assert.ok(n.includes(want), want);
  for (const nope of ['gate:bundle', 'gate:no-network', 'gate:aesthetics', 'gate:licences']) assert.ok(!n.includes(nope), nope);
  assert.deepEqual(n.filter(x => x.startsWith('apps/')), ['apps/desktop typecheck'], 'desktop consumes core: typecheck, no tests');
  const selftest = planSteps(['packages/core/src/parse/foo.ts'], { map }).find(s => s.name === 'commonmark:selftest');
  assert.match(selftest.args.join(' '), /commonmark-spec\.ts --selftest/);
  // core plus desktop: one desktop typecheck, not two
  assert.equal(names(['packages/core/src/a.ts', 'apps/desktop/src/b.ts']).filter(x => x === 'apps/desktop typecheck').length, 1);
  // desktop alone does not pull in core's selftest
  assert.ok(!names(['apps/desktop/src/app.ts']).includes('commonmark:selftest'));
});

test('G-02: a scripts-only change runs the scripts tests, not the five packages', () => {
  const n = names(['scripts/check.mjs']);
  assert.ok(n.includes('scripts:test'));
  assert.ok(n.includes('check'));
  assert.ok(!n.some(x => /^(packages|apps)\//.test(x)), 'no package step');
  const step = planSteps(['scripts/check.mjs'], { map }).find(s => s.name === 'scripts:test');
  assert.match(step.args.join(' '), /node --test scripts\/lib\/\*\.test\.mjs scripts\/\*\.test\.mjs/);
});

test('G-02: a docs-only change runs `pnpm check` and nothing else', () => {
  assert.deepEqual(names(['docs/ci-contract.md', 'changelog.d/G-02.md', 'README.md']), ['check']);
});

test('G-02: root manifests, the workspace file and tsconfigs still mean every package; a lockfile means the licence gate', () => {
  for (const f of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    const n = names([f]);
    for (const p of PACKAGES) assert.ok(n.includes(`${p} typecheck`), `${f} -> ${p}`);
  }
  assert.ok(names(['pnpm-lock.yaml']).includes('gate:licences'));
  assert.ok(names(['packages/core/package.json']).includes('gate:licences'));
});

test('G-02: a change in src-tauri runs cargo fmt --check, not the desktop tests; orchestration runs the fleet tests', () => {
  const rust = planSteps(['apps/desktop/src-tauri/src/main.rs'], { map });
  const fmt = rust.find(s => s.name === 'fmt:rust');
  assert.deepEqual([fmt.cmd, fmt.args, fmt.cwd], ['cargo', ['fmt', '--check'], 'apps/desktop/src-tauri']);
  assert.ok(!rust.some(s => s.name === 'apps/desktop test'));
  assert.ok(!rust.some(s => s.name === 'clippy:rust'));
  assert.ok(names(['orchestration/loop.mjs']).includes('test:fleet'));
});

test('G-02: --all is the explicit slow path: every package, every gate including no-network, aesthetics and clippy', () => {
  const n = planSteps([], { all: true, map }).map(s => s.name);
  for (const p of PACKAGES) for (const s of ['test', 'typecheck', 'lint']) assert.ok(n.includes(`${p} ${s}`), `${p} ${s}`);
  for (const g of ['gate:no-network', 'gate:aesthetics', 'clippy:rust', 'fmt:rust', 'gate:golden', 'gate:fidelity', 'gate:bundle', 'gate:licences', 'scripts:test', 'check']) {
    assert.ok(n.includes(g), g);
  }
});

test('G-02: arguments', () => {
  assert.deepEqual(parseArgs(['--all', '--browser', '--timeout', '90', '--jobs', '3', '--files', 'a,b']), { all: true, browser: true, timeoutS: 90, jobs: 3, files: ['a', 'b'] });
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--timeout', 'soon']));
});

test('G-02: package tests get no browser by default, and --browser turns them back on', async () => {
  const steps = planSteps(['apps/desktop/src/app.ts'], { map });
  const seen = {};
  const runner = (step) => { seen[step.name] = step.env; return Promise.resolve({ code: 0, output: '' }); };
  const off = run(steps, { runner });
  assert.equal(await off.p, 0);
  assert.match(seen['apps/desktop test'].PLAYWRIGHT_BROWSERS_PATH, /marxy-precheck-no-browsers|nb$/);
  assert.equal(seen['apps/desktop test'].MARXY_BROWSER_TESTS_REQUIRED, '0');
  assert.equal(seen['gate:bundle'].PLAYWRIGHT_BROWSERS_PATH, undefined, 'only package tests are cut off from the browsers');
  assert.match(off.text(), /WebKit tests were skipped.*precheck --browser/);
  for (const k of Object.keys(seen)) delete seen[k];
  const on = run(steps, { runner, browsers: true });
  assert.equal(await on.p, 0);
  assert.equal(seen['apps/desktop test'].PLAYWRIGHT_BROWSERS_PATH, undefined);
  assert.doesNotMatch(on.text(), /WebKit tests were skipped/);
});

test('G-02: an empty PLAYWRIGHT_BROWSERS_PATH makes the browser tests\' own skip condition true', async () => {
  const dir = tmp();
  try {
    const probe = "import { existsSync } from 'node:fs'; import { webkit } from 'playwright'; console.log('installed=' + existsSync(webkit.executablePath()))";
    const r = await spawnStep({ cmd: process.execPath, args: ['--input-type=module', '-e', probe], env: { PLAYWRIGHT_BROWSERS_PATH: dir } }, {});
    assert.match(r.output, /installed=false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('G-02: steps run in parallel, no more than `jobs` at once', async () => {
  const steps = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, cmd: 'x', args: [] }));
  let inFlight = 0, peak = 0;
  const runner = async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(30); inFlight--; return { code: 0, output: '' }; };
  assert.equal(await run(steps, { runner, jobs: 3 }).p, 0);
  assert.equal(peak, 3);
});

test('G-02: every row prints its wall time; a failing step names its failing tests and the exit code is non-zero', async () => {
  const steps = [{ name: 'good', cmd: 'x', args: [] }, { name: 'bad', cmd: 'x', args: [] }];
  const runner = stubRunner(s => s.name === 'bad' ? { code: 1, output: 'failing tests:\n\n✖ the thing holds (1.2ms)\n  AssertionError: nope\n' } : { code: 0, output: '' });
  const r = run(steps, { runner });
  assert.equal(await r.p, 1);
  const text = r.text();
  assert.match(text, /✓ good\s+\d+\.\ds/);
  assert.match(text, /✗ bad\s+\d+\.\ds/);
  assert.match(text, /✖ the thing holds: AssertionError: nope/);
  assert.match(text, /precheck: 1\/2 passed in \d+\.\ds/);
});

test('G-02: all steps passing exits 0', async () => {
  assert.equal(await run([{ name: 'a', cmd: 'x', args: [] }], { runner: stubRunner() }).p, 0);
});

test('G-02: a step past its timeout is ✗ timed out, the others still report, and the exit code is non-zero', { timeout: 5000 }, async () => {
  const steps = [{ name: 'quick', cmd: 'x', args: [] }, { name: 'stuck', cmd: 'x', args: [] }];
  const r = run(steps, { runner: stubRunner(s => s.name === 'stuck' ? 'hang' : { code: 0, output: '' }), timeoutMs: 60 });
  assert.equal(await r.p, 1);
  assert.match(r.text(), /✗ stuck\s+\d+\.\ds timed out/);
  assert.match(r.text(), /✓ quick/);
});

test('G-02: a timeout is enforced even by a runner that ignores the abort', { timeout: 5000 }, async () => {
  const r = run([{ name: 'deaf', cmd: 'x', args: [] }], { runner: () => new Promise(() => {}), timeoutMs: 30, graceMs: 50 });
  assert.equal(await r.p, 1);
  assert.match(r.text(), /✗ deaf.*timed out/);
});

test('G-02: SIGTERM mid-run prints the summary with killed rows and exits non-zero', { timeout: 5000 }, async () => {
  const steps = ['a', 'b', 'c'].map(name => ({ name, cmd: 'x', args: [] }));
  const proc = new EventEmitter();
  const runner = stubRunner(s => s.name === 'a' ? { code: 0, output: '' } : 'hang');
  const r = run(steps, { runner, proc, jobs: 1 });
  await sleep(50);
  proc.emit('SIGTERM');
  const code = await r.p;
  assert.notEqual(code, 0);
  assert.equal(code, 143);
  const text = r.text();
  assert.match(text, /✓ a/);
  assert.match(text, /✗ b\s+\d+\.\ds killed/);
  assert.match(text, /✗ c\s+not run/);
  assert.match(text, /interrupted by SIGTERM/);
  assert.equal(proc.listenerCount('SIGTERM'), 0, 'handlers are removed afterwards');
});

test('G-02: SIGINT does the same, with 130', { timeout: 5000 }, async () => {
  const proc = new EventEmitter();
  const r = run([{ name: 'a', cmd: 'x', args: [] }], { runner: stubRunner(() => 'hang'), proc });
  await sleep(30);
  proc.emit('SIGINT');
  assert.equal(await r.p, 130);
  assert.match(r.text(), /✗ a\s+\d+\.\ds killed/);
});

test('G-02: an uncaught error prints the summary too', { timeout: 5000 }, async () => {
  const proc = new EventEmitter();
  const r = run([{ name: 'a', cmd: 'x', args: [] }], { runner: stubRunner(() => 'hang'), proc });
  await sleep(30);
  proc.emit('uncaughtException', new Error('boom'));
  assert.equal(await r.p, 1);
  assert.match(r.text(), /uncaught error: Error: boom/);
  assert.match(r.text(), /✗ a\s+\d+\.\ds killed/);
  assert.match(r.text(), /precheck: 0\/1 passed/);
});

test('G-02: a real SIGTERM to a real precheck process kills the step and still prints the summary', { timeout: 15000 }, async () => {
  // A child that runs precheck's own runPrecheck over one real, hanging step, on the real process object.
  const script = `
    import { runPrecheck, spawnStep } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/precheck.mjs')).href)};
    const code = await runPrecheck([{ name: 'hang', cmd: 'sh', args: ['-c', 'sleep 60 & wait'] }], { runner: spawnStep, browsers: true, logDir: ${JSON.stringify(join(tmpdir(), 'marxy-precheck-sigterm-logs'))} });
    process.exit(code);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  while (!/1 step\(s\)/.test(out)) await sleep(20);
  await sleep(300); // the step is running
  child.kill('SIGTERM');
  const [code, signal] = await new Promise(res => child.on('close', (c, s) => res([c, s])));
  assert.equal(signal, null, `exited by itself, not by the signal:\n${out}`);
  assert.notEqual(code, 0);
  assert.match(out, /✗ hang\s+\d+\.\ds killed/);
  assert.match(out, /interrupted by SIGTERM/);
});

test('G-02: a step runs in its own process group, and an abort kills what it started', { timeout: 5000 }, async t => {
  const dir = tmp();
  let grandchild = 0;
  // a regression must not leave the sleeper (and the open pipe it holds) running for a minute; t.after runs even when the timeout cancels the test
  t.after(() => { if (grandchild) try { process.kill(grandchild, 'SIGKILL'); } catch { /* already gone */ } });
  try {
    const pidFile = join(dir, 'pid');
    const ac = new AbortController();
    const p = spawnStep({ cmd: 'sh', args: ['-c', `sleep 60 & echo $! > ${pidFile}; wait`] }, { signal: ac.signal });
    while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8').trim()) await sleep(20);
    grandchild = Number(readFileSync(pidFile, 'utf8'));
    assert.doesNotThrow(() => process.kill(grandchild, 0), 'the grandchild is alive');
    ac.abort();
    await p;
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) { try { process.kill(grandchild, 0); await sleep(20); } catch { alive = false; } }
    assert.equal(alive, false, 'the grandchild died with its group');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('G-02: each step\'s output goes to a log file', async () => {
  const dir = tmp();
  try {
    const logFile = join(dir, 'x.log');
    await spawnStep({ cmd: 'sh', args: ['-c', 'echo to-stdout; echo to-stderr >&2'] }, { logFile });
    await sleep(50);
    const text = readFileSync(logFile, 'utf8');
    assert.match(text, /to-stdout/);
    assert.match(text, /to-stderr/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('G-02: the summary says how to run the skipped WebKit tests', () => {
  const s = formatSummary([{ name: 'a', status: 'ok', ms: 1200 }], { wallMs: 1500, browsers: false });
  assert.match(s, /WebKit tests were skipped/);
  assert.match(s, /precheck --browser/);
});
