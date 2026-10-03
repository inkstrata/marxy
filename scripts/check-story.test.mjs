// The story boundary must let a values-only tokens.css tune through without an ADR,
// and (ADR-0045) no longer refuses a shell-api or contracts change that has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Stage `file` in a throwaway index so this suite never touches the worktree's real index. */
function checkStoryStaged(file) {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-139-'));
  const index = join(dir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: ROOT, env });
    const current = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8' });
    const hash = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: ROOT,
      input: `${current}\n`,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${hash},${file}`], {
      cwd: ROOT,
      env,
    });
    return spawnSync(process.execPath, ['scripts/check-story.mjs', '--staged', '--key', 'MARXY-999'], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('staged tokens.css, shell-api and contracts changes with no ADR exit 0 (ADR-0045)', () => {
  for (const f of ['packages/theme/src/tokens.css', 'packages/shell-api/src/index.ts', 'packages/core/src/contracts/position.ts']) {
    const run = checkStoryStaged(f);
    assert.equal(run.status, 0, f + run.stderr + run.stdout);
    assert.match(run.stdout, /story-check ok/);
  }
});

test('registry has no frozen list and the note keeps the token contract', () => {
  const reg = JSON.parse(readFileSync('scripts/registry.json', 'utf8'));
  assert.equal('frozen' in reg, false);
  assert.match(reg._note, /tokens\.css/);
  assert.match(reg._note, /names and units/);
  assert.match(reg._note, /scripts\/check-tokens\.mjs/);
  assert.match(reg._note, /ADR-0031/);
  assert.match(reg._note, /not its bytes/);
});

test('no byte-pin script remains and check-tokens is green and does not read registry.json', () => {
  assert.deepEqual(Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts).filter(k => /frozen/.test(k)), []);
  const tokens = spawnSync(process.execPath, ['scripts/check-tokens.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tokens.status, 0, tokens.stderr + tokens.stdout);
  const checkTokens = readFileSync('scripts/check-tokens.mjs', 'utf8');
  assert.equal(/registry\.json/.test(checkTokens), false);
  assert.equal(/\bfrozen\b/.test(checkTokens), false);
});

test('hygiene contracts line says they change by pull request', () => {
  const lines = readFileSync('docs/hygiene.md', 'utf8').split('\n').filter(l => /^- Contracts:/.test(l));
  assert.equal(lines.length, 1, lines);
  assert.match(lines[0], /ADR-0045/);
  assert.doesNotMatch(lines[0], /byte-pinned/);
  assert.match(lines[0], /packages\/theme\/src\/tokens\.css/);
});

// MARXY-153: the CI story-boundary step was wrapped in `|| echo "::warning::"` and so could never
// fail. The reason was not the CSV row its comment blamed — a pull-request checkout is detached,
// `git rev-parse --abbrev-ref HEAD` answers "HEAD", and no key could be read from it, so the step
// could never *pass* either. Reading GITHUB_HEAD_REF is what lets it run unguarded on CI.
test('MARXY-153: a story key is read from the branch slug, wherever the branch name comes from', async () => {
  const { keyFromBranch } = await import('./lib/repo.mjs');
  assert.equal(keyFromBranch('ci/MARXY-153-minimal-fast-ci'), 'MARXY-153');
  assert.equal(keyFromBranch('feat/MARXY-26-images'), 'MARXY-26');
  assert.equal(keyFromBranch('MARXY-7'), 'MARXY-7');
  assert.equal(keyFromBranch('HEAD'), null, 'a detached checkout yields no key, which is the bug this fixes');
  assert.equal(keyFromBranch(''), null);
  assert.equal(keyFromBranch(undefined), null);
});

test('MARXY-153: on a detached pull-request checkout the branch comes from GITHUB_HEAD_REF', async () => {
  const { resolveBranch } = await import('./lib/repo.mjs');
  const pr = { GITHUB_HEAD_REF: 'ci/MARXY-153-slug', GITHUB_REF_NAME: '121/merge' };
  // Detached, as every pull-request checkout is: the env answers, and the PR head beats the ref.
  assert.equal(resolveBranch('HEAD', pr), 'ci/MARXY-153-slug');
  assert.equal(resolveBranch('HEAD', { GITHUB_REF_NAME: 'main' }), 'main', 'a push has no HEAD_REF');
  assert.equal(resolveBranch('HEAD', {}), 'HEAD', 'outside CI a detached checkout still has no name');
  // Attached: the real branch wins, so `pnpm done` and the commit hook are unaffected by the env.
  assert.equal(resolveBranch('ci/MARXY-153-minimal-fast-ci', pr), 'ci/MARXY-153-minimal-fast-ci');
  assert.equal(resolveBranch('main', pr), 'main');
});
