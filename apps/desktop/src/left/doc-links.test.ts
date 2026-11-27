// Pointing here: a content search that fails is said, not remembered as "no file names this one".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppHandle } from '../app-types.ts';
import { pointingHere } from './doc-links.ts';

test('a failed search says so once, and the next look at the same revision searches again', async () => {
  let calls = 0;
  let redraws = 0;
  const handle = {
    index: { entries: () => [{ path: '/r/a.md' }, { path: '/r/t.md' }], roots: () => ['/r'] },
    panes: () => ({ panes: [] }),
    shell: {
      searchContent: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('search refused'), { code: 'io' });
        return { hits: [{ path: '/r/a.md', line: 3, preview: 'see t.md here', matchStart: 4, matchEnd: 8 }] };
      },
    },
  } as unknown as AppHandle;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), null);
  await tick();
  assert.equal(redraws, 1);
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), 'failed');
  assert.equal(pointingHere(handle, '/r/t.md', 7, () => redraws++), null, 'looked for again');
  await tick();
  assert.equal(calls, 2);
  assert.deepEqual(pointingHere(handle, '/r/t.md', 7, () => redraws++), [{ from: '/r/a.md', line: 3, w: 't.md' }]);
});
