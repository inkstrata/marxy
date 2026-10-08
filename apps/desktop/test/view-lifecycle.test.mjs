// The per-article view (B-13): `view/rendered-view.ts` owns everything about showing a store in an
// article, so `app.ts` keeps none of it, N opens leave one of each thing a page starts, and two views
// in one page (Phase D's two panes) render, follow their stores and tear down independently.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const src = join(desktopRoot, 'src');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-view-lifecycle-'));
let server;
let base;

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';

const A = `# Alpha\n\n${para('Alpha').repeat(3)}\n\n- [ ] alpha task\n`;
const B = `# Bravo\n\n${para('Bravo').repeat(3)}\n\n- [ ] bravo task\n`;
const C = [
  '# Charlie',
  '',
  ...Array.from({ length: 30 }, (_, i) => `${para(`Filler ${i}`).repeat(1 + (i % 3))}\n`),
  '## Target heading',
  '',
  ...Array.from({ length: 30 }, (_, i) => `${para(`After ${i}`).repeat(2)}\n`),
].join('\n');
const RS = 'fn main() {\n    println!("hello");\n}\n';
// A heading so near the end that the window cannot bring it to the reading line: the reader's block
// position (the block on the reading line) and the held anchor (the heading) are different bytes.
const E = [
  '# Echo',
  '',
  ...Array.from({ length: 30 }, (_, i) => `${para(`Lead ${i}`).repeat(2)}\n`),
  '## Last heading',
  '',
  'The end.',
  '',
].join('\n');
const bytes = (text) => Buffer.from(text, 'utf8');
const files = {
  '/r/A.md': bytes(A).toString('base64'),
  '/r/B.md': bytes(B).toString('base64'),
  '/r/C.md': bytes(C).toString('base64'),
  '/r/D.rs': bytes(RS).toString('base64'),
  '/r/E.md': bytes(E).toString('base64'),
};
const target = bytes(C).indexOf('## Target heading');
const lastHeading = bytes(E).indexOf('## Last heading');

