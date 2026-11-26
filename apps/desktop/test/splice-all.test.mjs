// A change from the store, whatever caused it (an operation, undo, redo, a Source commit), replaces only the blocks it
// touched on a long page, and the page is the page a whole render makes.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { generateTranscript } from '../../../scripts/measure-reload.mjs';
import { bootTwoPanes, closeHarness, harnessBase } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Chains of apply, undo, redo and Source commits through a real store, each state spliced into the page the
// state before left and compared with the whole render of the same bytes. Run in the page. With `every`, the page is
// brought up only after that many steps, as Read is after the commits made behind Source.
async function chains({ text, core, seeds, steps, every = 1 }) {
  const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
  const imp = (p) => import(`/@fs${root}${p}`);
  const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
  const { DEFAULT_POLICY } = await imp('packages/core/src/sanitize/policy.ts');
  const { openDocumentStore } = await import('/src/document/store.ts');
  const { spliceRendered, renderRecord, parseInert } = await import('/src/render/incremental.ts');
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const mulberry32 = (a) => () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const PIECES = ['Words typed in.', '# A heading\n\n', '- item\n- item\n\n', '> quote\n\n', '```js\nconst x = 1;\n```\n\n', '**bold** and `code`', '\n\n', '| a | b |\n|---|---|\n| 1 | 2 |\n\n', '- [ ] a task\n'];
  const file = '/d/chain.md';
  const io = { writeFileAtomic: async () => {} };
  const out = { cases: 0, spliced: 0, declined: {}, kept: 0, replaced: 0, mismatches: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const rnd = mulberry32(seed * 7919);
    // Edits brought up together sit near one another, as a reader's typing in Source does.
    const near = every > 1 ? 0.3 + 0.6 * rnd() : null;
    const store = openDocumentStore(io, file, enc.encode(text));
    let snap = store.snapshot();
    let render = renderDocumentSafeHtml(snap.ast, DEFAULT_POLICY);
    let record = renderRecord(snap.ast, render.removed, false);
    let page = { live: parseInert(render.html), pending: document.implementation.createHTMLDocument('').createElement('div') };
    for (let step = 0; step < steps; step++) {
      const current = dec.decode(snap.buffer.bytes);
      const roll = rnd();
      // Edits near the end of a long page, or anywhere, as a reader's operations land.
      const at = Math.floor((near !== null ? near + (rnd() - 0.5) * 0.02 : rnd() < 0.5 ? rnd() : 0.5 + rnd() * 0.5) * current.length);
      const piece = PIECES[Math.floor(rnd() * PIECES.length)];
      if (roll < 0.2 && snap.canUndo) await store.undo();
      else if (roll < 0.35 && snap.canRedo) await store.redo();
      else if (roll < 0.7) {
        const start = enc.encode(current.slice(0, at)).length;
        const end = enc.encode(current.slice(0, at + Math.floor(rnd() * 20))).length;
        await store.apply({ range: { file, start, end }, replacement: piece, label: 'edit' });
      } else {
        await store.commitSource(current.slice(0, at) + piece + current.slice(at + Math.floor(rnd() * 20)));
      }
      snap = store.snapshot();
      if ((step + 1) % every !== 0 && step !== steps - 1) continue;
      const fresh = renderDocumentSafeHtml(snap.ast, DEFAULT_POLICY);
      out.cases++;
      const result = spliceRendered(record, snap.ast, page, { policy: DEFAULT_POLICY });
      if (result.spliced) {
        out.spliced++;
        out.kept += result.value.kept;
        out.replaced += result.value.replaced.new;
        const got = page.live.innerHTML + page.pending.innerHTML;
        const want = parseInert(fresh.html).innerHTML;
        if (got !== want || JSON.stringify(result.value.removed) !== JSON.stringify(fresh.removed)) {
          let i = 0;
          while (i < got.length && got[i] === want[i]) i++;
          out.mismatches.push({ seed, step, at: i, got: got.slice(Math.max(0, i - 60), i + 100), want: want.slice(Math.max(0, i - 60), i + 100) });
          if (out.mismatches.length >= 3) return out;
        }
        record = result.value.record;
      } else {
        out.declined[result.reason] = (out.declined[result.reason] ?? 0) + 1;
        page = { live: parseInert(fresh.html), pending: document.implementation.createHTMLDocument('').createElement('div') };
        record = renderRecord(snap.ast, fresh.removed, false);
      }
    }
  }
  return out;
}

