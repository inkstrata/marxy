// Drop-in `build` and `createServer` for browser tests. Alone they are Vite's own. Under
// `scripts/browser-tests.mjs` (MARXY_HARNESS_URL, MARXY_BUILD_CACHE) they reuse the runner's dev server
// and one production build per set of options, so a batch pays the start-up once.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { build as viteBuild, createServer as viteCreateServer } from 'vite';

const replacer = (_k, v) => (typeof v === 'function' ? v.toString() : v);

/** `vite.build` into `config.build.outDir`; with a build cache, a repeat of the same options copies the first result. */
export async function build(config) {
  const cache = process.env.MARXY_BUILD_CACHE;
  const outDir = config?.build?.outDir;
  if (!cache || !outDir) return viteBuild(config);
  const rest = { ...config, build: { ...config.build, outDir: undefined } };
  const key = createHash('sha1').update(JSON.stringify(rest, replacer)).digest('hex').slice(0, 16);
  const hit = join(cache, key);
  // A hit copies over `outDir` without emptying it and returns undefined, so `outDir` must be fresh.
  if (!existsSync(hit)) {
    const result = await viteBuild(config);
    // Rename is atomic, so a concurrent file never reads a half-copied cache entry.
    const staging = `${hit}.${process.pid}`;
    cpSync(outDir, staging, { recursive: true });
    try { renameSync(staging, hit); } catch { rmSync(staging, { recursive: true, force: true }); }
    return result;
  }
  mkdirSync(dirname(outDir), { recursive: true });
  cpSync(hit, outDir, { recursive: true });
}

/** A Vite dev server; with MARXY_HARNESS_URL, a stand-in for the runner's one. */
export async function createServer(config) {
  const url = process.env.MARXY_HARNESS_URL;
  if (!url) return viteCreateServer(config);
  return { listen: async () => {}, close: async () => {}, config: { server: { port: Number(new URL(url).port) } } };
}
