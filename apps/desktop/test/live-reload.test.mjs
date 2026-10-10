// Live reload through startApp and the memory shell (MARXY-194).
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit as launchWebkitUntracked } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from 'vite';
import { DISK_CHANGED_EDITS_KEPT, FILE_REMOVED_ON_DISK } from '../src/notices/disk.ts';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
// F-30: CI lost 15-minute jobs to a test of this file that never returned. `page.evaluate` has no timeout of
// its own, so a page promise that never settles waits forever. Each test now has a deadline that fails it by
// name, and the browsers it launched are closed when it ends so a stuck evaluate is cancelled and the
// process can exit.
const TEST_TIMEOUT_MS = 60_000;
const launched = new Set();
async function launchWebkit(...args) {
  const browser = await launchWebkitUntracked(...args);
  launched.add(browser);
  return browser;
}
const closeLaunched = async () => {
  await Promise.all([...launched].map((b) => b.close().catch(() => {})));
  launched.clear();
};
const test = (name, fn) =>
  nodeTest(name, { skip, timeout: TEST_TIMEOUT_MS }, async (t) => {
    t.after(closeLaunched);
    return fn(t);
  });

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const mainRs = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8');

nodeTest('main.rs has no watch placeholders (MARXY-194)', () => {
  assert.doesNotMatch(mainRs, /Phase 0 placeholder/);
  assert.doesNotMatch(mainRs, /_root: String/);
});

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';

const A = `# Alpha\n\n${para('Alpha').repeat(12)}\n`;
const C = `# Charlie\n\n${para('Charlie').repeat(3)}\n`;

let harnessPromise;
let closeHarness = () => {};
async function harnessBase() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const desktopRoot = join(repoRoot, 'apps', 'desktop');
      const server = await createServer({
        root: desktopRoot,
        configFile: join(desktopRoot, 'vite.config.ts'),
        logLevel: 'silent',
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
      });
      await server.listen();
      closeHarness = () => server.close();
      const port = server.config.server.port;
      return `http://127.0.0.1:${port}/`;
    })();
  }
  return harnessPromise;
}
after(() => closeHarness());

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** `lateWatch`: a watch on that folder registers only after a delay, as one on Tauri does (two round trips). */
async function boot(page, files, argv, { lateWatch = null } = {}) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv, lateWatch }) => {
      const bin = atob;
      const bytes = {};
      for (const [path, b64] of Object.entries(files)) {
        const raw = bin(b64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        bytes[path] = out;
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const inner = createMemoryShell(bytes);
      const watchCloses = [];
      const origWatch = inner.watch.bind(inner);
      inner.watch = async (root, onEvents) => {
        if (root === lateWatch) await new Promise((r) => setTimeout(r, 300));
        const handle = await origWatch(root, onEvents);
        return {
          close() {
            watchCloses.push(root);
            handle.close();
          },
        };
      };
      const { startApp } = await import('/src/app.ts');
      const handle = await startApp(inner, { argv });
      window.__marxyHandle = handle;
      window.__watchCloses = watchCloses;
      // `ready` settles only once the engine reports a paint after the render, and a headless page that
      // never does leaves it pending forever (startup/measure.ts, by design). Bound it: every test goes on
      // to wait for its own condition, which has its own deadline.
      await Promise.race([handle.ready, new Promise((r) => setTimeout(r, 15_000))]);
    },
    { files, argv, lateWatch },
  );
}

test('modified on disk reloads appended text and keeps byteOffset', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const appended = '\n\nAppended paragraph after external write.\n';
    const files = { '/r/A.md': b64(A) };
    await boot(page, files, ['/r/A.md']);
    await page.evaluate(() => window.scrollTo(0, 99999));
    await page.waitForFunction(() => window.scrollY > 80);
    const before = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    const nextA = A + appended;
    const diag = await page.evaluate(async ({ text }) => {
      const path = window.__marxyHandle.currentPath();
      const beforeLen = (await window.__marxyHandle.shell.readFile(path)).length;
      const bytes = new TextEncoder().encode(text);
      await window.__marxyHandle.shell.writeFileAtomic(path, bytes);
      const afterLen = (await window.__marxyHandle.shell.readFile(path)).length;
      const readsBefore = window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile').length;
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
      // Wait on the observable effect (the watch handler reading the file) with a bounded deadline,
      // not a fixed sleep: a slow runner just takes longer, and a handler that never reads fails at 5 s.
      const deadline = performance.now() + 5000;
      while (
        window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile').length <= readsBefore &&
        performance.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const readsAfter = window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile').length;
      const marks = window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]);
      const notices = document.getElementById('marxy-notices')?.textContent ?? '';
      return { path, beforeLen, afterLen, readsBefore, readsAfter, marks, notices };
    }, { text: nextA });
    assert.ok(diag.afterLen > diag.beforeLen, `disk write did not change bytes (${diag.beforeLen} → ${diag.afterLen})`);
    assert.ok(diag.readsAfter > diag.readsBefore, `watch handler did not read (${JSON.stringify(diag)})`);
    assert.ok(
      diag.marks.includes('live_reload'),
      `expected live_reload mark; notices=${diag.notices}; marks=${diag.marks.join(',')}`,
    );
    await page.waitForFunction(
      (snippet) => document.getElementById('doc')?.textContent?.includes(snippet),
      'Appended paragraph after external write.',
    );
    const after = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    assert.equal(after, before);
    const reloadMark = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.find((c) => c.method === 'mark' && c.args[0] === 'live_reload' && String(c.args[2] ?? '').includes('ms=')),
    );
    assert.ok(reloadMark, 'expected live_reload mark with ms=');
  } finally {
    await browser.close();
  }
});

