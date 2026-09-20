// The story boundary must let a values-only tokens.css tune through without an ADR,
// and must still refuse a shell-api or contracts change that has none (ADR-0031).
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

test('staged tokens.css with no ADR exits 0; staged shell-api with no ADR exits 1 naming the file', () => {
  const tokens = checkStoryStaged('packages/theme/src/tokens.css');
  assert.equal(tokens.status, 0, tokens.stderr + tokens.stdout);
  assert.match(tokens.stdout, /story-check ok/);

  const shell = checkStoryStaged('packages/shell-api/src/index.ts');
  assert.equal(shell.status, 1, shell.stderr + shell.stdout);
  assert.match(shell.stderr, /packages\/shell-api\/src\/index\.ts/);
  assert.match(shell.stderr, /frozen contract file/);
});

test('staged packages/core/src/contracts/ change with no ADR exits 1', () => {
  const run = checkStoryStaged('packages/core/src/contracts/ast.ts');
  assert.equal(run.status, 1, run.stderr + run.stdout);
  assert.match(run.stderr, /packages\/core\/src\/contracts\/ast\.ts/);
});

test('frozen array lists contracts and shell-api and does not list tokens.css', () => {
  const reg = JSON.parse(readFileSync('scripts/registry.json', 'utf8'));
  assert.deepEqual(reg.frozen, ['packages/core/src/contracts/', 'packages/shell-api/src/']);
  assert.match(reg._note, /tokens\.css/);
  assert.match(reg._note, /names and units/);
  assert.match(reg._note, /scripts\/check-tokens\.mjs/);
  assert.match(reg._note, /ADR-0031/);
  assert.match(reg._note, /not its bytes/);
});

test('contracts-frozen and check-tokens are green and do not read registry.json frozen for tokens.css', () => {
  const frozen = spawnSync('pnpm', ['test:contracts-frozen'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(frozen.status, 0, frozen.stderr + frozen.stdout);
  const tokens = spawnSync(process.execPath, ['scripts/check-tokens.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tokens.status, 0, tokens.stderr + tokens.stdout);

  const checkTokens = readFileSync('scripts/check-tokens.mjs', 'utf8');
  assert.equal(/registry\.json/.test(checkTokens), false);
  assert.equal(/\bfrozen\b/.test(checkTokens), false);
  const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:contracts-frozen'];
  assert.equal(/registry\.json/.test(script), false);
  assert.equal(/tokens\.css/.test(script), false);
});

test('hygiene frozen-files section states the split in one sentence', () => {
  const lines = readFileSync('docs/hygiene.md', 'utf8').split('\n').filter(l => /^- Frozen:/.test(l));
  assert.equal(lines.length, 1, lines);
  const sentence = lines[0];
  assert.match(sentence, /byte-pinned/);
  assert.match(sentence, /packages\/\*\/src\/contracts\//);
  assert.match(sentence, /packages\/shell-api\/src\//);
  assert.match(sentence, /name-and-unit/);
  assert.match(sentence, /packages\/theme\/src\/tokens\.css/);
  assert.doesNotMatch(sentence, /\.\s+[A-Z]/);
});