before(async () => {
  if (skip) return;
  await build({ root: desktopRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function' && typeof window.marxyViewHarness?.view === 'function');
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Module-level declarations of `kind` named in `src`, ignoring anything indented (inside a function). */
function topLevel(text, kind) {
  return [...text.matchAll(new RegExp(`^${kind} (\\w+)`, 'gm'))].map((m) => m[1]);
}

// The state map in docs/plan/roadmap-2026-10/02-phase-b.md (B-11): rows 5–10, 24, 26–32 and the two consts.
const B13_LETS = [
  'viewMode', 'sourceEditor', 'keysInstalled', 'lastReadingByteOffset', 'lastReadingFraction', 'modeToggleBusy',
  'typeset', 'anchor', 'anchorListening', 'lastSnapAt', 'snapTimer', 'snapFrame', 'resizeObserver', 'liveResizeObservers',
];
const B13_CONSTS = ['scopedAssetRoots', 'liveTypesetters'];

nodeTest('app.ts keeps none of the state-map rows B-13 moves into the view', () => {
  const app = readFileSync(join(src, 'app.ts'), 'utf8');
  const lets = topLevel(app, 'let');
  const consts = topLevel(app, 'const');
  assert.deepEqual(lets.filter((name) => B13_LETS.includes(name)), []);
  assert.deepEqual(consts.filter((name) => B13_CONSTS.includes(name)), []);
  // Nor the view's own machinery under another name: no typesetter, grid pass or Source editor of its own.
  assert.doesNotMatch(app, /\battach\(|\bsnapToGrid\(|new ResizeObserver\(|source\/editor\.ts/);
});

nodeTest('rendered-view.ts has no module-level let: two views share nothing', () => {
  const view = readFileSync(join(src, 'view', 'rendered-view.ts'), 'utf8');
  assert.deepEqual(topLevel(view, 'let'), []);
  assert.deepEqual(topLevel(view, 'var'), []);
});

test('N opens through the app leave one typesetter, one resize observer and at most one editor', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async (files) => {
      const h = await window.marxyApp.start(files, ['/r/D.rs']);
      await h.ready;
      const editorsInSource = document.querySelectorAll('#marxy-source .cm-editor').length;
      for (const path of ['/r/A.md', '/r/B.md', '/r/D.rs', '/r/C.md', '/r/A.md']) await h.open(path);
      return {
        editorsInSource,
        editors: document.querySelectorAll('#marxy-source .cm-editor').length,
        counts: h.debugCounts(),
        mode: document.body.dataset.marxyMode,
        state: h.state.document !== null && h.state.document.blocks.length > 0,
      };
    }, files);
    assert.equal(seen.editorsInSource, 1);
    assert.equal(seen.editors, 0);
    assert.deepEqual(seen.counts, { typesetters: 1, resizeObservers: 1 });
    assert.equal(seen.mode, 'rendered');
    assert.equal(seen.state, true, 'AppHandle.state reads the view');
  }));

test('two views in one page typeset independently, follow their own stores, and tear down independently', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ A, B }) => {
      const one = window.marxyViewHarness.view('/v/one.md', A);
      const two = window.marxyViewHarness.view('/v/two.md', B);
      await one.view.show(one.store);
      await two.view.show(two.store);
      await Promise.all([one.view.typeset(), two.view.typeset()]);
      const counts = () => ({ one: one.view.debugCounts(), two: two.view.debugCounts() });
      const shown = counts();
      const texts = { one: one.article.querySelector('h1')?.textContent, two: two.article.querySelector('h1')?.textContent };
      const set = {
        one: one.article.querySelectorAll('.marxy-lb').length > 0,
        two: two.article.querySelectorAll('.marxy-lb').length > 0,
      };
      // An edit to one store sets its own view again and leaves the other's page as it was.
      const twoBefore = two.article.innerHTML;
      await one.store.apply({ range: { file: '/v/one.md', start: 2, end: 7 }, replacement: 'Aleph', label: 'edit' });
      await one.view.settled();
      const afterEdit = { one: one.article.querySelector('h1')?.textContent, twoSame: two.article.innerHTML === twoBefore };
      one.view.destroy();
      const afterDestroy = counts();
      const oneEmptied = one.view.store() === null && one.view.document() === null;
      // The survivor still follows its store.
      await two.store.apply({ range: { file: '/v/two.md', start: 2, end: 7 }, replacement: 'Beth', label: 'edit' });
      await two.view.settled();
      return { shown, texts, set, afterEdit, afterDestroy, oneEmptied, twoHeading: two.article.querySelector('h1')?.textContent };
    }, { A, B });
    assert.deepEqual(seen.shown, { one: { typesetters: 1, resizeObservers: 1 }, two: { typesetters: 1, resizeObservers: 1 } });
    assert.deepEqual(seen.texts, { one: 'Alpha', two: 'Bravo' });
    assert.deepEqual(seen.set, { one: true, two: true }, 'each view typeset its own article');
    assert.deepEqual(seen.afterEdit, { one: 'Aleph', twoSame: true });
    assert.deepEqual(seen.afterDestroy, { one: { typesetters: 0, resizeObservers: 0 }, two: { typesetters: 1, resizeObservers: 1 } });
    assert.equal(seen.oneEmptied, true);
    assert.equal(seen.twoHeading, 'Beth');
  }));

