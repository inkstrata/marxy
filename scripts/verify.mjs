// One command that checks a tree in tiers and says what each step cost: `pnpm verify`.
//   quick    install, typecheck, lint, pnpm check, the three gates, and the unit suites of the packages that changed
//   changed  quick, plus the browser tests covering the changed folders (scripts/verify-map.json) and cargo test
//   full     everything: every unit suite, Rust lint and tests, the browser tests, the build and check:tauri
// usage: node scripts/verify.mjs [--tier quick|changed|full] [--base <ref>] [--root <dir>] [--logs <dir>]
//   [--from <step>] [--only a,b] [--list] [--check-map] [--jobs <n>] [--unit-jobs <n>] [--lock-wait <sec>] [--no-lock] [--timeout-scale <x>]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitOnSignals, takeSlot } from './lib/machine-lock.mjs';

export const SCRIPT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const TIERS = ['quick', 'changed', 'full'];

/** Script tests left out of `quick` and `changed` (about three minutes alone). */
export const SLOW_SCRIPT_TESTS = ['probe-layout.test.mjs'];
/** Desktop unit files that start WebKit (paths from `apps/desktop`): they run one at a time; every other file runs side by side. */
export const DESKTOP_UNIT_BROWSER = ['src/notices/config-warnings-wired.test.mjs', 'src/source/frame.test.mjs', 'src/source/source-browser.test.mjs', 'src/theme/measure-face.test.mjs'];
/** Paths whose change affects every browser test: they run the fallback set. */
const SUPPORT_PREFIXES = ['scripts/playwright-webkit.mjs', 'apps/desktop/vite.config.ts', 'apps/desktop/package.json'];
/** A change here reaches the browser tests only through the shared helpers, which a small spread of files covers. */
const SUPPORT_SMOKE_PREFIX = 'apps/desktop/test/support/';
/** Run for a change under `apps/desktop/test/support/`: the fallback set and one or two files for each area of the app. */
export const SUPPORT_SMOKE = [
  'app-harness.test.mjs', 'view-lifecycle.test.mjs', 'view-modes.test.mjs', 'paint-signal.test.mjs', 'settings.test.mjs',
  'save.test.mjs', 'close-guard.test.mjs', 'store-walk.test.mjs', 'live-reload.test.mjs', 'open-path.test.mjs',
  'frame-tabs.test.mjs', 'frame-panel.test.mjs', 'frame-viewers.test.mjs', 'frame-tables.test.mjs', 'archive-page.test.mjs',
  'kinds-rest.test.mjs', 'log.test.mjs', 'transcript.test.mjs', 'palette.test.mjs', 'find-pane.test.mjs',
  'selection.test.mjs', 'typing.test.mjs', 'split-same-file.test.mjs', 'two-pane-skeleton.test.mjs', 'pane-focus.test.mjs',
  'code-open.test.mjs', 'source-structure.test.mjs', 'look.test.mjs', 'left-frame.test.mjs', 'release-csp.test.mjs', 'typeset-defaults.test.mjs',
  'tauri-subscriptions.test.mjs',
];
/** Paths with their own tests or no browser surface: a change here runs no browser file. */
const NO_BROWSER_PREFIXES = ['apps/desktop/scripts/'];
/** Steps that take the machine's CPU for minutes: a run holds one verify place from the first of them to the last. */
export const HEAVY_STEPS = ['unit-core', 'unit-theme', 'unit-typeset', 'unit-scripts', 'unit-desktop', 'unit-desktop-browser', 'lint-rust', 'browser', 'cargo', 'build'];
/** Runs at once on one machine: MARXY_VERIFY_SLOTS, default 2. */
export function slotCount(env = process.env) {
  const n = env.MARXY_VERIFY_SLOTS === undefined || env.MARXY_VERIFY_SLOTS === '' ? 2 : Number(env.MARXY_VERIFY_SLOTS);
  if (!Number.isInteger(n) || n < 1) throw new Error('MARXY_VERIFY_SLOTS must be a whole number of at least 1');
  return n;
}
/** Seconds a run waits for a verify place: MARXY_VERIFY_SLOT_WAIT_SEC, default 10800. */
export function slotWaitSec(env = process.env) {
  const v = env.MARXY_VERIFY_SLOT_WAIT_SEC;
  if (v === undefined || v === '') return 10800;
  const n = Number(v);
  if (!(n >= 0) || !Number.isFinite(n)) throw new Error('MARXY_VERIFY_SLOT_WAIT_SEC must be seconds, 0 or more');
  return n;
}
/** Indexes of the first and last heavy step in `steps`, or null when there is none. */
export function heavySpan(steps) {
  const at = steps.map((s, i) => (HEAVY_STEPS.includes(s.name) ? i : -1)).filter(i => i >= 0);
  return at.length ? { first: at[0], last: at[at.length - 1] } : null;
}

