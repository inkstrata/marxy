// Runs the packaged app the way a reader does — `marxy fixtures/corpus/02-readme-real-world.md` —
// and checks the acceptance criteria that need a real window: the document renders, `MARK first_text
// <epoch ms>` is printed at least two animation frames after the render, and MARXY_QUIT_AFTER_PAINT=1
// exits with code 0. Also checks the three launches that must NOT report first_text: no document, a
// document with no text, and a document that cannot be read.
// MARXY_SMOKE_REQUIRED=1 (set by the desktop build, and so by CI) makes every skip a failure instead:
// an unbuilt binary, or an environment that delivers no animation frames at all.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const doc = `${repoRoot}fixtures/corpus/02-readme-real-world.md`;
const required = process.env.MARXY_SMOKE_REQUIRED === '1';
const bin = [
  `${repoRoot}apps/desktop/src-tauri/target/release/marxy`,
  `${repoRoot}apps/desktop/src-tauri/target/release/marxy.exe`,
].find(existsSync);

if (!bin) {
  if (required) {
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

// Long enough for the 30 s WebKitGTK-under-Xvfb warm-up on a CI runner, which happens before the app
// runs a line of script. It is a last resort: the watchdog below is what bounds a launch that renders.
const LAUNCH_TIMEOUT_MS = 60_000;

// The app arms its own 2.5 s deadline for the paint and prints `MARK no_paint`. macOS App Nap can
// suspend a process whose window cannot be seen, and a suspended process runs no deadline — one launch
// here slipped to 28 s — so the harness keeps its own bound on the same property. Either way the
// verdict is the same, and no launch that rendered can hang for the full launch timeout again.
const PAINT_WATCHDOG_MS = 8_000;

/** Marks after which no paint is owed: the launch has reported its outcome and is on its way out. */
const SETTLED = /MARK (?:painted|first_text|no_paint|no_text|no_document|error) /;

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
  let watchdog = null;
  let watchdogFired = false;
  child.stdout.on('data', d => {
    stdout += d;
    if (SETTLED.test(stdout)) {
      clearTimeout(watchdog);
      watchdog = null;
      return;
    }
    if (!watchdog && /MARK render /.test(stdout)) {
      watchdog = setTimeout(() => { watchdogFired = true; child.kill('SIGKILL'); }, PAINT_WATCHDOG_MS);
    }
  });
  child.stderr.on('data', d => { stderr += d; });
  const startedAt = Date.now();
  const timeout = setTimeout(() => child.kill('SIGKILL'), LAUNCH_TIMEOUT_MS);
  const code = await new Promise(resolve => child.on('exit', c => {
    clearTimeout(timeout);
    clearTimeout(watchdog);
    resolve(c);
  }));
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  return {
    code,
    lines,
    stderr,
    watchdogFired,
    ms: Date.now() - startedAt,
    mark: (name) => lines.findIndex(l => l === `MARK ${name}` || l.startsWith(`MARK ${name} `)),
  };
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const report = (label, run) => {
  console.log(`--- ${label} (exit ${run.code}, ${run.ms} ms)`);
  console.log(run.lines.join('\n') || '(no stdout)');
  if (run.stderr.trim()) console.log(`stderr: ${run.stderr.trim()}`);
};

// 0. The paint deadline's own state machine, run inside the binary because no launch renders twice yet.
//    Without it the first story that shows a second document would lose the deadline and nothing would
//    notice: see `paint_deadline_selftest` in src-tauri/src/main.rs.
const selftest = spawnSync(bin, ['--paint-deadline-selftest'], { cwd: repoRoot, encoding: 'utf8' });
console.log(`--- paint deadline selftest (exit ${selftest.status})`);
console.log(selftest.stdout.trim() || '(no stdout)');
check(selftest.status === 0, `the paint deadline selftest failed: ${selftest.stdout.trim()}`);

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

// `MARK no_paint`, or a render that never reports a paint at all, is this environment delivering no
// animation frames — a fact about the machine (a display asleep or locked) and not about the code. It
// is kept strictly apart from "frames arrived but too few", which is always a defect: see the verdict
// at the bottom.
const noPaint = open.mark('no_paint') >= 0 || open.watchdogFired;

if (noPaint) {
  // What the app owes even here is checkable, and none of it depends on a frame arriving.
  check(firstTextIndex < 0, 'first_text was printed by a launch that never painted');
  if (open.watchdogFired) {
    check(paintedIndex < 0, 'MARK painted was printed by a launch the watchdog had to end');
  } else {
    check(open.code === 1, `a launch that never painted must exit non-zero, got ${open.code}`);
    check(open.ms < 15_000, `the launch took ${open.ms} ms: the app's paint deadline should have ended it in about 2.5 s`);
  }
} else {
  check(open.code === 0, `expected exit code 0 under MARXY_QUIT_AFTER_PAINT=1, got ${open.code}`);
  check(firstTextIndex >= 0, 'no line matching /^MARK first_text <epoch ms>$/ on stdout');
  check(renderIndex >= 0 && firstTextIndex > renderIndex, 'first_text was printed before the render, not after it');
  // The frame count is the whole point of the `painted` line: ordering alone is satisfied by any mark
  // in the same task, so without this a change that moved first_text before the paint would pass green
  // and make every cold-start number optimistic by about a frame and a half.
  check(paintedIndex >= 0, 'no MARK painted line: nothing reports how many frames passed before first_text');
  check(frames >= 2, `first_text must be at least 2 animation frames after the render, got frames=${frames}`);
  check(Number.isFinite(sinceRender), `MARK painted carries no since_render_ms, got "${painted}"`);
}
check(renderIndex >= 0, 'no MARK render line: the document never reached the DOM');
check(blocks >= 15, `expected at least 15 rendered block elements, got ${blocks}`);
check(chars >= 800, `expected at least 800 characters of rendered text, got ${chars}`);
check(heading === 'widgetlib', `expected the fixture's heading "widgetlib" in the DOM, got "${heading}"`);
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

// An environment that paints nothing cannot answer the question this check exists to ask, so it says so
// instead of pretending either way: strict where the answer is required (CI, and the desktop build),
// skipped with the reason named where it is not. The property under test is not the thing at fault.
if (noPaint) {
  const how = open.watchdogFired
    ? `it never reported a paint, and this harness ended it after ${PAINT_WATCHDOG_MS} ms (macOS App Nap suspends a window that cannot be seen, and a suspended process cannot run its own deadline)`
    : `the app reported ${open.lines[open.mark('no_paint')]} and exited ${open.code}`;
  const reason = [
    'this environment delivered no animation frames at all.',
    `The app rendered the document (${blocks} blocks, ${chars} chars), then ${how}.`,
    'No first_text was printed, which is the correct behaviour here.',
    'A macOS display asleep or in dark wake, or a locked screen over ssh, does this.',
    'Wake the display and re-run — the frame assertion is not what is wrong.',
  ].join(' ');
  if (required) {
    console.error(`smoke-cli-open failed: ${reason}`);
    process.exit(1);
  }
  console.log(`smoke-cli-open skipped: ${reason}`);
  process.exit(0);
}
console.log(`smoke-cli-open ok: ${blocks} blocks, ${chars} chars, first_text ${frames} frames / ${sinceRender} ms after render; no first_text with no document, no text, or an unreadable file`);
