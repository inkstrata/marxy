// Reading position, palette history, and config theme survive relaunch (MARXY-195).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from 'vite';
import {
  HISTORY_FILE_VERSION,
  parseHistoryFile,
} from '../src/palette/history.ts';
import {
  POSITIONS_FILE_VERSION,
  parsePositionsFile,
} from '@marxy/core/src/position/storage.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const longMd = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
const quietToml = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.toml'));
const quietCss = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.css'));

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

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function lineTolerance(bytes, offset) {
  const text = new TextDecoder().decode(bytes);
  const before = text.lastIndexOf('\n', offset);
  const start = before < 0 ? 0 : before + 1;
  const after = text.indexOf('\n', offset);
  const end = after < 0 ? text.length : after;
  return end - start;
}

async function bootApp(page, files, argv, { mountPalette = false } = {}) {
  const base = await harnessBase();
  const pagePath = mountPalette ? 'test/palette-boot.html' : 'app.html';
  const target = `${base}${pagePath}`;
  if (mountPalette) {
    await page.addInitScript(() => {
      globalThis.process = { env: {} };
    });
  }
  if (!page.url().startsWith(target)) await page.goto(target);
  if (mountPalette) {
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function', undefined, {
      timeout: 15_000,
    });
    await page.evaluate(
      async ({ files, argv }) => {
        const { handle } = await window.marxyPaletteBoot.start(files, argv);
        window.__marxyHandle = handle;
      },
      { files, argv },
    );
    return;
  }
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      window.__marxyHandle = handle;
    },
    { files, argv },
  );
}

nodeTest('tauri shell exposes configPaths (ADR-0026)', () => {
  const src = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'shell', 'tauri.ts'), 'utf8');
  assert.match(src, /configPaths/);
});

test('scroll position survives quit and relaunch on the long corpus doc', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/r/long.md';
    const files = { [path]: b64(longMd) };
    await bootApp(page, files, [path]);

    await page.evaluate(async () => {
      const scroller = document.documentElement;
      for (let i = 0; i < 40; i++) {
        scroller.scrollTop += 400;
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => setTimeout(r, 600));
      await window.__marxyHandle.shell.quit(0);
    });

    const launch1 = await page.evaluate(() => window.__marxyHandle.sourceHarness());
    assert.ok(launch1 && launch1.byteOffset > 0);
    const stored = await page.evaluate(async () => {
      try {
        const bytes = await window.__marxyHandle.shell.readFile('/data/positions.json');
        return new TextDecoder().decode(bytes);
      } catch {
        return null;
      }
    });
    assert.ok(stored && stored.includes(String(launch1.byteOffset)), `positions.json missing offset: ${stored?.slice(0, 200)}`);

    const positionsBytes = await page.evaluate(async () => [
      ...await window.__marxyHandle.shell.readFile('/data/positions.json'),
    ]);
    const relaunchFiles = {
      ...files,
      '/data/positions.json': b64(Buffer.from(positionsBytes)),
    };
    await page.close();
    const page2 = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootApp(page2, relaunchFiles, [path]);

    const launch2 = await page2.evaluate(() => window.__marxyHandle.sourceHarness());
    const tol = lineTolerance(longMd, launch1.byteOffset);
    assert.ok(
      Math.abs(launch2.byteOffset - launch1.byteOffset) <= tol,
      `offset ${launch1.byteOffset} vs ${launch2.byteOffset}, line width ${tol}`,
    );
  } finally {
    await browser.close();
  }
});

test('palette empty query lists pinned document before MRU after relaunch', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const a = '/r/a.md';
    const b = '/r/b.md';
    const body = '# Title\n\nBody.\n';
    const files = { [a]: b64(Buffer.from(body)), [b]: b64(Buffer.from(body)) };
    await bootApp(page, files, [a], { mountPalette: true });

    await page.evaluate(
      async ({ a, b }) => {
        const entry = (path, title) => ({
          path,
          root: '/r',
          title,
          headings: [],
          mtimeMs: 1,
          size: 100,
          kind: 'markdown',
        });
        const handle = window.__marxyHandle;
        handle.palette.setIndexEntries([entry(a, 'A'), entry(b, 'B')]);
        await handle.open(a);
        await handle.open(b);
        const { emptySession, recordOpen, togglePin } = await import('/src/palette/session.ts');
        const { historyFromSession, serializeHistoryFile } = await import('/src/palette/history.ts');
        let session = emptySession('/r');
        session = recordOpen(session, a);
        session = recordOpen(session, b);
        session = togglePin(session, a);
        await handle.shell.writeFileAtomic(
          '/data/history.json',
          serializeHistoryFile(historyFromSession(session)),
        );
      },
      { a, b },
    );

    const historyBytes = await page.evaluate(async () => [
      ...await window.__marxyHandle.shell.readFile('/data/history.json'),
    ]);
    const historySnap = b64(Buffer.from(historyBytes));
    await page.close();
    const page2 = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootApp(page2, { ...files, '/data/history.json': historySnap }, [b], { mountPalette: true });
    const order = await page2.evaluate(async ({ a, b }) => {
      const entry = (path, title) => ({
        path,
        root: '/r',
        title,
        headings: [],
        mtimeMs: 1,
        size: 100,
        kind: 'markdown',
      });
      const handle = window.__marxyHandle;
      handle.palette.setIndexEntries([entry(a, 'A'), entry(b, 'B')]);
      const { emptyQueryPaths } = await import('/src/palette/session.ts');
      return emptyQueryPaths(handle.palette.session);
    }, { a, b });
    assert.deepEqual(order.slice(0, 2), [a, b]);
  } finally {
    await browser.close();
  }
});