test('chains of apply, undo, redo and Source commits over a long document: the replaced page is the whole render, byte for byte', async () => {
  const text = generateTranscript(160 * 1024).toString('utf8');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(`${await harnessBase()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const result = await page.evaluate(chains, { text, core: repoRoot, seeds: 4, steps: 14 });
    assert.deepEqual(result.mismatches, [], `the replaced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1200)}`);
    assert.ok(result.spliced > result.cases * 0.6, `replaced ${result.spliced} of ${result.cases}; declined ${JSON.stringify(result.declined)}`);
    assert.ok(result.kept > result.replaced * 20, `kept ${result.kept}, replaced ${result.replaced}`);
  } finally {
    await browser.close();
  }
});

test('several commits, undos and redos behind Source, then Read: the replaced page is the whole render, byte for byte', async () => {
  const fill = 'some words, *some emphasis* and `code` to fill the line out. '.repeat(4);
  const body = Array.from({ length: 500 }, (_, i) => (i % 60 === 0 ? `## Part ${i}\n\n` : '') + `Paragraph ${i}: ${fill}`);
  const text = `# Long\n\n${body.join('\n\n')}\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(`${await harnessBase()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const result = await page.evaluate(chains, { text, core: repoRoot, seeds: 6, steps: 16, every: 4 });
    assert.deepEqual(result.mismatches, [], `the replaced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1200)}`);
    assert.ok(result.spliced > result.cases * 0.3, `replaced ${result.spliced} of ${result.cases}; declined ${JSON.stringify(result.declined)}`);
  } finally {
    await browser.close();
  }
});

test('chains of apply, undo, redo and Source commits over the small corpus documents: the replaced page is the whole render, byte for byte', async () => {
  // Footnote-free documents of 1 to 60 KB: a footnote definition still sets the page whole.
  const docs = {};
  for (const name of readdirSync(join(repoRoot, 'fixtures', 'corpus'))) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const text = readFileSync(join(repoRoot, 'fixtures', 'corpus', name), 'utf8');
    if (text.length >= 1024 && text.length < 60 * 1024 && !/^\[\^/m.test(text)) docs[name] = text;
  }
  assert.ok(Object.keys(docs).length >= 8, `corpus documents used: ${Object.keys(docs).join(', ')}`);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(`${await harnessBase()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    let cases = 0;
    let spliced = 0;
    for (const [name, text] of Object.entries(docs)) {
      const result = await page.evaluate(chains, { text, core: repoRoot, seeds: 3, steps: 10 });
      assert.deepEqual(result.mismatches, [], `${name}: the replaced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1200)}`);
      cases += result.cases;
      spliced += result.spliced;
    }
    assert.ok(spliced > cases * 0.4, `replaced ${spliced} of ${cases}`);
  } finally {
    await browser.close();
  }
});

test('Mod+Z after an operation on a 25 KB page replaces a handful of top-level nodes and leaves every set paragraph as it was', async () => {
  const body = Array.from({ length: 110 }, (_, i) => `Paragraph ${i}: ${'some words to fill the line out. '.repeat(6)}`);
  body.splice(55, 0, '- [ ] first task\n- [ ] second task');
  const text = `# Short\n\n${body.join('\n\n')}\n`;
  assert.ok(text.length > 20 * 1024 && text.length < 30 * 1024, `${text.length} bytes`);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/short.md': text }, open: ['/c/short.md'] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const tick = Buffer.from(text).indexOf('[ ] first task');
    await page.evaluate((at) => {
      const h = window.__marxyHandle;
      return h.dispatch({ type: 'apply', range: { start: at, end: at + 3 }, replacement: '[x]', label: 'tick', baseVersion: h.document().snapshot().version });
    }, tick);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    await page.evaluate(() => {
      const doc = document.querySelector('#doc');
      window.__set = [...doc.querySelectorAll(':scope > p.marxy-set')];
      window.__added = 0;
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
      window.__observer = new MutationObserver((records) => {
        for (const r of records) window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
      });
      window.__observer.observe(doc, { childList: true });
    });
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const seen = await page.evaluate(() => {
      window.__observer.takeRecords().forEach((r) => (window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length));
      const doc = document.querySelector('#doc');
      const repaints = performance.getEntriesByName('marxy:repaint').slice(window.__repaints);
      return {
        how: repaints.map((r) => r.detail?.how),
        added: window.__added,
        total: doc.children.length,
        setBefore: window.__set.length,
        setKept: window.__set.filter((p) => p.isConnected && p.classList.contains('marxy-set')).length,
        checked: doc.querySelectorAll('input[type=checkbox]:checked').length,
      };
    });
    assert.deepEqual(seen.how, ['replaced'], 'the small page was patched, not set whole');
    assert.ok(seen.added > 0 && seen.added < 10, `${seen.added} of ${seen.total} top-level nodes were replaced`);
    assert.ok(seen.setBefore > 0, 'some paragraphs were set before the undo');
    assert.equal(seen.setKept, seen.setBefore, 'paragraphs outside the change kept their setting');
    assert.equal(seen.checked, 0, 'the undone tick shows');
  } finally {
    await browser.close();
  }
});

