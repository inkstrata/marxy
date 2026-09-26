// loop.sh stopped between cycles leaves nothing running behind it (MARXY-210).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const sleepers = interval =>
  execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter(m => m && m[2] === `sleep ${interval}`)
    .map(m => Number(m[1]));

const until = async (cond, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return true;
};

test('stopping the loop mid-sleep stops the sleep too', async () => {
  // A copy of the loop beside a cycle that does nothing, so the test runs no real cycle.
  const root = mkdtempSync(join(tmpdir(), 'marxy-loop-'));
  mkdirSync(join(root, 'orchestration'));
  copyFileSync(join(import.meta.dirname, 'loop.sh'), join(root, 'orchestration/loop.sh'));
  writeFileSync(join(root, 'orchestration/cycle.mjs'), '');
  // An interval no other process on the machine is sleeping for, so the sleep is findable by name.
  const interval = 86_400 + (process.pid % 10_000);
  const fleet = join(root, 'fleet');
  // MARXY_RUNNER=0: run this copy's cycle, not a runner worktree; the temp dir is no git checkout.
  const env = { ...process.env, INTERVAL: String(interval), MARXY_FLEET_DIR: fleet, MARXY_RUNNER: '0', PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  const loop = spawn('bash', [join(root, 'orchestration/loop.sh'), 'run'], { cwd: root, env, stdio: 'ignore' });
  const exited = new Promise(r => loop.on('exit', r));
  try {
    assert.ok(await until(() => sleepers(interval).length > 0), 'the loop reached its sleep');
    assert.equal(existsSync(join(fleet, 'loop.lease')), true, 'the lease is in the fleet store');
    loop.kill('SIGTERM');
    await exited;
    assert.ok(await until(() => sleepers(interval).length === 0, 2_000), `sleep ${interval} outlived the loop`);
    assert.equal(existsSync(join(fleet, 'loop.lease')), false, 'the lease is removed');
  } finally {
    loop.kill('SIGKILL');
    for (const pid of sleepers(interval)) try { process.kill(pid); } catch { /* gone */ }
  }
});

// The runner worktree (code_root in loop.sh): the loop runs what is on origin/main, from a checkout
// the fleet owns, and never discards what an agent left in it.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' }).trim();

/** A checkout with loop.sh in it, a bare origin, and a cycle that records where it ran from. */
function runnerRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marxy-runner-')));
  git(root, 'init', '-q', '--bare', 'origin.git');
  const home = join(root, 'home');
  git(root, 'init', '-q', '-b', 'main', 'home');
  git(home, 'remote', 'add', 'origin', join(root, 'origin.git'));
  mkdirSync(join(home, 'orchestration'));
  copyFileSync(join(import.meta.dirname, 'loop.sh'), join(home, 'orchestration/loop.sh'));
  writeFileSync(join(home, 'orchestration/cycle.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync(`${process.env.MARXY_FLEET_DIR}/ran-from`, import.meta.dirname);\n");
  git(home, 'add', '.');
  git(home, 'commit', '-q', '-m', 'init');
  git(home, 'push', '-q', 'origin', 'main');
  const fleet = join(root, 'fleet');
  const env = { ...process.env, ONCE: '1', MARXY_FLEET_DIR: fleet, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  delete env.MARXY_RUNNER;
  const cycle = () => execFileSync('bash', [join(home, 'orchestration/loop.sh'), 'run'], { cwd: home, env, stdio: 'pipe' });
  return { root, home, fleet, runner: join(fleet, 'runner'), cycle, ranFrom: () => readFileSync(join(fleet, 'ran-from'), 'utf8') };
}

test('the first cycle creates the runner at origin/main and runs the cycle from it', () => {
  const r = runnerRepo();
  r.cycle();
  assert.equal(git(r.runner, 'rev-parse', 'HEAD'), git(r.home, 'rev-parse', 'origin/main'));
  assert.equal(git(r.runner, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
  assert.equal(r.ranFrom(), join(r.runner, 'orchestration'));
});

test('a merge to origin/main takes effect on the next cycle', () => {
  const r = runnerRepo();
  r.cycle();
  writeFileSync(join(r.home, 'merged.txt'), 'm\n');
  git(r.home, 'add', '.');
  git(r.home, 'commit', '-q', '-m', 'merged fix');
  git(r.home, 'push', '-q', 'origin', 'main');
  r.cycle();
  assert.equal(git(r.runner, 'rev-parse', 'HEAD'), git(r.home, 'rev-parse', 'HEAD'));
  assert.equal(existsSync(join(r.runner, 'merged.txt')), true);
});

test('what an agent left in the runner is kept on a fleet/wip ref before the reset', () => {
  const r = runnerRepo();
  r.cycle();
  writeFileSync(join(r.runner, 'orchestration/cycle.mjs'), '// an agent edited the runner\n');
  r.cycle();
  const refs = git(r.home, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/fleet/wip/runner/').split('\n').filter(Boolean);
  assert.equal(refs.length, 1);
  const [ref, sha] = refs[0].split(' ');
  assert.match(ref, /^refs\/fleet\/wip\/runner\/\d{8}T\d{6}Z$/);
  assert.equal(git(r.home, 'show', `${sha}:orchestration/cycle.mjs`), '// an agent edited the runner');
  assert.equal(git(r.runner, 'status', '--porcelain', '--untracked-files=no'), '', 'the runner is back to origin/main');
  assert.match(r.ranFrom(), /orchestration$/, 'and the real cycle ran again');
});

test('a clean runner leaves no wip ref', () => {
  const r = runnerRepo();
  r.cycle();
  r.cycle();
  assert.equal(git(r.home, 'for-each-ref', 'refs/fleet/wip/runner/'), '');
});

test('MARXY_RUNNER=0 runs this checkout and creates no runner', () => {
  const r = runnerRepo();
  execFileSync('bash', [join(r.home, 'orchestration/loop.sh'), 'run'], { cwd: r.home, env: { ...process.env, ONCE: '1', MARXY_FLEET_DIR: r.fleet, MARXY_RUNNER: '0', PATH: `${dirname(process.execPath)}:${process.env.PATH}` }, stdio: 'pipe' });
  assert.equal(r.ranFrom(), join(r.home, 'orchestration'));
  assert.equal(existsSync(r.runner), false);
});