test('a task click in a second view applies to that view\'s store: the article wiring is per view', () =>
  withPage(async (page) => {
    await page.evaluate(async ({ A, B }) => {
      const one = window.marxyViewHarness.view('/v/one.md', A, { wire: true });
      const two = window.marxyViewHarness.view('/v/two.md', B, { wire: true });
      window.__two = two;
      window.__one = one;
      await one.view.show(one.store);
      await two.view.show(two.store);
      two.article.scrollIntoView();
    }, { A, B });
    // The task wiring loads its module lazily; it marks itself ready. Bounded, so no wiring fails here.
    await page.waitForFunction(() => window.__marxyTasksReady === true, null, { timeout: 10_000 });
    const box = await page.evaluate(() => {
      const r = window.__two.article.querySelector('input[type=checkbox]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => new TextDecoder().decode(window.__two.store.snapshot().buffer.bytes).includes('- [x] bravo task'), null, { timeout: 10_000 });
    const one = await page.evaluate(() => new TextDecoder().decode(window.__one.store.snapshot().buffer.bytes));
    assert.ok(one.includes('- [ ] alpha task'), 'the first view\'s store is untouched');
  }));

test('a selection resolved on a page the store has moved past carries the page\'s version, so its edit is refused', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ A }) => {
      const one = window.marxyViewHarness.view('/v/one.md', A);
      // Subscribed before the view: it runs after the store committed and before the page is set again,
      // which is what a deferred render would look like to a command.
      let during = null;
      one.store.subscribe((snap, change) => {
        if (change.kind !== 'apply' || during !== null) return;
        during = { runtime: one.selection.runtime().version, store: snap.version };
      });
      await one.view.show(one.store);
      const shownAt = one.selection.runtime().version;
      await one.store.apply({ range: { file: '/v/one.md', start: 2, end: 7 }, replacement: 'Aleph', label: 'edit' });
      const refused = await one.store.apply({
        range: { file: '/v/one.md', start: 2, end: 7 },
        replacement: 'Alpha',
        label: 'stale',
        baseVersion: during.runtime,
      });
      // A save moves the version and not the bytes: an edit from the page as it is still lands.
      const afterRender = one.selection.runtime().version;
      await one.store.save();
      const afterSave = one.selection.runtime().version;
      const lands = await one.store.apply({
        range: { file: '/v/one.md', start: 2, end: 7 },
        replacement: 'Alpha',
        label: 'fresh',
        baseVersion: afterSave,
      });
      return { shownAt, during, refused, afterRender, afterSave, lands, version: one.store.snapshot().version };
    }, { A });
    assert.equal(seen.during.runtime, seen.shownAt, 'the runtime keeps the version the page was set from');
    assert.ok(seen.during.store > seen.during.runtime);
    assert.equal(seen.refused, false, 'an edit at the page\'s stale version is refused');
    assert.equal(seen.afterSave, seen.afterRender, 'a save does not set the page again');
    assert.equal(seen.lands, true);
  }));

test('an edit above a held anchor keeps the reader on the same heading: the anchor is mapped, not released', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ files, target }) => {
      const h = await window.marxyApp.start(files, ['/r/A.md']);
      await h.ready;
      await h.open('/r/C.md', { at: target });
      const before = h.sourceHarness().byteOffset;
      const store = h.document();
      const inserted = '# Inserted\n\nA paragraph the edit puts above everything the reader can see.\n\n';
      await store.apply({ range: { file: '/r/C.md', start: 0, end: 0 }, replacement: inserted, label: 'edit' });
      await h.contentComplete();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { before, after: h.sourceHarness().byteOffset, shift: new TextEncoder().encode(inserted).length };
    }, { files, target });
    assert.equal(seen.before, target, 'the open landed on the heading');
    assert.equal(seen.after, target + seen.shift, 'the same heading, at its new offset');
  }));

test('undo and redo map a held anchor back and forth: the reader stays on the same heading', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ files, target }) => {
      const h = await window.marxyApp.start(files, ['/r/A.md']);
      await h.ready;
      await h.open('/r/C.md', { at: target });
      const store = h.document();
      const inserted = '# Inserted\n\nA paragraph the edit puts above everything the reader can see.\n\n';
      // Two frames after the page is in, so the passes the change scheduled have run.
      const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const settle = async () => {
        await h.contentComplete();
        await frames();
      };
      await store.apply({ range: { file: '/r/C.md', start: 0, end: 0 }, replacement: inserted, label: 'edit' });
      await settle();
      const afterEdit = h.sourceHarness().byteOffset;
      await store.undo();
      await settle();
      const afterUndo = h.sourceHarness().byteOffset;
      await store.redo();
      await settle();
      const afterRedo = h.sourceHarness().byteOffset;
      return { afterEdit, afterUndo, afterRedo, shift: new TextEncoder().encode(inserted).length };
    }, { files, target });
    assert.equal(seen.afterEdit, target + seen.shift);
    assert.equal(seen.afterUndo, target, 'undo takes the inserted bytes away again');
    assert.equal(seen.afterRedo, target + seen.shift);
  }));

