// Install hardening that runs on the owner's devices as plain scripts (no agent, no usage).
//   nightly  Windows (Task Scheduler 05:15): full verify on a clean origin/main, alone-reruns of red browser files,
//            then the repo's own installer path and a launch of the installed exe.
//   device   macOS and Linux (launchd / systemd hourly): skips fast unless the device is on power and its newest
//            result is stale; macOS builds and smoke-checks the app, Linux runs CI's AppImage.
// Results go to the auto-state branch as devices/<os>.json and nightly/<date>-<os>.json. A failed check is data
// (exit 0); a non-zero exit means the run itself broke.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, workspace } from '../lib/workspace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN = 60e3;
const HOUR = 3600e3;
const FRESH_HOURS = 20;
const BROWSER_DAYS = 7;
const WIN = process.platform === 'win32';

// ---- pure helpers (tested) -------------------------------------------------------------------------------------------

/** Pacific calendar date (YYYY-MM-DD) of `d`; the owner's day, whatever zone the machine runs in. */
export function pacificDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** True when `pmset -g batt` says the Mac draws from the wall. */
export function macOnAc(text) {
  return /Now drawing from 'AC Power'/.test(text);
}

/** True when `pmset -g` shows low power mode switched on. */
export function macLowPower(text) {
  return /^\s*lowpowermode\s+1\b/m.test(text);
}

/** Linux: on external power when a Mains/USB supply is online, or there is no battery at all (a desktop). */
export function linuxOnExternalPower(root = '/sys/class/power_supply') {
  let names;
  try { names = readdirSync(root); } catch { return true; }
  const read = f => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };
  let battery = false;
  for (const n of names) {
    const type = read(join(root, n, 'type'));
    if (type === 'Battery') battery = true;
    else if (/^(Mains|USB)/.test(type) && read(join(root, n, 'online')) === '1') return true;
  }
  return !battery;
}

/**
 * Lines of a `pmset -g log` excerpt that mark sleep between `start` and `end` (inclusive). Lines look like
 * `2026-11-27 03:14:15 -0800 Sleep   Entering Sleep state...`. Assertion lines are skipped: a keep-awake hold's own
 * name (PreventUserIdleSystemSleep) contains "Sleep" and says nothing about the machine sleeping.
 */
export function sleepInWindow(text, start, end) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})\s+(\S+)(.*)$/.exec(line);
    if (!m || m[6] === 'Assertions') continue;
    const at = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
    if (at >= start.getTime() && at <= end.getTime() && /Sleep|DarkWake|Maintenance/.test(m[6] + m[7])) out.push(line);
  }
  return out;
}

/** A device result counts as good when its install check passed and no part of it slept. */
export function deviceOk(r) {
  return !!r && r.install?.ok === true && !r.slept;
}

/** Newest result is good and under 20 hours old. */
export function isFresh(prev, now = new Date()) {
  const at = Date.parse(prev?.finishedAt ?? '');
  return deviceOk(prev) && Number.isFinite(at) && now.getTime() - at < FRESH_HOURS * HOUR;
}

/** Whether a device run should start: { run, why }. */
export function shouldRun({ force = false, onPower, lowPower = false, prev, now = new Date() }) {
  if (force) return { run: true, why: 'forced' };
  if (!onPower) return { run: false, why: 'on battery' };
  if (lowPower) return { run: false, why: 'low power mode' };
  if (isFresh(prev, now)) return { run: false, why: `newest result from ${prev.finishedAt} is good and under ${FRESH_HOURS}h old` };
  return { run: true, why: prev ? 'newest result is stale or not good' : 'no result yet' };
}

/** Weekly browser run: due when none was recorded or the last conclusive one is over 7 days old. */
export function browserDue(prev, now = new Date()) {
  const at = Date.parse(prev?.lastBrowser?.at ?? '');
  return !Number.isFinite(at) || now.getTime() - at > BROWSER_DAYS * 24 * HOUR;
}

/** Test files named on failing lines of a node --test log (spec or tap output), unique, in order. */
export function failedBrowserFiles(log) {
  const found = new Set();
  for (const line of log.split(/\r?\n/)) {
    if (!/not ok|✖|test at /.test(line)) continue;
    for (const m of line.matchAll(/((?:src|test)\/[\w./-]+\.test\.mjs)/g)) found.add(m[1]);
  }
  return [...found];
}

