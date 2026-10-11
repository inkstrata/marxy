// The `ci` job's verdict (A-09): what turns the one required check red, fed the needs-JSON GitHub
// passes it for each shape of run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verdict } from './ci-verdict.mjs';

const answered = (over = {}) => ({ docs_only: 'false', web: 'false', rust: 'false', lockfile: 'false', ...over });
const run = (changes, rest) => ({
  changes,
  conventions: { result: 'skipped', outputs: {} },
  fast: { result: 'skipped', outputs: {} },
  'browser-lite': { result: 'skipped', outputs: {} },
  rust: { result: 'skipped', outputs: {} },
  ...rest,
});
const ok = (outputs) => ({ result: 'success', outputs });
const done = { result: 'success', outputs: {} };

test('the jobs these cases feed the verdict are exactly the ci job\'s needs in ci.yml', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = ci.slice(ci.search(/^  ci:\s*$/m));
  const needs = /^    needs:\s*\[([^\]]*)\]/m.exec(job)?.[1].split(',').map(s => s.trim());
  assert.deepEqual(needs, Object.keys(run(ok(answered()), {})), 'rename a job in ci.yml and in these cases together');
});

test('a docs-only pull request, every product job skipped, is green', () => {
  const r = verdict(run(ok(answered({ docs_only: 'true' })), { conventions: done }));
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a push to main that ran only changes and fast is green', () => {
  const r = verdict(run(ok(answered({ web: 'true' })), { fast: done }));
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a product pull request with every job green is green', () => {
  const r = verdict(run(ok(answered({ web: 'true', rust: 'true' })), { conventions: done, fast: done, 'browser-lite': done, rust: done }));
  assert.equal(r.ok, true, r.errors.join('; '));
});

for (const result of ['failure', 'cancelled']) {
  test(`changes ${result}, so everything after it skipped, is red`, () => {
    const r = verdict(run({ result, outputs: {} }, {}));
    assert.equal(r.ok, false);
    assert.match(r.errors.join('; '), new RegExp(`changes: ${result}`));
  });
}

test('changes succeeded without answering every output is red, though every other job skipped', () => {
  const r = verdict(run(ok({ docs_only: 'false', web: 'true' }), { fast: done }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('; '), /changes did not answer: rust, lockfile/);
});

test('an answer that is neither true nor false is no answer', () => {
  const r = verdict(run(ok(answered({ rust: '' })), {}));
  assert.equal(r.ok, false);
});

test('needs without changes at all is red', () => {
  const { changes, ...rest } = run(ok(answered()), {});
  assert.equal(verdict(rest).ok, false);
});

for (const job of ['conventions', 'fast', 'browser-lite', 'rust']) {
  for (const result of ['failure', 'cancelled']) {
    test(`${job} ${result} is red`, () => {
      const r = verdict(run(ok(answered({ web: 'true', rust: 'true' })), { fast: done, [job]: { result, outputs: {} } }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join('; '), new RegExp(`${job}: ${result}`));
    });
  }
}

// A matrix job is one entry in `needs` whose result is the aggregate of its legs: success when every leg
// succeeded, failure when any failed, cancelled when one was cancelled (browser-lite is two shards).
test('browser-lite is a matrix in ci.yml, so its one `needs` entry stands for every shard', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = ci.slice(ci.search(/^  browser-lite:\s*$/m)).split(/^  [a-z-]+:\s*$/m)[1] ?? '';
  assert.match(job, /strategy:\s*\n\s+fail-fast: false\s*\n\s+matrix:\s*\n\s+shard: \[1, 2\]/, 'browser-lite must shard 1/2 and let both legs report');
  assert.match(job, /--test-shard=\$\{\{ matrix\.shard \}\}\/2/);
});

test('a failed shard fails the aggregate browser-lite entry, which fails the verdict', () => {
  const r = verdict(run(ok(answered({ web: 'true' })), { fast: done, 'browser-lite': { result: 'failure', outputs: {} } }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('; '), /browser-lite: failure/);
});

test('the removed outputs do not count: answering typography or fleet is not required, and answering only the four is enough', () => {
  const r = verdict(run(ok({ docs_only: 'false', web: 'true', rust: 'false', lockfile: 'false' }), { fast: done, 'browser-lite': done }));
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('the command reads NEEDS and exits non-zero on a red verdict and on unreadable input', () => {
  const script = fileURLToPath(new URL('./ci-verdict.mjs', import.meta.url));
  const go = needs => spawnSync(process.execPath, [script], { env: { ...process.env, NEEDS: needs }, encoding: 'utf8' });
  assert.equal(go(JSON.stringify(run(ok(answered({ docs_only: 'true' })), {}))).status, 0);
  assert.equal(go(JSON.stringify(run(ok(answered()), { rust: { result: 'cancelled', outputs: {} } }))).status, 1);
  assert.equal(go('').status, 1);
});