/** Many short turns, so a write above the reader leaves most of the file's blocks unchanged (B-23). */
const T = Array.from({ length: 60 }, (_, i) =>
  `## Turn ${i + 1}\n\n${para(`Turn ${i + 1}`)}\n\n- an item with \`code\`\n  - nested *a* b\n\n\`\`\`js\nconst n = ${i};\n\`\`\`\n\n`,
).join('');

test('a write above the reader in a long file reloads to the whole parse of the new bytes, at the same text (B-23)', async () => {
  const { parseMarkdown } = await import('../../../packages/core/src/parse/parse.ts');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/T.md': b64(T) }, ['/r/T.md']);
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3));
    await page.waitForFunction(() => window.scrollY > 1000);
    const writes = [
      // One line above the reader: everything after it moves.
      (text) => text.replace('## Turn 2\n', 'One line an outside editor wrote.\n\n## Turn 2\n'),
      // A fence opened above the reader and closed further down: the parse after it changes, then settles.
      (text) => text.replace('## Turn 3\n', '```\nopened\n\n').replace('## Turn 5\n', '```\n\n## Turn 5\n'),
    ];
    let text = T;
    for (const write of writes) {
      const held = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
      const heldText = Buffer.from(text).subarray(held, held + 24).toString();
      const next = write(text);
      const seen = await page.evaluate(async ({ next }) => {
        const h = window.__marxyHandle;
        const path = h.currentPath();
        const count = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
        const before = count();
        await h.shell.writeFileAtomic(path, new TextEncoder().encode(next));
        h.shell.emit([{ kind: 'modified', path }]);
        for (let i = 0; i < 500 && count() === before; i++) await new Promise((r) => setTimeout(r, 10));
        return { reloaded: count() > before, ast: JSON.stringify(h.document().snapshot().ast), place: h.sourceHarness().byteOffset };
      }, { next });
      assert.equal(seen.reloaded, true);
      assert.equal(seen.ast, JSON.stringify(parseMarkdown(new TextEncoder().encode(next), { file: '/r/T.md' })), 'the store holds the whole parse');
      assert.equal(Buffer.from(next).subarray(seen.place, seen.place + 24).toString(), heldText, 'the reader is on the same text');
      text = next;
    }
  } finally {
    await browser.close();
  }
});

/**
 * Turns of an agent transcript (B-24): a heading, prose, a task, a list, a fence, an HTML comment (which renders
 * nothing) and a table. `turns(220)` is over 64 KiB, the size from which a reload replaces blocks rather
 * than render the page whole; `turns(2000)` is a megabyte, which a progressive mount takes a while to fill.
 */
const turn = (i) =>
  `## Turn ${i}\n\n${para(`Turn ${i}`)}\n\n- [ ] task ${i}\n- an item with \`code\`\n\n\`\`\`js\nconst n = ${i};\n\`\`\`\n\n<!-- tool call ${i} -->\n\n| a | b |\n|---|---|\n| ${i} | y |\n\n`;
const turns = (n) => Array.from({ length: n }, (_, i) => turn(i + 1)).join('');
const BIG = turns(220);

/** Writes `next` over the open file from outside, and resolves once the reload has settled at the reader's place. */
async function writeFromOutside(page, next) {
  return page.evaluate(async ({ next }) => {
    const h = window.__marxyHandle;
    const path = h.currentPath();
    const count = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
    const before = count();
    await h.shell.writeFileAtomic(path, new TextEncoder().encode(next));
    h.shell.emit([{ kind: 'modified', path }]);
    for (let i = 0; i < 1000 && count() === before; i++) await new Promise((r) => setTimeout(r, 10));
    const repaint = performance.getEntriesByName('marxy:repaint').at(-1);
    return { reloaded: count() > before, repaint: repaint?.detail ?? null, place: h.sourceHarness().byteOffset };
  }, { next });
}

/** The page's top-level provenance against the document's: every block that renders an element, in order. */
function pageMatchesDocument(page) {
  return page.evaluate(() => {
    const kinds = new Set(['paragraph', 'heading', 'list', 'blockquote', 'codeBlock', 'table', 'thematicBreak', 'mathBlock']);
    const ast = window.__marxyHandle.document().snapshot().ast;
    const want = ast.children.filter((b) => kinds.has(b.type)).map((b) => [b.src.start, b.src.end]);
    const got = [...document.querySelectorAll('#doc > [data-marxy-s]')].map((el) => [Number(el.getAttribute('data-marxy-s')), Number(el.getAttribute('data-marxy-e'))]);
    const sameRanges = got.length === want.length && got.every(([s, e], i) => s === want[i][0] && e === want[i][1]);
    return { sameRanges, got: got.length, want: want.length };
  });
}

