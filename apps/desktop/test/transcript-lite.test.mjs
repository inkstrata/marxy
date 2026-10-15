// A JSONL session in Read (K-12; ADR-0061), the part of it on the pull-request path (`test:lite`): commitment 5, a large
// session's first turn painted before the deriver reaches the end of the file, and an append to it deriving and drawing
// only the new lines; commitment 4, a flagged character in a row drawn in a later slice (a reply, an image's words, a
// link's title) shown as its marker like one in the first screen; commitment 3, reading, folding, filtering, copying and
// switching modes write nothing. transcript-jsonl.test.mjs holds the rest, nightly. WebKit, over the shipped skeleton and
// the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const SESSION = readFileSync(new URL('../../../fixtures/corpus/40-session.jsonl', import.meta.url), 'utf8');
const RULE = '[[kind]]\nglob = "/s/**"\nis = "transcript"\nread = true\n';
const line = (o) => JSON.stringify(o);
/** 3,000 exchanges; the 2,500th reply, far past the first slice, holds a bidi control in its text, an image's words and a link's title. */
const LATE = Array.from({ length: 3000 }, (_, i) => [
  line({ type: 'user', message: { role: 'user', content: `Prompt ${i + 1}: what does step ${i + 1} do?` } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: i === 2499 ? 'Late: x\u202ey, ![a\u202eb](./i.png) and [link](https://example.org "t\u200bt") and \u2066iso\u2069.' : `Step ${i + 1} reads the file and writes **${i + 1}** lines.` }] } }),
].join('\n')).join('\n') + '\n';

/** Characters the invisibles rule draws as markers: bidi controls and zero-width characters. */
const FLAGGED = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

const settled = (page) => page.evaluate(async () => {
  const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
  await transcriptIn(window.__marxyHandle.panes().focused.parts.article)?.settled();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const state = (page) => page.evaluate(async () => {
  const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
  return transcriptIn(window.__marxyHandle.panes().focused.parts.article)?.state() ?? null;
});
const appWrites = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && String(c.args[0]).startsWith('/s/')).length);

async function withPage(files, open, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, '/config': RULE }, open: [open] });
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.parts.article.querySelector('.marxy-turn') !== null);
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('a flagged character in a row drawn in a later slice is its marker, in text, an image\'s words and a link\'s title', () =>
  withPage({ '/s/late.jsonl': LATE }, '/s/late.jsonl', async (page) => {
    const first = await state(page);
    await settled(page);
    const last = await state(page);
    assert.ok(first.rows < 4999 && last.rows === 6000, `the reply is drawn after the first screen (${first.rows} rows, then ${last.rows})`);
    const seen = await page.evaluate((flagged) => {
      const re = new RegExp(flagged);
      const root = document.querySelector('[data-marxy-derived]');
      const bare = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (re.test(t.data) && !t.parentElement.closest('.marxy-invisible')) bare.push(t.data);
      }
      const titles = [...root.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).filter((t) => re.test(t));
      const late = [...root.querySelectorAll('.marxy-turn')][4999];
      return {
        bare,
        titles,
        markers: late.querySelectorAll('.marxy-invisible').length,
        image: (() => {
          const span = late.querySelector('.marxy-derived-image')?.cloneNode(true);
          for (const glyph of span?.querySelectorAll('.marxy-invisible-glyph') ?? []) glyph.remove();
          return span?.textContent ?? null;
        })(),
        imageMarked: late.querySelector('.marxy-derived-image .marxy-invisible-bidi') !== null,
        title: late.querySelector('a[title]')?.getAttribute('title') ?? null,
      };
    }, FLAGGED.source);
    assert.deepEqual(seen.bare, [], 'no flagged character stands bare anywhere in the view');
    assert.deepEqual(seen.titles, [], 'nor in a title');
    assert.equal(seen.markers, 4, 'the text\'s override, the alt\'s override, and the isolate pair');
    assert.equal(seen.image, 'image: a\u202eb', 'the alt keeps its character, inside its marker');
    assert.equal(seen.imageMarked, true);
    assert.equal(seen.title, 't[U+200B]t', 'a title says the character by its code');
  }));

test('reading, folding, filtering, copying and switching to Source and back write nothing', () =>
  withPage({ '/s/40-session.jsonl': SESSION }, '/s/40-session.jsonl', async (page) => {
    await settled(page);
    const mod = await page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
    for (const fold of await page.locator('.marxy-tool-line').all()) await fold.click();
    await page.locator('.marxy-turn >> nth=0').locator('[data-marxy-speaker]').click();
    await page.keyboard.press(`${mod}+KeyC`);
    for (const id of ['transcript.only-you', 'transcript.only-you', 'transcript.collapse-tools', 'transcript.collapse-tools']) {
      await page.evaluate(async (command) => {
        const { buildAppContext } = await import('/src/selection/bind.ts');
        await window.__marxyHandle.commands().find((c) => c.id === command).run(buildAppContext(window.__marxyHandle));
      }, id);
    }
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    assert.ok(await page.evaluate(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem')), 'the copy reached the pasteboard');
    assert.equal(await appWrites(page), 0);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.store().snapshot().dirty), false);
  }));

// ---- commitment 5: a large session, and an append to it ----------------------------------------------------------------

