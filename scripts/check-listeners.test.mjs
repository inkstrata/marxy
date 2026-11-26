// check-listeners counts window and document listeners nothing takes away, and fails only on growth.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countByFolder, folderOf, grown, unowned } from './check-listeners.mjs';

test('a window or document listener with no signal and no remove is counted', () => {
  assert.equal(unowned(`window.addEventListener('resize', onResize);`), 1);
  assert.equal(unowned(`document.fonts.addEventListener('loadingdone', f);`), 1);
  assert.equal(unowned(`matchMedia('(prefers-color-scheme: dark)').addEventListener('change', f);`), 1);
});

test('a signal or a remove accounts for one', () => {
  assert.equal(unowned(`window.addEventListener('resize', onResize, { signal });`), 0);
  assert.equal(unowned(`document.addEventListener('keydown', onKey, { capture: true, signal: life.signal });`), 0);
  assert.equal(unowned(`window.addEventListener('blur', f);\nwindow.removeEventListener('blur', f);`), 0);
  assert.equal(unowned(`window.addEventListener(\n  'keydown',\n  (e) => { go(e); },\n  { signal },\n);`), 0);
});

test('an element\'s listener goes with the element and is not counted, nor one in a comment', () => {
  assert.equal(unowned(`button.addEventListener('click', go);\nel.addEventListener('scroll', f);`), 0);
  assert.equal(unowned(`// window.addEventListener('resize', f);`), 0);
});

test('counts go by folder under apps/desktop/src, and only growth fails', () => {
  assert.equal(folderOf('apps/desktop/src/frame/frame.ts'), 'frame');
  assert.equal(folderOf('apps/desktop/src/app.ts'), '.');
  const counts = countByFolder([
    { path: 'apps/desktop/src/frame/a.ts', text: `window.addEventListener('resize', f);` },
    { path: 'apps/desktop/src/frame/b.ts', text: `document.addEventListener('click', f);` },
    { path: 'apps/desktop/src/view/c.ts', text: `window.addEventListener('resize', f, { signal });` },
  ]);
  assert.deepEqual(counts, { frame: 2 });
  assert.deepEqual(grown(counts, { frame: 2 }), []);
  assert.deepEqual(grown(counts, { frame: 3 }), []);
  assert.deepEqual(grown(counts, { frame: 1 }), ['frame: 2 (recorded 1)']);
  assert.deepEqual(grown({ pane: 1 }, {}), ['pane: 1 (recorded 0)']);
});
