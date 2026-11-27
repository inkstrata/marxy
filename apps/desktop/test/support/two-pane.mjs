// Two panes in the harness. The harness page (`app.html`) boots
// the real app over a memory shell; this helper first gives it the shipped skeleton and its inline CSS
// from `index.html`, so a split is laid out by the very rules the app ships, then starts the app on
// `open[0]` and opens `open[1]` beside it through `PaneSet.openIn('other', …)`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './shared-vite.mjs';

const desktopRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Same-length blanks over comments and the contents of <style>/<script>, so a tag-looking string in them is not found. */
function maskInert(html) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, open, _n, inner, close) => open + blank(inner) + close);
}

/** The skeleton in `html`: its default-theme inline <style> and its real <body> without scripts. */
export function skeletonOf(html) {
  const style = html.match(/<!-- marxy:default-theme -->\s*<style>([\s\S]*?)<\/style>/)?.[1];
  const masked = maskInert(html);
  const open = /<body\b[^>]*>/i.exec(masked);
  const end = open ? masked.indexOf('</body', open.index + open[0].length) : -1;
  const body = open && end >= 0
    ? html.slice(open.index + open[0].length, end).replace(/<script[\s\S]*?<\/script>/g, '')
    : undefined;
  if (!style || !body) throw new Error('two-pane: index.html has no inline style or no body');
  return { style, body };
}

/** `index.html`'s own inline <style> and its <body> without the script: the app's skeleton. */
export function shippedSkeleton() {
  return skeletonOf(readFileSync(join(desktopRoot, 'index.html'), 'utf8'));
}

let serverPromise = null;
let closeServer = () => {};

/** One Vite dev server for the test file, on port 0, or the runner's own (`scripts/browser-tests.mjs`). */
export async function harnessBase() {
  if (process.env.MARXY_HARNESS_URL) return process.env.MARXY_HARNESS_URL;
  if (!serverPromise) {
    serverPromise = (async () => {
      const server = await createServer({
        root: desktopRoot,
        configFile: join(desktopRoot, 'vite.config.ts'),
        logLevel: 'silent',
        // No watcher and no HMR: an edit to the source while a file runs must not reload its pages mid-test.
        server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
      });
      await server.listen();
      closeServer = () => server.close();
      return `http://127.0.0.1:${server.config.server.port}/`;
    })();
  }
  return serverPromise;
}

export function closeHarness() {
  return closeServer();
}

export function b64(text) {
  return (typeof text === 'string' ? Buffer.from(text, 'utf8') : Buffer.from(text)).toString('base64');
}

/**
 * Serves the harness page with the shipped skeleton in place of its bare `#doc`, and `index.html`'s
 * inline style in its head, so the page is the app's own DOM booted over a memory shell.
 */
export async function routeSkeleton(page, base) {
  const { style, body } = shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
      .replace('<article id="doc" class="marxy-article"></article>', body);
    if (!html.includes('data-marxy-pane="0"')) throw new Error('two-pane: app.html no longer has the bare #doc this helper replaces');
    await route.fulfill({ response, body: html });
  });
}

/**
 * Boots the app on `files` (path to text, or to bytes) with `open[0]`, and, given `open[1]`, opens it in a second pane.
 * `sparse` names files too large to hold, by size (the memory shell's SparseFile): byte `i` of each is `i % 251`.
 * The handle is `window.__marxyHandle`; the memory shell's calls are on `handle.shell.calls`, and the
 * number of its watches open now is `window.__marxyWatches`. `full` boots through main.ts's
 * `bootApplication`, as the shipped app does, so the palette, the index feed and the collection are up
 * too (the Library lists from them). Resolves what the panes show: `[{ slot, path, article }]`, left to right.
 */
export async function bootTwoPanes(page, { files, open, guard = false, full = false, sparse = {} }) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  // Tests find the app's own module URLs on the resource timeline. The dev server serves about 250 modules
  // unbundled, and WebKit keeps only the first 250 entries, so a module fetched late under load fell off it.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
  await page.goto(`${base}app.html`, { timeout: 120_000 });
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
  return page.evaluate(
    async ({ files, open, guard, full, sparse }) => {
      const bytes = {};
      for (const [path, encoded] of Object.entries(files)) {
        const raw = atob(encoded);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        bytes[path] = out;
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell(bytes, { sparse: Object.fromEntries(Object.entries(sparse).map(([path, size]) => [path, { size, byteAt: (i) => i % 251 }])) });
      if (guard) {
        // The stale-write guard of shell/tauri.ts (`lastRead`), over the memory shell: `readFile` and
        // `recordRead` arm it, `peekFile` does not, and a write with no `expected` of its own refuses when disk
        // is no longer what was read (one with it is checked by the memory shell, as Rust checks it).
        // `window.__outside` is another program writing the file: it does not arm the guard.
        const lastRead = new Map();
        const readRaw = shell.readFile.bind(shell);
        const writeRaw = shell.writeFileAtomic.bind(shell);
        const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
        window.__appWrites = [];
        shell.readFile = async (path) => {
          const read = await readRaw(path);
          lastRead.set(path, read.slice());
          return read;
        };
        shell.peekFile = (path) => readRaw(path);
        shell.recordRead = (path, read) => lastRead.set(path, read.slice());
        shell.writeFileAtomic = async (path, written, own) => {
          const expected = own ?? lastRead.get(path);
          if (expected) {
            const onDisk = await readRaw(path).catch(() => null);
            if (onDisk && !same(expected, onDisk)) throw Object.assign(new Error(`${path}: changed on disk since it was opened; refusing to overwrite`), { code: 'changed' });
          }
          await writeRaw(path, written);
          lastRead.set(path, written.slice());
          window.__appWrites.push({ path, text: new TextDecoder().decode(written) });
        };
        window.__outside = async (path, text, events) => {
          await writeRaw(path, new TextEncoder().encode(text));
          shell.emit(events ?? [{ kind: 'modified', path }]);
        };
        window.__disk = async (path) => new TextDecoder().decode(await readRaw(path));
      }
      // The live `shell.watch` handles: one a pane's live reload started and never closed is a leak.
      window.__marxyWatches = 0;
      const watch = shell.watch.bind(shell);
      shell.watch = async (...args) => {
        const inner = await watch(...args);
        window.__marxyWatches += 1;
        let closed = false;
        return {
          close() {
            if (!closed) window.__marxyWatches -= 1;
            closed = true;
            inner.close();
          },
        };
      };
      const start = full ? (await import('/src/main.ts')).bootApplication : startApp;
      const handle = await start(shell, { argv: open.length === 0 ? [] : [open[0]] });
      await handle.ready;
      window.__marxyHandle = handle;
      if (open[1] !== undefined) await handle.panes().openIn('other', open[1]);
      return handle.panes().panes.map((pane) => ({ slot: pane.slot, path: pane.path(), article: pane.article.id }));
    },
    { files: encoded, open, guard, full, sparse },
  );
}
