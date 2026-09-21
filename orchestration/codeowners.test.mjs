// CODEOWNERS parsing and the approval rule the merge bar relies on (MARXY-172).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeOwnerPatterns, ownedBy, ownersOf, codeOwnerStatus } from './codeowners.mjs';

const HEAD = 'a'.repeat(40);

test('directory lines match by prefix and file lines exactly', () => {
  const p = codeOwnerPatterns('# c\n/a/dir/ @x\n/a/file.mjs @x\n');
  assert.ok(ownedBy(p, 'a/dir/deep/f.ts'));
  assert.ok(ownedBy(p, 'a/file.mjs'));
  assert.ok(!ownedBy(p, 'a/file.mjs.bak'));
  assert.ok(!ownedBy(p, 'a/other.ts'));
});

test('a glob line matches within a segment and ** crosses directories', () => {
  const p = codeOwnerPatterns('/apps/*/src-tauri/ @x\n/docs/**/secret.md @x\n');
  assert.ok(ownedBy(p, 'apps/desktop/src-tauri/tauri.conf.json'));
  assert.ok(!ownedBy(p, 'apps/desktop/src/main.ts'));
  assert.ok(ownedBy(p, 'docs/a/b/secret.md'));
});

test('the last matching line decides the owners, as on GitHub', () => {
  const p = codeOwnerPatterns('/src/ @a\n/src/gen/ @b\n');
  assert.deepEqual(ownersOf(p, 'src/x.ts'), ['a']);
  assert.deepEqual(ownersOf(p, 'src/gen/y.ts'), ['b']);
  assert.deepEqual(ownersOf(p, 'docs/z.md'), []);
});

test('a team owner never counts as approved, so a person has to decide', () => {
  const r = codeOwnerStatus({
    files: ['src/x.ts'],
    codeowners: '/src/ @org/team\n',
    reviews: [{ author: { login: 'org' }, state: 'APPROVED', commit: { oid: HEAD } }],
    headRefOid: HEAD,
  });
  assert.deepEqual(r.unapproved, ['src/x.ts']);
});

test('a review with no commit recorded still counts (dismiss_stale_reviews drops old ones)', () => {
  const r = codeOwnerStatus({
    files: ['src/x.ts'],
    codeowners: '/src/ @a\n',
    reviews: [{ author: { login: 'a' }, state: 'APPROVED' }],
    headRefOid: HEAD,
  });
  assert.deepEqual(r.unapproved, []);
});
