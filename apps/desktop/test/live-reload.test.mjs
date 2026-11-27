// Live reload through startApp and the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit as launchWebkitUntracked } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from './support/shared-vite.mjs';
import { DISK_CHANGED_EDITS_KEPT, FILE_REMOVED_ON_DISK } from '../src/notices/disk.ts';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
// CI lost 15-minute jobs to a test of this file that never returned. `page.evaluate` has no timeout of
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

nodeTest('main.rs has no watch placeholders', () => {
  assert.doesNotMatch(mainRs, /Phase 0 placeholder/);
  assert.doesNotMatch(mainRs, /_root: String/);
});

const ATTEMPT_LIMIT = 15_000;
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
async function boot(page, files, argv, opts = {}) {
  // on Linux CI about one run in twenty stalled here with no error: the page's load or the evaluate
  // below never returned, and `page.evaluate` has no timeout of its own. Each attempt gets a deadline that
  // names the stage it was in; a stalled attempt is retried on the same page (a new navigation drops the
  // stuck one), and a second stall fails the test with the stage. The retry is logged, so a recurring stall
  // stays visible.
  const ATTEMPT_MS = ATTEMPT_LIMIT;
  const attempts = 2;
  for (let attempt = 1; ; attempt++) {
    const stage = { name: 'starting' };
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`boot stalled for ${ATTEMPT_MS} ms in: ${stage.name}`)), ATTEMPT_MS);
    });
    try {
      await Promise.race([bootOnce(page, files, argv, opts, stage), deadline]);
      return;
    } catch (e) {
      if (attempt >= attempts || !String(e?.message).startsWith('boot stalled')) throw e;
      console.warn(`marxy test: ${e.message}; attempt ${attempt} of ${attempts}, retrying`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function bootOnce(page, files, argv, { lateWatch = null }, stage) {
  stage.name = 'starting the dev server';
  const base = await harnessBase();
  stage.name = 'loading app.html';
  await page.goto(`${base}app.html`, { timeout: ATTEMPT_LIMIT });
  stage.name = 'waiting for window.marxyApp.start';
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function', null, { timeout: ATTEMPT_LIMIT });
  stage.name = 'starting the app in the page (page.evaluate)';
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
      await Promise.race([handle.ready, new Promise((r) => setTimeout(r, 5_000))]);
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

/** Many short turns, so a write above the reader leaves most of the file's blocks unchanged. */
const T = Array.from({ length: 60 }, (_, i) =>
  `## Turn ${i + 1}\n\n${para(`Turn ${i + 1}`)}\n\n- an item with \`code\`\n  - nested *a* b\n\n\`\`\`js\nconst n = ${i};\n\`\`\`\n\n`,
).join('');

test('a write above the reader in a long file reloads to the whole parse of the new bytes, at the same text', async () => {
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
 * Turns of an agent transcript: a heading, prose, a task, a list, a fence, an HTML comment (which renders
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

test('a reload replaces only the blocks it changed; the rest stay the same elements, moved, and the reader keeps the place', async () => {
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

test('formulas set before a reload are not set again, and a new one is set', async () => {
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

test('a reload while the first mount is still filling does not set a formula twice', async () => {
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

test('after Save as the open document still gives its HTML', async () => {
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

test('a reload while the mount is still filling replaces blocks in what is pending as well', async () => {
  const text = turns(700);
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
    const next = near.replace('## Turn 650\n', '## Turn 650\n\nAnd one far down.\n\n');
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

test('a reload that adds a footnote renders the page whole, and the next ordinary one replaces blocks again', async () => {
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
    // The same file with the note gone is a whole render too (the notes are numbered differently), and then blocks are kept again.
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

test('on the long reference with footnotes, a change on disk replaces a handful of nodes, and a note and its back-link still land where they should', async () => {
  const LONG = readFileSync(join(repoRoot, 'fixtures', 'corpus', '32-long-reference.md'), 'utf8');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, { '/r/L.md': b64(LONG) }, ['/r/L.md']);
    // Every top-level element and every item of the list of notes is told apart by its own object; a MutationObserver
    // counts what a reload takes out of the article and puts in, at the top and in the list.
    const tag = () =>
      page.evaluate(async () => {
        await window.__marxyHandle.contentComplete();
        const article = document.getElementById('doc');
        [...article.children, ...article.querySelectorAll('ol.marxy-footnotes > li')].forEach((el) => { el.__before = true; });
        window.__changed = { removed: 0, added: 0 };
        window.__watch?.disconnect();
        window.__watch = new MutationObserver((records) => {
          for (const r of records) {
            if (r.target !== article && !r.target.matches?.('ol.marxy-footnotes')) continue;
            window.__changed.removed += [...r.removedNodes].filter((n) => n.nodeType === 1).length;
            window.__changed.added += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
          }
        });
        window.__watch.observe(article, { childList: true, subtree: true });
      });
    const counts = () =>
      page.evaluate(() => {
        const article = document.getElementById('doc');
        const items = [...article.querySelectorAll('ol.marxy-footnotes > li')];
        return { ...window.__changed, total: article.children.length, kept: [...article.children].filter((el) => el.__before).length, itemsKept: items.filter((el) => el.__before).length, items: items.length };
      });

    // One line appended at the end of the file: after the last definition, so a paragraph drawn before the list.
    await tag();
    let text = `${LONG}\nOne appended line.\n`;
    let seen = await writeFromOutside(page, text);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    let changed = await counts();
    assert.ok(changed.removed + changed.added < 10, `a handful of nodes changed: ${JSON.stringify(changed)}`);
    assert.equal(changed.itemsKept, 30, 'every note is the element it was');
    assert.equal(await page.evaluate(() => document.querySelector('#doc > ol.marxy-footnotes')?.previousElementSibling?.previousElementSibling?.textContent), 'One appended line.', 'the line is drawn after the last block, before the list');

    // A paragraph holding the seventh note's reference rewritten, and the seventh note's text changed: the paragraph and
    // that one item are new, and the rest are the elements they were, moved. Two writes: one change is one run of
    // blocks replaced, and these two are far apart.
    await tag();
    const ref = text.indexOf('[^7]');
    const lineStart = text.lastIndexOf('\n', ref) + 1;
    text = `${text.slice(0, lineStart)}Rewritten from outside, before the reference. ${text.slice(lineStart)}`;
    seen = await writeFromOutside(page, text);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    changed = await counts();
    assert.ok(changed.removed + changed.added < 10, `a handful of nodes changed: ${JSON.stringify(changed)}`);
    assert.equal(changed.itemsKept, 30, 'every note is the element it was, moved');
    assert.ok(changed.kept > changed.total - 4, `the body kept its elements: ${JSON.stringify(changed)}`);

    await tag();
    text = text.replace('[^7]: ', '[^7]: Changed from outside. ');
    seen = await writeFromOutside(page, text);
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    changed = await counts();
    assert.ok(changed.removed + changed.added < 10, `a handful of nodes changed: ${JSON.stringify(changed)}`);
    assert.equal(changed.itemsKept, 29, 'one note was drawn again');
    assert.equal(changed.kept, changed.total, `the body kept every element: ${JSON.stringify(changed)}`);
    assert.equal((await pageMatchesDocument(page)).sameRanges, true);

    // The page is the whole render of the bytes, list and all.
    const same = await page.evaluate(async (core) => {
      const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
      const { renderDocumentSafeHtml } = await import(`/@fs${root}packages/core/src/render/pipeline.ts`);
      const { DEFAULT_POLICY } = await import(`/@fs${root}packages/core/src/sanitize/policy.ts`);
      const ast = window.__marxyHandle.document().snapshot().ast;
      const { parseInert } = await import('/src/render/incremental.ts');
      const want = parseInert(renderDocumentSafeHtml(ast, DEFAULT_POLICY).html);
      const got = document.querySelector('#doc ol.marxy-footnotes');
      const wantList = want.querySelector('ol.marxy-footnotes');
      const strip = (el) => [...el.querySelectorAll('li')].map((li) => [li.id, li.getAttribute('data-marxy-s'), li.getAttribute('data-marxy-e'), li.textContent]);
      return JSON.stringify(strip(got)) === JSON.stringify(strip(wantList));
    }, repoRoot);
    assert.equal(same, true, 'the list of notes is the one a whole render draws: ids, ranges and text');

    // The reference opens its own note (under its line, or marked in the margin where there is room), and the note's
    // back-link lands on the reference.
    await page.locator('sup.marxy-footnote-ref a[href="#marxy-fn-7"]').click();
    await page.waitForFunction(() => /Changed from outside\./.test(document.querySelector('#doc [data-marxy-note="marxy-fn-7"]')?.textContent ?? ''));
    await page.locator('#marxy-fn-7 a.marxy-footnote-back').click();
    await page.waitForFunction(() => {
      const r = document.getElementById('marxy-fnref-7')?.getBoundingClientRect();
      return r !== undefined && r.top >= 0 && r.top < window.innerHeight;
    });
    assert.match(await page.evaluate(() => document.getElementById('marxy-fnref-7').closest('p').textContent), /^Rewritten from outside, before the reference\./);
  } finally {
    await browser.close();
  }
});

// The differential check, run in the page (Playwright serialises this function, so it holds
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
// With `notes`, the edits are those a document with footnotes meets: definitions written, removed, edited inside and
// reordered, references added and removed. A case whose footnotes are numbered as before is counted in `sameNumbers`, and
// `splicedSameNumbers` of them were replaced rather than declined.
//
// Returns `{ cases, spliced, declined: { reason: count }, kept, replaced, mismatches, sameNumbers, splicedSameNumbers }`.
async function differential({ docs, core, seeds, edits = 6, notes = false }) {
  // Vite's /@fs takes forward slashes after a leading one: `C:\x\` is `/C:/x/`.
  const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
  const imp = (p) => import(`/@fs${root}${p}`);
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

  // Labels as the generated documents write them, folded differently, undefined, duplicated, quoted and new.
  const NOTE_FRAGMENTS = [
    '[^a]: a new first note for a',
    '[^c]: a new note c',
    '[^C]: c again, in capitals',
    'see[^a] and[^b] here',
    'a reference to the new one[^c]',
    'a reference to[^long   label] folded',
    'no note[^nowhere] here',
    '[^b]: b again, a duplicate',
    '> [^q]: a quoted note',
    '[^long label]: changed\n\n    and continued',
    '[^zero]: one nobody calls',
  ];
  const fragments = notes ? [...FRAGMENTS, ...NOTE_FRAGMENTS, ...NOTE_FRAGMENTS] : FRAGMENTS;
  const fold = (label) => label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase();
  /** The first top-level definition of each label, folded, in order: what numbers the references. */
  const numbering = (ast) => {
    const seen = [];
    for (const child of ast.children) if (child.type === 'footnoteDefinition' && !seen.includes(fold(child.label))) seen.push(fold(child.label));
    return seen.join('\u0000');
  };

  const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
  /** One edit of `text`: an insertion, a deletion or a replacement, at a line or inside one. */
  const edit = (rnd, text) => {
    const lines = text.split('\n');
    const defs = notes ? lines.flatMap((line, i) => (/^\[\^[^\]]+\]:/.test(line) ? [i] : [])) : [];
    if (defs.length > 0) {
      const roll = rnd();
      // Inside a definition: its text after the label.
      if (roll < 0.2) {
        const i = pick(rnd, defs);
        const line = lines[i];
        const from = line.indexOf(']:') + 3;
        const cut = Math.min(line.length, from + Math.floor(rnd() * (line.length - from + 1)));
        const next = [...lines];
        next[i] = line.slice(0, cut) + pick(rnd, [' more', '[^a]', '**', ' `x`', '', ' <span class="x">s</span>', ' <b>raw</b>', ' <!-- c -->']) + line.slice(cut + Math.floor(rnd() * 3));
        return next.join('\n');
      }
      // Two definitions swapped: the numbers change unless the labels are the same.
      if (roll < 0.27 && defs.length > 1) {
        const i = pick(rnd, defs);
        const j = pick(rnd, defs);
        const next = [...lines];
        [next[i], next[j]] = [lines[j], lines[i]];
        return next.join('\n');
      }
    }
    const kind = rnd();
    const at = Math.floor(rnd() * (lines.length + 1));
    const blank = rnd() < 0.7 ? '\n' : '';
    if (kind < 0.45) {
      const piece = pick(rnd, fragments);
      return [...lines.slice(0, at), ...(blank ? [''] : []), piece, ...(blank ? [''] : []), ...lines.slice(at)].join('\n');
    }
    if (kind < 0.7) {
      const n = 1 + Math.floor(rnd() * 3);
      return [...lines.slice(0, at), ...lines.slice(at + n)].join('\n');
    }
    if (kind < 0.85) {
      return [...lines.slice(0, at), pick(rnd, fragments), ...lines.slice(at + 1)].join('\n');
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

  const out = { cases: 0, spliced: 0, declined: {}, kept: 0, replaced: 0, mismatches: [], sameNumbers: 0, splicedSameNumbers: 0, notesRedrawn: 0 };
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
        const sameNumbers = numbering(ast) === numbering(next);
        if (sameNumbers) out.sameNumbers++;
        if (result.spliced) {
          out.spliced++;
          if (sameNumbers) out.splicedSameNumbers++;
          out.kept += result.value.kept;
          out.replaced += result.value.replaced.new;
          out.notesRedrawn += result.value.notes;
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

test('random edits over the corpus: the blocks a reload replaces give the markup of a whole render, byte for byte', async () => {
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

/**
 * A long document with footnotes, its definitions where `where` says: at the top, at the bottom, in the middle, or
 * spread through it. Labels referenced several times, once and never; references before their definitions and after;
 * a label written in another case and spacing; a duplicate definition; one in a block quote; one never defined; a
 * definition of two paragraphs, and one that refers to another note.
 */
function notesDocument(where) {
  const fill = 'words to fill the line out, with *emphasis* and `code` now and then. ';
  const refs = ['[^a]', '[^b]', '[^Long  Label]', '[^nowhere]', '[^q]', '[^a]', '[^one]'];
  const body = Array.from({ length: 240 }, (_, i) => (i % 40 === 0 ? `## Part ${i / 40}\n\n` : '') + `Paragraph ${i}${i % 9 === 0 ? refs[(i / 9) % refs.length] : ''}: ${fill.repeat(2)}`);
  const defs = [
    '[^a]: The note a, referenced from many places.',
    '[^b]: The note b, which refers to a[^a] in turn.',
    '[^long label]: A note of two paragraphs.\n\n    Its second paragraph, indented under it.',
    '[^zero]: A note nobody refers to.',
    '[^A]: A second definition of a, which nothing reaches.',
    '[^one]: A note referred to once.',
  ];
  const quoted = '> [^q]: A definition inside a block quote.';
  const at = (n) => body.splice(n, 0, ...defs);
  if (where === 'top') at(0);
  else if (where === 'middle') at(120);
  else if (where === 'bottom') at(body.length);
  else defs.forEach((d, k) => body.splice(20 + k * 40, 0, d));
  body.splice(60, 0, quoted);
  return `# Notes ${where}\n\n${body.join('\n\n')}\n`;
}

nodeTest('random edits over documents with footnotes: the replaced page is the whole render, byte for byte, numbers and links included', { skip, timeout: 240_000 }, async (t) => {
  t.after(closeLaunched);
  const docs = { '32-long-reference.md': readFileSync(join(repoRoot, 'fixtures', 'corpus', '32-long-reference.md'), 'utf8') };
  for (const where of ['top', 'middle', 'bottom', 'spread']) docs[`notes-${where}.md`] = notesDocument(where);
  const browser = await launchWebkit();
  const page = await browser.newPage();
  await page.goto(`${await harnessBase()}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const result = await page.evaluate(differential, { docs, core: repoRoot, seeds: 4, edits: 8, notes: true });
  t.diagnostic(JSON.stringify({ ...result, mismatches: result.mismatches.length }));
  assert.deepEqual(result.mismatches, [], `the replaced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1600)}`);
  // Not vacuous: where the notes are numbered as before, the page is replaced in place for most edits (the rest are
  // the raw tags left open that any document declines), and items of the list were drawn again.
  assert.ok(
    result.splicedSameNumbers > result.sameNumbers * 0.6,
    `replaced ${result.splicedSameNumbers} of ${result.sameNumbers} edits that kept the numbers (${result.spliced} of ${result.cases} in all); declined ${JSON.stringify(result.declined)}`,
  );
  assert.ok(result.notesRedrawn > 0, 'some edits drew items of the list of notes again');
  // Every edit that numbers the notes differently is a whole render, and none that keeps the numbers is declined for them.
  assert.ok(result.sameNumbers < result.cases, 'some edits change the numbers');
  assert.equal(result.declined['the footnotes are numbered differently'] ?? 0, result.cases - result.sameNumbers);
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

test('one watch per open and the previous handle is kept while its store is warm', async () => {
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
    // The first document was left clean: it stays open and watched, warm, for the way back.
    assert.equal(closes, 0);
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
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !/^\/data\/(index|versions)-/.test(String(c.args[0]))).length,
    );
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: window.__marxyHandle.currentPath() }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), DISK_CHANGED_EDITS_KEPT);
    const hashAfter = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    const writesAfter = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !/^\/data\/(index|versions)-/.test(String(c.args[0]))).length,
    );
    assert.equal(hashAfter, hashBefore);
    assert.equal(writesAfter, writesBefore);
  } finally {
    await browser.close();
  }
});

// the memory shell cannot model a symlink, so this pins the webview half only: once the
// watcher names the link path (the Rust tests pin that it does), an open link reloads and, when
// the link goes, shows the removal notice.
test('events on the open link path reload it and show the removal notice', async () => {
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

// 2026-09-26 review.
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

test('text written at a held heading\'s first byte leaves the heading on the page', async () => {
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

test('a reader who has not scrolled stays at the top when text is written above a short opening heading', async () => {
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

// A reader in Source who has not scrolled is at byte 0, so text written above leaves them at the top.
// In the frame Source scrolls in the editor's own scroller (or its mount), not the window: all three are read.
const sourceScrolled = (page) => page.evaluate(() => window.scrollY + (document.querySelector('#marxy-source')?.scrollTop ?? 0) + (document.querySelector('#marxy-source .cm-scroller')?.scrollTop ?? 0));
const prependedInSource = async (page) => {
  assert.equal(await sourceScrolled(page), 0);
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
  const top = await page.evaluate(() => [...document.querySelectorAll('#marxy-source .cm-line')].find((l) => l.textContent.includes('Prepended.')).getBoundingClientRect().top);
  return { y: await sourceScrolled(page), top };
};

test('a .ts file put in Source, unscrolled, stays at the top when text is written above', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const code = Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i};`).join('\n') + '\n';
    await boot(page, { '/r/A.ts': b64(code) }, ['/r/A.ts']);
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    const after = await prependedInSource(page);
    assert.equal(after.y, 0);
    assert.ok(after.top >= 0 && after.top < 760, `the prepended line is on screen (top=${after.top})`);
  } finally {
    await browser.close();
  }
});

test('a .md file toggled to Source, unscrolled, stays at the top when text is written above', async () => {
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

// an outside write to a file open in Source carries the caret and selection through the change.
const SOURCE_LINES = Array.from({ length: 60 }, (_, i) => `export const value${i} = ${i};`);
const withCaret = async (page, from, to = from) => {
  await page.evaluate(async ({ from, to }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const ed = activeSourceEditor(document.querySelector('#marxy-source'));
    ed.view.dispatch({ selection: { anchor: from, head: to } });
  }, { from, to });
};
/** A bounded wait that says what it waited for, and what the editor held when it gave up. */
const waitForEditor = async (page, what, predicate, arg) => {
  try {
    await page.waitForFunction(predicate, arg, { timeout: 15_000 });
  } catch (cause) {
    const held = await page
      .evaluate(async () => {
        const { activeSourceEditor } = await import('/src/source/editor.ts');
        const { state } = activeSourceEditor(document.querySelector('#marxy-source')).view;
        return { head: state.doc.sliceString(0, 80), selection: state.selection.main.toJSON(), scrollTop: document.querySelector('#marxy-source .cm-scroller')?.scrollTop ?? null };
      })
      .catch((e) => `unreadable: ${e}`);
    throw new Error(`timed out waiting for ${what}; the editor held ${JSON.stringify(held)}`, { cause });
  }
};
const writeOutside = async (page, text, marker = '//') => {
  await page.evaluate(async (text) => {
    const path = window.__marxyHandle.currentPath();
    await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode(text));
    window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
  }, text);
  // Wait on the editor's own state, not on its rendered text: CodeMirror draws only the lines near the
  // viewport, so a reload that moved the view could leave the changed line undrawn and this wait unmet.
  await waitForEditor(page, 'the editor to take the outside write', async (marker) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const ed = activeSourceEditor(document.querySelector('#marxy-source'));
    return ed.view.state.doc.toString().includes(marker);
  }, marker);
  // The carried selection is dispatched in the same turn as the text; a short timer (not a frame: a headless page may deliver none) lets the view settle.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
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
  // Code lands in Read; this is about Source, one press away.
  await page.evaluate(() => window.__marxyHandle.toggleMode());
  await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-line'));
};

// CodeMirror counts a line break as one position and leaves the BOM out; the buffer counts both.
const FILE_SHAPES = [
  { label: '', eol: '\n', bom: '' },
  { label: ' in a CRLF file', eol: '\r\n', bom: '' },
  { label: ' in a file with a BOM', eol: '\n', bom: '\uFEFF' },
  { label: ' in a CRLF file with a BOM', eol: '\r\n', bom: '\uFEFF' },
];
for (const { label, eol, bom } of FILE_SHAPES) {
test(`a write above the caret leaves the Source caret on the same text${label}`, async () => {
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

test(`a Source selection follows an insertion above it${label}`, async () => {
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

test(`a Source caret inside deleted text lands at the deletion point${label}`, async () => {
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

test('a note open under its line shows the note as it is after a change on disk rewrites it in place', async () => {
  const LONG = readFileSync(join(repoRoot, 'fixtures', 'corpus', '32-long-reference.md'), 'utf8');
  const browser = await launchWebkit();
  try {
    // Narrow: no room in the margin, so a note number opens its note under the line.
    const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
    await boot(page, { '/r/L.md': b64(LONG) }, ['/r/L.md']);
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    assert.equal(await page.evaluate(() => document.getElementById('doc').hasAttribute('data-marxy-notes-margin')), false);
    await page.locator('sup.marxy-footnote-ref a[href="#marxy-fn-7"]').first().click();
    await page.waitForSelector('#doc .marxy-note-here[data-marxy-note="marxy-fn-7"]');
    const seen = await writeFromOutside(page, LONG.replace('[^7]: ', '[^7]: Changed from outside. '));
    assert.equal(seen.repaint?.how, 'replaced', `the page was set again whole: ${JSON.stringify(seen.repaint)}`);
    await page.waitForFunction(() => /^7Changed from outside\./.test(document.querySelector('#doc .marxy-note-here[data-marxy-note="marxy-fn-7"]')?.textContent ?? ''));
  } finally {
    await browser.close();
  }
});
