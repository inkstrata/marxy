import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: 'es2022', outDir: 'dist', emptyOutDir: true }, clearScreen: false, server: { strictPort: true, port: 1420 } });