test('positions.json and history.json match design envelopes', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    const path = '/r/doc.md';
    const files = { [path]: b64(Buffer.from('# Doc\n\nParagraph.\n')) };
    await bootApp(page, files, [path], { mountPalette: true });
    await page.evaluate(async () => {
      document.documentElement.scrollTop = 120;
      await new Promise((r) => setTimeout(r, 600));
      window.__marxyHandle.palette.setIndexEntries([
        { path: '/r/doc.md', root: '/r', title: 'Doc', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' },
      ]);
      await window.__marxyHandle.open('/r/doc.md');
      await window.__marxyHandle.shell.quit(0);
    });

    const snapshot = await page.evaluate(async () => {
      const positions = await window.__marxyHandle.shell.readFile('/data/positions.json');
      const history = await window.__marxyHandle.shell.readFile('/data/history.json');
      return {
        positions: Array.from(positions),
        history: Array.from(history),
      };
    });
    const positions = parsePositionsFile(new Uint8Array(snapshot.positions));
    assert.equal(positions.kind, 'ok');
    if (positions.kind === 'ok') assert.equal(positions.envelope.version, POSITIONS_FILE_VERSION);
    const history = parseHistoryFile(new Uint8Array(snapshot.history));
    assert.equal(history.quarantine, false);
    assert.equal(history.envelope.version, HISTORY_FILE_VERSION);
    assert.ok(Array.isArray(history.envelope.opens));
    assert.ok(Array.isArray(history.envelope.pins));
    assert.ok(Array.isArray(history.envelope.recentRoots));
  } finally {
    await browser.close();
  }
});

test('config.toml theme applies through configPaths after first_text', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const config = new TextEncoder().encode('theme = "/t/quiet"\n');
    const path = '/r/readme.md';
    await bootApp(
      page,
      {
        '/config': b64(config),
        [path]: b64(longMd),
        '/t/quiet/theme.toml': b64(quietToml),
        '/t/quiet/theme.css': b64(quietCss),
      },
      [path],
    );

    const result = await page.evaluate(() => {
      const marks = window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]);
      const firstText = marks.indexOf('first_text');
      const configIdx = window.__marxyHandle.shell.calls.findIndex((c) => c.method === 'configPaths');
      const readConfig = window.__marxyHandle.shell.calls.findIndex(
        (c) => c.method === 'readFile' && c.args[0] === '/config',
      );
      const style = document.getElementById('marxy-theme');
      const bg = style ? getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim() : '';
      return {
        quietBg: bg,
        firstText,
        configIdx,
        readConfig,
        hasTheme: Boolean(style?.textContent),
      };
    });
    assert.equal(result.hasTheme, true);
    assert.equal(result.quietBg, '#121210');
    assert.ok(result.firstText >= 0);
    assert.ok(result.configIdx > result.firstText, 'configPaths after first_text');
    assert.ok(result.readConfig > result.firstText, 'config read after first_text');
  } finally {
    await browser.close();
  }
});

test('no persistence read or write precedes first_text in the shell call record', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    const path = '/r/x.md';
    await bootApp(page, { [path]: b64(Buffer.from('# X\n\nText.\n')) }, [path]);
    const order = await page.evaluate(() => {
      const calls = window.__marxyHandle.shell.calls;
      const marks = calls.filter((c) => c.method === 'mark');
      const firstTextIdx = marks.findIndex((c) => c.args[0] === 'first_text');
      const markPositions = calls
        .map((c, i) => (c.method === 'mark' && c.args[0] === 'first_text' ? i : -1))
        .filter((i) => i >= 0);
      const firstTextCall = markPositions[0] ?? -1;
      const persistence = calls
        .map((c, i) => ({ i, c }))
        .filter(({ c }) => {
          if (c.method === 'configPaths') return true;
          if (c.method === 'readFile' && String(c.args[0]).includes('positions.json')) return true;
          if (c.method === 'readFile' && String(c.args[0]).includes('history.json')) return true;
          if (c.method === 'writeFileAtomic' && String(c.args[0]).includes('positions.json')) return true;
          if (c.method === 'writeFileAtomic' && String(c.args[0]).includes('history.json')) return true;
          return false;
        });
      return { firstTextCall, persistence, methods: calls.map((c) => c.method) };
    });
    assert.ok(order.firstTextCall >= 0);
    for (const { i } of order.persistence) {
      assert.ok(i > order.firstTextCall, `persistence call at ${i} before first_text at ${order.firstTextCall}`);
    }
  } finally {
    await browser.close();
  }
});
