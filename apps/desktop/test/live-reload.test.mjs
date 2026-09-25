// Live reload through startApp and the memory shell (MARXY-194).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from 'vite';
import { DISK_CHANGED_EDITS_KEPT, FILE_REMOVED_ON_DISK } from '../src/notices/disk.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
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

async function boot(page, files, argv) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv }) => {
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
    { files, argv },
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
      await new Promise((r) => setTimeout(r, 500));
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
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic').length,
    );
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: window.__marxyHandle.currentPath() }]);
    });
    await page.waitForFunction((text) => document.getElementById('marxy-notices')?.textContent?.includes(text), DISK_CHANGED_EDITS_KEPT);
    const hashAfter = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    const writesAfter = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic').length,
    );
    assert.equal(hashAfter, hashBefore);
    assert.equal(writesAfter, writesBefore);
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
