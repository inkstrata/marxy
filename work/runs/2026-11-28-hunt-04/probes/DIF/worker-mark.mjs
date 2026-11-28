// Open a 1 MB Markdown file in WebKit through the memory shell; print the `parsed` mark and the console.
import { createRequire } from 'node:module';
const R = 'D:/Dev/marxy-wt/hunt-04/';
const req = createRequire(R + 'apps/desktop/package.json');
const { createServer } = await import('file:///' + R + 'apps/desktop/test/support/shared-vite.mjs');
const { launchWebkit } = await import('file:///' + R + 'scripts/playwright-webkit.mjs');
const { generateLarge } = await import('file:///' + R + 'scripts/perf-harness.mjs');
const server = await createServer({ root: R + 'apps/desktop', configFile: R + 'apps/desktop/vite.config.ts', logLevel: 'silent', server: { port: 1423, strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port}/`;
const browser = await launchWebkit();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const bytes = Buffer.from(generateLarge(1024 * 1024)).toString('base64');
  const r = await Promise.race([page.evaluate(async (b64) => {
    const raw = atob(b64); const u = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const shell = createMemoryShell({ '/docs/big.md': u });
    const { startApp } = await import('/src/app.ts');
    const handle = await startApp(shell, { argv: ['/docs/big.md'] });
    await handle.ready;
    window.__shell = shell;
    await new Promise((r) => setTimeout(r, 500));
    const t = performance.now();
    return { hasWorker: typeof Worker, marks: shell.calls.filter((c) => c.method === 'mark').map((c) => [c.args[0], c.args[2]]) };
  }, bytes), new Promise((r) => setTimeout(() => r('TIMEOUT'), 60000))]);
  await page.waitForTimeout(8000);
  const later = await page.evaluate(() => window.__shell.calls.filter((c) => c.method === 'mark').map((c) => [c.args[0], c.args[2]]));
  console.log(JSON.stringify(r), '\nlater', JSON.stringify(later.filter((m) => /parse/.test(m[0]))));
} finally { await browser.close(); await server.close(); }
