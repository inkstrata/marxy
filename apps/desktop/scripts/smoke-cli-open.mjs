// Runs the packaged app the way a reader does — `marxy fixtures/corpus/02-readme-real-world.md` —
// and checks the acceptance criteria that need a real window: the document renders, `MARK first_text
// <epoch ms>` is printed at least two animation frames after the render, and MARXY_QUIT_AFTER_PAINT=1
// exits with code 0. Also checks the two launches that must NOT report first_text: no document, and a
// document that cannot be read. Skips when no binary has been built, unless MARXY_SMOKE_REQUIRED=1.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const doc = `${repoRoot}fixtures/corpus/02-readme-real-world.md`;
const bin = [
  `${repoRoot}apps/desktop/src-tauri/target/release/marxy`,
  `${repoRoot}apps/desktop/src-tauri/target/release/marxy.exe`,
].find(existsSync);

if (!bin) {
  if (process.env.MARXY_SMOKE_REQUIRED === '1') {
    console.error('smoke-cli-open: no release binary; build apps/desktop first');
    process.exit(1);
  }
  console.log('smoke-cli-open: no release binary; skipping');
  process.exit(0);
}

// WebKitGTK needs a display; CI runners have xvfb and no DISPLAY. On a virtual display it also needs
// 24-bit colour and its DMABUF/compositing paths turned off, or the webview window stays blank and no
// script ever runs. Those switches are for this harness only; a real Linux desktop keeps acceleration.
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const headlessEnv = headless
  ? { WEBKIT_DISABLE_DMABUF_RENDERER: '1', WEBKIT_DISABLE_COMPOSITING_MODE: '1', LIBGL_ALWAYS_SOFTWARE: '1' }
  : {};

const LAUNCH_TIMEOUT_MS = 60_000;

async function launch(appArgs) {
  const [cmd, args] = headless
    ? ['xvfb-run', ['-a', '--server-args=-screen 0 1280x1024x24', bin, ...appArgs]]
    : [bin, appArgs];
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...headlessEnv, MARXY_QUIT_AFTER_PAINT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const startedAt = Date.now();
  const timeout = setTimeout(() => child.kill('SIGKILL'), LAUNCH_TIMEOUT_MS);
  const code = await new Promise(resolve => child.on('exit', c => { clearTimeout(timeout); resolve(c); }));
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  return { code, lines, stderr, ms: Date.now() - startedAt, mark: (name) => lines.findIndex(l => l === `MARK ${name}` || l.startsWith(`MARK ${name} `)) };
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const report = (label, run) => {
  console.log(`--- ${label} (exit ${run.code}, ${run.ms} ms)`);
  console.log(run.lines.join('\n') || '(no stdout)');
  if (run.stderr.trim()) console.log(`stderr: ${run.stderr.trim()}`);
};

// 1. The reader's case: open the corpus README.
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = digest(doc);
const open = await launch([doc]);
report('open a document', open);

const firstTextIndex = open.lines.findIndex(l => /^MARK first_text \d+$/.test(l));
const renderIndex = open.mark('render');
const paintedIndex = open.mark('painted');
const render = open.lines[renderIndex] ?? '';
const painted = open.lines[paintedIndex] ?? '';
const blocks = Number(/blocks=(\d+)/.exec(render)?.[1] ?? 0);
const chars = Number(/chars=(\d+)/.exec(render)?.[1] ?? 0);
const heading = /heading=(.*)$/.exec(render)?.[1] ?? '';
const frames = Number(/frames=(\d+)/.exec(painted)?.[1] ?? NaN);
const sinceRender = Number(/since_render_ms=(\d+)/.exec(painted)?.[1] ?? NaN);

check(open.code === 0, `expected exit code 0 under MARXY_QUIT_AFTER_PAINT=1, got ${open.code}`);
check(firstTextIndex >= 0, 'no line matching /^MARK first_text <epoch ms>$/ on stdout');
check(renderIndex >= 0, 'no MARK render line: the document never reached the DOM');
check(renderIndex >= 0 && firstTextIndex > renderIndex, 'first_text was printed before the render, not after it');
check(blocks >= 15, `expected at least 15 rendered block elements, got ${blocks}`);
check(chars >= 800, `expected at least 800 characters of rendered text, got ${chars}`);
check(heading === 'widgetlib', `expected the fixture's heading "widgetlib" in the DOM, got "${heading}"`);
// The frame count is the whole point of the `painted` line: ordering alone is satisfied by any mark
// in the same task, so without this a change that moved first_text before the paint would pass green
// and make every cold-start number optimistic by about a frame and a half.
check(paintedIndex >= 0, 'no MARK painted line: nothing reports how many frames passed before first_text');
check(frames >= 2, `first_text must be at least 2 animation frames after the render, got frames=${frames}`);
check(Number.isFinite(sinceRender), `MARK painted carries no since_render_ms, got "${painted}"`);
check(!open.lines.some(l => l.startsWith('MARK error ')), `the app reported an error: ${open.lines.find(l => l.startsWith('MARK error '))}`);
check(digest(doc) === before, 'opening the document changed its bytes');

// 2. No document: nothing was read, so nothing may report first_text — otherwise the startup
//    measurement can record a cold start for a launch that rendered nothing at all.
const bare = await launch([]);
report('no document', bare);
check(bare.code === 0, `expected exit code 0 with no document, got ${bare.code}`);
check(bare.mark('no_document') >= 0, 'no MARK no_document line when launched without a document');
check(!bare.lines.some(l => l.startsWith('MARK first_text')), 'first_text was printed for a launch with no document');

// 3. A document that renders to nothing: same rule. A build whose rendering silently broke would
//    otherwise still report a cold-start number, and the budget would be measuring an empty window.
const emptyDoc = join(tmpdir(), 'marxy-smoke-empty.md');
writeFileSync(emptyDoc, '');
const empty = await launch([emptyDoc]);
rmSync(emptyDoc, { force: true });
report('document with no text', empty);
check(empty.mark('no_text') >= 0, 'no MARK no_text line for a document that rendered nothing');
check(!empty.lines.some(l => l.startsWith('MARK first_text')), 'first_text was printed for a document that rendered nothing');

// 4. A document that cannot be read: the app must report the error and still exit when asked.
const broken = await launch([`${repoRoot}fixtures/corpus/does-not-exist.md`]);
report('unreadable document', broken);
check(broken.ms < LAUNCH_TIMEOUT_MS, 'the app had to be killed on the error path instead of exiting');
check(broken.code === 1, `expected exit code 1 on the error path, got ${broken.code}`);
check(broken.lines.some(l => l.startsWith('MARK error ')), 'no MARK error line for an unreadable document');
check(!broken.lines.some(l => l.startsWith('MARK first_text')), 'first_text was printed for a document that could not be read');

if (failures.length) {
  console.error(`smoke-cli-open failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`smoke-cli-open ok: ${blocks} blocks, ${chars} chars, first_text ${frames} frames / ${sinceRender} ms after render; no first_text with no document, no text, or an unreadable file`);
