// planEvents (C-11): one batch of watch events against one root becomes one small plan.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { denyRulesFor, ignoreRulesFrom, parseIgnore, planEvents } from './index.ts';

const root = '/r';
const none = new Set<string>();

test('write-temp-then-rename onto an existing path re-reads that path, and only that path', () => {
  const known = new Set(['/r/notes.md']);
  // The tree watch reports the new inode at the old path as `renamed` with no `to` (C-05 `diff`).
  assert.deepEqual(planEvents(known, [{ kind: 'renamed', path: '/r/notes.md' }], root, []), {
    reread: ['/r/notes.md'],
    remove: [],
    revalidate: false,
  });
  // A watcher that sees the temp file reports the move from it.
  assert.deepEqual(
    planEvents(known, [{ kind: 'created', path: '/r/.notes.md.tmp' }, { kind: 'renamed', path: '/r/.notes.md.tmp', to: '/r/notes.md' }], root, []),
    { reread: ['/r/notes.md'], remove: [], revalidate: false },
  );
});

test('a delete removes the entry; a delete of a file the root never listed changes nothing', () => {
  const known = new Set(['/r/a.md']);
  assert.deepEqual(planEvents(known, [{ kind: 'removed', path: '/r/a.md' }], root, []), { reread: [], remove: ['/r/a.md'], revalidate: false });
  assert.deepEqual(planEvents(known, [{ kind: 'removed', path: '/r/b.md' }], root, []), { reread: [], remove: [], revalidate: false });
});

test('a path under node_modules, matched by .gitignore, or denied by a glob is never read', () => {
  const rules = parseIgnore('generated/\n*.draft.md\n', '');
  const deny = denyRulesFor(['**/private/**']);
  const plan = planEvents(
    none,
    [
      { kind: 'created', path: '/r/node_modules/pkg/README.md' },
      { kind: 'created', path: '/r/generated/out.md' },
      { kind: 'modified', path: '/r/idea.draft.md' },
      { kind: 'created', path: '/r/notes/private/secret.md' },
      { kind: 'created', path: '/r/image.png' },
      { kind: 'created', path: '/r/kept.md' },
    ],
    root,
    rules,
    deny,
  );
  assert.deepEqual(plan, { reread: ['/r/kept.md'], remove: [], revalidate: false });
});

test('a file that becomes denied while listed is dropped, not kept stale', () => {
  const known = new Set(['/r/private/a.md']);
  const plan = planEvents(known, [{ kind: 'modified', path: '/r/private/a.md' }], root, [], denyRulesFor(['private/']));
  assert.deepEqual(plan, { reread: [], remove: ['/r/private/a.md'], revalidate: false });
});

test('a rename out of the root removes only; a rename into it reads only the new path', () => {
  const known = new Set(['/r/a.md']);
  assert.deepEqual(planEvents(known, [{ kind: 'renamed', path: '/r/a.md', to: '/elsewhere/a.md' }], root, []), {
    reread: [],
    remove: ['/r/a.md'],
    revalidate: false,
  });
  assert.deepEqual(planEvents(none, [{ kind: 'renamed', path: '/elsewhere/b.md', to: '/r/b.md' }], root, []), {
    reread: ['/r/b.md'],
    remove: [],
    revalidate: false,
  });
  // A sibling folder that shares the root's name as a prefix is outside it.
  assert.deepEqual(planEvents(none, [{ kind: 'created', path: '/r2/c.md' }], root, []), { reread: [], remove: [], revalidate: false });
});

test('a change to a .gitignore or .ignore, at any depth, asks for the root to be walked again', () => {
  for (const path of ['/r/.gitignore', '/r/docs/.ignore']) {
    for (const kind of ['created', 'modified', 'removed'] as const) {
      assert.equal(planEvents(none, [{ kind, path }], root, []).revalidate, true, `${kind} ${path}`);
    }
  }
  assert.equal(planEvents(none, [{ kind: 'modified', path: '/elsewhere/.gitignore' }], root, []).revalidate, false);
  assert.equal(planEvents(none, [{ kind: 'modified', path: '/r/a.md' }], root, []).revalidate, false);
});

test('the last event for a path decides it', () => {
  const known = new Set(['/r/a.md']);
  assert.deepEqual(
    planEvents(known, [{ kind: 'removed', path: '/r/a.md' }, { kind: 'created', path: '/r/a.md' }], root, []),
    { reread: ['/r/a.md'], remove: [], revalidate: false },
  );
  assert.deepEqual(
    planEvents(known, [{ kind: 'modified', path: '/r/a.md' }, { kind: 'removed', path: '/r/a.md' }], root, []),
    { reread: [], remove: ['/r/a.md'], revalidate: false },
  );
  // Twenty writes to one file are one read.
  const burst = Array.from({ length: 20 }, () => ({ kind: 'modified' as const, path: '/r/a.md' }));
  assert.deepEqual(planEvents(known, burst, root, []).reread, ['/r/a.md']);
});

test('ignoreRulesFrom orders a folder before its subfolders, so a nested negation wins as in the walk', () => {
  const files = new Map([
    ['/r/docs/.gitignore', '!keep.md\n'],
    ['/r/.gitignore', '*.md\n'],
    ['/elsewhere/.gitignore', 'everything\n'],
  ]);
  const rules = ignoreRulesFrom(root, files);
  assert.deepEqual(rules.map((r) => `${r.baseDir}:${r.negated ? '!' : ''}${r.pattern}`), [':*.md', 'docs:!keep.md']);
  assert.deepEqual(
    planEvents(none, [{ kind: 'created', path: '/r/docs/keep.md' }, { kind: 'created', path: '/r/docs/other.md' }], root, rules).reread,
    ['/r/docs/keep.md'],
  );
});