test('a reload replaces only the blocks it changed; the rest stay the same elements, moved, and the reader keeps the place (B-24)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/B.md': b64(BIG) }, ['/r/B.md']);
    await page.evaluate(async () => {
      await window.__marxyHandle.contentComplete();
      window.scrollTo(0, window.innerHeight * 3);
      // Every top-level element is told apart by what a reload must not replace: its own object.
      [...document.getElementById('doc').children].forEach((el, i) => { el.__before = i; });
    });
    await page.waitForFunction(() => window.scrollY > 1000);
    const held = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    const heldText = Buffer.from(BIG).subarray(held, held + 24).toString();
    // One paragraph rewritten above the reader (every block after it moves), carrying markup the sanitiser must refuse.
    const hostile = '<img src="x" onerror="alert(1)"> <b onclick="alert(1)">bold</b> rewritten by an outside editor';
    const next = BIG.replace(para('Turn 2'), `${hostile}\n`);
    const seen = await writeFromOutside(page, next);
    assert.equal(seen.reloaded, true);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    const after = await page.evaluate(() => {
      const article = document.getElementById('doc');
      const children = [...article.children];
      const kept = children.filter((el) => el.__before !== undefined);
      const turn = (n) => [...article.querySelectorAll('h2')].find((h) => h.textContent === `Turn ${n}`);
      const far = turn(190);
      return {
        total: children.length,
        kept: kept.length,
        farKept: far?.__before !== undefined,
        farBlockKept: far?.nextElementSibling?.__before !== undefined,
        rewritten: [...children].find((el) => el.textContent.includes('rewritten by an outside editor'))?.__before,
        hasOnerror: article.querySelector('[onerror], [onclick]') !== null,
        rewrittenText: [...article.querySelectorAll('p')].find((el) => el.textContent.includes('rewritten by an outside editor'))?.textContent ?? '',
      };
    });
    assert.ok(after.kept > after.total - 8, `only the changed blocks were replaced: ${after.kept} of ${after.total} elements are the ones from before`);
    assert.equal(after.farKept, true, 'a heading far below the change is the same element');
    assert.equal(after.farBlockKept, true, 'and so is the block after it');
    assert.equal(after.rewritten, undefined, 'the rewritten paragraph is a new element');
    assert.equal(after.hasOnerror, false, 'the sanitiser ran over the new bytes');
    assert.match(after.rewrittenText, /rewritten by an outside editor/);
    const matches = await pageMatchesDocument(page);
    assert.equal(matches.sameRanges, true, `the page's provenance is the document's: ${JSON.stringify(matches)}`);
    assert.equal(Buffer.from(next).subarray(seen.place, seen.place + 24).toString(), heldText, 'the reader is on the same text');

    // The shifted provenance is what an edit resolves through: a task far below the change toggles its own bytes.
    const task = await page.evaluate(() => {
      const box = [...document.querySelectorAll('#doc input[type="checkbox"]')].find((el) => el.closest('li')?.textContent.includes('task 150'));
      box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return Number(box.getAttribute('data-marxy-s'));
    });
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    const marker = await page.evaluate((start) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes.subarray(start, start + 3)), task);
    assert.equal(marker, '[x]', 'the click toggled the task at the shifted offset');
  } finally {
    await browser.close();
  }
});

test('formulas set before a reload are not set again, and a new one is set (B-24)', async () => {
  const withMath = Array.from({ length: 400 }, (_, i) => `## Turn ${i + 1}\n\n${para(`Turn ${i + 1}`)}\n\nInline $a_{${i}}$ here.\n\n$$\nx_{${i}}^2\n$$\n\n`).join('');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/M.md': b64(withMath) }, ['/r/M.md']);
    const unset = () => document.querySelectorAll('#doc pre.marxy-math-block:not([data-marxy-done="math"]), #doc code.marxy-math:not([data-marxy-done="math"])').length;
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.waitForFunction(`(${unset})() === 0 && document.querySelector('#doc .katex') !== null`, null, { timeout: 30000 });
    const before = await page.evaluate(() => {
      const turn = [...document.querySelectorAll('#doc h2')].find((h) => h.textContent === 'Turn 300');
      const block = (turn.nextElementSibling.nextElementSibling.nextElementSibling);
      return { text: block.textContent, tag: block.tagName, kept: (block.__before = 1) };
    });
    const next = withMath.replace('## Turn 2\n', () => '$$\ny^2 + z^2\n$$\n\n## Turn 2\n');
    const seen = await writeFromOutside(page, next);
    assert.equal(seen.repaint?.how, 'replaced', JSON.stringify(seen.repaint));
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.waitForFunction(`(${unset})() === 0`, null, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const turn = [...document.querySelectorAll('#doc h2')].find((h) => h.textContent === 'Turn 300');
      const block = turn.nextElementSibling.nextElementSibling.nextElementSibling;
      const fresh = [...document.querySelectorAll('#doc pre.marxy-math-block')].find((el) => el.textContent.includes('z'));
      return { text: block.textContent, kept: block.__before === 1, freshSet: fresh?.querySelector('.katex') !== null && fresh?.dataset.marxyDone === 'math' };
    });
    assert.equal(after.kept, true, 'the formula block below the change is the same element');
    assert.equal(after.text, before.text, 'and holds what KaTeX made of it, not a second pass over that');
    assert.equal(after.freshSet, true, 'the formula written in the change is set');
  } finally {
    await browser.close();
  }
});

test('a reload while the first mount is still filling does not set a formula twice (B-24)', async () => {
  const text = Array.from({ length: 2000 }, (_, i) => `## Section ${i + 1}\n\nInline $a_{${i}}$ here.\n\n`).join('');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/F.md': b64(text) }, ['/r/F.md']);
    const seen = await writeFromOutside(page, text.replace('## Section 2\n', () => 'One line an outside editor wrote.\n\n## Section 2\n'));
    assert.equal(seen.repaint?.how, 'replaced', JSON.stringify(seen.repaint));
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    const unset = () => document.querySelectorAll('#doc code.marxy-math:not([data-marxy-done="math"])').length;
    await page.waitForFunction(`(${unset})() === 0`, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const formulas = (p) => p.evaluate(() => [...document.querySelectorAll('#doc code.marxy-math')].map((el) => el.textContent));
    const got = await formulas(page);
    // The same document opened and left alone: what KaTeX makes of each formula once.
    const quiet = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(quiet, { '/r/F.md': b64(text) }, ['/r/F.md']);
    await quiet.evaluate(() => window.__marxyHandle.contentComplete());
    await quiet.waitForFunction(`(${unset})() === 0`, null, { timeout: 60000 });
    const want = await formulas(quiet);
    const wrong = got.map((t, i) => (t === want[i] ? null : [i, t, want[i]])).filter(Boolean).slice(0, 3);
    assert.deepEqual(wrong, [], 'every formula holds what KaTeX makes of it once');
  } finally {
    await browser.close();
  }
});

