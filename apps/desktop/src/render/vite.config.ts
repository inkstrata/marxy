// Library build for dist/render.js. Lives here because apps/desktop/vite.config.ts is outside Paths.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/render/headless.ts',
      name: 'marxyHeadless',
      formats: ['iife'],
      fileName: () => 'render.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