test('Mod+Z after an operation on a long page replaces a handful of top-level nodes and leaves the set paragraphs as they were', async () => {
  const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${'some words to fill the line out. '.repeat(6)}`);
  body.splice(200, 0, '- [ ] first task\n- [ ] second task');
  const text = `# Long\n\n${body.join('\n\n')}\n`;
  assert.ok(text.length > 64 * 1024);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/long.md': text }, open: ['/c/long.md'] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const tick = Buffer.from(text).indexOf('[ ] first task');
    await page.evaluate((at) => {
      const h = window.__marxyHandle;
      return h.dispatch({ type: 'apply', range: { start: at, end: at + 3 }, replacement: '[x]', label: 'tick', baseVersion: h.document().snapshot().version });
    }, tick);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    await page.evaluate(() => {
      const doc = document.querySelector('#doc');
      window.__kept = [...doc.children];
      window.__set = [...doc.querySelectorAll(':scope > p.marxy-set')];
      window.__added = 0;
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
      window.__observer = new MutationObserver((records) => {
        for (const r of records) window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
      });
      window.__observer.observe(doc, { childList: true });
    });
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const seen = await page.evaluate(() => {
      window.__observer.takeRecords().forEach((r) => (window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length));
      const doc = document.querySelector('#doc');
      const repaints = performance.getEntriesByName('marxy:repaint').slice(window.__repaints);
      return {
        how: repaints.map((r) => r.detail?.how),
        added: window.__added,
        total: doc.children.length,
        setBefore: window.__set.length,
        setKept: window.__set.filter((p) => p.isConnected && p.classList.contains('marxy-set')).length,
        checked: doc.querySelectorAll('input[type=checkbox]:checked').length,
      };
    });
    assert.deepEqual(seen.how, ['replaced'], 'the page was patched, not set whole');
    assert.ok(seen.added > 0 && seen.added < 10, `${seen.added} of ${seen.total} top-level nodes were replaced`);
    assert.ok(seen.setBefore > 0, 'some paragraphs were set before the undo');
    assert.equal(seen.setKept, seen.setBefore, 'paragraphs outside the change kept their setting');
    assert.equal(seen.checked, 0, 'the undone tick shows');
  } finally {
    await browser.close();
  }
});