test('after Save as the open document still gives its HTML (B-24)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/Y.md': b64(BIG) }, ['/r/Y.md']);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await writeFromOutside(page, BIG.replace('## Turn 2\n', () => 'A line.\n\n## Turn 2\n'));
    const seen = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      h.shell.queueSaveDialog('/e/Y.md');
      await h.save({ as: true });
      const html = h.state.document.html;
      return { type: typeof html, length: html.length, has: html.includes('A line.') };
    });
    assert.deepEqual(seen.type, 'string');
    assert.equal(seen.has, true);
  } finally {
    await browser.close();
  }
});

test('a reload while the mount is still filling replaces blocks in what is pending as well (B-24)', async () => {
  const text = turns(1700);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/C.md': b64(text) }, ['/r/C.md']);
    const filling = await page.evaluate(async () => {
      let done = false;
      void window.__marxyHandle.contentComplete().then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 0));
      const article = document.getElementById('doc');
      [...article.children].forEach((el, i) => { el.__before = i; });
      return { complete: done, mounted: article.childElementCount };
    });
    assert.equal(filling.complete, false, 'the page is still being filled when the file changes');
    // A line above the reader, in what the page holds, then a paragraph far down, in what is still pending.
    const near = text.replace('## Turn 2\n', 'One line an outside editor wrote.\n\n## Turn 2\n');
    let seen = await writeFromOutside(page, near);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    const next = near.replace('## Turn 1500\n', '## Turn 1500\n\nAnd one far down.\n\n');
    seen = await writeFromOutside(page, next);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    const matches = await pageMatchesDocument(page);
    assert.equal(matches.sameRanges, true, `every block is in the page once, at the document's ranges: ${JSON.stringify(matches)}`);
    const far = await page.evaluate(() => [...document.querySelectorAll('#doc p')].some((p) => p.textContent === 'And one far down.'));
    assert.equal(far, true, 'the block written in the part not yet mounted is in the page');
  } finally {
    await browser.close();
  }
});

test('a reload that adds a footnote renders the page whole, and the next ordinary one replaces blocks again (B-24)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/D.md': b64(BIG) }, ['/r/D.md']);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    const withNote = BIG.replace('## Turn 3\n', 'A claim[^1].\n\n[^1]: the note\n\n## Turn 3\n');
    let seen = await writeFromOutside(page, withNote);
    assert.equal(seen.repaint?.how, 'whole');
    assert.match(seen.repaint?.reason ?? '', /footnote/);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    assert.equal((await pageMatchesDocument(page)).sameRanges, true);
    assert.equal(await page.evaluate(() => document.querySelector('#doc .marxy-footnotes') !== null), true, 'the footnote list is there');
    // The same file with the note gone is a whole render too (the page held a footnote), and then blocks are kept again.
    seen = await writeFromOutside(page, BIG);
    assert.equal(seen.repaint?.how, 'whole');
    assert.equal(await page.evaluate(() => document.querySelector('#doc .marxy-footnotes') === null), true, 'and the list is gone');
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    seen = await writeFromOutside(page, BIG.replace('## Turn 4\n', 'One more line.\n\n## Turn 4\n'));
    assert.equal(seen.repaint?.how, 'replaced', JSON.stringify(seen.repaint));
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    assert.equal((await pageMatchesDocument(page)).sameRanges, true);
  } finally {
    await browser.close();
  }
});

