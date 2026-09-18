// Runs the packaged app the way a reader does — `marxy fixtures/corpus/02-readme-real-world.md` —
// and checks the acceptance criteria that need a real window: the document renders, `MARK first_text
// <epoch ms>` is printed after the render, and MARXY_QUIT_AFTER_PAINT=1 exits with code 0.
// Skips when no binary has been built, unless MARXY_SMOKE_REQUIRED=1.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

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

// WebKitGTK needs a display; CI runners have xvfb and no DISPLAY.
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const [cmd, args] = headless ? ['xvfb-run', ['-a', bin, doc]] : [bin, [doc]];

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = digest(doc);

const child = spawn(cmd, args, {
  cwd: repoRoot,
  env: { ...process.env, MARXY_QUIT_AFTER_PAINT: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', d => { stdout += d; });
child.stderr.on('data', d => { stderr += d; });

const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
const code = await new Promise(resolve => child.on('exit', c => { clearTimeout(timeout); resolve(c); }));

const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const firstTextIndex = lines.findIndex(l => /^MARK first_text \d+$/.test(l));
const renderIndex = lines.findIndex(l => l.startsWith('MARK render '));
const render = lines[renderIndex] ?? '';
const blocks = Number(/blocks=(\d+)/.exec(render)?.[1] ?? 0);
const chars = Number(/chars=(\d+)/.exec(render)?.[1] ?? 0);
const heading = /heading=(.*)$/.exec(render)?.[1] ?? '';

check(code === 0, `expected exit code 0 under MARXY_QUIT_AFTER_PAINT=1, got ${code}`);
check(firstTextIndex >= 0, 'no line matching /^MARK first_text <epoch ms>$/ on stdout');
check(renderIndex >= 0, 'no MARK render line: the document never reached the DOM');
check(renderIndex >= 0 && firstTextIndex > renderIndex, 'first_text was printed before the render, not after it');
check(blocks >= 15, `expected at least 15 rendered block elements, got ${blocks}`);
check(chars >= 800, `expected at least 800 characters of rendered text, got ${chars}`);
check(heading === 'widgetlib', `expected the fixture's heading "widgetlib" in the DOM, got "${heading}"`);
check(!lines.some(l => l.startsWith('MARK error ')), `the app reported an error: ${lines.find(l => l.startsWith('MARK error '))}`);
check(digest(doc) === before, 'opening the document changed its bytes');

console.log(lines.join('\n'));
if (failures.length) {
  if (stderr.trim()) console.error(stderr.trim());
  console.error(`smoke-cli-open failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`smoke-cli-open ok: exit ${code}, ${blocks} blocks, ${chars} chars, first_text after render`);