const ROOT_FILES_ALL = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'biome.json', 'mise.toml'];

const USAGE = 'usage: node scripts/verify.mjs [--tier quick|changed|full] [--base <ref>] [--root <dir>] [--logs <dir>] [--from <step>] [--only a,b] [--list] [--check-map] [--jobs <n>] [--unit-jobs <n>] [--lock-wait <sec>] [--no-lock] [--timeout-scale <x>]';

/** Parsed command line; throws an Error with a message for a bad one. */
export function parseArgs(argv) {
  const o = { tier: 'quick', base: 'main', root: null, logs: null, from: null, only: null, list: false, checkMap: false, jobs: null, unitJobs: null, lockWait: 900, noLock: false, timeoutScale: 1, help: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const take = () => (inline !== null ? inline : (i++, value(i - 1, a)));
    switch (a) {
      case '--tier': o.tier = take(); break;
      case '--base': o.base = take(); break;
      case '--root': o.root = take(); break;
      case '--logs': o.logs = take(); break;
      case '--from': o.from = take(); break;
      case '--only': o.only = take().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--jobs': o.jobs = Number(take()); break;
      case '--unit-jobs': o.unitJobs = Number(take()); break;
      case '--lock-wait': o.lockWait = Number(take()); break;
      case '--timeout-scale': o.timeoutScale = Number(take()); break;
      case '--no-lock': o.noLock = true; break;
      case '--list': o.list = true; break;
      case '--check-map': o.checkMap = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  if (!TIERS.includes(o.tier)) throw new Error(`--tier must be one of ${TIERS.join(', ')}, not ${o.tier}`);
  if (o.jobs === null) o.jobs = o.tier === 'full' ? 3 : o.tier === 'changed' ? 2 : 1;
  if (!Number.isInteger(o.jobs) || o.jobs < 1) throw new Error('--jobs must be a whole number of at least 1');
  if (o.unitJobs === null) o.unitJobs = Math.max(1, Math.min(4, availableParallelism() - 1));
  if (!Number.isInteger(o.unitJobs) || o.unitJobs < 1) throw new Error('--unit-jobs must be a whole number of at least 1');
  if (!(o.lockWait >= 0)) throw new Error('--lock-wait must be seconds, 0 or more');
  if (!(o.timeoutScale > 0)) throw new Error('--timeout-scale must be above 0');
  if (o.only && !o.only.length) throw new Error('--only needs at least one step name');
  return o;
}

const norm = p => p.split('\\').join('/');

/**
 * Sorts changed paths (repo-relative, forward slashes) into what they ask of the run.
 * `map` is the parsed scripts/verify-map.json; `exists(testFile)` says whether a mapped test file is present.
 */
export function classifyChanges(files, map, exists = () => true) {
  const out = { suites: new Set(), rust: false, browser: new Set(), unmapped: [], any: false };
  const keys = Object.keys(map.map).sort((a, b) => b.length - a.length);
  const owns = (k, f) => {
    if (k === 'apps/desktop/src') return /^apps\/desktop\/src\/[^/]+$/.test(f);
    return f === k || f.startsWith(`${k}/`);
  };
  for (const raw of files) {
    const f = norm(raw);
    if (!f) continue;
    out.any = true;
    if (f.startsWith('packages/core/')) out.suites.add('core');
    else if (f.startsWith('packages/theme/')) out.suites.add('theme');
    else if (f.startsWith('packages/typeset/')) out.suites.add('typeset');
    else if (f.startsWith('scripts/')) out.suites.add('scripts');
    else if (f.startsWith('apps/desktop/src/') || f.startsWith('apps/desktop/scripts/') || f === 'apps/desktop/package.json' || f === 'apps/desktop/vite.config.ts') out.suites.add('desktop');
    else if (ROOT_FILES_ALL.includes(f)) ['core', 'theme', 'typeset', 'scripts', 'desktop'].forEach(s => out.suites.add(s));
    if (f.startsWith('apps/desktop/src-tauri/')) out.rust = true;
    const test = f.match(/^apps\/desktop\/test\/([^/]+\.test\.mjs)$/);
    if (test) {
      if (exists(test[1])) out.browser.add(test[1]);
      continue;
    }
    if (f.startsWith(SUPPORT_SMOKE_PREFIX)) {
      // Desktop unit files import some of these helpers too (source roles, the seeded random).
      out.suites.add('desktop');
      for (const t of SUPPORT_SMOKE) if (exists(t)) out.browser.add(t);
      continue;
    }
    if (NO_BROWSER_PREFIXES.some(p => f.startsWith(p))) continue;
    if (SUPPORT_PREFIXES.some(p => f === p || f.startsWith(p))) {
      out.unmapped.push(f);
      continue;
    }
    const key = keys.find(k => owns(k, f));
    if (key === undefined) {
      out.unmapped.push(f);
      continue;
    }
    for (const t of map.map[key]) if (exists(t)) out.browser.add(t);
  }
  if (out.unmapped.length) for (const t of map.fallback) if (exists(t)) out.browser.add(t);
  return out;
}

/** Every browser test file; the full tier runs all of them. */
export function allBrowserTests(root) {
  return readdirSync(join(root, 'apps/desktop/test')).filter(f => f.endsWith('.test.mjs')).sort();
}

/** Problems with the map against the tree: stale test names, test files in no map entry, source folders with no key. */
export function mapProblems(map, root) {
  const tests = join(root, 'apps/desktop/test');
  const present = new Set(readdirSync(tests).filter(f => f.endsWith('.test.mjs')));
  const listed = new Set(Object.values(map.map).flat());
  const stale = [];
  for (const t of map.fallback) if (!present.has(t)) stale.push(`fallback: ${t}`);
  for (const [k, v] of Object.entries(map.map)) for (const t of v) if (!present.has(t)) stale.push(`${k}: ${t}`);
  const unlisted = [...present].filter(t => !listed.has(t)).sort();
  const src = join(root, 'apps/desktop/src');
  const noKey = readdirSync(src, { withFileTypes: true })
    .filter(e => e.isDirectory() && !(`apps/desktop/src/${e.name}` in map.map))
    .map(e => `apps/desktop/src/${e.name}`);
  return { stale, unlisted, noKey };
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Test counts from a step's output: node's runner, cargo, `pnpm check`, or check:tauri's PASS and FAIL lines. */
export function parseCounts(text) {
  const t = text.replace(ANSI, '');
  const sum = (re) => [...t.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0);
  const has = re => re.test(t);
  if (has(/^(?:ℹ|#) tests \d+/m)) {
    return { pass: sum(/^(?:ℹ|#) pass (\d+)/gm), fail: sum(/^(?:ℹ|#) fail (\d+)/gm), skip: sum(/^(?:ℹ|#) skipped (\d+)/gm) };
  }
  if (has(/^test result: /m)) {
    return { pass: sum(/^test result: .*?(\d+) passed;/gm), fail: sum(/^test result: .*?; (\d+) failed;/gm), skip: sum(/^test result: .*?; (\d+) ignored;/gm) };
  }
  const chk = t.match(/^check: (\d+)\/(\d+) passed/m);
  if (chk) return { pass: Number(chk[1]), fail: Number(chk[2]) - Number(chk[1]), skip: 0 };
  if (has(/^(?:PASS|FAIL) /m)) return { pass: [...t.matchAll(/^PASS /gm)].length, fail: [...t.matchAll(/^FAIL /gm)].length, skip: 0 };
  return null;
}

export const formatCounts = c => (c ? `${c.pass} pass, ${c.fail} fail${c.skip ? `, ${c.skip} skip` : ''}` : '');

const nodeTest = (args, extra = [], jobs = 1) => ({ cmd: 'node', args: ['--test', '--experimental-strip-types', `--test-concurrency=${jobs}`, ...extra, ...args] });

function listTests(dir, pred) {
  return existsSync(dir) ? readdirSync(dir).filter(pred).sort() : [];
}

/**
 * The desktop unit files (paths from `apps/desktop`), split into those that start WebKit and the rest.
 * Node's own glob has no exclusion, so the list is built here.
 */
export function desktopUnitFiles(root) {
  const base = join(root, 'apps/desktop');
  const found = [];
  const walk = rel => {
    for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (/\.test\.(ts|mjs)$/.test(e.name)) found.push(path);
    }
  };
  for (const dir of ['src', 'scripts']) if (existsSync(join(base, dir))) walk(dir);
  found.sort();
  return { plain: found.filter(f => !DESKTOP_UNIT_BROWSER.includes(f)), browser: found.filter(f => DESKTOP_UNIT_BROWSER.includes(f)) };
}

/**
 * Every step the tool knows, in run order. `ctx` = { root, tier, change, jobs, map }.
 * A step: { name, tiers, when?, cmd, args, cwd, timeout (seconds), env? }. `when(ctx)` gates it inside its tiers.
 */
export function catalog(ctx) {
  const { root, change, jobs } = ctx;
  const full = ctx.tier === 'full';
  const suite = s => full || change.suites.has(s);
  const scriptsDir = join(root, 'scripts');
  const scriptTests = [
    ...listTests(scriptsDir, f => f.endsWith('.test.mjs') && (full || !SLOW_SCRIPT_TESTS.includes(f))).map(f => `scripts/${f}`),
    ...listTests(join(scriptsDir, 'lib'), f => f.endsWith('.test.mjs')).map(f => `scripts/lib/${f}`),
  ];
  const desktopUnit = desktopUnitFiles(root);
  const browserFiles = [...change.browser].sort().map(f => `test/${f}`);
  const all = ['quick', 'changed', 'full'];
  const pnpm = (name, args, timeout, tiers = all, more = {}) => ({ name, tiers, cmd: 'pnpm', args, cwd: '.', timeout, ...more });
  return [
    pnpm('install', ['install', '--offline'], 600),
    pnpm('typecheck', ['typecheck'], 900),
    pnpm('lint', ['lint'], 900),
    pnpm('check', ['check'], 900),
    pnpm('golden', ['gate:golden'], 900),
    pnpm('fidelity', ['gate:fidelity'], 900),
    pnpm('licences', ['gate:licences'], 900),
    pnpm('unit-core', ['--filter', '@marxy/core', 'test'], 1500, all, { when: () => suite('core') }),
    pnpm('unit-theme', ['--filter', '@marxy/theme', 'test'], 900, all, { when: () => suite('theme') }),
    pnpm('unit-typeset', ['--filter', '@marxy/typeset', 'test'], 900, all, { when: () => suite('typeset') }),
    { name: 'unit-scripts', tiers: all, when: () => suite('scripts'), ...nodeTest(scriptTests), cwd: '.', timeout: 900 },
    { name: 'unit-desktop', tiers: all, when: () => suite('desktop'), ...nodeTest(desktopUnit.plain, [], ctx.unitJobs ?? 1), cwd: 'apps/desktop', timeout: 1800 },
    { name: 'unit-desktop-browser', tiers: all, when: () => suite('desktop') && desktopUnit.browser.length > 0, ...nodeTest(desktopUnit.browser), cwd: 'apps/desktop', timeout: 1800 },
    { name: 'lint-rust', tiers: ['changed', 'full'], when: () => full || change.rust, cmd: 'pnpm', args: ['lint:rust'], cwd: '.', timeout: 1200 },
    {
      name: 'browser',
      tiers: ['changed', 'full'],
      when: () => browserFiles.length > 0,
      cmd: 'node',
      args: ['scripts/browser-tests.mjs', '--jobs', String(jobs), ...browserFiles],
      cwd: '.',
      timeout: Math.max(3600, 60 * Math.ceil(browserFiles.length / jobs)),
    },
    { name: 'cargo', tiers: ['changed', 'full'], when: () => full || change.rust, cmd: 'cargo', args: ['test'], cwd: 'apps/desktop/src-tauri', timeout: 2400 },
    pnpm('build', ['--filter', '@marxy/desktop', 'build'], 2400, ['full']),
    // check:tauri drives the real WebView2 window over its debugging port, so it runs on Windows only.
    pnpm('tauri', ['--filter', '@marxy/desktop', 'check:tauri'], 1800 + ctx.lockWait, ['full'], { when: () => (ctx.platform ?? process.platform) === 'win32' }),
  ];
}

/** The steps a run executes: the tier's (with `when` applied), or the named ones, from `from` on. */
export function plan(ctx, { only, from }) {
  const cat = catalog(ctx);
  const names = cat.map(s => s.name);
  for (const n of [...(only ?? []), ...(from ? [from] : [])]) if (!names.includes(n)) throw new Error(`unknown step ${n}; the steps are ${names.join(', ')}`);
  let steps = only ? cat.filter(s => only.includes(s.name)) : cat.filter(s => s.tiers.includes(ctx.tier) && (!s.when || s.when(ctx)));
  if (only) steps = steps.filter(s => s.name !== 'browser' || s.args.some(a => a.startsWith('test/')));
  if (from) {
    const i = steps.findIndex(s => s.name === from);
    if (i < 0) throw new Error(`step ${from} is not in this run (${steps.map(s => s.name).join(', ') || 'no steps'})`);
    steps = steps.slice(i);
  }
  return steps;
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/**
 * Paths changed since the merge base with `base`: commits, staged and unstaged edits, and untracked files. A bare
 * branch name that is not a local branch falls back to `origin/<name>`: a CI checkout has `origin/main` and no `main`.
 */
export function changedPaths(root, base) {
  let mb;
  for (const ref of base.includes('/') ? [base] : [base, `origin/${base}`]) {
    try {
      mb = git(root, ['merge-base', ref, 'HEAD']).trim();
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!mb) throw new Error(`base ref ${base} not found in ${root}; pass --base <ref>`);
  const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean);
  const set = new Set([...lines(git(root, ['diff', '--name-only', '--no-renames', mb])), ...lines(git(root, ['ls-files', '--others', '--exclude-standard']))]);
  return [...set].sort();
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Runs one step; its combined output goes to `logFile`. Resolves { ok, code, timedOut, seconds, counts }. */
export function runStep(step, { root, logFile, scale = 1, env = {} }) {
  return new Promise(done => {
    const started = Date.now();
    const win = process.platform === 'win32';
    const cmd = step.cmd === 'node' ? process.execPath : step.cmd;
    // pnpm is a .cmd shim on Windows; its arguments here have no spaces or shell characters.
    const shell = win && step.cmd === 'pnpm';
    const child = spawn(shell ? [cmd, ...step.args].join(' ') : cmd, shell ? [] : step.args, {
      cwd: join(root, step.cwd),
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(step.env ?? {}), ...env },
      shell,
      detached: !win,
      windowsHide: true,
    });
    const chunks = [];
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => chunks.push(d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, step.timeout * scale * 1000);
    const finish = code => {
      clearTimeout(timer);
      let text = Buffer.concat(chunks).toString('utf8');
      if (timedOut) text += `\nverify: killed after ${Math.round(step.timeout * scale)} s\n`;
      writeFileSync(logFile, `$ ${step.cmd} ${step.args.join(' ')}   (in ${step.cwd})\n\n${text}`);
      const counts = parseCounts(text);
      const ok = code === 0 && !timedOut && !(counts && counts.fail > 0);
      done({ ok, code, timedOut, seconds: (Date.now() - started) / 1000, counts });
    };
    child.on('error', e => {
      chunks.push(Buffer.from(`spawn failed: ${e.message}\n`));
      finish(-1);
    });
    child.on('close', finish);
  });
}

const secs = s => `${s.toFixed(1)}s`;
const pad = (s, n) => String(s).padEnd(n);

/** The closing table, one row per step. */
export function table(rows) {
  const head = ['step', 'result', 'wall', 'tests'];
  const body = rows.map(r => [r.name, r.status, r.seconds === undefined ? '' : secs(r.seconds), r.tests ?? '']);
  const w = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = cells => cells.map((c, i) => pad(c, w[i])).join('  ').trimEnd();
  const total = rows.reduce((n, r) => n + (r.seconds ?? 0), 0);
  return [line(head), line(w.map(n => '-'.repeat(n))), ...body.map(line), line(w.map(n => '-'.repeat(n))), line(['total', '', secs(total), ''])].join('\n');
}

function tail(file, n = 12) {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
}

export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`verify: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  const root = resolve(o.root ?? SCRIPT_ROOT);
  const map = JSON.parse(readFileSync(join(root, 'scripts/verify-map.json'), 'utf8'));
  if (o.checkMap) {
    const p = mapProblems(map, root);
    console.log(`stale names (${p.stale.length})${p.stale.map(s => `\n  ${s}`).join('')}`);
    console.log(`test files in no map entry (${p.unlisted.length})${p.unlisted.map(s => `\n  ${s}`).join('')}`);
    console.log(`source folders with no key (${p.noKey.length})${p.noKey.map(s => `\n  ${s}`).join('')}`);
    return p.stale.length || p.unlisted.length ? 1 : 0;
  }
  let change;
  let steps;
  const ctx0 = { root, tier: o.tier, jobs: o.jobs, unitJobs: o.unitJobs, lockWait: o.lockWait, map };
  try {
    const files = changedPaths(root, o.base);
    change = classifyChanges(files, map, t => existsSync(join(root, 'apps/desktop/test', t)));
    change.files = files;
    if (o.tier === 'full') for (const t of allBrowserTests(root)) change.browser.add(t);
    else if (o.only?.includes('browser') && !change.browser.size) for (const t of map.fallback) change.browser.add(t);
    steps = plan({ ...ctx0, change }, o);
  } catch (e) {
    console.error(`verify: ${e.message}`);
    return 2;
  }
  const changeLine = `${change.files.length} files changed against ${o.base}; unit suites: ${[...change.suites].join(', ') || 'none'}; browser files: ${change.browser.size}${change.rust ? '; rust changed' : ''}${change.unmapped.length ? `; unmapped: ${change.unmapped.slice(0, 5).join(', ')}${change.unmapped.length > 5 ? ', ...' : ''}` : ''}`;
  console.log(`verify ${o.tier} in ${root}\n${changeLine}`);
  if (o.list) {
    for (const s of steps) console.log(`  ${pad(s.name, 14)} ${s.cmd} ${s.args.join(' ')}   (${s.cwd}, timeout ${s.timeout} s)`);
    return 0;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logs = resolve(o.logs ?? join(tmpdir(), 'marxy-verify', `${basename(root)}-${stamp}`));
  mkdirSync(logs, { recursive: true });
  console.log(`logs in ${logs}\n`);
  const rows = [];
  let i = 0;
  let slots;
  try {
    slots = slotCount();
    slotWaitSec();
  } catch (e) {
    console.error(`verify: ${e.message}`);
    return 2;
  }
  const span = o.noLock ? null : heavySpan(steps);
  let held = null;
  for (const s of steps) {
    if (span && !held && i === span.first) {
      const waitSec = slotWaitSec();
      exitOnSignals();
      try {
        held = await takeSlot('verify', slots, { waitMs: waitSec * 1000, staleMs: 6 * 3600_000, label: `verify ${o.tier} in ${root}`, log: m => console.log(`verify: ${m}`) });
      } catch (e) {
        console.error(`verify: ${e.message}`);
        return 2;
      }
      console.log(`verify: holding place ${held.slot} of ${slots} (--no-lock skips it)
`);
    }
    i++;
    const logFile = join(logs, `${String(i).padStart(2, '0')}-${s.name}.log`);
    if (process.stdout.isTTY) process.stdout.write(`... ${s.name}\r`);
    const r = await runStep(s, { root, logFile, scale: o.timeoutScale, env: { MARXY_LOCK_WAIT_SEC: String(o.lockWait) } });
    const status = r.timedOut ? 'TIMEOUT' : r.ok ? 'pass' : 'FAIL';
    const tests = formatCounts(r.counts);
    rows.push({ name: s.name, status, seconds: r.seconds, tests, log: logFile });
    console.log(`${pad(status.toUpperCase(), 7)} ${pad(s.name, 14)} ${pad(secs(r.seconds), 9)} ${tests}`);
    if (held && span && i - 1 === span.last) {
      held.release();
      held = null;
    }
  }
  held?.release();
  console.log(`\n${table(rows)}`);
  const failed = rows.filter(r => r.status !== 'pass');
  for (const r of failed) console.log(`\n--- ${r.name} (${r.log})\n${tail(r.log)}`);
  writeFileSync(join(logs, 'summary.json'), JSON.stringify({ tier: o.tier, base: o.base, root, rows }, null, 2));
  console.log(`\nverify ${o.tier}: ${rows.length - failed.length}/${rows.length} steps passed${failed.length ? `; failed: ${failed.map(r => r.name).join(', ')}; rerun with --from ${failed[0].name}` : ''}`);
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