test('a tick, undo, redo and a Source commit on a long page keep the cursor, an open find, the set type and the place', async () => {
  const fill = 'some words to fill the line out. '.repeat(6);
  const body = [];
  for (let i = 0; i < 400; i++) {
    if (i % 50 === 0) body.push(`## Part ${i / 50}`);
    body.push(`Paragraph ${i}: ${[50, 150, 260, 350].includes(i) ? 'needle ' : ''}${fill}`);
  }
  body.splice(body.findIndex((l) => l.startsWith('Paragraph 200:')), 0, `- [ ] first task ${fill}\n- [ ] second task`);
  const text = `# Long\n\n${body.join('\n\n')}\n`;
  assert.ok(text.length > 64 * 1024);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/long.md': text }, open: ['/c/long.md'] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.evaluate(() => [...document.querySelectorAll('#doc > p')].find((p) => p.textContent.startsWith('Paragraph 255:')).scrollIntoView({ block: 'start' }));
    await frames();
    await page.locator('#doc > p', { hasText: 'Paragraph 258:' }).click();
    await page.keyboard.press(`${mod}+KeyF`);
    await page.keyboard.type('needle');
    await page.waitForFunction(() => /\d+ of 4/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));

    const look = () =>
      page.evaluate(() => {
        const doc = document.querySelector('#doc');
        const top = [...doc.children].find((b) => b.getBoundingClientRect().bottom > 0);
        const range = [...(CSS.highlights.get('marxy-find-current') ?? [])][0];
        const holder = range && range.startContainer.isConnected ? range.startContainer.parentElement?.closest('#doc > *') : null;
        return {
          top: top?.textContent.slice(0, 16),
          y: Math.round(top?.getBoundingClientRect().top ?? 0),
          cursor: doc.querySelector('.marxy-cursor')?.textContent.slice(0, 16) ?? null,
          count: document.querySelector('.marxy-find-count')?.textContent,
          current: holder?.textContent.slice(0, 16) ?? null,
        };
      });
    const start = await look();
    assert.match(start.cursor, /^Paragraph 258:/);
    assert.match(start.current, /^Paragraph 260:/);

    const tick = Buffer.from(text).indexOf('[ ] first task');
    const steps = {
      tick: (at) => {
        const h = window.__marxyHandle;
        return h.dispatch({ type: 'apply', range: { start: at, end: at + 3 }, replacement: '[x]', label: 'tick', baseVersion: h.document().snapshot().version });
      },
      undo: () => window.__marxyHandle.dispatch({ type: 'undo' }),
      redo: () => window.__marxyHandle.dispatch({ type: 'redo' }),
      // A paragraph long enough to be set, above the reader: everything below it moves down.
      source: () => {
        const store = window.__marxyHandle.document();
        const now = new TextDecoder().decode(store.snapshot().buffer.bytes);
        const at = now.indexOf('Paragraph 100:');
        return store.commitSource(`${now.slice(0, at)}Inserted ${'words that fill a line or two of the page. '.repeat(5)}\n\n${now.slice(at)}`);
      },
    };
    for (const [name, step] of Object.entries(steps)) {
      await page.evaluate(() => {
        const doc = document.querySelector('#doc');
        window.__setBefore = new Set(doc.querySelectorAll('.marxy-set'));
        window.__classes = [];
        window.__repaints = performance.getEntriesByName('marxy:repaint').length;
        window.__watch = new MutationObserver((records) => window.__classes.push(...records));
        window.__watch.observe(doc, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      });
      await page.evaluate(`(${step.toString()})(${tick})`);
      await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
      await frames();
      // Every paragraph the change brought in is set, as a whole render sets it.
      await page.waitForFunction(
        () => [...document.querySelectorAll('#doc li, #doc > p')].filter((p) => /^(first task|Inserted)/.test(p.textContent.trim())).every((p) => p.classList.contains('marxy-set')),
        undefined,
        { timeout: 10_000 },
      );
      const seen = await page.evaluate(() => {
        window.__classes.push(...window.__watch.takeRecords());
        window.__watch.disconnect();
        // A kept paragraph set again loses its class on the way: a record whose old value lacks it, or no class now.
        const lost = new Set();
        for (const r of window.__classes) {
          if (window.__setBefore.has(r.target) && !(r.oldValue ?? '').split(' ').includes('marxy-set')) lost.add(r.target);
        }
        for (const el of window.__setBefore) if (el.isConnected && !el.classList.contains('marxy-set')) lost.add(el);
        return {
          how: performance.getEntriesByName('marxy:repaint').slice(window.__repaints).map((r) => r.detail?.how),
          resets: [...lost].filter((el) => el.isConnected).length,
        };
      });
      assert.deepEqual(seen.how, ['replaced'], `${name}: the page was patched, not set whole`);
      assert.equal(seen.resets, 0, `${name}: no paragraph outside the change was set again`);
      await page.waitForFunction(() => /\d+ of 4/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
      const now = await look();
      assert.equal(now.cursor, start.cursor, `${name}: the cursor stays on its paragraph`);
      assert.equal(now.count, start.count, `${name}: find counts the same matches`);
      assert.equal(now.current, start.current, `${name}: the current match is the same one`);
      assert.equal(now.top, start.top, `${name}: the reader's top block is the same`);
      assert.ok(Math.abs(now.y - start.y) <= 2, `${name}: the top block stays where it was (${start.y} -> ${now.y})`);
    }

    // The cursor on the block the change replaces moves to the block that replaces it.
    await page.evaluate(() => [...document.querySelectorAll('#doc li')].find((li) => li.textContent.trim().startsWith('first task')).scrollIntoView({ block: 'center' }));
    await frames();
    await page.locator('#doc li', { hasText: 'first task' }).click({ position: { x: 200, y: 8 } });
    const on = await page.evaluate(() => document.querySelector('#doc .marxy-cursor')?.textContent.trim().slice(0, 10) ?? null);
    assert.equal(on, 'first task');
    const ticked = Buffer.from(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes))).indexOf('[x] first task');
    await page.evaluate((at) => {
      const h = window.__marxyHandle;
      return h.dispatch({ type: 'apply', range: { start: at, end: at + 3 }, replacement: '[ ]', label: 'tick', baseVersion: h.document().snapshot().version });
    }, ticked);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    await frames();
    const after = await page.evaluate(() => {
      const el = document.querySelector('#doc .marxy-cursor');
      return { text: el?.textContent.trim().slice(0, 10) ?? null, checked: el?.querySelector('input[type=checkbox]')?.checked ?? null };
    });
    assert.deepEqual(after, { text: 'first task', checked: false }, 'the cursor is on the new item');
  } finally {
    await browser.close();
  }
});

