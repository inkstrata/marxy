import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { THEME_FILES, defaultThemeCss, firstThemeCss } from '../../packages/theme/scripts/inline.mjs';
import { FIRST_THEME_ID } from '../../packages/theme/src/loader.ts';
import { FONT_FILES } from './src/fonts/files.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));

const root = new URL('../../', import.meta.url);
const fontsCss = new URL('./src/fonts/fonts.css', import.meta.url);

/**
 * Ships the bundled faces: the vendored files are copied beside index.html under fonts/
 * with their OFL licences, the @font-face rules are inlined ahead of the theme, and the roman and
 * mono faces are preloaded so they are read while the script is still parsing.
 */
function bundleFonts(): Plugin {
  const head = () =>
    FONT_FILES.filter((f) => f.preload)
      .map((f) => `<link rel="preload" as="font" type="font/ttf" crossorigin href="./${f.to}">`)
      .join('\n') + `\n<style id="marxy-fonts">\n${readFileSync(fontsCss, 'utf8')}</style>`;
  return {
    name: 'marxy-bundle-fonts',
    transformIndexHtml: (html) => html.replace('<!-- marxy:fonts -->', head()),
    generateBundle() {
      for (const f of FONT_FILES) this.emitFile({ type: 'asset', fileName: f.to, source: readFileSync(new URL(f.from, root)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = FONT_FILES.find((f) => req.url === `/${f.to}`);
        if (!file) return next();
        res.setHeader('Content-Type', file.to.endsWith('.ttf') ? 'font/ttf' : file.to.endsWith('.woff2') ? 'font/woff2' : 'text/plain');
        res.end(readFileSync(new URL(file.from, root)));
      });
    },
  };
}

/**
 * Inlines the default theme (tokens, base, default theme) into index.html, so the first paint is
 * already styled and dark with no stylesheet request on the startup path.
 */
function inlineDefaultTheme(): Plugin {
  return {
    name: 'marxy-inline-default-theme',
    // The app's pages (not gate.html, which sets its own) also carry the default bundled theme, Ink, for the first paint.
    transformIndexHtml: (html, ctx) => {
      const first = /(^|[\\/])gate\.html$/.test(ctx.filename) ? '' : `\n<style id="${FIRST_THEME_ID}">\n${firstThemeCss()}</style>`;
      return html.replace('<!-- marxy:default-theme -->', `<style id="marxy-default-theme">\n${defaultThemeCss()}</style>${first}`);
    },
    configureServer(server) {
      for (const file of THEME_FILES) server.watcher.add(fileURLToPath(file));
      server.watcher.on('change', (path) => {
        if (THEME_FILES.some((file) => fileURLToPath(file) === path)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

/**
 * The directory Tauri embeds whole (src-tauri/tauri.conf.json, build.frontendDist "../dist"). Only
 * index.html's graph may land there: app.html, the harness the perf harness and the WebKit
 * suites boot over a memory shell, carries the test hooks, so a build into this directory drops it.
 * Every other outDir keeps it: the suites build into temporary directories and `build:harness`
 * writes harness/dist/ (named dist so .gitignore and the repository scanners pass over it, as they
 * do the shipped one). scripts/gate-bundle.mjs fails a dist/ holding a second HTML entry.
 */
const shippedDist = resolve(dir, 'dist');

function shipIndexOnly(): Plugin {
  return {
    name: 'marxy-ship-index-only',
    config(config) {
      const outDir = resolve(config.root ?? dir, config.build?.outDir ?? 'dist');
      const input = config.build?.rollupOptions?.input;
      if (outDir !== shippedDist || !input || typeof input !== 'object' || Array.isArray(input)) return;
      delete (input as Record<string, string>).app;
    },
  };
}

/**
 * Keeps every Shiki grammar off the allow-list out of the bundle. A grammar's module imports the grammars it embeds
 * (C++ and Ruby import GLSL, whose licence is unknown), and those imports would carry them in whatever the allow-list
 * says; each one not listed is replaced with an empty list, and core's loader leaves it out at run time as well.
 * scripts/gate-highlight-bundle.mjs proves the result on dist/.
 */
function onlyAllowedGrammars(): Plugin {
  const list = JSON.parse(readFileSync(new URL('scripts/allowlists/shiki-languages.json', root), 'utf8')) as {
    languages: { grammar: string }[];
  };
  const allowed = new Set(list.languages.map((l) => l.grammar));
  const NONE = '\0marxy-grammar-not-allowed';
  return {
    name: 'marxy-only-allowed-grammars',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/[\\/]@shikijs[\\/]langs[\\/]dist[\\/]/.test(importer)) return null;
      const m = /^\.\/([\w.+-]+)\.mjs$/.exec(source);
      return m && !allowed.has(m[1]!) ? NONE : null;
    },
    load: (id) => (id === NONE ? 'export default [];' : null),
  };
}

/**
 * pdf.js's decoders for JBIG2 and CCITT (scanned pages) and JPEG 2000, as plain JavaScript. The app's CSP allows no
 * WebAssembly, so pdf.js runs with `useWasm: false` and its worker imports these by name from `pdfjs/` beside index.html;
 * they are loaded only when a page holds such an image.
 */
const PDFJS_FALLBACKS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js'];

function pdfjsFallbacks(): Plugin {
  const from = (name: string): string => resolve(dir, 'node_modules/pdfjs-dist/wasm', name);
  return {
    name: 'marxy-pdfjs-fallbacks',
    generateBundle() {
      for (const name of PDFJS_FALLBACKS) this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(from(name)) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = PDFJS_FALLBACKS.find((n) => req.url === `/pdfjs/${n}`);
        if (!name) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(from(name)));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [bundleFonts(), inlineDefaultTheme(), shipIndexOnly(), onlyAllowedGrammars(), pdfjsFallbacks()],
  // The demo's bytes (images, a WebP with no extension, a file with no reading) are fetched as files, never parsed as code.
  // pdf.js's CMaps are read as data in the page: the CSP lets the page fetch nothing of its own origin.
  assetsInclude: ['**/fixtures/demo/{images,downloads,cache,archives,sheets,documents,fonts,media,encodings}/*', '**/fixtures/demo/data/*.{sqlite,sqlite-wal,sqlite-shm,db}', '**/fixtures/demo/**/*.pdf', '**/fixtures/demo/shortcuts/*.lnk', '**/fixtures/demo/mail/*.msg', '**/pdfjs-dist/cmaps/*.bcmap'],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // A font is never inlined as a data: URL: the release CSP's font-src has no data:, so it would not load (KaTeX's
    // Size3 face is under the default 4 KB limit).
    assetsInlineLimit: (file) => (/\.(?:woff2?|ttf|otf)$/i.test(file) ? false : undefined),
    rollupOptions: {
      input: {
        index: resolve(dir, 'index.html'),
        // The harness entry; shipIndexOnly() leaves it out of the shipped dist/.
        app: resolve(dir, 'app.html'),
      },
    },
  },
  // The highlight worker lazy-loads grammars with dynamic import, which needs an ES-module worker.
  worker: { format: 'es', plugins: () => [onlyAllowedGrammars()] },
  // The dev server pre-bundles what it finds from these files before the first page loads. Its scan does not follow
  // `new Worker(...)`, so without the highlight worker the grammars were found only when a page first coloured code,
  // and the re-bundle that followed broke every page still loading (the browser tests run with HMR off, so those
  // pages never reload): a cold cache, as on CI, failed whichever test was booting at that moment.
  optimizeDeps: { entries: ['index.html', 'app.html', 'src/render/highlight.worker.ts'] },
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
});
