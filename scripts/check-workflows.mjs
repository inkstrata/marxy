// Which third-party code runs in our CI, and whether our Rust builds are held to Cargo.lock.
// usage: node scripts/check-workflows.mjs [--selftest]
//
// A GitHub Action runs with the workflow's token on the machine that builds what we ship, so each one
// is a dependency in the most sensitive position we have. MARXY-74 added a caching action for apt
// packages; it restored files without their pkg-config metadata and every Rust build on the Linux
// runner failed, which is the cheap version of what a bad action can do. The list below is the set we
// accept, each pinned to a major version, and anything else fails this check rather than arriving with
// a pull request nobody read closely.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, fix } from './lib/repo.mjs';

const ALLOWED = new Set([
  'actions/checkout',
  'actions/cache',
  'actions/upload-artifact',
  'actions/download-artifact',
  'actions/github-script',
  'jdx/mise-action',
  'dtolnay/rust-toolchain',
  'Swatinem/rust-cache',
  'softprops/action-gh-release',
  // The Tauri project's own action, building the thing it maintains; already in release.yml.
  'tauri-apps/tauri-action',
]);

// Every cargo build, check, clippy or test, and every tauri build, runs with --locked (MARXY-270), as pnpm
// installs with --frozen-lockfile: without it cargo re-resolves a stale Cargo.lock on the runner and CI
// tests a dependency graph nobody committed. cargo's own flags come before any `--`; tauri build hands
// what follows its `--` to cargo, so --locked has to be there.
function unlocked(command) {
  const found = [];
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const cargo = /\bcargo\s+(build|check|clippy|test)\b(.*)/.exec(part);
    if (cargo && !cargo[2].split(/\s--(?:\s|$)/)[0].split(/\s+/).includes('--locked')) found.push(`cargo ${cargo[1]}`);
    const tauri = /\btauri\s+build\b(.*)/.exec(part);
    if (tauri && !lockedAfterSeparator(tauri[1])) found.push('tauri build');
  }
  return found;
}
const lockedAfterSeparator = args => { const at = args.search(/(?:^|\s)--(?:\s|$)/); return at >= 0 && args.slice(at).split(/\s+/).includes('--locked'); };

/** Unlocked invocations in a workflow's text, as `line: what`; comment lines are skipped. */
function unlockedInWorkflow(text) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    for (const what of unlocked(line.replace(/\s#.*$/, ''))) found.push(`${i + 1}: ${what}`);
    // tauri-action runs `tauri build <args>`, so its args carry the `-- --locked`.
    if (/^\s*(?:-\s*)?uses:\s*tauri-apps\/tauri-action@/.test(line)) {
      const indent = line.search(/\S/);
      let args = null;
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) {
        const m = /^\s*args:\s*(.*)$/.exec(lines[j]);
        if (m) args = m[1];
      }
      if (args === null || !lockedAfterSeparator(args)) found.push(`${i + 1}: tauri-apps/tauri-action args`);
    }
  });
  return found;
}

const SELFTEST = [
  ['run: cargo build --profile ci', ['1: cargo build']],
  ['run: cargo build --locked --profile ci', []],
  ['run: cd x && cargo fmt --check && cargo clippy --quiet -- -D warnings', ['1: cargo clippy']],
  ['run: cargo clippy --locked --quiet -- -D warnings', []],
  ['run: cargo clippy --quiet -- --locked', ['1: cargo clippy']],
  ['run: cargo test --quiet', ['1: cargo test']],
  ['run: vite build && tauri build --no-bundle', ['1: tauri build']],
  ['run: vite build && tauri build --no-bundle -- --locked', []],
  ['run: tauri build --locked', ['1: tauri build']],
  ['# cargo build without the flag, in a comment', []],
  ['      - uses: tauri-apps/tauri-action@v0\n        with:\n          args: --target x', ['1: tauri-apps/tauri-action args']],
  ['      - uses: tauri-apps/tauri-action@v0\n        with:\n          args: --target x -- --locked', []],
  ['      - uses: tauri-apps/tauri-action@v0\n        env: { A: b }', ['1: tauri-apps/tauri-action args']],
];
const selftestFailures = SELFTEST.flatMap(([text, want]) => {
  const got = unlockedInWorkflow(text);
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`selftest: ${JSON.stringify(text)} gave ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`];
});
if (process.argv.includes('--selftest')) {
  if (fail(selftestFailures)) process.exit(1);
  console.log(`check-workflows selftest ok (${SELFTEST.length} cases)`);
  process.exit(0);
}

