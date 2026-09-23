import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { THEME_FILES, defaultThemeCss } from '../../packages/theme/scripts/inline.mjs';
import { FONT_FILES } from './src/fonts/files.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));

const root = new URL('../../', import.meta.url);
const fontsCss = new URL('./src/fonts/fonts.css', import.meta.url);

/**
 * Ships the bundled faces (MARXY-21): the vendored files are copied beside index.html under fonts/
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
        res.setHeader('Content-Type', file.to.endsWith('.ttf') ? 'font/ttf' : 'text/plain');
        res.end(readFileSync(new URL(file.from, root)));
      });
    },
  };
}

/**
 * Inlines the default theme (tokens, base, default theme) into index.html, so the first paint is
 * already styled and dark with no stylesheet request on the startup path (docs/design/05-theme.md).
 */
function inlineDefaultTheme(): Plugin {
  return {
    name: 'marxy-inline-default-theme',
    transformIndexHtml: (html) => html.replace('<!-- marxy:default-theme -->', `<style id="marxy-default-theme">\n${defaultThemeCss()}</style>`),
    configureServer(server) {
      for (const file of THEME_FILES) server.watcher.add(file.pathname);
      server.watcher.on('change', (path) => {
        if (THEME_FILES.some((file) => file.pathname === path)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [bundleFonts(), inlineDefaultTheme()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(dir, 'index.html'),
        app: resolve(dir, 'app.html'),
      },
    },
  },
  // The highlight worker lazy-loads grammars with dynamic import, which needs an ES-module worker.
  worker: { format: 'es' },
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
});