/** The project's rule: a red that passes alone three times is load; one that fails alone is real. */
export function rerunVerdict(passes, runs = 3) {
  return passes >= runs ? 'load' : 'real';
}

/** Re-runs `file` alone up to `runs` times via `runOnce(file) -> Promise<boolean>`; stops at the first failure. */
export async function rerunAlone(file, runOnce, runs = 3) {
  let passes = 0;
  for (let i = 0; i < runs; i++) {
    if (!(await runOnce(file))) break;
    passes++;
  }
  return { file, verdict: rerunVerdict(passes, runs), passes };
}

/** verify.mjs's summary.json as the published { ok, steps }. */
export function summarizeVerify(summary, code) {
  const steps = (summary?.rows ?? []).map(r => ({ name: r.name, ok: r.status === 'pass', seconds: Math.round(r.seconds ?? 0) }));
  return { ok: code === 0 && steps.length > 0 && steps.every(s => s.ok), steps };
}

/** The published result. `slept` is only present for device runs. */
export function makeResult({ os, sha, startedAt, finishedAt, verify = null, reruns = [], install, slept }) {
  const r = { os, sha, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), verify, reruns, install };
  if (slept !== undefined) r.slept = slept;
  return r;
}

// ---- running things ----------------------------------------------------------------------------------------------------

/** Failure reason for a command that hit its limit, else null. */
export function timeoutReason(r, minutes) {
  return r?.timedOut ? `timed out after ${minutes} min` : null;
}

/**
 * Runs a command, appending its output to `log`; resolves { code, out, timedOut } with the last 200 KB of output.
 * At `timeoutMs` the whole process tree is killed (a shell or caffeinate wrapper would otherwise leave its child).
 */
export function exec(cmd, args, { cwd, env, log, shell = false, timeoutMs } = {}) {
  return new Promise(done => {
    let out = '';
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const sink = d => {
      if (log) appendFileSync(log, d);
      out = (out + d).slice(-200_000);
    };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, timeoutMs) : null;
    child.on('error', e => done({ code: -1, out: String(e), timedOut }));
    child.on('close', code => { clearTimeout(timer); done({ code: code ?? 1, out, timedOut }); });
  });
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

async function loadState(deps) {
  return deps.state ?? await import('./lib/state.mjs');
}

async function publishResult(state, result, date) {
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await state.publish({ [`nightly/${date}-${result.os}.json`]: body, [`devices/${result.os}.json`]: body }, `${result.os} install check ${date}`);
}

function lastLine(text) {
  return text.trim().split(/\r?\n/).pop()?.slice(0, 200) ?? '';
}

/** Re-runs each red browser file alone (from the worktree root) and gives the verdicts. */
async function rerunReds(verifyRows, wt, logs) {
  const row = verifyRows.find(r => r.name === 'browser' && r.status !== 'pass');
  if (!row?.log || !existsSync(row.log)) return [];
  const files = failedBrowserFiles(readFileSync(row.log, 'utf8'));
  const runOnce = async f => (await exec(process.execPath, ['scripts/browser-tests.mjs', f], { cwd: wt, log: join(logs, 'rerun.log'), timeoutMs: 15 * MIN })).code === 0;
  const out = [];
  for (const f of files) out.push(await rerunAlone(f, runOnce));
  return out;
}

// ---- nightly (Windows) -------------------------------------------------------------------------------------------------

/** True when a marxy.exe process is running. */
function marxyRunning() {
  const q = spawnSync('tasklist', ['/FI', 'IMAGENAME eq marxy.exe', '/NH'], { encoding: 'utf8' });
  return /marxy\.exe/i.test(q.stdout ?? '');
}

/** Where the per-user installer put marxy.exe: the uninstall entry's folder, else the default. */
function installedExe() {
  const q = spawnSync('powershell', ['-NoProfile', '-Command',
    "(Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Marxy' } | Select-Object -First 1).InstallLocation"],
  { encoding: 'utf8' });
  const dir = (q.stdout ?? '').trim().replace(/^"|"$/g, '') || join(process.env.LOCALAPPDATA ?? '', 'Marxy');
  return join(dir, 'marxy.exe');
}