const LARGE_SOURCE = `
  window.__sessionLine = (n) => n % 4 === 0 ? JSON.stringify({ type: 'user', message: { role: 'user', content: 'Prompt ' + n + ': look at the thing number ' + n + '.' }, sessionId: 's', timestamp: 't' })
    : n % 4 === 1 ? JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'Reply ' + n + ' with *some* markdown:\\n\\n- one\\n- two\\n\\n' + 'More words here. '.repeat(20) }, { type: 'tool_use', id: 't' + n, name: 'Bash', input: { command: 'ls ' + n } }] } })
    : n % 4 === 2 ? JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + (n - 1), content: 'output line\\n'.repeat(400) }] } })
    : JSON.stringify({ type: 'file-history-snapshot', snapshot: { a: 'b'.repeat(500) } });
  window.__makeSession = (mb) => {
    const parts = [];
    let bytes = 0;
    let n = 0;
    for (; bytes < mb * 1024 * 1024; n++) {
      const l = window.__sessionLine(n) + '\\n';
      parts.push(l);
      bytes += l.length;
    }
    window.__sessionLines = n;
    return new TextEncoder().encode(parts.join(''));
  };
`;

test(`a session of ${process.env.MARXY_SESSION_MB ?? 20} MB: its first turn is painted before the deriver reaches the end, and an append draws only its own rows`, () =>
  (async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const mb = Number(process.env.MARXY_SESSION_MB ?? 20);
      const base = await harnessBase();
      await routeSkeleton(page, base);
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      await page.evaluate(LARGE_SOURCE);
      const size = await page.evaluate(async ({ mb, rule }) => {
        const bytes = window.__makeSession(mb);
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { startApp } = await import('/src/app.ts');
        const shell = createMemoryShell({ '/s/big.jsonl': bytes, '/config': new TextEncoder().encode(rule) });
        window.__shell = shell;
        window.__bytes = bytes;
        window.__t0 = performance.now();
        const handle = await startApp(shell, { argv: ['/s/big.jsonl'] });
        window.__marxyHandle = handle;
        await handle.ready;
        return bytes.length;
      }, { mb, rule: RULE });
      await page.waitForFunction(async () => {
        const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
        return transcriptIn(window.__marxyHandle.panes().focused.parts.article)?.state().firstPaint != null;
      }, null, { timeout: 120_000 });
      const first = await state(page);
      const sinceOpen = await page.evaluate((at) => at - window.__t0, first.firstPaint.at);
      await settled(page);
      const last = await state(page);
      console.log(`  ${(size / 1048576).toFixed(1)} MB: first turn painted ${sinceOpen.toFixed(0)} ms after the app started on it (${first.firstPaint.ms.toFixed(0)} ms after the view mounted), at slice ${first.firstPaint.slices} of ${last.slices} (${first.firstPaint.bytesRead} of ${size} bytes read, ${first.firstPaint.rows} rows); all ${last.rows} rows drawn`);
      assert.equal(last.done, true);
      assert.ok(first.firstPaint.slices < last.slices, 'the deriver had more slices to read at first paint');
      assert.ok(first.firstPaint.bytesRead < size, 'and had not reached the end of the file');
      assert.equal(last.rows, last.treeRows, 'every row is drawn in the end');

      // The agent appends a prompt and a reply: only they are derived and drawn, and the rows on the page stay. Counted in
      // rows and slices; the time is printed, with no ceiling.
      const appended = await page.evaluate(async () => {
        const n = window.__sessionLines;
        const tail = new TextEncoder().encode(`${window.__sessionLine(n + 4 - (n % 4))}\n${window.__sessionLine(n + 5 - (n % 4))}\n`);
        const next = new Uint8Array(window.__bytes.length + tail.length);
        next.set(window.__bytes);
        next.set(tail, window.__bytes.length);
        const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
        const view = transcriptIn(window.__marxyHandle.panes().focused.parts.article);
        const before = view.state();
        const kept = view.root.querySelector('.marxy-turn');
        const t0 = performance.now();
        await window.__shell.writeFileAtomic('/s/big.jsonl', next);
        window.__shell.emit([{ kind: 'modified', path: '/s/big.jsonl' }]);
        while (view.state().treeRows < before.treeRows + 2 || view.state().rows < view.state().treeRows || !view.state().done) await new Promise((r) => setTimeout(r, 2));
        const ms = performance.now() - t0;
        const after = view.state();
        return { ms, drawn: after.drawn - before.drawn, rows: after.rows, treeRows: after.treeRows, before: before.treeRows, keptStill: kept.isConnected, slices: after.slices - before.slices, same: transcriptIn(window.__marxyHandle.panes().focused.parts.article) === view };
      });
      console.log(`  an append to ${(size / 1048576).toFixed(1)} MB: drawn in ${appended.ms.toFixed(0)} ms, ${appended.drawn} rows drawn in ${appended.slices} slice(s)`);
      assert.ok(appended.same, 'the view was kept, not mounted again');
      assert.ok(appended.keptStill, 'the first row on the page is the same element');
      assert.equal(appended.treeRows, appended.before + 2, 'a prompt and a reply joined the tree');
      assert.ok(appended.drawn <= 3, `only the new rows, and the last old one, were drawn (${appended.drawn})`);
      assert.ok(appended.slices <= 2, `the deriver read the tail, not the file (${appended.slices} slices)`);
    } finally {
      await browser.close();
    }
  })());
