import { defineConfig, type Plugin } from 'vite';
import { THEME_FILES, defaultThemeCss } from '../../packages/theme/scripts/inline.mjs';

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
  plugins: [inlineDefaultTheme()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
});
