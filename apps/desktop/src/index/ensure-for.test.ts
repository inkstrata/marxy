// Which roots are walked without a budget, and how `ensureFor` settles when opens overtake one another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkPolicy } from './home-sized.ts';
import { createIndexService } from './service.ts';
import { createMemoryShell } from '../shell/memory.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('a drive, a share or a volume root is budgeted; a folder on it is not', () => {
  for (const root of ['E:/', 'E:', 'e:\\', '//nas/share', '\\\\nas\\share', '/Volumes/Stick']) {
    const policy = walkPolicy(root, 'C:/Users/me');
    assert.equal(policy.budget, 5000, root);
    assert.equal(policy.snapshotOnlyWhenRecent, true, root);
  }
  for (const root of ['E:/scans', '//nas/share/docs', '/Volumes/Stick/docs', 'C:/Dev/repo']) assert.equal(walkPolicy(root, 'C:/Users/me').budget, undefined, root);
});

test('two ensureFor calls resolving out of order: both roots are held, the later open is first', async () => {
  const base = createMemoryShell({
    '/a/.git/HEAD': enc('ref\n'),
    '/a/x.md': enc('# x\n'),
    '/b/.git/HEAD': enc('ref\n'),
    '/b/y.md': enc('# y\n'),
  });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let first = true;
  const shell = Object.assign(Object.create(base) as typeof base, {
    async readDir(dir: string) {
      // Finding a root starts with its parent's listing: the first open's is the slow one.
      if (dir === '/' && first) {
        first = false;
        await held;
      }
      return base.readDir(dir);
    },
  });
  const index = createIndexService(shell);
  try {
    const early = index.ensureFor('/a/x.md');
    const second = index.ensureFor('/b/y.md');
    await second;
    release();
    await early;
    await index.settled();
    assert.deepEqual([...index.roots()].sort(), ['/a', '/b']);
    assert.equal(index.roots()[0], '/b', 'the superseded call did not take the front');
  } finally {
    await index.settled();
  }
});
