// Pictures of the app, for looking at a change: `pnpm --filter @marxy/desktop shots <scenario.mjs> [options]`.
// A scenario is a module whose default export is `async ({ boot, shot, plantText, plantBytes, open, out, real }) => {}`.
// By default the app is this tree's source, served by Vite on a free port over the memory shell and drawn in headless
// Edge with its scrollbars showing: Playwright hides them unless told not to, and the app's bar is drawn in Chromium
// only. With --exe the same scenario drives the built marxy.exe's WebView2 window through its debugging port, holding
// check:tauri's machine lock, with a data folder of its own.
//   --out <dir>      where the pictures go (default: work/shots/<tree>-<time> in the workspace)
//   --only <text>    take only the pictures whose name contains the text
//   --scale <n>      device pixels per CSS pixel (default 2: a crop is sharp at true size)
//   --size <WxH>     the viewport (default 1440x900)
//   --exe [path]     the built app instead of the source; the path defaults to MARXY_BIN, then the release binary
//   --browser <b>    msedge (default), chrome or chromium
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newDataFolder, removeDataFolder } from './data-folder.mjs';
import { takeLock } from '../../../scripts/lib/machine-lock.mjs';
import { workspace } from '../../../scripts/lib/workspace.mjs';

const DESKTOP = fileURLToPath(new URL('../', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const USAGE = 'usage: node scripts/shots.mjs <scenario.mjs> [--out <dir>] [--only <text>] [--scale <n>] [--size <WxH>] [--exe [path]] [--browser msedge|chrome|chromium]';
const BROWSERS = ['msedge', 'chrome', 'chromium'];

/** Parsed command line; throws an Error with a message for a bad one. */
export function parseArgs(argv) {
  const o = { scenario: null, out: null, only: '', scale: 2, width: 1440, height: 900, exe: null, browser: 'msedge', help: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const take = () => {
      if (inline !== null) return inline;
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--out': o.out = take(); break;
      case '--only': o.only = take(); break;
      case '--scale': o.scale = Number(take()); break;
      case '--size': {
        const m = take().match(/^(\d+)x(\d+)$/);
        if (!m) throw new Error('--size is WIDTHxHEIGHT, as in 1440x900');
        o.width = Number(m[1]);
        o.height = Number(m[2]);
        break;
      }
      case '--browser': o.browser = take(); break;
      case '--exe': {
        // The path is optional: `--exe` alone is the default binary.
        const next = argv[i + 1];
        o.exe = inline ?? (next !== undefined && !next.startsWith('--') && /\.exe$/i.test(next) ? argv[++i] : '');
        break;
      }
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
        if (o.scenario) throw new Error(`one scenario at a time: ${o.scenario}, then ${a}`);
        o.scenario = a;
    }
  }
  if (!o.help && !o.scenario) throw new Error('name a scenario module');
  if (!(o.scale >= 1 && o.scale <= 4)) throw new Error('--scale is a number from 1 to 4');
  if (!BROWSERS.includes(o.browser)) throw new Error(`--browser is one of ${BROWSERS.join(', ')}, not ${o.browser}`);
  return o;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const landed = () => !!document.title && document.title !== 'Marxy';

function watchErrors(page) {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
}

/** The app from source: a Vite server for this tree and a headless browser. Each boot is a fresh context and page. */
async function fromSource(o) {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: DESKTOP,
    configFile: join(DESKTOP, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ ...(o.browser === 'chromium' ? {} : { channel: o.browser }), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  return {
    real: false,
    async boot(file = 'plans/pg16-upgrade-plan.md', { w = o.width, h = o.height, scheme = 'dark', scale = o.scale } = {}) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: scale });
      const page = await context.newPage();
      watchErrors(page);
      await page.goto(`${base}/?open=${encodeURIComponent(file)}`);
      await page.waitForFunction(() => !!window.marxy?.handle && !!document.title && document.title !== 'Marxy', null, { timeout: 45000 });
      await page.waitForTimeout(800);
      return page;
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/** The built app: one window at a time, launched on a file with its debugging port open. A boot replaces the last one. */
async function fromBinary(o) {
  if (process.platform !== 'win32') throw new Error('--exe drives WebView2, so Windows only');
  const exe = resolve(o.exe || process.env.MARXY_BIN || join(DESKTOP, 'src-tauri/target/release/marxy.exe'));
  if (!existsSync(exe)) throw new Error(`no binary at ${exe}; run pnpm --filter @marxy/desktop build`);
  const { chromium } = await import('playwright');
  // The port and the app's single-instance lock are the machine's, shared with check:tauri.
  const release = await takeLock('check-tauri', { waitMs: Number(process.env.MARXY_LOCK_WAIT_SEC ?? 0) * 1000, label: 'shots', log: m => console.log(`shots: ${m}`) });
  const port = 9333;
  let running = null;
  const stop = async () => {
    if (!running) return;
    const { app, browser, dataDir } = running;
    running = null;
    await browser?.close().catch(() => {});
    app.kill();
    await removeDataFolder(dataDir);
  };
  return {
    real: true,
    async boot(file = 'plans/pg16-upgrade-plan.md', { scheme } = {}) {
      await stop();
      const dataDir = newDataFolder('marxy-shots-');
      const env = {
        ...process.env,
        MARXY_DATA_DIR: dataDir,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`,
      };
      const app = spawn(exe, [isAbsolute(file) ? file : join(ROOT, 'fixtures/demo', file)], { env, stdio: 'ignore' });
      running = { app, browser: null, dataDir };
      for (let i = 0; i < 60 && !running.browser; i++) {
        running.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
        if (!running.browser) await wait(500);
      }
      if (!running.browser) throw new Error(`no WebView2 debugging port at ${port}`);
      let page;
      for (let i = 0; i < 60 && !page; i++) {
        page = running.browser.contexts().flatMap(c => c.pages()).find(p => !p.url().startsWith('devtools'));
        if (!page) await wait(500);
      }
      if (!page) throw new Error('the app opened no window');
      watchErrors(page);
      if (scheme) await page.emulateMedia({ colorScheme: scheme });
      await page.waitForFunction(landed, null, { timeout: 30000 });
      await wait(1500);
      return page;
    },
    async close() {
      await stop();
      release();
    },
  };
}

const memoryOnly = name => () => {
  throw new Error(`${name} writes into the memory shell; with --exe put the file on disk and boot its path`);
};

export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`shots: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  const scenarioFile = resolve(o.scenario);
  if (!existsSync(scenarioFile)) {
    console.error(`shots: no scenario at ${scenarioFile}`);
    return 2;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const out = resolve(o.out ?? join(workspace(ROOT).work, 'shots', `${basename(resolve(ROOT))}-${stamp}`));
  mkdirSync(out, { recursive: true });
  let failed = 0;
  let host;
  try {
    host = o.exe === null ? await fromSource(o) : await fromBinary(o);
    const taken = [];
    const shot = async (page, name, { clip, wait: ms = 300 } = {}) => {
      if (o.only && !name.includes(o.only)) return;
      await page.waitForTimeout(ms);
      await page.screenshot({ path: join(out, `${name}.png`), ...(clip ? { clip } : {}) });
      if (page.errors?.length) console.log(`  ${name}: page errors: ${page.errors.slice(0, 3).join(' | ')}`);
      taken.push(name);
      console.log(`shot ${name}`);
    };
    const plantBytes = async (page, path, bytes) => {
      await page.evaluate(([p, b64]) => {
        const raw = atob(b64);
        const data = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
        window.marxy.shell.plant(p, data);
      }, [path, Buffer.from(bytes).toString('base64')]);
    };
    const scenario = await import(pathToFileURL(scenarioFile).href);
    await scenario.default({
      boot: host.boot,
      shot,
      out,
      real: host.real,
      plantBytes: host.real ? memoryOnly('plantBytes') : plantBytes,
      plantText: host.real ? memoryOnly('plantText') : (page, path, text) => plantBytes(page, path, Buffer.from(text, 'utf8')),
      /** Opens a path of the shell in the page's active pane and gives it `ms` to land. */
      open: async (page, path, ms = 1200) => {
        await page.evaluate(p => window.marxy.handle.open(p), path);
        await page.waitForTimeout(ms);
      },
    });
    console.log(`${taken.length} pictures in ${out}`);
  } catch (e) {
    failed = 1;
    console.error(`shots: ${e.stack ?? e.message}`);
  } finally {
    await host?.close().catch(() => {});
  }
  return failed;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