test('a page in the other pane that replaces its changed blocks says what it blocked in its own pane', async () => {
  const fill = 'some words to fill the line out. '.repeat(6);
  const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${fill}`);
  body.splice(100, 0, 'An image over plain http: ![a](http://example.com/a.png)');
  const long = `# Long\n\n${body.join('\n\n')}\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/short.md': '# Short\n\nNothing blocked here.\n', '/c/long.md': long }, open: ['/c/short.md', '/c/long.md'] });
    await page.evaluate(() => Promise.all(window.__marxyHandle.panes().panes.map((p) => p.view.settled())));
    const blocked = () =>
      page.evaluate(() => ['marxy-notices', 'marxy-notices-2'].map((id) => document.getElementById(id)?.querySelectorAll('[data-notice-kind="blocked"]').length ?? 0));
    assert.deepEqual(await blocked(), [0, 1], 'the long page says what it blocked, in its pane');
    await page.evaluate(() => {
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
    });
    await page.evaluate(async (text) => {
      const shell = window.__marxyHandle.shell;
      await shell.writeFileAtomic('/c/long.md', new TextEncoder().encode(text));
      shell.emit([{ kind: 'modified', path: '/c/long.md' }]);
    }, `${long}\nA line added at the end.\n`);
    await page.waitForFunction(() => performance.getEntriesByName('marxy:repaint').length > window.__repaints);
    await page.evaluate(() => Promise.all(window.__marxyHandle.panes().panes.map((p) => p.view.settled())));
    const how = await page.evaluate(() => performance.getEntriesByName('marxy:repaint').at(-1).detail?.how);
    assert.equal(how, 'replaced');
    assert.deepEqual(await blocked(), [0, 1], 'the notice stays in the long page\'s pane, and none appears in the focused one');
  } finally {
    await browser.close();
  }
});

