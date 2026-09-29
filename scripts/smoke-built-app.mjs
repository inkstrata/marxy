// Nightly monitoring: drive a release Marxy binary through tauri-driver + WebKitWebDriver (Linux),
// open a CRLF fixture copy by argv, toggle a task, assert disk bytes and palette runtime styles (MARXY-254).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer, splice } from '../packages/core/src/buffer/buffer.ts';
import { parseMarkdown } from '../packages/core/src/parse/parse.ts';
import { toggleTask } from '../packages/core/src/operations/toggle-task.ts';
import { ROOT } from './lib/repo.mjs';

export const SMOKE_CORPUS_FILE = '12-crlf-and-bom.md';

/** `MARXY_SMOKE_BUILT_REQUIRED=1` on nightly; local runs skip when the stack is missing. */
export function smokeBuiltRequired(env = process.env) {
  return env.MARXY_SMOKE_BUILT_REQUIRED === '1';
}

/**
 * The corpus file has plain list items; the smoke copy turns the first into a task while keeping BOM and CRLF.
 */
export function taskifiedCopyBytes(sourceBytes) {
  const needle = new TextEncoder().encode('- a\r\n');
  const repl = new TextEncoder().encode('- [ ] a\r\n');
  for (let i = 0; i <= sourceBytes.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (sourceBytes[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const out = new Uint8Array(sourceBytes.length - needle.length + repl.length);
      out.set(sourceBytes.subarray(0, i));
      out.set(repl, i);
      out.set(sourceBytes.subarray(i + needle.length), i + repl.length);
      return out;
    }
  }
  throw new Error('taskifiedCopyBytes: expected "- a\\r\\n" in the CRLF fixture');
}

/** Bytes on disk after toggling the first task marker once (pure core, same rule as the app). */
export function expectedBytesAfterFirstToggle(openBytes) {
  const file = 'smoke.md';
  const ast = parseMarkdown(openBytes, { file });
  let marker = null;
  const walk = (n) => {
    if (n.type === 'taskMarker') marker = n;
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  if (!marker) throw new Error('expectedBytesAfterFirstToggle: no taskMarker in the copy');
  const buffer = createBuffer(file, openBytes);
  const text = new TextDecoder().decode(openBytes.subarray(marker.src.start, marker.src.end));
  const { replacement } = toggleTask.run({
    document: ast,
    node: marker,
    range: marker.src,
    text,
  });
  return splice(buffer, marker.src, replacement).bytes;
}

/** Runtime palette sheet applies `border-radius: 8px` on `#marxy-palette` (MARXY-250 watches this seam). */
export function paletteRuntimeStyleOk(borderRadius) {
  const n = Number.parseFloat(String(borderRadius));
  return Number.isFinite(n) && n >= 7.5;
}

const DRIVER_PORT = Number.parseInt(process.env.MARXY_TAURI_DRIVER_PORT ?? '4444', 10);
const NATIVE_PORT = Number.parseInt(process.env.MARXY_WEBKIT_DRIVER_PORT ?? '4445', 10);
const DRIVER_BASE = `http://127.0.0.1:${DRIVER_PORT}`;

async function wd(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DRIVER_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.value?.error) {
    const msg = json.value?.message ?? json.value?.error ?? res.statusText;
    throw new Error(`WebDriver ${method} ${path}: ${msg}`);
  }
  return json.value;
}

async function exec(sessionId, script, args = []) {
  return wd(`/session/${sessionId}/execute/sync`, {
    method: 'POST',
    body: { script, args },
  });
}

function spawnLogged(cmd, args, env) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const append = (d) => {
    tail = (tail + d).slice(-4000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return { child, tail: () => tail };
}

function resolveReleaseBinary() {
  const candidates = [
    process.env.MARXY_BIN,
    join(ROOT, 'apps/desktop/src-tauri/target/release/marxy'),
  ].filter(Boolean);
  return candidates.find(existsSync) ?? null;
}

async function commandExists(name) {
  return await new Promise((resolve) => {
    const p = spawn('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    p.on('exit', (code) => resolve(code === 0));
  });
}

async function waitForDriverReady(ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const st = await fetch(`${DRIVER_BASE}/status`).then((r) => r.json());
      if (st?.value?.ready) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('tauri-driver did not become ready');
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Polls `path` until it holds `expected`, or until it holds something other than `opening` (the bytes
 * it was opened with), so the caller can report a wrong write. The task toggle `[ ]` -> `[x]` keeps the
 * length unchanged, so a length check returns on the first poll, before the save has landed.
 */
export async function waitForFileBytes(path, expected, { opening = null, ms = 15_000, intervalMs = 100, read = readFileSync } = {}) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const b = read(path);
      if (bytesEqual(b, expected)) return b;
      if (opening && !bytesEqual(b, opening)) return b;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${path} to change from its opening bytes to the expected ${expected.length} bytes`);
}

/**
 * Runs the built-app smoke when Linux, the release binary, and tauri-driver + WebKitWebDriver exist.
 * Returns `{ status: 'ok' | 'skip' | 'fail', message }`.
 */
export async function runBuiltAppSmoke(opts = {}) {
  const required = opts.required ?? smokeBuiltRequired();
  const platform = opts.platform ?? process.platform;
  if (platform !== 'linux') {
    const message = 'built-app smoke runs on Linux with WebKitWebDriver only';
    return required ? { status: 'fail', message } : { status: 'skip', message };
  }
  const bin = opts.binary ?? resolveReleaseBinary();
  if (!bin) {
    const message = 'no release binary; build apps/desktop with `cargo build --release --features tauri/custom-protocol`';
    return required ? { status: 'fail', message } : { status: 'skip', message };
  }
  if (!(await commandExists('tauri-driver')) || !(await commandExists('WebKitWebDriver'))) {
    const message = 'tauri-driver and WebKitWebDriver must be on PATH (apt install webkit2gtk-driver; cargo install tauri-driver)';
    return required ? { status: 'fail', message } : { status: 'skip', message };
  }

  const corpusPath = join(ROOT, 'fixtures/corpus', SMOKE_CORPUS_FILE);
  const source = readFileSync(corpusPath);
  const openBytes = taskifiedCopyBytes(source);
  const expected = expectedBytesAfterFirstToggle(openBytes);
  const work = mkdtempSync(join(tmpdir(), 'marxy-built-smoke-'));
  const docPath = join(work, 'smoke-crlf.md');
  writeCopy(docPath, openBytes);

  const headlessEnv = {
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
    LIBGL_ALWAYS_SOFTWARE: '1',
    NO_AT_BRIDGE: '1',
  };

  // tauri-driver starts WebKitWebDriver itself (`--port=<native-port> --host=<native-host>`) and proxies
  // to it. Starting our own on NATIVE_PORT as well made the two collide: the session request reached our
  // copy, which knows nothing of `tauri:options`.
  const driver = spawnLogged(
    'tauri-driver',
    ['--port', String(DRIVER_PORT), '--native-port', String(NATIVE_PORT)],
    headlessEnv,
  );

  const tauriOptions = { application: bin, args: [docPath] };

  let sessionId;
  try {
    await waitForDriverReady();
    const session = await wd('/session', {
      method: 'POST',
      body: {
        // tauri-driver 2.x rewrites `tauri:options` into `webkitgtk:browserOptions` inside alwaysMatch (3.0.0-alpha.1
        // only rewrites legacy desiredCapabilities, so W3C-only requests reach WebKitWebDriver with no binary and
        // fail "Failed to match capabilities"; nightly pins 2.x). No browserName: WebKitWebDriver would have to match it.
        capabilities: { alwaysMatch: { 'tauri:options': tauriOptions } },
        desiredCapabilities: { 'tauri:options': tauriOptions },
      },
    });
    sessionId = session.sessionId;

    await exec(
      sessionId,
      `const deadline = Date.now() + arguments[0];
       return new Promise((resolve, reject) => {
         const tick = () => {
           const doc = document.getElementById('doc');
           const opened = Boolean(doc && doc.textContent && doc.textContent.includes('CRLF'));
           // The palette mounts after startApp resolves, which is after the document first paints.
           const palette = Boolean(window.__marxyPalette);
           if (opened && palette) return resolve(true);
           if (Date.now() > deadline) return reject(new Error(opened ? 'palette never mounted' : 'document did not open'));
           requestAnimationFrame(tick);
         };
         tick();
       });`,
      [30_000],
    );

    const radius = await exec(
      sessionId,
      `const palette = window.__marxyPalette;
       if (!palette || typeof palette.open !== 'function') throw new Error('palette is not mounted');
       palette.open();
       const dialog = document.getElementById('marxy-palette');
       if (!dialog) throw new Error('missing #marxy-palette');
       return getComputedStyle(dialog).borderRadius;`,
    );
    // Every check runs even after one fails, so a known defect in one (the release CSP blocking
    // runtime styles, MARXY-250) does not hide whether argv open, the toggle and the save still work.
    const failures = [];
    if (!paletteRuntimeStyleOk(radius)) {
      failures.push(`palette runtime style missing (border-radius ${radius}, expected ~8px)`);
    }

    await exec(
      sessionId,
      `window.__marxyPalette?.close();
       const box = document.querySelector('#doc input[type=checkbox]');
       if (!box) throw new Error('no task checkbox in #doc');
       box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));`,
    );
    // Save is explicit (MARXY-49): the toggle changes the buffer, Mod+S writes it through IPC.
    await exec(
      sessionId,
      `const mac = navigator.platform.toUpperCase().includes('MAC');
       document.body.dispatchEvent(new KeyboardEvent('keydown', {
         key: 's', code: 'KeyS', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
       }));`,
    );

    const onDisk = await waitForFileBytes(docPath, expected, { opening: openBytes });
    if (!bytesEqual(onDisk, expected)) {
      let at = 0;
      while (at < onDisk.length && at < expected.length && onDisk[at] === expected[at]) at++;
      failures.push(`disk bytes differ from expected after toggle (first mismatch at ${at})`);
    } else {
      console.log('smoke-built-app: argv open, task toggle and IPC save are byte-exact');
    }
    if (failures.length) return { status: 'fail', message: failures.join('; ') };

    return { status: 'ok', message: `toggle saved through IPC; palette border-radius ${radius}` };
  } catch (e) {
    const detail = [e.message, driver.tail()].filter(Boolean).join('\n');
    return { status: 'fail', message: detail };
  } finally {
    if (sessionId) {
      try {
        await wd(`/session/${sessionId}`, { method: 'DELETE' });
      } catch {
        // session may already be gone
      }
    }
    driver.child.kill('SIGTERM');
    rmSync(work, { recursive: true, force: true });
  }
}

function writeCopy(path, bytes) {
  writeFileSync(path, bytes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBuiltAppSmoke();
  if (result.status === 'skip') {
    console.log(`smoke-built-app skipped: ${result.message}`);
    process.exit(0);
  }
  if (result.status === 'fail') {
    console.error(`smoke-built-app failed: ${result.message}`);
    process.exit(1);
  }
  console.log(`smoke-built-app ok: ${result.message}`);
}