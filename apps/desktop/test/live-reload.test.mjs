// Live reload through startApp and the memory shell (MARXY-194).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from 'vite';
import { DISK_CHANGED_EDITS_KEPT, FILE_REMOVED_ON_DISK } from '../src/notices/disk.ts';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

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
      await handle.ready;
      window.__marxyHandle = handle;
      window.__watchCloses = watchCloses;
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
