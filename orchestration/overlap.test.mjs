// overlap() must understand globs and stop treating a shared string prefix as a collision
// (MARXY-119).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlap, extraAllowedPaths, ROOT, readJson } from './lib.mjs';

test('a glob overlaps the concrete path it can match, in both orders', () => {
  assert.equal(overlap(['packages/*/package.json'], ['packages/core/package.json']), true);
  assert.equal(overlap(['packages/core/package.json'], ['packages/*/package.json']), true);
});

test('a shared string prefix that is not a shared path segment does not overlap', () => {
  assert.equal(overlap(['packages/core/src/parse'], ['packages/core/src/parser']), false);
});

test('a directory overlaps a glob that can match beneath it', () => {
  assert.equal(overlap(['packages/core'], ['packages/*/src/x.ts']), true);
});

test('sibling files under the same directory do not overlap', () => {
  assert.equal(
    overlap(['apps/desktop/src/palette/session.ts'], ['apps/desktop/src/palette/search.ts']),
    false,
  );
});

test('a directory still overlaps a file beneath it (no glob involved)', () => {
  assert.equal(overlap(['docs/adr'], ['docs/adr/README.md']), true);
});

test('equal paths overlap', () => {
  assert.equal(overlap(['a/b.ts'], ['a/b.ts']), true);
});

test('the ignored-paths list is read from scripts/registry.json, not duplicated here', () => {
  const registry = readJson(`${ROOT}scripts/registry.json`);
  assert.deepEqual(extraAllowedPaths(), registry.extraAllowedPaths);
  assert.ok(registry.extraAllowedPaths.length > 0, 'the registry must actually list something to ignore');
  for (const p of registry.extraAllowedPaths) {
    assert.equal(overlap([p], [p]), false, `${p} is on extraAllowedPaths and must not serialise two stories`);
  }
});

test('two stories that both list CHANGELOG.md do not serialise', () => {
  assert.equal(overlap(['CHANGELOG.md'], ['CHANGELOG.md']), false);
  assert.equal(overlap(['orchestration/lib.mjs', 'CHANGELOG.md'], ['scripts/registry.json', 'CHANGELOG.md']), false);
});