test('an edit between the reading line and a held heading keeps the heading, not the block above it, on screen', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ files, lastHeading }) => {
      const h = await window.marxyApp.start(files, ['/r/A.md']);
      await h.ready;
      await h.open('/r/E.md', { at: lastHeading });
      const before = h.sourceHarness().byteOffset;
      const store = h.document();
      const para = 'Inserted text that runs long enough to fill a good part of a line in the column. ';
      const inserted = Array.from({ length: 30 }, () => para.repeat(3)).join('\n\n') + '\n\n';
      await store.apply({ range: { file: '/r/E.md', start: lastHeading, end: lastHeading }, replacement: inserted, label: 'edit' });
      await h.contentComplete();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const heading = [...document.querySelectorAll('#doc h2')].find((el) => el.textContent === 'Last heading');
      const r = heading.getBoundingClientRect();
      return { before, visible: r.top >= 0 && r.bottom <= window.innerHeight };
    }, { files, lastHeading });
    assert.ok(seen.before < lastHeading, `the reading line sits above the heading (${seen.before} < ${lastHeading})`);
    assert.equal(seen.visible, true, 'the held heading is still on screen after the edit');
  }));

test('a reload from disk with an anchor held keeps the reader on the same heading in the new bytes', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ files, target }) => {
      const h = await window.marxyApp.start(files, ['/r/A.md']);
      await h.ready;
      await h.open('/r/C.md', { at: target });
      const before = h.sourceHarness().byteOffset;
      const prefix = '# Written by someone else\n\nA paragraph another program put at the top.\n\n';
      const old = h.document().snapshot().buffer.bytes;
      const added = new TextEncoder().encode(prefix);
      const next = new Uint8Array(added.length + old.length);
      next.set(added);
      next.set(old, added.length);
      await h.shell.writeFileAtomic('/r/C.md', next);
      const reloaded = () => h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload');
      h.shell.emit([{ kind: 'modified', path: '/r/C.md' }]);
      for (let i = 0; i < 500 && !reloaded(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      await h.contentComplete();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { before, reloaded: reloaded(), after: h.sourceHarness().byteOffset, shift: added.length };
    }, { files, target });
    assert.equal(seen.reloaded, true, 'the reload ran');
    assert.equal(seen.before, target);
    assert.equal(seen.after, target + seen.shift, 'the same heading, at its offset in the new bytes');
  }));

test('a task clicked on a page the store has moved past carries the page\'s version, so its toggle is refused', () =>
  withPage(async (page) => {
    const seen = await page.evaluate(async ({ A }) => {
      const one = window.marxyViewHarness.view('/v/one.md', A, { wire: true });
      const text = () => new TextDecoder().decode(one.store.snapshot().buffer.bytes);
      const clickTask = () => {
        const box = one.article.querySelector('input[type=checkbox]');
        const r = box.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        (box.closest('li') ?? box).dispatchEvent(new MouseEvent('click', init));
      };
      // Every apply the click makes, with its outcome: the toggle goes through a lazy import first.
      const applies = [];
      const apply = one.store.apply.bind(one.store);
      one.store.apply = (input) => {
        const result = apply(input);
        if (input.label !== 'edit') applies.push(result);
        return result;
      };
      const nextToggle = async (n) => {
        for (let i = 0; i < 1000 && applies.length < n; i++) await new Promise((resolve) => setTimeout(resolve, 10));
        return applies.length >= n ? applies[n - 1] : 'no toggle';
      };
      // Subscribed before the view: it clicks after the store committed and before the page is set again.
      let clicked = false;
      one.store.subscribe((_snap, change) => {
        if (change.kind !== 'apply' || clicked) return;
        clicked = true;
        clickTask();
      });
      await one.view.show(one.store);
      await new Promise((resolve) => {
        const poll = () => (window.__marxyTasksReady ? resolve() : setTimeout(poll, 10));
        poll();
      });
      const end = new TextEncoder().encode(text()).length;
      // An edit after the task: the bytes changed, the task's own offsets did not.
      await one.store.apply({ range: { file: '/v/one.md', start: end, end }, replacement: 'more\n', label: 'edit' });
      const stale = await nextToggle(1);
      // The page caught up: the same click now toggles.
      clickTask();
      const fresh = await nextToggle(2);
      return { clicked, stale, fresh, ticked: text().includes('- [x] alpha task') };
    }, { A });
    assert.equal(seen.clicked, true);
    assert.equal(seen.stale, false, 'a toggle from the page before the edit is refused');
    assert.equal(seen.fresh, true, 'a toggle from the page as it is lands');
    assert.equal(seen.ticked, true);
  }));