test('typing in Source and returning to Read replaces the blocks that were typed in and keeps the rest of the page as it was', async () => {
  const fill = 'some words to fill the line out. '.repeat(6);
  const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${fill}`);
  const text = `# Long\n\n${body.join('\n\n')}\n`;
  assert.ok(text.length > 64 * 1024);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/long.md': text }, open: ['/c/long.md'] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    await page.evaluate(() => {
      const doc = document.querySelector('#doc');
      window.__kept = [...doc.children];
      window.__set = [...doc.querySelectorAll(':scope > p.marxy-set')];
    });
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('source'));
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    // Two edits near each other while the page is hidden: one splice covers both.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const editor = activeSourceEditor(window.__marxyHandle.panes().panes[0].parts.source);
      const text = editor.docText();
      const a = text.indexOf('Paragraph 120:');
      const b = text.indexOf('Paragraph 122:');
      editor.view.dispatch({ changes: [{ from: a, insert: 'Typed ' }, { from: b, insert: 'Typed ' }] });
    });
    await page.evaluate(() => {
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
      window.__added = 0;
      window.__observer = new MutationObserver((records) => {
        for (const r of records) window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
      });
      window.__observer.observe(document.querySelector('#doc'), { childList: true });
    });
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('rendered'));
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const seen = await page.evaluate(() => {
      window.__observer.takeRecords().forEach((r) => (window.__added += [...r.addedNodes].filter((n) => n.nodeType === 1).length));
      const doc = document.querySelector('#doc');
      return {
        how: performance.getEntriesByName('marxy:repaint').slice(window.__repaints).map((r) => r.detail?.how),
        added: window.__added,
        kept: window.__kept.filter((el) => el.isConnected).length,
        total: doc.children.length,
        setBefore: window.__set.length,
        setKept: window.__set.filter((p) => p.isConnected && p.classList.contains('marxy-set')).length,
        typed: [...doc.querySelectorAll(':scope > p')].filter((p) => p.textContent.startsWith('Typed Paragraph')).length,
      };
    });
    assert.deepEqual(seen.how, ['replaced'], 'the page was patched, not set whole');
    assert.ok(seen.added > 0 && seen.added < 10, `${seen.added} of ${seen.total} top-level nodes were replaced`);
    assert.ok(seen.kept >= seen.total - 4, `${seen.kept} of ${seen.total} nodes keep their identity`);
    assert.equal(seen.typed, 2, 'both typed paragraphs show');
    assert.ok(seen.setBefore > 0 && seen.setKept >= seen.setBefore - 2, `${seen.setKept} of ${seen.setBefore} set paragraphs kept their setting`);
  } finally {
    await browser.close();
  }
});

