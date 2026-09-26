// A worker run always ends, and always says how (ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentArgs, superviseAgent, snapshotWip, AUTH_FAILURE } from './worker.mjs';

process.env.MARXY_FLEET_DIR ??= mkdtempSync(join(tmpdir(), 'marxy-fleet-worker-'));
const tmp = () => mkdtempSync(join(tmpdir(), 'marxy-worker-'));

/** A fake agent CLI: a node script that behaves as `body` says, whatever arguments it gets. */
function fakeAgent(body) {
  const dir = tmp();
  const bin = join(dir, 'agent');
  writeFileSync(bin, `#!${process.execPath}\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
const spec = over => ({
  id: `MARXY-1.implement.${Math.random().toString(36).slice(2)}`, key: 'MARXY-1', model: 'm', prompt: 'p',
  deadline: new Date(Date.now() + 60_000).toISOString(), stallMinutes: 10, ...over,
});

test('the agent streams json output and runs under the model and effort it was given', () => {
  const a = agentArgs({ model: 'composer-2.5', effort: 'high', cliEffortFlag: '--reasoning-effort', prompt: 'do it' });
  assert.deepEqual(a.slice(0, 5), ['-p', '--force', '--trust', '--output-format', 'stream-json']);
  assert.deepEqual(a.slice(-5), ['--model', 'composer-2.5', '--reasoning-effort', 'high', 'do it']);
  assert.ok(!agentArgs({ model: 'x', effort: 'high', prompt: 'p' }).includes('high'), 'no effort flag without a CLI flag for it');
});

test('an agent that exits is recorded with its code', async () => {
  const r = await superviseAgent(spec(), { bin: fakeAgent('console.log("done"); process.exit(0)'), poll: 50 });
  assert.deepEqual([r.outcome, r.code], ['exited', 0]);
  assert.ok(r.logBytes > 0);
});

test('an agent past its deadline is stopped with its whole group and recorded as a timeout', async () => {
  const bin = fakeAgent('setInterval(() => console.log("working"), 20)');
  const t0 = Date.now();
  const r = await superviseAgent(spec({ deadline: new Date(Date.now() + 300).toISOString() }), { bin, poll: 50 });
  assert.equal(r.outcome, 'timeout');
  assert.ok(Date.now() - t0 < 15_000);
});

test('an agent that goes silent for stallMinutes is stopped and recorded as stalled', async () => {
  const bin = fakeAgent('console.log("started"); setTimeout(() => {}, 60_000)');
  let clock = Date.now();
  const r = await superviseAgent(spec({ stallMinutes: 1, deadline: new Date(Date.now() + 86_400_000).toISOString() }), { bin, poll: 50, now: () => (clock += 20_000) });
  assert.equal(r.outcome, 'stalled');
});

test('an authentication failure is its own outcome, so the attempt is refunded', async () => {
  const bin = fakeAgent('console.error("Error: Authentication required. Please run \'agent login\' first"); process.exit(1)');
  const r = await superviseAgent(spec(), { bin, poll: 50 });
  assert.equal(r.outcome, 'auth');
  assert.ok(AUTH_FAILURE.test('Please run agent login'));
});

test('a dirty worktree is snapshotted to a fleet ref before reuse, and left exactly as it was', () => {
  const repo = tmp();
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'root');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  const g = args => { try { return { ok: true, out: execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim() }; } catch (e) { return { ok: false, out: '', err: String(e) }; } };
  const ref = snapshotWip(repo, 'MARXY-1', { g });
  assert.match(ref, /^refs\/fleet\/wip\/MARXY-1\//);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n', 'the worktree is untouched');
  assert.equal(git('show', `${ref}:a.txt`), 'two');
  assert.equal(git('stash', 'list'), '', 'refs/stash, shared by every worktree, is not used');
  assert.equal(snapshotWip(repo, 'MARXY-1', { g: args => (args[0] === 'status' ? { ok: true, out: '' } : g(args)) }), null, 'a clean worktree needs no snapshot');
  assert.ok(existsSync(process.env.MARXY_FLEET_DIR));
});
