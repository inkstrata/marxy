// Single-instance routing: second launch, Finder open, and Dock drop share one open path (MARXY-183).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const firstPath = '/docs/first.md';
const secondPath = '/docs/second.md';
const firstBody = '# first doc\n';
const secondBody = '# second doc\n';

nodeTest('docs/design/06-shell.md credits onOpenFiles to MARXY-183', () => {
  const design = readFileSync(join(repoRoot, 'docs', 'design', '06-shell.md'), 'utf8');
  assert.match(design, /`onOpenFiles`[\s\S]*?\|\s*MARXY-183\s*\|/);
  assert.doesNotMatch(design, /`onOpenFiles`[\s\S]*?\|\s*MARXY-33\s*\|/);
});

nodeTest('main.rs registers single-instance and handles RunEvent::Opened', () => {
  const main = readFileSync(join(desktopRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');
  assert.match(main, /tauri_plugin_single_instance::init/);
  assert.match(main, /RunEvent::Opened/);
  assert.match(main, /marxy:open-files/);
});

nodeTest('tauri.conf.json declares markdown file associations', () => {
  const conf = JSON.parse(readFileSync(join(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const assoc = conf.bundle.fileAssociations;
  assert.ok(Array.isArray(assoc) && assoc.length > 0);
  const exts = assoc.flatMap((row) => row.ext ?? []);
  assert.ok(exts.includes('md') && exts.includes('markdown'));
  assert.equal(assoc[0].mimeType, 'text/markdown');
});

nodeTest('tauri.ts listens for marxy:open-files', () => {
  const tauri = readFileSync(join(desktopRoot, 'src', 'shell', 'tauri.ts'), 'utf8');
  assert.match(tauri, /listen<string\[]>\('marxy:open-files'/);
  assert.match(tauri, /onOpenFiles:/);
});

let viteServer;
let baseUrl;
before(async () => {
  if (skip) return;
  viteServer = await createViteServer({
    root: desktopRoot,
    configFile: join(desktopRoot, 'vite.config.ts'),
    server: { port: 0, strictPort: false },
  });
  await viteServer.listen();
  const addr = viteServer.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 1420;
  baseUrl = `http://127.0.0.1:${port}/`;
});
after(async () => {
  await viteServer?.close();
});

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('second launch, Finder open, and Dock drop replace the open document', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${baseUrl}app.html`);
    const result = await page.evaluate(
      async ({ firstPath, secondPath, firstB64, secondB64 }) => {
        const decode = (b64) => {
          const bin = atob(b64);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        };
        const store = new Map([
          [firstPath, decode(firstB64)],
          [secondPath, decode(secondB64)],
        ]);
        const reads = [];
        let routeOpen;
        const shell = {
          platform: 'macos',
          async args() {
            return [firstPath];
          },
          async mark() {},
          async quit() {},
          async readFile(path) {
            reads.push(path);
            const bytes = store.get(path);
            if (!bytes) throw new Error(`missing: ${path}`);
            return bytes;
          },
          async writeFileAtomic() {},
          watch: async () => ({ close() {} }),
          async startupMarks() {
            return {};
          },
          async imageSize() {
            return null;
          },
          async allowAssetScope() {},
          assetUrl: (path) => path,
          onOpenFiles(cb) {
            routeOpen = cb;
          },
        };
        const simulateSecondLaunch = (argv) => {
          const file = argv.slice(1).find((a) => !a.startsWith('-'));
          routeOpen([file]);
        };
        const simulateOpenedUrl = (url) => {
          routeOpen([decodeURIComponent(url.replace(/^file:\/\//, ''))]);
        };
        const { startApp } = await import('/src/app.ts');
        const handle = await startApp(shell, { argv: [firstPath] });
        await handle.ready;
        const waitForHeading = async (text) => {
          for (let i = 0; i < 300; i++) {
            const h = document.querySelector('#doc h1')?.textContent?.trim() ?? '';
            if (h === text) return h;
            await new Promise((r) => setTimeout(r, 10));
          }
          throw new Error(`expected heading ${text}`);
        };
        const firstHeading = await waitForHeading('first doc');
        simulateSecondLaunch(['marxy', secondPath]);
        const afterSecond = await waitForHeading('second doc');
        simulateOpenedUrl(`file://${secondPath}`);
        const afterFinder = await waitForHeading('second doc');
        simulateOpenedUrl(`file://${secondPath}`);
        const afterDock = await waitForHeading('second doc');
        return {
          firstHeading,
          afterSecond,
          afterFinder,
          afterDock,
          reads,
        };
      },
      { firstPath, secondPath, firstB64: b64(firstBody), secondB64: b64(secondBody) },
    );
    assert.equal(result.firstHeading, 'first doc');
    assert.equal(result.afterSecond, 'second doc');
    assert.equal(result.afterFinder, 'second doc');
    assert.equal(result.afterDock, 'second doc');
    assert.deepEqual(result.reads.filter((p) => p === firstPath).length, 1);
    assert.ok(result.reads.filter((p) => p === secondPath).length >= 3);
  } finally {
    await browser.close();
  }
});