test('behind Source: commits undone to the first bytes keep every node, the cursor and find hold, and a rename or a new face sets the page whole', async () => {
  const fill = 'some words to fill the line out. '.repeat(6);
  const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${[50, 150, 260, 350].includes(i) ? 'needle ' : ''}${fill}`);
  const text = `# Long\n\n${body.join('\n\n')}\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { '/c/long.md': text }, open: ['/c/long.md'] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.evaluate(() => [...document.querySelectorAll('#doc > p')].find((p) => p.textContent.startsWith('Paragraph 255:')).scrollIntoView({ block: 'start' }));
    await frames();
    await page.locator('#doc > p', { hasText: 'Paragraph 258:' }).click();
    await page.keyboard.press(`${mod}+KeyF`);
    await page.keyboard.type('needle');
    await page.waitForFunction(() => /\d+ of 4/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
    const look = () =>
      page.evaluate(() => {
        const range = [...(CSS.highlights.get('marxy-find-current') ?? [])][0];
        const holder = range && range.startContainer.isConnected ? range.startContainer.parentElement?.closest('#doc > *') : null;
        return {
          cursor: document.querySelector('#doc .marxy-cursor')?.textContent.slice(0, 16) ?? null,
          count: document.querySelector('.marxy-find-count')?.textContent ?? null,
          current: holder?.textContent.slice(0, 16) ?? null,
        };
      });
    const start = await look();
    const commit = (args) =>
      page.evaluate(([before, words]) => {
        const store = window.__marxyHandle.document();
        const now = new TextDecoder().decode(store.snapshot().buffer.bytes);
        const at = now.indexOf(before);
        return store.commitSource(`${now.slice(0, at)}${words}\n\n${now.slice(at)}`);
      }, args);
    // Behind Source, `hidden` runs while the page is hidden; Read then shows and says how it was set (a whole render
    // there writes no repaint entry: it shows as every node gone).
    const behindSource = async (hidden) => {
      await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('source'));
      await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
      await page.evaluate(() => {
        window.__kept = [...document.querySelector('#doc').children];
        window.__repaints = performance.getEntriesByName('marxy:repaint').length;
      });
      await hidden();
      await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('rendered'));
      await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
      await frames();
      return page.evaluate(() => ({
        how: performance.getEntriesByName('marxy:repaint').slice(window.__repaints).map((r) => r.detail?.how),
        lost: window.__kept.filter((el) => !el.isConnected).length,
        total: document.querySelector('#doc').children.length,
        kept: window.__kept.length,
      }));
    };

    // Three commits, then each undone: the page left behind is the page of the bytes Read shows again.
    const undone = await behindSource(async () => {
      await commit(['Paragraph 100:', `First ${fill}`]);
      await commit(['Paragraph 300:', `Second ${fill}`]);
      await commit(['Paragraph 120:', `Third ${fill}`]);
      for (let i = 0; i < 3; i++) await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
      assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes)), text);
    });
    assert.deepEqual(undone, { how: ['replaced'], lost: 0, total: undone.kept, kept: undone.kept }, 'every node of the page kept');

    // One commit above the reader: the cursor, the find and its current match are where they were.
    const above = await behindSource(() => commit(['Paragraph 100:', `Inserted ${fill}`]));
    assert.deepEqual(above.how, ['replaced']);
    assert.ok(above.lost < 4 && above.total > above.kept, `${above.lost} of ${above.kept} nodes replaced, ${above.total} now`);
    await page.waitForFunction(() => /\d+ of 4/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
    assert.deepEqual(await look(), start, 'cursor, find count and current match');

    // A rename behind Source changes every node's file: the page is set whole, commits or not.
    const renamed = await behindSource(async () => {
      await commit(['Paragraph 110:', `Again ${fill}`]);
      await page.evaluate(() => window.__marxyHandle.document().rename('/c/moved.md'));
    });
    assert.ok(!renamed.how.includes('replaced') && renamed.lost === renamed.kept, `a rename sets the page whole: ${JSON.stringify(renamed)}`);

    // The type turned off behind Source: no paragraph kept from before is left set.
    const unset = await behindSource(async () => {
      await commit(['Paragraph 130:', `More ${fill}`]);
      await page.evaluate(async () => {
        document.documentElement.style.setProperty('--marxy-typeset', 'none');
        await window.__marxyHandle.relayout();
      });
    });
    assert.ok(!unset.how.includes('replaced') && unset.lost === unset.kept, `a new face sets the page whole: ${JSON.stringify(unset)}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc .marxy-set').length), 0, 'no paragraph left set');
  } finally {
    await browser.close();
  }
});