export async function nightly(args = [], deps = {}) {
  if (!WIN) { console.log('nightly: Windows only'); return 0; }
  const state = await loadState(deps);
  const startedAt = new Date();
  const date = pacificDate(startedAt);
  const ws = workspace(ROOT);
  const wt = join(ws.worktrees, 'nightly');
  const logs = join(state.stateDir(), 'logs', `nightly-${date}`);
  mkdirSync(logs, { recursive: true });

  // A detached tree on origin/main; ignored folders (node_modules, cargo target) stay so the builds are warm.
  git(ws.main, 'fetch', 'origin');
  if (existsSync(join(wt, '.git'))) {
    git(wt, 'checkout', '--detach', '--force', 'origin/main');
    git(wt, 'reset', '--hard', 'origin/main');
    git(wt, 'clean', '-fd');
  } else {
    mkdirSync(ws.worktrees, { recursive: true });
    git(ws.main, 'worktree', 'add', '--detach', wt, 'origin/main');
  }
  const sha = git(wt, 'rev-parse', 'HEAD').trim();

  const pnpm = args => exec('pnpm', args, { cwd: wt, shell: true, log: join(logs, 'install.log'), timeoutMs: 30 * MIN });
  let i = await pnpm(['install', '--offline']);
  if (i.code !== 0) i = await pnpm(['install']);
  let verify;
  let reruns = [];
  if (i.code !== 0) {
    // Nothing to verify without dependencies; the installer below installs its own.
    verify = { ok: false, steps: [], reason: timeoutReason(i, 30) ?? 'pnpm install failed' };
  } else {
    const v = await exec(process.execPath, ['scripts/verify.mjs', '--tier', 'full', '--logs', logs], { cwd: wt, log: join(logs, 'verify.out'), timeoutMs: 3 * HOUR });
    const summary = readJson(join(logs, 'summary.json'));
    verify = summarizeVerify(summary, v.code);
    if (v.timedOut) verify = { ...verify, ok: false, reason: timeoutReason(v, 180) };
    else reruns = await rerunReds(summary?.rows ?? [], wt, logs);
  }

  let install;
  if (marxyRunning()) {
    // The owner may have the app open and the installer would stop it. Not a failure, but not good either, so tomorrow retries.
    install = { ok: null, skipped: 'Marxy is running' };
  } else {
    // The repo's own installer path: build, self-sign, keep, install for this user. No launch there: the smoke
    // check below launches the installed exe on its own data folder, so the owner's settings stay untouched.
    const inst = await exec(process.execPath, ['scripts/work.mjs', 'installer', '-Ref', 'origin/main', '-Sign', 'self', '-NoLaunch'],
      { cwd: wt, log: join(logs, 'installer.log'), timeoutMs: 60 * MIN });
    const kept = /^installer:\s*(.+)$/m.exec(inst.out)?.[1]?.trim() ?? 'unknown';
    let smoke = 'not run';
    const exe = installedExe();
    if (inst.code === 0 && existsSync(exe)) {
      // Not "required": a locked screen delivers no frames, and the smoke script then says it skipped.
      const sm = await exec(process.execPath, ['apps/desktop/scripts/smoke-cli-open.mjs'], { cwd: wt, env: { MARXY_BIN: exe }, log: join(logs, 'smoke.log'), timeoutMs: 10 * MIN });
      smoke = sm.code !== 0 ? `fail (${timeoutReason(sm, 10) ?? lastLine(sm.out)})` : /skip/i.test(sm.out) ? 'skipped (no frames)' : 'pass';
    }
    install = {
      ok: inst.code === 0 && existsSync(exe) && !smoke.startsWith('fail'),
      notes: `${timeoutReason(inst, 60) ?? `installer exit ${inst.code}`}; kept ${kept}; installed exe ${existsSync(exe) ? exe : 'missing'}; smoke ${smoke}`,
    };
  }
  const result = makeResult({ os: 'windows', sha, startedAt, finishedAt: new Date(), verify, reruns, install });
  await publishResult(state, result, date);
  console.log(`nightly: ${sha.slice(0, 7)} verify ${verify.ok ? 'ok' : 'red'}, ${reruns.length} rerun(s), install ${install.ok === null ? 'skipped' : install.ok ? 'ok' : 'failed'}`);
  return 0;
}

// ---- device (macOS, Linux) ---------------------------------------------------------------------------------------------

function pmsetLog() {
  const r = spawnSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 1 << 29 });
  return r.stdout ?? '';
}