// The differential check of B-24, run in the page (Playwright serialises this function, so it holds
// everything it uses): random edits over the corpus, each rendered two ways, and the two must agree.
//
//   whole        `renderDocumentSafeHtml` over the new parse, as every open and every other repaint does
//   replaced     the page the previous render left, with `spliceRendered` putting in only the blocks the
//                edit changed and moving the provenance of the blocks after them
//
// "Agree" is the page's markup byte for byte (`innerHTML`, so every element, attribute and
// `data-marxy-s` / `data-marxy-e` value) and the sanitiser's removals, in order. An edit the shortcut
// declines (`spliced: false`) is a whole render and is correct by definition; the count of those, by
// reason, comes back so a test can see it is not declining everything. Edits are chained, as a long-lived
// page meets them: after a replacement the next edit splices into the replaced page, and the page is
// cut at a random block between what is "in the page" and what a progressive mount still holds.
//
// Returns `{ cases, spliced, declined: { reason: count }, kept, replaced, mismatches }`.
async function differential({ docs, core, seeds, edits = 6 }) {
  const imp = (p) => import(`/@fs${core}${p}`);
  const { parseMarkdown } = await imp('packages/core/src/parse/parse.ts');
  const { reparseMarkdown } = await imp('packages/core/src/parse/reparse.ts');
  const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
  const { DEFAULT_POLICY } = await imp('packages/core/src/sanitize/policy.ts');
  const { spliceRendered, renderRecord, parseInert } = await import('/src/render/incremental.ts');

  const enc = new TextEncoder();
  const inert = document.implementation.createHTMLDocument('');
  const mulberry32 = (a) => () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

  // What an editor, or an agent writing a transcript, might put into a file: blocks of every kind, the
  // constructs a render reaches across blocks with (duplicate headings, footnotes, definitions, raw tags
  // left open or closed that were never opened), and bare noise.
  const FRAGMENTS = [
    'Words an outside editor wrote.',
    'A longer paragraph with **bold**, *emphasis*, `code` and a [link](https://example.com/page) in it.',
    '# A new heading',
    '## Same heading',
    '## Turn 1',
    'Setext heading\n==============',
    '- an item\n- another item\n  - nested',
    '1. one\n2. two',
    '> a quote\n> over two lines',
    '```js\nconst x = 1;\n```',
    '```mermaid\ngraph TD\n  a --> b\n```',
    '~~~\ntilde fence\n~~~',
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '$$\nx^2 + y^2\n$$',
    'inline math $a+b$ here',
    '---',
    '<!-- a comment -->',
    '<details>\n<summary>Summary</summary>\n\nBody.\n\n</details>',
    'text with <b>raw bold</b> in it',
    'a stray </b> closer',
    '<div>an open div',
    '</div>',
    '<span class="x">span</span> and <kbd>K</kbd> and a<br>break',
    '*emphasis <b> across* raw</b>',
    '- first </ul> stray close\n- second item\n- third',
    '> a quote </blockquote> stray\n> more quote',
    '1. one </ol> stray\n2. two',
    '- an item </li> with a stray\n  continued',
    'a stray </p> closer and <p> opener',
    '- item <ul> raw open\n- next',
    '![remote](https://example.com/a.png)',
    '![other](https://other.example.org/b.png)',
    '![local](./image.png)',
    '[ref]: https://example.com/ref',
    '[^1]: a footnote',
    'a reference[^1] to it',
    '- [ ] a task\n- [x] done',
    '    indented code',
    '<script>alert(1)</script>',
    '<style>p { color: red }</style>',
    'hard  \nbreak',
    '"quoted" -- text... and it\'s smart',
    '# Heading {#my-id}',
    '<p align="center">aligned</p>',
    '​zero width and ‮bidi',
    '',
    ' ',
  ];

  const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
  /** One edit of `text`: an insertion, a deletion or a replacement, at a line or inside one. */
  const edit = (rnd, text) => {
    const lines = text.split('\n');
    const kind = rnd();
    const at = Math.floor(rnd() * (lines.length + 1));
    const blank = rnd() < 0.7 ? '\n' : '';
    if (kind < 0.45) {
      const piece = pick(rnd, FRAGMENTS);
      return [...lines.slice(0, at), ...(blank ? [''] : []), piece, ...(blank ? [''] : []), ...lines.slice(at)].join('\n');
    }
    if (kind < 0.7) {
      const n = 1 + Math.floor(rnd() * 3);
      return [...lines.slice(0, at), ...lines.slice(at + n)].join('\n');
    }
    if (kind < 0.85) {
      return [...lines.slice(0, at), pick(rnd, FRAGMENTS), ...lines.slice(at + 1)].join('\n');
    }
    // Inside a line.
    const i = Math.min(at, lines.length - 1);
    const line = lines[i] ?? '';
    const cut = Math.floor(rnd() * (line.length + 1));
    const next = [...lines];
    next[i] = line.slice(0, cut) + (rnd() < 0.5 ? pick(rnd, ['x', ' word', '**', '`', '<b>', '</b>', '[', ']: y', '\t', '#']) : '') + line.slice(cut + Math.floor(rnd() * 3));
    return next.join('\n');
  };

  /** The page as a render leaves it: some top-level nodes in `live`, the rest in `pending`. */
  const pageOf = (rnd, html) => {
    const live = parseInert(html);
    const pending = inert.createElement('div');
    const nodes = [...live.childNodes];
    const cut = Math.floor(rnd() * (nodes.length + 1));
    for (const node of nodes.slice(cut)) pending.appendChild(node);
    return { live, pending };
  };
  const markup = ({ live, pending }) => live.innerHTML + pending.innerHTML;
  const whole = (html) => parseInert(html).innerHTML;

  const out = { cases: 0, spliced: 0, declined: {}, kept: 0, replaced: 0, mismatches: [] };
  for (const [name, original] of Object.entries(docs)) {
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = mulberry32(hash(name) * 31 + seed);
      const file = `/d/${name}`;
      let text = original;
      let bytes = enc.encode(text);
      let ast = parseMarkdown(bytes, { file });
      let render = renderDocumentSafeHtml(ast, DEFAULT_POLICY);
      let record = renderRecord(ast, render.removed, false);
      let page = pageOf(rnd, render.html);
      for (let step = 1; step <= edits; step++) {
        const nextText = edit(rnd, text);
        const nextBytes = enc.encode(nextText);
        // Half the time the next parse shares the previous one's blocks, as the store's reload does.
        const next = rnd() < 0.5 ? reparseMarkdown(ast, bytes, nextBytes, { file }) : parseMarkdown(nextBytes, { file });
        const fresh = renderDocumentSafeHtml(next, DEFAULT_POLICY);
        out.cases++;
        const result = spliceRendered(record, next, page, { policy: DEFAULT_POLICY });
        if (result.spliced) {
          out.spliced++;
          out.kept += result.value.kept;
          out.replaced += result.value.replaced.new;
          const got = markup(page);
          const want = whole(fresh.html);
          const removedGot = JSON.stringify(result.value.removed);
          const removedWant = JSON.stringify(fresh.removed);
          if (got !== want || removedGot !== removedWant) {
            let i = 0;
            while (i < got.length && got[i] === want[i]) i++;
            out.mismatches.push({
              name,
              seed,
              step,
              markup: got === want ? 'same' : { at: i, got: got.slice(Math.max(0, i - 80), i + 120), want: want.slice(Math.max(0, i - 80), i + 120) },
              removed: removedGot === removedWant ? 'same' : { got: removedGot.slice(0, 300), want: removedWant.slice(0, 300) },
              edit: nextText.length - text.length,
            });
            if (out.mismatches.length >= 5) return out;
          }
          record = result.value.record;
        } else {
          out.declined[result.reason] = (out.declined[result.reason] ?? 0) + 1;
          page = pageOf(rnd, fresh.html);
          record = renderRecord(next, fresh.removed, false);
        }
        text = nextText;
        bytes = nextBytes;
        ast = next;
        render = fresh;
      }
    }
  }
  return out;
}

