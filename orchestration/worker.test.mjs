// A worker run always ends, and always says how (ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentArgs, superviseAgent, snapshotWip, prepareWorktree, reapplyNote, AUTH_FAILURE } from './worker.mjs';

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

// ── a reopened story is cut from main with its reverted work applied again (ADR-0043) ──

function reopenedWorld() {
  const dir = tmp();
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const at = cwd => (args, opts = {}) => {
    try { return { ok: true, out: execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim(), err: '' }; }
    catch (e) { return { ok: false, out: '', err: String(e.stderr || e.message) }; }
  };
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  at(dir)(['init', '-q', '--bare', '-b', 'main', origin]);
  at(dir)(['clone', '-q', origin, work]);
  const g = at(work);
  const land = (msg, files) => {
    for (const [f, t] of Object.entries(files)) { mkdirSync(join(work, f, '..'), { recursive: true }); writeFileSync(join(work, f), t); }
    g(['add', '-A']); g(['commit', '-q', '-m', msg]); g(['push', '-q', 'origin', 'HEAD:main']);
    return g(['rev-parse', 'HEAD']).out;
  };
  land('seed', { 'src/a.txt': 'one\n' });
  const sha = land('feat: story (MARXY-7) (#12)', { 'src/a.txt': 'one\ntwo\n', 'src/new.txt': 'new\n' });
  const revertSha = (() => { g(['revert', '--no-edit', sha]); g(['push', '-q', 'origin', 'HEAD:main']); return g(['rev-parse', 'HEAD']).out; })();
  // The merged story's old local branch is still there, at the seed: it must not be continued.
  g(['branch', 'feat/MARXY-7-story', 'HEAD~2']);
  return { g, land, sha, revertSha, spec: () => ({ key: 'MARXY-7', branch: 'feat/MARXY-7-story', worktree: join(dir, 'wt') }) };
}

test('a reopened story\'s worktree is cut from main with the reverted work applied again, not from its stale branch', () => {
  const w = reopenedWorld();
  const r = prepareWorktree(w.spec(), { g: w.g, reopened: { sha: w.sha, revertSha: w.revertSha } });
  assert.equal(r.ok, true);
  assert.equal(r.applied.how, 'revert');
  assert.equal(readFileSync(join(r.wt, 'src/a.txt'), 'utf8'), 'one\ntwo\n');
  assert.ok(existsSync(join(r.wt, 'src/new.txt')));
  assert.equal(execFileSync('git', ['-C', r.wt, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim(), w.revertSha, 'on top of current main');
  assert.equal(execFileSync('git', ['-C', r.wt, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

test('without the revert commit the original squash is cherry-picked; with neither, the branch is main and says so', () => {
  const byPick = reopenedWorld();
  const a = prepareWorktree(byPick.spec(), { g: byPick.g, reopened: { sha: byPick.sha } });
  assert.equal(a.applied.how, 'cherry-pick');
  assert.ok(existsSync(join(a.wt, 'src/new.txt')));
  const none = reopenedWorld();
  const b = prepareWorktree(none.spec(), { g: none.g, reopened: {} });
  assert.deepEqual([b.ok, b.applied.how], [true, null]);
  assert.match(reapplyNote({}, b.applied), /could not be re-applied/);
});

test('work that no longer applies is abandoned whole: a clean branch off main, and the prompt says where the work is', () => {
  const w = reopenedWorld();
  w.land('feat: touches the same line (MARXY-8) (#13)', { 'src/a.txt': 'one\nTWO\n' });
  const r = prepareWorktree(w.spec(), { g: w.g, reopened: { sha: w.sha, revertSha: w.revertSha } });
  assert.equal(r.ok, true);
  assert.equal(r.applied.how, null);
  assert.match(r.applied.why, /cherry-pick failed/);
  assert.equal(execFileSync('git', ['-C', r.wt, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'no half-applied change is left');
  assert.equal(readFileSync(join(r.wt, 'src/a.txt'), 'utf8'), 'one\nTWO\n');
  assert.match(reapplyNote({ sha: w.sha }, r.applied), new RegExp(`git show ${w.sha}`));
  assert.match(reapplyNote({ sha: w.sha }, { how: 'revert' }), /already on your branch/);
});

test('a story that was not reopened is cut as before, and a reopened one whose branch is already on origin continues it', () => {
  const w = reopenedWorld();
  const plain = prepareWorktree(w.spec(), { g: w.g });
  assert.equal(plain.applied, undefined);
  const w2 = reopenedWorld();
  w2.g(['push', '-q', 'origin', 'feat/MARXY-7-story']);
  w2.g(['fetch', '-q', 'origin']);
  const cont = prepareWorktree(w2.spec(), { g: w2.g, reopened: { sha: w2.sha } });
  assert.equal(cont.applied, undefined, 'an attempt already pushed is continued, not re-applied');
});