async function macCheck(prev, logs) {
  const ws = workspace(ROOT);
  const main = ws.main;
  const awake = (...a) => ['caffeinate', ['-dimsu', ...a]];
  let slept = false;
  const sleptIn = (a, b) => sleepInWindow(pmsetLog(), a, b).length > 0;

  const startedAt = new Date();
  // Pull only a checkout that is on a clean main; anything else is run as it stands.
  const clean = git(main, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main' && git(main, 'status', '--porcelain').trim() === '';
  const pull = clean ? spawnSync('git', ['-C', main, 'pull', '--ff-only'], { encoding: 'utf8' }) : { status: 0 };
  const pullNote = clean ? `pull ${pull.status === 0 ? 'ok' : 'failed'}` : 'checkout not on clean main, not pulled';
  const sha = git(main, 'rev-parse', 'HEAD').trim();
  // --no-install: the build, signature check and kept copy run, but the installed /Applications copy and its
  // Launch Services registration are not touched. The fresh bundle is then launched in place by the smoke check.
  const t0 = new Date();
  const [c1, a1] = awake(process.execPath, 'scripts/work.mjs', 'installer', '--no-install');
  const inst = await exec(c1, a1, { cwd: main, log: join(logs, 'installer.log'), timeoutMs: 60 * MIN });
  const app = join(ws.worktrees, 'app');
  const bin = join(app, 'apps/desktop/src-tauri/target/release/bundle/macos/Marxy.app/Contents/MacOS/marxy');
  let smoke = 'not run';
  if (pull.status === 0 && inst.code === 0 && existsSync(bin)) {
    const [c2, a2] = awake(process.execPath, join(app, 'apps/desktop/scripts/smoke-cli-open.mjs'));
    const s = await exec(c2, a2, { cwd: app, env: { MARXY_BIN: bin }, log: join(logs, 'smoke.log'), timeoutMs: 10 * MIN });
    smoke = s.code !== 0 ? `fail (${timeoutReason(s, 10) ?? lastLine(s.out)})` : /skip/i.test(s.out) ? 'skipped (no frames)' : 'pass';
  }
  let install;
  if (sleptIn(t0, new Date())) {
    slept = true;
    install = { ok: null, notes: 'inconclusive: slept' };
  } else {
    install = {
      ok: pull.status === 0 && inst.code === 0 && existsSync(bin) && !smoke.startsWith('fail'),
      notes: `${pullNote}; ${timeoutReason(inst, 60) ?? `installer exit ${inst.code}`} (no-install, /Applications untouched); smoke ${smoke}`,
    };
  }

  let verify = null;
  let lastBrowser = prev?.lastBrowser;
  if (browserDue(prev)) {
    const b0 = new Date();
    await exec('pnpm', ['install', '--frozen-lockfile', '--offline'], { cwd: main, shell: true, log: join(logs, 'install.log'), timeoutMs: 30 * MIN });
    const [c3, a3] = awake(process.execPath, 'scripts/verify.mjs', '--only', 'browser', '--logs', join(logs, 'browser'));
    const v = await exec(c3, a3, { cwd: main, log: join(logs, 'browser.out'), timeoutMs: 2 * HOUR });
    const b1 = new Date();
    verify = summarizeVerify(readJson(join(logs, 'browser', 'summary.json')), v.code);
    if (v.timedOut) verify = { ...verify, ok: false, reason: timeoutReason(v, 120) };
    if (sleptIn(b0, b1)) {
      slept = true;
      verify = { ...verify, ok: null, inconclusive: 'slept' };
    } else {
      lastBrowser = { at: b1.toISOString(), ok: verify.ok };
    }
  }
  const result = makeResult({ os: 'macos', sha, startedAt, finishedAt: new Date(), verify, install, slept });
  if (lastBrowser) result.lastBrowser = lastBrowser;
  return result;
}

function findFile(dir, re) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, re); if (f) return f; } else if (re.test(e.name)) return p;
  }
  return null;
}

