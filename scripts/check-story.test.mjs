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