test('random edits over the corpus: the blocks a reload replaces give the markup of a whole render, byte for byte (B-24)', async () => {
  const { generateTranscript } = await import('../../../scripts/measure-reload.mjs');
  const corpus = join(repoRoot, 'fixtures', 'corpus');
  const docs = {};
  for (const name of readdirSync(corpus)) {
    // The long reference alone is most of the time and nothing here the others do not hold.
    if (name.endsWith('.md') && name !== 'README.md' && name !== '32-long-reference.md') docs[name] = readFileSync(join(corpus, name), 'utf8');
  }
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(`${await harnessBase()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const small = await page.evaluate(differential, { docs, core: repoRoot, seeds: 8 });
    // A long transcript, where most of the blocks stay: fewer, larger cases.
    const big = await page.evaluate(differential, { docs: { 'transcript.md': generateTranscript(160 * 1024).toString('utf8') }, core: repoRoot, seeds: 3, edits: 8 });
    for (const result of [small, big]) {
      assert.deepEqual(result.mismatches, [], `the replaced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1200)}`);
    }
    // The check is not vacuous: most edits are replaced, and the rest are declined for a reason that names it.
    assert.ok(small.spliced > small.cases / 3, `edits replaced: ${small.spliced} of ${small.cases}; declined ${JSON.stringify(small.declined)}`);
    assert.ok(big.spliced > big.cases * 0.6, `edits replaced in the transcript: ${big.spliced} of ${big.cases}; declined ${JSON.stringify(big.declined)}`);
    assert.ok(big.kept > big.replaced * 20, `most blocks are kept (${big.kept}) rather than replaced (${big.replaced})`);
  } finally {
    await browser.close();
  }
});

test('Save as closes the old folder\'s watch and watches the new one', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A) }, ['/r/A.md']);
    const seen = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      h.shell.queueSaveDialog('/e/A.md');
      const result = await h.save({ as: true });
      return {
        result,
        watched: h.shell.calls.filter((c) => c.method === 'watch').map((c) => c.args[0]),
        closes: [...window.__watchCloses],
      };
    });
    assert.equal(seen.result, 'saved');
    assert.deepEqual(seen.watched, ['/r', '/e']);
    assert.deepEqual(seen.closes, ['/r'], 'the old folder is no longer watched');
  } finally {
    await browser.close();
  }
});

test('a write right after Save as reloads, when the new folder\'s watch registers late (Tauri)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A) }, ['/r/A.md'], { lateWatch: '/e' });
    const seen = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      h.shell.queueSaveDialog('/e/A.md');
      const result = await h.save({ as: true });
      // At once, before anything else runs: another program writes the file the reader just saved.
      await h.shell.writeFileAtomic('/e/A.md', new TextEncoder().encode('# Rewritten\n\nBy someone else.\n'));
      h.shell.emit([{ kind: 'modified', path: '/e/A.md' }]);
      const reloaded = () => h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload');
      for (let i = 0; i < 500 && !reloaded(); i++) await new Promise((r) => setTimeout(r, 10));
      return { result, reloaded: reloaded(), heading: document.querySelector('#doc h1')?.textContent };
    });
    assert.equal(seen.result, 'saved');
    assert.equal(seen.reloaded, true, 'the write after Save as was seen');
    assert.equal(seen.heading, 'Rewritten');
  } finally {
    await browser.close();
  }
});

test('one watch per open and the previous handle is closed', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const files = { '/r/A.md': b64(A), '/s/C.md': b64(C) };
    await boot(page, files, ['/r/A.md']);
    const watchesAfterA = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'watch').length,
    );
    assert.equal(watchesAfterA, 1);
    await page.evaluate(() => window.__marxyHandle.open('/s/C.md'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/s/C.md');
    const { watchCount, closes } = await page.evaluate(() => ({
      watchCount: window.__marxyHandle.shell.calls.filter((c) => c.method === 'watch').length,
      closes: window.__watchCloses.length,
    }));
    assert.equal(watchCount, 2);
    assert.equal(closes, 1);
  } finally {
    await browser.close();
  }
});

test('dirty Source buffer keeps edits and shows the disk-changed notice', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A) }, ['/r/A.md']);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    await page.click('#marxy-source');
    await page.keyboard.type('x');
    const hashBefore = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    await page.evaluate(async () => {
      const path = window.__marxyHandle.currentPath();
      const bytes = new TextEncoder().encode('# totally different\n');
      await window.__marxyHandle.shell.writeFileAtomic(path, bytes);
    });
    const writesBefore = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/index-')).length,
    );
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: window.__marxyHandle.currentPath() }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), DISK_CHANGED_EDITS_KEPT);
    const hashAfter = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    const writesAfter = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/index-')).length,
    );
    assert.equal(hashAfter, hashBefore);
    assert.equal(writesAfter, writesBefore);
  } finally {
    await browser.close();
  }
});

// F-15: the memory shell cannot model a symlink, so this pins the webview half only: once the
// watcher names the link path (the Rust tests pin that it does), an open link reloads and, when
// the link goes, shows the removal notice.
test('events on the open link path reload it and show the removal notice (F-15)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/docs/link.md': b64(C) }, ['/r/docs/link.md']);
    await page.evaluate(async () => {
      const path = '/r/docs/link.md';
      await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode('# Charlie\n\nThe target was edited.\n'));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('The target was edited.'));
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: '/r/docs/link.md' }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), FILE_REMOVED_ON_DISK);
  } finally {
    await browser.close();
  }
});

test('deleted event keeps the page and shows file-removed notice', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A) }, ['/r/A.md']);
    const heading = await page.evaluate(() => document.querySelector('#doc h1')?.textContent);
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: '/r/A.md' }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), FILE_REMOVED_ON_DISK);
    const after = await page.evaluate(() => document.querySelector('#doc h1')?.textContent);
    assert.equal(after, heading);
  } finally {
    await browser.close();
  }
});

// 2026-09-26 review (MARXY-246).
test('a rename of the open file follows it and leaves opens working', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A), '/s/C.md': b64(C) }, ['/r/A.md']);
    await page.evaluate(async (text) => {
      const shell = window.__marxyHandle.shell;
      await shell.writeFileAtomic('/r/A-renamed.md', new TextEncoder().encode(text));
      shell.emit([{ kind: 'renamed', path: '/r/A.md', to: '/r/A-renamed.md' }]);
    }, A);
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/A-renamed.md', null, { timeout: 5000 });
    // The follow used to queue itself behind its own task: every open after it waited forever.
    const opened = await page.evaluate(() =>
      Promise.race([
        window.__marxyHandle.open('/s/C.md').then(() => window.__marxyHandle.currentPath()),
        new Promise((r) => setTimeout(() => r('timed out'), 5000)),
      ]),
    );
    assert.equal(opened, '/s/C.md');
  } finally {
    await browser.close();
  }
});

test('edits folded in from an earlier Source visit are kept when the file changes on disk', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/A.md': b64(A) }, ['/r/A.md']);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    await page.click('#marxy-source');
    await page.keyboard.type('x');
    // Back to Rendered folds the edit into the buffer, unsaved; into Source again, the editor matches it.
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'rendered');
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    const hashBefore = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    await page.evaluate(async () => {
      const path = window.__marxyHandle.currentPath();
      await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode('# changed elsewhere\n'));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), DISK_CHANGED_EDITS_KEPT);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash), hashBefore);
  } finally {
    await browser.close();
  }
});

test('text written at a held heading\'s first byte leaves the heading on the page (F-19)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const head = `# Alpha\n\n${para('Alpha').repeat(12)}\n\n`;
    const tail = `## Bravo\n\n${para('Bravo').repeat(12)}\n`;
    const inserted = `Written by another program.\n\n${para('Inserted').repeat(4)}\n\n`;
    await boot(page, { '/r/A.md': b64(head + tail) }, ['/r/A.md']);
    const bravoStart = Buffer.byteLength(head, 'utf8');
    // Scroll until the reading position is the heading's start (the first block at the reading line).
    const held = await page.evaluate((want) => {
      const heading = [...document.querySelectorAll('#doc h2')].find((h) => h.textContent.includes('Bravo'));
      const top = heading.getBoundingClientRect().top + window.scrollY;
      for (let y = top - 400; y <= top + 40; y += 4) {
        window.scrollTo(0, y);
        if (window.__marxyHandle.sourceHarness().byteOffset === want) return true;
      }
      return false;
    }, bravoStart);
    assert.ok(held, 'some scroll position holds the Bravo heading as the reading position');
    await page.waitForFunction((want) => window.__marxyHandle.sourceHarness().byteOffset === want, bravoStart);
    await page.evaluate(async (text) => {
      const path = window.__marxyHandle.currentPath();
      await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode(text));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
    }, head + inserted + tail);
    await page.waitForFunction((snippet) => document.getElementById('doc')?.textContent?.includes(snippet), 'Written by another program.');
    const want = Buffer.byteLength(head + inserted, 'utf8');
    await page.waitForFunction((offset) => window.__marxyHandle.sourceHarness().byteOffset === offset, want);
    const top = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('#doc h2')].find((h) => h.textContent.includes('Bravo'));
      return heading.getBoundingClientRect().top;
    });
    assert.ok(top >= 0 && top < 400, `the Bravo heading is near the top of the page after the write (top=${top})`);
  } finally {
    await browser.close();
  }
});

