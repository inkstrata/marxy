// Runs desktop browser test files with one Vite dev server, one set of production builds and one WebKit,
// started once and shared by every file. Usage: node scripts/browser-tests.mjs [--jobs n] <test/file.test.mjs>...
// (paths relative to apps/desktop). A file run by itself with `node --test` still starts its own.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const desktop = join(root, 'apps', 'desktop');
const support = (name) => pathToFileURL(join(desktop, 'test', 'support', name)).href;

const args = process.argv.slice(2);
let jobs = 1;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--jobs') jobs = Number(args[++i]);
  else files.push(args[i]);
}
if (!files.length || !(jobs >= 1)) {
  console.error('usage: node scripts/browser-tests.mjs [--jobs n] <test/file.test.mjs>...');
  process.exit(2);
}

// A run killed hard leaves its builds behind; clear the ones nobody can still be using.
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith('marxy-browser-tests-')) continue;
  const dir = join(tmpdir(), name);
  try {
    if (Date.now() - statSync(dir).mtimeMs > 3600_000) rmSync(dir, { recursive: true, force: true });
  } catch {}
}

const cache = mkdtempSync(join(tmpdir(), 'marxy-browser-tests-'));
// Only values this runner sets reach the files, never ones inherited from the caller's shell.
delete process.env.MARXY_BROWSER_WS;
delete process.env.MARXY_HARNESS_URL;
const env = { ...process.env, MARXY_BUILD_CACHE: cache };
let browserServer;
let twoPane;
let child;
const stop = async () => {
  await browserServer?.close().catch(() => {});
  await Promise.resolve(twoPane?.closeHarness?.()).catch(() => {});
  rmSync(cache, { recursive: true, force: true });
};

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    child?.kill();
    stop().finally(() => process.exit(130));
  });
}

try {
  const { webkit } = await import('playwright');
  // Without WebKit installed the files skip themselves, as they do alone.
  if (existsSync(webkit.executablePath())) {
    browserServer = await webkit.launchServer({ headless: process.env.MARXY_BROWSER_HEADED !== '1' });
    env.MARXY_BROWSER_WS = browserServer.wsEndpoint();
  }
  twoPane = await import(support('two-pane.mjs'));
  env.MARXY_HARNESS_URL = await twoPane.harnessBase();

  const code = await new Promise((done) => {
    child = spawn(
      process.execPath,
      ['--test', '--experimental-strip-types', `--test-concurrency=${jobs}`, '--import', support('shared-browser.mjs'), ...files],
      { cwd: desktop, env, stdio: 'inherit' },
    );
    child.on('exit', (c) => done(c ?? 1));
  });
  await stop();
  process.exit(code);
} catch (err) {
  console.error(err);
  await stop();
  process.exit(1);
}