/** Starts the AppImage and resolves { alive, out }: alive when still running after `waitMs`. */
function launchAppImage(bin, extra, env, inhibit, waitMs = 15_000) {
  return new Promise(done => {
    const cmd = inhibit ? ['systemd-inhibit', '--what=sleep:idle', '--why=marxy install check', bin, ...extra] : [bin, ...extra];
    const child = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let exited = false;
    const sink = d => { out = (out + d).slice(-20_000); };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    child.on('error', e => { exited = true; done({ alive: false, out: String(e) }); });
    child.on('exit', () => { exited = true; clearTimeout(timer); done({ alive: false, out }); });
    const timer = setTimeout(() => {
      if (exited) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      done({ alive: true, out });
    }, waitMs);
  });
}

async function linuxCheck() {
  const startedAt = new Date();
  const tmp = mkdtempSync(join(tmpdir(), 'marxy-auto-'));
  let sha = 'unknown';
  let install;
  try {
    const list = spawnSync('gh', ['run', 'list', '-R', 'inkstrata/marxy', '--workflow', 'installers', '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha'], { encoding: 'utf8', timeout: 5 * MIN });
    const run = list.status === 0 ? JSON.parse(list.stdout)[0] : null;
    if (!run) {
      install = { ok: false, notes: `no successful installers run on main (gh exit ${list.status})` };
    } else {
      sha = run.headSha;
      const dl = spawnSync('gh', ['run', 'download', String(run.databaseId), '-R', 'inkstrata/marxy', '-n', 'linux-appimage', '-D', tmp], { encoding: 'utf8', timeout: 15 * MIN });
      const bin = dl.status === 0 ? findFile(tmp, /\.AppImage$/) : null;
      if (!bin) {
        install = { ok: false, notes: `download of run ${run.databaseId} failed (gh exit ${dl.status})` };
      } else {
        spawnSync('chmod', ['+x', bin]);
        const inhibit = spawnSync('systemd-inhibit', ['--version']).status === 0;
        const env = { MARXY_DATA_DIR: join(tmp, 'data') };
        let l = await launchAppImage(bin, [], env, inhibit);
        let how = 'direct';
        if (!l.alive && /fuse/i.test(l.out)) {
          how = 'extract-and-run (no FUSE)';
          l = await launchAppImage(bin, ['--appimage-extract-and-run'], env, inhibit);
        }
        spawnSync(bin, ['--appimage-extract'], { cwd: tmp, stdio: 'ignore', timeout: 2 * MIN });
        const root = join(tmp, 'squashfs-root');
        const desktop = existsSync(root) && readdirSync(root).some(f => f.endsWith('.desktop'));
        install = {
          ok: l.alive && desktop,
          notes: `run ${run.databaseId}; launched ${how}; ${l.alive ? 'alive after 15s' : `exited early: ${lastLine(l.out)}`}; .desktop entry ${desktop ? 'present' : 'missing'}; inhibit ${inhibit ? 'on' : 'unavailable'}`,
        };
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return makeResult({ os: 'linux', sha, startedAt, finishedAt: new Date(), install, slept: false });
}

export async function device(args = [], deps = {}) {
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;
  if (!os) { console.log('device: macOS and Linux only'); return 0; }
  const state = await loadState(deps);
  const prevText = state.readPublished(`devices/${os}.json`);
  let prev = null;
  try { prev = prevText ? JSON.parse(prevText) : null; } catch {}
  const onPower = os === 'macos' ? macOnAc(spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout ?? '') : linuxOnExternalPower();
  const lowPower = os === 'macos' && macLowPower(spawnSync('pmset', ['-g'], { encoding: 'utf8' }).stdout ?? '');
  const d = shouldRun({ force: args.includes('--force'), onPower, lowPower, prev });
  if (!d.run) { console.log(`device: skip, ${d.why}`); return 0; }
  const date = pacificDate();
  const logs = join(state.stateDir(), 'logs', `device-${date}`);
  mkdirSync(logs, { recursive: true });
  const result = os === 'macos' ? await macCheck(prev, logs) : await linuxCheck();
  await publishResult(state, result, date);
  console.log(`device: ${os} ${result.sha.slice(0, 7)} install ${result.install.ok === null ? 'inconclusive (slept)' : result.install.ok ? 'ok' : 'failed'}`);
  return 0;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = { nightly, device }[cmd];
  if (!fn) { console.error('usage: node scripts/auto/device.mjs nightly|device [--force]'); process.exit(2); }
  try { process.exit(await fn(rest)); } catch (e) { console.error(`${cmd}: ${e.stack ?? e}`); process.exit(1); }
}