test('a reader who has not scrolled stays at the top when text is written above a short opening heading (F-19.1)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    // A short heading, then a long paragraph: the reading line (40% of the window) falls in the
    // paragraph, so a reader at scrollY 0 does not naively hold byte 0.
    const doc = `# Alpha\n\n${para('Alpha').repeat(12)}\n`;
    await boot(page, { '/r/A.md': b64(doc) }, ['/r/A.md']);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset), 0);
    await page.evaluate(async (text) => {
      const path = window.__marxyHandle.currentPath();
      await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode(text));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
    }, `# Preface\n\nPrepended.\n\n${doc}`);
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('Prepended.'));
    await new Promise((r) => setTimeout(r, 300));
    const after = await page.evaluate(() => ({
      y: window.scrollY,
      b: window.__marxyHandle.sourceHarness().byteOffset,
      top: [...document.querySelectorAll('#doc p')].find((p) => p.textContent.includes('Prepended.')).getBoundingClientRect().top,
    }));
    assert.equal(after.y, 0);
    assert.equal(after.b, 0);
    assert.ok(after.top >= 0 && after.top < 760, `the prepended text is on screen (top=${after.top})`);
  } finally {
    await browser.close();
  }
});

// A reader in Source who has not scrolled is at byte 0, so text written above leaves them at the top (F-19.2).
const prependedInSource = async (page) => {
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.evaluate(async () => {
    const path = window.__marxyHandle.currentPath();
    const old = await window.__marxyHandle.shell.readFile(path);
    const text = new TextDecoder().decode(old);
    const fresh = path.endsWith('.ts') ? `// Prepended.\nconst first = 1;\n${text}` : `# Preface\n\nPrepended.\n\n${text}`;
    await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode(fresh));
    window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
  });
  await page.waitForFunction(() => document.querySelector('#marxy-source')?.textContent?.includes('Prepended.'));
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => {
    const line = [...document.querySelectorAll('#marxy-source .cm-line')].find((l) => l.textContent.includes('Prepended.'));
    return { y: window.scrollY, top: line.getBoundingClientRect().top };
  });
};