const dir = join(ROOT, '.github/workflows');
const problems = [...selftestFailures];
let used = 0;
for (const name of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), 'utf8');
  for (const [, spec] of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    used++;
    const [action, version] = spec.split('@');
    if (action.startsWith('./')) continue;
    if (!ALLOWED.has(action)) problems.push(`.github/workflows/${name}: uses "${spec}"${fix('run the command directly, or add the action to ALLOWED in scripts/check-workflows.mjs and say in the pull request why we accept it')}`);
    else if (!version) problems.push(`.github/workflows/${name}: "${action}" is not pinned to a version${fix('pin it, e.g. @v4')}`);
  }
  for (const where of unlockedInWorkflow(text)) problems.push(`.github/workflows/${name}:${where} runs without --locked${fix('add --locked (after `--` for tauri build and tauri-action args) so CI builds the committed Cargo.lock')}`);
}

const ciYml = readFileSync(join(dir, 'ci.yml'), 'utf8');

// The failure this check exists for was invisible until a cargo build script traced it, so ask the
// question directly and in one line: can pkg-config see the library the webview needs?
if (!ciYml.includes('pkg-config --exists glib-2.0')) {
  problems.push(`.github/workflows/ci.yml: the Linux job does not check that pkg-config can resolve glib-2.0 before the Rust steps${fix('add a step running pkg-config --exists glib-2.0, so a missing dependency is one line rather than a build-script trace')}`);
}

// Criterion 3: dbus stays on the Linux dep step. MARXY-74 added it because the Linux cold-start
// stall it fixed is measured (MARXY-63); grepping the whole file would still pass if the token
// moved to a comment, so read that step's apt-get package list and require the name.
const depStep = ciYml.match(/^[ \t]*- name: Linux webview and X deps\n([\s\S]*?)(?=^[ \t]*- |\z)/m);
const installLine = depStep?.[1].match(/apt-get install[^\n]*/)?.[0] ?? '';
const depPackages = installLine.split(/\s+/).filter(t => t && t !== 'sudo' && t !== 'apt-get' && t !== 'install' && !t.startsWith('-'));
if (!depStep) {
  problems.push(`.github/workflows/ci.yml: no Linux webview and X deps step${fix('keep the apt-get step that installs the webview libraries and dbus')}`);
} else if (!depPackages.includes('dbus')) {
  problems.push(`.github/workflows/ci.yml: the Linux dep step's package list does not include dbus${fix('add dbus to the apt-get install line; the Linux cold-start stall it fixes is measured')}`);
}

const nightlyYml = readFileSync(join(dir, 'nightly.yml'), 'utf8');
if (!nightlyYml.includes('built-app-smoke:')) {
  problems.push(`.github/workflows/nightly.yml: no built-app-smoke job${fix('add the MARXY-254 release smoke job after aesthetics-determinism')}`);
} else if (!/timeout-minutes:\s*\d+/.test(nightlyYml.slice(nightlyYml.indexOf('built-app-smoke:')))) {
  problems.push(`.github/workflows/nightly.yml: built-app-smoke has no timeout-minutes${fix('every job carries timeout-minutes (docs/ci-contract.md)')}`);
} else {
  const smokeBlock = nightlyYml.slice(nightlyYml.indexOf('built-app-smoke:'));
  if (!smokeBlock.includes('smoke-built-app.mjs')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not run scripts/smoke-built-app.mjs${fix('drive the release binary with tauri-driver after building it')}`);
  }
  if (!smokeBlock.includes('cargo build --release --features tauri/custom-protocol')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not build a release binary${fix('use cargo build --release --features tauri/custom-protocol')}`);
  }
  const smokeDeps = smokeBlock.match(/apt-get install[^\n]*/)?.[0] ?? '';
  if (!smokeDeps.includes('webkit2gtk-driver')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke does not install webkit2gtk-driver${fix('apt-get install webkit2gtk-driver for WebKitWebDriver')}`);
  }
  if (!smokeBlock.includes('MARXY_SMOKE_BUILT_REQUIRED=1')) {
    problems.push(`.github/workflows/nightly.yml: built-app-smoke must set MARXY_SMOKE_BUILT_REQUIRED=1${fix('the smoke skips without a stack; nightly must fail instead')}`);
  }
}

for (const manifest of ['package.json', 'apps/desktop/package.json']) {
  const { scripts = {} } = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  for (const [script, command] of Object.entries(scripts)) {
    for (const what of unlocked(command)) problems.push(`${manifest}: script "${script}" runs ${what} without --locked${fix('add --locked (after `--` for tauri build) so the build uses the committed Cargo.lock')}`);
  }
}

if (fail(problems)) process.exit(1);
console.log(`workflows ok (${used} action use(s), all allow-listed and pinned; glib-2.0 probed; dbus on the Linux dep step; nightly built-app smoke wired; every cargo and tauri build locked)`);