test('a .ts file opens in Source, unscrolled, and stays at the top when text is written above (F-19.2)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const code = Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i};`).join('\n') + '\n';
    await boot(page, { '/r/A.ts': b64(code) }, ['/r/A.ts']);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    const after = await prependedInSource(page);
    assert.equal(after.y, 0);
    assert.ok(after.top >= 0 && after.top < 760, `the prepended line is on screen (top=${after.top})`);
  } finally {
    await browser.close();
  }
});

test('a .md file toggled to Source, unscrolled, stays at the top when text is written above (F-19.2)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    // Hand-wrapped lines: the reading line (40% of the window) falls on a source line below the heading.
    const md = `# Alpha\n\n${Array.from({ length: 80 }, (_, i) => `Line ${i} of a paragraph that the author wrapped by hand.`).join('\n')}\n`;
    await boot(page, { '/r/A.md': b64(md) }, ['/r/A.md']);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    const after = await prependedInSource(page);
    assert.equal(after.y, 0);
    assert.ok(after.top >= 0 && after.top < 760, `the prepended line is on screen (top=${after.top})`);
  } finally {
    await browser.close();
  }
});

// F-19.3: an outside write to a file open in Source carries the caret and selection through the change.
const SOURCE_LINES = Array.from({ length: 60 }, (_, i) => `export const value${i} = ${i};`);
const withCaret = async (page, from, to = from) => {
  await page.evaluate(async ({ from, to }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const ed = activeSourceEditor(document.querySelector('#marxy-source'));
    ed.view.dispatch({ selection: { anchor: from, head: to } });
  }, { from, to });
};
const writeOutside = async (page, text) => {
  await page.evaluate(async (text) => {
    const path = window.__marxyHandle.currentPath();
    await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode(text));
    window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
  }, text);
  await page.waitForFunction(() => {
    const t = document.querySelector('#marxy-source')?.textContent ?? '';
    return t.includes('Changed') || !t.includes('value20 = 20');
  });
  await new Promise((r) => setTimeout(r, 300));
};
const selectionNow = (page) =>
  page.evaluate(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const { state } = activeSourceEditor(document.querySelector('#marxy-source')).view;
    const { anchor, head } = state.selection.main;
    return { anchor, head, text: state.sliceDoc(Math.min(anchor, head), Math.max(anchor, head)), line: state.doc.lineAt(head).text };
  });
const bootSource = async (page, { eol, bom }) => {
  await boot(page, { '/r/A.ts': b64(bom + SOURCE_LINES.join(eol) + eol) }, ['/r/A.ts']);
  await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-line'));
};

// F-23: CodeMirror counts a line break as one position and leaves the BOM out; the buffer counts both.
const FILE_SHAPES = [
  { label: '', eol: '\n', bom: '' },
  { label: ' in a CRLF file (F-23)', eol: '\r\n', bom: '' },
  { label: ' in a file with a BOM (F-23)', eol: '\n', bom: '\uFEFF' },
  { label: ' in a CRLF file with a BOM (F-23)', eol: '\r\n', bom: '\uFEFF' },
];
for (const { label, eol, bom } of FILE_SHAPES) {
test(`a write above the caret leaves the Source caret on the same text (F-19.3)${label}`, async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await bootSource(page, { eol, bom });
    const at = SOURCE_LINES.slice(0, 20).join('\n').length + 1 + 7;
    await withCaret(page, at);
    await writeOutside(page, bom + ['// Changed', '// Changed again', ...SOURCE_LINES].join(eol) + eol);
    const now = await selectionNow(page);
    assert.equal(now.line, 'export const value20 = 20;');
    assert.equal(now.anchor, now.head);
    assert.equal(now.head, ['// Changed', '// Changed again', ...SOURCE_LINES.slice(0, 20)].join('\n').length + 1 + 7);
  } finally {
    await browser.close();
  }
});

test(`a Source selection follows an insertion above it (F-19.3)${label}`, async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await bootSource(page, { eol, bom });
    const start = SOURCE_LINES.slice(0, 20).join('\n').length + 1;
    await withCaret(page, start + 13, start + 20);
    await writeOutside(page, bom + ['// Changed', ...SOURCE_LINES].join(eol) + eol);
    const now = await selectionNow(page);
    assert.equal(now.text, 'value20');
  } finally {
    await browser.close();
  }
});

test(`a Source caret inside deleted text lands at the deletion point (F-19.3)${label}`, async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await bootSource(page, { eol, bom });
    const start = SOURCE_LINES.slice(0, 20).join('\n').length + 1;
    await withCaret(page, start + 10);
    // The next line starts differently, so the deleted run is unambiguous (a shared prefix would hold the caret).
    const kept = [...SOURCE_LINES.slice(0, 20), '// tail', ...SOURCE_LINES.slice(23)];
    await writeOutside(page, bom + kept.join(eol) + eol);
    const now = await selectionNow(page);
    assert.equal(now.anchor, start);
    assert.equal(now.head, start);
    assert.equal(now.line, '// tail');
  } finally {
    await browser.close();
  }
});
}
